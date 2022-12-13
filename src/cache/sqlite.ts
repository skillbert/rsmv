import * as cache from "./index";
import { compressSqlite, decompress, decompressSqlite } from "./compression";
import { cacheMajors } from "../constants";
import { CacheIndex } from "./index";
//only type info, import the actual thing at runtime so it can be avoided if not used
import type * as sqlite3 from "sqlite3";

//make this conditional nodejs require so it can be loaded (but not run) in browsers
if (typeof __non_webpack_require__ != "undefined") {
	var path = __non_webpack_require__("path") as typeof import("path");
	var fs = __non_webpack_require__("fs") as typeof import("fs");
}

type CacheTable = {
	db: sqlite3.Database | null,
	indices: Promise<cache.CacheIndexFile>,
	readFile: (minor: number) => Promise<{ DATA: Buffer, CRC: number }>,
	updateFile: (minor: number, data: Buffer) => Promise<void>,
	readIndexFile: () => Promise<{ DATA: Buffer, CRC: number }>
}

export class GameCacheLoader extends cache.CacheFileSource {
	cachedir: string;
	writable: boolean;
	opentables = new Map<number, CacheTable>();

	constructor(cachedir?: string, writable?: boolean) {
		super();
		this.cachedir = cachedir || path.resolve(process.env.ProgramData!, "jagex/runescape");
		this.writable = !!writable;
	}

	getCacheName() {
		return `sqlite:${this.cachedir}`;
	}

	async generateRootIndex() {
		let files = fs.readdirSync(path.resolve(this.cachedir));
		console.log("using generated cache index file meta, crc size and version missing");

		let majors: CacheIndex[] = [];
		for (let file of files) {
			let m = file.match(/js5-(\d+)\.jcache$/);
			if (m) {
				majors[m[1]] = {
					major: cacheMajors.index,
					minor: +m[1],
					crc: 0,
					size: 0,
					subindexcount: 1,
					subindices: [0],
					version: 0,
					uncompressed_crc: 0,
					uncompressed_size: 0
				};
			}
		}

		return majors;
	}

	openTable(major: number) {
		let sqlite = __non_webpack_require__("sqlite3") as typeof import("sqlite3");
		if (!this.opentables.get(major)) {
			let db: CacheTable["db"] = null;
			let indices: CacheTable["indices"];
			let getFile: CacheTable["readFile"];
			let writeFile: CacheTable["updateFile"];
			let getIndexFile: CacheTable["readIndexFile"];

			if (major == cacheMajors.index) {
				indices = this.generateRootIndex();
				getFile = (minor) => this.openTable(minor).readIndexFile();
				getIndexFile = () => { throw new Error("root index file no accesible for sqlite cache"); }
				writeFile = (minor, data) => { throw new Error("writing index files not supported"); }
			} else {
				db = new sqlite.Database(path.resolve(this.cachedir, `js5-${major}.jcache`), this.writable ? sqlite.OPEN_READWRITE : sqlite.OPEN_READONLY);
				let ready = new Promise<void>(done => db!.once("open", done));
				let dbget = async (query: string, args: any[]) => {
					await ready;
					return new Promise<any>((resolve, reject) => {
						db!.get(query, args, (err, row) => {
							if (err) { reject(err); }
							else { resolve(row); }
						})
					})
				}
				let dbrun = async (query: string, args: any[]) => {
					await ready;
					return new Promise<any>((resolve, reject) => {
						db!.run(query, args, (err, res) => {
							if (err) { reject(err); }
							else { resolve(res); }
						})
					})
				}
				writeFile = (minor, data) => dbrun(`UPDATE cache SET DATA=? WHERE KEY=?`, [data, minor]);
				getFile = (minor) => dbget(`SELECT DATA,CRC FROM cache WHERE KEY=?`, [minor]);
				getIndexFile = () => dbget(`SELECT DATA FROM cache_index`, []);
				indices = getIndexFile().then(row => {
					return cache.indexBufferToObject(major, decompressSqlite(Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength)));
				});
			}
			this.opentables.set(major, { db, readFile: getFile, updateFile: writeFile, readIndexFile: getIndexFile, indices });
		}
		return this.opentables.get(major)!;
	}

	async getFile(major: number, minor: number, crc?: number) {
		if (major == cacheMajors.index) { return this.getIndexFile(minor); }
		let { readFile: getFile } = this.openTable(major);
		let row = await getFile(minor);
		if (typeof crc == "number" && row.CRC != crc) {
			//TODO this is always off by either 1 or 2
			// console.log(`crc from cache (${row.CRC}) did not match requested crc (${crc}) for ${major}.${minor}`);
		}
		let file = Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength);
		// console.log("size",file.byteLength);
		let res = decompressSqlite(file);
		return res;
	}

	async getFileArchive(index: cache.CacheIndex) {
		let arch = await this.getFile(index.major, index.minor, index.crc);
		let res = cache.unpackSqliteBufferArchive(arch, index.subindices);
		return res;
	}

	writeFile(major: number, minor: number, file: Buffer) {
		let table = this.openTable(major);
		let compressed = compressSqlite(file, "zlib");
		return table.updateFile(minor, compressed);
	}

	writeFileArchive(index: cache.CacheIndex, files: Buffer[]) {
		let arch = cache.packSqliteBufferArchive(files);
		return this.writeFile(index.major, index.minor, arch);
	}

	async getCacheIndex(major: number) {
		return this.openTable(major).indices;
	}

	async getIndexFile(major: number) {
		let row = await this.openTable(major).readIndexFile();
		let file = Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength);
		return decompressSqlite(file);
	}

	close() {
		for (let table of this.opentables.values()) {
			table.db?.close();
		}
	}
}
