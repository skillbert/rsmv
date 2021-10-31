import * as downloader from "../downloader";
import * as cache from "../cache";
import * as fs from "fs";
import { parseAchievement, parseItem, parseNpc, parseObject } from "../opdecoder";
import { CacheFileSource } from "../main";
import { GameCacheLoader } from "../cacheloader";
import { cacheMajors } from "../constants";

//TODO merge with downloadarchive.ts

const modes = {
	items: { folder: "items", index: cacheMajors.items, parser: parseItem },
	npcs: { folder: "npcs", index: cacheMajors.npcs, parser: parseNpc },
	objects: { folder: "objects", index: cacheMajors.objects, parser: parseObject },
	achievements: { folder: "achievements", index: cacheMajors.achievements, parser: parseAchievement },
}

export async function run(outdir: string, modename: keyof typeof modes, cachedir?: string, minorindex?: number) {
	let mode = modes[modename];

	let metaindex: Buffer;
	let source: CacheFileSource;
	if (cachedir) {
		source = new GameCacheLoader(cachedir);
		metaindex = await (source as GameCacheLoader).getIndex(mode.index);
	} else {
		source = new downloader.Downloader();
		var indexFiles = cache.rootIndexBufferToObject(await source.getFile(255, 255));
		let index = indexFiles[mode.index];
		metaindex = await source.getFile(index.major, index.minor, index.crc);
	}
	var recordIndices = cache.indexBufferToObject(mode.index, metaindex);

	for (let recordIndex of recordIndices) {
		if ((typeof minorindex != "number" || !isNaN(minorindex)) && recordIndex.minor != minorindex) { continue; }
		let chunks = await source.getFileArchive(recordIndex);
		for (let i = 0; i < chunks.length; i++) {
			try {
				var json = mode.parser.read(chunks[i].buffer);
			} catch (e) {
				console.log(e);
				process.stdin.read(1);
				continue;
			}
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