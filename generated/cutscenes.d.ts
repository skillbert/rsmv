// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\cutscenes.jsonc'
// run `npm run filetypes` to rebuild

export type cutscenes = {
	version: number,
	width: number,
	height: number,
	unkhead: number,
	elements: {
		name: string,
		start: number,
		end: number,
		flag0: number,
		graphics: {
			img: string,
			height: number,
			width: number,
			unk: number,
			unk2: number,
			matrix0: [
				number,
				number,
			][],
			matrix1: [
				number,
				number,
			][],
			matrix2: [
				number,
				number,
				number,
			][],
			matrix3: [
				number,
				number,
				number,
			][],
		}[],
		flag1: number,
		sound: string | null,
		flag2: number,
		subtitle: string | null,
		unkbytes: Uint8Array | null,
		extraflags: (number|0),
		extra_01: {
			start: number,
			end: number,
		} | null,
	}[],
	paddingbytes: Uint8Array,
};
