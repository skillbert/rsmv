import { CacheFileSource } from "../cache";
import { cacheConfigPages, cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { HSL2packHSL, HSL2RGB, ModelModifications, packedHSL2HSL, RGB2HSL } from "../utils";
import { avataroverrides } from "../../generated/avataroverrides";
import { avatars } from "../../generated/avatars";
import { SimpleModelDef, serializeAnimset, castModelInfo } from "./modelnodes";
import { EngineCache } from "./modeltothree";
import { npcs } from "../../generated/npcs";

export function avatarStringToBytes(text: string) {
	let base64 = text.replace(/\*/g, "+").replace(/-/g, "/");
	return Buffer.from(base64, "base64");
}

export function bytesToAvatarString(buf: Buffer) {
	let base64 = buf.toString("base64");
	return base64.replace(/\+/g, "*").replace(/\//g, "-").replace(/=/g, "");
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
			let colordata = parse.enums.read(colorfile, source);
			let orderfile = await source.getFileById(cacheMajors.enums, mappingid);
			let orderdata = parse.enums.read(orderfile, source);
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
	headmodels: number[],
	replaceMaterials: [number, number][],
	replaceColors: [number, number][],
	animStruct: number
}

type ReadOption = {
	buffer: Buffer,
	offset: number,
	slot: EquipSlot | null,
	penalty: number,
	slotindex: number,
	parent: ReadOption | null,
	usesBackup: boolean
}
export async function avatarToModel(engine: EngineCache, buffer: Buffer, head: boolean) {
	let addOpt = (parent: ReadOption, offset: number, penalty: number, usesBackup: boolean, slot: EquipSlot | null) => {
		activelist.push({
			buffer: parent.buffer,
			offset: offset,
			parent: parent,
			penalty: parent.penalty + penalty,
			slot: slot,
			slotindex: parent.slotindex + 1,
			usesBackup: parent.usesBackup || usesBackup
		});
	}

	let addNumberOpt = async (parent: ReadOption, offset: number, isBackup: boolean, slot: number) => {
		let slotindex = parent.slotindex + 1;
		if (slot < 0x4000) {
			let kitid = slot - 0x100;
			let kit = playerkit[kitid];
			if (kit?.models) {
				let models: number[] = [];
				let headmodels: number[] = [];
				for (let m of kit.models) { models.push(m, m); }
				if (kit.headmodel) { headmodels.push(kit.headmodel, kit.headmodel); }

				//add penalty if kit is worn in wrong slot
				let bodypart = kit.bodypart ?? -1;
				let targetpart = (isFemale ? slotToKitFemale : slotToKitMale)[slotindex] ?? -2;
				let penalty = (bodypart == targetpart ? 0 : 1);

				addOpt(parent, offset, penalty, isBackup, {
					name: slotNames[slotindex] + "_" + kitid,
					type: "kit",
					id: kitid,
					models: models,
					headmodels: headmodels,
					replaceColors: kit.recolor ?? [],
					replaceMaterials: [],
					animStruct: -1
				});
			}
		}
		//have to do some guessing here since the format overflowed and is corrupted
		let itemid = (slot - 0x4000) & 0xffff;
		let iswrapped = (slot < 0x4000);
		let file = await engine.getGameFile("items", itemid).catch(() => null);
		if (file) {
			let item = parse.item.read(file, engine.rawsource);

			let animStruct = item.extra?.find(q => q.prop == 686)?.intvalue ?? -1;

			let models: number[] = [];
			if (item.maleModels_0) { models[0] = item.maleModels_0.id; }
			if (item.femaleModels_0) { models[1] = item.femaleModels_0.id; }
			if (item.maleModels_1) { models[2] = item.maleModels_1; }
			if (item.femaleModels_1) { models[3] = item.femaleModels_1; }
			if (item.maleModels_2) { models[4] = item.maleModels_2; }
			if (item.femaleModels_2) { models[5] = item.femaleModels_2; }

			let headmodels: number[] = [];
			if (item.maleHeads_0) { headmodels[0] = item.maleHeads_0; }
			if (item.femaleHeads_0) { headmodels[1] = item.femaleHeads_0; }
			if (item.maleHeads_1) { headmodels[2] = item.maleHeads_1; }
			if (item.femaleHeads_1) { headmodels[3] = item.femaleHeads_1; }

			let penalty = (item.equipSlotId != slotindex ? 1 : 0);
			addOpt(parent, offset, penalty, isBackup || iswrapped, {
				name: (item.name ? item.name : "item_" + itemid),
				type: "item",
				id: itemid,
				models: models,
				headmodels: headmodels,
				replaceColors: item.color_replacements ?? [],
				replaceMaterials: item.material_replacements ?? [],
				animStruct
			});
		}
	}

	let finalizeNode = async (opt: ReadOption) => {
		let slots: (EquipSlot | null)[] = [];
		let parent: ReadOption = opt;
		//skip last (root) node
		while (parent.parent) {
			slots.push(parent.slot);
			parent = parent.parent;
		}
		slots.reverse();

		let custbuf = opt.buffer.slice(opt.offset);
		try {
			var avatar = parse.avatarOverrides.read(custbuf, engine.rawsource, { slots });
		} catch (e) {
			return false;
		}
		let globalrecolors: [number, number][] = [
			[defaultcols.hair0, kitdata.hair[avatar.haircol0]],
			[defaultcols.hair1, kitdata.hair[avatar.haircol0]],//TODO figure out when the second hair color is actually used
			// [defaultcols.hair1, kitdata.hair[avatar.haircol1]],

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

		let models: SimpleModelDef = [];
		let anims: Record<string, number> = { none: -1 };

		avatar.slots.forEach(slot => {
			const equip: EquipSlot = slot.slot;
			if (equip) {
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
				let equipmodels = (head ? equip.headmodels : equip.models);
				for (let i = (isFemale ? 1 : 0); i < equipmodels.length; i += 2) {
					if (equipmodels[i] != -1) { models.push({ modelid: equipmodels[i], mods }); }
				}
			}
		});

		if (head) {
			anims = humanheadanims;
		} else {
			let animgroup = 2699;
			let animslot = slots.find(q => q && q.animStruct != -1);
			if (animslot) {
				let file = await engine.getFileById(cacheMajors.structs, animslot.animStruct);
				let animfile = parse.structs.read(file, engine.rawsource);
				//2954 for combat stance
				let noncombatset = animfile.extra?.find(q => q.prop == 2954);
				if (noncombatset) { animgroup = noncombatset.intvalue!; }
			}
			anims = await animGroupToAnims(engine, animgroup);
		}
		return { models, avatar, anims };
	}

	let solveNode = async (parent: ReadOption) => {
		let offset = parent.offset;
		if (offset >= parent.buffer.length - 2) {
			return;
		}
		let byte0 = parent.buffer.readUint8(offset++);
		if (byte0 == 0) {
			addOpt(parent, offset, 0, false, null);
		}
		let byte1 = parent.buffer.readUint8(offset++);
		if (byte0 != 0 || byte1 != 0) {
			let value = (byte0 << 8) | byte1;
			await addNumberOpt(parent, offset, byte0 == 0, value);
		}
	}

	//parser state and caches values
	let activelist: ReadOption[] = [];

	let kitdata = await loadKitData(engine);
	let playerkitarch = await engine.getArchiveById(cacheMajors.config, cacheConfigPages.identityKit);
	let playerkit = Object.fromEntries(playerkitarch.map(q => [q.fileid, parse.identitykit.read(q.buffer, engine.rawsource)]));

	let models: SimpleModelDef;
	let avatar = null as avataroverrides | null;
	let npc = null as npcs | null;
	let anims: Record<string, number> = { none: -1 };
	//start parsing
	let gender = buffer.readUint8(0);
	let isFemale = !!(gender & 1);
	let npcbuzz = buffer.readUint16BE(1);
	if (npcbuzz == 0xffff) {
		let npcid = buffer.readUint16BE(3);
		let file = await engine.getGameFile("npcs", npcid);
		let npc = parse.npc.read(file, engine.rawsource);
		let mods: ModelModifications = {
			replaceColors: npc.color_replacements ?? [],
			replaceMaterials: npc.color_replacements ?? []
		};
		let models: SimpleModelDef = [];
		if (!head) {
			if (npc.models) { models.push(...npc.models.map(q => ({ modelid: q, mods: mods }))) }
			if (npc.animation_group) { anims = await animGroupToAnims(engine, npc.animation_group); }
		} else {
			if (npc.headModels) { models.push(...npc.headModels.map(q => ({ modelid: q, mods: mods }))); }
		}
	} else {
		//need to do a tree search here since the model format is corrupted and can be
		//different lengths. main problem is that 00xx can mean either a 1 byte empty slot
		//or item 100xx wrapped around in 2 bytes
		activelist.push({
			buffer: buffer,
			offset: 1,
			parent: null,
			penalty: 0,
			slot: null,
			slotindex: -1,
			usesBackup: false
		});
		for (let stepcount = 0; true; stepcount++) {
			//lowest penalty with highest index in the back
			activelist.sort((a, b) => b.penalty - a.penalty || a.slotindex - b.slotindex);
			let node = activelist.pop();
			if (!node) { throw new Error("no avatar read solution found"); }
			stepcount++;
			if (node.slotindex == 15) {
				let res = await finalizeNode(node);
				if (res) {
					models = res.models;
					anims = res.anims;
					avatar = res.avatar;
					console.log(`solved player avatar in ${stepcount} steps, ${activelist.length} nodes left, ${node.penalty} penalty. ${node.usesBackup ? "used backup" : "did not use backup"}`);
					break;
				}
			} else {
				await solveNode(node);
			}
		}
	}
	return castModelInfo({
		models: models!,
		anims,
		info: { avatar, gender, npc: npc, kitcolors: kitdata, buffer },
		id: buffer,
		name: "player"
	});
}

export function writeAvatar(avatar: avataroverrides | null, gender: number, npc: avatars["npc"]) {
	let base: avatars = {
		gender: gender,
		npc: npc,
		player: null
	}

	if (avatar) {
		let overrides = parse.avatarOverrides.write(avatar);
		base.player = {
			slots: avatar.slots.map(q => {
				const slot = q.slot as EquipSlot | null;
				return (!slot ? 0 : slot.type == "item" ? slot.id + 0x4000 : slot.id + 0x100);
			}) as any,
			rest: overrides
		}
	}
	return parse.avatars.write(base);
}

async function animGroupToAnims(engine: EngineCache, groupid: number) {
	let animsetarch = await engine.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
	let animsetfile = animsetarch[groupid];
	let animset = parse.animgroupConfigs.read(animsetfile.buffer, engine.rawsource);

	return serializeAnimset(animset);
}

export function appearanceUrl(name: string) {
	if (typeof document != "undefined" && typeof document.location != "undefined" && (document.location.protocol.startsWith("http") || document.location.protocol == "about:")) {
		//proxy through runeapps if we are running in a browser
		return `https://runeapps.org/data/getplayeravatar.php?player=${encodeURIComponent(name)}`;
	} else {
		return `https://secure.runescape.com/m=avatar-rs/${encodeURIComponent(name)}/appearance.dat`;
	}
}