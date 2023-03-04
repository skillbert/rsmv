import * as cache from "./index";
import { decompress } from "./compression";
import { cacheMajors, latestBuildNumber } from "../constants";
import { CacheIndex } from "./index";
import fetch from "node-fetch";

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

var cachelist: Promise<Openrs2CacheMeta[]> | null = null;
export function validOpenrs2Caches() {
	if (!cachelist) {
		cachelist = (async () => {
			const openrs2Blacklist: number[] = [
				//some of these might actually be fine
				423,//osrs cache wrongly labeled as rs3?
				623,//seems to have different builds in it
				693,//wrong timestamp?
				621, 619, 618, 620, 617,//wrong timestamp/osrs?
				840,//multiple builds
				734, 736, 733,//don't have items index
				20, 19, 17, 13, 10, 9, 8, 7, 6, 5,//don't have items index
			];
			let allcaches: Openrs2CacheMeta[] = await fetch(`${endpoint}/caches.json`).then(q => q.json());
			let checkedcaches = allcaches.filter(q =>
				q.language == "en" && q.environment == "live" && !openrs2Blacklist.includes(q.id)
				&& q.game == "runescape" && q.timestamp && q.builds.length != 0
			).sort((a, b) => b.builds[0].major - a.builds[0].major || (b.builds[0].minor ?? 0) - (a.builds[0].minor ?? 0) || +new Date(b.timestamp!) - +new Date(a.timestamp!));

			return checkedcaches;
		})();
	}
	return cachelist;
}

export class Openrs2CacheSource extends cache.DirectCacheFileSource {
	meta: Openrs2CacheMeta;
	buildnr: number;

	static async fromId(cacheid: number) {
		let meta = await Openrs2CacheSource.downloadCacheMeta(cacheid);
		return new Openrs2CacheSource(meta.meta);
	}
	constructor(meta: Openrs2CacheMeta) {
		super(false);
		this.meta = meta;
		if (meta.builds.length != 0) {
			this.buildnr = meta.builds[0].major;
		} else {
			console.warn("using historic cache for which the build number is not available, treating it as current.");
			this.buildnr = latestBuildNumber;
		}
	}
	getCacheMeta() {
		return {
			name: `openrs2:${this.meta.id}`,
			descr: `build: ${this.meta.builds[0].major}`
				+ `\ndate: ${new Date(this.meta.timestamp ?? "").toDateString()}`
				+ `\nHistoric cache loaded from openrs2 cache repository.`
		};
	}
	getBuildNr() {
		return this.buildnr;
	}

	static async downloadCacheMeta(cacheid: number) {
		//yep, i used regex on html, sue me
		let rootindexhtml = await fetch(`${endpoint}/caches/runescape/${cacheid}`).then(q => q.text());

		let tabletextmatch = rootindexhtml.match(/<h2>Master index[\s\S]*?<table([\s\S]*?)<\/table>/i);
		if (!tabletextmatch) { throw new Error("failed to parse root index"); }
		let sourcetextmatch = rootindexhtml.match(/<h2>Sources[\s\S]*?<table([\s\S]*?)<\/table>/i);
		if (!sourcetextmatch) { throw new Error("failed to parse source table"); }
		let metatextmatch = rootindexhtml.match(/<h1>Cache[\s\S]*?<table([\s\S]*?)<\/table>/i);
		if (!metatextmatch) { throw new Error("failed to parse meta table"); }

		let majors: CacheIndex[] = [];
		let rowmatches = [...tabletextmatch[1].matchAll(/<tr>[\s\S]+?<\/tr>/gi)].slice(1);
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

		let sourcerows = [...sourcetextmatch[1].matchAll(/<tr>[\s\S]+?<\/tr>/gi)].map(rowmatch => [...rowmatch[0].matchAll(/<td.*?>([\s\S]*?)<\/td>/gi)]).slice(1);
		let metarows = [...metatextmatch[1].matchAll(/<tr>[\s\S]+?<\/tr>/gi)].map(rowmatch => [...rowmatch[0].matchAll(/<td.*?>([\s\S]*?)<\/td>/gi)]);

		let getmetarow = (rownr: number) => {
			let match = metarows[rownr][0][1].match(/([\d,\s]+)\/([\d,\s]+)/);
			if (!match) { throw new Error("failed to parse cache meta html"); }
			return {
				min: +match[1].replace(/[,\s]/g, ""),
				max: +match[2].replace(/[,\s]/g, "")
			}
		}

		let cachesize = parseFloat(metarows[4][0][1]);
		if (metarows[4][0][1].endsWith("MiB")) { cachesize *= 1024 * 1024; }
		else if (metarows[4][0][1].endsWith("GiB")) { cachesize *= 1024 * 1024 * 1024; }
		else { throw new Error("failed to parse cache size"); }

		let meta: Openrs2CacheMeta = {
			id: cacheid,
			scope: "runescape",
			game: sourcerows[0][0][1].trim(),
			environment: sourcerows[0][1][1].trim(),
			language: sourcerows[0][2][1].trim(),
			builds: sourcerows.map(row => {
				let parts = row[3][1].split(".");
				return {
					major: +parts[0],
					minor: (parts[1] == undefined ? null : +parts[1])
				}
			}),
			timestamp: sourcerows[0][4][1],
			sources: sourcerows.map(row => row[5][1].trim()),
			valid_indexes: getmetarow(1).min,
			valid_groups: getmetarow(2).min,
			valid_keys: getmetarow(3).min,
			indexes: getmetarow(1).min,
			groups: getmetarow(2).max,
			keys: getmetarow(3).max,
			disk_store_valid: true,
			size: cachesize,
			blocks: Math.round(cachesize / 512)//very bad estimate, seems to have different meaning
		};

		return { meta, majors };
	}

	async downloadFile(major: number, minor: number) {
		let url = `${endpoint}/caches/runescape/${this.meta.id}/archives/${major}/groups/${minor}.dat`;
		// console.log(url);
		const req = await fetch(url);
		if (!req.ok) { throw new Error(`failed to download cache file ${major}.${minor} from openrs2 ${this.meta.id}, http code: ${req.status}`); }
		const buf = await req.arrayBuffer();
		//at least make sure we are aware if we're ddossing someone....
		if (Math.floor(downloadedBytes / 10_000_000) != Math.floor((downloadedBytes + buf.byteLength) / 10_000_000)) {
			console.info(`loaded ${(downloadedBytes + buf.byteLength) / 1000_000 | 0} mb from openrs2`);
		}
		downloadedBytes += buf.byteLength;
		return Buffer.from(buf);
	}

	async getFile(major: number, minor: number, crc?: number) {
		return decompress(await this.downloadFile(major, minor));
	}
}
