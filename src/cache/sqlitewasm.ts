import { cacheMajors } from "../constants";
import { AbstractSQLiteStatement, AbstractSQLiteWorker } from "../libs/sqlite3wrap";
import { decompress } from "./compression";
import * as cache from "./index";


type CacheTableAccess = {
	table: AbstractSQLiteWorker,
	getfile: AbstractSQLiteStatement,
	getindex: AbstractSQLiteStatement
}

type CacheTable = {
	major: number,
	table: CacheTableAccess | null,
	tableready: Promise<CacheTableAccess> | null,
	file: File
}

export class WasmGameCacheLoader extends cache.CacheFileSource {
	indices = new Map<number, Promise<cache.CacheIndexFile>>();
	dbfiles: Map<number, CacheTable> = new Map();
	timestamp = new Date();
	constructor() {
		super();
	}
	getCacheMeta() {
		return {
			name: `sqlitewasm`,
			descr: "Direclty loads NXT cache files from the disk, in browser compatible environment.",
			timestamp: this.timestamp
		}
	}

	async generateRootIndex() {
		console.log("using generated cache index file meta, crc size and version missing");

		let majors: cache.CacheIndex[] = [];
		for (let file of this.dbfiles.values()) {
			majors[file.major] = {
				major: cacheMajors.index,
				minor: file.major,
				crc: 0,
				size: 0,
				subindexcount: 1,
				subindices: [0],
				name: null,
				subnames: null,
				version: 0,
				uncompressed_crc: 0,
				uncompressed_size: 0
			};
		}

		return majors;
	}
	giveBlobs(blobs: Record<string, File>) {
		for (let file of Object.values(blobs)) {
			let m = file.name.match(/js5-(\d+)\.jcache$/);
			if (m) {
				let major = +m[1];
				if (!this.dbfiles.get(major)) {
					this.dbfiles.set(major, {
						major,
						table: null,
						tableready: null,
						file
					});
				}
			}
		}
	}
	async giveFsDirectory(dir: FileSystemDirectoryHandle) {
		let files: Record<string, File> = {};
		if (await dir.queryPermission() != "granted") {
			console.log("tried to open cache without permission");
			return null;
		}
		// await source.handle.requestPermission();
		for await (let file of dir.values()) {
			if (file.kind == "file") {
				files[file.name] = await file.getFile();
			}
		}
		this.giveBlobs(files);
	}

	async getFile(major: number, minor: number, crc?: number) {
		if (major == cacheMajors.index) { return this.getIndexFile(minor); }
		let index = this.prepareTable(major);
		let table = index.table ?? await index.tableready;
		let [row] = await table.getfile.run([minor]);
		let res = Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength);
		return decompress(res);
	}

	async getFileArchive(index: cache.CacheIndex) {
		let arch = await this.getFile(index.major, index.minor, index.crc);
		return cache.unpackSqliteBufferArchive(arch, index.subindices, index.subnames);
	}

	async getCacheIndex(major: number) {
		if (major == cacheMajors.index) { return this.generateRootIndex(); }
		let index = this.indices.get(major);
		if (!index) {
			index = this.getIndexFile(major).then(file => cache.indexBufferToObject(major, file, this));
			this.indices.set(major, index);
		}
		return index;
	}

	async getIndexFile(major: number) {
		let [row] = await this.prepareTable(major).tableready.then(q => q.getindex.run());
		let res = Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength);
		return decompress(res);
	}

	close() {
		this.dbfiles.forEach(file => file.table?.table.close());
		this.dbfiles.clear();
	}

	prepareTable(major: number) {
		let index = this.dbfiles.get(major);
		if (!index) {
			throw new Error(`no cache file for major ${major}`);
		}
		if (!index.table) {
			index.tableready = (async () => {
				let table = await AbstractSQLiteWorker.create(`js5-${major}.jcache`, index.file);
				let getfile = await table.prepare(`SELECT DATA,CRC FROM cache WHERE KEY=?`);
				let getindex = await table.prepare(`SELECT DATA FROM cache_index`);
				let cacheTableAccess: CacheTableAccess = { table, getfile, getindex };
				index.table = cacheTableAccess;
				return cacheTableAccess;
			})();
		}
		return index as CacheTable & { tableready: Promise<CacheTableAccess> };
	}
}