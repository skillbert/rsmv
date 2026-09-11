// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\framemaps.jsonc'
// run `npm run filetypes` to rebuild

export type framemaps = {
	datalen: number,
	unkheader: (number|0),
	data: {
		type: number,
		unknown: boolean,
		unknown_always_FFFF: number,
		length: number,
		data: number[],
	}[],
	bonecount: number,
	unkbyte: number,
	skeleton: {
		parentbone: number,
		bonematrix: number[],
		unkbuffer: Uint8Array,
		bonematrix2: number[] | null,
		unkextra0: number | null,
		unkextra1: number | null,
		unkextra2: number | null,
		unkextra3: number | null,
		unkextra4: number | null,
		unkextra5: number | null,
	}[],
	unkarr: number[],
	foot: number,
};
