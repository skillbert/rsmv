
import { disposeThreeTree, ThreeJsRenderer } from "../viewer/threejsrender";
import { ParsemapOpts, MapRect, worldStride, CombinedTileGrid, classicChunkSize, rs2ChunkSize, TileGrid, tiledimensions } from "../3d/mapsquare";
import { CacheFileSource } from "../cache";
import { svgfloor } from "./svgrender";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { canvasToImageFile, flipImage, isImageEqual, maskImage, pixelsToImageFile } from "../imgutils";
import { EngineCache, ThreejsSceneCache } from "../3d/modeltothree";
import { crc32addInt, DependencyGraph, getDependencies } from "../scripts/dependencies";
import { CLIScriptOutput, ScriptOutput } from "../viewer/scriptsui";
import { CallbackPromise, delay, FetchThrottler, stringToMapArea, trickleTasks } from "../utils";
import { drawCollision } from "./collisionimage";
import prettyJson from "json-stringify-pretty-compact";
import { ChunkLocDependencies, chunkSummary, ChunkTileDependencies, compareFloorDependencies, compareLocDependencies, ImageDiffGrid, mapsquareFloorDependencies, mapsquareLocDependencies } from "./chunksummary";
import { RSMapChunk, RSMapChunkData } from "../3d/modelnodes";
import * as zlib from "zlib";
import { Camera, Matrix4 } from "three";

type RenderedMapVersionMeta = {
	buildnr: number,
	timestamp: string,
	areas: MapRect[],
	version: number,
	errorcount: number,
	running: boolean,
	workerid: string,
	rendertimestamp: string
}

type RenderedMapMeta = {
	versions: {
		version: number,
		date: number,
		build: number,
		source: string
	}[]
}

type Mapconfig = {
	layers: LayerConfig[],
	tileimgsize: number,
	mapsizex: number,
	mapsizez: number,
	area: string
}

type LayerConfig = {
	mode: string,
	name: string,
	pxpersquare: number,
	level: number,
	format?: "png" | "webp",
	usegzip?: boolean,
	subtractlayers?: string[]
} & ({
	mode: "3d",
	dxdy: number,
	dzdy: number,
	walls?: boolean
} | {
	mode: "map",
	wallsonly: boolean
} | {
	mode: "height"
} | {
	mode: "collision"
} | {
	mode: "locs"
} | {
	mode: "rendermeta"
});

async function initMapConfig(endpoint: string, auth: string, uploadmapid: number, version: number, overwrite: boolean) {
	let res = await fetch(`${endpoint}/config.json`, { headers: { "Authorization": auth } });
	if (!res.ok) { throw new Error("map config fetch error"); }
	let config: Mapconfig = await res.json();
	let rendermetaname = config.layers.find(q => q.mode == "rendermeta");

	let workerid = localStorage.map_workerid ?? "" + (Math.random() * 10000 | 0);
	localStorage.map_workerid ??= workerid;

	return new MapRender(endpoint, auth, workerid, uploadmapid, config, version, rendermetaname, overwrite);
}

async function getVersionsFile(source: CacheFileSource, config: MapRender, writeversion = false) {
	//make sure versions file is updated
	let versionsres = await config.getFileResponse("versions.json", 0);
	let mapversionsinfo: RenderedMapMeta;
	if (!versionsres.ok) {
		mapversionsinfo = {
			versions: []
		}
	} else {
		mapversionsinfo = await versionsres.json();
	}
	if (writeversion && !mapversionsinfo.versions.some(q => q.version == config.version)) {
		mapversionsinfo.versions.push({
			version: config.version,
			build: source.getBuildNr(),
			date: +source.getCacheMeta().timestamp,
			source: source.getCacheMeta().name
		});
		mapversionsinfo.versions.sort((a, b) => b.version - a.version);
		//no lock this is technically a race condition when using multiple renderers
		console.log("updating versions file");
		await config.saveFile("versions.json", 0, Buffer.from(JSON.stringify(mapversionsinfo)), 0);
	}
	return mapversionsinfo;
}

async function mapAreaPreset(filesource: CacheFileSource, areaArgument: string) {
	let areas: MapRect[] = [];
	let mask: MapRect[] | undefined = undefined;

	if (areaArgument == "" || areaArgument == "full") {
		areas = [{ x: 0, z: 0, xsize: 100, zsize: 200 }];
	} else if (areaArgument.match(/^\w+$/)) {
		if (areaArgument == "main") {

			//enums 708 seems to be the map select dropdown in-game
			let file = await filesource.getFileById(cacheMajors.enums, 708);
			let mapenum = parse.enums.read(file, filesource);

			let files = await filesource.getArchiveById(cacheMajors.worldmap, 0);
			mask = mapenum.intArrayValue2!.values
				.map(q => parse.mapZones.read(files[q[1]].buffer, filesource))
				// .filter(q => q.show && q.name)
				.flatMap(q => q.bounds)
				.map(q => {
					let x = q.src.xstart;
					let z = q.src.zstart;
					//add +1 since the zones are inclusive of their end coord
					return { x, z, xsize: q.src.xend - x + 1, zsize: q.src.zend - z + 1 } as MapRect
				});

			//hardcoded extra bits
			mask.push({ x: 2176, z: 3456, xsize: 64, zsize: 64 });//prif top ocean doesn't exist on any map
			mask.push({ x: 2432, z: 2624, xsize: 128, zsize: 128 });//use the original ashdale and hope for the best

			//hardcoded areas that aren't on any normal map
			mask.push({ x: 59 * 64, z: 109 * 64, xsize: 128, zsize: 128 });//telos
			mask.push({ x: 47 * 64, z: 93 * 64, xsize: 2 * 64, zsize: 4 * 64 });//vorago
			mask.push({ x: 14 * 64, z: 4 * 64, xsize: 3 * 64, zsize: 4 * 64 });//zuk
			mask.push({ x: 23 * 64, z: 24 * 64, xsize: 4 * 64, zsize: 4 * 64 });//zamorak
			mask.push({ x: 70 * 64, z: 140 * 64, xsize: 5 * 64, zsize: 5 * 64 });//ed1
			mask.push({ x: 76 * 64, z: 140 * 64, xsize: 5 * 64, zsize: 5 * 64 });//ed2
			mask.push({ x: 82 * 64, z: 140 * 64, xsize: 5 * 64, zsize: 5 * 64 });//ed3
			mask.push({ x: 69 * 64, z: 96 * 64, xsize: 6 * 64, zsize: 4 * 64 });//araxxor
			mask.push({ x: 5 * 64, z: 2 * 64, xsize: 1 * 64, zsize: 1 * 64 });//kerapac
			mask.push({ x: 43 * 64, z: 27 * 64, xsize: 3 * 64, zsize: 3 * 64 });//kerapac

			areas = mask.map(q => {
				let x = Math.floor(q.x / 64);
				let z = Math.floor(q.z / 64);
				return { x, z, xsize: Math.ceil((q.x + q.xsize) / 64) - x + 1, zsize: Math.ceil((q.z + q.zsize) / 64) - z + 1 };
			});
		}
		if (areaArgument == "test") {
			areas = [
				{ x: 49, z: 49, xsize: 3, zsize: 3 }
			];
		}
	} else {
		let rect = stringToMapArea(areaArgument);
		if (!rect) {
			throw new Error("map area argument did not match a preset name and did not resolve to a rectangle");
		}
		areas = [rect];
	}
	if (areas.length == 0) {
		throw new Error("no map area or map name");
	}

	return { areas, mask };
}

