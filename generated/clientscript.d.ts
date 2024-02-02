// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\clientscript.jsonc'
// run `npm run filetypes` to rebuild

export type clientscript = {
	byte0: number,
	switchsize: number,
	switches: {
		value: number,
		jump: number,
	}[][],
	longargcount: number,
	stringargcount: number,
	intargcount: number,
	locallongcount: number,
	localstringcount: number,
	localintcount: number,
	instructioncount: number,
	opcodedata: {
		opcode:number,
		imm:number,
		imm_obj:number|string|[number,number]|null,
	}[],
};
