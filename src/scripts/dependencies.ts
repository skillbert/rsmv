// import { filesource, cliArguments } from "../cliparser";
// import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseCacheIndex, parseMapsquareTiles, FileParser, parseModels, parseMapsquareUnderlays, parseSequences, parseMapsquareOverlays, parseMapZones, parseFrames, parseEnums, parseMapscenes, parseMapsquareLocations, parseFramemaps, parseAnimgroupConfigs, parseSpotAnims, parseRootCacheIndex, parseSkeletalAnim, parseMaterials } from "../opdecoder";
import { archiveToFileId, CacheFileSource, CacheIndex, fileIdToArchiveminor, SubFile } from "../cache";
import { defaultMorphId, squareSize } from "../3d/mapsquare";
import { convertMaterial } from "../3d/jmat";
import { crc32 } from "../libs/crc32util";
import { arrayEnum } from "../utils";

const depids = arrayEnum(["material", "model", "item", "loc", "mapsquare", "sequence", "skeleton", "frameset", "animgroup", "npc", "framebase", "texture", "enum"]);
const depidmap = Object.fromEntries(depids.map((q, i) => [q, i]));
export type DepTypes = typeof depids[number];

type DepCallback = (holdertype: DepTypes, holderId: number, deptType: DepTypes, depId: number) => void;
type HashCallback = (depType: DepTypes, depId: number, hash: number, version: number) => void;
type DepCollector = (cache: CacheFileSource, addDep: DepCallback, addHash: HashCallback) => Promise<void>;

const mapsquareDeps: DepCollector = async (cache, addDep, addHash) => {
	let mapsquareindices = await cache.getIndexFile(cacheMajors.mapsquares);
	for (let square of mapsquareindices) {
		if (!square) { continue; }
		let locsconfig = square.subindices.indexOf(cacheMapFiles.locations);
		addHash("mapsquare", square.minor, square.crc, square.version);
		if (locsconfig != -1) {
			let arch = await cache.getFileArchive(square);
			let locs = parseMapsquareLocations.read(arch[locsconfig].buffer);
			for (let loc of locs.locations) {
				addDep("loc", loc.id, "mapsquare", square.minor);
			}
		}
	}
}


const sequenceDeps: DepCollector = async (cache, addDep, addHash) => {
	let seqindices = await cache.getIndexFile(cacheMajors.sequences);
	for (let index of seqindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);
		for (let file of arch) {
			let id = archiveToFileId(index.major, index.minor, file.fileid);
			addHash("sequence", id, crc32(file.buffer), index.version);
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
const locationDeps: DepCollector = async (cache, addDep, addHash) => {
	let locindices = await cache.getIndexFile(cacheMajors.objects);
	for (let index of locindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			let id = archiveToFileId(index.major, index.minor, file.fileid);
			addHash("loc", id, crc32(file.buffer), index.version);
			let loc = parseObject.read(file.buffer);
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
const itemDeps: DepCollector = async (cache, addDep, addHash) => {
	let itemindices = await cache.getIndexFile(cacheMajors.items);
	for (let index of itemindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			let id = archiveToFileId(index.major, index.minor, file.fileid);
			addHash("item", id, crc32(file.buffer), index.version);
			let item = parseItem.read(file.buffer);
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
const animgroupDeps: DepCollector = async (cache, addDep, addHash) => {
	let animgroupfiles = await cache.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
	for (let file of animgroupfiles) {
		addHash("animgroup", file.fileid, crc32(file.buffer), 0);
		let animgroup = parseAnimgroupConfigs.read(file.buffer);
		let anim = animgroup.unknown_26 ?? animgroup.baseAnims?.idle;
		if (anim) {
			addDep("sequence", anim, "animgroup", file.fileid);
		}
	}
}
const materialDeps: DepCollector = async (cache, addDep, addHash) => {
	let indices = await cache.getIndexFile(cacheMajors.materials);
	for (let index of indices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			addHash("material", file.fileid, crc32(file.buffer), index.version);
			let mat = convertMaterial(file.buffer);
			for (let tex of Object.values(mat.textures)) {
				if (typeof tex == "number") {
					addDep("texture", tex, "material", file.fileid)
				}
			}
		}
	}
}
const npcDeps: DepCollector = async (cache, addDep, addHash) => {
	let npcindices = await cache.getIndexFile(cacheMajors.npcs);
	for (let index of npcindices) {
		if (!index) { continue; }
		let arch = await cache.getFileArchive(index);

		for (let file of arch) {
			let id = archiveToFileId(index.major, index.minor, file.fileid);
			addHash("npc", id, crc32(file.buffer), index.version);
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
const skeletonDeps: DepCollector = async (cache, addDep, addHash) => {
	let skelindices = await cache.getIndexFile(cacheMajors.skeletalAnims);
	for (let skelindex of skelindices) {
		if (!skelindex) { continue; }
		addHash("skeleton", skelindex.minor, skelindex.crc, skelindex.version);
		let file = await cache.getFile(skelindex.major, skelindex.minor, skelindex.crc);
		let skel = parseSkeletalAnim.read(file);
		addDep("framebase", skel.framebase, "skeleton", skelindex.minor);
	}
}

const framesetDeps: DepCollector = async (cache, addDep, addHash) => {
	let framesetindices = await cache.getIndexFile(cacheMajors.frames);
	for (let index of framesetindices) {
		if (!index) { continue; }
		addHash("frameset", index.minor, index.crc, index.version);
		let arch = await cache.getFileArchive(index);
		if (arch.length != 0) {
			let frame0 = parseFrames.read(arch[0].buffer);
			addDep("framebase", frame0.probably_framemap_id, "frameset", index.minor);
		}
	}
}

const modelDeps: DepCollector = async (cache, addDep, addHash) => {
	let modelindices = await cache.getIndexFile(cacheMajors.models);
	for (let modelindex of modelindices) {
		if (!modelindex) { continue; }
		addHash("model", modelindex.minor, modelindex.crc, modelindex.version);
		let file = await cache.getFile(modelindex.major, modelindex.minor, modelindex.crc);
		let model = parseModels.read(file);
		for (let mesh of model.meshes) {
			if (mesh.materialArgument != 0) {
				addDep("material", mesh.materialArgument - 1, "model", modelindex.minor);
			}
		}
	}
}

export type DependencyGraph = (typeof getDependencies) extends ((...args: any[]) => Promise<infer T>) ? T : never;
export async function getDependencies(cache: CacheFileSource) {
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
		mapsquareDeps,
		sequenceDeps,
		locationDeps,
		itemDeps,
		animgroupDeps,
		materialDeps,
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

const staticintbuf = Buffer.alloc(4);
export function crc32addInt(int: number, crc = 0) {
	staticintbuf.writeUInt32BE(int);
	return crc32(staticintbuf, crc);
}
