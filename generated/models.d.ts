// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\models.jsonc'
// run `npm run filetypes` to rebuild

export type models = {
	format: number,
	unk1: number,
	version: number,
	meshCount: number,
	unkCount0: number,
	unkCount1: number,
	unkCount2: number,
	unkCount3: number,
	meshes: {
		unkint: number,
		materialArgument: number,
		faceCount: number,
		hasVertices: number,
		hasVertexAlpha: number,
		hasFaceBones: number,
		hasBoneIds: number,
		isHidden: number,
		hasSkin: number,
		colourBuffer: Uint16Array | null,
		alphaBuffer: Uint8Array | null,
		faceboneidBuffer: Uint16Array | null,
		indexBuffers: Uint16Array[],
		vertexCount: (number|0),
		positionBuffer: Int16Array | null,
		normalBuffer: (Int8Array|Int16Array) | null,
		tagentBuffer: (Int16Array|null) | null,
		uvBuffer: (Uint16Array|Float32Array) | null,
		boneidBuffer: Uint16Array | null,
		skin: {
			skinWeightCount: number,
			skinBoneBuffer: Uint16Array,
			skinWeightBuffer: Uint8Array,
		} | null,
	}[],
	unk1Buffer: Uint8Array[],
	unk2Buffer: Uint8Array[],
	unk3Buffer: Uint8Array[],
};
