import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseCacheIndex, parseMapsquareTiles, FileParser, parseModels, parseMapsquareUnderlays, parseSequences, parseMapsquareOverlays, parseMapZones, parseFrames, parseEnums, parseMapscenes, parseMapsquareLocations, parseFramemaps, parseAnimgroupConfigs, parseSpotAnims, parseRootCacheIndex, parseSkeletalAnim } from "../opdecoder";
import { archiveToFileId, CacheFileSource, CacheIndex, fileIdToArchiveminor, SubFile } from "../cache";
import { GameCacheLoader } from "../cache/sqlite";


//currently unused, this script was used to find skeletal animations simple enough to decode


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

async function loadSkeletons() {
	let source = new GameCacheLoader();

	let skelindex = await source.getIndexFile(cacheMajors.skeletalAnims);

	let files: Buffer[] = [];
	for (let index of skelindex) {
		if (!index) { continue; }
		if (files.length % 50 == 0) { console.log(files.length); }
		files.push(await source.getFile(index.major, index.minor, index.crc));
	}

	return function* () {
		for (let file of files) {
			yield parseSkeletalAnim.read(file);
		}
	}
};
globalThis.loadSkeletons = loadSkeletons;

async function render() {
	let skelfiles = await loadSkeletons()
	let points: number[] = [];
	for (let skel of skelfiles()) {
		for (let track of skel.tracks) {
			if (track.type_0to9 >= 1 && track.type_0to9 <= 3) {
				points.push(...track.chunks.flatMap(q => q.value[0]))
			}
		}
	}
	let min = Infinity, max = -Infinity;
	for (let p of points) { min = Math.min(min, p); max = Math.max(max, p) }
	let n = 21;
	let start = -10;
	let end = 10;
	let size = (end - start) / (n - 1);
	let buckets = new Array(n).fill(0);
	let misses = 0;
	for (let p of points) {
		let i = Math.floor((p - start) / size);
		if (i >= 0 && i < n) { buckets[i]++; }
		else { misses++; }
	}
	console.log("min", min);
	console.log("max", max);
	console.log("misses", misses);
	buckets.forEach((n, i) => console.log((i * size + start).toFixed(1), n))
}