// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\skeletalanim.jsonc'
// run `npm run filetypes` to rebuild

export type skeletalanim = {
	header: number,
	framebase: number,
	endtime: number,
	unk_always0: number,
	tracks: {
		unk_1to4: number,
		boneid: number,
		type_0to9: number,
		bonetype_01or3: number,
		always0: number,
		flag2: boolean,
		chunks: {
			time: number,
			value: number[],
		}[],
	}[],
};
