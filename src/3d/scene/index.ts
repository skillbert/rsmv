import { parse } from "../../opdecoder";
import { appearanceUrl, avatarStringToBytes, avatarToModel } from "./avatar";
import { ThreejsSceneCache, constModelsIds } from '../modeltothree';
import { ModelModifications } from '../../utils';
import { resolveMorphedObject } from '../mapsquare';
import { cacheConfigPages, cacheMajors, internalNameFiles, lastClassicBuildnr } from "../../constants";
import { animgroupconfigs } from "../../../generated/animgroupconfigs";
import fetch from "node-fetch";
import { MaterialData } from "../materials/jmat";
import { legacyMajors } from "../../cache/legacycache";
import { classicGroups } from "../../cache/classicloader";


export type SimpleModelDef = {
	modelid: number,
	mods: ModelModifications
}[];

export type SimpleModelInfo<T = object, ID = string> = {
	models: SimpleModelDef,
	anims: Record<string, number>,
	info: T,
	id: ID,
	name: string,
	assetName: string | undefined
}

//typescript helper to force type inference
export function castModelInfo<T, ID>(info: SimpleModelInfo<T, ID>) {
	return info;
}

export async function modelToModel(cache: ThreejsSceneCache, id: number) {
	let modeldata = await cache.getModelData(id);
	let assetName = await cache.engine.rawsource.getInternalName(internalNameFiles.model, id);
	//getting the same file a 2nd time to get the full json
	let info: any;
	if (cache.modelType == "classic") {
		let arch = await cache.engine.getArchiveById(0, classicGroups.models);
		info = parse.classicmodels.read(arch[id].buffer, cache.engine.rawsource);
	} else if (cache.modelType == "old") {
		let major = (cache.engine.legacyData ? legacyMajors.oldmodels : cacheMajors.oldmodels);
		info = parse.oldmodels.read(await cache.engine.getFileById(major, id), cache.engine.rawsource);
	} else if (cache.modelType == "nxt") {
		info = parse.models.read(await cache.engine.getFileById(cacheMajors.models, id), cache.engine.rawsource);
	}
	return castModelInfo({
		models: [{ modelid: id, mods: {} }],
		anims: {},
		info: { modeldata, info },
		id,
		assetName,
		name: `model:${id}`
	});
}

export async function playerDataToModel(cache: ThreejsSceneCache, modeldata: { player: string, head: boolean, data: Buffer }) {
	let avainfo = await avatarToModel(cache.engine, modeldata.data, modeldata.head);
	return castModelInfo({
		...avainfo,
		id: modeldata,
		name: modeldata.player
	});
}

export async function playerToModel(cache: ThreejsSceneCache, name: string) {
	let avadata = "";
	if (name.length <= 20) {
		let url = appearanceUrl(name);
		let data = await fetch(url).then(q => q.text());
		if (data.indexOf("404 - Page not found") != -1) { throw new Error("player avatar not found"); }
		avadata = data;
	} else {
		avadata = name;
	}
	let avainfo = await avatarToModel(cache.engine, avatarStringToBytes(avadata), false);
	return castModelInfo({
		...avainfo,
		id: name,
		name: name
	});
}

export async function npcBodyToModel(cache: ThreejsSceneCache, id: number) {
	return npcToModel(cache, { id, head: false });
}

export async function npcToModel(cache: ThreejsSceneCache, id: { id: number, head: boolean }) {
	let npc = parse.npc.read(await cache.engine.getGameFile("npcs", id.id), cache.engine.rawsource);
	let assetName = await cache.engine.rawsource.getInternalName(internalNameFiles.npc, id.id);
	let anims: Record<string, number> = {};
	let modelids = (id.head ? npc.headModels : npc.models) ?? [];
	if (!id.head && npc.animation_group) {
		let arch = await cache.engine.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
		let animgroup = parse.animgroupConfigs.read(arch[npc.animation_group].buffer, cache.engine.rawsource);
		anims = serializeAnimset(animgroup);
	}
	let mods: ModelModifications = {};
	if (npc.color_replacements) { mods.replaceColors = npc.color_replacements; }
	if (npc.material_replacements) { mods.replaceMaterials = npc.material_replacements; }
	let models = modelids.map(q => ({ modelid: q, mods }));
	return castModelInfo({
		info: npc,
		models,
		anims,
		id,
		assetName,
		name: npc.name ?? `npc:${id.id}`
	});
}

export async function spotAnimToModel(cache: ThreejsSceneCache, id: number) {
	let animdata = parse.spotAnims.read(await cache.engine.getGameFile("spotanims", id), cache.engine.rawsource);

	let mods: ModelModifications = {};
	if (animdata.replace_colors) { mods.replaceColors = animdata.replace_colors; }
	if (animdata.replace_materials) { mods.replaceMaterials = animdata.replace_materials; }
	let models = (animdata.model ? [{ modelid: animdata.model, mods }] : []);
	let anims: Record<string, number> = {};
	if (animdata.sequence) { anims.default = animdata.sequence; }
	return castModelInfo({
		models,
		anims,
		info: animdata,
		id,
		assetName: undefined,
		name: `spotanim:${id}`
	});
}

