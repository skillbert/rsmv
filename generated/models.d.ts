// GENERATED DO NOT EDIT
// This source data is located at '..\src\opcodes\models.json'
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
		groupFlags: number,
		materialArgument: number,
		hasVertices: number,
		hasVertexAlpha: number,
		hasFaceBones: number,
		hasBoneIds: number,
		isHidden: number,
		hasFlaf20: number,
		colourBuffer: number[] | null,
		alphaBuffer: number[] | null,
		faceboneidBuffer: number[] | null,
		indexBuffers: number[][],
		vertexCount: number | null,
	}[],
	unk1Buffer: number[][],
	unk2Buffer: number[][],
	unk3Buffer: number[][],
};
