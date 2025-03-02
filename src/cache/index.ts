import { crc32, crc32_backward, forge_crcbytes } from "../libs/crc32util";
import { cacheConfigPages, cacheMajors, lastClassicBuildnr, lastLegacyBuildnr, latestBuildNumber } from "../constants";
import { parse } from "../opdecoder";
import { cacheFilenameHash } from "../utils";
import { parseLegacyArchive } from "./legacycache";

globalThis.ignoreCache = false;

export type SubFile = {
	offset: number,
	size: number,
	buffer: Buffer,
	fileid: number,
	namehash: number | null
}

export type CacheIndex = {
	major: number,
	minor: number,
	crc: number,
	version: number,
	subindexcount: number,
	subindices: number[],
	subnames: number[] | null,
	name: number | null,
	uncompressed_crc?: number | null,
	size?: number | null,
	uncompressed_size?: number | null,
}

export type CacheIndexFile = CacheIndex[];

export type XteaTable = Map<number, Uint32Array>;

export function packSqliteBufferArchive(buffers: Buffer[]) {
	return new Archive(buffers).packSqlite();
}

export function unpackSqliteBufferArchive(buffer: Buffer, subids: number[], namehashes: number[] | null): SubFile[] {
	if (subids.length == 1) {
		return [{ buffer, offset: 0, size: buffer.byteLength, fileid: subids[0], namehash: namehashes?.[0] ?? null }];
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
			fileid: subids[filenr],
			namehash: namehashes?.[filenr] ?? null
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

export function unpackBufferArchive(buffer: Buffer, subids: number[], namehashes: number[] | null) {
	if (subids.length == 1) {
		let r: SubFile[] = [{
			buffer: buffer,
			offset: 0,
			size: buffer.byteLength,
			fileid: subids[0],
			namehash: namehashes?.[0] ?? null
		}];
		return r;
	}

	let nchunks = buffer.readUInt8(buffer.length - 1);
	var suboffsetScan = buffer.length - 1 - (4 * subids.length * nchunks);
	var subbufs: SubFile[] = [];
	var scan = 0x0;
	for (let chunkindex = 0; chunkindex < nchunks; chunkindex++) {
		var lastRecordSize = 0;
		for (var fileindex = 0; fileindex < subids.length; ++fileindex) {
			//the field contains the difference in size from the last record?
			lastRecordSize += buffer.readInt32BE(suboffsetScan);
			suboffsetScan += 4;
			let size = lastRecordSize;

			let recordBuffer = buffer.slice(scan, scan + size);
			scan += size;
			let oldchunk = subbufs[fileindex];
			if (oldchunk) {
				oldchunk.buffer = Buffer.concat([oldchunk.buffer, recordBuffer]);
				oldchunk.size += size;
			} else {
				subbufs[fileindex] = {
					buffer: recordBuffer,
					offset: scan,
					size,
					fileid: subids[fileindex],
					namehash: namehashes?.[fileindex] ?? null
				};
			}
		}
	}
	return subbufs;
}

export function rootIndexBufferToObject(metaindex: Buffer, source: CacheFileSource) {
	let index = parse.rootCacheIndex.read(metaindex, source);
	return index.cachemajors
		.map(q => {
			if (q.crc == 0) { return undefined!; }
			let r: CacheIndex = {
				major: 255,
				minor: q.minor,
				crc: q.crc,
				version: q.version,
				size: 0,
				name: null,
				subindexcount: q.subindexcount,
				subindices: [0],
				subnames: null,
				uncompressed_crc: 0,
				uncompressed_size: 0,
			}
			return r;
		});
}

export function indexBufferToObject(major: number, buffer: Buffer, source: CacheFileSource): CacheIndex[] {
	if (major == cacheMajors.index) {
		return rootIndexBufferToObject(buffer, source);
	}
	let readres = parse.cacheIndex.read(buffer, source);
	let indices = readres.indices;
	let linear: CacheIndex[] = [];
	for (let entry of indices) {
		linear[entry.minor] = Object.assign(entry, { major });
	}
	return linear;
}

export const mappedFileIds = {
	[cacheMajors.items]: 256,
	[cacheMajors.npcs]: 128,
	[cacheMajors.structs]: 32,
	[cacheMajors.enums]: 256,
	[cacheMajors.objects]: 256,
	[cacheMajors.sequences]: 128,
	[cacheMajors.spotanims]: 256,
	[cacheMajors.achievements]: 128,
	[cacheMajors.materials]: Number.MAX_SAFE_INTEGER//is single index
}

export const oldConfigMaps = {
	[cacheMajors.items]: cacheConfigPages.items_old,
	[cacheMajors.npcs]: cacheConfigPages.npcs_old,
	[cacheMajors.objects]: cacheConfigPages.locs_old,
	[cacheMajors.spotanims]: cacheConfigPages.spotanim_old
}

export type FilePosition = {
	major: number,
	minor: number,
	subid: number
}

export function fileIdToArchiveminor(major: number, fileid: number, buildnr: number): FilePosition {
	if (buildnr < 488) {
		let page = oldConfigMaps[major];
		if (page !== undefined) {
			return { major: cacheMajors.config, minor: page, subid: fileid };
		}
	}
	let archsize = mappedFileIds[major] ?? 1;
	let holderindex = Math.floor(fileid / archsize);
	return { minor: holderindex, major, subid: fileid % archsize };
}
export function archiveToFileId(major: number, minor: number, subfile: number) {
	let archsize = mappedFileIds[major] ?? 1;
	return minor * archsize + subfile;
}


export abstract class CacheFileSource {
	decodeArgs: Record<string, any> = {};
	getCacheMeta(): { name: string, descr: string, timestamp: Date, otherCaches?: Record<string, string> } {
		return { name: "unkown", descr: "", timestamp: new Date(0) };
	}
	//could use abstract here but typings get weird
	getFile(major: number, minor: number, crc?: number): Promise<Buffer> {
		throw new Error("not implemented");
	}
	getFileArchive(index: CacheIndex): Promise<SubFile[]> {
		throw new Error("not implemented");
	}
	getCacheIndex(major: number): Promise<CacheIndexFile> {
		throw new Error("not implemented");
	}
	getBuildNr(): number {
		return latestBuildNumber;
	}
	getDecodeArgs(): Record<string, any> {
		//can't initialize this in constructor because sub class wont be ready yet
		this.decodeArgs.clientVersion = this.getBuildNr();
		return this.decodeArgs;
	}
	writeFile(major: number, minor: number, file: Buffer): Promise<void> {
		throw new Error("not implemented");
	}

	writeFileArchive(major: number, minor: number, files: Buffer[]): Promise<void> {
		throw new Error("not implemented");
	}

	async getIndexEntryById(major: number, minor: number) {
		let index: CacheIndex;
		if (this.getBuildNr() <= lastLegacyBuildnr) {
			index = { major, minor, crc: 0, name: null, subindexcount: 1, subindices: [0], subnames: null, version: 0 };
		} else {
			let indexfile = await this.getCacheIndex(major);
			index = indexfile[minor];
		}
		if (!index) { throw new Error(`minor id ${minor} does not exist in major ${major}.`); }
		return index;
	}

	async getArchiveById(major: number, minor: number) {
		let index = await this.getIndexEntryById(major, minor);
		return this.getFileArchive(index);
	}

	async getFileById(major: number, fileid: number) {
		let holderindex = fileIdToArchiveminor(major, fileid, this.getBuildNr());
		let files = await this.getArchiveById(holderindex.major, holderindex.minor);
		let match = files.find(q => q.fileid == holderindex.subid);
		if (!match) { throw new Error(`File ${fileid} in major ${major} not found, (redirected to ${holderindex.major}.${holderindex.minor}.${holderindex.subid})`); }
		return match.buffer;
	}

	async findFileByName(major: number, name: string) {
		let hash = cacheFilenameHash(name, this.getBuildNr() <= lastLegacyBuildnr);
		let indexfile = await this.getCacheIndex(major);
		return indexfile.find(q => q && q.name == hash);
	}
	async findSubfileByName(major: number, minor: number, name: string) {
		let hash = cacheFilenameHash(name, this.getBuildNr() <= lastLegacyBuildnr);
		let arch = await this.getArchiveById(major, minor);
		return arch.find(q => q && q.namehash == hash);
	}

	//for testing only
	async bruteForceFindAnyNamedFile(name: string) {
		let rootindex = await this.getCacheIndex(cacheMajors.index);
		for (let index of rootindex) {
			if (!index) { continue; }
			let res = await this.findFileByName(index.minor, name);
			if (res) { return this.getFileArchive(res); }
		}
		return null;
	}

	close() { }
}

export type CacheFileGetter = (major: number, minor: number, crc?: number) => Promise<Buffer>;

//basic implementation for cache sources that only download major/minor pairs
export abstract class DirectCacheFileSource extends CacheFileSource {
	indexMap = new Map<number, Promise<CacheIndexFile>>();
	requiresCrc: boolean;
	xteakeys: XteaTable | null = null;

	constructor(needscrc: boolean) {
		super();
		this.requiresCrc = needscrc;
	}

	getFile(major: number, minor: number, crc?: number): Promise<Buffer> {
		throw new Error("not implemented");
	}

	async getFileArchive(meta: CacheIndex) {
		let file = await this.getFile(meta.major, meta.minor, meta.crc);
		if (this.getBuildNr() <= lastLegacyBuildnr) {
			return parseLegacyArchive(file, meta.major, this.getBuildNr() <= lastClassicBuildnr);
		} else {
			return unpackBufferArchive(file, meta.subindices, meta.subnames);
		}
	}
	getXteaKey(major: number, minor: number) {
		let key = (major << 23) | minor;
		return this.xteakeys?.get(key);
	}
	getCacheIndex(major: number) {
		let index = this.indexMap.get(major);
		if (!index) {
			index = (async () => {
				let crc: number | undefined = undefined;
				if (this.requiresCrc && major != cacheMajors.index) {
					let index = await this.getCacheIndex(cacheMajors.index);
					crc = index[major].crc;
				}
				let indexfile = await this.getFile(cacheMajors.index, major, crc);
				let decoded = indexBufferToObject(major, indexfile, this);
				return decoded;
			})();
			this.indexMap.set(major, index);
		}
		return index;
	}
}

export class CallbackCacheLoader extends DirectCacheFileSource {
	constructor(fn: CacheFileGetter, needsCrc: boolean) {
		super(needsCrc);
		this.getFile = fn;
	}

	getCacheMeta() {
		return { name: "callback", descr: "Cache source based on external getter", timestamp: new Date(0) };
	}
}
