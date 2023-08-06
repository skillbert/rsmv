import { HSL2RGBfloat, packedHSL2HSL } from "../utils";
import { parse } from "../opdecoder";
import type { materials } from "../../generated/materials";
import type { CacheFileSource } from "cache";

type TextureRepeatMode = "clamp" | "repeat" | "mirror";

export type MaterialData = {
	textures: {
		diffuse?: number,
		normal?: number,
		compound?: number
	},
	texmodes: TextureRepeatMode,
	texmodet: TextureRepeatMode,
	uvAnim: { u: number, v: number } | undefined,
	baseColorFraction: number
	baseColor: [number, number, number],
	alphamode: "opaque" | "cutoff" | "blend",
	alphacutoff: number,
	stripDiffuseAlpha: boolean,
	raw: materials | null
}

export function defaultMaterial(): MaterialData {
	return {
		textures: {},
		texmodes: "repeat",
		texmodet: "repeat",
		uvAnim: undefined,
		baseColorFraction: 0,
		baseColor: [1, 1, 1],
		alphamode: "opaque",
		alphacutoff: 0.1,
		stripDiffuseAlpha: false,
		raw: null
	}
}

export function materialCacheKey(matid: number, hasVertexAlpha: boolean, minimapVariant: boolean) {
	return (matid == -1 ? 0x3fffff : matid) | (hasVertexAlpha ? 0x800000 : 0) | (minimapVariant ? 0x400000 : 0);
}

export function convertMaterial(data: Buffer, materialid: number, source: CacheFileSource) {
	let rawparsed = parse.materials.read(data, source);

	let mat = defaultMaterial();
	mat.raw = rawparsed;

	if (rawparsed.v0) {
		let raw = rawparsed.v0;
		let olddiffuse = raw.arr.find(q => q.op == 1);
		if (olddiffuse) {
			//in caches after this the diffuse prop exists, but is ignored...
			if (source.getBuildNr() <= 838) {
				mat.textures.diffuse = olddiffuse.value;
			} else {
				mat.textures.diffuse = materialid;
			}
		} else if (raw.diffuse) {
			mat.textures.diffuse = raw.diffuse;
		} else if (raw.textureflags & 0x11) {
			mat.textures.diffuse = materialid;
		}
		if (raw.normal) {
			mat.textures.normal = raw.normal;
		} else if (raw.textureflags & 0x0a) {
			mat.textures.normal = materialid;
		}

		let repeatu = raw.texrepeatflags & 0x7;
		let repeatv = (raw.textureflags >> 2) & 0x7;
		mat.texmodes = repeatu == 0 ? "mirror" : repeatu == 1 ? "repeat" : "clamp";
		mat.texmodet = repeatv == 0 ? "mirror" : repeatv == 1 ? "repeat" : "clamp";

		mat.alphamode = raw.alphamode == 0 ? "opaque" : raw.alphamode == 1 ? "cutoff" : "blend";
		if (raw.alphacutoff) { mat.alphacutoff = raw.alphacutoff / 255; }

		if (raw.animtexU || raw.animtexV) {
			let scale = 1 / (1 << 15);
			mat.uvAnim = { u: (raw.animtexU ?? 0) * scale, v: (raw.animtexV ?? 0) * scale };
		}
		if (raw.extra) {
			mat.baseColorFraction = raw.extra.baseColorFraction / 255;
			//seems like 0 is a special case, but unclear
			mat.baseColor = (raw.extra.baseColor == 0 ? [1, 1, 1] : HSL2RGBfloat(packedHSL2HSL(raw.extra.baseColor)));
		}
		mat.stripDiffuseAlpha = (mat.alphamode == "opaque");
	} else if (rawparsed.v1) {
		let raw = rawparsed.v1;
		//this is very wrong
		mat.alphamode = (raw.opaque_2 && !raw.hasUVanimU ? "cutoff" : "blend");
		mat.baseColorFraction = 1;
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
