import { CacheFileSource } from "cache";
import { cacheConfigPages, cacheMajors } from "../constants";
import { parseAnimgroupConfigs, parseAvatars, parseEnums, parseIdentitykit, parseItem, parseNpc, parseStructs } from "../opdecoder";
import { ob3ModelToThreejsNode, ThreejsSceneCache } from "./ob3tothree";
import { HSL2packHSL, HSL2RGB, ModelModifications, packedHSL2HSL, RGB2HSL, Stream } from "../utils";
import { SimpleModelDef } from "../viewer/scenenodes";
import { items } from "../../generated/items";

export function avatarStringToBytes(text: string) {
	let base64 = text.replace(/\*/g, "+").replace(/-/g, "/");
	return Buffer.from(base64, "base64");
}

export function lowname(name: string) {
	let res = name.replace(/[\- +]/g, "_").toLowerCase();
	if (res.match(/\W/)) { throw new Error("unsanitized name"); }
	return res;
}

let defaultcols = {
	hair0: 6798,
	hair1: 55232,

	skin0: 4533,
	skin1: 4540,
	skin2: 4550,
	skin3: 4554,

	body0: 8741,
	body1: 9104,

	legs0: 25485,
	legs1: 25238,

	boots0: 4620,
	boots1: 4626
}

let kitcolors: Record<"feet" | "skin" | "hair" | "clothes", Record<number, number>> | null = null;

async function loadKitData(source: CacheFileSource) {
	let mapcololenum = async (enumid: number, mappingid: number, reverse: boolean) => {
		let colorfile = await source.getFileById(cacheMajors.enums, enumid);
		let colordata = parseEnums.read(colorfile);
		let orderfile = await source.getFileById(cacheMajors.enums, mappingid);
		let orderdata = parseEnums.read(orderfile);
		return Object.fromEntries(orderdata.intArrayValue2!.values.map(q => {
			if (reverse) { q.reverse(); }
			let col = colordata.intArrayValue2!.values.find(w => w[0] == q[0])![1];
			return [
				q[1],
				HSL2packHSL(...RGB2HSL((col >> 16) & 0xff, (col >> 8) & 0xff, (col >> 0) & 0xff))
			]
		}));
	}

	kitcolors = {
		feet: await mapcololenum(753, 3297, false),
		skin: await mapcololenum(746, 748, false),
		hair: await mapcololenum(2343, 2345, false),
		clothes: await mapcololenum(2347, 3282, false)
	}

	// for (let [id, colhsl] of Object.entries(kitcolors.hair)) {
	// 	let [r, g, b] = HSL2RGB(packedHSL2HSL(colhsl));
	// 	console.log("%c" + id, `font-weight:bold;padding:0px 20px;background:rgb(${r},${g},${b}`);
	// }

	// console.log(kitcolors);
	return kitcolors;
}

