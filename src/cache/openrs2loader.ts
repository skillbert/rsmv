import * as cache from "./index";
import { compressSqlite, decompress, decompressSqlite } from "./compression";
import { cacheMajors } from "../constants";
import { CacheIndex } from "./index";
import fetch from "node-fetch";

const endpoint = `https://archive.openrs2.org`;

type CacheTable = {
	indices: Promise<cache.CacheIndexFile>
}

export type Openrs2CacheMeta = {
	id: number,
	scope: string
	game: string
	environment: string
	language: string,
	builds: { major: number, minor: number | null }[],
	timestamp: string | null,
	sources: string[],
	valid_indexes: number,
	indexes: number,
	valid_groups: number,
	groups: number,
	valid_keys: number,
	keys: number,
	size: number,
	blocks: number,
	disk_store_valid: boolean
};

export class Openrs2CacheSource extends cache.CacheFileSource {
	cachename: string;
	opentables = new Map<number, CacheTable>();
	totalbytes = 0;

	static getCacheIds(): Promise<Openrs2CacheMeta[]> {
		return fetch(`${endpoint}/caches.json`).then(q => q.json());
	}

	constructor(cachename: string) {
		super();
		this.cachename = cachename;
	}
	getCacheName() {
		return `openrs2:${this.cachename}`;
	}

	async generateRootIndex() {
		//yep, i used regex on html, sue me
		console.log("using dummy cache index file meta containing dummy data for indices 1-61");

		let rootindexhtml = await fetch(`${endpoint}/caches/runescape/${this.cachename}`).then(q => q.text());

		let tabletextmatch = rootindexhtml.match(/Master index[\s\S]*?<table([\s\S]*)<\/table>/i);
		if (!tabletextmatch) { throw new Error("failed to parse root index"); }

		let majors: CacheIndex[] = [];
		let rowmatches = tabletextmatch[1].matchAll(/<tr>[\s\S]+?<\/tr>/gi);

		for (let rowmatch of rowmatches) {
			let fields = [...rowmatch[0].matchAll(/<td.*?>([\s\S]*?)<\/td>/gi)];
			if (fields.length == 6) {
				let major = +fields[0][1];
				let version = +fields[1][1].replace(/[,\.]/g, "");
				if (isNaN(major) || isNaN(version)) { throw new Error("invalid major or version field"); }
				//versoin 0 means it doesn't exist
				if (version == 0) { continue; }
				majors[major] = {
					major: cacheMajors.index,
					minor: major,
					crc: 0,
					size: 0,
					subindexcount: 1,
					subindices: [0],
					version: version,
					uncompressed_crc: 0,
					uncompressed_size: 0
				}
			}
		}

		return majors;
	}

	async downloadFile(major: number, minor: number) {
		const req = await fetch(`${endpoint}/caches/runescape/${this.cachename}/archives/${major}/groups/${minor}.dat`);
		if (!req.ok) { throw new Error(`failed to download cache file ${major}.${minor}, http code: ${req.status}`); }
		const buf = await req.arrayBuffer();
		//at least make sure we are aware if we're ddossing someone....
		if (Math.floor(this.totalbytes / 10_000_000) != Math.floor((this.totalbytes + buf.byteLength) / 10_000_000)) {
			console.info(`loaded ${(this.totalbytes + buf.byteLength) / 1000_000 | 0} mb from openrs2`);
		}
		this.totalbytes += buf.byteLength;
		return Buffer.from(buf);
	}

	async getFile(major: number, minor: number, crc?: number) {
		return decompress(await this.downloadFile(major, minor));
	}

	async getFileArchive(index: cache.CacheIndex) {
		let arch = await this.getFile(index.major, index.minor, index.crc);
		let res = cache.unpackBufferArchive(arch, index.subindices);
		return res;
	}

	async getIndexFile(major: number) {
		if (!this.opentables.get(major)) {
			let indices: Promise<cache.CacheIndex[]>;
			if (major == cacheMajors.index) {
				indices = this.generateRootIndex();
			} else {
				indices = this.getFile(cacheMajors.index, major).then(file => {
					return cache.indexBufferToObject(major, file);
				});
			}
			this.opentables.set(major, { indices });
		}
		return this.opentables.get(major)!.indices;
	}

	async getIndex(major: number) {
		return this.getFile(cacheMajors.index, major);
	}
}
