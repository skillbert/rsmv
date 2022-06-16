import type { Texture } from "three";

export type ModelModifications = {
	replaceColors?: [from: number, to: number][];
	replaceMaterials?: [from: number, to: number][];
}

export type Stream = {
	getData(): Buffer;
	skip(n: number): void;
	scanloc(): number;
	readByte(): number;
	readUByte(): number;
	readUShortSmart(): number;
	readShortSmart(): number;
	readShort(flip?: boolean): number;
	readUShort(flip?: boolean): number;
	readUInt(flip?: boolean): number;
	readUIntSmart(): number;
	readFloat(flip?: boolean, signage?: boolean): number;
	readHalf(flip?: boolean): number;
	eof(): boolean;
	bytesLeft(): number;
}

export function drawTexture(ctx: CanvasRenderingContext2D, img: ImageData | Texture | Exclude<CanvasImageSource, SVGImageElement>) {
	const cnv = ctx.canvas;
	if ("data" in img) {
		cnv.width = img.width;
		cnv.height = img.height;
		ctx.putImageData(img, 0, 0);
	} else if ("source" in img) {
		cnv.width = img.source.data.width;
		cnv.height = img.source.data.height;
		ctx.drawImage(img.source.data, 0, 0);
	} else {
		cnv.width = img.width;
		cnv.height = img.height
		ctx.drawImage(img, 0, 0);
	}
}

export function dumpTexture(img: ImageData | Texture | Exclude<CanvasImageSource, SVGImageElement>) {
	let cnv = document.createElement("canvas");
	let ctx = cnv.getContext("2d")!;
	drawTexture(ctx, img);
	cnv.style.cssText = "position:absolute;top:0px;left:0px;border:1px solid red;background:purple;";
	document.body.appendChild(cnv);
	cnv.onclick = e => cnv.remove();
}
globalThis.dumptex = dumpTexture;

export function delay(ms: number) {
	return new Promise(d => setTimeout(d, ms))
}

/**
 * used to get an array with enum typing
 */
export function arrayEnum<Q extends string>(v: Q[]) {
	return v;
}

/**
 * Used to provide literal typing of map keys while also constraining each value
 */
export function constrainedMap<Q>() {
	return function <T extends { [key: string]: Q }>(v: T) {
		return v as { [k in keyof T]: Q };
	}
}

