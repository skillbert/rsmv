import fs from "fs/promises";
import path from "path";
import { LayerConfig, Mapconfig } from ".";
import { FetchThrottler } from "../utils";

export type UniqueMapFile = { name: string, hash: number };

export type KnownMapFile = { hash: number, file: string, time: number, buildnr: number, firstbuildnr: number };

export type SymlinkCommand = { file: string, buildnr: number, hash: number, symlink: string, symlinkbuildnr: number, symlinkfirstbuildnr: number };

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
	abstract symlink(name: string, hash: number, targetname: string, targetversion?: number): Promise<void>;

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
	path: string;
	copyOnSymlink = true;
	constructor(filepath: string, config: Mapconfig) {
		super(config);
		this.path = path.resolve(filepath);
	}
	async getFilePath(name: string) {
		let pathname = path.resolve(this.path, name);
		let dir = path.dirname(pathname);
		await fs.mkdir(dir, { recursive: true });
		return pathname;
	}
	makeFileName(layer: string, zoom: number, x: number, y: number, ext: string) {
		return `${layer}/${zoom}/${x}-${y}.${ext}`;
	}
	assertVersion(version = this.version) {
		if (version != 0 && version != this.version) { throw new Error("versions not supported"); }
	}
	async saveFile(name: string, hash: number, data: Buffer, version: number) {
		this.assertVersion(version);
		await fs.writeFile(await this.getFilePath(name), data);
	}
	async getFileResponse(name: string, version?: number) {
		this.assertVersion(version);
		try {
			let ext = name.match(/\.(\w+)$/);
			let mimetype = (ext ? ext[1] == "svg" ? "image/svg+xml" : `image/${ext[1]}` : "");
			let file = await fs.readFile(await this.getFilePath(name));
			return new Response(file, { headers: { "content-type": mimetype } });
		} catch {
			return new Response(null, { status: 404 });
		}
	}
	async symlink(name: string, hash: number, targetname: string, targetversion: number) {
		this.assertVersion(targetversion);
		if (this.copyOnSymlink) {
			//don't actually symliink because windows its weird in windows
			await fs.copyFile(await this.getFilePath(targetname), await this.getFilePath(name));
		} else {
			await fs.symlink(await this.getFilePath(name), await this.getFilePath(targetname), "file");
		}
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
	rendermetaLayer: LayerConfig | undefined;

	private postThrottler = new FetchThrottler(20);
	private fileThrottler = new FetchThrottler(20);

	constructor(endpoint: string, auth: string, workerid: string, uploadmapid: number, config: Mapconfig, rendermetaLayer: LayerConfig | undefined, overwrite: boolean) {
		super(config);
		this.endpoint = endpoint;
		this.auth = auth;
		this.workerid = workerid;
		this.overwrite = overwrite;
		this.rendermetaLayer = rendermetaLayer;
		this.uploadmapid = uploadmapid;
	}
	static async create(endpoint: string, auth: string, uploadmapid: number, overwrite: boolean) {
		let res = await fetch(`${endpoint}/config.json`, { headers: { "Authorization": auth } });
		if (!res.ok) { throw new Error("map config fetch error"); }
		let config: Mapconfig = await res.json();
		let rendermetaname = config.layers.find(q => q.mode == "rendermeta");

		let workerid = localStorage.map_workerid ?? "" + (Math.random() * 10000 | 0);
		localStorage.map_workerid ??= workerid;

		return new MapRenderDatabaseBacked(endpoint, auth, workerid, uploadmapid, config, rendermetaname, overwrite);
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
			let req = await this.postThrottler.apiRequest(`${this.endpoint}/getmetas?file=${encodeURIComponent(names.map(q => `${q.name}!${q.hash}`).join(","))}&mapid=${this.uploadmapid}&buildnr=${this.version}`, {
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
		let req = await this.postThrottler.apiRequest(`${this.endpoint}/getfileversions?mapid=${this.uploadmapid}`, {
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