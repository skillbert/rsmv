import * as path from "path";
import * as fs from "fs";
import { CacheFileSource, CacheIndex, CacheIndexFile, SubFile } from "./index";


export class RawFileLoader extends CacheFileSource {
	cachedir: string;
	virtualMajor: number;
	index: CacheIndex[];
	files = new Map<number, string>();

	constructor(cachedir: string, virtualMajor = 0) {
		super();
		this.cachedir = cachedir;
		this.virtualMajor = virtualMajor;
		let dir = fs.readdirSync(cachedir);
		this.index = dir.map((name, index) => {
			this.files.set(index, name);
			return {
				major: virtualMajor,
				minor: index,
				crc: 0,
				subindexcount: 1,
				subindices: [0],
				subnames: null,
				version: 0,
				size: 0,
				name: null,
				uncompressed_crc: 0,
				uncompressed_size: 0
			};
		})
	}
	getCacheMeta() {
		return {
			name: `files:${this.cachedir}`,
			descr: `Only index ${this.virtualMajor}, loaded from unpacked cache files in ${this.cachedir}.`,
			timestamp: new Date(0)
		}
	}

	getFile(major: number, minor: number, crc?: number) {
		let name = this.files.get(minor);
		if (!name) { throw new Error(`virtual minor ${minor} does not have a corresponding file`); }
		return fs.promises.readFile(path.join(this.cachedir, name));
	}
	async getFileArchive(index: CacheIndex): Promise<SubFile[]> {
		let file = await this.getFile(index.major, index.minor, index.crc)
		return [{ fileid: 0, offset: 0, size: file.byteLength, buffer: file, namehash: null }];
	}
	async getCacheIndex(major: number): Promise<CacheIndexFile> {
		return this.index;
	}
}
