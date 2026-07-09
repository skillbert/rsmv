export const cacheMajors = {
	framemaps: 1,
	config: 2,
	interfaces: 3,
	mapsquares: 5,

	oldmodels: 7,
	sprites: 8,
	clientscript: 12,
	fontmetricsOld: 13,
	sounds: 14,
	objects: 16,
	enums: 17,
	npcs: 18,
	items: 19,
	sequences: 20,
	spotanims: 21,
	structs: 22,
	quickchat: 24,
	materials: 26,
	particles: 27,
	worldmap: 23,
	music: 40,
	models: 47,
	frames: 48,

	texturesOldPng: 9,
	texturesOldCompoundPng: 37,

	textures2015Png: 43,
	textures2015CompoundPng: 44,
	textures2015Dds: 45,
	textures2015CompoundPngMips: 46,
	textures2015CompoundDds: 50,
	textures2015PngMips: 51,

	texturesDds: 52,
	texturesPng: 53,
	texturesBmp: 54,
	texturesKtx: 55,

	skeletalAnims: 56,

	achievements: 57,
	fontmetrics: 58,
	vectorfonts: 59,
	cutscenes: 66,
	filenames: 67,

	index: 255
} as const;

export const internalNameFiles = {
	component: 0,
	bas: 5,
	category: 9,
	cursor: 12,
	dbrow: 14,
	dbtable: 15,
	enum: 16,
	headbar: 20,
	hitmark: 21,
	interface: 24,
	inv: 25,
	loc: 28,
	material: 32,
	model: 34,
	npc: 35,
	obj: 36,
	param: 37,
	quest: 41,
	seq: 44,
	graphic: 49,
	struct: 50,
	var_clan: 55,
	var_clan_setting: 56,
	var_client: 57,
	var_npc: 59,
	var_object: 60,
	var_player: 61,
	sound: 64,
	midi: 69,
	var_player_group: 80,
	achievement: 89,
	fontmetrics: 90,
	stylesheet: 92,
	ui_anim_curve: 96,
	ui_anim: 97,
}

//represents the largest build number that this application is aware off
//is used as default value when a cache is considered "current"
//only needs to be updated when backward incompatible code paths are added
export const latestBuildNumber = 940;

export const cacheMapFiles = {
	locations: 0,
	squares: 3,
	squaresWater: 4,
	square_nxt: 5,
	env: 6
} as const;

export const cacheConfigPages = {
	mapunderlays: 1,
	identityKit: 3,
	mapoverlays: 4,
	params: 11,
	environments: 29,
	animgroups: 32,
	mapscenes: 34,
	maplabels: 36,
	dbtables: 40,
	dbrows: 41,

	varplayer: 60,
	varnpc: 61,
	varclient: 62,
	varworld: 63,
	varregion: 64,
	varobject: 65,
	varclan: 66,
	varclansettings: 67,
	varcampaign: 68,
	varplayergroup: 75,
	varbits: 69,

	//used before 488 (feb 2008)
	locs_old: 6,
	npcs_old: 9,
	items_old: 10,
	spotanim_old: 13
} as const;

export const lastLegacyBuildnr = 377;
//unclear if there ended up being overlap with (public) rs2 since this was 12 years after rs2 release
//first known rs2 is 254
//TODO apparently there was some overlap with rs2 beta caches which are technically not possible to support because of this
export const lastClassicBuildnr = 235;