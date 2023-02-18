
function flipEndian32(int: number) {
	return ((int & 0xff) << 24) | ((int & 0xff00) << 8) | ((int & 0xff0000) >>> 8) | ((int & 0xff000000) >>> 24);
}

export function readKtx(filedata: Buffer) {
	//https://registry.khronos.org/KTX/specs/1.0/ktxspec.v1.html
	let offset = 0;
	let magic0 = filedata.readUInt32BE(offset); offset += 4;//0xab4b5458
	let magic1 = filedata.readUInt32BE(offset); offset += 4;//0x203131bb
	let magic2 = filedata.readUInt32BE(offset); offset += 4;//0x0d0a1a0a
	let endianbytes = filedata.readUint32BE(offset); offset += 4;
	let littleendian = endianbytes != 0x04030201;
	let getuint = () => {
		let v = filedata.readUint32BE(offset);
		offset += 4;
		return (littleendian ? flipEndian32(v) : v);
	}
	let glType = getuint();
	let glTypeSize = getuint();
	let glFormat = getuint();
	let glInternalFormat = getuint();
	let glBaseInternalFormat = getuint();
	let pixelWidth = getuint();
	let pixelHeight = getuint();
	let pixelDepth = getuint();
	let numberOfArrayElements = getuint();
	let numberOfFaces = getuint();
	let numberOfMipmapLevels = getuint();
	let bytesOfKeyValueData = getuint();

	offset += bytesOfKeyValueData;

	let isEtcAlpha = glInternalFormat == 0x9278;//GL_COMPRESSED_RGBA8_ETC2_EAC
	let isEtc = glInternalFormat == 0x9274;//GL_COMPRESSED_RGB8_ETC2

	if (!isEtc && !isEtcAlpha) {
		throw new Error("dds file is not dxt1 or dxt5 encoded as expected, continuing as dxt5");
		// isDxt5 = true;
	}
	let mips: { width: number, height: number, data: Buffer }[] = [];
	for (let i = 0; i < numberOfMipmapLevels; i++) {
		let mipwidth = pixelWidth >> i;
		let mipheight = pixelHeight >> i;
		// let datasize = mipwidth * mipheight * (isDxt5 ? 16 : 8);
		let datasize = getuint();
		mips.push({
			width: mipwidth,
			height: mipheight,
			data: filedata.slice(offset, offset + datasize)
		});
		offset += datasize;
	}

	return { isDxt1: isEtc, isDxt5: isEtcAlpha, mips, width: pixelWidth, height: pixelHeight };
}

export function readDds(filedata: Buffer) {
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
		throw new Error("dds file is not dxt1 or dxt5 encoded as expected, continuing as dxt5");
		// isDxt5 = true;
	}
	let mips: { width: number, height: number, data: Buffer }[] = [];
	for (let i = 0; i < mipmapcount; i++) {
		let mipwidth = width >> i;
		let mipheight = height >> i;
		let datasize = mipwidth * mipheight * (isDxt5 ? 16 : 8);
		mips.push({
			width: mipwidth,
			height: mipheight,
			data: filedata.slice(offset, offset + datasize)
		});
		offset += datasize;
	}

	return { magic, flags, height, width, pitchorlinearsize, depth, isDxt1, isDxt5, mips };
}

/**
 * @param
 * @param padding size to subtract, will auto-detect to create power of 2 sprite if left at -1 
 */
export function loadDds(filedata: Buffer, paddingsize = -1, forceOpaque = true) {
	let parsedfile = readDds(filedata);

	if (paddingsize == -1) {
		//dxt5 textures go into the texture mega-atlas (4k x 4k) and have pre-applied padding pixels
		//dxt1 textures are used in separate textures (cubemaps mostly?) and have hardware padding/wrapping
		if (parsedfile.isDxt5) { paddingsize = 32; }
		else { paddingsize = 0; }
	}
	//making many assumptions here about exact format
	//it is fairly unlikely that some files are different from the rest as this
	//the compressed data is fed directly to the GPU as DXT5 sRgba

	let innerwidth = parsedfile.width - paddingsize * 2;
	let innerheight = parsedfile.height - paddingsize * 2;
	let data = Buffer.alloc(innerwidth * innerheight * 4);
	dxtdata(data, innerwidth * 4, parsedfile.mips[0].data, parsedfile.mips[0].width, paddingsize, paddingsize, innerwidth, innerheight, parsedfile.isDxt5);

	//opaque textures are stored with random data in their [a] channel, this causes many
	//problem for different render pipelines
	//TODO find the material flag that enables transparency
	if (forceOpaque) {
		for (let i = 0; i < data.length; i += 4) {
			data[i + 3] = 255;//TODO make this depend on material flags
		}
	}
	return { data, width: innerwidth, height: innerheight };
}

