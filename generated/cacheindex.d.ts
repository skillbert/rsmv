// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\cacheindex.json'
// run `npm run filetypes` to rebuild

export type cacheindex = {
	format: number,
	timestamp: (number|0),
	flags: number,
	indices: {
		minor: number,
		name: number | null,
		crc: number,
		uncompressed_crc: number | null,
		size: number | null,
		uncompressed_size: number | null,
		encryption_or_hash: Uint8Array | null,
		version: number,
		subindexcount: number,
		subindices: number[],
		subnames: number[] | null,
	}[],
};
