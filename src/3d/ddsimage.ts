

/**
 * @param
 * @param padding size to subtract, will auto-detect to create power of 2 sprite if left at -1 
 */
export function loadDds(filedata: Buffer, paddingsize = -1, forceOpaque = true) {
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
	let encoding = filedata.readUInt32LE(offset + 0x08);//grab encoding from picelformat
	offset += 8 * 4;//pixelformat
	offset += 5 * 4;//junk

	let isDxt5 = encoding == 0x35545844;//DXT5
	let isDxt1 = encoding == 0x31545844;//DXT1

	if (!isDxt1 && !isDxt5) {
		console.log("dds file is not dxt1 or dxt5 encoded as expected, continuing as dxt5");
		isDxt5 = true;
	}

	if (paddingsize == -1) {
		//dxt5 textures go into the texture mega-atlas (4k x 4k) and have pre-applied padding pixels
		//dxt1 textures are used in separate textures (cubemaps mostly?) and have hardware padding/wrapping
		if (isDxt5) { paddingsize = 32; }
		else { paddingsize = 0; }
	}
	//making many assumptions here about exact format
	//it is fairly unlikely that some files are different from the rest as this
	//the compressed data is fed directly to the GPU as DXT5 sRgba

	let innerwidth = width - paddingsize * 2;
	let innerheight = height - paddingsize * 2;
	let data = Buffer.alloc(innerwidth * innerheight * 4);
	dxtdata(data, innerwidth * 4, filedata, width, paddingsize, paddingsize, innerwidth, innerheight, isDxt5);
	
	//opaque textures are stored with random data in their [a] channel, this causes many
	//problem for different render pipelines
	//TODO find the material flag that enables transparency
	if (forceOpaque) {
		for (let i = 0; i < data.length; i += 4) {
			data[i + 3] = 255;
		}
	}
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
function dxtdata(targetdata: Uint8Array, targetstride: number, source: Uint8Array, sourcewidth: number, subx: number, suby: number, width: number, height: number, isDxt5: boolean) {
	const bytesperblock = isDxt5 ? 16 : 8;
	const coloroffset = isDxt5 ? 8 : 0;

	//prealloc these so we don't do it in a hot loop
	const r = new Uint8Array(4);
	const g = new Uint8Array(4);
	const b = new Uint8Array(4);
	const a = new Uint8Array(8);
	const datawords = new Uint16Array(8);
	for (let blocky = suby / 4; blocky < (suby + height) / 4; blocky++) {
		for (let blockx = subx / 4; blockx < (subx + width) / 4; blockx++) {
			let blockindex = sourcewidth / 4 * blocky + blockx;
			let dataptr = blockindex * bytesperblock;

			//can't map the source buffer to uint16 as it may not be aligned...
			datawords[4] = dataword(source, dataptr + coloroffset + 0);
			datawords[5] = dataword(source, dataptr + coloroffset + 2);
			datawords[6] = dataword(source, dataptr + coloroffset + 4);
			datawords[7] = dataword(source, dataptr + coloroffset + 6);


			r[0] = unpackpixel(datawords[4], 11, 5);
			g[0] = unpackpixel(datawords[4], 5, 6);
			b[0] = unpackpixel(datawords[4], 0, 5);
			r[1] = unpackpixel(datawords[5], 11, 5);
			g[1] = unpackpixel(datawords[5], 5, 6);
			b[1] = unpackpixel(datawords[5], 0, 5);

			a[0] = 255; a[1] = 255; a[2] = 255; a[3] = 255;
			if (datawords[4] > datawords[5]) {
				r[2] = (2 * r[0] + r[1] + 1) / 3; g[2] = (2 * g[0] + g[1] + 1) / 3; b[2] = (2 * b[0] + b[1] + 1) / 3;
				r[3] = (r[0] + 2 * r[1] + 1) / 3; g[3] = (g[0] + 2 * g[1] + 1) / 3; b[3] = (b[0] + 2 * b[1] + 1) / 3;
			}
			else {
				r[2] = (r[0] + r[1]) / 2; g[2] = (g[0] + g[1]) / 2; b[2] = (b[0] + b[1]) / 2;
				r[3] = 0; g[3] = 0; b[3] = 0;
				a[3] = 0;//<- the only time that alpha is touched in dxt1!
			}

			for (let p = 0; p < 16; p++) {
				let pxoffset = (blockx * 4 + p % 4 - subx) * 4 + (blocky * 4 + (p / 4 | 0) - suby) * targetstride;
				let id = (datawords[p < 8 ? 6 : 7] >> ((p % 8) * 2)) & 0x3;
				targetdata[pxoffset + 0] = r[id];
				targetdata[pxoffset + 1] = g[id];
				targetdata[pxoffset + 2] = b[id];
				targetdata[pxoffset + 3] = a[id];
			}

			if (isDxt5) {
				datawords[0] = dataword(source, dataptr + 0);
				datawords[1] = dataword(source, dataptr + 2);
				datawords[2] = dataword(source, dataptr + 4);
				datawords[3] = dataword(source, dataptr + 6);

				a[0] = unpackpixel(datawords[0], 0, 8);
				a[1] = unpackpixel(datawords[0], 8, 8);

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
					let alphaid = (datawords[alphawordoffset] >> alphabitoffset) & 7;
					alphabitoffset += 3;
					if (alphabitoffset >= 16) {
						alphabitoffset -= 16;
						alphawordoffset++;
						alphaid |= datawords[alphawordoffset] & (1 << (alphabitoffset - 1));
					}

					targetdata[pxoffset + 3] = a[alphaid];
				}
			}
		}
	}
}