export async function avatarToModel(scene: ThreejsSceneCache, avadata: Buffer) {
	let kitdata = kitcolors ?? await loadKitData(scene.source);
	let avabase = parseAvatars.read(avadata);
	let models: SimpleModelDef = [];

	let playerkitarch = await scene.source.getArchiveById(cacheMajors.config, cacheConfigPages.identityKit);
	let playerkit = Object.fromEntries(playerkitarch.map(q => [q.fileid, parseIdentitykit.read(q.buffer)]));

	let animgroup = 2699;
	let items: items[] = [];

	if (avabase.player) {
		let isfemale = (avabase.gender & 1) != 0;
		let animstruct = -1;
		let kitmods: { mods: ModelModifications, slotid: number }[] = [];
		let modstream = new Stream(Buffer.from(avabase.player.rest));
		for (let [index, slot] of avabase.player.slots.entries()) {
			if (slot == 0 || slot == 0x3fff) { continue; }
			if (slot < 0x4000) {
				let kitid = slot - 0x100;
				let kit = playerkit[kitid];
				if (kit?.models) {
					for (let modelid of kit.models) {
						let model = {
							modelid: modelid,
							mods: { replaceColors: kit.recolor ?? [] }
						}
						models.push(model);
						kitmods.push({ mods: model.mods, slotid: kit.bodypart ?? -1 });
					}
					// console.log("kit", kit);
					continue;
				}
			}
			//have to do some guessing here since the format overflowed and is corrupted
			let itemid = (slot - 0x4000) & 0xffff;
			let file = await scene.source.getFileById(cacheMajors.items, itemid);
			let item = parseItem.read(file);
			let mods: ModelModifications = {};
			if (item.color_replacements) { mods.replaceColors = item.color_replacements; }
			if (item.material_replacements) { mods.replaceMaterials = item.material_replacements; }

			let animprop = item.extra?.find(q => q.prop == 686);
			if (animprop) { animstruct = animprop.intvalue!; }

			//TODO item model overrides/recolors/retextures
			let itemmodels: SimpleModelDef = [];
			let maleindex = itemmodels.length;
			if (item.maleModels_0) { itemmodels.push({ modelid: item.maleModels_0, mods }); }
			if (item.maleModels_1) { itemmodels.push({ modelid: item.maleModels_1, mods }); }
			if (item.maleModels_2) { itemmodels.push({ modelid: item.maleModels_2, mods }); }
			let femaleindex = itemmodels.length;
			if (item.femaleModels_0) { itemmodels.push({ modelid: item.femaleModels_0, mods }); }
			if (item.femaleModels_1) { itemmodels.push({ modelid: item.femaleModels_1, mods }); }
			if (item.femaleModels_2) { itemmodels.push({ modelid: item.femaleModels_2, mods }); }
			let maleheadindex = itemmodels.length;
			if (item.maleHeads_0) { itemmodels.push({ modelid: item.maleHeads_0, mods }); }
			if (item.maleHeads_1) { itemmodels.push({ modelid: item.maleHeads_1, mods }); }
			let femaleheadindex = itemmodels.length;
			if (item.femaleHeads_0) { itemmodels.push({ modelid: item.femaleHeads_0, mods }); }
			if (item.femaleHeads_1) { itemmodels.push({ modelid: item.femaleHeads_1, mods }); }
			let endindex = itemmodels.length;

			if (avabase.player.flags & (1 << index)) {
				let type = modstream.readByte();
				if (type & 1) {//override model itself
					for (let i = 0; i < itemmodels.length; i++) {
						itemmodels[i].modelid = modstream.readUIntSmart();
					}
				}
				if (type & 2) {//unknown
					console.log("avatar customization flag 2 on item " + item.name);
				}
				if (type & 4) {//color
					//not really understood yet
					let coltype = modstream.readUShort(true);
					mods.replaceColors ??= [];
					if (coltype == 0x3210) {
						for (let recol of mods.replaceColors) {
							recol[1] = modstream.readUShort(true);
						}
					} else if (coltype == 0x220f) {
						mods.replaceColors.push([modstream.readUShort(true), modstream.readUShort(true)]);
						mods.replaceColors.push([modstream.readUShort(true), modstream.readUShort(true)]);
						mods.replaceColors.push([modstream.readUShort(true), modstream.readUShort(true)]);
						mods.replaceColors.push([modstream.readUShort(true), modstream.readUShort(true)]);
					} else {
						throw new Error("unknown avatar item recolor header 0x" + coltype.toString(16));
					}
				}
				if (type & 8) {
					let header = modstream.readUByte();
					console.log("retexture header 0x" + header.toString(16));
					mods.replaceMaterials ??= [];
					if (header == 0x10) {
						for (let remat of mods.replaceMaterials) {
							remat[1] = modstream.readUShort(true);
						}
						// } else if (header == 0xf0) {
						// 	// mods.replaceMaterials.push([modstream.readUShort(), modstream.readUShort()]);
						// 	modstream.readUShort(true);
					} else {
						throw new Error("unknown avatar item material header 0x" + header.toString(16))
					}
				}
			}
			models.push(...itemmodels.slice(isfemale ? femaleindex : maleindex, isfemale ? maleheadindex : femaleindex));
			items.push(item);
		}

		let haircol0 = modstream.readUByte();
		let bodycol = modstream.readUByte();
		let legscol = modstream.readUByte();
		let bootscol = modstream.readUByte();
		let skincol0 = modstream.readUByte();
		let skincol1 = modstream.readUByte();
		let haircol1 = modstream.readUByte();
		console.log("hair", haircol0, haircol1);

		let extramods: [number, number][] = [
			[defaultcols.hair0, kitdata.hair[haircol0]],
			[defaultcols.hair1, kitdata.hair[haircol1]],

			[defaultcols.skin0, kitdata.skin[skincol0]],
			[defaultcols.skin1, kitdata.skin[skincol0]],
			[defaultcols.skin2, kitdata.skin[skincol0]],
			[defaultcols.skin3, kitdata.skin[skincol0]],

			[defaultcols.body0, kitdata.clothes[bodycol]],
			[defaultcols.body1, kitdata.clothes[bodycol]],
			[defaultcols.legs0, kitdata.clothes[legscol]],
			[defaultcols.legs1, kitdata.clothes[legscol]],
			[defaultcols.boots0, kitdata.feet[bootscol]],
			[defaultcols.boots1, kitdata.feet[bootscol]],
		];

		models.forEach(q => {
			q.mods.replaceColors ??= [];
			q.mods.replaceColors.push(...extramods);
		})

		modstream.skip(13);
		let unknownint = modstream.readUShort();

		if (animstruct != -1) {
			let file = await scene.source.getFileById(cacheMajors.structs, animstruct);
			let anims = parseStructs.read(file);
			//2954 for combat stance
			let noncombatset = anims.extra?.find(q => q.prop == 2954);
			if (noncombatset) {
				animgroup = noncombatset.intvalue!;
			}
		}
	} else if (avabase.npc) {
		let file = await scene.source.getFileById(cacheMajors.npcs, avabase.npc.id);
		let npc = parseNpc.read(file);
		if (npc.models) { models.push(...npc.models.map(q => ({ modelid: q, mods: {} }))) };
		if (npc.animation_group) {
			animgroup = npc.animation_group;
		}
	}

	let animsetarch = await scene.source.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
	let animsetfile = animsetarch[animgroup];
	let animset = parseAnimgroupConfigs.read(animsetfile.buffer);
	let animid = animset.baseAnims!.idle;

	let animids = (animid == -1 ? [] : [animid]);
	return { models, animids, info: { items, animset } };
}

export function appearanceUrl(name: string) {
	if (typeof document != "undefined" && document.location.protocol.startsWith("http")) {
		//proxy through runeapps if we are running in a browser
		return `https://runeapps.org/data/getplayeravatar.php?player=${encodeURIComponent(name)}`;
	} else {
		return `https://secure.runescape.com/m=avatar-rs/${encodeURIComponent(name)}/appearance.dat`;
	}
}