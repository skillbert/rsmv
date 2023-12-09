import { makeImageData } from "../imgutils";
import { Stream } from "../utils";

export type SubImageData = {
	x: number,
	y: number,
	fullwidth: number,
	fullheight: number,
	img: ImageData
}

export function parseSubsprite(buf: Buffer, palette: Buffer, width: number, height: number, alpha: boolean, transposed: boolean) {
	let imgsize = width * height;
	let offset = 0;
	let imgdata = new Uint8ClampedArray(imgsize * 4);
	let indexoffset = offset;
	let alphaoffset = offset + imgsize;
	offset += imgsize + (alpha ? imgsize : 0);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let outoffset = x * 4 + y * width * 4;
			let inoffset = (transposed ? y + x * height : x + y * width);

			let pxindex = buf.readUInt8(indexoffset + inoffset);
			if (pxindex == 0) {
				imgdata[outoffset + 0] = 0;
				imgdata[outoffset + 1] = 0;
				imgdata[outoffset + 2] = 0;
				imgdata[outoffset + 3] = 0;
			} else {
				let paletteoffset = (pxindex - 1) * 3;
				imgdata[outoffset + 0] = palette[paletteoffset + 0];
				imgdata[outoffset + 1] = palette[paletteoffset + 1];
				imgdata[outoffset + 2] = palette[paletteoffset + 2];
				imgdata[outoffset + 3] = alpha ? buf.readUInt8(alphaoffset + inoffset) : 255;
			}
		}
	}
	return {
		img: makeImageData(imgdata, width, height),
		bytesused: offset
	}
}

export function parseLegacySprite(metafile: Buffer, buf: Buffer) {
	let file = new Stream(buf);
	let metaoffset = file.readUShort(true);
	if (!metafile) { throw new Error("sprite meta file not found"); }

	let meta = new Stream(metafile);
	meta.skip(metaoffset);

	let totalwidth = meta.readUShort(true);
	let totalheight = meta.readUShort(true);
	let palettecount = meta.readUByte() - 1;
	let palette = meta.readBuffer(palettecount * 3);

	let imgs: SubImageData[] = [];
	while (!file.eof()) {
		let offsetx = meta.readUByte();
		let offsety = meta.readUByte();
		let width = meta.readUShort(true);
		let height = meta.readUShort(true);
		let transpose = meta.readUByte() != 0;

		let imgbytes = file.readBuffer(width * height);
		imgs.push({
			x: offsetx,
			y: offsety,
			fullwidth: totalwidth,
			fullheight: totalheight,
			img: parseSubsprite(imgbytes, palette, width, height, false, transpose).img
		});
	}

	if (imgs.length != 1) {
		console.log(imgs);
	}

	return imgs[0];
}

export function expandSprite(subimg: SubImageData) {
	if (subimg.x == 0 && subimg.y == 0 && subimg.fullwidth == subimg.img.width && subimg.fullheight == subimg.img.height) {
		return subimg.img;
	}
	let img = new ImageData(subimg.fullwidth, subimg.fullheight);
	for (let dy = 0; dy < subimg.img.height; dy++) {
		let instride = subimg.img.width * 4;
		let inoffset = dy * instride;
		let outstride = img.width * 4;
		let outoffset = (dy + subimg.y) * outstride + subimg.x * 4;
		img.data.set(subimg.img.data.subarray(inoffset, inoffset + instride), outoffset);
	}
	return img;
}

