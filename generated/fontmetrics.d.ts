// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\fontmetrics.jsonc'
// run `npm run filetypes` to rebuild

export type fontmetrics = {
	type: number,
	sprite: {
		complexkerning: number,
		sourceid: (number|-1),
		chars: {
			width: number,
			height: number,
			bearingy: number,
		}[],
		sheetwidth: number,
		sheetheight: number,
		positions: {
			x: number,
			y: number,
		}[],
		baseline: (0|number),
		uppercaseascent: number,
		median: number,
		maxascent: number,
		maxdescent: number,
		scale: number,
	} | null,
	vector: {
		sourceid: number,
		size: number,
	} | null,
};
