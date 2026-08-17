// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\dbtables.jsonc'
// run `npm run filetypes` to rebuild

export type dbtables = {
	version: number,
	unkint: number | null,
	cols: number | null,
	columndata: {
		id: number,
		flags: number,
		unkbyte: number | null,
		columns: {
			type: number,
			flagsbyte: number,
			hasdefault: (1|1|0),
			unk1: number | null,
			default: (string|number) | null,
			unk2: number | null,
		}[],
	}[] | null,
	nullbyte: number | null,
};
