import sharp from "sharp";
import { loadDds } from "./ddsimage";

export class ParsedTexture {
	fullfile: Buffer;
	imagefiles: Buffer[];
	stripAlpha: boolean;
	isMaterialTexture: boolean | undefined;
	type: "png" | "dds" | "bmpmips";
	mipmaps: number;
	cachedDrawables: (Promise<HTMLImageElement | ImageBitmap> | null)[];
	cachedImageDatas: (Promise<ImageData> | null)[];
	bmpWidth = -1;
	bmpHeight = -1;
	filesize: number;

	constructor(texture: Buffer, stripAlpha: boolean, isMaterialTexture?: boolean) {
		this.isMaterialTexture = isMaterialTexture;
		this.stripAlpha = stripAlpha;
		this.mipmaps = texture.readUInt8(0x0);
		this.fullfile = texture;
		this.imagefiles = [];
		this.cachedDrawables = [];
		this.cachedImageDatas = [];
		this.filesize = texture.byteLength;

		//first bytes of first file
		let byte0 = texture.readUInt8(0x5);
		let byte1 = texture.readUInt8(0x6);
		if (byte0 == 0 && byte1 == 0) {
			//has no header magic, but starts by writing the width in uint32 BE, any widths under 65k have 0x0000xxxx
			this.type = "bmpmips";
		} else if (byte0 == 0x44 && byte1 == 0x44) {
			//0x44445320 "DDS "
			this.type = "dds";
		} else if (byte0 == 0x89 && byte1 == 0x50) {
			//0x89504e47 ".PNG"
			this.type = "png";
		} else {
			throw new Error(`unknown texture format bytes ${byte0.toString(16).padStart(2, "0")} ${byte1.toString(16).padStart(2, "0")}`);
		}

		let offset = 1;
		if (this.type == "bmpmips") {
			this.bmpWidth = texture.readUInt32BE(offset); offset += 4;
			this.bmpHeight = texture.readUInt32BE(offset); offset += 4;
		}
		for (let i = 0; i < this.mipmaps; i++) {
			let compressedsize: number;
			if (this.type == "bmpmips") {
				compressedsize = (this.bmpWidth >> i) * (this.bmpHeight >> i) * 4;
			} else {
				compressedsize = texture.readUInt32BE(offset);
				offset += 4;
			}
			this.imagefiles.push(texture.slice(offset, offset + compressedsize))
			offset += compressedsize;
			this.cachedDrawables.push(null);
			this.cachedImageDatas.push(null)
		}
	}

	static fromFile(headerlessFiles: Buffer[]) {
		let chunks: Uint8Array[] = [new Uint8Array([headerlessFiles.length])];
		for (let file of headerlessFiles) {
			let size = Buffer.alloc(4);
			size.writeUInt32BE(file.byteLength, 0);
			chunks.push(size);
			chunks.push(file);
		}
		//theoretically the concat approach can save a zero-ing pass
		let fullfile = Buffer.concat(chunks);
		return new ParsedTexture(fullfile, false);//TODO still get alpha somehow
	}

	async convertFile(type: "png" | "webp", subimg = 0) {
		if (this.type == type) { return this.imagefiles[subimg]; }

		let img: sharp.Sharp;
		if (this.type == "bmpmips") {
			img = sharp(this.imagefiles[subimg], {
				raw: {
					width: this.bmpWidth >> subimg,
					height: this.bmpHeight >> subimg,
					channels: 4
				}
			})
		}
		else if (this.type == "dds") {
			let imgdata = loadDds(this.imagefiles[subimg], undefined, this.stripAlpha);
			img = sharp(imgdata.data, {
				raw: {
					width: imgdata.width,
					height: imgdata.height,
					channels: 4
				}
			});
		} else {
			img = sharp(this.imagefiles[subimg]);
		}

		if (type == "png") img.png();
		else if (type == "webp") img.webp();
		else throw new Error("unknown format " + type);
		return img.toBuffer();
	}

	toImageData(subimg = 0) {
		if (this.cachedImageDatas[subimg]) {
			return this.cachedImageDatas[subimg]!;
		}
		//TODO polyfill imagedata in nodejs, just need {width,height,data}
		let res = (async () => {
			const padsize = (this.isMaterialTexture ? 32 : undefined);
			if (this.type == "bmpmips") {
				let width = this.bmpWidth >> subimg;
				let height = this.bmpHeight >> subimg;
				let imgdata = loadBmp(this.imagefiles[subimg], width, height, padsize, this.stripAlpha);
				let pixbuf = new Uint8ClampedArray(imgdata.data.buffer, imgdata.data.byteOffset, imgdata.data.byteLength);
				return new ImageData(pixbuf, imgdata.width, imgdata.height);
			} else if (this.type == "png") {
				let img = sharp(this.imagefiles[subimg]);
				let decoded = await img.raw().toBuffer({ resolveWithObject: true });
				let pixbuf = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
				return new ImageData(pixbuf, decoded.info.width, decoded.info.height);
			} else if (this.type == "dds") {
				let imgdata = loadDds(this.imagefiles[subimg], padsize, this.stripAlpha);
				let pixbuf = new Uint8ClampedArray(imgdata.data.buffer, imgdata.data.byteOffset, imgdata.data.byteLength);
				return new ImageData(pixbuf, imgdata.width, imgdata.height);
			} else {
				throw new Error("unknown format");
			}
		})()
		this.cachedImageDatas[subimg] = res;
		return res;
	}

	//create a texture for use in webgl (only use this in a browser context like electron)
	async toWebgl(subimg = 0) {
		if (this.cachedDrawables[subimg]) {
			return this.cachedDrawables[subimg]!;
		}
		if (this.type == "png") {
			this.cachedDrawables[subimg] = new Promise((resolve, reject) => {
				let img = new Image();
				img.onload = () => {
					URL.revokeObjectURL(img.src);
					resolve(img);
				}
				img.onerror = reject;
				let blob = new Blob([this.imagefiles[subimg]], { type: "image/png" });
				img.src = URL.createObjectURL(blob);
			})
		} else {
			let img = this.toImageData(subimg);
			this.cachedDrawables[subimg] = img.then(i => createImageBitmap(i));
		}
		return this.cachedDrawables[subimg]!;
	}
}

function loadBmp(bmpdata: Buffer, inwidth: number, inheight: number, padsize = -1, forceOpaque = true) {
	if (padsize == -1) {
		throw new Error("cannot infer padding size on bmp textures");
	}
	const instride = inwidth * 4;
	const inoffset = padsize * instride + padsize * 4;
	const outheight = inheight - 2 * padsize;
	const outwidth = inwidth - 2 * padsize;
	const outstride = outwidth * 4;
	const out = new Uint8Array(outstride * outheight);
	for (let y = 0; y < outheight; y++) {
		const target = y * outstride;
		out.set(bmpdata.subarray(inoffset + instride * y, inoffset + instride * y + outstride), target);
		if (forceOpaque) {
			for (let d = target; d < target + outstride; d += 4) {
				out[d + 3] = 255;
			}
		}
	}
	return { data: out, width: outwidth, height: outheight };
}