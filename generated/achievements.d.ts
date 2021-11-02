// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\achievements.json'
// run `npm run filetypes` to rebuild

export type achievements = {
	name?: string | undefined
	description?: {
		hasironman: number,
		unk0: number,
		descr: string,
		unk1: number | undefined,
		descr_ironman: string | undefined,
	} | undefined
	category?: number | undefined
	spriteId?: number | undefined
	runescore?: number | undefined
	unknown_0x06?: number | undefined
	rewardtext?: string | undefined
	subach_skills?: ({
		ironman: number,
		level: number,
		text: string,
		unk_0: number,
		unk_1: number,
		skill: number,
	})[] | undefined
	subach_varbits?: ({
		type: number,
		value: number,
		name: string,
		stepsize: number,
		varbit: number,
	})[] | undefined
	varbit_partial_state?: ({
		type: number,
		value: number,
		name: string,
		stepsize: number,
		varbit: number,
	})[] | undefined
	previous_achievements?: (number)[] | undefined
	skill_reqs_2?: ({
		unk0: number,
		level: number,
		name: string,
		unk1: number,
		skill: number,
	})[] | undefined
	progress_states?: ({
		unk0: number,
		value: number,
		name: string,
		varbits: (number)[],
	})[] | undefined
	subreqs?: ({
		unk0: number,
		value: number,
		name: string,
		varbits: (number)[],
	})[] | undefined
	sub_achievements?: ({
		unk0: number,
		achievement: number,
	})[] | undefined
	subcategory?: number | undefined
	hidden?: number | undefined
	f2p?: true | undefined
	quest_req_for_miniquests?: (number)[] | undefined
	quest_ids?: (number)[] | undefined
	reqs23?: ({
		type: number,
		varbit: number,
		stepsize: number,
		name: string | undefined,
		requirement: number | undefined,
		subbit: number,
	})[] | undefined
	reqs25?: ({
		type: number,
		varbit: number,
		value: number,
		name: string | undefined,
		requirement: number | undefined,
		subbit: number,
	})[] | undefined
	unknown_0x13?: true | undefined
	skill_req_count?: (number)[] | undefined
	unknown_0x1D?: number | undefined
	subreq_count?: (number)[] | undefined
	unknown_0x1F?: number | undefined
	unknown_0x20?: number | undefined
	unknown_0x23?: true | undefined
	unknown_0x25?: number | undefined
	unknown_0x26?: true | undefined
};
