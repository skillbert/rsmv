import { crc32, crc32_backward, forge_crcbytes } from "../libs/crc32util";
import { cacheMajors, latestBuildNumber } from "../constants";
import { parse } from "../opdecoder";

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
	if (subids.length == 1) {
		let r: SubFile[] = [{
			buffer: buffer,
			offset: 0,
			size: buffer.byteLength,
			fileid: subids[0]
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
			} else {
				subbufs[fileindex] = {
					buffer: recordBuffer,
					offset: scan,
					size,
					fileid: subids[fileindex]
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
				subindexcount: 1,
				subindices: [0],
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

const mappedFileIds = {
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

export function fileIdToArchiveminor(major: number, fileid: number) {
	let archsize = mappedFileIds[major] ?? 1;
	let holderindex = Math.floor(fileid / archsize);
	return { minor: holderindex, major, subid: fileid % archsize };
}
export function archiveToFileId(major: number, minor: number, subfile: number) {
	let archsize = mappedFileIds[major] ?? 1;
	return minor * archsize + subfile;
}


export abstract class CacheFileSource {
	getCacheName() {
		return "unkown";
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

	writeFile(major: number, minor: number, file: Buffer): Promise<void> {
		throw new Error("not implemented");
	}

	writeFileArchive(index: CacheIndex, files: Buffer[]): Promise<void> {
		throw new Error("not implemented");
	}

	async getArchiveById(major: number, minor: number) {
		let indexfile = await this.getCacheIndex(major);
		let index = indexfile[minor];
		if (!index) { throw new Error(`minor id ${minor} does not exist in major ${major}.`); }
		return this.getFileArchive(index);
	}

	async getFileById(major: number, fileid: number) {
		let holderindex = fileIdToArchiveminor(major, fileid);
		let indexfile = await this.getCacheIndex(major);
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

//basic implementation for cache sources that only download major/minor pairs
export abstract class DirectCacheFileSource extends CacheFileSource {
	indexMap = new Map<number, Promise<CacheIndexFile>>();
	requiresCrc: boolean;

	constructor(needscrc: boolean) {
		super();
		this.requiresCrc = needscrc;
	}

	getFile(major: number, minor: number, crc?: number): Promise<Buffer> {
		throw new Error("not implemented");
	}

	async getFileArchive(meta: CacheIndex) {
		return unpackBufferArchive(await this.getFile(meta.major, meta.minor, meta.crc), meta.subindices);
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
	constructor(fn: (major: number, minor: number, crc?: number) => Promise<Buffer>, needsCrc: boolean) {
		super(needsCrc);
		this.getFile = fn;
	}

	getCacheName() {
		return "callback";
	}
}

export type CachedObject<T> = {
	size: number,
	lastuse: number,
	usecount: number,
	owner: Map<number, CachedObject<T>>,
	id: number,
	data: Promise<T>
}
export class CachingFileSource extends CacheFileSource {
	private archieveCache = new Map<number, CachedObject<SubFile[]>>();
	private cachedObjects: CachedObject<any>[] = [];
	private cacheFetchCounter = 0;
	private cacheAddCounter = 0;
	maxcachesize = 200e6;

	rawsource: CacheFileSource;

	constructor(base: CacheFileSource) {
		super();
		this.rawsource = base;
	}

	fetchCachedObject<T>(map: Map<number, CachedObject<T>>, id: number, create: () => Promise<T>, getSize: (obj: T) => number) {
		let bucket = map.get(id);
		if (!bucket) {
			let data = create();
			bucket = {
				data: data,
				owner: map,
				id: id,
				lastuse: 0,
				size: 0,
				usecount: 0
			}
			data.then(obj => bucket!.size = getSize(obj));
			this.cachedObjects.push(bucket);
			map.set(id, bucket);
			if (++this.cacheAddCounter % 100 == 0) {
				this.sweepCachedObjects();
			}
		}
		bucket.usecount++;
		bucket.lastuse = this.cacheFetchCounter++;
		return bucket.data;
	}

	sweepCachedObjects() {
		let score = (bucket: CachedObject<any>) => {
			//less is better
			return (
				//up to 100 penalty for not being used recently
				Math.min(100, this.cacheFetchCounter - bucket.lastuse)
				//up to 100 score for being used often
				+ Math.max(-100, -bucket.usecount * 10)
			)
		}
		this.cachedObjects.sort((a, b) => score(a) - score(b));
		let newlength = this.cachedObjects.length;
		let totalsize = 0;
		for (let i = 0; i < this.cachedObjects.length; i++) {
			let bucket = this.cachedObjects[i];
			totalsize += bucket.size;
			if (totalsize > this.maxcachesize) {
				newlength = Math.min(newlength, i);
				bucket.owner.delete(bucket.id);
			} else {
				bucket.usecount = 0;
			}
		}
		// console.log("scenecache sweep completed, removed", this.cachedObjects.length - newlength, "of", this.cachedObjects.length, "objects");
		// console.log("old totalsize", totalsize);
		this.cachedObjects.length = newlength;
	}

	getCacheIndex(major: number) {
		return this.rawsource.getCacheIndex(major);
	}
	getFile(major: number, minor: number, crc?: number | undefined) {
		return this.rawsource.getFile(major, minor, crc);
	}
	getFileArchive(index: CacheIndex) {
		let get = () => this.rawsource.getFileArchive(index);

		//don't attempt to cache large files that have their own cache
		if (index.major == cacheMajors.models || index.major == cacheMajors.texturesBmp || index.major == cacheMajors.texturesDds || index.major == cacheMajors.texturesPng) {
			return get();
		} else {
			let cachekey = (index.major << 23) | index.minor;//23bit so it still fits in a 31bit smi
			return this.fetchCachedObject(this.archieveCache, cachekey, get, obj => obj.reduce((a, v) => a + v.size, 0));
		}
	}
}
