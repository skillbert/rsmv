import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseCacheIndex, parseMapsquareTiles, FileParser, parseModels, parseMapsquareUnderlays, parseSequences, parseMapsquareOverlays, parseMapZones, parseFrames, parseEnums, parseMapscenes, parseMapsquareLocations, parseFramemaps, parseAnimgroupConfigs, parseSpotAnims, parseRootCacheIndex, parseSkeletalAnim } from "../opdecoder";
import { achiveToFileId, CacheFileSource, CacheIndex, fileIdToArchiveminor, SubFile } from "../cache";
import { parseSprite } from "../3d/sprite";
import sharp from "sharp";
import { FlatImageData, Stream } from "../3d/utils";
import * as cache from "../cache";
import { GameCacheLoader } from "../cacheloader";
import { crc32_backward, forge } from "../libs/crc32util";
import { getDebug } from "../opcode_reader";
import { Downloader } from "../downloader";
import prettyJson from "json-stringify-pretty-compact";
import { framemaps } from "../../generated/framemaps";


type filerecord = { flags: boolean[], buf: Buffer, id: number, bitcount: number, flagstr: string };

async function start() {
	let cache = new GameCacheLoader();

	let flagfiles: Record<number, filerecord[]> = {};
	let flagcountfiles: Record<number, filerecord[]> = {};
	let allfiles: filerecord[] = [];

	let mats = await cache.getArchiveById(cacheMajors.materials, 0);
	for (let file of mats) {
		let str = new Stream(file.buffer);
		let version = str.readUByte();
		if (version == 0) { continue; }

		let flags = str.readUInt(true);

		let bits = 0;
		let flagarr: boolean[] = [];
		for (let i = 0; i < 32; i++) {
			let set = (flags & (1 << i)) != 0;
			flagarr.push(set);
			if (set) { bits++; }
		}
		let record: filerecord = {
			flags: flagarr,
			buf: file.buffer,
			id: file.fileid,
			bitcount: bits,
			flagstr: flagarr.join()
		};
		allfiles.push(record);
		flagarr.forEach((v, i) => {
			if (v) {
				let group = flagfiles[i] ?? [];
				group.push(record);
				flagfiles[i] = group;
			}
		})
		let countgroup = (flagcountfiles[bits] ?? []);
		countgroup.push(record);
		flagcountfiles[bits] = countgroup;
	}


	globalThis.flagfiles = flagfiles;
	globalThis.flagcountfiles = flagcountfiles;
	globalThis.allfiles = allfiles;

	globalThis.dumpfile = (files: filerecord[], subfolder = "0") => {
		let folder = `cache5/matdump/${subfolder}`;
		fs.mkdirSync(folder, { recursive: true });
		for (let file of files) {
			fs.writeFileSync(`${folder}/${file.id}.bin`, file.buf);
		}
	}
	globalThis.dumpflag = (bitid: number) => {
		let w = allfiles.filter(q => !q.flags[bitid]).sort((a, b) => a.bitcount - b.bitcount);
		for (let i = 0; i < w.length; i++) {
			let temp1 = w[i].flags.map((q, i) => (i == bitid ? true : q)).join();
			var matchtrue = allfiles.filter(q => q.flagstr == temp1);
			var matchfalse = allfiles.filter(q => q.flagstr == w[i].flagstr);
			if (matchtrue.length > 3 && matchfalse.length > 3) {
				break;
			}
		}
		if (matchtrue!.length > 3 && matchfalse!.length > 3) {
			globalThis.dumpfile(matchtrue!, bitid + "true");
			globalThis.dumpfile(matchfalse!, bitid + "false");
		}
		return [matchtrue!.length, matchfalse!.length];
	}

	let modelindex = await cache.getIndexFile(cacheMajors.models);
	let mattomodels: Record<number, { id: number, submesh: number }[]> = {};
	let a = 0;
	for (let modelid of modelindex) {
		let file = await cache.getFile(modelid.major, modelid.minor, modelid.crc);
		let parsed = parseModels.read(file);
		for (let [meshid, mesh] of parsed.meshes.entries()) {
			let group = mattomodels[mesh.materialArgument - 1] ?? [];
			group.push({ id: modelid.minor, submesh: meshid });
			mattomodels[mesh.materialArgument - 1] = group;
		}
	}
	let locindex = await cache.getIndexFile(cacheMajors.objects);
	let modeltoloc: Record<number, { locid: number, typenr: number, modelnr: number }[]> = {};
	for (let locid of locindex) {
		let arch = await cache.getFileArchive(locid);
		for (let file of arch) {
			let parsed = parseObject.read(file.buffer);
			for (let [typenr, modelgroup] of (parsed.models ?? []).entries()) {
				for (let [modelnr, modelid] of modelgroup.values.entries()) {
					let group = modeltoloc[modelid] ?? [];
					group.push({ locid: achiveToFileId(locid.major, locid.minor, file.fileid), modelnr, typenr });
					modeltoloc[modelid] = group;
				}
			}
		}
	}
	globalThis.modeltoloc = modeltoloc;
	globalThis.mattomodels = mattomodels;

	let mattoloc: Record<number, { locid: number, typenr: number, modelnr: number, submeshnr: number }[]> = {};

	for (let [matid, models] of Object.entries(mattomodels)) {
		let group = mattoloc[+matid] ?? [];
		for (let model of models) {
			let locs = modeltoloc[model.id];
			if (locs) { group.push(...locs.map(q => ({ ...q, submeshnr: model.submesh }))); }
		}
		mattoloc[+matid] = group;
	}

	fs.writeFileSync(`cache5/mattolocsdump.json`, prettyJson(mattoloc));
}
start();
setTimeout(() => { }, 100000000);