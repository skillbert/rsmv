import { Mapconfig } from ".";
import { AwsClient } from "aws4fetch"
import { ScriptFS, naiveDirname } from "../scriptrunner";
import { assertSchema, maprenderConfigSchema } from "../jsonschemas";
import * as commentjson from "comment-json";

export type VersionFilter = {
	from?: number,
	to?: number
};

export type UniqueMapFile = {
	name: string,
	hash: number
};

export type KnownMapFile = {
	hash: number,//hash of dependencies of rendered map chunks
	fshash: number,//hash of the dependencies of the original render. This can be different from hash if the original render had source files with different hashes, but with identical visuals. this needs to be tracked in order to dedupe mipmapping
	file: string,
	time: number,
	buildnr: number,
	firstbuildnr: number
};

export type SymlinkCommand = {
	file: string,
	version: number,
	target: string,
	targetversion: number,
};

export function parseMapConfig(configfile: string) {
	let layerconfig = commentjson.parse(configfile) as any;
	delete layerconfig.$schema;//for some reason jsonschema has special (incorrect) behavior for this
	assertSchema(layerconfig, maprenderConfigSchema);
	return layerconfig;
}

type VersionFolder = string | number;

export function mimeTypeFromExtension(filename: string): string {
	const ext = filename.match(/\.(\w+)$/);
	if (!ext) { return "application/octet-stream"; }
	switch (ext[1].toLowerCase()) {
		case "svg": return "image/svg+xml";
		case "png": return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "webp": return "image/webp";
		case "gif": return "image/gif";
		case "json": return "application/json";
		case "gz": return "application/gzip";
		case "bin": return "application/octet-stream";
		default: return `image/${ext[1]}`;
	}
}

export abstract class MapRender {
	config: Mapconfig;
	version = 0;
	multiversion: boolean;
	workerid = "default";
	constructor(config: Mapconfig, multiversion = false) {
		this.config = config;
		this.multiversion = multiversion;
	}
	abstract readDir(name: string, type: "files" | "directories", version?: VersionFolder): Promise<string[]>;
	abstract getFileResponse(name: string, version?: VersionFolder): Promise<Response>;
	abstract saveFile(name: string, data: Buffer, version?: VersionFolder): Promise<void>;
	abstract symlink(name: string, version: VersionFolder, sourcename: string, sourceversion: VersionFolder): Promise<void>;
	abstract delete(name: string, version?: VersionFolder): Promise<void>;

	getLayerZooms(pxpersquare: number) {
		const min = Math.floor(Math.log2(this.config.tileimgsize / (Math.max(this.config.mapsizex, this.config.mapsizez) * 64)));
		const max = Math.log2(pxpersquare);
		const base = Math.log2(this.config.tileimgsize / 64);
		return { min, max, base };
	}

	makeFolderName(layer: string, zoom: number | null, extra = "") {
		let name = layer;
		if (zoom != null) { name += `/${zoom}`; }
		if (extra) { name += `/${extra}`; }
		return name;
	}
	makeFileName(layer: string, zoom: number | null, x: number, y: number, ext: string, extra = "") {
		return `${this.makeFolderName(layer, zoom, extra)}/${x}-${y}.${ext}`;
	}

	versionedName(version: VersionFolder, name: string) {
		if (this.multiversion) {
			if (version == 0) {
				return name;
			} else {
				return `${version}/${name}`;
			}
		} else {
			if (version != 0 && version != this.version) {
				throw new Error("unexpected file version");
			}
			return name;
		}
	}

	async symlinkBatch(files: SymlinkCommand[]) {
		await Promise.all(files.map(f => this.symlink(f.file, f.version, f.target, f.targetversion)));
	}
	async beginMapVersion(version: number) {
		this.version = version;
	}
}

export class MapRenderFsBacked extends MapRender {
	fs: ScriptFS;
	constructor(fs: ScriptFS, config: Mapconfig, multiversion: boolean) {
		super(config, multiversion);
		this.fs = fs;
	}
	async saveFile(name: string, data: Buffer, version: VersionFolder = this.version) {
		name = this.versionedName(version, name);
		await this.fs.mkDir(naiveDirname(name));
		await this.fs.writeFile(name, data);
	}
	async readDir(name: string, type: "files" | "directories", version: VersionFolder = this.version) {
		name = this.versionedName(version, name);
		let entries = await this.fs.readDir(name).catch(() => []);
		if (type == "files") {
			return entries.filter(q => q.kind == "file").map(q => q.name);
		} else {
			return entries.filter(q => q.kind == "directory").map(q => q.name);
		}
	}
	async getFileResponse(name: string, version = this.version) {
		name = this.versionedName(version, name);
		try {
			const mimetype = mimeTypeFromExtension(name);
			await this.fs.mkDir(naiveDirname(name));
			let file = await this.fs.readFileBuffer(name);
			return new Response(file as Buffer<ArrayBuffer>, { headers: { "content-type": mimetype } });
		} catch {
			return new Response(null, { status: 404 });
		}
	}
	async symlink(name: string, version: VersionFolder, targetname: string, targetversion: VersionFolder) {
		name = this.versionedName(version, name);
		targetname = this.versionedName(targetversion, targetname);
		await this.fs.mkDir(naiveDirname(name));
		await this.fs.copyFile(targetname, name, true);
	}
	async delete(name: string, version: VersionFolder = this.version) {
		name = this.versionedName(version, name);
		await this.fs.unlink(name);
	}
}

