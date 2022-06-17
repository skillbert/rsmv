import { CacheFileSource } from "cache";
import { cacheConfigPages, cacheMajors } from "../constants";
import { parseAnimgroupConfigs, parseAvatarOverrides, parseAvatars, parseEnums, parseIdentitykit, parseItem, parseNpc, parseStructs } from "../opdecoder";
import { ThreejsSceneCache } from "./ob3tothree";
import { HSL2packHSL, HSL2RGB, ModelModifications, packedHSL2HSL, RGB2HSL } from "../utils";
import { SimpleModelDef, serializeAnimset } from "../viewer/scenenodes";
import { items } from "../../generated/items";
import { avataroverrides } from "../../generated/avataroverrides";
import { ScriptOutput } from "../viewer/scriptsui";
import { testDecodeFile } from "../scripts/testdecode";
import { avatars } from "../../generated/avatars";

export function avatarStringToBytes(text: string) {
	let base64 = text.replace(/\*/g, "+").replace(/-/g, "/");
	return Buffer.from(base64, "base64");
}

export function lowname(name: string) {
	let res = name.replace(/[\- +]/g, "_").toLowerCase();
	if (res.match(/\W/)) { throw new Error("unsanitized name"); }
	return res;
}

export const slotNames = [
	"helm",
	"cape",
	"necklace",
	"weapon",
	"body",
	"offhand",//5
	"arms",
	"legs",
	"face",
	"gloves",
	"boots",//10
	"beard",
	"ring",
	"ammo",
	"aura",
	"slot15"
];

//male 0head,1jaw/beard,2body,3arms,4hands,5legs,6feet,
export const slotToKitMale = { 4: 2, 6: 3, 7: 5, 8: 0, 9: 4, 10: 6, 11: 1 };

//female 7head,9body,10arms,11hands,12legs,13feet,
export const slotToKitFemale = { 4: 9, 6: 10, 7: 12, 8: 7, 9: 11, 10: 13 };