export const Stream: { new(buf: Buffer): Stream, prototype: Stream } = function Stream(this: Stream, data: Buffer) {
	// Double check the mime type
	/*if (data[data.length - 4] != 0x4F) // O
		return null;
	else if (data[data.length - 3] != 0x42) // B
		return null;
	else if (data[data.length - 2] != 0x58) // X
		return null;
	else if (data[data.length - 1] != 0x33) // 3
		return null;*/

	var scan = 0;

	this.getData = function () {
		return data;
	}
	this.bytesLeft = function () {
		return data.length - scan;
	}
	this.eof = function () {
		if (scan > data.length) { throw new Error("reading past end of buffer"); }
		return scan >= data.length;
	}
	this.skip = function (n: number) {
		scan += n;
	}
	this.scanloc = function () {
		return scan;
	}

	this.readByte = function () {
		var val = this.readUByte();
		if (val > 127)
			return val - 256;
		return val;
	}
	this.readUShortSmart = function () {
		let byte0 = this.readUByte();
		if ((byte0 & 0x80) == 0) {
			return byte0;
		}
		let byte1 = this.readUByte();
		return ((byte0 & 0x7f) << 8) | byte1;
	}
	this.readShortSmart = function () {
		let byte0 = this.readUByte();
		let byte0val = byte0 & 0x7f;
		byte0val = (byte0 < 0x40 ? byte0 : byte0 - 0x80);
		if ((byte0 & 0x80) == 0) {
			return byte0val;
		}
		let byte1 = this.readUByte();
		return (byte0val << 8) | byte1;
	}

	this.readUIntSmart = function () {
		let byte0 = this.readUByte();
		let byte1 = this.readUByte();
		if ((byte0 & 0x80) == 0) {
			return (byte0 << 8) | byte1;
		}
		let byte2 = this.readUByte();
		let byte3 = this.readUByte();
		return ((byte0 & 0x7f) << 24) | (byte1 << 16) | (byte2 << 8) | byte3;
	}

	this.readUByte = function () {
		return data[scan++];
	}

	this.readShort = function (bigendian = false) {
		var val = this.readUShort(bigendian);
		if (val > 32767)
			return val - 65536;
		return val;
	}

	this.readUShort = function (bigendian = false) {
		if (bigendian)
			return ((data[scan++] << 8) & 0xFF00) | data[scan++];
		else
			return data[scan++] | ((data[scan++] << 8) & 0xFF00);
	}

	this.readUInt = function (bigendian = false) {
		if (bigendian)
			return ((data[scan++] << 24) & 0xFF000000) | ((data[scan++] << 16) & 0xFF0000) | ((data[scan++] << 8) & 0xFF00) | data[scan++];
		else
			return data[scan++] | ((data[scan++] << 8) & 0xFF00) | ((data[scan++] << 16) & 0xFF0000) | ((data[scan++] << 24) & 0xFF000000);
	}

	this.readFloat = function (bigendian = false, signage = false) {
		var upper, mid, lower, exponent;
		if (bigendian) {
			exponent = data[scan++];
			lower = (data[scan++] << 16) & 0xFF0000;
			mid = (data[scan++] << 8) & 0xFF00;
			upper = data[scan++];
		}
		else {
			upper = data[scan++];
			mid = (data[scan++] << 8) & 0xFF00;
			lower = (data[scan++] << 16) & 0xFF0000;
			exponent = data[scan++];
		}
		var mantissa = upper | mid | lower;
		if (signage) {
			//console.log(exponent.toString(16), mantissa.toString(16));
			exponent = (exponent << 1) & 0xFE;
			if ((mantissa & 0x800000) == 0x800000)
				exponent |= 0x1;
			mantissa &= 0x7FFFFF;
			//console.log(exponent.toString(16), mantissa.toString(16));
		}
		return (1.0 + mantissa * Math.pow(2.0, signage ? -23.0 : -24.0)) * Math.pow(2.0, exponent - 127.0);
	}

	this.readHalf = function (flip = false) {
		//TODO flip isn't even implemented?
		var upper = data[scan++];
		var lower = data[scan++];
		var mantissa = lower | ((upper << 8) & 0x0300);
		var exponent = (upper >> 2) & 0x1F;
		mantissa = mantissa * Math.pow(2.0, -10.0) + 1.0;
		mantissa *= Math.pow(2.0, exponent - 15.0);
		if ((upper & 0x80) == 0x80)
			mantissa *= -1.0;
		return mantissa;
	}

	/*var scan = data.length - 12;
	var imageScan = 0;
	var metadataScan = this.readInt();
	var modelScan = this.readInt();
	scan = modelScan;*/
} as any

// https://stackoverflow.com/a/9493060
export function HSL2RGB(hsl: number[]): [number, number, number] {
	var h = hsl[0];
	var s = hsl[1];
	var l = hsl[2];
	var r, g, b;

	if (s == 0) {
		r = g = b = l; // achromatic
	}
	else {
		var hue2rgb = function hue2rgb(p: number, q: number, t: number) {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		}

		var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		var p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}

	return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function RGB2HSL(r: number, g: number, b: number): [number, number, number] {
	r /= 255, g /= 255, b /= 255;
	var max = Math.max(r, g, b), min = Math.min(r, g, b);
	var h = 0;
	var s = 0;
	let l = (max + min) / 2;

	if (max != min) {
		var d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r: h = (g - b) / d + (g < b ? 6 : 0); break;
			case g: h = (b - r) / d + 2; break;
			case b: h = (r - g) / d + 4; break;
		}
		h /= 6;
	}
	return [h, s, l];
}

globalThis.rgb2hsl = RGB2HSL;
globalThis.hsl2rgb = HSL2RGB;
globalThis.packed2hsl = packedHSL2HSL;
globalThis.hsl2packed = HSL2packHSL;


