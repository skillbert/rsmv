// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\quickchatlines.jsonc'
// run `npm run filetypes` to rebuild

export type quickchatlines = {
	text?: string | null
	replies?: number[] | null
	inserts?: {
		type: number,
		pickEnum: number | null,
		pickTtem: true | null,
		skillLevel: number | null,
		varplayerEnum: {
			enum: number,
			varbit: number,
		} | null,
		varplayer: number | null,
		varbit: number | null,
		pickTradeableItem: true | null,
		skillLevelEnum: {
			enum: number,
			skill: number,
		} | null,
		friendsChatCount: true | null,
		varWorld: number | null,
		combatlevel: true | null,
		varbitEnumstring: {
			enum: number,
			varbit: number,
		} | null,
	}[] | null
	nonsearchable?: true | null
};
