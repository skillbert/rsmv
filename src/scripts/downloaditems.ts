import * as downloader from "../downloader";
import * as cache from "../cache";
import { decompress, decompressSqlite } from "../decompress";
import * as fs from "fs";
import { handle as parseItem } from "../handler_items";
import { handle as parseNpc } from "../handler_npcs";
import { handle as parseObject } from "../handler_objects";
import * as path from "path";
import { promisify } from "util";
import { sqlite3 } from "sqlite3";

const modes = {
	items: { folder: "items", index: 19, parser: parseItem },
	npcs: { folder: "npcs", index: 18, parser: parseNpc },
	objects: { folder: "objects", index: 16, parser: parseObject },
}


export async function run(outdir: string, modename: keyof typeof modes, cachedir?: string,minorindex?:number) {
	let mode = modes[modename];

	let metaindex: Buffer;
	let getfile: (index: cache.CacheIndex) => Promise<cache.SubFile[]>;
	let close: () => void;
	if (cachedir) {
		let sqlite = require("sqlite3") as typeof import("sqlite3");
		let db = new sqlite.Database(path.resolve(cachedir, `js5-${mode.index}.jcache`), sqlite.OPEN_READONLY);
		await new Promise(done => db.once("open", done));
		let dbget = promisify<string, any, any>(db.get.bind(db));
		let row = await dbget(`SELECT DATA FROM cache_index`, []);
		metaindex = decompressSqlite(Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength));
		getfile = async (index) => {
			let row = await dbget(`SELECT DATA FROM cache WHERE KEY=?`, [index.minor]);
			return cache.unpackSqliteBufferArchive(decompressSqlite(Buffer.from(row.DATA.buffer, row.DATA.byteOffset, row.DATA.byteLength)), index.subindices.length);
		};
		close = () => db.close();
	} else {
		await downloader.prepare(outdir);
		metaindex = decompress(await downloader.download(255, 255));
		var indices = cache.rootIndexBufferToObject(metaindex);
		let index = indices[mode.index];
		metaindex = decompress(await downloader.download(index.major, index.minor, index.crc));
		getfile = async (index) => {
			return cache.unpackBufferArchive(decompress(await downloader.download(index.major, index.minor, index.crc)), index.subindices.length);
		}
		close = () => downloader.close();
	}
	var recordIndices = cache.indexBufferToObject(mode.index, metaindex);

	for (let recordIndex of recordIndices) {
		if((typeof minorindex!="number"||!isNaN(minorindex)) && recordIndex.minor!=minorindex){continue;}
		let chunks = await getfile(recordIndex);
		for (let i = 0; i < chunks.length; i++) {
			let json = mode.parser(null as any, chunks[i].buffer);
			fs.writeFileSync(`${outdir}/${mode.folder}/${recordIndex.subindices[i]}.json`, JSON.stringify(json, undefined, "\t"));
		}
	}
	close();
	console.log(recordIndices.length, recordIndices.length * 256);
}

let [modename,cachedir,minorindex] = process.argv.slice(2);
if (!modes[modename]) {
	throw new Error(`mode ${modename} not found, usage node downloaditems (npcs|items|objects|...) [nxtcachedir] [minorindex]`);
}
run(`${__dirname}/`, modename as any, cachedir,+minorindex);