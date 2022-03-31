import * as cache from "./cache";
import { compressSqlite, decompress, decompressSqlite } from "./decompress";
import * as path from "path";
//only type info, import the actual thing at runtime so it can be avoided if not used
import type * as sqlite3 from "sqlite3";
import * as fs from "fs";
import { cacheMajors } from "./constants";
import { CacheIndex } from "./cache";

type CacheTable = {
	db: sqlite3.Database | null,
	indices: Promise<cache.CacheIndexFile>,
	getFile: (minor: number) => Promise<{ DATA: Buffer, CRC: number }>,
	getIndexFile: () => Promise<{ DATA: Buffer, CRC: number }>
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

	async generateRootIndex() {
		let files = fs.readdirSync(path.resolve(this.cachedir));
		console.log("using generated cache index file meta, crc size and version missing");

		let majors: CacheIndex[] = [];
		for (let file of files) {
			let m = file.match(/js5-(\d+)\.jcache$/);
			if (m) {
				majors.push({
					major: cacheMajors.index,
					minor: +m[1],
					crc: 0,
					size: 0,
					subindexcount: 1,
					subindices: [0],
					version: 0,
					uncompressed_crc: 0,
					uncompressed_size: 0
				});
			}
		}

		return majors.sort((a, b) => a.minor - b.minor);
	}

	openTable(major: number) {
		let sqlite = require("sqlite3") as typeof import("sqlite3");
		if (!this.opentables.get(major)) {
			let db: CacheTable["db"] = null;
			let indices: CacheTable["indices"];
			let getFile: CacheTable["getFile"];
			let getIndexFile: CacheTable["getIndexFile"];

			if (major == cacheMajors.index) {
				indices = this.generateRootIndex();
				getFile = (minor) => this.openTable(minor).getIndexFile();
				getIndexFile = () => { throw new Error("root index file no accesible for sqlite cache"); }
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
				getFile = (minor) => dbget(`SELECT DATA,CRC FROM cache WHERE KEY=?`, [minor]);
				getIndexFile = () => dbget(`SELECT DATA FROM cache_index`, []);
				indices = getIndexFile().then(row => {
					return cache.indexBufferToObject(major, decompressSqlite(Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength)));
				});
			}
			this.opentables.set(major, { db, getFile, getIndexFile, indices });
		}
		return this.opentables.get(major)!;
	}

	async getFile(major: number, minor: number, crc?: number) {
		if (major == cacheMajors.index) { return this.getIndex(minor); }
		let { getFile } = this.openTable(major);
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

	// writeFile(major: number, minor: number, file: Buffer) {
	// 	let { dbrun } = this.openTable(major);
	// 	let compressed = compressSqlite(file, "zlib");
	// 	return dbrun("UPDATE `cache` SET `DATA`=? WHERE `KEY`=?", [compressed, minor]);
	// }

	// writeFileArchive(index: cache.CacheIndex, files: Buffer[]) {
	// 	let arch = cache.packSqliteBufferArchive(files);
	// 	return this.writeFile(index.major, index.minor, arch);
	// }

	async getIndexFile(major: number) {
		return this.openTable(major).indices;
	}

	async getIndex(major: number) {
		let row = await this.openTable(major).getIndexFile();
		let file = Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength);
		return decompressSqlite(file);
	}

	close() {
		for (let table of this.opentables.values()) {
			table.db?.close();
		}
	}
}
