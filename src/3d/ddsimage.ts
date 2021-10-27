

/**
 * @param
 * @param padding size to subtract, will auto-detect to create power of 2 sprite if left at -1 
 */
export function loadDds(filedata: Buffer, paddingsize = -1) {
	let offset = 0;
	let magic = filedata.readUInt32LE(offset); offset += 4;
	let headersize = filedata.readUInt32LE(offset); offset += 4;
	let flags = filedata.readUInt32LE(offset); offset += 4;
	let height = filedata.readUInt32LE(offset); offset += 4;
	let width = filedata.readUInt32LE(offset); offset += 4;
	let pitchorlinearsize = filedata.readUInt32LE(offset); offset += 4;
	let depth = filedata.readUInt32LE(offset); offset += 4;
	let mipmapcount = filedata.readUInt32LE(offset); offset += 4;
	offset += 11 * 4;//reserved
	offset += 8 * 4;//pixelformat
	offset += 5 * 4;//junk

	if (paddingsize == -1) {
		//if the image is square and its size has only 2 bits, one of which is 64
		//yay..
		if (width == height && (width & 64) && width.toString(2).match(/1/g)?.length == 2) {
			paddingsize = 32;
		} else {
			paddingsize = 0;
		}
	}

	//making many assumptions here about exact format
	//it is fairly unlikely that some files are different from the rest as this
	//the compressed data is fed directly to the GPU as DXT5 sRgba

	let innerwidth = width - paddingsize * 2;
	let innerheight = height - paddingsize * 2;
	let data = Buffer.alloc(innerwidth * innerheight * 4);
	dxt5data(data, innerwidth * 4, filedata, width, paddingsize, paddingsize, innerwidth, innerheight);
	return { data, width: innerwidth, height: innerheight };
}

function unpackpixel(value: number, shift: number, bits: number) {
	return (((((value >> shift) & ((1 << bits) - 1)) * 2 * 255 + (1 << bits) - 1)) / ((1 << bits) - 1) / 2)
}
function dataword(src: Uint8Array, offset: number) {
	return src[offset] | (src[offset + 1] << 8);
}

/**
 * taken from simple c++ implementation
 * not using Buffer since we might want to run this in the browser
 */
function dxt5data(targetdata: Uint8Array, targetstride: number, source: Uint8Array, sourcewidth: number, subx: number, suby: number, width: number, height: number) {
	for (let blocky = suby / 4; blocky < (suby + height) / 4; blocky++) {
		for (let blockx = subx / 4; blockx < (subx + width) / 4; blockx++) {
			let blockindex = sourcewidth / 4 * blocky + blockx;
			let dataptr = blockindex * 16;

			//can't map the source buffer to uint16 as it may not be aligned...
			let datawords0 = dataword(source, dataptr + 0);
			let datawords1 = dataword(source, dataptr + 2);
			let datawords2 = dataword(source, dataptr + 4);
			let datawords3 = dataword(source, dataptr + 6);
			let datawords4 = dataword(source, dataptr + 8);
			let datawords5 = dataword(source, dataptr + 10);
			let datawords6 = dataword(source, dataptr + 12);
			let datawords7 = dataword(source, dataptr + 14);

			let r = new Uint8Array(8);
			let g = new Uint8Array(8);
			let b = new Uint8Array(8);
			let a = new Uint8Array(8);

			r[0] = unpackpixel(datawords4, 11, 5);
			g[0] = unpackpixel(datawords4, 5, 6);
			b[0] = unpackpixel(datawords4, 0, 5);
			r[1] = unpackpixel(datawords5, 11, 5);
			g[1] = unpackpixel(datawords5, 5, 6);
			b[1] = unpackpixel(datawords5, 0, 5);
			if (datawords4 > datawords5) {
				r[2] = (2 * r[0] + r[1] + 1) / 3; g[2] = (2 * g[0] + g[1] + 1) / 3; b[2] = (2 * b[0] + b[1] + 1) / 3;
				r[3] = (r[0] + 2 * r[1] + 1) / 3; g[3] = (g[0] + 2 * g[1] + 1) / 3; b[3] = (b[0] + 2 * b[1] + 1) / 3;
			}
			else {
				r[2] = (r[0] + r[1]) / 2; g[2] = (g[0] + g[1]) / 2; b[2] = (b[0] + b[1]) / 2;
				r[3] = 0; g[3] = 0; b[3] = 0;
			}

			a[0] = unpackpixel(datawords0, 0, 8);
			a[1] = unpackpixel(datawords0, 8, 8);

			if (a[0] > a[1]) {
				for (let i = 0; i < 6; i++) {
					a[2 + i] = ((6 - i) * a[0] + (1 + i) * a[1] + 3) / 7;
				}
			}
			else {
				for (let i = 0; i < 4; i++) {
					a[2 + i] = ((4 - i) * a[0] + (1 + i) * a[1] + 2) / 5;
				}
				a[6] = 0;
				a[7] = 255;
			}

			let alphabitoffset = 0;
			let alphawordoffset = 1;
			for (let p = 0; p < 16; p++) {
				let pxoffset = (blockx * 4 + p % 4 - subx) * 4 + (blocky * 4 + (p / 4 | 0) - suby) * targetstride;
				let id = ((p < 8 ? datawords6 : datawords7) >> ((p % 8) * 2)) & 0x3;
				targetdata[pxoffset + 0] = r[id];
				targetdata[pxoffset + 1] = g[id];
				targetdata[pxoffset + 2] = b[id];

				//yikes, my best attemp at doing this with as few as possible allocs
				//i hopy v8 can make something out of this
				let alphaid = ((alphawordoffset == 1 ? datawords1 : alphawordoffset == 2 ? datawords2 : datawords3) >> alphabitoffset) & 7;
				alphabitoffset += 3;
				if (alphabitoffset >= 16) {
					alphabitoffset -= 16;
					alphawordoffset++;
					alphaid |= (alphawordoffset == 1 ? datawords1 : alphawordoffset == 2 ? datawords2 : datawords3) & (1 << (alphabitoffset - 1));
				}
				let alpha = a[alphaid];

				targetdata[pxoffset + 3] = alpha;
			}
		}
	}
}
