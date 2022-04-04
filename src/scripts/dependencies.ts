import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseCacheIndex, parseMapsquareTiles, FileParser, parseModels, parseMapsquareUnderlays, parseSequences, parseMapsquareOverlays, parseMapZones, parseFrames, parseEnums, parseMapscenes, parseMapsquareLocations, parseFramemaps, parseAnimgroupConfigs, parseSpotAnims, parseRootCacheIndex, parseSkeletalAnim, parseMaterials } from "../opdecoder";
import { archiveToFileId, CacheFileSource, CacheIndex, fileIdToArchiveminor, SubFile } from "../cache";
import { defaultMorphId } from "../3d/mapsquare";
import { convertMaterial } from "../3d/jmat";




export type DepTypes = "material" | "model" | "item" | "loc" | "mapsquare" | "sequence" | "skeleton" | "frameset" | "animgroup" | "npc" | "framebase" | "texture" | "enum";

type DepCallback = (holdertype: DepTypes, holderId: number, deptType: DepTypes, depId: number) => void;
type DepCollector = (cache: CacheFileSource, addDep: DepCallback) => Promise<void>;

async function mapsquareDeps(cache: CacheFileSource, addDep: DepCallback) {
	let mapsquareindices = await cache.getIndexFile(cacheMajors.mapsquares);
	for (let square of mapsquareindices) {
		if (!square) { continue; }
		let locsconfig = square.subindices.indexOf(cacheMapFiles.locations);
		if (locsconfig != -1) {
			let arch = await cache.getFileArchive(square);
			let locs = parseMapsquareLocations.read(arch[locsconfig].buffer);
			for (let loc of locs.locations) {
				addDep("loc", loc.id, "mapsquare", square.minor);
			}
		}
	}
}


async function sequenceDeps(cache: CacheFileSource, addDep: DepCallback) {
	let seqindices = await cache.getIndexFile(cacheMajors.sequences);
	for (let index of seqindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);
		for (let file of arch) {
			let id = archiveToFileId(index.major, index.minor, file.fileid);
			let seq = parseSequences.read(file.buffer);
			if (seq.skeletal_animation) {
				addDep("skeleton", seq.skeletal_animation, "sequence", id);
			}
			if (seq.frames && seq.frames.length != 0) {
				addDep("frameset", seq.frames[0].frameidhi, "sequence", id);
			}
		}
	}
}
async function locationDeps(cache: CacheFileSource, addDep: DepCallback) {
	let locindices = await cache.getIndexFile(cacheMajors.objects);
	for (let index of locindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			let loc = parseObject.read(file.buffer);
			let id = archiveToFileId(index.major, index.minor, file.fileid);
			if (loc.probably_animation) {
				addDep("sequence", loc.probably_animation, "loc", id);
			}
			if (loc.models) {
				for (let group of loc.models) {
					for (let model of group.values) {
						addDep("model", model, "loc", id);
					}
				}
			}
			if (loc.morphs_1 || loc.morphs_2) {
				let morphid = defaultMorphId(loc);
				if (morphid != -1) {
					addDep("loc", morphid, "loc", id);
				}
			}
		}
	}
}
async function itemDeps(cache: CacheFileSource, addDep: DepCallback) {
	let itemindices = await cache.getIndexFile(cacheMajors.items);
	for (let index of itemindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			let item = parseItem.read(file.buffer);
			let id = archiveToFileId(index.major, index.minor, file.fileid);
			let models: number[] = ([] as (number | undefined | null)[]).concat(
				item.baseModel,
				item.maleModels_0, item.maleModels_1, item.maleModels_2,
				item.femaleModels_0, item.femaleModels_1, item.femaleModels_2,
				item.maleHeads_0, item.maleHeads_1, item.femaleHeads_0, item.femaleHeads_1
			).filter(q => typeof q == "number") as any;
			for (let model of models) {
				addDep("model", model, "item", id);
			}
			if (item.noteTemplate) {
				addDep("item", item.noteTemplate, "item", id);
			}
		}
	}
}
async function animgroupDeps(cache: CacheFileSource, addDep: DepCallback) {
	let animgroupfiles = await cache.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
	for (let file of animgroupfiles) {
		let animgroup = parseAnimgroupConfigs.read(file.buffer);
		let anim = animgroup.unknown_26 ?? animgroup.unknown_01?.[1];
		if (anim) {
			addDep("sequence", anim, "animgroup", file.fileid);
		}
	}
}
async function materialDeps(cache: CacheFileSource, addDep: DepCallback) {
	let npcindices = await cache.getIndexFile(cacheMajors.materials);
	for (let index of npcindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			let mat = convertMaterial(file.buffer);
			for (let tex of Object.values(mat.textures)) {
				if (typeof tex == "number") {
					addDep("texture", tex, "material", file.fileid)
				}
			}
		}
	}
}
async function npcDeps(cache: CacheFileSource, addDep: DepCallback) {
	let npcindices = await cache.getIndexFile(cacheMajors.npcs);
	for (let index of npcindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			let id = archiveToFileId(index.major, index.minor, file.fileid);
			let npc = parseNpc.read(file.buffer)
			if (npc.animation_group) {
				addDep("animgroup", npc.animation_group, "npc", id);
			}
			if (npc.models) {
				for (let model of npc.models) {
					addDep("model", model, "npc", id);
				}
			}
			if (npc.headModels) {
				for (let model of npc.headModels) {
					addDep("model", model, "npc", id);
				}
			}
		}
	}
}
async function skeletonDeps(cache: CacheFileSource, addDep: DepCallback) {
	let skelindices = await cache.getIndexFile(cacheMajors.skeletalAnims);
	for (let skelindex of skelindices) {
		if (!skelindex) { continue; }
		let file = await cache.getFile(skelindex.major, skelindex.minor, skelindex.crc);
		let skel = parseSkeletalAnim.read(file);
		addDep("framebase", skel.framebase, "skeleton", skelindex.minor);
	}
}

