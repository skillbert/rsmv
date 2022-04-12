import { crc32, crc32_backward, forge_crcbytes } from "./libs/crc32util";
import { cacheMajors } from "./constants";
import { parseCacheIndex, parseRootCacheIndex } from "./opdecoder";

export type SubFile = {
	offset: number,
	size: number,
	buffer: Buffer,
	fileid: number
}

export type CacheIndex = {
	major: number,
	minor: number,
	crc: number,
	version: number,
	subindexcount: number,
	subindices: number[]
	uncompressed_crc?: number | null,
	size?: number | null,
	uncompressed_size?: number | null,
}

export type CacheIndexFile = CacheIndex[];

export function packSqliteBufferArchive(buffers: Buffer[]) {
	return new Archive(buffers).packSqlite();
}

export function unpackSqliteBufferArchive(buffer: Buffer, subids: number[]) {
	if (subids.length == 1) {
		return [{ buffer, offset: 0, size: buffer.byteLength, fileid: subids[0] } as SubFile];
	}
	let index = 0;
	let unknownbyte = buffer.readUInt8(index); index++;
	//console.log("unknownbyte sqlarchive", unknownbyte);
	let fileoffset = buffer.readUInt32BE(index); index += 4;

	let files: SubFile[] = [];
	for (let filenr = 0; filenr < subids.length; filenr++) {
		let endoffset = buffer.readUInt32BE(index); index += 4;
		files.push({
			buffer: buffer.slice(fileoffset, endoffset),
			offset: fileoffset,
			size: endoffset - fileoffset,
			fileid: subids[filenr]
		});
		fileoffset = endoffset;
	}
	return files;
}

export class Archive {
	files: Buffer[];
	constructor(files: Buffer[]) {
		this.files = files;
	}

	forgecrc(wantedcrc: number, gapfileindex: number, gapoffset: number) {
		let frontcrc = 0;
		for (let i = 0; i < this.files.length; i++) {
			if (i == gapfileindex) {
				frontcrc = crc32(this.files[i], frontcrc, 0, gapoffset);
				break;
			}
			frontcrc = crc32(this.files[i], frontcrc);
		}
		let backcrc = wantedcrc;
		backcrc = crc32_backward(this.networkFooter(), backcrc);
		for (let i = this.files.length - 1; i >= 0; i--) {
			if (i == gapfileindex) {
				backcrc = crc32(this.files[i], backcrc, 0, gapoffset + 4);
				break;
			}
			backcrc = crc32(this.files[i], backcrc);
		}
		console.log("forging file", gapfileindex, gapoffset, forge_crcbytes(frontcrc, backcrc));
		this.files[gapfileindex] = Buffer.from(this.files[gapfileindex]);
		forge_crcbytes(frontcrc, backcrc).copy(this.files[gapfileindex], gapoffset);
	}

	networkFooter() {
		if (this.files.length == 1) { return Buffer.from([]); }
		let len = 1 + this.files.length * 4;
		let result = Buffer.alloc(len);
		let lastsize = 0;
		let footerindex = 0;
		for (let buf of this.files) {
			result.writeInt32BE(buf.byteLength - lastsize, footerindex);
			lastsize = buf.byteLength;
			footerindex += 4;
		}
		result.writeUInt8(0x01, len - 1);//why is this byte 0x01
		return result;
	}

	packNetwork() {
		return Buffer.concat([...this.files, this.networkFooter()]);
	}

	sqliteHeader() {
		if (this.files.length == 1) { return Buffer.from([]); }

		let headersize = 1 + 4 + this.files.length * 4
		let result = Buffer.alloc(headersize);
		let offset = 0;
		let dataoffset = headersize;//start of first file
		result.writeUInt8(0x1, offset); offset++;//unknown
		result.writeUInt32BE(dataoffset, offset); offset += 4;
		for (let buffer of this.files) {
			dataoffset += buffer.byteLength;
			result.writeUInt32BE(dataoffset, offset); offset += 4;//index at end of file
		}
		return result;
	}

	packSqlite() {
		return Buffer.concat([this.sqliteHeader(), ...this.files,]);
	}
}

export function packBufferArchive(buffers: Buffer[]) {
	return new Archive(buffers).packNetwork();
}

export function unpackBufferArchive(buffer: Buffer, subids: number[]) {
	var subbufs: SubFile[] = [];
	var scan = 0x0;
	if (subids.length != 1) {
		//TODO i think this endbyte thing is bullshit?
		//whats in our missing byte?
		let endbyte = buffer.readUInt8(buffer.length - 1);
		if (endbyte != 1) { console.log("unexpected archive end byte", endbyte) }
	}
	var suboffsetScan = buffer.length - 1 - (4 * subids.length);
	var lastRecordSize = 0;

	for (var j = 0; j < subids.length; ++j) {
		let size: number;
		if (subids.length == 1) {
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
			size,
			fileid: subids[j]
		})
	}
	return subbufs;
}
// export function rootIndexBufferToObject(metaindex: Buffer) {
// 	var indices: CacheIndexStub[];
// 	var offset = 0x0;
// 	var elements = metaindex.readUInt8(offset++);
// 	for (var i = 0; i < elements; ++i, offset += 0x50) {
// 		var element = metaindex.slice(offset, offset + 0x50);
// 		//skip empty indices
// 		if (Math.max.apply(null, element) == 0) {
// 			continue;
// 		}
// 		indices.push({
// 			major: 255,
// 			minor: i,
// 			crc: element.readUInt32BE(0),
// 			version: element.readUInt32BE(0x4)
// 		};
// 	}
// 	return indices;
// }

