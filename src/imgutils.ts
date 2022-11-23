//structure similar to ImageData, but without prototype chain or clamped constraint, easy to consume with sharp

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
	if (typeof document != "undefined") {
		let cnv = document.createElement("canvas");
		cnv.width = imgdata.width;
		cnv.height = imgdata.height;
		let ctx = cnv.getContext("2d")!;
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

export async function pixelsToDataUrl(imgdata: ImageData) {
	if (typeof document != "undefined") {
		let cnv = document.createElement("canvas");
		cnv.width = imgdata.width;
		cnv.height = imgdata.height;
		let ctx = cnv.getContext("2d")!;
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


export function findImageBounds(img: ImageData | ImageData) {
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

	return { x: minx, y: miny, width: maxx - minx + 1, height: maxy - miny + 1 };
}