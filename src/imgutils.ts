//structure similar to ImageData, but without prototype chain or clamped constraint, easy to consume with sharp

import type { Texture } from "three";

export type CanvasImage = Exclude<CanvasImageSource, SVGImageElement | VideoFrame>;

export function makeImageData(data: Uint8ClampedArray | Uint8Array | null, width: number, height: number): ImageData {
	if (!data) {
		data = new Uint8ClampedArray(width * height * 4);
	}
	if (data instanceof Uint8Array) {
		data = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
	}
	if (typeof ImageData != "undefined") {
		return new ImageData(data, width, height);
	} else {
		return { data, width, height, colorSpace: "srgb" };
	}
}

export async function pixelsToImageFile(imgdata: ImageData, format: "png" | "webp", quality: number) {
	if (typeof HTMLCanvasElement != "undefined") {
		let cnv = document.createElement("canvas");
		cnv.width = imgdata.width;
		cnv.height = imgdata.height;
		let ctx = cnv.getContext("2d", { willReadFrequently: true })!;
		ctx.putImageData(imgdata, 0, 0);
		return canvasToImageFile(cnv, format, quality);
	} else {
		const sharp = require("sharp") as typeof import("sharp");
		let img = sharp(imgdata.data, { raw: { width: imgdata.width, height: imgdata.height, channels: 4 } });
		if (format == "png") {
			return img.png().toBuffer();
		} else if (format == "webp") {
			return img.webp({ quality: quality * 100 }).toBuffer();
		} else {
			throw new Error("unknown format");
		}
	}
}


let warnedstripalpha = false;
export async function fileToImageData(file: Uint8Array, mimetype: "image/png" | "image/jpg", stripAlpha: boolean) {
	if (typeof ImageDecoder != "undefined") {
		//typescript claims premultiplyAlpha option doesn't exist
		let decoder = new ImageDecoder({ data: file, type: mimetype, premultiplyAlpha: (stripAlpha ? "none" : "default"), colorSpaceConversion: "none" } as any);
		let frame = await decoder.decode();
		let pixels = new Uint8Array(frame.image.allocationSize());
		frame.image.copyTo(pixels);
		let pixelcount = frame.image.visibleRect!.width * frame.image.visibleRect!.height;
		if (frame.image.format == "BGRX" || frame.image.format == "RGBX") {
			stripAlpha = true;
		}
		if (frame.image.format == "BGRA" || frame.image.format == "BGRX") {
			for (let i = 0; i < pixelcount; i++) {
				let tmp = pixels[i * 4 + 0];
				pixels[i * 4 + 0] = pixels[i * 4 + 2];
				pixels[i * 4 + 1] = pixels[i * 4 + 1];
				pixels[i * 4 + 2] = tmp;
				pixels[i * 4 + 3] = (stripAlpha ? 255 : pixels[i * 4 + 3]);
			}
		} else if (frame.image.format == "RGBA" || frame.image.format == "RGBX") {
			if (stripAlpha) {
				for (let i = 0; i < pixelcount; i++) {
					pixels[i * 4 + 3] = 255;
				}
			}
		} else {
			throw new Error("unexpected image format");
		}
		return makeImageData(pixels, frame.image.visibleRect!.width, frame.image.visibleRect!.height);
	} else if (typeof HTMLCanvasElement != "undefined") {
		if (stripAlpha && !warnedstripalpha) {
			console.warn("can not strip alpha in browser context that does not support ImageDecoder");
		}
		let img = new Image();
		let blob = new Blob([file], { type: mimetype });
		let url = URL.createObjectURL(blob);
		img.src = url;
		await img.decode();
		let cnv = document.createElement("canvas");
		cnv.width = img.naturalWidth;
		cnv.height = img.naturalHeight;
		let ctx = cnv.getContext("2d", { willReadFrequently: true })!;
		ctx.drawImage(img, 0, 0);
		URL.revokeObjectURL(url);
		return ctx.getImageData(0, 0, cnv.width, cnv.height);
	} else {
		const sharp = require("sharp") as typeof import("sharp");
		let img = sharp(file);
		if (stripAlpha) { img.removeAlpha(); }
		let decoded = await img.raw().toBuffer({ resolveWithObject: true });
		let pixbuf = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
		return makeImageData(pixbuf, decoded.info.width, decoded.info.height);
	}
}

export async function pixelsToDataUrl(imgdata: ImageData) {
	if (typeof HTMLCanvasElement != "undefined") {
		let cnv = document.createElement("canvas");
		cnv.width = imgdata.width;
		cnv.height = imgdata.height;
		let ctx = cnv.getContext("2d", { willReadFrequently: true })!;
		ctx.putImageData(imgdata, 0, 0);
		return cnv.toDataURL("image/png");
	} else {
		const sharp = require("sharp") as typeof import("sharp");
		let pngfile = await sharp(imgdata.data, { raw: { width: imgdata.width, height: imgdata.height, channels: 4 } }).png().toBuffer();
		return "data:image/png;base64," + pngfile.toString("base64");
	}
}