export type S3BackendConfig = {
	endpoint: string,//hostname of the endpoint excluding the bucket eg "region.amazonaws.com"
	bucket: string,
	prefix?: string,
	accessKeyId?: string,
	secretAccessKey?: string,
};

export class MapRenderS3Backed extends MapRender {
	s3config: S3BackendConfig;
	private client: AwsClient | null = null;

	constructor(s3config: S3BackendConfig, config: Mapconfig, multiversion: boolean) {
		super(config, multiversion);
		this.s3config = s3config;
	}

	private getClient() {
		if (!this.client) {
			this.client = new AwsClient({
				accessKeyId: this.s3config.accessKeyId ?? "",
				secretAccessKey: this.s3config.secretAccessKey ?? "",
				service: "s3"
			});
		}
		return this.client;
	}

	private s3host() {
		return `https://${this.s3config.bucket}.${this.s3config.endpoint}`;
	}
	// Builds the full URL for an S3 key using path-style against the configured endpoint.
	private s3url(key: string) {
		const prefix = this.s3config.prefix ? this.s3config.prefix.replace(/\/*$/, "/") : "";
		const fullKey = encodeURI(`${prefix}${key}`);
		return `${this.s3host()}/${fullKey}`;
	}

	async saveFile(name: string, data: Buffer, version: VersionFolder = this.version) {
		const client = this.getClient();
		name = this.versionedName(version, name);
		const resp = await client.fetch(this.s3url(name), {
			method: "PUT",
			headers: {
				"content-type": mimeTypeFromExtension(name),
				"x-amz-acl": "public-read"
			},
			body: data as unknown as BodyInit,
		});
		if (!resp.ok) { throw new Error(`S3 PUT failed: ${resp.status} ${resp.statusText}`); }
	}

	async readDir(name: string, type: "files" | "directories", version: VersionFolder = this.version): Promise<string[]> {
		const client = this.getClient();
		name = this.versionedName(version, name);
		const prefix = (this.s3config.prefix ? this.s3config.prefix.replace(/\/*$/, "/") : "") + name.replace(/\/*$/, "/");
		const results: string[] = [];
		let continuationToken: string | undefined;
		do {
			const params = new URLSearchParams({ "list-type": "2", prefix, delimiter: "/" });
			if (continuationToken) { params.set("continuation-token", continuationToken); }
			const resp = await client.fetch(`${this.s3host()}/?${params}`);
			if (!resp.ok) { throw new Error(`S3 list failed: ${resp.status}`); }
			const xml = await resp.text();
			if (type === "files") {
				for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
					const key = m[1];
					if (!key.endsWith("/")) { results.push(key.slice(prefix.length)); }
				}
			} else {
				for (const m of xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)) {
					const p = m[1];
					if (p !== prefix) { results.push(p.slice(prefix.length).replace(/\/$/, "")); }
				}
			}
			const tokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
			continuationToken = tokenMatch?.[1];
		} while (continuationToken);
		return results;
	}

	getFileResponse(name: string, version: VersionFolder = this.version) {
		const client = this.getClient();
		name = this.versionedName(version, name);
		return client.fetch(this.s3url(name));
	}

	async symlink(name: string, version: VersionFolder, targetname: string, targetversion: VersionFolder) {
		// S3 has no symlinks; copy the object server-side instead
		const client = this.getClient();
		name = this.versionedName(version, name);
		targetname = this.versionedName(targetversion, targetname);
		const prefix = this.s3config.prefix ? this.s3config.prefix.replace(/\/*$/, "/") : "";
		const copySource = `${this.s3config.bucket}/${prefix}${targetname}`;
		const resp = await client.fetch(this.s3url(name), {
			method: "PUT",
			headers: {
				"x-amz-copy-source": encodeURIComponent(copySource),
				"x-amz-acl": "public-read"
			},
		});
		if (!resp.ok) { throw new Error(`S3 COPY failed: ${resp.status} ${resp.statusText}`); }
	}

	async delete(name: string, version: VersionFolder = this.version) {
		const client = this.getClient();
		name = this.versionedName(version, name);
		const resp = await client.fetch(this.s3url(name), { method: "DELETE" });
		if (!resp.ok) { throw new Error(`S3 DELETE failed: ${resp.status} ${resp.statusText}`); }
	}
}

//TODO move to seperate file?
export const examplemapconfig = `
{
	"$schema": "../generated/maprenderconfig.schema.json",
	//test gives a 3x3 area around lumby, "main" for the main world map, "full" for everything, a list of rectangles is also accepted eg: "50.50,20.20-70.70"
	"area": "test",//"45.45-55.55", //"50.45-51.46",
	//the size of the output images, usually 256 or 512
	"tileimgsize": 512,
	//set to true to keep the output y origin at the bottom left, equal to the game z origin
	"noyflip": false,
	//set to true to keep output chunks aligned with in-game chunks. Incurs performance penalty as more neighbouring chunks have to be loaded
	"nochunkoffset": false,
	//list of layers to render
	"layers": [
		{
			"name": "level-0", //name of the layer, this will be the folder name
			"mode": "3d", //3d world render
			"format": "webp", //currently only png and webp. jpeg in theory supported but not implemented or tested
			"level": 0, //floor level of the render, 0 means ground floor and all roofs are hidden, highest level is 3 which makes all roofs visible
			"pxpersquare": 16, //the level of detail for highest zoom level measured in pixels per map tile (1x1 meter). Subject to pxpersquare*64>tileimgsize, because it is currently not possible to render less than one image per mapchunk
			"dxdy": 0.15, //dxdy and dzdy to determine the view angle, 0,0 for straight down, something like 0.15,0.25 for birds eye
			"dzdy": 0.25
		},
		{
			"name": "level-1", //name of the layer, this will be the folder name
			"mode": "3d", //3d world render
			"format": "webp", //currently only png and webp. jpeg in theory supported but not implemented or tested
			"level": 1, //floor level of the render, 0 means ground floor and all roofs are hidden, highest level is 3 which makes all roofs visible
			"subtractlayers": ["level-0"], //list of other layers that will be checked for identical content and symlinked if identical. In this example it will result in a symlink when floor 1 is empty.
			"pxpersquare": 16, //the level of detail for highest zoom level measured in pixels per map tile (1x1 meter). Subject to pxpersquare*64>tileimgsize, because it is currently not possible to render less than one image per mapchunk
			"dxdy": 0.15, //dxdy and dzdy to determine the view angle, 0,0 for straight down, something like 0.15,0.25 for birds eye
			"dzdy": 0.25
		},
		{
			"name": "topdown-0", //name of the layer, this will be the folder name
			"mode": "3d", //3d world render
			"format": "webp", //currently only png and webp. jpeg in theory supported but not implemented or tested
			"level": 0, //floor level of the render, 0 means ground floor and all roofs are hidden, highest level is 3 which makes all roofs visible
			"pxpersquare": 16, //the level of detail for highest zoom level measured in pixels per map tile (1x1 meter). Subject to pxpersquare*64>tileimgsize, because it is currently not possible to render less than one image per mapchunk
			"dxdy": 0, //dxdy and dzdy to determine the view angle, 0,0 for straight down, something like 0.15,0.25 for birds eye
			"dzdy": 0
		},
		{
			"name": "map",
			"mode": "map", //old style 2d map render
			"format": "png",
			"level": 0,
			"mapicons": true,
			"wallsonly": false //can be turned on to create a walls overlay layer to use on top of an existing 3d layer
		},
		{
			"name": "minimap",
			"mode": "minimap", //minimap style render, similar to 3d but uses different shaders and emulates several rs bugs.
			"format": "webp",
			"level": 0,
			"pxpersquare": 16,
			"hidelocs": false, //can be turned on to emulate partially loaded minimap
			"mipmode": "avg", //results in every pixel of a mip image being exactly the mean of 4 zoomed pixels without any other filtering steps, required for minimap localization
			"dxdy": 0,
			"dzdy": 0
		},
		{
			"name": "collision",
			"mode": "collision", //pathing/line of sight as overlay image layer to use on "map" or "3d"
			"format": "png",
			"level": 0,
			"pxpersquare": 16
		},
		{
			"name": "height",
			"mode": "height", //binary file per chunk containing 16bit height data and 16 bits of collision data in base3 per tile
			"level": 0,
			"usegzip": true //gzips the resulting file, need some server config to serve the compressed file
		},
		{
			"name": "locs",
			"mode": "locs", //json file with locs per chunk
			"level": 0,
			"usegzip": false
		},
		{
			"name": "maplabels",
			"mode": "maplabels", //json file per chunk containing maplabel images and uses
			"level": 0,
			"usegzip": false
		},
		{
			"name": "rendermeta",
			"mode": "rendermeta", //advanced - json file containing metadata about the chunk render, used to dedupe historic renders
			"level": 0
		},
		{
			"name": "interactions",
			"mode": "interactions",
			"pxpersquare": 16, //same arguments as mode="3d"
			"dxdy": 0.15,
			"dzdy": 0.25,
			"format": "webp",
			"level": 0,
			"usegzip": true
		}
	],
	//used to determine lowest scaling mip level, should generally always be 100,200 which ensures the lowest mip level contains the entire rs world in one image
	"mapsizex": 100,
	"mapsizez": 200
}`;