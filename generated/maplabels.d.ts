// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\maplabels.jsonc'
// run `npm run filetypes` to rebuild

export type maplabels = {
	sprite?: number | null
	sprite_hover?: number | null
	text?: string | null
	color_1?: [
		number,
		number,
		number,
	] | null
	color_2?: [
		number,
		number,
		number,
	] | null
	font_size?: number | null
	unknown_07?: number | null
	unknown_08?: number | null
	toggle_1?: {
		varbit: number,
		varp: number,
		lower: number,
		upper: number,
	} | null
	rightclick_1?: string | null
	unktext_0b?: string | null
	polygon?: {
		pointcount: number,
		points: {
			x: number,
			y: number,
		}[],
		color: [
			number,
			number,
			number,
			number,
		],
		always_1: (number|1),
		back_color: [
			number,
			number,
			number,
			number,
		],
		pointplanes: (number[]|null),
	} | null
	rightclick_2?: string | null
	category?: number | null
	toggle_2?: {
		varbit: number,
		varp: number,
		lower: number,
		upper: number,
	} | null
	unknown_15?: number | null
	unknown_16?: number | null
	background_sprite?: number | null
	legacy_switch?: {
		varbit: number,
		varp: number,
		value: number,
		default_ref: number,
		legacy_ref: number,
	} | null
	unknown_1c?: number | null
	unknown_1e?: number | null
	extra?: {
		prop: number,
		intvalue: number | null,
		stringvalue: string | null,
	}[] | null
};