export async function locToModel(cache: ThreejsSceneCache, id: number) {
	let { morphedloc } = await resolveMorphedObject(cache.engine, id);
	let assetName = await cache.engine.rawsource.getInternalName(internalNameFiles.loc, id);
	let mods: ModelModifications = {};
	let anims: Record<string, number> = {};
	let models: SimpleModelDef = [];
	if (morphedloc) {
		if (morphedloc.color_replacements) { mods.replaceColors = morphedloc.color_replacements; }
		if (morphedloc.material_replacements) { mods.replaceMaterials = morphedloc.material_replacements; }
		if (cache.engine.getBuildNr() > lastClassicBuildnr && cache.engine.getBuildNr() < 377) {
			//old caches just use one prop to replace both somehow
			mods.replaceMaterials = mods.replaceColors;
		}
		models = [
			...morphedloc.models?.flatMap(m => m.values).map(q => ({ modelid: q, mods })) ?? [],
			...morphedloc.models_05?.models.flatMap(m => m.values).map(q => ({ modelid: q, mods })) ?? []
		];
	}
	if (morphedloc?.probably_animation) {
		anims.default = morphedloc.probably_animation;
	}
	return castModelInfo({
		models,
		anims,
		info: morphedloc,
		id,
		assetName,
		name: morphedloc.name ?? `loc:${id}`
	});
}
export async function itemToModel(cache: ThreejsSceneCache, id: number) {
	let item = parse.item.read(await cache.engine.getGameFile("items", id), cache.engine.rawsource);
	let assetName = await cache.engine.rawsource.getInternalName(internalNameFiles.obj, id);
	if (!item.baseModel && item.noteTemplate) {
		item = parse.item.read(await cache.engine.getGameFile("items", item.noteTemplate), cache.engine.rawsource);
	}
	let mods: ModelModifications = {};
	if (item.color_replacements) { mods.replaceColors = item.color_replacements; }
	if (item.material_replacements) { mods.replaceMaterials = item.material_replacements; }
	let models = (item.baseModel ? [{ modelid: item.baseModel, mods }] : [])

	return castModelInfo({
		models,
		anims: {},
		info: item,
		id,
		assetName,
		name: item.name ?? `item:${id}`
	});
}

export async function materialToModel(sceneCache: ThreejsSceneCache, id: number) {
	let assetid = constModelsIds.materialCube;
	let mods: ModelModifications = {
		replaceMaterials: [[0, id]]
	};
	let mat = sceneCache.engine.getMaterialData(id);
	let assetName = await sceneCache.engine.rawsource.getInternalName(internalNameFiles.material, id);
	let texs: Record<string, { texid: number, filesize: number, img0: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap }> = {};
	let addtex = async (type: keyof MaterialData["textures"], name: string, texid: number) => {
		let tex = await sceneCache.getTextureFile(type, texid, mat.stripDiffuseAlpha && name == "diffuse");
		let drawable = await tex.toWebgl();

		texs[name] = { texid, filesize: tex.filesize, img0: drawable };
	}
	for (let tex in mat.textures) {
		if (mat.textures[tex] != 0) {
			await addtex(tex as keyof MaterialData["textures"], tex, mat.textures[tex]);
		}
	}
	return castModelInfo({
		models: [{ modelid: assetid, mods }],
		anims: {},
		info: { texs, obj: mat },
		id: id,
		assetName,
		name: `material:${id}`
	});
}

export function serializeAnimset(group: animgroupconfigs) {
	let anims: Record<string, number> = {};
	let addanim = (name: string, id: number) => {
		if (id != -1 && Object.values(anims).indexOf(id) == -1) {
			anims[name] = id;
		}
	}
	anims.none = -1;
	if (group.baseAnims) {
		addanim("default", group.baseAnims.idle);
		addanim("walk", group.baseAnims.walk);
	}
	if (group.run) {
		addanim("run", group.run);
	}
	if (group.idleVariations) {
		let totalchance = group.idleVariations.reduce((a, v) => a + v.probably_chance, 0);
		for (let [i, variation] of group.idleVariations.entries()) {
			addanim(i == 0 ? "default" : `idle${i}_${variation.probably_chance}/${totalchance}`, variation.animid);
		}
	}
	//TODO yikes, this object is not a map
	for (let [key, val] of Object.entries(group)) {
		if (typeof val == "number") {
			addanim(key, group[key]);
		}
	}

	return anims;
}