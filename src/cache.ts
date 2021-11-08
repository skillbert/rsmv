import { cacheMajors } from "./constants";
import { parseCacheIndex } from "./opdecoder";


export type SubFile = {
	offset: number,
	size: number,
	buffer: Buffer
}

export type CacheIndexStub = {
	major: number,
	minor: number,
	crc: number,
	version: number
}

export type CacheIndex = CacheIndexStub & {
	uncompressed_crc: number,
	size: number,
	uncompressed_size: number,
	subindexcount: number,
	subindices: number[]
}

export type CacheIndexFile = CacheIndex[];

export function packSqliteBufferArchive(buffers: Buffer[]) {
	if (buffers.length == 1) { return buffers[0]; }
	let datasize = buffers.reduce((a, v) => a + v.byteLength, 0);;
	let headersize = 1 + 4 + buffers.length * 4
	let result = Buffer.alloc(headersize + datasize);
	let offset = 0;
	let dataoffset = headersize;//start of first file
	result.writeUInt8(0x1, offset); offset++;//unknown
	result.writeUInt32BE(dataoffset, offset); offset += 4;
	for (let buffer of buffers) {
		buffer.copy(result, dataoffset);
		dataoffset += buffer.byteLength;
		result.writeUInt32BE(dataoffset, offset); offset += 4;//index at end of file
	}
	return result;
}

export function unpackSqliteBufferArchive(buffer: Buffer, length: number) {
	if (length == 1) {
		return [{ buffer, offset: 0, size: buffer.byteLength }];
	}
	let index = 0;
	let unknownbyte = buffer.readUInt8(index); index++;
	//console.log("unknownbyte sqlarchive", unknownbyte);
	let fileoffset = buffer.readUInt32BE(index); index += 4;

	let files: SubFile[] = [];
	for (let filenr = 0; filenr < length; filenr++) {
		let endoffset = buffer.readUInt32BE(index); index += 4;
		files.push({
			buffer: buffer.slice(fileoffset, endoffset),
			offset: fileoffset,
			size: endoffset - fileoffset
		});
		fileoffset = endoffset;
	}
	return files;
}

export function packBufferArchive(buffers: Buffer[]) {
	if (buffers.length == 1) { return buffers[0]; }
	let datasize = buffers.reduce((a, v) => a + v.byteLength, 0);;
	let len = 1 + buffers.length * 4 + datasize;
	let result = Buffer.alloc(len);
	let lastsize = 0;
	let footerindex = datasize;
	let offset = 0;
	for (let buf of buffers) {
		buf.copy(result, offset);
		offset += buf.byteLength;
		result.writeInt32BE(buf.byteLength - lastsize, footerindex);
		lastsize = buf.byteLength;
		footerindex += 4;
	}
	return result;
}

export function unpackBufferArchive(buffer: Buffer, length: number) {
	var subbufs: SubFile[] = [];
	var scan = 0x0;
	//whats in our missing byte?
	var suboffsetScan = buffer.length - 0x1 - (0x4 * length);
	var lastRecordSize = 0;

	for (var j = 0; j < length; ++j) {
		let size: number;
		if (length == 1) {
			size = buffer.byteLength;
		} else {
			//the field contains the difference in size from the last record?
			lastRecordSize += buffer.readInt32BE(suboffsetScan);
			suboffsetScan += 4;
			size = lastRecordSize;
		}
		let recordBuffer = buffer.slice(scan, scan + size);
		scan += size;
		subbufs.push({
			buffer: recordBuffer,
			offset: scan,
			size
		})
	}
	return subbufs;
}
export function rootIndexBufferToObject(metaindex: Buffer) {
	var indices: { [key: number]: CacheIndexStub } = {};
	var offset = 0x0;
	var elements = metaindex.readUInt8(offset++);
	for (var i = 0; i < elements; ++i, offset += 0x50) {
		var element = metaindex.slice(offset, offset + 0x50);
		//skip empty indices
		if (Math.max.apply(null, element) == 0) {
			continue;
		}
		indices[i] = {
			major: 255,
			minor: i,
			crc: element.readUInt32BE(0),
			version: element.readUInt32BE(0x4)
		};
	}
	return indices;
}

export function indexBufferToObject(major: number, buffer: Buffer) {
	let readres = parseCacheIndex.read(buffer);
	let indices = readres.indices;
	let linear: CacheIndex[] = [];
	for (let entry of indices) {
		linear[entry.minor] = Object.assign(entry, { major });
	}
	return linear;
}

const mappedFileIds = {
	[cacheMajors.items]: 256,//not sure
	[cacheMajors.npcs]: 256,//not sure
	[cacheMajors.materials]: Infinity,
	[cacheMajors.objects]: 256
}

export function fileIdToArchiveminor(major: number, fileid: number) {
	let archsize = mappedFileIds[major] ?? 1;
	let holderindex = Math.floor(fileid / archsize);
	return { minor: holderindex, major, subindex: fileid % archsize };
}
export function achiveToFileId(major: number, minor: number, subfile: number) {
	let archsize = mappedFileIds[major] ?? 1;
	return minor * archsize + subfile;
}

export abstract class CacheFileSource {
	abstract getFile(major: number, minor: number, crc?: number): Promise<Buffer>;
	abstract getFileArchive(index: CacheIndex): Promise<SubFile[]>;
	abstract getIndexFile(major: number): Promise<CacheIndexFile>;

	async getFileById(major: number, fileid: number) {
		let holderindex = fileIdToArchiveminor(major, fileid);
		let indexfile = await this.getIndexFile(major);
		//TODO cache these in a map or something
		let holder = indexfile[holderindex.minor];
		if (!holder) { throw new Error(`file id ${fileid} in major ${major} has no archive`); }
		let subindex = holder.subindices.indexOf(holderindex.subindex);
		if (subindex == -1) { throw new Error(`file id ${fileid} in major ${major} does not exist in archive`); }
		let files = await this.getFileArchive(holder);
		let file = files[subindex].buffer;
		return file;
	}
	close() { }
}

// export class MemoryCachedFileSource {
// 	sectors = new Map<number, Map<number, Promise<Buffer>>>();
// 	getRaw: CacheGetter;
// 	get: CacheGetter;
// 	constructor(getRaw: CacheGetter) {
// 		this.getRaw = getRaw;

// 		//use assignment instead of class method so the "this" argument is bound
// 		this.get = async (major: number, fileid: number) => {
// 			let sector = this.sectors.get(major);
// 			if (!sector) {
// 				sector = new Map();
// 				this.sectors.set(major, sector);
// 			}
// 			let file = sector.get(fileid);
// 			if (!file) {
// 				file = this.getRaw(major, fileid);
// 				sector.set(fileid, file)
// 			}
// 			return file;
// 		}
// 	}
// }