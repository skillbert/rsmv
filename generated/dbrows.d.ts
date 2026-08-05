// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\dbrows.jsonc'
// run `npm run filetypes` to rebuild

export type dbrows = {
	rows?: {
		columncount: number,
		columndata: {
			columnid: number,
			flags: number,
			subcount: number,
			subtypes: number[],
			rows: (string|number)[][],
		}[],
	} | null
	table?: number | null
};