/**
 * @param
 * @param padding size to subtract, will auto-detect to create power of 2 sprite if left at -1 
 */
export function loadKtx(filedata: Buffer, paddingsize = -1, forceOpaque = true) {
	let parsedfile = readKtx(filedata);

	if (paddingsize == -1) {
		//dxt5 textures go into the texture mega-atlas (4k x 4k) and have pre-applied padding pixels
		//dxt1 textures are used in separate textures (cubemaps mostly?) and have hardware padding/wrapping
		if (parsedfile.isDxt5) { paddingsize = 32; }
		else { paddingsize = 0; }
	}
	//making many assumptions here about exact format
	//it is fairly unlikely that some files are different from the rest as this
	//the compressed data is fed directly to the GPU as DXT5 sRgba

	let innerwidth = parsedfile.width - paddingsize * 2;
	let innerheight = parsedfile.height - paddingsize * 2;
	let data = Buffer.alloc(innerwidth * innerheight * 4);
	etc2data(data, innerwidth * 4, parsedfile.mips[0].data, parsedfile.mips[0].width, paddingsize, paddingsize, innerwidth, innerheight, parsedfile.isDxt5);

	//opaque textures are stored with random data in their [a] channel, this causes many
	//problem for different render pipelines
	//TODO find the material flag that enables transparency
	if (forceOpaque) {
		for (let i = 0; i < data.length; i += 4) {
			data[i + 3] = 255;//TODO make this depend on material flags
		}
	}
	return { data, width: innerwidth, height: innerheight };
}

