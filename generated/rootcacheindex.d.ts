// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\rootcacheindex.jsonc'
// run `npm run filetypes` to rebuild

export type rootcacheindex = {
	cachemajors: ({
			minor: number,
			crc: number,
			version: number,
			subindexcount: (number|0),
			integer_10: (number|0),
			maybe_checksum1: Uint8Array,
		}[]|{
			minor: number,
			crc: number,
			version: (number|0),
			subindexcount: 0,
		}[]),
	maybe_proper_checksum: Uint8Array,
};
