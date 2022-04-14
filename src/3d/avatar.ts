import { CacheFileSource } from "cache";
import { cacheConfigPages, cacheMajors } from "../constants";
import { parseAnimgroupConfigs, parseAvatars, parseIdentitykit, parseItem, parseNpc, parseStructs } from "../opdecoder";
import { ob3ModelToThreejsNode, ThreejsSceneCache } from "./ob3tothree";
import { Stream } from "./utils";

export function avatarStringToBytes(text: string) {
	let base64 = text.replace(/\*/g, "+").replace(/-/g, "/");
	return Buffer.from(base64, "base64");
}

export function lowname(name: string) {
	let res = name.replace(/[\- +]/g, "_").toLowerCase();
	if (res.match(/\W/)) { throw new Error("unsanitized name"); }
	return res;
}

export async function avatarToModel(scene: ThreejsSceneCache, avadata: Buffer) {
	let avabase = parseAvatars.read(avadata);
	let modelids: (number | null | undefined)[] = [];

	let playerkitarch = await scene.source.getArchiveById(cacheMajors.config, cacheConfigPages.identityKit);
	let playerkit = Object.fromEntries(playerkitarch.map(q => [q.fileid, parseIdentitykit.read(q.buffer)]));

	let animgroup = 2699;

	if (avabase.player) {
		let animstruct = -1;
		for (let [index, slot] of avabase.player.slots.entries()) {
			if (slot == 0 || slot == 0x3fff) { continue; }
			if (slot < 0x4000) {
				let kitid = slot - 0x100;
				let kit = playerkit[kitid];
				if (kit) {
					if (kit.model) { modelids.push(kit.model?.model); }
					continue;
				}
			}
			//have to do some guessing here since the format overflowed and is corrupted
			let itemid = (slot - 0x4000) & 0xffff;
			let file = await scene.source.getFileById(cacheMajors.items, itemid);
			let item = parseItem.read(file);

			let animprop = item.extra?.find(q => q.prop == 686);
			if (animprop) { animstruct = animprop.intvalue!; }

			//TODO item model overrides/recolors/retextures
			if ((avabase.gender & 1) == 0) {
				modelids.push(item.maleModels_0, item.maleModels_1, item.maleModels_2);
			} else {
				modelids.push(item.femaleModels_0, item.femaleModels_1, item.femaleModels_2);
			}
		}

		if (animstruct != -1) {
			let file = await scene.source.getFileById(cacheMajors.structs, animstruct);
			let anims = parseStructs.read(file);
			//2954 for combat stance
			let noncombatset = anims.extra?.find(q => q.prop == 2954);
			if (noncombatset) {
				animgroup = noncombatset.intvalue!;
			}
		}


		let stream = new Stream(Buffer.from(avabase.player.rest));
		stream.skip(stream.bytesLeft() - 2);
		let unknownint = stream.readUShort();
	} else if (avabase.npc) {
		let file = await scene.source.getFileById(cacheMajors.npcs, avabase.npc.id);
		let npc = parseNpc.read(file);
		if (npc.models) { modelids.push(...npc.models) };
		if (npc.animation_group) {
			animgroup = npc.animation_group;
		}
	}

	let animsetarch = await scene.source.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
	let animsetfile = animsetarch[animgroup];
	let animset = parseAnimgroupConfigs.read(animsetfile.buffer);
	let animid = animset.unknown_01![0];

	let animids = (animid == -1 ? [] : [animid]);
	return {
		modelids: modelids.filter(q => q) as number[],
		animids
	};
}
