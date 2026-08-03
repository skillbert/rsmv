// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\quests.jsonc'
// run `npm run filetypes` to rebuild

export type quests = {
	name?: string | null
	quest_list_name?: string | null
	varps?: {
		varp: number,
		startvalue: number,
		endvalue: number,
	}[] | null
	varbits?: {
		varbit: number,
		startvalue: number,
		endvalue: number,
	}[] | null
	subquest_of?: number | null
	discontinued_status?: number | null
	quest_difficulty?: number | null
	members?: true | null
	quest_points?: number | null
	start_location_path?: number[] | null
	alternate_quest_start?: number | null
	required_quests?: number[] | null
	skill_requirements?: {
		skill: number,
		level: number,
	}[] | null
	quest_point_req?: number | null
	quest_item_sprite?: number | null
	extra?: {
		prop: number,
		intvalue: number | null,
		stringvalue: string | null,
	}[] | null
};
