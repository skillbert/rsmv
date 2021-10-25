import { Stream } from "../utils";

//TODO stream es6 class
function Spec_0(material: any) {
	var spec = 0x0;
	this.unk1 = material.readUByte();
	this.texSize = material.readUShort();
	this.unk2 = material.readUShort();
	this.flags = material.readUByte();
	this.maps = {};

	if ((this.flags & 0x01) == 0x01 || (this.flags & 0x10) == 0x10)
		this.maps["diffuseId"] = material.readUInt(true);
	if ((this.flags & 0x02) == 0x02 || (this.flags & 0x08) == 0x08)
		this.maps["normalId"] = material.readUInt(true);

	this.unk3 = material.readUInt();

	this.flags2 = material.readUByte();

	if ((this.flags2 & 0x0c) == 0x0c) {
		if ((this.flags2 & 0x10) == 0x10)
			this.unk4 = { "unk5": material.readFloat(true, true), "unk6": material.readFloat(true, true) };

		this.unk7 = material.readUByte();

		if ((this.flags & 0x10) == 0x10)
			this.unk8 = material.readUByte();
		if ((this.flags & 0x02) == 0x02)
			this.unk9 = material.readFloat(true, true);
		if ((this.flags & 0x01) == 0x01)
			this.unkA = material.readUByte();

		this.unkB = material.readUByte();
		if (this.unkB == 1)
			this.unkC = material.readUByte();

		this.unkD = material.readUByte();
		if (this.unkD == 1 || this.unkD == 2)
			this.unkE = material.readUShort(true);
		else if (this.unkD == 3) {
			this.unkE = material.readUShort(true);
			this.unkF = material.readUShort(true);
		}

		this.unk10 = material.readUByte();

		if (this.unk10 == 1) {
			this.unk11 = "";
			for (var i = 0; i < 11; ++i) {
				var val = material.readUByte().toString(16);
				if (val.length == 1)
					val = "0" + val;
				this.unk11 += val;
			}
			this.specular = material.readUByte();
			this.metalness = material.readUByte();
			this.colour = material.readUShort(true);
			return;
		}
		else if (this.unk10 == 0)
			return;
	}
}

function Spec_190411_Flags(flags: number) {
	var flags = flags;
	this.unk0x1 = (flags & 0x1);
	this.unk0x2 = ((flags >> 1) & 0x1);
	this.unk0x4 = ((flags >> 2) & 0x1);
	this.unk0x8 = ((flags >> 3) & 0x1);

	this.unk0x10 = ((flags >> 4) & 0x1);
	this.hasDiffuse = ((flags >> 5) & 0x1); // Does the material have a diffuse map? Yes. Yes it does.
	this.hasNormal = ((flags >> 6) & 0x1); // Does the material have a normal map?
	this.hasCompound = ((flags >> 7) & 0x1); // Does the material have a compound map?

	this.unk0x100 = ((flags >> 8) & 0x1);
	this.unk0x200 = ((flags >> 9) & 0x1);
	this.unk0x400 = ((flags >> 10) & 0x1);
	this.unk0x800 = ((flags >> 11) & 0x1);

	this.unk0x1000 = ((flags >> 12) & 0x1);
	this.unk0x2000 = ((flags >> 13) & 0x1);
	this.unk0x4000 = ((flags >> 14) & 0x1);
	this.unk0x8000 = ((flags >> 15) & 0x1);

	this.unk0x10000 = ((flags >> 16) & 0x1);
	this.unk0x20000 = ((flags >> 17) & 0x1);
	this.unk0x40000 = ((flags >> 18) & 0x1);
	this.unk0x80000 = ((flags >> 19) & 0x1);

	this.unk0x100000 = ((flags >> 20) & 0x1);
	this.unk0x200000 = ((flags >> 21) & 0x1);
	this.unk0x400000 = ((flags >> 22) & 0x1);
	this.unk0x800000 = ((flags >> 23) & 0x1);
}

//TODO stream es6 class
function Spec_190411(material: any) {
	this.spec = 0x1;
	this.flags = new Spec_190411_Flags(material.readUInt(true));
	this.maps = {};
	if (this.flags.hasDiffuse) {
		this.maps["diffuseSize"] = Math.pow(2.0, 6 + material.readUByte()); // Not always correct, tf Jagex??
		this.maps["diffuseId"] = material.readUInt(true);
	}
	if (this.flags.hasNormal) {
		this.maps["normalSize"] = Math.pow(2.0, 6 + material.readUByte());
		this.maps["normalId"] = material.readUInt(true);
	}
	if (this.flags.hasCompound) {
		this.maps["compoundSize"] = Math.pow(2.0, 6 + material.readUByte());
		this.maps["compoundId"] = material.readUInt(true);
	}

	if (this.flags.unk0x2000)
		this.unkF1 = material.readFloat(true, true);
	if (this.flags.unk0x4000)
		this.unkUI1 = material.readUInt(true);
	if (this.flags.unk0x8000)
		this.unkF2 = material.readFloat(true, true);
	if (this.flags.unk0x800) {
		this.unkV1 = material.readFloat(true, true);
		this.unkV2 = material.readFloat(true, true);
		this.unkV3 = material.readFloat(true, true);
	}
	if (this.flags.hasNormal)
		this.unkF3 = material.readFloat(true, true); // Pertains to normals somehow
	if (this.flags.unk0x10000)
		this.unkF4 = material.readFloat(true, true);
	if (this.flags.unk0x20000)
		this.unkF5 = material.readFloat(true, true);
	if (this.flags.unk0x100)
		this.unkH1 = material.readHalf(true);
	if (this.flags.unk0x200)
		this.unkH2 = material.readHalf(true);

	/*if data[ss + 3] == 0x01:
		ss += 1

	ss += 6*/
}

//TODO these are two different classes with no overlap, ob3.ts correctly picks the right implementation using external data
export type JMatInternal = {
	specular: number,
	metalness: number,
	colour: number,
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

export interface JMat {
	new(data: Buffer): JMat;
	get(): JMatInternal;
}

//TODO make propper classes here
//@ts-ignore
export const JMat: JMat = function (data: Buffer) {
	var internal = null;

	var material = new Stream(data);
	var spec = material.readUByte();
	switch (spec) {
		case 0x0:
			internal = new Spec_0(material);
			break;
		case 0x01:
			internal = new Spec_190411(material);
			break
		default:
			console.log("New jmat spec found, panic or something! (Or contact someone who knows something about WebGLoop)");
	}

	this.get = function () {
		return internal;
	}
}