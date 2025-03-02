import * as cache from "./index";
import { decompress, legacyGzip } from "./compression";
import { cacheMajors, lastLegacyBuildnr, latestBuildNumber } from "../constants";
import fetch from "node-fetch";
import { FileSourceFsCache } from "./fscache";

const endpoint = `https://archive.openrs2.org`;
var downloadedBytes = 0;

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

type Openrs2XteaKey = {
	archive: number,
	group: number,
	name_hash: number,
	name: string | null,
	mapsquare: number | null,
	key: [number, number, number, number]
}

var validcachelist: Promise<Openrs2CacheMeta[]> | null = null;
var cachelist: Promise<Openrs2CacheMeta[]> | null = null;

export function loadOpenrsCachelist() {
	cachelist ??= fetch(`${endpoint}/caches.json`).then(q => q.json());
	return cachelist;
}

export function validOpenrs2Caches() {
	validcachelist ??= (async () => {
		const openrs2Blacklist: number[] = [
			//some of these might actually be fine
			423,//osrs cache wrongly labeled as rs3?
			623,//seems to have different builds in it
			693,//wrong timestamp?
			621, 619, 618, 620, 617,//wrong timestamp/osrs?
			840,//multiple builds
			734, 736, 733, 732, 731,//don't have items index
			20, 19, 17, 13, 10, 9, 8, 7, 6, 5,//don't have items index

			2,//missing basically everything
			1255,//missing files and invalid compression?

			905,//missing textures
			1256,//missing materials
			1003,//missing materials
			638,//missing materials

			542,//missing models

			463,//wrong build number?

			//large gaps in files according to openrs2ids command
			621, 623, 620, 617, 618, 619,
			734, 733, 20, 10, 9, 8, 7, 2,
			666, 729, 730, 728,

			1455,//weird clientscript

			312, 286, 1420, 1421, 1530,//missing clientscripts


			//TODO fix these or figure out whats wrong with them
			1480,

			644, 257,//incomplete textures
			1456, 1665,//missing materials
			1479,//missing items could probably be worked around
		];
		let allcaches = await loadOpenrsCachelist();
		let checkedcaches = allcaches.filter(q =>
			q.language == "en" && q.environment == "live" && !openrs2Blacklist.includes(q.id)
			&& q.game == "runescape" && q.timestamp && q.builds.length != 0
		).sort((a, b) => b.builds[0].major - a.builds[0].major || (b.builds[0].minor ?? 0) - (a.builds[0].minor ?? 0) || +new Date(b.timestamp!) - +new Date(a.timestamp!));

		return checkedcaches;
	})();
	return validcachelist;
}

export function openrs2GetEffectiveBuildnr(cachemeta: Openrs2CacheMeta) {
	let match = cachemeta.builds.find(q => q.major != 0);
	return (match ? match.major : -1);
}

export class Openrs2CacheSource extends cache.DirectCacheFileSource {
	meta: Openrs2CacheMeta;
	buildnr: number;
	xteaKeysLoaded = false;
	xteakeysPromise: Promise<void> | null = null;
	fscache: FileSourceFsCache | null;

	static async fromId(cacheid: number) {
		let caches = await loadOpenrsCachelist();
		let meta = caches.find(q => q.id == cacheid);
		if (!meta) { throw new Error(`cache ${cacheid} not found on openrs`); }
		return new Openrs2CacheSource(meta);
	}
	constructor(meta: Openrs2CacheMeta) {
		super(false);
		this.meta = meta;
		let buildnr = openrs2GetEffectiveBuildnr(meta);
		if (buildnr != -1) {
			this.buildnr = buildnr;
		} else {
			console.warn("using historic cache for which the build number is not available, treating it as current.");
			this.buildnr = latestBuildNumber;
		}
		this.fscache = FileSourceFsCache.tryCreate();
	}
	getCacheMeta() {
		return {
			name: `openrs2:${this.meta.id}`,
			descr: `build: ${this.buildnr}`
				+ `\ndate: ${new Date(this.meta.timestamp ?? "").toDateString()}`
				+ `\nHistoric cache loaded from openrs2 cache repository.`,
			timestamp: new Date(this.meta.timestamp ?? 0)
		};
	}
	getBuildNr() {
		return this.buildnr;
	}
	async getCacheIndex(major: number) {
		if (this.buildnr <= 700 && !this.xteaKeysLoaded && major == cacheMajors.mapsquares) {
			this.xteakeysPromise ??= (async () => {
				this.xteakeys ??= new Map();
				let keys: Openrs2XteaKey[] = await fetch(`${endpoint}/caches/runescape/${this.meta.id}/keys.json`).then(q => q.json());
				for (let key of keys) {
					//merge into one 31bit int
					let lookupid = (key.archive << 23) | key.group;
					this.xteakeys.set(lookupid, new Uint32Array(key.key));
				}
				this.xteaKeysLoaded = true;
				console.log(`loaded ${keys.length} xtea keys`);
			})();
			await this.xteakeysPromise;
		}
		return super.getCacheIndex(major);
	}

	static async getRecentCache(count = 0) {
		let relevantcaches = await validOpenrs2Caches();
		return relevantcaches[count];
	}

	async downloadFile(major: number, minor: number) {
		// we don't have metadata for the root index file 255.255, and legacy caches don't use version/crc
		let url: string;
		if ((major == cacheMajors.index && minor == cacheMajors.index) || this.getBuildNr() <= lastLegacyBuildnr) {
			// slower endpoint that doesn't require crc/version
			url = `${endpoint}/caches/runescape/${this.meta.id}/archives/${major}/groups/${minor}.dat`;
		} else {
			// fast endpoint that uses crc and version
			let index = await this.getIndexEntryById(major, minor);
			url = `${endpoint}/caches/runescape/archives/${major}/groups/${minor}/versions/${index.version}/checksums/${index.crc | 0}.dat`;
		}
		const req = await fetch(url);
		if (!req.ok) { throw new Error(`failed to download cache file ${major}.${minor} from openrs2 ${this.meta.id}, http code: ${req.status}`); }
		const buf = await req.arrayBuffer();
		let res = Buffer.from(buf);
		//at least make sure we are aware if we're ddossing someone....
		if (Math.floor(downloadedBytes / 10_000_000) != Math.floor((downloadedBytes + buf.byteLength) / 10_000_000)) {
			console.info(`loaded ${(downloadedBytes + res.byteLength) / 1000_000 | 0} mb from openrs2`);
		}
		downloadedBytes += res.byteLength;
		return res;
	}

	async getFile(major: number, minor: number, crc?: number) {
		let cachedfile: Buffer | null = null
		if (this.fscache && typeof crc != "undefined" && crc != 0) {//TODO fix places that use a magic 0 crc
			cachedfile = await this.fscache.getFile(major, minor, crc);
		} else {
			// console.log("uncachable", major, minor, crc);
		}
		let rawfile = cachedfile ?? await this.downloadFile(major, minor);
		if (this.fscache && !cachedfile && typeof crc != "undefined" && crc != 0) {
			this.fscache.addFile(major, minor, crc, rawfile);
		}
		if (this.buildnr <= lastLegacyBuildnr) {
			if (major == 0) {
				return rawfile;
			} else {
				return legacyGzip(rawfile);
			}
		} else {
			return decompress(rawfile, this.getXteaKey(major, minor));
		}
	}
}