export function parseSprite(buf: Buffer) {
	let data = buf.readUInt16BE(buf.length - 2);
	let format = data >> 15;
	let count = (data & 0x7FFF);

	let spriteimgs: SubImageData[] = [];

	if (format == 0) {
		let footsize = 7 + 8 * count;
		let offset = buf.length - footsize;
		let maxwidth = buf.readUInt16BE(offset); offset += 2;
		let maxheight = buf.readUInt16BE(offset); offset += 2;
		let palette_count = buf.readUInt8(offset); offset++;
		let subimgs: { x: number, y: number, width: number, height: number }[] = [];
		for (let subimg = 0; subimg < count; subimg++) {
			subimgs.push({
				x: buf.readUInt16BE(offset + count * 0 + subimg * 2),
				y: buf.readUInt16BE(offset + count * 2 + subimg * 2),
				width: buf.readUInt16BE(offset + count * 4 + subimg * 2),
				height: buf.readUInt16BE(offset + count * 6 + subimg * 2),
			});
		}
		let palette = buf.slice(buf.length - footsize - 3 * palette_count, buf.length - footsize);
		// if (palette[0] == 0 && palette[1] == 0 && palette[2] == 0) {
		// 	palette[2] = 1;//yep, the game does this, i don't know why
		// }
		offset = 0;
		for (let imgdef of subimgs) {
			if (imgdef.width != 0 && imgdef.height != 0) {
				let flags = buf.readUInt8(offset); offset++;
				let transposed = (flags & 1) != 0;
				let alpha = (flags & 2) != 0;
				let subimg = parseSubsprite(buf.slice(offset), palette, imgdef.width, imgdef.height, alpha, transposed);
				offset += subimg.bytesused;
				spriteimgs.push({
					x: imgdef.x,
					y: imgdef.y,
					fullwidth: maxwidth,
					fullheight: maxheight,
					img: subimg.img
				});
			}
		}
	} else {
		let offset = 0;
		let type = buf.readUInt8(offset); offset++;
		if (type != 0) { throw new Error("unknown type"); }
		let flags = buf.readUInt8(offset); offset++;
		let alpha = (flags & 1) != 0;
		let width = buf.readUInt16BE(offset); offset += 2;
		let height = buf.readUInt16BE(offset); offset += 2;

		let coloroffset = offset;
		offset += width * height * 3;
		let alphaoffset = offset;
		offset += (alpha ? width * height : 0);

		let imgdata = new Uint8ClampedArray(width * height * 4);

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				let outoffset = x * 4 + y * width * 4;
				let inoffset = x + y * width;

				imgdata[outoffset + 0] = buf.readUInt8(coloroffset + inoffset * 3 + 0);
				imgdata[outoffset + 1] = buf.readUInt8(coloroffset + inoffset * 3 + 1);
				imgdata[outoffset + 2] = buf.readUInt8(coloroffset + inoffset * 3 + 2);
				imgdata[outoffset + 3] = alpha ? buf.readUInt8(alphaoffset + inoffset + 2) : 255;
			}
		}
		spriteimgs.push({
			x: 0,
			y: 0,
			fullwidth: width,
			fullheight: height,
			img: makeImageData(imgdata, width, height)
		});
	}
	return spriteimgs;
}

export function parseTgaSprite(file: Buffer) {
	let str = new Stream(file);
	let idlength = str.readUByte();
	let colormaptype = str.readUByte();
	let datatypecode = str.readUByte();
	let colormapoffset = str.readUShort(false);
	let colormaplen = str.readUShort(false);
	let colormapdepth = str.readUByte();
	let originx = str.readUShort(false);
	let originy = str.readUShort(false);
	let width = str.readUShort(false);
	let height = str.readUShort(false);
	let bpp = str.readUByte();
	let imgdescr = str.readUByte();
	str.skip(idlength);//possible text content
	if (colormaptype != 1 || bpp != 8) { throw new Error("only palette based uncompressed TGA supported"); }
	if (colormapdepth != 24) { throw new Error("only 24bpp rgb TGA supported"); }
	if (imgdescr != 0) { throw new Error("no fancy TGA's allowed"); }

	let palette = str.readBuffer(colormaplen * 3);
	let imgdata = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let outoffset = x * 4 + y * width * 4;
			let pxindex = str.readUByte();
			let paletteoffset = pxindex * 3;
			//bgr->rgb flip!!
			imgdata[outoffset + 0] = palette[paletteoffset + 2];
			imgdata[outoffset + 1] = palette[paletteoffset + 1];
			imgdata[outoffset + 2] = palette[paletteoffset + 0];
			imgdata[outoffset + 3] = 255;

			//jagex treats 255,0,255 as transparent
			if (imgdata[outoffset + 0] == 255 && imgdata[outoffset + 1] == 0 && imgdata[outoffset + 2] == 255) {
				imgdata[outoffset + 0] = 0;
				imgdata[outoffset + 1] = 0;
				imgdata[outoffset + 2] = 0;
				imgdata[outoffset + 3] = 0;
			}
		}
	}

	if (!str.eof) {
		console.warn("didn't parse TGA sprite to completion");
	}
	let r: SubImageData = {
		x: originx,
		y: originy,
		fullwidth: width,
		fullheight: height,
		img: makeImageData(imgdata, width, height)
	};
	return r;
}