import { parseMaterials } from "../opdecoder";

export type MaterialData = {
	textures: {
		diffuse?: number,
		specular?: number,
		metalness?: number,
		color?: number,
		normal?: number,
		compound?: number
	},
	uvAnim: { u: number, v: number } | undefined,
	vertexColors: boolean
	alphamode: "opaque" | "cutoff" | "blend",
	alphacutoff: number,
	raw: ReturnType<typeof parseMaterials["read"]> | null
}

export function defaultMaterial(): MaterialData {
	return {
		textures: {},
		uvAnim: undefined,
		vertexColors: true,
		alphamode: "opaque",
		alphacutoff: 0.1,
		raw: null
	}
}

export function materialCacheKey(matid: number, hasVertexAlpha: boolean) {
	return matid | (hasVertexAlpha ? 0x800000 : 0);
}

export function convertMaterial(data: Buffer) {
	let rawparsed = parseMaterials.read(data);

	let mat = defaultMaterial();
	mat.raw = rawparsed;

	if (rawparsed.v0) {
		let raw = rawparsed.v0;
		if (raw.diffuse) { mat.textures.diffuse = raw.diffuse; }
		if (raw.normal) { mat.textures.normal = raw.normal; }

		mat.alphamode = raw.alphamode == 0 ? "opaque" : raw.alphamode == 1 ? "cutoff" : "blend";
		if (raw.alphacutoff) { mat.alphacutoff = raw.alphacutoff / 255; }

		if (raw.animtexU || raw.animtexV) {
			let scale = 1 / (1 << 15);
			mat.uvAnim = { u: (raw.animtexU ?? 0) * scale, v: (raw.animtexV ?? 0) * scale };
		}
		// mat.vertexColors = (raw.alphamode != 2);
		mat.vertexColors = !raw.extra || raw.extra.colorint != 0;
	} else if (rawparsed.v1) {
		let raw = rawparsed.v1;
		//this is very wrong
		mat.alphamode = (raw.opaque_2 && !raw.hasUVanimU ? "cutoff" : "blend");
		mat.vertexColors = false;//!flags.ignore_vertexcol_17;
		if (raw.diffuse) { mat.textures.diffuse = raw.diffuse.texture; }
		if (raw.normal) { mat.textures.normal = raw.normal.texture; }
		if (raw.compound) { mat.textures.compound = raw.compound.texture; }
		if (raw.uvanim_u || raw.uvanim_v) {
			let scale = 1 / (1 << 15);
			mat.uvAnim = { u: (raw.uvanim_u ?? 0) * scale, v: (raw.uvanim_v ?? 0) * scale };
		}
	} else {
		throw new Error("unkown material version " + rawparsed.version);
	}
	return mat;
}
