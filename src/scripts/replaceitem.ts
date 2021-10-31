import { compressSqlite, decompressSqlite } from "../decompress";
import * as path from "path";
import { promisify } from "util";
import * as cache from "../cache";
import { promises as fs } from "fs";
import { parseItem } from "../opdecoder";
import * as opdecoder from "../opdecoder";

//TODO move to new cli parser

async function run(cachedir: string, jsondir: string, replaceid: number) {
	const indexid = 19;
	let sqlite = require("sqlite3") as typeof import("sqlite3");
	let db = new sqlite.Database(path.resolve(cachedir, `js5-${indexid}.jcache`), sqlite.OPEN_READWRITE);
	await new Promise(done => db.once("open", done));
	let dbget = promisify<string, any, any>(db.get.bind(db));
	let dbrun = promisify<string, any, any>(db.run.bind(db));
	let row = await dbget(`SELECT DATA FROM cache_index`, []);
	let metaindex = decompressSqlite(Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength));
	let index = cache.indexBufferToObject(indexid, metaindex);
	let getfile = async (index: cache.CacheIndex) => {
		let row = await dbget(`SELECT DATA FROM cache WHERE KEY=?`, [index.minor]);
		return Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength);
	};

	for (let chunk of index) {
		let needsreplace = chunk.subindices.findIndex(q => q == replaceid) != -1;
		if (!needsreplace) { continue; }

		let rawfile = await getfile(chunk);
		let archive = decompressSqlite(rawfile);
		let files = cache.unpackSqliteBufferArchive(archive, chunk.subindices.length).map(f => f.buffer);

		for (let i = 0; i < chunk.subindices.length; i++) {
			let itemid = chunk.subindices[i];
			if (itemid == replaceid) {
				let jsonfile = JSON.parse(await fs.readFile(path.resolve(jsondir, `${itemid}.json`), "utf-8"))

				let newfile = parseItem.write(jsonfile);
				files[i] = newfile;
				console.log("file built");
			}
		}
		let packed = cache.packSqliteBufferArchive(files);
		//return;
		console.log("packed");
		let newfile = compressSqlite(packed, "zlib");
		console.log("compressed");
		console.log("INSERT OR REPLACE INTO cache(KEY,DATA,CRC,VERSION) VALUES(?,?,?,?)");
		console.log([chunk.minor, chunk.crc, chunk.version]);
		await fs.writeFile(path.resolve(cachedir, `replace-${chunk.major}-${chunk.minor}-old.bin`), rawfile);
		await fs.writeFile(path.resolve(cachedir, `replace-${chunk.major}-${chunk.minor}-new.bin`), newfile);
		//debugger;
		await dbrun("UPDATE `cache` SET `DATA`=? WHERE `KEY`=?", [newfile, chunk.minor]);
	}
	db.close();
}



let [cachedir, jsondir, id] = process.argv.slice(2);
if (typeof cachedir != "string" || typeof jsondir != "string" || isNaN(+id)) { throw new Error("usage node replaceitem (cachedir) (jsondir) (itemid)"); }
(async () => {
	await run(cachedir, jsondir, +id);
})()