const defaultcols = {
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

const humanheadanims: Record<string, number> = {
	none: -1,
	default: 9804,
	worried: 9743,
	talkfast: 9745,
	scared: 9748,
	wtf: 9752,
	drunk: 9851,
	happy: 9843,
	evil: 9842,
	laughing: 9841,
	crying: 9765
}

let kitcolors: Record<"feet" | "skin" | "hair" | "clothes", Record<number, number>> | null = null;

async function loadKitData(source: CacheFileSource) {
	if (!kitcolors) {
		let mapcolorenum = async (enumid: number, mappingid: number) => {
			let colorfile = await source.getFileById(cacheMajors.enums, enumid);
			let colordata = parseEnums.read(colorfile);
			let orderfile = await source.getFileById(cacheMajors.enums, mappingid);
			let orderdata = parseEnums.read(orderfile);
			return Object.fromEntries(orderdata.intArrayValue2!.values.map(q => {
				let col = colordata.intArrayValue2!.values.find(w => w[0] == q[0])![1];
				return [
					q[1],
					HSL2packHSL(...RGB2HSL((col >> 16) & 0xff, (col >> 8) & 0xff, (col >> 0) & 0xff))
				]
			}));
		}

		kitcolors = {
			feet: await mapcolorenum(753, 3297),
			skin: await mapcolorenum(746, 748),
			hair: await mapcolorenum(2343, 2345),
			clothes: await mapcolorenum(2347, 3282)
		}
	}

	// for (let [id, colhsl] of Object.entries(kitcolors.hair)) {
	// 	let [r, g, b] = HSL2RGB(packedHSL2HSL(colhsl));
	// 	console.log("%c" + id, `font-weight:bold;padding:0px 20px;background:rgb(${r},${g},${b}`);
	// }

	// console.log(kitcolors);
	return kitcolors;
}

export type EquipCustomization = avataroverrides["slots"][number]["cust"];

export type EquipSlot = {
	name: string,
	type: "kit" | "item",
	id: number,
	models: number[],
	indexMale: [number, number],
	indexFemale: [number, number],
	indexMaleHead: [number, number],
	indexFemaleHead: [number, number],
	replaceMaterials: [number, number][],
	replaceColors: [number, number][]
}

//TODO remove output and name args
export async function avatarToModel(output: ScriptOutput | null, scene: ThreejsSceneCache, avadata: Buffer, name = "", head = false) {
	let kitdata = await loadKitData(scene.source);
	let avabase = parseAvatars.read(avadata);
	let models: SimpleModelDef = [];

	let playerkitarch = await scene.source.getArchiveById(cacheMajors.config, cacheConfigPages.identityKit);
	let playerkit = Object.fromEntries(playerkitarch.map(q => [q.fileid, parseIdentitykit.read(q.buffer)]));

	let slots: (EquipSlot | null)[] = [];
	let avatar: avataroverrides | null = null;
	let anims: Record<string, number> = { none: -1 };

	if (avabase.player) {
		slots = avabase.player.slots.map(() => null);
		let isfemale = (avabase.gender & 1) != 0;
		let animstruct = -1;
		for (let [index, slot] of avabase.player.slots.entries()) {
			if (slot == 0 || slot == 0x3fff) { continue; }
			if (slot < 0x4000) {
				let kitid = slot - 0x100;
				let kit = playerkit[kitid];
				if (kit?.models) {
					let models = [...kit.models];
					if (kit.headmodel) { models.push(kit.headmodel); }
					slots[index] = {
						name: slotNames[index] + "_" + kitid,
						type: "kit",
						id: kitid,
						models: models,
						indexMale: [0, kit.models.length],
						indexFemale: [0, kit.models.length],
						indexMaleHead: [kit.models.length, kit.models.length + (kit.headmodel ? 1 : 0)],
						indexFemaleHead: [kit.models.length, kit.models.length + (kit.headmodel ? 1 : 0)],
						replaceColors: kit.recolor ?? [],
						replaceMaterials: []
					}
					continue;
				}
			}
			//have to do some guessing here since the format overflowed and is corrupted
			let itemid = (slot - 0x4000) & 0xffff;
			let file = await scene.source.getFileById(cacheMajors.items, itemid);
			let item = parseItem.read(file);

			let animprop = item.extra?.find(q => q.prop == 686);
			if (animprop) { animstruct = animprop.intvalue!; }

			let itemmodels: number[] = [];
			let maleindex = itemmodels.length;
			if (item.maleModels_0) { itemmodels.push(item.maleModels_0); }
			if (item.maleModels_1) { itemmodels.push(item.maleModels_1); }
			if (item.maleModels_2) { itemmodels.push(item.maleModels_2); }
			let femaleindex = itemmodels.length;
			if (item.femaleModels_0) { itemmodels.push(item.femaleModels_0); }
			if (item.femaleModels_1) { itemmodels.push(item.femaleModels_1); }
			if (item.femaleModels_2) { itemmodels.push(item.femaleModels_2); }
			let maleheadindex = itemmodels.length;
			if (item.maleHeads_0) { itemmodels.push(item.maleHeads_0); }
			if (item.maleHeads_1) { itemmodels.push(item.maleHeads_1); }
			let femaleheadindex = itemmodels.length;
			if (item.femaleHeads_0) { itemmodels.push(item.femaleHeads_0); }
			if (item.femaleHeads_1) { itemmodels.push(item.femaleHeads_1); }
			let endindex = itemmodels.length;


			slots[index] = {
				name: (item.name ? item.name : "item_" + itemid),
				type: "item",
				id: itemid,
				models: itemmodels,
				indexMale: [maleindex, femaleindex],
				indexFemale: [femaleindex, maleheadindex],
				indexMaleHead: [maleheadindex, femaleheadindex],
				indexFemaleHead: [femaleheadindex, endindex],
				replaceColors: item.color_replacements ?? [],
				replaceMaterials: item.material_replacements ?? []
			};
		}

		let res = testDecodeFile(parseAvatarOverrides, "json", Buffer.from(avabase.player.rest), { slots });
		if (!res.success) {
			if (!output) { throw new Error(); }
			output.writeFile(name + ".hexerr.json", res.errorfile)
		}
		avatar = parseAvatarOverrides.read(Buffer.from(avabase.player.rest), { slots });

		let globalrecolors: [number, number][] = [
			[defaultcols.hair0, kitdata.hair[avatar.haircol0]],
			[defaultcols.hair1, kitdata.hair[avatar.haircol1]],

			[defaultcols.skin0, kitdata.skin[avatar.skincol0]],
			[defaultcols.skin1, kitdata.skin[avatar.skincol0]],
			[defaultcols.skin2, kitdata.skin[avatar.skincol0]],
			[defaultcols.skin3, kitdata.skin[avatar.skincol0]],

			[defaultcols.body0, kitdata.clothes[avatar.bodycol]],
			[defaultcols.body1, kitdata.clothes[avatar.bodycol]],
			[defaultcols.legs0, kitdata.clothes[avatar.legscol]],
			[defaultcols.legs1, kitdata.clothes[avatar.legscol]],
			[defaultcols.boots0, kitdata.feet[avatar.bootscol]],
			[defaultcols.boots1, kitdata.feet[avatar.bootscol]],
		];

		avatar.slots.forEach(slot => {
			const equip: EquipSlot = slot.slot;
			if (slot.slot) {
				let mods: ModelModifications = {
					replaceColors: [...equip.replaceColors],
					replaceMaterials: [...equip.replaceMaterials]
				};
				if (slot.cust?.color?.col2) {
					for (let i in mods.replaceColors) { mods.replaceColors[i][1] = slot.cust.color.col2[i]; }
				}
				if (slot.cust?.color?.col4) {
					mods.replaceColors!.push(...slot.cust.color.col4);
				}
				if (slot.cust?.material) {
					for (let i in mods.replaceMaterials) { mods.replaceMaterials[i][1] = slot.cust.material.materials[i]; }
				}
				if (slot.cust?.model) {
					for (let i in slot.cust.model) { equip.models[i] = slot.cust.model[i]; }
				}
				mods.replaceColors!.push(...globalrecolors);
				let range = (isfemale ?
					(head ? equip.indexFemaleHead : equip.indexFemale) :
					(head ? equip.indexMaleHead : equip.indexMale));
				equip.models.forEach((id, i) => i >= range[0] && i < range[1] && models.push({ modelid: id, mods }));
			}
		});

		if (head) {
			anims = humanheadanims;
		} else {
			let animgroup = 2699;
			if (animstruct != -1) {
				let file = await scene.source.getFileById(cacheMajors.structs, animstruct);
				let animfile = parseStructs.read(file);
				//2954 for combat stance
				let noncombatset = animfile.extra?.find(q => q.prop == 2954);
				if (noncombatset) { animgroup = noncombatset.intvalue!; }
			}
			anims = await animGroupToAnims(scene, animgroup);
		}
	} else if (avabase.npc) {
		let file = await scene.source.getFileById(cacheMajors.npcs, avabase.npc.id);
		let npc = parseNpc.read(file);
		let mods: ModelModifications = {
			replaceColors: npc.color_replacements ?? [],
			replaceMaterials: npc.color_replacements ?? []
		};
		if (!head) {
			if (npc.models) { models.push(...npc.models.map(q => ({ modelid: q, mods: mods }))) }
			if (npc.animation_group) { anims = await animGroupToAnims(scene, npc.animation_group); }
		} else {
			if (npc.headModels) { models.push(...npc.headModels.map(q => ({ modelid: q, mods: mods }))); }
		}
	}

	return { models, anims, info: { avatar, gender: avabase.gender, npc: avabase.npc, kitcolors: kitdata } };
}

export function writeAvatar(avatar: avataroverrides | null, gender: number, npc: avatars["npc"]) {
	let base: avatars = {
		gender: gender,
		npc: npc,
		player: null
	}

	if (avatar) {
		let overrides = parseAvatarOverrides.write(avatar);
		base.player = {
			slots: avatar.slots.map(q => {
				const slot = q.slot as EquipSlot | null;
				return (!slot ? 0 : slot.type == "item" ? slot.id + 0x4000 : slot.id + 0x100);
			}) as any,
			rest: overrides
		}
	}
	return parseAvatars.write(base);
}

async function animGroupToAnims(scene: ThreejsSceneCache, groupid: number) {
	let animsetarch = await scene.source.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
	let animsetfile = animsetarch[groupid];
	let animset = parseAnimgroupConfigs.read(animsetfile.buffer);

	return serializeAnimset(animset);
}

export function appearanceUrl(name: string) {
	if (typeof document != "undefined" && document.location.protocol.startsWith("http")) {
		//proxy through runeapps if we are running in a browser
		return `https://runeapps.org/data/getplayeravatar.php?player=${encodeURIComponent(name)}`;
	} else {
		return `https://secure.runescape.com/m=avatar-rs/${encodeURIComponent(name)}/appearance.dat`;
	}
}