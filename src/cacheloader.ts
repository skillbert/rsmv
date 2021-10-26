import { CacheFileSource } from "./main";
import * as cache from "./cache";
import { decompress, decompressSqlite } from "./decompress";
import * as path from "path";
//only type info, import the actual thing at runtime so it can be avoided if not used
import type * as sqlite3 from "sqlite3";
import { cacheMajors } from "./constants";

type CacheTable = {
	db: sqlite3.Database,
	ready: Promise<void>,
	indices: Promise<cache.CacheIndex[]>,
	dbget: (q: string, params: any[]) => Promise<any>
}

export class GameCacheLoader implements CacheFileSource {
	cachedir: string;
	opentables = new Map<number, CacheTable>();

	constructor(cachedir: string) {
		this.cachedir = cachedir;
	}

	openTable(major: number) {
		let sqlite = require("sqlite3") as typeof import("sqlite3");
		if (!this.opentables.get(major)) {
			let db = new sqlite.Database(path.resolve(this.cachedir, `js5-${major}.jcache`), sqlite.OPEN_READONLY);
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
			let indices = dbget(`SELECT DATA FROM cache_index`, []).then(row => {
				return cache.indexBufferToObject(major, decompressSqlite(Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength)));
			})
			this.opentables.set(major, { db, ready, dbget, indices });
		}
		return this.opentables.get(major)!;
	}

	async getFile(major: number, minor: number) {
		let { dbget } = this.openTable(major);
		let row = await dbget(`SELECT DATA FROM cache WHERE KEY=?`, [minor]);
		return decompressSqlite(Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength));
	}

	async getFileArchive(major: number, minor: number, nfiles: number) {
		return cache.unpackSqliteBufferArchive(await this.getFile(major, minor), nfiles);
	}

	async getFileById(major: number, fileid: number) {
		let { indices } = this.openTable(major);

		let holder = (await indices).find(q => q.subindices.includes(fileid));
		if (!holder) { throw new Error("file not found"); }
		let files = await this.getFileArchive(holder.major, holder.minor, holder.subindexcount);
		let file = files[holder.subindices.indexOf(fileid)].buffer;
		//TODO remove this hardcoded path
		if (major == cacheMajors.textures) {
			return file.slice(5);
		}
		return file;
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
