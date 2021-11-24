import { number } from "cmd-ts";
import { Stream, packedHSL2HSL, HSL2RGB } from "./utils";

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
	raw: any
}

export function defaultMaterial(): MaterialData {
	return {
		textures: {},
		uvAnim: undefined,
		vertexColors: true,
		alphamode: "opaque",
		alphacutoff: 0.1,
		raw: {}
	}
}

export function materialCacheKey(matid: number, hasVertexAlpha: boolean) {
	return matid | (hasVertexAlpha ? 0x800000 : 0)
}

//TODO stream es6 class
function Spec_0(material: Stream): MaterialData {
	let mat = defaultMaterial();
	mat.raw.unk1 = material.readUByte();
	mat.raw.texSize = material.readUShort();
	mat.raw.unk2 = material.readUShort();
	let flags = material.readUByte();
	mat.raw.flags = flags;

	if ((flags & 0x01) || (flags & 0x10))
		mat.textures.diffuse = material.readUInt(true);
	if ((flags & 0x02) || (flags & 0x08))
		mat.textures.normal = material.readUInt(true);

	//3=skybox
	mat.raw.unk3 = material.readUInt();

	let flags2 = material.readUByte();
	mat.raw.flags2 = flags2;

	if ((flags2 & 0x0c) == 0x0c) {
		if ((flags2 & 0x10) == 0x10)
			mat.raw.unk4 = { "unk5": material.readFloat(true, true), "unk6": material.readFloat(true, true) };

		mat.raw.unk7 = material.readUByte();

		if ((flags & 0x10) == 0x10)
			mat.raw.unk8 = material.readUByte();
		if ((flags & 0x02) == 0x02)
			mat.raw.unk9 = material.readFloat(true, true);
		if ((flags & 0x01) == 0x01)
			mat.raw.unkA = material.readUByte();

		//0=opaque, 1=binary with cutoff, 2=full
		let alphaMode = material.readUByte();
		mat.alphamode = alphaMode == 0 ? "opaque" : alphaMode == 1 ? "cutoff" : "blend";
		// if (unkB == 1)//wtf this flag never even existed in code
		// 	mat.raw.mat.raw.unkC_maybe_alpha_cutoff = material.readUByte();

		let hasTexAnim = material.readUByte();
		if (hasTexAnim & 3) {
			let scale = 1 / (1 << 15);
			mat.uvAnim = {
				u: (hasTexAnim & 1 ? material.readShort(true) * scale : 0),
				v: (hasTexAnim & 2 ? material.readShort(true) * scale : 0)
			}
		}

		let unk10 = material.readUByte();

		if (unk10 == 1) {
			let unk11 = "";
			for (var i = 0; i < 10; ++i) {
				var val = material.readUByte().toString(16);
				if (val.length == 1)
					val = "0" + val;
				unk11 += val;
			}
			mat.raw.unk11 = unk11;
			let probably_forceOpaque = material.readUByte();
			mat.raw.probably_forceOpaque = probably_forceOpaque;
			if (!probably_forceOpaque) { mat.alphamode = "blend"; }
			mat.raw.specular = material.readUByte();
			mat.raw.metalness = material.readUByte();
			mat.raw.colourInt = material.readUShort(true);
			mat.vertexColors = mat.raw.colourInt != 0;
			mat.raw.colour = HSL2RGB(packedHSL2HSL(mat.raw.colourInt));
		} else if (unk10 == 0) {
			//more stuff?
		}
	}
	if (material.scanloc() != material.getData().length) {
		mat.raw.extrabytes = material.getData().slice(material.scanloc());
		console.log(mat, "mat0 extra bytes", mat.raw.extrabytes);
	}
	return mat;
}

