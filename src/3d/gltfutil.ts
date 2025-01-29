
export const TextEncoderPolyfill = (typeof TextEncoder != "undefined" ? TextEncoder : require("util").TextEncoder) as typeof TextEncoder;
export type vartypeEnum = 0x1400 | 0x1401 | 0x1402 | 0x1403 | 0x1404 | 0x1405 | 0x1406 | 0x140a | 0x140b;

export type ModelAttribute = {
	byteoffset: number,
	bytestride: number
	gltype: vartypeEnum,
	name: string,
	veclength: number,
	normalize: boolean,
	min: number[],
	max: number[]
};

export type ArrayBufferConstructor<T> = {
	new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): T;
	readonly BYTES_PER_ELEMENT: number;
}

type typeids = "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "f32" | "f64" | "f16";

export const glTypeIds: { [id in typeids]: { gltype: vartypeEnum, constr: ArrayBufferConstructor<any> } } = {
	i8: { gltype: 0x1400, constr: Int8Array },
	u8: { gltype: 0x1401, constr: Uint8Array },
	i16: { gltype: 0x1402, constr: Int16Array },
	u16: { gltype: 0x1403, constr: Uint16Array },
	i32: { gltype: 0x1404, constr: Int32Array },
	u32: { gltype: 0x1404, constr: Uint32Array },
	f32: { gltype: 0x1406, constr: Float32Array },
	f64: { gltype: 0x140a, constr: Float64Array },
	f16: { gltype: 0x140b, constr: null! }//yikes
}

//in js typedarrays must be aligned in memory according to their elements size
export function alignedRefOrCopy<T>(constr: ArrayBufferConstructor<T>, source: Uint8Array, offset: number, length: number) {
	let srcbuffer: ArrayBufferLike;
	let disalignment = (source.byteOffset + offset) % constr.BYTES_PER_ELEMENT;
	if (disalignment != 0) {
		//use prototype slice here since nodejs Buffer creates a new view instead of a copy
		let aligned: Uint8Array = Uint8Array.prototype.slice.call(source, offset, offset + constr.BYTES_PER_ELEMENT * length);
		srcbuffer = aligned.buffer;
		offset = aligned.byteOffset;
		//console.log(`copied for alignedRefOrCopy, bytes offset: ${disalignment}, type:${constr.name}`);
	} else {
		srcbuffer = source.buffer;
		offset = offset + source.byteOffset;
	}
	return new constr(srcbuffer, offset, length)
}

export type AttributeSoure = {
	source: { length: number, [n: number]: number },
	vecsize: number;
	newtype: keyof typeof glTypeIds;
}

export function buildAttributeBuffer<T extends { [key: string]: AttributeSoure | undefined }>(attrsources: T) {
	let format: { [key in keyof T]: { offset: number, stride: number, source: AttributeSoure } } = {} as any;
	let attributes: { [key in keyof T]: T[key] extends undefined ? never : ModelAttribute } = {} as any;
	let offset = 0;
	let totalalign = 4;
	let vertexcount = -1;
	for (let name in attrsources) {
		let attr = attrsources[name] as AttributeSoure | undefined;
		if (!attr) { continue; }
		let type = glTypeIds[attr.newtype];
		let align = Math.max(4, type.constr.BYTES_PER_ELEMENT);
		totalalign = Math.max(totalalign, align);
		offset = Math.ceil(offset / align) * align;
		format[name] = { offset: offset, stride: 0, source: attr };
		offset += type.constr.BYTES_PER_ELEMENT * attr.vecsize;
		if (vertexcount == -1) { vertexcount = attr.source.length / attr.vecsize; }
	}
	let bytestride = Math.ceil(offset / totalalign) * totalalign;
	let buffer = new Uint8Array(bytestride * vertexcount);

	for (let name in format) {
		let attr = format[name];
		let type = glTypeIds[attr.source.newtype];

		let view = new type.constr(buffer.buffer);
		let elstride = bytestride / type.constr.BYTES_PER_ELEMENT | 0;//x|0 is effectively an int31 cast, makes v8 very fast
		let vecsize = attr.source.vecsize;
		let eloffset = attr.offset / type.constr.BYTES_PER_ELEMENT | 0;
		let srcview = attr.source.source;
		let min: number[] = [];
		let max: number[] = [];

		//initialize max and min so we don't need extra branches
		for (let j = 0; j < vecsize; j++) {
			max[j] = min[j] = srcview[j];
		}
		//convert all values
		for (let i = 0; i < vertexcount; i++) {
			for (let j = 0; j < vecsize; j++) {
				let v = srcview[i * vecsize + j];
				view[i * elstride + eloffset + j] = v;
				if (v > max[j]) { max[j] = v; }
				if (v < min[j]) { min[j] = v; }
			}
		}

		attributes[name] = {
			byteoffset: attr.offset,
			bytestride: bytestride,
			gltype: type.gltype,
			min, max,
			name,
			normalize: false,
			veclength: attr.source.vecsize,
		} as ModelAttribute as any;//this cast is dumb, but typescript doesn't follow
		//attr.buffer = buffer;
	}

	return { buffer, attributes, bytestride, vertexcount };
}