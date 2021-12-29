import * as cache from "./cache";
import { compressSqlite, decompress, decompressSqlite } from "./decompress";
import * as path from "path";
//only type info, import the actual thing at runtime so it can be avoided if not used
import type * as sqlite3 from "sqlite3";
import { crc32 } from "crc";

type CacheTable = {
	db: sqlite3.Database,
	ready: Promise<void>,
	indices: Promise<cache.CacheIndexFile>,
	dbget: (q: string, params: any[]) => Promise<any>,
	dbrun: (q: string, params: any[]) => Promise<any>
}

export class GameCacheLoader extends cache.CacheFileSource {
	cachedir: string;
	writable: boolean;
	opentables = new Map<number, CacheTable>();

	constructor(cachedir: string, writable?: boolean) {
		super();
		this.cachedir = cachedir;
		this.writable = !!writable;
	}

	openTable(major: number) {
		let sqlite = require("sqlite3") as typeof import("sqlite3");
		if (!this.opentables.get(major)) {
			let db = new sqlite.Database(path.resolve(this.cachedir, `js5-${major}.jcache`), this.writable ? sqlite.OPEN_READWRITE : sqlite.OPEN_READONLY);
			let ready = new Promise<void>(done => db.once("open", done));
			let dbget = async (query: string, args: any[]) => {
				await ready;
				return new Promise<any>((resolve, reject) => {
					db.get(query, args, (err, row) => {
						if (err) { reject(err); }
						else { resolve(row); }
					})
				})
			}
			let dbrun = async (query: string, args: any[]) => {
				await ready;
				return new Promise<any>((resolve, reject) => {
					db.run(query, args, (err, res) => {
						if (err) { reject(err); }
						else { resolve(res); }
					})
				})
			}
			let indices = dbget(`SELECT DATA FROM cache_index`, []).then(row => {
				return cache.indexBufferToObject(major, decompressSqlite(Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength)));
			});

			this.opentables.set(major, { db, ready, dbget, dbrun, indices });
		}
		return this.opentables.get(major)!;
	}

	async getFile(major: number, minor: number, crc?: number) {
		let { dbget } = this.openTable(major);
		let row = await dbget(`SELECT DATA,CRC FROM cache WHERE KEY=?`, [minor]);
		if (typeof crc == "number" && row.CRC != crc) {
			//TODO this is always off by either 1 or 2
			// console.log(`crc from cache (${row.CRC}) did not match requested crc (${crc}) for ${major}.${minor}`);
		}
		let file = Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength);
		let res = decompressSqlite(file);
		return res;
	}

	async getFileArchive(index: cache.CacheIndex) {
		let arch = await this.getFile(index.major, index.minor, index.crc);
		let res = cache.unpackSqliteBufferArchive(arch, index.subindexcount);
		return res;
	}

	writeFile(major: number, minor: number, file: Buffer) {
		let { dbrun } = this.openTable(major);
		let compressed = compressSqlite(file, "zlib");
		return dbrun("UPDATE `cache` SET `DATA`=? WHERE `KEY`=?", [compressed, minor]);
	}

	writeFileArchive(index: cache.CacheIndex, files: Buffer[]) {
		let arch = cache.packSqliteBufferArchive(files);
		return this.writeFile(index.major, index.minor, arch);
	}

	async getIndexFile(major: number) {
		return this.openTable(major).indices;
	}

	async getIndex(major: number) {
		let { dbget } = this.openTable(major);
		let row = await dbget(`SELECT DATA FROM cache_index`, []);
		return decompressSqlite(Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength));
	}

	close() {
		for (let table of this.opentables.values()) {
			table.db.close();
		}
	}
}
