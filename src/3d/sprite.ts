

export function parseSprite(buf: Buffer) {
	let data = buf.readUInt16BE(buf.length - 2);
	let format = data >> 15;
	let count = (data & 0x7FFF);

	let spriteimgs: {
		x: number,
		y: number,
		width: number,
		height: number,
		channels: 4,
		data: Uint8Array
	}[] = [];

	if (format == 0) {
		let offset = buf.length - 7 - 8 * count;
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
		let palette = buf.slice(buf.length - 7 - 8 * count - 3 * palette_count, buf.length - 7 - 8 * count);
		if (palette[0] == 0 && palette[1] == 0 && palette[2] == 0) {
			palette[2] = 1;//yep, the game does this, i don't know why
		}
		offset = 0;
		for (let imgdef of subimgs) {
			let imgsize = imgdef.width * imgdef.height;
			if (imgsize != 0) {
				let flags = buf.readUInt8(offset); offset++;
				let transposed = (flags & 1) != 0;
				let alpha = (flags & 2) != 0;
				let imgdata = new Uint8Array(imgsize * 4);
				let indexoffset = offset;
				let alphaoffset = offset + imgsize;
				offset += imgsize + (alpha ? imgsize : 0);

				for (let y = 0; y < imgdef.height; y++) {
					for (let x = 0; x < imgdef.width; x++) {
						let outoffset = x * 4 + y * imgdef.width * 4;
						let inoffset = (transposed ? y + x * imgdef.height : x + y * imgdef.width);

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
				spriteimgs.push({ ...imgdef, channels: 4, data: imgdata });
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

		let imgdata = new Uint8Array(width * height * 4);

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
		spriteimgs.push({ x: 0, y: 0, width, height, channels: 4, data: imgdata });
	}
	return spriteimgs;
}