import { simplexteadecrypt } from "../libs/xtea";


let compressiontimes = {
	bzip2: 0,
	lzma: 0,
	zlib: 0,
	zlibsqlite: 0,
};

globalThis.compressiontimes = compressiontimes;

//decompress data as it comes from the server
export function decompress(input: Buffer, key?: Uint32Array) {
	switch (input.readUInt8(0x0)) {
		case 0:
			return _uncompressed(input);
		case 1: {
			let t = performance.now();
			let output = _bz2_stream(input);
			compressiontimes.bzip2 += performance.now() - t;
			return output;
		}
		case 2: {
			let t = performance.now();
			let output = _zlib(input, key);
			compressiontimes.zlib += performance.now() - t;
			return output;
		}
		case 3: {
			let t = performance.now();
			let output = _lzma(input);
			compressiontimes.lzma += performance.now() - t;
			return output;
		}
		case 0x5a: {//0x5a4c4201
			let t = performance.now();
			let output = _zlibSqlite(input);
			compressiontimes.zlibsqlite += performance.now() - t;
			return output;
		}
		default:
			throw new Error("Unknown compression type (" + input.readUInt8(0x0).toString() + ")");
	}
}

//compress data to use in sqlite BLOBs
export function compressSqlite(input: Buffer, compression: "zlib") {
	switch (compression) {
		case "zlib":
			return _zlibSqliteCompress(input);
		default:
			throw new Error(`unknown compression type ${compression}`);
	}
}


/**
 * @param {Buffer} input The input buffer straight from the server
 */
var _uncompressed = function (input: Buffer) {
	var size = input.readUInt32BE(0x1);
	var output = Buffer.alloc(size);
	input.copy(output, 0x0, 0x5);
	return output;
}

var _bz2_old = function (input: Buffer) {
	//var bzip2 = require("bzip2");
	var bzip2 = require("../libs/bzip2fork");
	var compressed = input.readUInt32BE(0x1);
	var uncompressed = input.readUInt32BE(0x5);
	var processed = Buffer.alloc(compressed + 0x2 + 0x1 + 0x1);
	input.copy(processed, 0x4, 0x9);

	// Add the header
	processed.writeUInt16BE(0x425A, 0x0); // Magic Number
	processed.writeUInt8(0x68, 0x2); // Version
	// processed.writeUInt8(Math.ceil(uncompressed / (1024 * 102.4)) + 0x30, 0x3); // Block size in 100kB because why the hell not
	processed.writeUInt8(8 + 0x30, 0x3); // the lib expects a number between 1-9 here (+0x30)
	return Buffer.from(bzip2.simple(bzip2.array(processed)));
}

/**
 * @param {Buffer} input The input buffer straight from the server
 */
var _bz2 = function (input: Buffer) {
	//var bzip2 = require("bzip2");
	var bzip2 = require("../libs/bzip2wasm") as typeof import("../libs/bzip2wasm");
	var compressed = input.readUInt32BE(0x1);
	var uncompressed = input.readUInt32BE(0x5);
	var processed = Buffer.alloc(compressed + 0x2 + 0x1 + 0x1);
	input.copy(processed, 0x4, 0x9);

	// Add the header
	processed.writeUInt16BE(0x425A, 0x0); // Magic Number
	processed.writeUInt8(0x68, 0x2); // Version
	// processed.writeUInt8(Math.ceil(uncompressed / (1024 * 102.4)) + 0x30, 0x3); // Block size in 100kB because why the hell not
	processed.writeUInt8(8 + 0x30, 0x3); // the lib expects a number between 1-9 here (+0x30)
	return Buffer.from(bzip2.bzip2decompress(processed));
}


