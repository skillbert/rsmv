export const cacheMajors = {
	framemaps: 1,
	config: 2,
	mapsquares: 5,

	oldmodels: 7,
	sprites: 8,
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

	index: 255
}

//represents the largest build number that this application is aware off
//is used as default value when a cache is considered "current"
//only needs to be updated when backward incompatible code paths are added
export const latestBuildNumber = 927;

export const cacheMapFiles = {
	locations: 0,
	squares: 3,
	squaresWater: 4,
	square_nxt: 5
}

export const cacheConfigPages = {
	mapunderlays: 1,
	identityKit: 3,
	mapoverlays: 4,
	params: 11,
	environments: 29,
	animgroups: 32,
	mapscenes: 34
}