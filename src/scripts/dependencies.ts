// import { filesource, cliArguments } from "../cliparser";
// import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import { cacheConfigPages, cacheMajors, cacheMapFiles, lastLegacyBuildnr } from "../constants";
import { parse } from "../opdecoder";
import { archiveToFileId, iterateConfigFiles } from "../cache";
import { defaultMorphId, getMapsquareData, worldStride } from "../3d/mapsquare";
import { convertMaterial } from "../3d/jmat";
import { crc32 } from "../libs/crc32util";
import { arrayEnum } from "../utils";
import { EngineCache } from "../3d/modeltothree";
import { legacyMajors, legacyGroups } from "../cache/legacycache";

const depids = arrayEnum(["material", "model", "item", "loc", "mapsquare", "sequence", "skeleton", "frameset", "animgroup", "npc", "framebase", "texture", "enum"]);
const depidmap = Object.fromEntries(depids.map((q, i) => [q, i]));
export type DepTypes = typeof depids[number];

type DepCallback = (holdertype: DepTypes, holderId: number, deptType: DepTypes, depId: number) => void;
type HashCallback = (depType: DepTypes, depId: number, hash: number, version: number) => void;
type DepCollector = (cache: EngineCache, addDep: DepCallback, addHash: HashCallback) => Promise<void>;

const mapsquareDeps: DepCollector = async (cache, addDep, addHash) => {
	let mapsquareindices = await cache.getCacheIndex(cacheMajors.mapsquares);
	for (let square of mapsquareindices) {
		if (!square) { continue; }
		let locsconfig = square.subindices.indexOf(cacheMapFiles.locations);
		addHash("mapsquare", square.minor, square.crc, square.version);
		if (locsconfig != -1) {
			let arch = await cache.getFileArchive(square);
			let locs = parse.mapsquareLocations.read(arch[locsconfig].buffer, cache);
			for (let loc of locs.locations) {
				addDep("loc", loc.id, "mapsquare", square.minor);
			}
		}
	}
}

const mapsquareDeps2: DepCollector = async (cache, addDep, addHash) => {
	for (let z = 0; z < 200; z++) {
		for (let x = 0; x < 100; x++) {
			let squareindex = x + z * worldStride;
			let data = await getMapsquareData(cache, x, z);
			if (data) {
				addHash("mapsquare", squareindex, data.chunkfilehash, data.chunkfileversion);
				for (let loc of data.rawlocs) {
					addDep("loc", loc.id, "mapsquare", squareindex);
				}
			}
		}
	}
}

const sequenceDeps: DepCollector = async (cache, addDep, addHash) => {
	if (cache.getBuildNr() <= 484) {//unknown exact buildnr
		return;
	}
	let seqindices = await cache.getCacheIndex(cacheMajors.sequences);
	for (let index of seqindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);
		for (let file of arch) {
			let id = archiveToFileId(index.major, index.minor, file.fileid);
			addHash("sequence", id, crc32(file.buffer), index.version);
			let seq = parse.sequences.read(file.buffer, cache);
			if (seq.skeletal_animation) {
				addDep("skeleton", seq.skeletal_animation, "sequence", id);
			}
			if (seq.frames && seq.frames.length != 0) {
				addDep("frameset", seq.frames[0].frameidhi, "sequence", id);
			}
		}
	}
}