function _bz2_stream(container: Buffer) {
	var bzip2 = require("../libs/bzip2wasm") as typeof import("../libs/bzip2wasm");
	if (!(container instanceof Uint8Array)) {
		throw new TypeError("container must be Uint8Array");
	}
	if (container.length < 9) {
		throw new Error("legacy container too small");
	}

	const compressedLen = container.readUint32BE(0x1);
	const uncompressedLen = container.readUint32BE(0x5);
	const payloadStart = 0x9;
	const payloadEnd = payloadStart + compressedLen;
	if (payloadEnd > container.length) {
		throw new Error("legacy payload truncated");
	}

	const inputChunkSize = 64 * 1024;
	const outputChunkSize = 64 * 1024;
	const blockSizeChar = 8 + 0x30; // the lib expects a number between 1-9 here (+0x30)

	const stream = bzip2.createBzip2Stream({ outputChunkSize });
	const out = Buffer.alloc(uncompressedLen);
	let outOffset = 0;

	const onOutput = (chunk: Uint8Array) => {
		const end = outOffset + chunk.length;
		if (end > out.length) {
			throw new Error("decompressed output exceeded expected length");
		}
		out.set(chunk, outOffset);
		outOffset = end;
	};

	try {
		stream.pushTo(new Uint8Array([0x42, 0x5a, 0x68, blockSizeChar]), onOutput);
		for (let offset = payloadStart; offset < payloadEnd; offset += inputChunkSize) {
			const end = Math.min(offset + inputChunkSize, payloadEnd);
			stream.pushTo(container.subarray(offset, end), onOutput);
		}
		stream.finishTo(onOutput);
	} finally {
		stream.close();
	}

	if (outOffset !== out.length) {
		throw new Error(`legacy header length mismatch (expected ${out.length}, got ${outOffset})`);
	}

	return out;
}

export function legacybz2(input: Buffer) {
	var bzip2 = require("../libs/bzip2wasm") as typeof import("../libs/bzip2wasm");
	var processed = Buffer.alloc(input.byteLength + 0x4);
	input.copy(processed, 0x4);

	// Add the header
	processed.writeUInt16BE(0x425A, 0x0); // Magic Number
	processed.writeUInt8(0x68, 0x2); // Version
	// processed.writeUInt8(Math.ceil(uncompressed / (1024 * 102.4)) + 0x30, 0x3); // Block size in 100kB because why the hell not
	processed.writeUInt8(8 + 0x30, 0x3); // the lib expects a number between 1-9 here (+0x30)
	return Buffer.from(bzip2.bzip2decompress(processed));
}

/**
 * @param {Buffer} input The input buffer straight from the server
 */
var _zlib = function (input: Buffer, key?: Uint32Array) {
	var zlib = require("zlib") as typeof import("zlib");
	try {
		let compressedsize = input.readUint32BE(1);
		if (key) {
			let compressedData = simplexteadecrypt(input.slice(5, 5 + 4 + compressedsize), key);
			return zlib.gunzipSync(compressedData.slice(4, 4 + compressedsize));
		} else {
			let compressedData = input.slice(9, 9 + compressedsize);
			return zlib.gunzipSync(compressedData);
		}
	} catch (e) {
		throw new Error(`gzip decompress failed, possibly due to missing or wrong xtea key, key: ${key ?? "none"}`, { cause: e });
	}
}

export function legacyGzip(input: Buffer) {
	var zlib = require("zlib") as typeof import("zlib");
	return zlib.gunzipSync(input);
}


let nativelzma: any = null;
let nativelzmaAttempted = false;
/**
 * @param {Buffer} input The input buffer straight from the server
 */
var _lzma = function (input: Buffer) {
	var compressed = input.readUInt32BE(0x1);
	var uncompressed = input.readUInt32BE(0x5);
	var processed = Buffer.alloc(compressed + 8);
	input.copy(processed, 0x0, 0x9, 0xE);
	processed.writeUInt32LE(uncompressed, 0x5);
	processed.writeUInt32LE(0, 0x5 + 0x4);
	input.copy(processed, 0xD, 0xE);

	if (!nativelzmaAttempted && !nativelzma) {
		nativelzmaAttempted = true;
		try {
			nativelzma = __non_webpack_require__("lzma-native").LZMA();
		} catch (e) {
			console.log("can't load native lzma, falling back to naive js implementation");
		}
	}
	if (nativelzma) {
		return nativelzma.decompress(processed) as Buffer;
	} else {
		//need to do this weird import directly because of webpack
		//this lib also seems set "self.onMessage" when in a worker, but doesn't seem to collide with the messages we send
		var lzma = require("lzma/src/lzma_worker.js").LZMA;
		return Buffer.from(lzma.decompress(processed));
	}
}


function _zlibSqlite(input: Buffer) {
	//skip header bytes 5a4c4201
	var uncompressed_size = input.readUInt32BE(0x4);
	var zlib = require("zlib") as typeof import("zlib");
	return zlib.inflateSync(input.slice(0x8));
}
function _zlibSqliteCompress(input: Buffer) {
	const zlib = require("zlib") as typeof import("zlib");
	let compressbytes = zlib.deflateSync(input);
	let result = Buffer.alloc(4 + 4 + compressbytes.byteLength);
	result.write("5a4c4201", 0x0, "hex");
	result.writeUInt32BE(input.byteLength, 0x4);
	compressbytes.copy(result, 0x8);
	return result;
}