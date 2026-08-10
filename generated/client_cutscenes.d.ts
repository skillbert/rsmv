// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\client_cutscenes.jsonc'
// run `npm run filetypes` to rebuild

export type client_cutscenes = {
	head: Uint8Array,
	mapsquares: {
		src_chunk: number,
		src_level: number,
		src_chunkx: number,
		src_chunkz: number,
		sizex: number,
		sizez: number,
		dst_plane: number,
		dst_x: number,
		dst_z: number,
		unk0: number,
	}[],
	arr2: {
		v: Uint8Array,
	}[][],
	npcs: {
		type: number,
		npcid: number | null,
		name: string,
	}[],
	locs: [
		number,
		number,
	][],
	arr5: {
		v: Uint8Array,
	}[][],
	keyframes: {
		op: number,
		time: number,
		v: ({
				arr2_index: number,
				arr2_index2: number,
				sub1: number,
				sub2: number,
				unk1: number,
				unk2: number,
			}|{
				npcindex: number,
				x: number,
				z: number,
				unkbyte: number,
				end: number,
			}|{
				npcindex: number,
			}|{
				npcindex: number,
				arr2_5_index: number,
				subindex2: number,
			}|{
				npcindex: number,
				seq: number,
				always0: number,
			}|Uint8Array|{
				locindex: number,
				x: number,
				z: number,
				plane: number,
				rotation: number,
			}|{
				locindex: number,
			}|{
				npcindex: number,
				end: number,
			}|{
				unk0: number,
				alwaysff: number,
			}|{
				sound: number,
				unk0: number,
				unk1: number,
				always1: number,
			}|Uint8Array|{
				text: string,
				unk1: number,
			}|true),
	}[],
};
