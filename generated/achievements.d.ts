// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\achievements.jsonc'
// run `npm run filetypes` to rebuild

export type achievements = {
	name?: string | null
	description?: {
		hasironman: number,
		unk0: number,
		descr: string,
		unk1: number | null,
		descr_ironman: string | null,
	} | null
	category?: number | null
	spriteId?: number | null
	runescore?: number | null
	unknown_0x06?: number | null
	rewardtext?: string | null
	subach_skills?: {
		ironman: number,
		level: number,
		text: string,
		unk_0: number,
		unk_1: number,
		skill: number,
	}[] | null
	subach_varbits?: {
		type: number,
		value: number,
		name: string,
		stepsize: number,
		varbit: number,
	}[] | null
	varbit_partial_state?: {
		type: number,
		value: number,
		name: string,
		stepsize: number,
		varbit: number,
	}[] | null
	previous_achievements?: number[] | null
	skill_reqs_2?: {
		unk0: number,
		level: number,
		name: string,
		unk1: number,
		skill: number,
	}[] | null
	progress_states?: {
		unk0: number,
		value: number,
		name: string,
		varbits: number[],
	}[] | null
	subreqs?: {
		unk0: number,
		value: number,
		name: string,
		varbits: number[],
	}[] | null
	sub_achievements?: {
		unk0: number,
		achievement: number,
	}[] | null
	subcategory?: number | null
	unk0x11?: true | null
	hidden?: number | null
	f2p?: true | null
	quest_req_for_miniquests?: number[] | null
	quest_ids?: number[] | null
	reqs23?: {
		type: number,
		varbit: number,
		stepsize: number,
		name: string | null,
		requirement: number | null,
		subbit: number,
	}[] | null
	reqs25?: {
		type: number,
		varbit: number,
		value: number,
		name: string | null,
		requirement: number | null,
		subbit: number,
	}[] | null
	unknown_0x13?: true | null
	skill_req_count?: number[] | null
	unknown_0x1D?: number | null
	subreq_count?: number[] | null
	unknown_0x1F?: number | null
	unknown_0x20?: number | null
	unknown_0x23?: true | null
	unknown_0x25?: number | null
	unknown_0x26?: true | null
};