export function rootIndexBufferToObject(metaindex: Buffer) {
	let index = parseRootCacheIndex.read(metaindex);
	return index.cachemajors
		.map(q => {
			if (q.crc == 0) { return undefined!; }
			let r: CacheIndex = {
				major: 255,
				minor: q.minor,
				crc: q.crc,
				version: q.version,
				size: 0,
				subindexcount: 1,
				subindices: [0],
				uncompressed_crc: 0,
				uncompressed_size: 0,
			}
			return r;
		});
}

export function indexBufferToObject(major: number, buffer: Buffer): CacheIndex[] {
	if (major == cacheMajors.index) {
		return rootIndexBufferToObject(buffer);
	}
	let readres = parseCacheIndex.read(buffer);
	let indices = readres.indices;
	let linear: CacheIndex[] = [];
	for (let entry of indices) {
		if (!entry) { debugger; }
		linear[entry.minor] = Object.assign(entry, { major });
	}
	return linear;
}

const mappedFileIds = {
	[cacheMajors.items]: 256,//not sure
	[cacheMajors.npcs]: 128,
	[cacheMajors.structs]: 32,
	[cacheMajors.enums]: 256,
	[cacheMajors.objects]: 256,
	[cacheMajors.sequences]: 128,
	[cacheMajors.spotanims]: 256,
	[cacheMajors.achievements]: 128,
	[cacheMajors.materials]: 10000000//is single index
}

export function fileIdToArchiveminor(major: number, fileid: number) {
	let archsize = mappedFileIds[major] ?? 1;
	let holderindex = Math.floor(fileid / archsize);
	return { minor: holderindex, major, subid: fileid % archsize };
}
export function archiveToFileId(major: number, minor: number, subfile: number) {
	let archsize = mappedFileIds[major] ?? 1;
	return minor * archsize + subfile;
}

export class CacheFileSource {
	//could use abstract here but typings get weird
	getFile(major: number, minor: number, crc?: number): Promise<Buffer> {
		throw new Error("not implemented");
	}
	getFileArchive(index: CacheIndex): Promise<SubFile[]> {
		throw new Error("not implemented");
	}
	getIndexFile(major: number): Promise<CacheIndexFile> {
		throw new Error("not implemented");
	}

	writeFile(major: number, minor: number, file: Buffer): Promise<void> {
		throw new Error("not implemented");
	}

	writeFileArchive(index: CacheIndex, files: Buffer[]): Promise<void> {
		throw new Error("not implemented");
	}

	async getArchiveById(major: number, minor: number) {
		let indexfile = await this.getIndexFile(major);
		let index = indexfile[minor];
		if (!index) { throw new Error(`minor id ${minor} does not exist in major ${major}.`); }
		return this.getFileArchive(index);
	}

	async getFileById(major: number, fileid: number) {
		let holderindex = fileIdToArchiveminor(major, fileid);
		let indexfile = await this.getIndexFile(major);
		//TODO cache these in a map or something
		let holder = indexfile[holderindex.minor];
		if (!holder) { throw new Error(`file id ${fileid} in major ${major} has no archive`); }
		let subindex = holder.subindices.indexOf(holderindex.subid);
		if (subindex == -1) { throw new Error(`file id ${fileid} in major ${major} does not exist in archive`); }
		let files = await this.getFileArchive(holder);
		let file = files[subindex].buffer;
		return file;
	}
	close() { }
}

export function cachingFileSourceMixin<T extends new (...args: any[]) => CacheFileSource>(source: T) {
	return class CachedFileSource extends source {
		useindexcounter = 1;
		cache: { index: CacheIndex, files: Promise<SubFile[]>, useindex: number }[] = [];
		indices = new Map<number, Promise<CacheIndexFile>>();
		constructor(...args: any[]) {
			super(...args);
		}

		getIndexFile(major: number) {
			let cached = this.indices.get(major);
			if (!cached) {
				cached = super.getIndexFile(major);
				this.indices.set(major, cached);
			}
			return cached;
		}
		getFileArchive(index: CacheIndex) {
			let cached = this.cache.find(q => q.index.major == index.major && q.index.minor == index.minor);
			if (!cached) {
				cached = { files: super.getFileArchive(index), index, useindex: this.useindexcounter++ };
				this.cache.push(cached);
				if (this.cache.length > 200) {
					this.cache.sort((a, b) => b.useindex - a.useindex);
					this.cache.length = 150;
				}
			} else {
				cached.useindex = this.useindexcounter++;
			}
			return cached.files;
		}
	}
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