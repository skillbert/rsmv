import * as downloader from "../downloader";
import * as cache from "../cache";
import * as fs from "fs";
import { handle as parseItem } from "../handler_items";
import { handle as parseNpc } from "../handler_npcs";
import { handle as parseObject } from "../handler_objects";
import { CacheFileSource } from "../main";
import { GameCacheLoader } from "cacheloader";

const modes = {
	items: { folder: "items", index: 19, parser: parseItem },
	npcs: { folder: "npcs", index: 18, parser: parseNpc },
	objects: { folder: "objects", index: 16, parser: parseObject },
}

export async function run(outdir: string, modename: keyof typeof modes, cachedir?: string, minorindex?: number) {
	let mode = modes[modename];

	let metaindex: Buffer;
	let source: CacheFileSource;
	if (cachedir) {
		source = new GameCacheLoader(cachedir);
		metaindex = await (source as GameCacheLoader).getIndex(mode.index);
	} else {
		source = new downloader.Downloader(outdir);
		var indexFiles = cache.rootIndexBufferToObject(await source.getFile(255, 255));
		let index = indexFiles[mode.index];
		metaindex = await source.getFile(index.major, index.minor, index.crc);
	}
	var recordIndices = cache.indexBufferToObject(mode.index, metaindex);

	for (let recordIndex of recordIndices) {
		if ((typeof minorindex != "number" || !isNaN(minorindex)) && recordIndex.minor != minorindex) { continue; }
		let chunks = await source.getFileArchive(recordIndex);
		for (let i = 0; i < chunks.length; i++) {
			let json = mode.parser(null as any, chunks[i].buffer);
			fs.writeFileSync(`${outdir}/${mode.folder}/${recordIndex.subindices[i]}.json`, JSON.stringify(json, undefined, "\t"));
		}
	}
	source.close();
	console.log(recordIndices.length, recordIndices.length * 256);
}

let [modename, cachedir, minorindex] = process.argv.slice(2);
if (!modes[modename]) {
	throw new Error(`mode ${modename} not found, usage node downloaditems (npcs|items|objects|...) [nxtcachedir] [minorindex]`);
}
run(`${__dirname}/`, modename as any, cachedir, +minorindex);