export function HSL2packHSL(h: number, s: number, l: number) {
	if (h < 0) { h += 1; }
	return (Math.round(h * 63) << 10) | (Math.round(s * 7) << 7) | (Math.round(l * 127));
}

export function packedHSL2HSL(hsl: number) {
	var h = ((hsl >> 10) & 0x3F) / 63.0;
	var s = ((hsl >> 7) & 0x7) / 7.0;
	var l = (hsl & 0x7F) / 127.0;
	if (h > 0.5)
		h = h - 1.0;
	return [h, s, l];
}

/*function packedHSL2RGBAArray(hsl)
{
	var packedRGBA = packedHSL2RGBA(hsl);
	var rgba = [];
	rgba.push((packedRGBA      ) & 0xFF);
	rgba.push((packedRGBA >>  8) & 0xFF);
	rgba.push((packedRGBA >> 16) & 0xFF);
	rgba.push((packedRGBA >> 24) & 0xFF);
	return rgba;
}*/

// https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_model_view_projection#Perspective_matrix
export function getProjectionMatrix(fieldOfViewInRadians: number, aspectRatio: number, near: number, far: number) {
	var f = 1.0 / Math.tan(fieldOfViewInRadians / 2);
	var rangeInv = 1 / (near - far);

	return [
		f / aspectRatio, 0, 0, 0,
		0, f, 0, 0,
		0, 0, (near + far) * rangeInv, -1,
		0, 0, near * far * rangeInv * 2, 0
	];
}

export namespace Matrix4x4Utils {
	export function mul(a: number[], b: number[]) {
		var c: number[] = [];
		for (var y = 0; y < 4; ++y) {
			for (var x = 0; x < 4; ++x) {
				var sum = 0;
				for (var n = 0; n < 4; ++n) {
					sum += a[n + y * 4] * b[x + n * 4];
				}
				c.push(sum);
			}
		}
		return c;
	}

	export function identity() {
		return [
			1.0, 0.0, 0.0, 0.0,
			0.0, 1.0, 0.0, 0.0,
			0.0, 0.0, 1.0, 0.0,
			0.0, 0.0, 0.0, 1.0
		];
	}

	export function translation(x: number, y: number, z: number) {
		return [
			1.0, 0.0, 0.0, 0.0,
			0.0, 1.0, 0.0, 0.0,
			0.0, 0.0, 1.0, 0.0,
			x, y, z, 1.0
		];
	}

	export function rotation(axis: "x" | "y" | "z", angle: number) {
		var a = 0, b = 0;
		if (axis == "x") {
			a = 1;
			b = 2;
		}
		else if (axis == "y") {
			a = 0;
			b = 2;
		}
		else if (axis == "z") {
			a = 0;
			b = 1;
		}
		else
			//TODO throw here?
			return; // Incorrect axis parameter, ya basic!

		var matrix = this.identity();
		matrix[a + a * 4] = Math.cos(angle);
		matrix[b + b * 4] = Math.cos(angle);
		matrix[b + a * 4] = -Math.sin(angle);
		matrix[a + b * 4] = Math.sin(angle);
		return matrix;
	}
}

export class TypedEmitter<T extends Record<string, any>> {
	protected listeners: { [key in keyof T]?: Set<(v: T[key]) => void> } = {};
	on<K extends keyof T>(event: K, listener: (v: T[K]) => void) {
		let listeners = this.listeners[event] ?? (this.listeners[event] = new Set());
		listeners.add(listener);
	}
	once<K extends keyof T>(event: K, listener: (v: T[K]) => void) {
		let listeners = this.listeners[event] ?? (this.listeners[event] = new Set());
		let oncer = (v: T[K]) => {
			listeners.delete(oncer);
			listener(v);
		}
		listeners.add(oncer);
	}
	off<K extends keyof T>(event: K, listener: (v: T[K]) => void) {
		let listeners = this.listeners[event] ?? (this.listeners[event] = new Set());
		listeners.delete(listener);
	}
	emit<K extends keyof T>(event: K, value: T[K]) {
		let listeners = this.listeners[event] ?? (this.listeners[event] = new Set());
		listeners.forEach(cb => cb(value));
	}
}