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
			spritename: string,
			height: number,
			width: number,
			unk: number,
			spriteid: number,
			opacityframes: [
				number,
				number,
			][],
			rotateframes: [
				number,
				number,
			][],
			translateframes: [
				number,
				number,
				number,
			][],
			scaleframes: [
				number,
				number,
				number,
			][],
		}[],
		flag1: number,
		sound: string | null,
		flag2: number,
		subtitle: string | null,
		unkbyte: number | null,
		soundid: number | null,
		extraflags: (number|0),
		extra_01: {
			start: number,
			end: number,
		} | null,
	}[],
	paddingbytes: Uint8Array,
};