//The Runeapps map saves directly to the server and keeps a version history, the server side code for this is non-public
//this class is designed so it could also implement a direct fs backing
//The render code decides which (opaque to server) file names should exist and checks if that name+hash already exists,
//if not it will generate the file and save it together with some metadata (hash+build nr)
class MapRender {
	config: Mapconfig;
	layers: LayerConfig[];
	endpoint: string;
	workerid: string;
	uploadmapid: number;
	auth: string;
	version: number;
	overwrite: boolean;
	minzoom: number;
	rendermetaLayer: LayerConfig | undefined;

	private postThrottler = new FetchThrottler(20);
	private fileThrottler = new FetchThrottler(20);

	constructor(endpoint: string, auth: string, workerid: string, uploadmapid: number, config: Mapconfig, version: number, rendermetaLayer: LayerConfig | undefined, overwrite: boolean) {
		this.endpoint = endpoint;
		this.auth = auth;
		this.workerid = workerid;
		this.config = config;
		this.layers = config.layers;
		this.version = version;
		this.overwrite = overwrite;
		this.rendermetaLayer = rendermetaLayer;
		this.uploadmapid = uploadmapid;
		this.minzoom = Math.floor(Math.log2(this.config.tileimgsize / (Math.max(this.config.mapsizex, this.config.mapsizez) * 64)));
	}
	makeFileName(layer: string, zoom: number, x: number, y: number, ext: string) {
		return `${layer}/${zoom}/${x}-${y}.${ext}`;
	}
	getLayerZooms(layercnf: LayerConfig) {
		const min = Math.floor(Math.log2(this.config.tileimgsize / (Math.max(this.config.mapsizex, this.config.mapsizez) * 64)));
		const max = Math.log2(layercnf.pxpersquare);
		const base = Math.log2(this.config.tileimgsize / 64);
		return { min, max, base };
	}
	async saveFile(name: string, hash: number, data: Buffer, version = this.version) {
		let send = await this.postThrottler.apiRequest(`${this.endpoint}/upload?file=${encodeURIComponent(name)}&hash=${hash}&buildnr=${version}&mapid=${this.uploadmapid}`, {
			method: "post",
			headers: { "Authorization": this.auth },
			body: data
		});
		if (!send.ok) { throw new Error("file upload failed"); }
	}
	async symlink(name: string, hash: number, targetname: string, targetversion = this.version) {
		return this.symlinkBatch([{ file: name, hash, buildnr: this.version, symlink: targetname, symlinkbuildnr: targetversion }]);
	}
	async symlinkBatch(files: SymlinkCommand[]) {
		let version = this.version;
		let filtered = files.filter(q => q.file != q.symlink || q.symlinkbuildnr != version);
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

type TileProgress = "queued" | "imaging" | "saving" | "done" | "skipped";
type TileLoadState = "loading" | "loaded" | "unloaded";

class ProgressUI {
	areas: MapRect[];
	tiles = new Map<string, { el: HTMLDivElement, x: number, z: number, progress: TileProgress, loadstate: TileLoadState }>();
	props: Record<string, { el: HTMLDivElement, contentel: HTMLElement, text: string }> = {};
	root: HTMLElement;
	proproot: HTMLElement;
	grid: HTMLElement;

	private updateDebounce = 0;
	private queuedUpdates: { x: number, z: number, state: TileProgress | "", tilestate: TileLoadState | "" }[] = [];

	static renderBackgrounds: Record<TileLoadState, string> = {
		loaded: "lime",
		loading: "red",
		unloaded: "green"
	}
	static backgrounds: Record<TileProgress, string> = {
		queued: "black",
		imaging: "orange",
		saving: "yellow",
		done: "green",
		skipped: "darkgreen"
	};

	constructor() {
		this.areas = [];
		this.grid = document.createElement("div");
		this.grid.style.display = "grid";

		this.proproot = document.createElement("div");

		let root = document.createElement("div");
		root.style.display = "grid";
		root.style.grid = "'a b'/auto 1fr";
		root.appendChild(this.grid);
		root.appendChild(this.proproot);
		this.root = root;
	}
	setAreas(areas: MapRect[]) {
		this.areas = areas;
		this.grid.replaceChildren();

		let minx = Infinity, minz = Infinity;
		let maxx = -Infinity, maxz = -Infinity;
		for (let area of areas) {
			minx = Math.min(minx, area.x); minz = Math.min(minz, area.z);
			maxx = Math.max(maxx, area.x + area.xsize - 1); maxz = Math.max(maxz, area.z + area.zsize - 1);

			for (let dz = 0; dz < area.zsize; dz++) {
				for (let dx = 0; dx < area.xsize; dx++) {
					let id = `${area.x + dx}-${area.z + dz}`;
					if (!this.tiles.has(id)) {
						let el = document.createElement("div");
						this.tiles.set(id, { x: area.x + dx, z: area.z + dz, el, progress: "queued", loadstate: "unloaded" });
					}
				}
			}
		}

		const maxheight = 930;
		const maxwidth = 700;
		let scale = Math.min(maxwidth / (maxx - minx + 1), maxheight / (maxz - minz + 1));
		this.grid.style.width = `${(maxx - minx + 1) * scale}px`;
		this.grid.style.height = `${(maxz - minz + 1) * scale}px`;
		this.grid.style.gridTemplateColumns = `repeat(${maxx - minx + 1},1fr)`;
		this.grid.style.gridTemplateRows = `repeat(${maxz - minz + 1},1fr)`;

		this.proproot.style.left = `${(maxx - minx + 1) * scale}px`;
		for (let tile of this.tiles.values()) {
			tile.el.style.gridColumn = (tile.x - minx + 1) + "";
			tile.el.style.gridRow = (maxz - minz - (tile.z - minz) + 1) + "";
			tile.el.style.background = ProgressUI.backgrounds.queued;
			this.grid.appendChild(tile.el);
		}
	}

	update(x: number, z: number, state: TileProgress | "", tilestate: TileLoadState | "" = "") {
		this.queuedUpdates.push({ x, z, state, tilestate });
		if (!this.updateDebounce) {
			this.updateDebounce = +setTimeout(() => {
				this.queuedUpdates.forEach(q => this.doupdate(q.x, q.z, q.state, q.tilestate));
				this.queuedUpdates = [];
				this.updateDebounce = 0;
			}, 400);
		}
	}

	private doupdate(x: number, z: number, state: TileProgress | "", tilestate: TileLoadState | "" = "") {
		let id = `${x}-${z}`;
		let tile = this.tiles.get(id);
		if (!tile) { return; }
		if (state) {
			tile.progress = state;
		}
		if (tilestate) {
			tile.loadstate = tilestate;
		}
		if (tile.progress == "imaging" || tile.progress == "saving") {
			tile.el.style.background = ProgressUI.backgrounds[tile.progress];
		} else if (tile.loadstate != "unloaded") {
			tile.el.style.background = ProgressUI.renderBackgrounds[tile.loadstate]
		} else {
			tile.el.style.background = ProgressUI.backgrounds[tile.progress];
		}
	}


	updateProp(propname: string, value: string) {
		let prop = this.props[propname];
		if (!value && prop) {
			this.proproot.removeChild(prop.el);
			delete this.props[propname];
			return;
		}
		if (value && !prop) {
			let titleel = document.createElement("b");
			let contentel = document.createElement("span");
			let el = document.createElement("div");
			el.append(titleel, contentel);
			titleel.innerText = propname + ": ";

			prop = { el, contentel, text: "" };
			this.props[propname] = prop;
			this.proproot.appendChild(prop.el);
		}
		prop.text = value;
		prop.contentel.innerText = value;
	}
}

export async function runMapRender(output: ScriptOutput, filesource: CacheFileSource, endpoint: string, auth: string, uploadmapid: number, overwrite = false) {
	let versionid = filesource.getBuildNr();
	if (filesource.getBuildNr() > 900) {
		//use build number for order caches since they wont have version timestamps
		//for newer caches the timestamp is more reliable since it allows us to mix
		//openrs2 and sqlite caches at will without 100% knowing the build number
		//and newer game updates rarely update build nr
		//do a quick search of common cache indices
		let maxtime = 0;
		for (let major of [cacheMajors.mapsquares, cacheMajors.items, cacheMajors.npcs, cacheMajors.objects, cacheMajors.config]) {
			let index = await filesource.getCacheIndex(major);
			for (let entry of index) {
				if (entry && entry.version > maxtime) {
					maxtime = entry.version;
				}
			}
		}
		versionid = maxtime;
	}
	let config = await initMapConfig(endpoint, auth, uploadmapid, versionid, overwrite);

	let prevconfigreq = await config.getFileResponse("meta.json");
	if (prevconfigreq.ok) {
		let prevconfig: RenderedMapVersionMeta = await prevconfigreq.json();
		let prevdate = new Date(prevconfig.rendertimestamp);
		let isownrun = prevconfig.running && prevconfig.workerid == config.workerid;
		if (!isownrun && +prevdate > Date.now() - 1000 * 60 * 60 * 24 * 10) {
			//skip if less than x*24hr ago
			output.log("skipping", config.uploadmapid, config.version);
			return () => { };
		}
	}

	let engine = await EngineCache.create(filesource);

	let progress = new ProgressUI();
	progress.updateProp("source", filesource.getCacheMeta().name + "\n" + filesource.getCacheMeta().descr);
	document.body.appendChild(progress.root);
	let cleanup = () => progress.root.remove();
	output.setUI(progress.root);

	let { areas, mask } = await mapAreaPreset(filesource, config.config.area);

	progress.setAreas(areas);

	progress.updateProp("deps", "starting dependency graph");
	try {
		let deparea: MapRect | undefined = undefined;
		if (areas.length == 1) {
			deparea = { x: areas[0].x - 2, z: areas[0].z - 2, xsize: areas[0].xsize + 2, zsize: areas[0].zsize + 2 };
		}
		var deps = await getDependencies(engine, { area: deparea });
	} catch (e) {
		console.error(e);
		progress.updateProp("deps", "starting dependency graph");
		return cleanup;
	}
	progress.updateProp("deps", `completed, ${deps.dependencyMap.size} nodes`);
	progress.updateProp("version", new Date(deps.maxVersion * 1000).toUTCString());


	let getRenderer = () => {
		let cnv = document.createElement("canvas");
		let renderer = new MapRenderer(cnv, config, engine, deps, { mask });
		renderer.loadcallback = (x, z, state) => progress.update(x, z, "", state);
		return renderer;
	}
	await downloadMap(output, getRenderer, engine, deps, areas, config, progress);
	output.log("done");

	return cleanup;
}

type ChunkRenderMeta = {
	x: number,
	z: number,
	version: number,
	floor: ChunkTileDependencies[],
	locs: ChunkLocDependencies[],
}

type MaprenderSquareData = {
	grid: TileGrid,
	chunkdata: RSMapChunkData,
	rendermeta: ChunkRenderMeta
};

type MaprenderSquare = {
	chunk: RSMapChunk,
	loaded: MaprenderSquareData | null,
	loadprom: CallbackPromise<MaprenderSquareData>,
	x: number,
	z: number,
	id: number
};

type MaprenderSquareLoaded = MaprenderSquare & { loaded: MaprenderSquareData };

export class MapRenderer {
	renderer: ThreeJsRenderer;
	engine: EngineCache;
	config: MapRender;
	scenecache: ThreejsSceneCache | null = null;
	maxunused = 11;
	minunused = 8;
	idcounter = 0;
	squares: MaprenderSquare[] = [];
	deps: DependencyGraph;
	loadcallback: ((x: number, z: number, state: TileLoadState) => void) | null = null;
	opts: ParsemapOpts;
	constructor(cnv: HTMLCanvasElement, config: MapRender, engine: EngineCache, deps: DependencyGraph, opts: ParsemapOpts) {
		this.engine = engine;
		this.opts = opts;
		this.deps = deps;
		this.config = config;
		this.renderer = new ThreeJsRenderer(cnv, { alpha: false });
		this.renderer.addSceneElement({ getSceneElements() { return { options: { opaqueBackground: true, autoFrames: "never", hideFog: true } }; } });
		cnv.addEventListener("webglcontextlost", async () => {
			let isrestored = await new Promise((done, err) => {
				let cleanup = (v: boolean) => {
					cnv.removeEventListener("webglcontextrestored", handler);
					clearTimeout(timer);
					done(v);
				}
				let handler = () => cleanup(true);
				cnv.addEventListener("webglcontextrestored", handler);
				let timer = setTimeout(cleanup, 10 * 1000, false);
			})
			console.log(`context restore detection ${isrestored ? "restored before trigger" : "triggered and focusing window"}`);
			if (!isrestored) {
				// electron.remote.getCurrentWebContents().focus();
			}
		});
	}

	private async getChunk(x: number, z: number) {
		let existing = this.squares.find(q => q.x == x && q.z == z);
		if (existing) {
			return existing;
		} else {
			this.loadcallback?.(x, z, "loading");
			let id = this.idcounter++;
			if (!this.scenecache) {
				console.log("refreshing scenecache");
				this.scenecache = await ThreejsSceneCache.create(this.engine);
			}
			let square: MaprenderSquare = {
				x: x,
				z: z,
				loaded: null,
				loadprom: new CallbackPromise(),
				chunk: new RSMapChunk({ x, z, xsize: 1, zsize: 1 }, this.scenecache, this.opts),
				id
			}
			square.chunk.chunkdata.then(async (chunkdata) => {
				square.loaded = {
					rendermeta: {
						x: chunkdata.rect.x,
						z: chunkdata.rect.z,
						version: this.config.version,
						floor: (chunkdata.chunks.length == 0 ? [] : mapsquareFloorDependencies(chunkdata.grid, this.deps, chunkdata.chunks[0])),
						locs: mapsquareLocDependencies(chunkdata.grid, this.deps, chunkdata.modeldata, square.chunk.rect)
					},
					grid: chunkdata.grid,
					chunkdata: chunkdata
				};
				square.loadprom.done(square.loaded);
				this.loadcallback?.(x, z, "loaded");
			});
			this.squares.push(square);
			return square;
		}
	}

	async setArea(x: number, z: number, xsize: number, zsize: number) {
		let load: MaprenderSquare[] = [];
		//load topright last to increase chance of cache hit later on
		for (let dx = 0; dx < xsize; dx++) {
			for (let dz = 0; dz < zsize; dz++) {
				load.push(await this.getChunk(x + dx, z + dz))
			}
		}
		await Promise.all(load.map(q => q.loadprom));
		load.forEach(q => q.chunk.addToScene(this.renderer));
		let obsolete = this.squares.filter(square => !load.includes(square));
		if (obsolete.length >= this.maxunused) {
			obsolete.sort((a, b) => b.id - a.id);
			let removed = obsolete.slice(this.minunused);
			removed.forEach(r => {
				r.chunk.cleanup();
				this.loadcallback?.(r.x, r.z, "unloaded");
			});
			this.squares = this.squares.filter(sq => !removed.includes(sq));
		}
		return load;
	}
}

export async function downloadMap(output: ScriptOutput, getRenderer: () => MapRenderer, engine: EngineCache, deps: DependencyGraph, rects: MapRect[], config: MapRender, progress: ProgressUI) {
	let errs: Error[] = [];
	const zscan = 4;
	const maxretries = 1;

	let chunks: { x: number, z: number }[] = [];
	for (let rect of rects) {
		for (let z = rect.z; z < rect.z + rect.zsize; z++) {
			for (let x = rect.x; x < rect.x + rect.xsize; x++) {
				chunks.push({ x, z });
			}
		}
	}
	//sort in zigzag pattern in order to do nearby chunks while neighbours are still in mem
	const sortedstride = config.config.mapsizex * zscan;
	chunks.sort((a, b) => {
		let aa = a.x * zscan + Math.floor(a.z / zscan) * sortedstride + a.z % sortedstride;
		let bb = b.x * zscan + Math.floor(b.z / zscan) * sortedstride + b.z % sortedstride;
		return aa - bb;
	});
	//now that it's sorted its cheap to remove dupes
	let prefilterlen = chunks.length;
	chunks = chunks.filter((v, i, arr) => (i == 0 || v.x != arr[i - 1].x || v.z != arr[i - 1].z));
	output.log("filtered out dupes", prefilterlen - chunks.length);

	let configjson: RenderedMapVersionMeta = {
		buildnr: engine.getBuildNr(),
		timestamp: (isNaN(+engine.getCacheMeta().timestamp) ? "" : engine.getCacheMeta().timestamp.toISOString()),
		areas: rects,
		version: config.version,
		errorcount: 0,
		running: true,
		workerid: config.workerid,
		rendertimestamp: new Date().toISOString()
	};

	await config.saveFile("meta.json", 0, Buffer.from(JSON.stringify(configjson, undefined, "\t")));

	let versionsFile = await getVersionsFile(engine, config, true);

	let mipper = new MipScheduler(config, progress);
	let depstracker = new RenderDepsTracker(engine, config, deps, versionsFile);

	let maprender: MapRenderer | null = null;
	let activerender = Promise.resolve();

	let render = function* () {
		let completed = 0;
		for (let chunk of chunks) {
			if (output.state != "running") { break; }

			let task = renderMapsquare(engine, config, depstracker, mipper, progress, chunk.x, chunk.z);
			let lastrender = activerender;
			let fn = (async () => {
				for (let retry = 0; retry <= maxretries; retry++) {
					try {
						let renderprom = lastrender.then(() => maprender ??= getRenderer());
						let res = await task.runTasks(renderprom);
						break;
					} catch (e) {
						console.warn(e.toString());
						errs.push(e.toString());
						maprender = null;
						e = null;//e references the complete stack
						//new stack frame
						await delay(1);
						//force garbage collection if exposed in nodejs/electron flags
						globalThis.gc?.();
					}
				}
			})();
			//chain onto previous to retain order on the renderer
			activerender = activerender.then(() => fn);
			yield fn;
			completed++;
			if (completed % 20 == 0) {
				yield mipper.run();
			}
		}
	}

	await trickleTasks("", 10, render);
	await mipper.run(true);
	configjson.errorcount = errs.length;
	configjson.running = false;
	await config.saveFile("meta.json", 0, Buffer.from(JSON.stringify(configjson, undefined, "\t")));
	output.log(errs);
}

type UniqueMapFile = { name: string, hash: number };

type KnownMapFile = { hash: number, file: string, time: number, buildnr: number, firstbuildnr: number };

type MipCommand = { layer: LayerConfig, zoom: number, x: number, y: number, files: (UniqueMapFile | null)[] };

type SymlinkCommand = { file: string, buildnr: number, hash: number, symlink: string, symlinkbuildnr: number };

class MipScheduler {
	render: MapRender;
	progress: ProgressUI;
	incompletes = new Map<string, MipCommand>();
	constructor(render: MapRender, progress: ProgressUI) {
		this.render = render;
		this.progress = progress;
	}
	addTask(layer: LayerConfig, zoom: number, hash: number, x: number, y: number, srcfile: string) {
		if (zoom - 1 < this.render.minzoom) { return; }
		let newname = this.render.makeFileName(layer.name, zoom - 1, Math.floor(x / 2), Math.floor(y / 2), layer.format ?? "webp");
		let incomp = this.incompletes.get(newname);
		if (!incomp) {
			incomp = {
				layer,
				zoom: zoom - 1,
				x: Math.floor(x / 2),
				y: Math.floor(y / 2),
				files: [null, null, null, null]
			};
			this.incompletes.set(newname, incomp);
		}
		let isright = (x % 2) != 0;
		let isbot = (y % 2) != 0;
		let subindex = (isright ? 1 : 0) + (isbot ? 2 : 0);
		incomp.files[subindex] = { name: srcfile, hash };
	}
	async run(includeIncomplete = false) {
		const maxgroup = 200;
		let completed = 0;
		let skipped = 0;
		let tasks: { name: string, hash: number, run: () => Promise<void>, finally: () => void }[] = [];
		let processTasks = async () => {
			let oldhashes = await this.render.getMetas(tasks);
			let proms: Promise<void>[] = [];
			let symlinks: SymlinkCommand[] = [];
			for (let task of tasks) {
				let old = oldhashes.find(q => q.file == task.name);

				if (task.hash != 0 && old && old.hash == task.hash) {
					symlinks.push({ file: task.name, hash: task.hash, buildnr: this.render.version, symlink: old.file, symlinkbuildnr: old.buildnr });
					skipped++;
				} else {
					proms.push(task.run().catch(e => console.warn("mipping", task.name, "failed", e)));
					completed++;
				}
			}
			proms.push(this.render.symlinkBatch(symlinks));
			await Promise.all(proms);
			for (let task of tasks) {
				task.finally();
			}
			tasks = [];
			this.progress.updateProp("mipqueue", "" + this.incompletes.size);
		}
		do {
			let zoomlevel = -100;
			if (includeIncomplete) {
				for (let args of this.incompletes.values()) {
					if (args.zoom > zoomlevel) {
						zoomlevel = args.zoom;
					}
				}
			}
			for (let [out, args] of this.incompletes.entries()) {
				if (includeIncomplete && args.zoom != zoomlevel) { continue; }
				if (!includeIncomplete && args.files.some(q => !q)) { continue; }

				let crc = 0;
				for (let file of args.files) {
					crc = crc32addInt(file?.hash ?? 0, crc);
				}

				tasks.push({
					name: out,
					hash: crc,
					run: async () => {
						let buf = await mipCanvas(this.render, args.files, args.layer.format ?? "webp", 0.9);
						await this.render.saveFile(out, crc, buf);
					},
					finally: () => {
						this.addTask(args.layer, args.zoom, crc, args.x, args.y, out);
					}
				})
				this.incompletes.delete(out);
				if (tasks.length >= maxgroup) {
					await processTasks();
				}
			}
			await processTasks();
		} while (includeIncomplete && this.incompletes.size != 0)
		console.log("mipped", completed, "skipped", skipped, "left", this.incompletes.size);
		return completed
	}
}

async function mipCanvas(render: MapRender, files: (UniqueMapFile | null)[], format: "png" | "webp", quality: number) {
	let cnv = document.createElement("canvas");
	cnv.width = render.config.tileimgsize;
	cnv.height = render.config.tileimgsize;
	let ctx = cnv.getContext("2d", { willReadFrequently: true })!;
	const subtilesize = render.config.tileimgsize / 2;
	await Promise.all(files.map(async (f, i) => {
		if (!f) { return null; }
		let img: any;//Image|VideoFrame
		let res = await render.getFileResponse(f.name);
		if (!res.ok) {
			throw new Error("image not found");
		}
		let mimetype = res.headers.get("content-type");
		// imagedecoder API doesn't support svg
		if (mimetype != "image/svg+xml" && typeof ImageDecoder != "undefined") {
			let decoder = new ImageDecoder({ data: res.body, type: mimetype, desiredWidth: subtilesize, desiredHeight: subtilesize });
			img = (await decoder.decode()).image;
		} else {
			let blobsrc = URL.createObjectURL(await res.blob());
			img = new Image(subtilesize, subtilesize);
			img.src = blobsrc;
			await img.decode();
			URL.revokeObjectURL(blobsrc);
		}
		ctx.drawImage(img, (i % 2) * subtilesize, Math.floor(i / 2) * subtilesize, subtilesize, subtilesize);
	}));
	return canvasToImageFile(cnv, format, quality);
}

export function renderMapsquare(engine: EngineCache, config: MapRender, depstracker: RenderDepsTracker, mipper: MipScheduler, progress: ProgressUI, chunkx: number, chunkz: number) {
	let setfloors = (chunks: MaprenderSquare[], floornr: number) => {
		let toggles: Record<string, boolean> = {};
		for (let i = 0; i < 4; i++) {
			toggles["floor" + i] = i <= floornr;
			toggles["objects" + i] = i <= floornr;
			toggles["map" + i] = false;
			toggles["mapscenes" + i] = false;
			toggles["walls" + i] = false;
			toggles["floorhidden" + i] = false;
			toggles["collision" + i] = false;
			toggles["collision-raw" + i] = false;
		}
		for (let chunk of chunks) {
			chunk.chunk.setToggles(toggles);
		}
	}

	let baseoutputx = chunkx;
	let baseoutputy = config.config.mapsizez - 1 - chunkz;

	progress.update(chunkx, chunkz, "imaging");

	let subhashes: { x: number, z: number, hash: number }[] = [];
	let getsubhash = (x: number, z: number) => {
		let h = subhashes.find(q => q.x == x && q.z == z);
		if (!h) {
			let hash = depstracker.deps.hashDependencies(depstracker.deps.makeDeptName("mapsquare", x + z * worldStride));
			subhashes.push({ x, z, hash });
			return hash;
		} else {
			return h.hash;
		}
	}
	let recthash = (rect: MapRect) => {
		let hash = 0;
		for (let z = rect.z; z < rect.z + rect.zsize; z++) {
			for (let x = rect.x; x < rect.x + rect.xsize; x++) {
				hash = crc32addInt(getsubhash(x, z), hash);
			}
		}
		return hash;
	}
	let rectexists = (rect: MapRect) => {
		let exists = false;
		for (let z = rect.z; z < rect.z + rect.zsize; z++) {
			for (let x = rect.x; x < rect.x + rect.xsize; x++) {
				exists ||= depstracker.deps.hasEntry(depstracker.deps.makeDeptName("mapsquare", x + z * worldStride));
			}
		}
		return exists;
	}

	let chunktasks: {
		layer: LayerConfig,
		name: string,
		hash: number,
		datarect: MapRect,
		dedupeDependencies?: string[],
		mippable?: null | { zoom: number, outputx: number, outputy: number, hash: number },
		//first callback depends on state and should be series, 2nd is deferred and can be parallel
		run: (chunks: MaprenderSquareLoaded[], renderer: MapRenderer, parentinfo: RenderDepsVersionInstance) => Promise<{ file?: () => Promise<Buffer>, symlink?: undefined | KnownMapFile }>,
	}[] = [];
	let miptasks: (() => void)[] = [];
	for (let cnf of config.layers) {
		let squares = 1;//cnf.mapsquares ?? 1;//TODO remove or reimplement
		if (chunkx % squares != 0 || chunkz % squares != 0) { continue; }
		const chunksize = (engine.classicData ? classicChunkSize : rs2ChunkSize);
		const offset = Math.round(chunksize / 4);
		let area: MapRect = {
			x: chunkx * chunksize - offset,
			z: chunkz * chunksize - offset,
			xsize: chunksize * squares,
			zsize: chunksize * squares
		};
		let zooms = config.getLayerZooms(cnf);

		let overflowrect: MapRect = { x: chunkx - 1, z: chunkz - 1, xsize: squares + 1, zsize: squares + 1 };
		let singlerect: MapRect = { x: chunkx, z: chunkz, xsize: 1, zsize: 1 };

		if (cnf.mode == "3d") {
			let thiscnf = cnf;
			for (let zoom = zooms.base; zoom <= zooms.max; zoom++) {
				let subslices = 1 << (zoom - zooms.base);
				let pxpersquare = thiscnf.pxpersquare >> (zooms.max - zoom);
				let tiles = area.xsize / subslices;
				for (let subx = 0; subx < subslices; subx++) {
					for (let subz = 0; subz < subslices; subz++) {
						let suby = subslices - 1 - subz;
						let filename = config.makeFileName(thiscnf.name, zoom, baseoutputx * subslices + subx, baseoutputy * subslices + suby, cnf.format ?? "webp");

						let parentCandidates: { name: string, level: number }[] = [
							{ name: filename, level: thiscnf.level }
						];
						for (let sub of thiscnf.subtractlayers ?? []) {
							let other = config.layers.find(q => q.name == sub);
							if (!other) {
								console.warn("subtrack layer " + sub + "missing");
								continue;
							}
							parentCandidates.push({
								name: config.makeFileName(other.name, zoom, baseoutputx * subslices + subx, baseoutputy * subslices + suby, cnf.format ?? "webp"),
								level: other.level
							});
						}

						let depcrc = recthash(overflowrect);
						chunktasks.push({
							layer: thiscnf,
							name: filename,
							hash: depcrc,
							datarect: overflowrect,
							dedupeDependencies: parentCandidates.map(q => q.name),
							mippable: (zoom == zooms.base ? { outputx: baseoutputx, outputy: baseoutputy, zoom: zoom, hash: depcrc } : null),
							async run(chunks, renderer, parentinfo) {
								setfloors(chunks, thiscnf.level);
								let cam = mapImageCamera(area.x + tiles * subx, area.z + tiles * subz, tiles, thiscnf.dxdy, thiscnf.dzdy);

								let parentFile: undefined | KnownMapFile = undefined;

								findparent: for (let parentoption of parentCandidates) {
									optloop: for (let versionMatch of await parentinfo.findMatches(this.datarect, parentoption.name)) {
										let diff = new ImageDiffGrid();
										let isdirty = false;
										for (let chunk of chunks) {
											let other = versionMatch.metas.find(q => q.x == chunk.x && q.z == chunk.z);
											if (!other) { throw new Error("unexpected"); }

											let modelmatrix = new Matrix4().makeTranslation(
												chunk.chunk.rect.x * tiledimensions * chunk.chunk.loaded!.chunkSize,
												0,
												chunk.chunk.rect.z * tiledimensions * chunk.chunk.loaded!.chunkSize,
											).premultiply(chunk.chunk.rootnode.matrixWorld);

											let proj = cam.projectionMatrix.clone()
												.multiply(cam.matrixWorldInverse)
												.multiply(modelmatrix);

											let locs = compareLocDependencies(chunk.loaded.rendermeta.locs, other.locs, thiscnf.level, parentoption.level);
											let floor = compareFloorDependencies(chunk.loaded.rendermeta.floor, other.floor, thiscnf.level, parentoption.level);

											// if (locs.length + floor.length > 400) {
											// 	continue optloop;
											// }
											isdirty ||= diff.anyInside(proj, locs);
											isdirty ||= diff.anyInside(proj, floor);
											if (isdirty) {
												break;
											}
										}

										// let area = diff.coverage();
										if (!isdirty) {
											parentFile = versionMatch.file;
											break findparent;
										}
										// if (area < 0.2) {
										// 	if (area > 0) {
										// 		let { rects } = diff.calculateDiffArea(img.width, img.height);
										// 		maskImage(img, rects);
										// 	}
										// 	break;
										// }
									}
								}

								let img: ImageData | null = null;
								if (!parentFile) {
									img = await renderer.renderer.takeMapPicture(cam, tiles * pxpersquare, tiles * pxpersquare);
									flipImage(img);
									// isImageEmpty(img, "black");

									//keep reference to dedupe similar renders
									chunks.forEach(chunk => parentinfo.addLocalSquare(chunk.loaded.rendermeta));
									parentinfo.addLocalFile({
										file: this.name,
										buildnr: config.version,
										firstbuildnr: config.version,
										hash: depcrc,
										time: Date.now()
									});
								}

								return {
									file: (() => pixelsToImageFile(img!, thiscnf.format ?? "webp", 0.9)),
									symlink: parentFile
								};
							}
						});
					}
				}
			}
		}
		if (cnf.mode == "map") {
			let thiscnf = cnf;
			let filename = config.makeFileName(thiscnf.name, zooms.base, baseoutputx, baseoutputy, "svg");
			let depcrc = recthash(overflowrect);
			chunktasks.push({
				layer: thiscnf,
				name: filename,
				hash: depcrc,
				datarect: overflowrect,
				mippable: { outputx: baseoutputx, outputy: baseoutputy, zoom: zooms.base, hash: depcrc },
				async run(chunks) {
					//TODO try enable 2d map render without loading all the 3d stuff
					let grid = new CombinedTileGrid(chunks.map(ch => ({
						src: ch.loaded.grid,
						rect: {
							x: ch.chunk.rect.x * ch.loaded.chunkdata.chunkSize,
							z: ch.chunk.rect.z * ch.loaded.chunkdata.chunkSize,
							xsize: ch.chunk.rect.xsize * ch.loaded.chunkdata.chunkSize,
							zsize: ch.chunk.rect.zsize * ch.loaded.chunkdata.chunkSize,
						}
					})));
					let locs = chunks.flatMap(ch => ch.chunk.loaded!.chunks.flatMap(q => q.locs));
					let svg = await svgfloor(engine, grid, locs, area, thiscnf.level, thiscnf.pxpersquare, thiscnf.wallsonly);
					return {
						file: () => Promise.resolve(Buffer.from(svg, "utf8"))
					};
				}
			});
		}
		if (cnf.mode == "collision") {
			let thiscnf = cnf;
			let filename = config.makeFileName(thiscnf.name, zooms.base, baseoutputx, baseoutputy, cnf.format ?? "webp");

			let depcrc = recthash(overflowrect);
			chunktasks.push({
				layer: thiscnf,
				name: filename,
				hash: depcrc,
				datarect: overflowrect,
				mippable: { outputx: baseoutputx, outputy: baseoutputy, zoom: zooms.base, hash: depcrc },
				async run(chunks) {
					//TODO try enable 2d map render without loading all the 3d stuff
					let grids = chunks.map(q => q.loaded.grid);
					let file = drawCollision(grids, area, thiscnf.level, thiscnf.pxpersquare, 1);
					return { file: () => file };
				}
			});
		}
		if (cnf.mode == "height") {
			let thiscnf = cnf;
			let filename = `${thiscnf.name}/${chunkx}-${chunkz}.${cnf.usegzip ? "bin.gz" : "bin"}`;
			chunktasks.push({
				layer: thiscnf,
				name: filename,
				hash: recthash(singlerect),
				datarect: singlerect,
				async run(chunks) {
					//TODO what to do with classic 48x48 chunks?
					let file = chunks[0].loaded.grid.getHeightCollisionFile(chunkx * 64, chunkz * 64, thiscnf.level, 64, 64);
					let buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
					if (thiscnf.usegzip) {
						buf = zlib.gzipSync(buf);
					}
					return { file: () => Promise.resolve(buf) };
				}
			});
		}
		if (cnf.mode == "locs") {
			let thiscnf = cnf;
			let filename = `${thiscnf.name}/${chunkx}-${chunkz}.${cnf.usegzip ? "json.gz" : "json"}`;
			chunktasks.push({
				layer: thiscnf,
				name: filename,
				hash: recthash(singlerect),
				datarect: singlerect,
				async run(chunks) {
					let { grid, modeldata, chunkSize } = chunks[0].loaded.chunkdata;
					let res = chunkSummary(grid, modeldata, { x: chunkx * chunkSize, z: chunkz * chunkSize, xsize: chunkSize, zsize: chunkSize });
					let textual = prettyJson(res, { indent: "\t" });
					let buf = Buffer.from(textual, "utf8");
					if (thiscnf.usegzip) {
						buf = zlib.gzipSync(buf);
					}
					return { file: () => Promise.resolve(buf) };
				}
			});
		}
		if (cnf.mode == "rendermeta") {
			let thiscnf = cnf;
			let filename = `${thiscnf.name}/${chunkx}-${chunkz}.${cnf.usegzip ? "json.gz" : "json"}`;
			chunktasks.push({
				layer: thiscnf,
				name: filename,
				hash: recthash(singlerect),
				datarect: singlerect,
				async run(chunks) {
					let obj = chunks[0].loaded.rendermeta;
					let file = Buffer.from(JSON.stringify(obj), "utf8");
					if (thiscnf.usegzip) {
						file = zlib.gzipSync(file);
					}
					return { file: () => Promise.resolve(file) };
				}
			});
		}
	}

	let runTasks = async (renderpromise: Promise<MapRenderer>) => {
		let savetasks: Promise<any>[] = [];
		let symlinkcommands: SymlinkCommand[] = [];

		let nonemptytasks = chunktasks.filter(q => rectexists(q.datarect));

		let metas = await config.getMetas(nonemptytasks.filter(q => q.hash != 0));

		let allparentcandidates: string[] = []
		for (let task of nonemptytasks) {
			let existingfile = metas.find(q => q.file == task.name && q.hash == task.hash);
			if (!existingfile) {
				allparentcandidates.push(...task.dedupeDependencies ?? []);
			}
		}
		let parentinfo = await depstracker.forkDeps(allparentcandidates);

		let renderer: MapRenderer | null = null;
		for (let task of nonemptytasks) {
			let existingfile = metas.find(q => q.file == task.name && q.hash == task.hash);
			if (!existingfile) {
				if (!renderer) {
					renderer = await renderpromise;
				}
				let chunks = await renderer.setArea(task.datarect.x, task.datarect.z, task.datarect.xsize, task.datarect.zsize);
				await Promise.all(chunks.map(q => q.loadprom));
				// console.log("running", task.file, "old", meta?.hash, "new", task.hash);
				if (!chunks.some(q => q.loaded!.chunkdata.chunks.length != 0)) {
					//no actual chunks loaded, skip
					//TODO find some way to skip before loading parent candidates
					continue;
				}
				let data = await task.run(chunks as MaprenderSquareLoaded[], renderer, parentinfo);
				if (data.symlink) {
					existingfile = data.symlink;
				} else if (data.file) {
					savetasks.push(data.file().then(buf => config.saveFile(task.name, task.hash, buf)));
				}
			}
			if (existingfile) {
				symlinkcommands.push({ file: task.name, hash: task.hash, buildnr: config.version, symlink: existingfile.file, symlinkbuildnr: existingfile.buildnr });
			}
			if (task.mippable) {
				miptasks.push(() => {
					let mip = task.mippable!;
					mipper.addTask(task.layer, mip.zoom, mip.hash, mip.outputx, mip.outputy, task.name);
				});
			}
		}

		progress.update(chunkx, chunkz, "done");

		await Promise.all(savetasks);
		await config.symlinkBatch(symlinkcommands);
		miptasks.forEach(q => q());
		progress.update(chunkx, chunkz, (savetasks.length == 0 ? "skipped" : "done"));
		let localsymlinkcount = symlinkcommands.filter(q => q.symlinkbuildnr == config.version && q.file != q.symlink).length;
		console.log("imaged", chunkx, chunkz, "files", savetasks.length, "symlinks", localsymlinkcount, "(unchanged)", symlinkcommands.length - localsymlinkcount);
	}

	//TODO returning a promise just gets flattened with our currnet async execution
	return { runTasks };
}

function mapImageCamera(x: number, z: number, ntiles: number, dxdy: number, dzdy: number) {
	let scale = 2 / ntiles;
	let cam = new Camera();
	cam.projectionMatrix.elements = [
		scale, scale * dxdy, 0, -x * scale - 1,
		0, scale * dzdy, -scale, -z * scale - 1,
		0, -0.001, 0, 0,
		0, 0, 0, 1
	];
	cam.projectionMatrix.transpose();
	cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
	return cam;
}

type RenderDepsEntry = {
	x: number,
	z: number,
	metas: Promise<{ buildnr: number, firstbuildnr: number, meta: ChunkRenderMeta }[]>
}

type RenderDepsVersionInstance = Awaited<ReturnType<RenderDepsTracker["forkDeps"]>>;

class RenderDepsTracker {
	config: MapRender;
	deps: DependencyGraph;
	targetversions: number[];

	cachedMetas: RenderDepsEntry[] = [];
	readonly cacheSize = 15;

	constructor(source: CacheFileSource, config: MapRender, deps: DependencyGraph, rendermeta: RenderedMapMeta) {
		this.config = config;
		this.deps = deps;
		let versiontime = +source.getCacheMeta().timestamp;
		this.targetversions = rendermeta.versions
			.slice()
			.sort((a, b) => Math.abs(a.date - versiontime) - Math.abs(b.date - versiontime))
			.slice(0, 10)
			.map(q => q.version)
	}

	getEntry(x: number, z: number) {
		let match = this.cachedMetas.find(q => q.x == x && q.z == z);
		if (!match) {
			let metas = (async () => {
				let filename = `${this.config.rendermetaLayer!.name}/${x}-${z}.${this.config.rendermetaLayer!.usegzip ? "json.gz" : "json"}`;
				let urls = await this.config.getRelatedFiles([filename], this.targetversions);
				urls = urls.filter(q => q.buildnr != this.config.version);
				let fetches = urls.map(q => this.config.getFileResponse(q.file, q.buildnr).then(async w => ({
					buildnr: q.buildnr,
					firstbuildnr: q.firstbuildnr,
					meta: await w.json() as ChunkRenderMeta
				})));
				return Promise.all(fetches)
			})();

			match = { x, z, metas };
			this.cachedMetas.push(match);

			//remove first item if cache is full
			while (this.cachedMetas.length > this.cacheSize) {
				this.cachedMetas.shift();
			}
		}
		return match;
	}

	getRect(rect: MapRect) {
		let entries: RenderDepsEntry[] = [];
		for (let z = rect.z; z < rect.z + rect.zsize; z++) {
			for (let x = rect.x; x < rect.x + rect.xsize; x++) {
				entries.push(this.getEntry(x, z));
			}
		}
		return entries;
	}

	async forkDeps(names: string[]) {
		let allFiles = await this.config.getRelatedFiles(names, this.targetversions);
		let localmetas: ChunkRenderMeta[] = [];
		let localfiles: KnownMapFile[] = [];

		let addLocalFile = (file: KnownMapFile) => {
			// allFiles.push(file);
			localfiles.push(file);
		}

		let addLocalSquare = (rendermeta: ChunkRenderMeta) => {
			if (!localmetas.some(q => q.x == rendermeta.x && q.z == rendermeta.z)) {
				localmetas.push(rendermeta);
			}
		}

		let findMatches = async (chunkRect: MapRect, name: string) => {
			let matches: { file: KnownMapFile, metas: ChunkRenderMeta[] }[] = [];

			//try find match in current render
			let localfile = localfiles.find(q => q.file == name);
			if (localfile) {
				let haslocalchunks = true;
				let localchunks: ChunkRenderMeta[] = []
				for (let z = chunkRect.z; z < chunkRect.z + chunkRect.zsize; z++) {
					for (let x = chunkRect.x; x < chunkRect.x + chunkRect.xsize; x++) {
						let meta = localmetas.find(q => q.x == x && q.z == z);
						if (!meta) {
							haslocalchunks = false;
						} else {
							localchunks.push(meta);
						}
					}
				}
				if (haslocalchunks && localfiles.some(q => q.file == name)) {
					matches.push({ file: localfile, metas: localchunks });
				}
			}

			//search nearby build renders
			let chunks = this.getRect(chunkRect);
			let chunkmetas = await Promise.all(chunks.map(ch => ch.metas));
			let namedversions = allFiles.filter(q => q.file == name);
			matchloop: for (let file of namedversions) {
				let metas: ChunkRenderMeta[] = [];
				for (let chunk of chunkmetas) {
					let meta = chunk.find(q => q.buildnr >= file.firstbuildnr && q.firstbuildnr <= file.buildnr);
					if (!meta) {
						continue matchloop;
					} else {
						metas.push(meta.meta);
					}
				}
				matches.push({ file, metas });
			}
			return matches;
		}

		return {
			allFiles,
			findMatches,
			addLocalFile,
			addLocalSquare
		};
	}
}