export function isImageEqual(overlay: ImageData, background: ImageData, x1 = 0, y1 = 0, width = overlay.width, height = overlay.height) {
	if (overlay.width != background.width || overlay.height != background.height) {
		throw new Error("only equal sized images supported");
	}
	let adata = overlay.data;
	let bdata = background.data;

	let x2 = x1 + width;
	let y2 = y1 + height;

	let stride = 4 * overlay.width;
	for (let yy = y1; yy < y2; yy++) {
		for (let xx = x1; xx < x2; xx++) {
			let i = xx * 4 + yy * stride;
			let d = Math.abs(adata[i + 0] - bdata[i + 0])
				+ Math.abs(adata[i + 1] - bdata[i + 1])
				+ Math.abs(adata[i + 2] - bdata[i + 2])
				+ Math.abs(adata[i + 3] - bdata[i + 3])
			if (d >= 5) { return false; }
		}
	}
	return true;
}

export function maskImage(img: ImageData, rects: { x: number, y: number, width: number, height: number }[]) {
	//set all alpha to 0
	for (let i = 0; i < img.data.length; i += 4) {
		img.data[i + 3] = 0;
	}
	//set alphas inside our rects to 255
	for (let rect of rects) {
		let stride = img.height * 4;
		for (let dy = 0; dy < rect.height; dy++) {
			for (let dx = 0; dx < rect.width; dx++) {
				let i = (rect.x + dx) * 4 + (rect.y + dy) * stride;
				img.data[i + 3] = 255;
			}
		}
	}
	//also clear rgb for pixels that still have 0 alpha
	//this helps with image compression in some cases
	for (let i = 0; i < img.data.length; i += 4) {
		if (img.data[i + 3] == 0) {
			img[i + 0] = 0;
			img[i + 0] = 1;
			img[i + 0] = 2;
		}
	}
}

export function isImageEmpty(img: ImageData, mode: "black" | "transparent", x1 = 0, y1 = 0, width = img.width, height = img.height) {
	let intview = new Uint32Array(img.data.buffer, img.data.byteOffset, img.data.byteLength / 4);
	let mask = (mode == "black" ? 0xffffffff : 0xff);
	let target = 0;

	let x2 = x1 + width;
	let y2 = y1 + height;
	let stride = img.width;
	for (let yy = y1; yy < y2; yy++) {
		for (let xx = x1; xx < x2; xx++) {
			let i = xx + yy * stride;
			if ((intview[i] & mask) != target) {
				return false;
			}
		}
	}
	return true;
}

export async function canvasToImageFile(cnv: HTMLCanvasElement, format: "png" | "webp", quality: number) {
	let blob = await new Promise<Blob | null>(r => cnv.toBlob(r, `image/${format}`, quality));
	if (!blob) { throw new Error("image compression failed"); }
	let buf = await blob.arrayBuffer();
	return Buffer.from(buf);
}

export function flipImage(img: ImageData) {
	let stride = img.width * 4;
	let tmp = new Uint8Array(stride);
	for (let y = 0; y < img.height / 2; y++) {
		let itop = y * stride;
		let ibot = (img.height - 1 - y) * stride;
		tmp.set(img.data.slice(itop, itop + stride), 0);
		img.data.copyWithin(itop, ibot, ibot + stride);
		img.data.set(tmp, ibot);
	}
}

export function sliceImage(img: ImageData, bounds: { x: number, y: number, width: number, height: number }) {
	let newdata = new Uint8ClampedArray(bounds.width * bounds.height * 4);
	let newstride = bounds.width * 4;
	let oldstride = img.width * 4;
	let oldoffset = oldstride * bounds.y + bounds.x * 4;
	for (let y = 0; y < bounds.height; y++) {
		newdata.set(img.data.slice(oldoffset + y * oldstride, oldoffset + y * oldstride + newstride), newstride * y);
	}
	return new ImageData(newdata, bounds.width, bounds.height);
}

export function findImageBounds(img: ImageData) {
	let intview = new Uint32Array(img.data.buffer, img.data.byteOffset, img.data.byteLength / 4);

	let minx = img.width, maxx = 0;
	let miny = img.height, maxy = 0;

	for (let y = 0; y < img.height; y++) {
		let scany = y * img.width;
		for (let x = 0; x < img.width; x++) {
			let i = scany + x;
			if (intview[i] != 0) {
				minx = Math.min(x, minx);
				maxx = Math.max(x, maxx);
				miny = Math.min(y, miny);
				maxy = Math.max(y, maxy);
			}
		}
	}

	if (maxx < minx || maxy < miny) {
		minx = miny = 0;
		maxx = maxy = -1;
	}

	return { x: minx, y: miny, width: maxx - minx + 1, height: maxy - miny + 1 };
}

export function dumpTexture(img: ImageData | Texture | CanvasImage, flip = false) {
	let cnv = document.createElement("canvas");
	let ctx = cnv.getContext("2d", { willReadFrequently: true })!;
	if (flip) {
		if (!(img instanceof ImageData)) { throw new Error("can only flip imagedata textures"); }
		flipImage(img);
	}
	drawTexture(ctx, img);
	cnv.style.cssText = "position:absolute;top:0px;left:0px;border:1px solid red;background:purple;";
	document.body.appendChild(cnv);
	cnv.onclick = e => {
		navigator.clipboard.write([
			new ClipboardItem({ 'image/png': new Promise<Blob>(d => cnv.toBlob(d as any)) })
		]);
		cnv.remove();
	}
	return cnv;
}

globalThis.dumptex = dumpTexture;


export function drawTexture(ctx: CanvasRenderingContext2D, img: ImageData | Texture | CanvasImage) {
	const cnv = ctx.canvas;
	if ("data" in img) {
		if (typeof ImageData != "undefined" && !(img instanceof ImageData)) {
			//@ts-ignore
			img = new ImageData(img.data, img.width, img.height);
		}
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