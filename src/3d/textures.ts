import { fileToImageData, makeImageData } from "../imgutils";
import { loadDds, loadKtx } from "./ddsimage";

export class ParsedTexture {
	imagefiles: Buffer[];
	stripAlpha: boolean;
	isMaterialTexture: boolean;
	type: "png" | "dds" | "bmpmips" | "ktx" | "imagedata";
	mipmaps: number;
	cachedDrawables: (Promise<HTMLImageElement | ImageBitmap> | null)[];
	cachedImageDatas: (Promise<ImageData> | null)[];
	bmpWidth = -1;
	bmpHeight = -1;
	filesize: number;

	constructor(texture: Buffer | ImageData, stripAlpha: boolean, isMaterialTexture?: boolean) {
		this.isMaterialTexture = !!isMaterialTexture;
		this.stripAlpha = stripAlpha;
		this.imagefiles = [];
		this.cachedDrawables = [];
		this.cachedImageDatas = [];
		if (texture instanceof ImageData) {
			this.filesize = texture.data.byteLength;
			this.type = "imagedata";
			this.mipmaps = 1;
			this.cachedImageDatas = [Promise.resolve(texture)];
		} else {
			this.filesize = texture.byteLength;
			let header = texture.readUint32BE(0);
			if (header == 0x89504e47) {//"%png"
				//raw png file, used by old textures in index 9 before 2015
				this.type = "png";
				this.imagefiles.push(texture);
				this.mipmaps = 1;
			} else {
				//this should be first byte of uint32BE file size, which would always be 0 if filesize<16.7mb, but it appears that this byte repr can also change into a png file
				let offset = 0;

				//peek first bytes of first image file
				let extraoffset = 0
				while (true) {
					let byte0 = texture.readUInt8(extraoffset + offset + 1 + 4 + 0);
					let byte1 = texture.readUInt8(extraoffset + offset + 1 + 4 + 1);
					if (byte0 == 0 && byte1 == 0) {
						//has no header magic, but starts by writing the width in uint32 BE, any widths under 65k have 0x0000xxxx
						this.type = "bmpmips";
						break;
					} else if (byte0 == 0x44 && byte1 == 0x44) {
						//0x44445320 "DDS "
						this.type = "dds";
						break;
					} else if (byte0 == 0x89 && byte1 == 0x50) {
						//0x89504e47 ".PNG"
						this.type = "png";
						break;
					} else if (byte0 == 0xab && byte1 == 0x4b) {
						//0xab4b5458 "«KTX"
						this.type = "ktx";
						break;
					} else if (extraoffset++ <= 1) {
						continue;
					}
					throw new Error(`failed to detect texture`);
				}
				if (extraoffset == 1) {
					let numtexs = texture.readUint8(offset++);
					//TODO figure this out further
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
					this.cachedImageDatas.push(null);
				}
			}
		}
	}

	toImageData(subimg = 0) {
		let res = this.cachedImageDatas[subimg];
		if (!res) {
			res = (async () => {
				const padsize = (this.isMaterialTexture ? 32 : undefined);
				if (this.type == "bmpmips") {
					let width = this.bmpWidth >> subimg;
					let height = this.bmpHeight >> subimg;
					let imgdata = loadBmp(this.imagefiles[subimg], width, height, padsize, this.stripAlpha);
					return makeImageData(imgdata.data, imgdata.width, imgdata.height);
				} else if (this.type == "png") {
					return fileToImageData(this.imagefiles[subimg], "image/png", this.stripAlpha);
				} else if (this.type == "dds") {
					let imgdata = loadDds(this.imagefiles[subimg], padsize, this.stripAlpha);
					return makeImageData(imgdata.data, imgdata.width, imgdata.height);
				} else if (this.type == "ktx") {
					let imgdata = loadKtx(this.imagefiles[subimg], padsize, this.stripAlpha);
					return makeImageData(imgdata.data, imgdata.width, imgdata.height);
				} else if (this.type == "imagedata") {
					throw new Error("image not found");
				} else {
					throw new Error("unknown format");
				}
			})();
			this.cachedImageDatas[subimg] = res;
		}
		return res;
	}

	//create a texture for use in webgl (only use this in a browser context like electron)
	async toWebgl(subimg = 0) {
		let res = this.cachedDrawables[subimg];
		if (!res) {
			if (this.type == "png") {
				res = new Promise((resolve, reject) => {
					let img = new Image();
					img.onload = () => {
						URL.revokeObjectURL(img.src);
						resolve(img);
					}
					img.onerror = reject;
					let blob = new Blob([this.imagefiles[subimg]], { type: "image/png" });
					img.src = URL.createObjectURL(blob);
				});
			} else {
				res = this.toImageData(subimg).then(q => createImageBitmap(q));
			}
			this.cachedDrawables[subimg] = res;
		}
		return res;
	}
}

function loadBmp(bmpdata: Buffer, inwidth: number, inheight: number, padsize = -1, forceOpaque = true) {
	if (padsize == -1) {
		padsize = 0;
		console.warn("cannot infer padding size on bmp textures");
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