const locationDeps: DepCollector = async (cache, addDep, addHash) => {
	for await (let { id, file } of iterateConfigFiles(cache, cacheMajors.objects)) {
		addHash("loc", id, crc32(file), 0);
		let loc = parse.object.read(file, cache);
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
		if (loc.models_05) {
			for (let group of loc.models_05.models) {
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

const itemDeps: DepCollector = async (cache, addDep, addHash) => {
	for await (let { id, file } of iterateConfigFiles(cache, cacheMajors.items)) {
		addHash("item", id, crc32(file), 0);
		let item = parse.item.read(file, cache);
		let models: number[] = ([] as (number | undefined | null)[]).concat(
			item.baseModel,
			item.maleModels_0?.id, item.maleModels_1, item.maleModels_2,
			item.femaleModels_0?.id, item.femaleModels_1, item.femaleModels_2,
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
const animgroupDeps: DepCollector = async (cache, addDep, addHash) => {
	if (cache.getBuildNr() < 526) { return; }
	let animgroupfiles = await cache.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
	for (let file of animgroupfiles) {
		addHash("animgroup", file.fileid, crc32(file.buffer), 0);
		let animgroup = parse.animgroupConfigs.read(file.buffer, cache);
		let anim = animgroup.unknown_26 ?? animgroup.baseAnims?.idle;
		if (anim) {
			addDep("sequence", anim, "animgroup", file.fileid);
		}
	}
}
const materialDeps: DepCollector = async (cache, addDep, addHash) => {
	let indices = await cache.getCacheIndex(cacheMajors.materials);
	for (let index of indices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			addHash("material", file.fileid, crc32(file.buffer), index.version);
			let mat = convertMaterial(file.buffer, file.fileid, cache);
			for (let tex of Object.values(mat.textures)) {
				if (typeof tex == "number") {
					addDep("texture", tex, "material", file.fileid)
				}
			}
		}
	}
}

const materialDeps2: DepCollector = async (cache, addDep, addHash) => {
	//TODO id=-1 material??
	if (cache.getBuildNr() <= lastLegacyBuildnr) {
		let mats = await cache.getArchiveById(legacyMajors.data, legacyGroups.textures);
		for (let id of mats.map(q => q.fileid)) {
			addHash("material", id, 0, 0);
			addDep("texture", id, "material", id);
		}
	} else if (cache.getBuildNr() <= 471) {
		let arch = await cache.getArchiveById(cacheMajors.texturesOldPng, 0);
		for (let mat of arch) {
			addHash("material", mat.fileid, crc32(mat.buffer), 0);
			let matdata = parse.oldproctexture.read(mat.buffer, cache);
			addDep("texture", matdata.spriteid, "material", mat.fileid);
		}
	} else if (cache.getBuildNr() < 759) {
		//unkown how this works...
	} else {
		let arch = await cache.getArchiveById(cacheMajors.materials, 0);

		for (let file of arch) {
			addHash("material", file.fileid, crc32(file.buffer), 0);
			let mat = convertMaterial(file.buffer, file.fileid, cache);
			for (let tex of Object.values(mat.textures)) {
				if (typeof tex == "number") {
					addDep("texture", tex, "material", file.fileid)
				}
			}
		}
	}
}

const npcDeps: DepCollector = async (cache, addDep, addHash) => {
	let npcindices = await cache.getCacheIndex(cacheMajors.npcs);
	for (let index of npcindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			let id = archiveToFileId(index.major, index.minor, file.fileid);
			addHash("npc", id, crc32(file.buffer), index.version);
			let npc = parse.npc.read(file.buffer, cache);
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
const skeletonDeps: DepCollector = async (cache, addDep, addHash) => {
	let skelindices = await cache.getCacheIndex(cacheMajors.skeletalAnims);
	for (let skelindex of skelindices) {
		if (!skelindex) { continue; }
		addHash("skeleton", skelindex.minor, skelindex.crc, skelindex.version);
		let file = await cache.getFile(skelindex.major, skelindex.minor, skelindex.crc);
		let skel = parse.skeletalAnim.read(file, cache);
		addDep("framebase", skel.framebase, "skeleton", skelindex.minor);
	}
}

const framesetDeps: DepCollector = async (cache, addDep, addHash) => {
	let framesetindices = await cache.getCacheIndex(cacheMajors.frames);
	for (let index of framesetindices) {
		if (!index) { continue; }
		addHash("frameset", index.minor, index.crc, index.version);
		let arch = await cache.getFileArchive(index);
		if (arch.length != 0) {
			let frame0 = parse.frames.read(arch[0].buffer, cache);
			addDep("framebase", frame0.probably_framemap_id, "frameset", index.minor);
		}
	}
}

const modelDeps: DepCollector = async (cache, addDep, addHash) => {
	let modelindices = await cache.getCacheIndex(cacheMajors.models);
	for (let modelindex of modelindices) {
		if (!modelindex) { continue; }
		addHash("model", modelindex.minor, modelindex.crc, modelindex.version);
		let file = await cache.getFile(modelindex.major, modelindex.minor, modelindex.crc);
		let model = parse.models.read(file, cache);
		for (let mesh of model.meshes) {
			if (mesh.materialArgument != 0) {
				addDep("material", mesh.materialArgument - 1, "model", modelindex.minor);
			}
		}
	}
}

export type DependencyGraph = (typeof getDependencies) extends ((...args: any[]) => Promise<infer T>) ? T : never;
export async function getDependencies(cache: EngineCache) {
	let dependentsMap = new Map<string, string[]>();
	let dependencyMap = new Map<string, string[]>();
	let hashes = new Map<string, number>();
	let maxVersion = 0;
	let addDep = (holdertype: DepTypes, holderId: number, deptType: DepTypes, depId: number) => {
		let holder = `${holdertype}-${holderId}`;
		let newdep = `${deptType}-${depId}`;
		//add dependency
		let dependencies = dependencyMap.get(newdep);
		if (!dependencies) {
			dependencies = [];
			dependencyMap.set(newdep, dependencies);
		}
		if (dependencies.indexOf(holder) == -1) { dependencies.push(holder); }
		//add dependent
		let deps = dependentsMap.get(holder);
		if (!deps) {
			deps = [];
			dependentsMap.set(holder, deps);
		}
		if (deps.indexOf(newdep) == -1) { deps.push(newdep); }
	}
	let addHash = (deptType: DepTypes, depId: number, hash: number, version: number) => {
		let depname = `${deptType}-${depId}`;
		hashes.set(depname, hash);
		maxVersion = Math.max(maxVersion, version);
	}

	globalThis.dependentsMap = dependentsMap;

	let runs: DepCollector[] = [
		mapsquareDeps2,
		sequenceDeps,
		locationDeps,
		itemDeps,
		animgroupDeps,
		materialDeps2,
		npcDeps,

		// skeletonDeps,
		// framesetDeps,
		// modelDeps
	];

	for (let run of runs) {
		console.log(`starting ${run.name}`);
		let t = Date.now();
		await run(cache, addDep, addHash);
		console.log(`finished ${run.name}, duration ${((Date.now() - t) / 1000).toFixed(1)}`);
	}

	let makeDeptName = (deptType: DepTypes, id: number) => {
		return `${deptType}-${id}`;
	}

	let cascadeDependencies = (depname: string, list: string[] = []) => {
		let hash = hashes.get(depname) ?? 0;
		let hashtext = `${depname}-${hash}`;
		if (!list.includes(hashtext)) {
			list.push(hashtext);
			let deps = dependencyMap.get(depname);
			if (deps) {
				for (let dep of deps) {
					cascadeDependencies(dep, list);
				}
			}
		}
		return list;
	}

	let hashDependencies = (depname: string, previouscrc = 0) => {
		let hash = hashes.get(depname) ?? 0;
		let [type, id] = depname.split("-");
		let crc = previouscrc;
		crc = crc32addInt(depidmap[type], crc);
		crc = crc32addInt(+id, crc);
		crc = crc32addInt(+hash, crc);
		let deps = dependencyMap.get(depname);
		if (deps) {
			for (let dep of deps) {
				crc = hashDependencies(dep, crc);
			}
		}
		return crc;
	}

	return { dependencyMap, dependentsMap, maxVersion, cascadeDependencies, makeDeptName, hashDependencies };
}
//TODO remove
globalThis.getdeps = getDependencies;

const staticintbuf = Buffer.alloc(4);
export function crc32addInt(int: number, crc = 0) {
	staticintbuf.writeUInt32BE(int);
	return crc32(staticintbuf, crc);
}