function Spec_190411_Flags(flags: number) {
	let hasbit = (bitnr: number) => (flags & (1 << bitnr)) != 0;

	return {
		unk0: hasbit(0),
		unk1: hasbit(1),
		opaque_2: hasbit(2),
		unk3: hasbit(3),

		unk4: hasbit(4),
		hasDiffuse: hasbit(5),
		hasNormal: hasbit(6),
		hasCompound: hasbit(7),

		maybe_uvanim_8: hasbit(8),
		unk9: hasbit(9),
		unk10: hasbit(10),
		unk11: hasbit(11),

		unk12: hasbit(12),
		unk13: hasbit(13),
		unk14: hasbit(14),
		unk15: hasbit(15),

		unk16: hasbit(16),
		ignore_vertexcol_17: hasbit(17),
		unk18: hasbit(18),
		unk19: hasbit(19),

		unk20: hasbit(20),
		unk21: hasbit(21),
		unk22: hasbit(22),
		unk23: hasbit(23),

		unk24: hasbit(24),
		unk25: hasbit(25),
		unk26: hasbit(26),
		unk27: hasbit(27),

		unk28: hasbit(28),
		unk29: hasbit(29),
		unk30: hasbit(30),
		unk31: hasbit(31),
	};
}

//TODO stream es6 class
function Spec_190411(material: Stream) {
	let mat = defaultMaterial();
	let flags = Spec_190411_Flags(material.readUInt(true));
	//this is very wrong
	mat.alphamode = (flags.opaque_2 && !flags.maybe_uvanim_8 ? "cutoff" : "blend");
	mat.vertexColors = false;//!flags.ignore_vertexcol_17;
	mat.raw.flags = flags;
	if (flags.hasDiffuse) {
		mat.raw.diffuseSize = Math.pow(2.0, 6 + material.readUByte()); // Not always correct, tf Jagex??
		mat.textures.diffuse = material.readUInt(true);
	}
	if (flags.hasNormal) {
		mat.raw.normalSize = Math.pow(2.0, 6 + material.readUByte());
		mat.textures.normal = material.readUInt(true);
	}
	if (flags.hasCompound) {
		mat.raw.compoundSize = Math.pow(2.0, 6 + material.readUByte());
		mat.textures.compound = material.readUInt(true);
	}

	if (flags.unk13)
		mat.raw.unkF1 = material.readFloat(true, true);
	if (flags.unk14)
		mat.raw.unkUI1 = material.readUInt(true);
	if (flags.unk15)
		mat.raw.unkF2 = material.readFloat(true, true);
	if (flags.unk11) {
		mat.raw.unkV1 = material.readFloat(true, true);
		mat.raw.unkV2 = material.readFloat(true, true);
		mat.raw.unkV3 = material.readFloat(true, true);
	}
	if (flags.hasNormal)
		mat.raw.unkF3 = material.readFloat(true, true); // Pertains to normals somehow
	if (flags.unk16)
		mat.raw.unkF4 = material.readFloat(true, true);
	if (flags.ignore_vertexcol_17)
		mat.raw.unkF5 = material.readFloat(true, true);
	if (flags.maybe_uvanim_8)
		mat.raw.unkH1 = material.readHalf(true);
	if (flags.unk9)
		mat.raw.unkH2 = material.readHalf(true);

	//idk what this is
	/*if data[ss + 3] == 0x01:
		ss += 1

	ss += 6*/
	if (material.scanloc() != material.getData().length) {
		mat.raw.extrabytes = material.getData().slice(material.scanloc());
		console.log(mat, "mat1 extra bytes", mat.raw.extrabytes);
	}
	return mat;
}

//TODO these are two different classes with no overlap, ob3.ts correctly picks the right implementation using external data
type JMatInternal = {
	specular: number,
	metalness: number,
	colour: number,
	alphaMode: number,
	//}|{
	flags: {
		hasDiffuse: boolean,
		hasNormal: boolean,
		hasCompound: boolean
	},
	maps: {
		diffuseId: number,
		normalId: number,
		compoundId: number
	}
}


export function JMat(data: Buffer) {
	var stream = new Stream(data);
	var spec = stream.readUByte();
	switch (spec) {
		case 0x0:
			return Spec_0(stream);
		case 0x01:
			return Spec_190411(stream);
		default:
			throw new Error("unknown material version");
	}
}