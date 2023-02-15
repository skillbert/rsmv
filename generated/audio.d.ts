// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\audio.jsonc'
// run `npm run filetypes` to rebuild

export type audio = {
	magic: Uint8Array,
	unk_1: number,
	unk_2: number,
	samplefreq: number,
	unk_3: number,
	chunks: {
		len: number,
		fileid: number,
		data: Buffer | null,
	}[],
};
