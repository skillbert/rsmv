import { LayerConfig, Mapconfig } from ".";
import { FetchThrottler } from "../utils";
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
	buildnr: number,
	hash: number,
	symlink: string,
	symlinkbuildnr: number,
	symlinkfirstbuildnr: number
};

export function parseMapConfig(configfile: string) {
	let layerconfig = commentjson.parse(configfile) as any;
	delete layerconfig.$schema;//for some reason jsonschema has special (incorrect) behavior for this
	assertSchema(layerconfig, maprenderConfigSchema);
	return layerconfig;
}

export abstract class MapRender {
	config: Mapconfig;
	version = 0;
	workerid = "default";
	constructor(config: Mapconfig) {
		this.config = config;
	}
	abstract getFileResponse(name: string, version?: number): Promise<Response>;
	abstract makeFileName(layer: string, zoom: number, x: number, y: number, ext: string): string;
	abstract saveFile(name: string, hash: number, data: Buffer, version?: number): Promise<void>;
	abstract symlink(name: string, hash: number, symlinktarget: string, symlinkversion?: number): Promise<void>;

	async symlinkBatch(files: SymlinkCommand[]) {
		await Promise.all(files.map(f => this.symlink(f.file, f.hash, f.symlink, f.symlinkbuildnr)));
	}
	async beginMapVersion(version: number) {
		this.version = version;
	}

	//optional api's when rendering history stuff
	rendermetaLayer: LayerConfig | undefined = undefined;
	async getRelatedFiles(names: string[], versions: number[]) {
		return [] as KnownMapFile[];
	}
	async getMetas(names: UniqueMapFile[]) {
		return [] as KnownMapFile[];
	}
}

export class MapRenderFsBacked extends MapRender {
	fs: ScriptFS;
	constructor(fs: ScriptFS, config: Mapconfig) {
		super(config);
		this.fs = fs;
	}
	makeFileName(layer: string, zoom: number, x: number, y: number, ext: string) {
		return `${layer}/${zoom}/${x}-${y}.${ext}`;
	}
	assertVersion(version = this.version) {
		if (version != 0 && version != this.version) { throw new Error("versions not supported"); }
	}
	async saveFile(name: string, hash: number, data: Buffer, version: number) {
		this.assertVersion(version);
		await this.fs.mkDir(naiveDirname(name));
		await this.fs.writeFile(name, data);
	}
	async getFileResponse(name: string, version?: number) {
		this.assertVersion(version);
		try {
			let ext = name.match(/\.(\w+)$/);
			let mimetype = (ext ? ext[1] == "svg" ? "image/svg+xml" : `image/${ext[1]}` : "");
			await this.fs.mkDir(naiveDirname(name));
			let file = await this.fs.readFileBuffer(name);
			return new Response(file, { headers: { "content-type": mimetype } });
		} catch {
			return new Response(null, { status: 404 });
		}
	}
	async symlink(name: string, hash: number, targetname: string, targetversion: number) {
		this.assertVersion(targetversion);
		await this.fs.mkDir(naiveDirname(name));
		await this.fs.copyFile(targetname, name, true);
	}
}

//The Runeapps map saves directly to the server and keeps a version history, the server side code for this is non-public
//The render code decides which (opaque to server) file names should exist and checks if that name+hash already exists,
//if not it will generate the file and save it together with some metadata (hash+build nr)
export class MapRenderDatabaseBacked extends MapRender {
	endpoint: string;
	workerid: string;
	uploadmapid: number;
	auth: string;
	overwrite: boolean;
	ignorebefore: Date;
	rendermetaLayer: LayerConfig | undefined;

	private postThrottler = new FetchThrottler(20);
	private fileThrottler = new FetchThrottler(20);

