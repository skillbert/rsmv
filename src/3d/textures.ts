import { fileToImageData, makeImageData } from "../imgutils";
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
		this.fullfile = texture;
		this.imagefiles = [];
		this.cachedDrawables = [];
		this.cachedImageDatas = [];
		this.filesize = texture.byteLength;

		//this should be first byte of uint32BE file size, which would always be 0 if filesize<16.7mb, but it appears that this byte repr can also change into a png file

		let offset = 0;

		//peek first bytes of first image file
		let foundtype = false;
		for (let extraoffset = 0; extraoffset <= 1; extraoffset++) {
			let byte0 = texture.readUInt8(extraoffset + offset + 4 + 0);
			let byte1 = texture.readUInt8(extraoffset + offset + 4 + 1);
			if (byte0 == 0 && byte1 == 0) {
				//has no header magic, but starts by writing the width in uint32 BE, any widths under 65k have 0x0000xxxx
				this.type = "bmpmips";
			} else if (byte0 == 0x44 && byte1 == 0x44) {
				//0x44445320 "DDS "
				this.type = "dds";
			} else if (byte0 == 0x89 && byte1 == 0x50) {
				//0x89504e47 ".PNG"
				this.type = "png";
			} else if (byte0 == 0xab && byte1 == 0x4b) {
				//0xab4b5458 "«KTX"
				throw new Error("KTX11 texture format currently not supported");
			} else {
				continue;
			}
			foundtype = true;
			if (extraoffset == 1) {
				let numtexs = texture.readUint8(offset++);
				//TODO figure this out further
			}
			break;
		} if (!foundtype) {
			throw new Error(`failed to detect texture`);
		}
		this.mipmaps = texture.readUInt8(offset++);

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

	toImageData(subimg = 0) {
		if (this.cachedImageDatas[subimg]) {
			return this.cachedImageDatas[subimg]!;
		}
		let res = (async () => {
			const padsize = (this.isMaterialTexture ? 32 : undefined);
			if (this.type == "bmpmips") {
				let width = this.bmpWidth >> subimg;
				let height = this.bmpHeight >> subimg;
				let imgdata = loadBmp(this.imagefiles[subimg], width, height, padsize, this.stripAlpha);
				return makeImageData(imgdata.data, imgdata.width, imgdata.height);
			} else if (this.type == "png") {
				return fileToImageData(this.imagefiles[subimg]);
			} else if (this.type == "dds") {
				let imgdata = loadDds(this.imagefiles[subimg], padsize, this.stripAlpha);
				return makeImageData(imgdata.data, imgdata.width, imgdata.height);
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