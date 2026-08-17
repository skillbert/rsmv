import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
// credit mostly to claude


/**
 * Synchronous Blob VFS for SQLite WASM.
 *
 * Must run inside a Worker — requires FileReaderSync.
 * No SharedArrayBuffer, no Atomics, no locks.
 *
 * Usage:
 *   import { installBlobVfs } from './blob-vfs.js';
 *   const sqlite3 = await sqlite3InitModule();
 *   const vfs = installBlobVfs(sqlite3, myBlob);
 *   const db = vfs.open();           // opens myBlob as a read-only DB
 *
 * Multiple blobs:
 *   const vfs = installBlobVfs(sqlite3, { 'a.db': blobA, 'b.db': blobB });
 *   const db = vfs.open('a.db');
 */

declare class FileReaderSync {
	readAsArrayBuffer(blob: Blob): ArrayBuffer;
}

type SqlitePointer = number;
type BlobSource = Blob | Record<string, Blob> | Map<string, Blob>;

interface OpenFile {
	blob: Blob;
	filename: string | null;
}

export function installBlobVfs(sqlite3: Sqlite3Static, source: BlobSource, vfsName = 'blob-vfs') {
	const { capi, wasm } = sqlite3;

	// Normalise source into a Map<string, Blob>
	const blobs = normaliseSource(source);

	const reader = new FileReaderSync();

	// Per-open-file state, keyed by sqlite3_file* pointer (a number)
	const openFiles = new Map<SqlitePointer, OpenFile>();

	// io-methods
	const ioMethods = new capi.sqlite3_io_methods();
	// iVersion=1 is sufficient; versions 2/3 add shm and fetch extensions
	ioMethods.iVersion = 1;

	// vfs struct

	const vfsStruct = new capi.sqlite3_vfs();
	vfsStruct.$iVersion = 2;   // exposes xCurrentTimeInt64
	vfsStruct.$szOsFile = capi.sqlite3_file.prototype.structInfo.sizeof;
	vfsStruct.$mxPathname = 512;

	// register everything

	sqlite3.vfs.installVfs({
		io: {
			struct: ioMethods,
			methods: {
				xClose(pFile: SqlitePointer) {
					openFiles.delete(pFile);
					return 0;
				},

				xRead(pFile: SqlitePointer, pDest: SqlitePointer, n: number, offset64: number | bigint) {
					const f = openFiles.get(pFile);
					if (!f) return capi.SQLITE_IOERR_READ;

					const offset = Number(offset64);
					const slice = f.blob.slice(offset, offset + n);
					const buf = new Uint8Array(reader.readAsArrayBuffer(slice));

					wasm.heap8u().set(buf, Number(pDest));

					if (buf.length < n) {
						// SQLite requires the remainder to be zeroed on a short read
						wasm.heap8u().fill(0, Number(pDest) + buf.length, Number(pDest) + n);
						return capi.SQLITE_IOERR_SHORT_READ;
					}
					return 0;
				},

				// Read-only — writes are not supported
				xWrite(pFile: SqlitePointer, pSrc: SqlitePointer, n: number, offset64: number | bigint) {
					return capi.SQLITE_READONLY;
				},
				xTruncate(pFile: SqlitePointer, sz64: number | bigint) {
					return capi.SQLITE_READONLY;
				},
				xSync(pFile: SqlitePointer, flags: number) {
					return 0;
				},

				xFileSize(pFile: SqlitePointer, pSz64: SqlitePointer) {
					const f = openFiles.get(pFile);
					if (!f) return capi.SQLITE_IOERR;
					wasm.poke(pSz64, f.blob.size, 'i64');
					return 0;
				},

				xLock(pFile: SqlitePointer, lockType: number) {
					return 0;
				},
				xUnlock(pFile: SqlitePointer, lockType: number) {
					return 0;
				},
				xCheckReservedLock(pFile: SqlitePointer, pOut: SqlitePointer) {
					wasm.poke32(pOut, 0);
					return 0;
				},
				xFileControl(pFile: SqlitePointer, opId: number, pArg: SqlitePointer) {
					return capi.SQLITE_NOTFOUND;
				},
				// xSectorSize(pFile: SqlitePointer) { return 4096 as any; },

				// IMMUTABLE tells SQLite the file will never change externally,
				// suppressing WAL and journal probing
				xDeviceCharacteristics(pFile: SqlitePointer) {
					return capi.SQLITE_IOCAP_IMMUTABLE as any;
				},
			},
		},

		vfs: {
			struct: vfsStruct,
			name: vfsName,
			asDefault: false,
			methods: {
				xOpen(pVfs: SqlitePointer, zName: SqlitePointer, pFile: SqlitePointer, flags: number, pOutFlags: SqlitePointer) {
					const filename = zName ? wasm.cstrToJs(zName) : null;

					// Journal/WAL opens are impossible on an immutable blob
					const isMain = !!(flags & capi.SQLITE_OPEN_MAIN_DB);
					if (!isMain) return capi.SQLITE_CANTOPEN;

					const blob = resolveBlob(blobs, filename);
					if (!blob) return capi.SQLITE_CANTOPEN;

					openFiles.set(pFile, { blob, filename });
					new capi.sqlite3_file(pFile).$pMethods = ioMethods.pointer;
					wasm.poke32(pOutFlags, flags);
					return 0;
				},

				xDelete(pVfs: SqlitePointer, zName: SqlitePointer, doSyncDir: number) {
					return 0;
				},

				xAccess(pVfs: SqlitePointer, zName: SqlitePointer, flags: number, pOut: SqlitePointer) {
					// Report every filename as accessible so SQLite doesn't abort
					wasm.poke32(pOut, 1);
					return 0;
				},

				xFullPathname(pVfs: SqlitePointer, zName: SqlitePointer, nOut: number, pOut: SqlitePointer) {
					// Pass the name through unchanged; bail if it doesn't fit
					return wasm.cstrncpy(pOut, zName, nOut) < nOut
						? 0
						: capi.SQLITE_CANTOPEN;
				},

				xCurrentTime(pVfs: SqlitePointer, pOut: SqlitePointer) {
					// Julian day number
					wasm.poke(pOut, 2440587.5 + Date.now() / 86400000, 'double');
					return 0;
				},

				xCurrentTimeInt64(pVfs: SqlitePointer, pOut: SqlitePointer) {
					// Julian milliseconds (sqlite3 internal scale)
					wasm.poke64(pOut, BigInt(2440587.5 * 86400000 + Date.now()));
					return 0;
				},

				xGetLastError(pVfs: SqlitePointer, nOut: number, pOut: SqlitePointer) { return 0; },
			},
		},
	});

	return {
		blobs,
		name: vfsName,
		// open a database from a registered blob
		open(filename?: string) {
			return new sqlite3.oo1.DB({ filename: filename ?? firstKey(blobs), vfs: vfsName, flags: 'r' });
		},
	};
}

// helpers

function normaliseSource(source: BlobSource): Map<string, Blob> {
	if (source instanceof Blob) {
		return new Map([['blob', source]]);
	}
	if (source instanceof Map) {
		return source;
	}
	// plain object
	return new Map(Object.entries(source));
}

function resolveBlob(blobs: Map<string, Blob>, filename: string | null): Blob | null {
	if (!filename) return blobs.values().next().value ?? null;
	return blobs.get(filename) ?? null;
}

function firstKey(map: Map<string, Blob>): string {
	return map.keys().next().value ?? 'blob';
}