	constructor(endpoint: string, auth: string, workerid: string, uploadmapid: number, config: Mapconfig, rendermetaLayer: LayerConfig | undefined, overwrite: boolean, ignorebefore: Date) {
		super(config);
		this.endpoint = endpoint;
		this.auth = auth;
		this.workerid = workerid;
		this.overwrite = overwrite;
		this.rendermetaLayer = rendermetaLayer;
		this.uploadmapid = uploadmapid;
		this.ignorebefore = ignorebefore;
	}
	static async create(endpoint: string, auth: string, uploadmapid: number, overwrite: boolean, ignorebefore: Date) {
		let res = await fetch(`${endpoint}/config.json`, { headers: { "Authorization": auth } });
		if (!res.ok) { throw new Error("map config fetch error"); }
		let config: Mapconfig = await res.json();
		let rendermetaname = config.layers.find(q => q.mode == "rendermeta");

		let workerid = localStorage.map_workerid ?? "" + (Math.random() * 10000 | 0);
		localStorage.map_workerid ??= workerid;

		return new MapRenderDatabaseBacked(endpoint, auth, workerid, uploadmapid, config, rendermetaname, overwrite, ignorebefore);
	}
	makeFileName(layer: string, zoom: number, x: number, y: number, ext: string) {
		return `${layer}/${zoom}/${x}-${y}.${ext}`;
	}
	async beginMapVersion(version: number) {
		this.version = version;
		let send = await this.postThrottler.apiRequest(`${this.endpoint}/assurebuildnr?mapid=${this.uploadmapid}&buildnr=${this.version}`, {
			method: "post",
			headers: { "Authorization": this.auth },
			timeout: 1000 * 60 * 15
		});
		if (!send.ok) { throw new Error("failed to init map"); }
	}
	async saveFile(name: string, hash: number, data: Buffer, version = this.version) {
		let send = await this.postThrottler.apiRequest(`${this.endpoint}/upload?file=${encodeURIComponent(name)}&hash=${hash}&buildnr=${version}&mapid=${this.uploadmapid}`, {
			method: "post",
			headers: { "Authorization": this.auth },
			body: data
		});
		if (!send.ok) { throw new Error("file upload failed"); }
	}
	async symlink(name: string, hash: number, targetname: string, targetversion: number) {
		return this.symlinkBatch([{ file: name, hash, buildnr: this.version, symlink: targetname, symlinkbuildnr: targetversion, symlinkfirstbuildnr: targetversion }]);
	}
	async symlinkBatch(files: SymlinkCommand[]) {
		let version = this.version;
		let filtered = files.filter(q => q.file != q.symlink || version > q.symlinkbuildnr || version < q.symlinkfirstbuildnr);
		if (filtered.length == 0) {
			return;
		}
		let send = await this.postThrottler.apiRequest(`${this.endpoint}/uploadbatch?mapid=${this.uploadmapid}`, {
			method: "post",
			headers: {
				"Authorization": this.auth,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(files)
		});
		if (!send.ok) { throw new Error("file symlink failed"); }
	}
	async getMetas(names: UniqueMapFile[]) {
		if (this.overwrite) {
			return [];
		} else if (names.length == 0) {
			return [];
		} else {
			let req = await this.postThrottler.apiRequest(`${this.endpoint}/getmetas?file=${encodeURIComponent(names.map(q => `${q.name}!${q.hash}`).join(","))}&mapid=${this.uploadmapid}&buildnr=${this.version}&ignorebefore=${+this.ignorebefore}`, {
				headers: { "Authorization": this.auth },
			});
			if (!req.ok) { throw new Error("req failed"); }
			return await req.json() as KnownMapFile[];
		}
	}
	async getRelatedFiles(names: string[], versions: number[]) {
		if (names.length == 0 || versions.length == 0) {
			return [];
		}
		let req = await this.postThrottler.apiRequest(`${this.endpoint}/getfileversions?mapid=${this.uploadmapid}&ignorebefore=${+this.ignorebefore}`, {
			method: "post",
			headers: {
				"Authorization": this.auth,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				//TODO actually implement this?
				startversion: Math.min(...versions),
				endversion: Math.max(...versions),
				files: names
			})
		});
		if (!req.ok) { throw new Error("req faield"); }
		let files = await req.json() as KnownMapFile[];
		return files;
	}
	getFileResponse(name: string, version = this.version) {
		let url = `${this.endpoint}/getnamed?file=${encodeURIComponent(name)}&version=${version}&mapid=${this.uploadmapid}`;
		return this.fileThrottler.apiRequest(url, { cache: "reload" });
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
			"pxpersquare": 64, //the level of detail for highest zoom level measured in pixels per map tile (1x1 meter). Subject to pxpersquare*64>tileimgsize, because it is currently not possible to render less than one image per mapchunk
			"dxdy": 0.15, //dxdy and dzdy to determine the view angle, 0,0 for straight down, something like 0.15,0.25 for birds eye
			"dzdy": 0.25
		},
		{
			"name": "topdown-0", //name of the layer, this will be the folder name
			"mode": "3d", //3d world render
			"format": "webp", //currently only png and webp. jpeg in theory supported but not implemented or tested
			"level": 0, //floor level of the render, 0 means ground floor and all roofs are hidden, highest level is 3 which makes all roofs visible
			"pxpersquare": 64, //the level of detail for highest zoom level measured in pixels per map tile (1x1 meter). Subject to pxpersquare*64>tileimgsize, because it is currently not possible to render less than one image per mapchunk
			"dxdy": 0, //dxdy and dzdy to determine the view angle, 0,0 for straight down, something like 0.15,0.25 for birds eye
			"dzdy": 0
		},
		{
			"name": "map",
			"mode": "map", //old style 2d map render
			"format": "png",
			"level": 0,
			"pxpersquare": 64,
			"mapicons": true,
			"wallsonly": false //can be turned on to create a walls overlay layer to use on top of an existing 3d layer
		},
		{
			"name": "minimap",
			"mode": "minimap", //minimap style render, similar to 3d but uses different shaders and emulates several rs bugs.
			"format": "webp",
			"level": 0,
			"pxpersquare": 64,
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
			"pxpersquare": 64
		},
		{
			"name": "height",
			"mode": "height", //binary file per chunk containing 16bit height data and 16 bits of collision data in base3 per tile
			"level": 0,
			"pxpersquare": 1, //unused but required
			"usegzip": true //gzips the resulting file, need some server config to serve the compressed file
		},
		{
			"name": "locs",
			"mode": "locs", //json file with locs per chunk
			"level": 0,
			"pxpersquare": 1, //unused but required
			"usegzip": false
		},
		{
			"name": "maplabels",
			"mode": "maplabels", //json file per chunk containing maplabel images and uses
			"level": 0,
			"pxpersquare": 1,
			"usegzip": false
		},
		{
			"name": "rendermeta",
			"mode": "rendermeta", //advanced - json file containing metadata about the chunk render, used to dedupe historic renders
			"level": 0,
			"pxpersquare": 1
		},
		{
			"name": "interactions",
			"mode": "interactions",
			"pxpersquare": 64, //same arguments as mode="3d"
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