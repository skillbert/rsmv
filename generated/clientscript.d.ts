// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\clientscript.jsonc'
// run `npm run filetypes` to rebuild

export type clientscript = {
	byte0: number,
	switchsize: number,
	switches: {
		value: number,
		label: number,
	}[][],
	unk0: number,
	unk1: number,
	stringargcount: number,
	intargcount: number,
	localstringcount: number,
	localintcount: number,
	instructioncount: number,
	opcodes: {
		op: number,
		imm: (number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number|number),
		imm_obj: ((number|Uint8Array|string)|number|number|null),
	}[],
};
