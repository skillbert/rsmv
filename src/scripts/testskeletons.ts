import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseCacheIndex, parseMapsquareTiles, FileParser, parseModels, parseMapsquareUnderlays, parseSequences, parseMapsquareOverlays, parseMapZones, parseFrames, parseEnums, parseMapscenes, parseMapsquareLocations, parseFramemaps, parseAnimgroupConfigs, parseSpotAnims, parseRootCacheIndex, parseSkeletalAnim } from "../opdecoder";
import { archiveToFileId, CacheFileSource, CacheIndex, fileIdToArchiveminor, SubFile } from "../cache";
import { parseSprite } from "../3d/sprite";
import sharp from "sharp";
import { FlatImageData } from "../3d/utils";
import * as cache from "../cache";
import { GameCacheLoader } from "../cacheloader";
import { crc32_backward, forge } from "../libs/crc32util";
import { getDebug } from "../opcode_reader";
import { Downloader } from "../downloader";
import prettyJson from "json-stringify-pretty-compact";
import { framemaps } from "../../generated/framemaps";




async function start() {
	let cache = new GameCacheLoader();


	let seqindices = await cache.getIndexFile(cacheMajors.sequences);
	let skeltoseqs = new Map<number, number[]>();
	for (let index of seqindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);
		for (let file of arch) {
			let seq = parseSequences.read(file.buffer)
			if (seq.skeletal_animation) {
				let seqarr = skeltoseqs.get(seq.skeletal_animation) ?? [];
				seqarr.push(archiveToFileId(index.major, index.minor, file.fileid));
				skeltoseqs.set(seq.skeletal_animation, seqarr);
			}
		}
	}
	let locindices = await cache.getIndexFile(cacheMajors.objects);
	let seqtolocs = new Map<number, number[]>();
	for (let index of locindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			let seq = parseObject.read(file.buffer)
			if (seq.probably_animation) {
				let loc = seqtolocs.get(seq.probably_animation) ?? [];
				loc.push(archiveToFileId(index.major, index.minor, file.fileid));
				seqtolocs.set(seq.probably_animation, loc);
			}
		}
	}
	let animgroupfiles = await cache.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
	let seqtogroups = new Map<number, number[]>();
	for (let file of animgroupfiles) {
		let animgroup = parseAnimgroupConfigs.read(file.buffer);
		let anim = animgroup.unknown_26 ?? animgroup.baseAnims?.idle;
		if (anim) {
			let animarr = seqtogroups.get(anim) ?? [];
			animarr.push(file.fileid);
			seqtogroups.set(anim, animarr);
		}
	}

	let npcindices = await cache.getIndexFile(cacheMajors.npcs);
	let groupstonpcs = new Map<number, number[]>();
	for (let index of npcindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			let seq = parseNpc.read(file.buffer)
			if (seq.animation_group) {
				let npc = groupstonpcs.get(seq.animation_group) ?? [];
				npc.push(archiveToFileId(index.major, index.minor, file.fileid));
				groupstonpcs.set(seq.animation_group, npc);
			}
		}
	}

	let skelindices = await cache.getIndexFile(cacheMajors.skeletalAnims);
	skelindices.sort((a, b) => a.size! - b.size!);
	for (let skelindex of skelindices) {
		if (!skelindex) { continue; }
		let seqs = skeltoseqs.get(skelindex.minor);
		if (!seqs) { console.log("skeleton", skelindex.minor, "has no sequence"); continue; }
		for (let seq of seqs) {
			let locs = seqtolocs.get(seq) ?? [];
			let npcs = (seqtogroups.get(seq) ?? []).flatMap(gr => groupstonpcs.get(gr) ?? []);

			console.log("skeleton", skelindex.minor, skelindex.size, "locs", ...locs, "npcs", ...npcs);
		}
	}
}
start();