// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\cacheindex.json'
// run `npm run filetypes` to rebuild

export type cacheindex = {
	format: number,
	timestamp: number,
	flags: number,
	indices: ({
		minor: number,
	} & {
		crc: number,
	} & {
		uncompressed_crc: number,
	} & {
		size: number,
		uncompressed_size: number,
	} & {
		version: number,
	} & {
		subindexcount: number,
	} & {
		subskips: number[],
	})[],
};