async function framesetDeps(cache: CacheFileSource, addDep: DepCallback) {
	let framesetindices = await cache.getIndexFile(cacheMajors.frames);
	for (let index of framesetindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);
		if (arch.length != 0) {
			let frame0 = parseSkeletalAnim.read(arch[0].buffer);
			addDep("framebase", frame0.framebase, "frameset", index.minor);
		}
	}
}

async function modelDeps(cache: CacheFileSource, addDep: DepCallback) {
	let modelindices = await cache.getIndexFile(cacheMajors.models);
	for (let modelindex of modelindices) {
		if (!modelindex) { continue; }
		let file = await cache.getFile(modelindex.major, modelindex.minor, modelindex.crc);
		let model = parseModels.read(file);
		for (let mesh of model.meshes) {
			if (mesh.materialArgument != 0) {
				addDep("material", mesh.materialArgument - 1, "model", modelindex.minor);
			}
		}
	}
}

export async function getDependencies(cache: CacheFileSource) {

	let dependencyMap = new Map<string, string[]>();
	let addDep = (holdertype: DepTypes, holderId: number, deptType: DepTypes, depId: number) => {
		let holder = `${holdertype}-${holderId}`;
		let newdep = `${deptType}-${depId}`;
		let deps = dependencyMap.get(holder);
		if (!deps) {
			deps = [];
			dependencyMap.set(holder, deps);
		}
		if (deps.indexOf(newdep) == -1) { deps.push(newdep); }
	}

	globalThis.dependencyMap = dependencyMap;

	let runs: DepCollector[] = [
		mapsquareDeps,
		sequenceDeps,
		locationDeps,
		itemDeps,
		animgroupDeps,
		materialDeps,
		npcDeps,
		skeletonDeps,
		framesetDeps,
		// modelDeps
	];

	for (let run of runs) {
		console.log(`starting ${run.name}`);
		let t = Date.now();
		await run(cache, addDep);
		console.log(`finished ${run.name}, duration ${((Date.now() - t) / 1000).toFixed(1)}`);
	}
}

let cmd2 = command({
	name: "run",
	args: {
		...filesource
	},
	handler: async (args) => {
		let cache = await args.source();
		getDependencies(cache);
	}
});

// run(cmd2, cliArguments());

// setTimeout(() => { }, 10000000);