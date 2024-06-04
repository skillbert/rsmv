// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\dbtables.jsonc'
// run `npm run filetypes` to rebuild

export type dbtables = {
	unk01?: {
		cols: number,
		columndata: {
			id: number,
			flags: number,
			columns: {
				type: number,
				unk: number | null,
				default: (string|number) | null,
			}[],
		}[],
	} | null
	unk02?: {
		unkint: number,
		cols: number,
		columndata: {
			id: number,
			flags: number,
			unkbyte: number,
			columns: {
				type: number,
				hasdefault: number,
				unk1: number | null,
				defaultint: number | null,
				defaultstring: string | null,
				unk2: number | null,
			}[],
		}[],
	} | null
};
