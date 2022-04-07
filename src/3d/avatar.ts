import { CacheFileSource } from "cache";
import { cacheConfigPages, cacheMajors } from "../constants";
import { parseAvatars, parseIdentitykit, parseItem, parseNpc } from "../opdecoder";
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
	let animid = -1;

	let playerkitarch = await scene.source.getArchiveById(cacheMajors.config, cacheConfigPages.identityKit);
	let playerkit = Object.fromEntries(playerkitarch.map(q => [q.fileid, parseIdentitykit.read(q.buffer)]));

	if (avabase.player) {
		for (let [index, slot] of avabase.player.slots.entries()) {
			if (slot == 0) { continue; }
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

			//TODO item model overrides/recolors/retextures
			if ((avabase.gender & 1) == 0) {
				modelids.push(item.maleModels_0, item.maleModels_1, item.maleModels_2);
			} else {
				modelids.push(item.femaleModels_0, item.femaleModels_1, item.femaleModels_2);
			}
		}



		let stream = new Stream(Buffer.from(avabase.player.rest));
		stream.skip(stream.bytesLeft() - 2);
		animid = stream.readUShort();
	} else if (avabase.npc) {
		let file = await scene.source.getFileById(cacheMajors.npcs, avabase.npc.id);
		let npc = parseNpc.read(file);
		if (npc.models) { modelids.push(...npc.models) };
	}
	return {
		modelids: modelids.filter(q => q) as number[],
		animids: [] as number[]
	};
}