function unpackpixel(value: number, shift: number, bits: number) {
	return (((((value >> shift) & ((1 << bits) - 1)) * 2 * 255 + (1 << bits) - 1)) / ((1 << bits) - 1) / 2)
}
function selectbits(value: number, shift: number, bits: number) {
	let preshift = 32 - bits - shift;
	return (value << preshift) >>> (preshift + shift);
}
function selectsignedbits(value: number, shift: number, bits: number) {
	let preshift = 32 - bits - shift;
	return (value << preshift) >> (preshift + shift);
}
function uint16le(src: Uint8Array, offset: number) {
	return src[offset] | (src[offset + 1] << 8);
}
function uint32be(src: Uint8Array, offset: number) {
	return ((src[offset] << 24) | (src[offset + 1] << 16) | (src[offset + 2] << 8) | (src[offset + 3])) >>> 0;//unsigned 0 shift to force unsigned
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
			datawords[4] = uint16le(source, dataptr + coloroffset + 0);
			datawords[5] = uint16le(source, dataptr + coloroffset + 2);
			datawords[6] = uint16le(source, dataptr + coloroffset + 4);
			datawords[7] = uint16le(source, dataptr + coloroffset + 6);


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
				datawords[0] = uint16le(source, dataptr + 0);
				datawords[1] = uint16le(source, dataptr + 2);
				datawords[2] = uint16le(source, dataptr + 4);
				datawords[3] = uint16le(source, dataptr + 6);

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

//takes weird signedness of index bits of the spec into account
const etc2offsets = new Int16Array([
	2, 8, -2, -8,
	5, 17, -5, -17,
	9, 29, -9, -29,
	13, 42, -13, -42,
	18, 60, -18, -60,
	24, 80, -24, -80,
	33, 106, -33, -106,
	47, 183, -47, -183,
]);

const etc2alphas = new Int8Array([
	-3, -6, -9, -15, 2, 5, 8, 14,
	-3, -7, -10, -13, 2, 6, 9, 12,
	-2, -5, -8, -13, 1, 4, 7, 12,
	-2, -4, -6, -13, 1, 3, 5, 12,
	-3, -6, -8, -12, 2, 5, 7, 11,
	-3, -7, -9, -11, 2, 6, 8, 10,
	-4, -7, -8, -11, 3, 6, 7, 10,
	-3, -5, -8, -11, 2, 4, 7, 10,
	-2, -6, -8, -10, 1, 5, 7, 9,
	-2, -5, -8, -10, 1, 4, 7, 9,
	-2, -4, -8, -10, 1, 3, 7, 9,
	-2, -5, -7, -10, 1, 4, 6, 9,
	-3, -4, -7, -10, 2, 3, 6, 9,
	-1, -2, -3, -10, 0, 1, 2, 9,
	-4, -6, -8, -9, 3, 5, 7, 8,
	-3, -5, -7, -9, 2, 4, 6, 8,
]);

const etc2dists = new Uint8Array([3, 6, 11, 16, 23, 32, 41, 64]);

//TODO is it worth it to just use Uint8ClampedArray instead?
function clamp(num: number) {
	return (num > 255 ? 255 : num < 0 ? 0 : num);
}

function ect2alphalookup(base: number, table: number, mult: number, pix: number) {
	return clamp(base + etc2alphas[(table << 3) | pix] * mult);
}

function extend4to8(num: number) {
	return (num << 4) | num;
}
function extend5to8(num: number) {
	return (num << 3) | (num >> 2);
}
function extend6to8(num: number) {
	return (num << 2) | (num >> 4);
}
function extend7to8(num: number) {
	return (num << 1) | (num >> 7);
}

/**
 * written based on spec: https://registry.khronos.org/OpenGL/specs/gl/glspec43.core.pdf#page=621
 * probably not 100% accurate yet, there might be some inacuracies with rounding at the wrong time
 * not using Buffer since we might want to run this in the browser
 */
function etc2data(targetdata: Uint8Array, targetstride: number, source: Uint8Array, sourcewidth: number, subx: number, suby: number, width: number, height: number, hasalpha: boolean) {
	const bytesperblock = hasalpha ? 16 : 8;
	const coloroffset = hasalpha ? 8 : 0;
	//prealloc these so we don't do it in a hot loop
	const colorlut = new Uint8Array(4 * 4);
	for (let blocky = suby / 4; blocky < (suby + height) / 4; blocky++) {
		for (let blockx = subx / 4; blockx < (subx + width) / 4; blockx++) {
			let blockindex = sourcewidth / 4 * blocky + blockx;
			let dataptr = blockindex * bytesperblock;

			let dataupper = uint32be(source, dataptr + coloroffset);
			let datalower = uint32be(source, dataptr + coloroffset + 4);

			let horizontalsplit = selectbits(dataupper, 0, 1);
			let moded = selectbits(dataupper, 1, 1);
			let moder = selectbits(dataupper, 27, 5);
			let modeg = selectbits(dataupper, 19, 5);
			let modeb = selectbits(dataupper, 11, 5);
			let modedr = selectsignedbits(dataupper, 24, 3);
			let modedg = selectsignedbits(dataupper, 16, 3);
			let modedb = selectsignedbits(dataupper, 8, 3);
			let modersum = moder + modedr;
			let modegsum = modeg + modedg;
			let modebsum = modeb + modedb;

			let validr = modersum >= 0 && modersum < 32;
			let validg = modegsum >= 0 && modegsum < 32;
			let validb = modebsum >= 0 && modebsum < 32;
			let allvalid = validr && validg && validb;

			let base_r1: number, base_g1: number, base_b1: number;
			let base_r2: number, base_g2: number, base_b2: number;
			let base_r3: number, base_g3: number, base_b3: number;
			if (moded == 0 || allvalid) {
				if (moded == 0) {
					//mode individual
					base_r1 = extend4to8(selectbits(dataupper, 28, 4));
					base_r2 = extend4to8(selectbits(dataupper, 24, 4));
					base_g1 = extend4to8(selectbits(dataupper, 20, 4));
					base_g2 = extend4to8(selectbits(dataupper, 16, 4));
					base_b1 = extend4to8(selectbits(dataupper, 12, 4));
					base_b2 = extend4to8(selectbits(dataupper, 8, 4));
				} else {
					//mode differential
					base_r1 = extend5to8(moder);
					base_g1 = extend5to8(modeg);
					base_b1 = extend5to8(modeb);
					base_r2 = extend5to8(modersum);
					base_g2 = extend5to8(modegsum);
					base_b2 = extend5to8(modebsum);
				}
				let table1 = selectbits(dataupper, 5, 3);
				let table2 = selectbits(dataupper, 2, 3);
				for (let p = 0; p < 16; p++) {
					let index = ((datalower >>> (p + 15)) & 0x2) | ((datalower >>> p) & 0x1);
					let pxoffset = (blockx * 4 + (p / 4 | 0) - subx) * 4 + (blocky * 4 + p % 4 - suby) * targetstride;
					let isfirst = (horizontalsplit == 1 ? (p % 4) < 2 : p < 8);
					let table = (isfirst ? table1 : table2);
					targetdata[pxoffset + 0] = clamp((isfirst ? base_r1 : base_r2) + etc2offsets[(table << 2) | index]);
					targetdata[pxoffset + 1] = clamp((isfirst ? base_g1 : base_g2) + etc2offsets[(table << 2) | index]);
					targetdata[pxoffset + 2] = clamp((isfirst ? base_b1 : base_b2) + etc2offsets[(table << 2) | index]);
					targetdata[pxoffset + 3] = 255;
				}
			} else {
				if (!validr || !validg) {
					if (!validr) {
						//mode T
						colorlut[0] = extend4to8((selectbits(dataupper, 27, 2) << 2) | selectbits(dataupper, 24, 2));
						colorlut[1] = extend4to8(selectbits(dataupper, 20, 4));
						colorlut[2] = extend4to8(selectbits(dataupper, 16, 4));
						colorlut[8] = extend4to8(selectbits(dataupper, 12, 4));
						colorlut[9] = extend4to8(selectbits(dataupper, 8, 4));
						colorlut[10] = extend4to8(selectbits(dataupper, 4, 4));
						let distindex = (selectbits(dataupper, 2, 2) << 1) | selectbits(dataupper, 0, 1);
						let dist = etc2dists[distindex];
						colorlut[4] = clamp(colorlut[8] + dist);
						colorlut[5] = clamp(colorlut[9] + dist);
						colorlut[6] = clamp(colorlut[10] + dist);
						colorlut[12] = clamp(colorlut[4] - dist);
						colorlut[13] = clamp(colorlut[5] - dist);
						colorlut[14] = clamp(colorlut[6] - dist);
					} else {
						//mode H
						base_r1 = extend4to8(selectbits(dataupper, 27, 4));
						base_g1 = extend4to8((selectbits(dataupper, 24, 3) << 1) | selectbits(dataupper, 20, 1));
						base_b1 = extend4to8((selectbits(dataupper, 19, 1) << 3) | selectbits(dataupper, 15, 3));
						base_r2 = extend4to8(selectbits(dataupper, 11, 4));
						base_g2 = extend4to8(selectbits(dataupper, 7, 4));
						base_b2 = extend4to8(selectbits(dataupper, 3, 4));
						let baseint1 = (base_r1 << 16) | (base_g1 << 8) | base_b1;
						let baseint2 = (base_r2 << 16) | (base_g2 << 8) | base_b2;
						let distlastbit = (baseint1 >= baseint2 ? 1 : 0);
						let distindex = (selectbits(dataupper, 2, 1) << 2) | (selectbits(dataupper, 0, 1) << 1) | distlastbit;
						let dist = etc2dists[distindex];

						colorlut[0] = clamp(base_r1 + dist);
						colorlut[1] = clamp(base_g1 + dist);
						colorlut[2] = clamp(base_b1 + dist);
						colorlut[4] = clamp(base_r1 - dist);
						colorlut[5] = clamp(base_g1 - dist);
						colorlut[6] = clamp(base_b1 - dist);

						colorlut[8] = clamp(base_r2 + dist);
						colorlut[9] = clamp(base_g2 + dist);
						colorlut[10] = clamp(base_b2 + dist);
						colorlut[12] = clamp(base_r2 - dist);
						colorlut[13] = clamp(base_g2 - dist);
						colorlut[14] = clamp(base_b2 - dist);
					}
					for (let p = 0; p < 16; p++) {
						let index = ((datalower >>> (p + 15)) & 0x2) | ((datalower >>> p) & 0x1);
						let pxoffset = (blockx * 4 + (p / 4 | 0) - subx) * 4 + (blocky * 4 + p % 4 - suby) * targetstride;
						targetdata[pxoffset + 0] = clamp(colorlut[(index << 2) | 0]);
						targetdata[pxoffset + 1] = clamp(colorlut[(index << 2) | 1]);
						targetdata[pxoffset + 2] = clamp(colorlut[(index << 2) | 2]);
						targetdata[pxoffset + 3] = 255;
					}
				} else if (!validb) {
					//mode planar
					base_r1 = extend6to8(selectbits(dataupper, 25, 6));
					base_g1 = extend7to8((selectbits(dataupper, 24, 1) << 6) | selectbits(dataupper, 17, 6));
					base_b1 = extend6to8((selectbits(dataupper, 16, 1) << 5) | (selectbits(dataupper, 11, 2) << 3) | selectbits(dataupper, 7, 3));
					base_r2 = extend6to8((selectbits(dataupper, 2, 5) << 1) | selectbits(dataupper, 0, 1));

					base_g2 = extend7to8(selectbits(datalower, 25, 7));
					base_b2 = extend6to8(selectbits(datalower, 19, 6));
					base_r3 = extend6to8(selectbits(datalower, 13, 6));
					base_g3 = extend7to8(selectbits(datalower, 6, 7));
					base_b3 = extend6to8(selectbits(datalower, 0, 6));

					for (let p = 0; p < 16; p++) {
						let px = p % 4;
						let py = (p / 4 | 0);
						let pxoffset = (blockx * 4 + px - subx) * 4 + (blocky * 4 + py - suby) * targetstride;
						targetdata[pxoffset + 0] = clamp((px * (base_r2 - base_r1) + py * (base_r3 - base_r1) + 4 * base_r1 + 2) >> 2);
						targetdata[pxoffset + 1] = clamp((px * (base_g2 - base_g1) + py * (base_g3 - base_g1) + 4 * base_g1 + 2) >> 2);
						targetdata[pxoffset + 2] = clamp((px * (base_b2 - base_b1) + py * (base_b3 - base_b1) + 4 * base_b1 + 2) >> 2);
						targetdata[pxoffset + 3] = 255;
					}
				} else {
					//should be caught above
				}
			}

			if (hasalpha) {
				let alphaupper = uint32be(source, dataptr);
				let alphalower = uint32be(source, dataptr + 4);

				let base = selectbits(alphaupper, 24, 8);
				let mult = selectbits(alphaupper, 20, 4);
				let table = selectbits(alphaupper, 16, 4);

				let basepxoffset = (blockx * 4 - subx) * 4 + (blocky * 4 - suby) * targetstride + 3;
				targetdata[basepxoffset + 0 + 0 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphaupper, 13, 3));
				targetdata[basepxoffset + 0 + 1 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphaupper, 10, 3));
				targetdata[basepxoffset + 0 + 2 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphaupper, 7, 3));
				targetdata[basepxoffset + 0 + 3 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphaupper, 4, 3));
				targetdata[basepxoffset + 4 + 0 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphaupper, 1, 3));
				targetdata[basepxoffset + 4 + 1 * targetstride] = ect2alphalookup(base, table, mult, (selectbits(alphaupper, 0, 1) << 2) | selectbits(alphalower, 30, 2));
				targetdata[basepxoffset + 4 + 2 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphalower, 27, 3));
				targetdata[basepxoffset + 4 + 3 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphalower, 24, 3));
				targetdata[basepxoffset + 8 + 0 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphalower, 21, 3));
				targetdata[basepxoffset + 8 + 1 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphalower, 18, 3));
				targetdata[basepxoffset + 8 + 2 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphalower, 15, 3));
				targetdata[basepxoffset + 8 + 3 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphalower, 12, 3));
				targetdata[basepxoffset + 12 + 0 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphalower, 9, 3));
				targetdata[basepxoffset + 12 + 1 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphalower, 6, 3));
				targetdata[basepxoffset + 12 + 2 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphalower, 3, 3));
				targetdata[basepxoffset + 12 + 3 * targetstride] = ect2alphalookup(base, table, mult, selectbits(alphalower, 0, 3));
			}
		}
	}
}
