// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\objects.jsonc'
// run `npm run filetypes` to rebuild

export type objects = {
	models?: ({
			type: number,
			values: (number|number)[],
		}[]|{
			values: (number|number)[],
			type: number,
		}[]) | null
	name?: string | null
	examine?: string | null
	models_05?: ({
			models: {
				type: number,
				values: (number|number)[],
			}[],
			unktail: [
				(number|number),
				(number|number),
			][],
		}|{
			models: {
				type: 10,
				values: (number|number)[],
				unktail: [
					(number|number),
					(number|number),
				][],
			}[],
		}) | null
	width?: number | null
	length?: number | null
	probably_nocollision?: true | null
	maybe_allows_lineofsight?: true | null
	deletable?: boolean | null
	probably_morphFloor?: true | null
	unknown_16?: true | null
	occludes_1?: false | null
	probably_animation?: number | null
	maybe_blocks_movement?: true | null
	wallkit_related_1C?: number | null
	ambient?: number | null
	actions_0?: string | null
	actions_1?: string | null
	actions_2?: string | null
	actions_3?: string | null
	actions_4?: string | null
	contrast?: number | null
	color_replacements?: [
		number,
		number,
	][] | null
	material_replacements?: [
		number,
		number,
	][] | null
	recolourPalette?: number[] | null
	unknown_2C?: number | null
	unknown_2D?: number | null
	unknown_36?: true | null
	unknown_37?: true | null
	unknown_38?: true | null
	unknown_39?: true | null
	unknown_3c?: number | null
	mirror?: true | null
	unknown_40?: true | null
	scaleX?: number | null
	scaleY?: number | null
	scaleZ?: number | null
	mapscene_old?: number | null
	dummy_45?: number | null
	translateX?: number | null
	translateY?: number | null
	translateZ?: number | null
	unknown_49?: true | null
	unknown_4A?: true | null
	unknown_4B?: number | null
	morphs_1?: {
		unk1: number,
		unk2: (number|number)[],
		unk3: (number|number),
	} | null
	light_source_related_4E?: {
		maybe_color: number,
		maybe_radius: number,
	} | null
	unknown_4F?: {
		unknown_1: number,
		unknown_2: number,
		unknown_3: number,
		unknown_4: number[],
	} | null
	unknown_51?: number | null
	unknown_52?: true | null
	is_members?: true | null
	unknown_59?: true | null
	unknown_5A?: true | null
	isMembers?: true | null
	morphs_2?: {
		unk1: number,
		unk2: (number|number),
		unk3: (number|number)[],
		unk4: (number|number),
	} | null
	tilt_xz?: [
		number,
		number,
	] | null
	under_water?: true | null
	probably_morphCeilingOffset?: (number|0) | null
	unknown_60?: true | null
	ground_decoration_related_61?: true | null
	has_animated_texture?: true | null
	dummy_63?: {
		unknown_2: number,
		unknown_1: number,
	} | null
	dummy_64?: {
		unknown_2: number,
		unknown_1: number,
	} | null
	unused_65?: number | null
	mapscene?: number | null
	occludes_2?: false | null
	interactable_related_68?: number | null
	invertMapScene?: true | null
	headModels?: {
		model: number,
		unknown_2: number,
	}[] | null
	mapFunction?: number | null
	unknown_71?: number | null
	members_action_1?: string | null
	members_action_2?: string | null
	members_action_3?: string | null
	members_action_4?: string | null
	members_action_5?: string | null
	unknown_A0?: number[] | null
	singleuse_A2?: number | null
	unknown_A3?: {
		unknown_1: number,
		unknown_2: number,
		unknown_3: number,
		unknown_4: number,
	} | null
	singleuse_A4?: number | null
	singleuse_A5?: number | null
	singleuse_A6?: number | null
	floor_thickness?: number | null
	unused_a8?: true | null
	unused_a9?: true | null
	wallkit_related_AA?: number | null
	possibly_wallkit_skew_AB?: number | null
	lightsource_related_AD?: {
		unknown_1: number,
		unknown_2: number,
	} | null
	can_change_color?: true | null
	unknown_B2?: number | null
	unknown_BA?: number | null
	dummy_bc?: true | null
	treerockordoor_BD?: true | null
	action_cursors_0?: number | null
	action_cursors_1?: number | null
	action_cursors_2?: number | null
	action_cursors_3?: number | null
	action_cursors_4?: number | null
	action_cursors_5?: number | null
	tileplacement_related_c4?: number | null
	clan_citadel_C5?: number | null
	invisible_c6?: true | null
	flooroverlay_c7?: true | null
	singleuse_C8?: true | null
	unknown_C9?: {
		unknown_1: number,
		unknown_2: number,
		unknown_3: number,
		unknown_4: number,
		unknown_5: number,
		unknown_6: number,
	} | null
	singleuse_CA?: number | null
	unknown_CB?: true | null
	unknown_CC?: Uint8Array[] | null
	extra?: {
		prop: number,
		intvalue: number | null,
		stringvalue: string | null,
	}[] | null
};
