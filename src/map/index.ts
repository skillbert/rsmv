
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
import { CallbackPromise, delay, stringToMapArea } from "../utils";
import { drawCollision } from "./collisionimage";
import prettyJson from "json-stringify-pretty-compact";
import { ChunkLocDependencies, chunkSummary, ChunkTileDependencies, compareFloorDependencies, compareLocDependencies, ImageDiffGrid, mapsquareFloorDependencies, mapsquareLocDependencies } from "./chunksummary";
import { RSMapChunk, RSMapChunkData } from "../3d/modelnodes";
import * as zlib from "zlib";

type RenderedMapMeta = {
	buildnr: number,
	timestamp: string,
	areas: MapRect[],
	version: number,
	errorcount: number,
	running: boolean,
	workerid: string,
	rendertimestamp: string
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
	addmipmaps: boolean,
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

	let versions: number[] = await fetch(`${endpoint}/mapversions?mapid=${uploadmapid}`, {
		headers: { "Authorization": auth }
	}).then(r => r.json());

	return new MapRender(endpoint, auth, workerid, uploadmapid, config, version, versions, rendermetaname, overwrite);
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
	existingVersions: number[];
	constructor(endpoint: string, auth: string, workerid: string, uploadmapid: number, config: Mapconfig, version: number, existingversions: number[], rendermetaLayer: LayerConfig | undefined, overwrite: boolean) {
		this.endpoint = endpoint;
		this.auth = auth;
		this.workerid = workerid;
		this.config = config;
		this.layers = config.layers;
		this.version = version;
		this.existingVersions = existingversions;
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
	async saveFile(name: string, hash: number, data: Buffer) {
		let send = await fetch(`${this.endpoint}/upload?file=${encodeURIComponent(name)}&hash=${hash}&buildnr=${this.version}&mapid=${this.uploadmapid}`, {
			method: "post",
			headers: { "Authorization": this.auth },
			body: data
		});
		if (!send.ok) { throw new Error("file upload failed"); }
	}
	async symlink(name: string, hash: number, targetname: string, targetversion = this.version) {
		let send = await fetch(`${this.endpoint}/upload?file=${encodeURIComponent(name)}&hash=${hash}&buildnr=${this.version}&mapid=${this.uploadmapid}&symlink=${targetname}&symlinkbuildnr=${targetversion}`, {
			method: "post",
			headers: { "Authorization": this.auth },
		});
		if (!send.ok) { throw new Error("file symlink failed"); }
	}
	async getMetas(names: UniqueMapFile[]) {
		if (this.overwrite) {
			return [];
		} else {
			let req = await fetch(`${this.endpoint}/getmetas?file=${encodeURIComponent(names.map(q => `${q.name}!${q.hash}`).join(","))}&mapid=${this.uploadmapid}`, {
				headers: { "Authorization": this.auth },
			});
			if (!req.ok) { throw new Error("req failed"); }
			return await req.json() as KnownMapFile[]
		}
	}
	async getRelatedFiles(names: string[], versions: number[]) {
		let req = await fetch(`${this.endpoint}/getfileversions?file=${encodeURIComponent(names.join(","))}&versions=${versions.join(",")}&mapid=${this.uploadmapid}`, {
			headers: { "Authorization": this.auth }
		});
		if (!req.ok) { throw new Error("req faield"); }
		let files = await req.json() as KnownMapFile[];
		return files;
	}
	getFileUrl(name: string, hash: number) {
		return `${this.endpoint}/getfile?file=${encodeURIComponent(name)}&hash=${hash}&mapid=${this.uploadmapid}`;
	}
	getNamedFileUrl(name: string, version = this.version) {
		return `${this.endpoint}/getnamed?file=${encodeURIComponent(name)}&version=${version}&mapid=${this.uploadmapid}`;
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

		const longsize = 700;
		let scale = longsize / Math.max(maxx - minx + 1, maxz - minz + 1);
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

	let prevconfigreq = await fetch(config.getNamedFileUrl("meta.json"));
	if (prevconfigreq.ok) {
		let prevconfig: RenderedMapMeta = await prevconfigreq.json();
		let prevdate = new Date(prevconfig.rendertimestamp);
		let isownrun = prevconfig.running && prevconfig.workerid == config.workerid;
		if (!isownrun && +prevdate > Date.now() - 1000 * 60 * 60 * 24 * 10) {
			//skip is less than 24hr ago
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

	let areaArgument = config.config.area;
	let areas: MapRect[] = [];
	let mask: MapRect[] | undefined = undefined;

	if (areaArgument == "") {
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
			if (uploadmapid == 19) {//TODO revert
				areas = [
					{ x: 45, z: 45, xsize: 11, zsize: 11 }
				];
			} else {
				areas = [
					{ x: 49, z: 49, xsize: 3, zsize: 3 }
				];
			}
		}
		if (areaArgument == "gwd3") {
			areas = [
				{ x: 31, z: 20, xsize: 1, zsize: 1 }
			];
			mask = [
				{ x: 1984, z: 1280, xsize: 64, zsize: 64 }
			]
		}
		if (areaArgument == "tower") {
			areas = [
				{ x: 49, z: 51, xsize: 1, zsize: 1 }
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
	maxunused = 10;
	minunused = 5;
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
		//TODO revert to using local renderer
		this.renderer = new ThreeJsRenderer(cnv, { alpha: false });
		this.renderer.addSceneElement({ getSceneElements() { return { options: { opaqueBackground: true, autoFrames: false, hideFog: true } }; } });
		cnv.addEventListener("webglcontextlost", async () => {
			let isrestored = await Promise.race([
				new Promise(d => setTimeout(() => d(false), 10 * 1000)),
				new Promise(d => cnv.addEventListener("webglcontextrestored", () => d(true), { once: true }))
			]);
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
						x: chunkdata.chunks[0].mapsquarex,
						z: chunkdata.chunks[0].mapsquarez,
						version: this.config.version,
						floor: mapsquareFloorDependencies(chunkdata.grid, this.deps, chunkdata.chunks[0]),
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
	let maprender: MapRenderer | null = null;

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

	let configjson: RenderedMapMeta = {
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

	let mipper = new MipScheduler(config, progress);
	let depstracker = new RenderDepsTracker(config, deps);

	let completed = 0;
	for (let chunk of chunks) {
		if (output.state != "running") { break; }
		for (let retry = 0; retry <= maxretries; retry++) {
			try {
				maprender ??= getRenderer();
				await renderMapsquare(engine, config, maprender, depstracker, mipper, progress, chunk.x, chunk.z);
				completed++;

				if (completed % 20 == 0) {
					await mipper.run();
				}
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
	}
	await mipper.run(true);
	configjson.errorcount = errs.length;
	configjson.running = false;
	await config.saveFile("meta.json", 0, Buffer.from(JSON.stringify(configjson, undefined, "\t")));
	output.log(errs);
}

type UniqueMapFile = { name: string, hash: number };

type KnownMapFile = { hash: number, file: string, time: number, buildnr: number };

type MipCommand = { layer: LayerConfig, zoom: number, x: number, y: number, files: (UniqueMapFile | null)[] };

class MipScheduler {
	render: MapRender;
	progress: ProgressUI;
	incompletes = new Map<string, MipCommand>();
	constructor(render: MapRender, progress: ProgressUI) {
		this.render = render;
		this.progress = progress;
	}
	addTask(layer: LayerConfig, zoom: number, hash: number, x: number, y: number, ext: string) {
		if (zoom - 1 < this.render.minzoom) { return; }
		let srcfile = this.render.makeFileName(layer.name, zoom, x, y, ext);
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
		let isright = (x % 2) == 1;
		let isbot = (y % 2) == 1;
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
			for (let task of tasks) {
				let old = oldhashes.find(q => q.file == task.name);

				if (task.hash != 0 && old && old.hash == task.hash) {
					proms.push(this.render.symlink(task.name, task.hash, old.file, old.buildnr));
					skipped++;
				} else {
					proms.push(task.run().catch(e => console.warn("mipping", task.name, "failed", e)));
					completed++;
				}
				task.finally();
			}
			await Promise.all(proms);
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
						this.addTask(args.layer, args.zoom, crc, args.x, args.y, args.layer.format ?? "webp");
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
		let src = render.getFileUrl(f.name, f.hash);

		let usefetch = true;

		//use fetch here since we can't prevent cache on redirected images otherwise
		let img: any;//Image|VideoFrame
		if (usefetch) {
			let res = await fetch(src, { cache: "reload" });
			if (!res.ok) { throw new Error("image no found"); }
			let mimetype = res.headers.get("content-type");
			// imagedecoder API doesn't support svg
			if (mimetype != "image/svg+xml" && typeof ImageDecoder != "undefined") {
				let decoder = new ImageDecoder({ data: res.body, type: mimetype, desiredWidth: subtilesize, desiredHeight: subtilesize });
				img = await decoder.decode();
			} else {
				let blobsrc = URL.createObjectURL(await res.blob());
				img = new Image(subtilesize, subtilesize);
				img.src = blobsrc;
				await img.decode();
				URL.revokeObjectURL(blobsrc);
			}
		} else {
			img = new Image(subtilesize, subtilesize);
			img.crossOrigin = "";
			img.src = src;
			await img.decode();
		}
		ctx.drawImage(img, (i % 2) * subtilesize, Math.floor(i / 2) * subtilesize, subtilesize, subtilesize);
	}));
	return canvasToImageFile(cnv, format, quality);
}

export async function renderMapsquare(engine: EngineCache, config: MapRender, renderer: MapRenderer, depstracker: RenderDepsTracker, mipper: MipScheduler, progress: ProgressUI, x: number, z: number) {
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

	let y = config.config.mapsizez - 1 - z;

	let baseimgs: Record<string, ImageData> = {};
	progress.update(x, z, "imaging");
	let rootdeps = [
		depstracker.deps.makeDeptName("mapsquare", (x - 1) + (z - 1) * worldStride),
		depstracker.deps.makeDeptName("mapsquare", (x) + (z - 1) * worldStride),
		depstracker.deps.makeDeptName("mapsquare", (x - 1) + (z) * worldStride),
		depstracker.deps.makeDeptName("mapsquare", (x) + (z) * worldStride)
	];
	let depcrc = rootdeps.reduce((a, v) => depstracker.deps.hashDependencies(v, a), 0);
	// let depfiles = rootdeps.reduce((a, v) => deps.cascadeDependencies(v, a), []);

	let chunktasks: {
		layer: LayerConfig,
		name: string,
		hash: number,
		datarect: MapRect,
		dedupeDependencies?: string[],
		//first callback depends on state and should be series, 2nd is deferred and can be parallel
		run: (chunks: MaprenderSquareLoaded[]) => Promise<{ file?: () => Promise<Buffer>, symlink?: null | { name: string, version: number } }>
	}[] = [];
	let miptasks: (() => void)[] = [];
	for (let cnf of config.layers) {
		let squares = 1;//cnf.mapsquares ?? 1;//TODO remove or reimplement
		if (x % squares != 0 || z % squares != 0) { continue; }
		const chunksize = (engine.classicData ? classicChunkSize : rs2ChunkSize);
		const offset = Math.round(chunksize / 4);
		let area: MapRect = {
			x: x * chunksize - offset,
			z: z * chunksize - offset,
			xsize: chunksize * squares,
			zsize: chunksize * squares
		};
		let zooms = config.getLayerZooms(cnf);

		if (cnf.addmipmaps) {
			miptasks.push(() => mipper.addTask(cnf, zooms.base, depcrc, x, config.config.mapsizez - 1 - z, (cnf.mode == "map" ? "svg" : cnf.format ?? "webp")));
		}
		if (cnf.mode == "3d") {
			let thiscnf = cnf;
			for (let zoom = zooms.base; zoom <= zooms.max; zoom++) {
				let subslices = 1 << (zoom - zooms.base);
				let pxpersquare = thiscnf.pxpersquare >> (zooms.max - zoom);
				let tiles = area.xsize / subslices;
				for (let subx = 0; subx < subslices; subx++) {
					for (let subz = 0; subz < subslices; subz++) {
						let suby = subslices - 1 - subz;
						let filename = config.makeFileName(thiscnf.name, zoom, x * subslices + subx, y * subslices + suby, cnf.format ?? "webp");


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
								name: config.makeFileName(other.name, zoom, x * subslices + subx, y * subslices + suby, cnf.format ?? "webp"),
								level: other.level
							});
						}

						chunktasks.push({
							layer: thiscnf,
							name: filename,
							hash: depcrc,
							datarect: { x: x - 1, z: z - 1, xsize: squares + 1, zsize: squares + 1 },
							dedupeDependencies: parentCandidates.map(q => q.name),
							async run(chunks) {
								setfloors(chunks, thiscnf.level);
								let { img, cam } = await renderer!.renderer.takeMapPicture(area.x + tiles * subx, area.z + tiles * subz, tiles, pxpersquare, thiscnf.dxdy, thiscnf.dzdy);

								let parentFile: null | { name: string, version: number } = null;

								findparent: for (let parentoption of parentCandidates) {
									for (let versionMatch of await forked.findMatches(this.datarect, parentoption.name)) {
										let diff = new ImageDiffGrid();
										for (let chunk of chunks) {
											let other = versionMatch.metas.find(q => q.x == chunk.x && q.z == chunk.z);
											if (!other) { throw new Error("unexpected"); }

											//TODO store this at a proper spot instead of reaching deep inside
											let modelmatrix = chunk.chunk.loaded!.chunkmodels[0].matrixWorld;
											let proj = cam.projectionMatrix.clone()
												.multiply(cam.matrixWorldInverse)
												.multiply(modelmatrix);

											let locs = compareLocDependencies(chunk.loaded.rendermeta.locs, other.locs, thiscnf.level, parentoption.level);
											let floor = compareLocDependencies(chunk.loaded.rendermeta.locs, other.locs, thiscnf.level, parentoption.level);

											diff.addPolygons(proj, locs);
											diff.addPolygons(proj, floor);
										}

										let area = diff.coverage();
										if (area == 0) {
											parentFile = {
												name: parentoption.name,
												version: versionMatch.file.buildnr
											};
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

								flipImage(img);
								// isImageEmpty(img, "black");

								//keep reference to dedupe similar renders
								if (!parentFile) {
									baseimgs[filename] = img;
									chunks.forEach(chunk => forked.addLocalSquare(chunk.loaded.rendermeta));
									forked.addLocalFile({
										file: this.name,
										buildnr: config.version,
										hash: depcrc,
										time: Date.now()
									});
								}

								return {
									file: () => pixelsToImageFile(img, thiscnf.format ?? "webp", 0.9),
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
			let filename = config.makeFileName(thiscnf.name, zooms.base, x, y, "svg");
			chunktasks.push({
				layer: thiscnf,
				name: filename,
				hash: depcrc,
				datarect: { x: x - 1, z: z - 1, xsize: squares + 1, zsize: squares + 1 },
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
			let filename = config.makeFileName(thiscnf.name, zooms.base, x, y, cnf.format ?? "webp");

			chunktasks.push({
				layer: thiscnf,
				name: filename,
				hash: depcrc,
				datarect: { x: x - 1, z: z - 1, xsize: squares + 1, zsize: squares + 1 },
				async run(chunks) {
					//TODO try enable 2d map render without loading all the 3d stuff
					//TODO locs that cross chunk boundaries currently don't show up
					let grid = new CombinedTileGrid(chunks.map(ch => ({
						src: ch.chunk.loaded!.grid,
						rect: {
							x: ch.chunk.rect.x * ch.chunk.loaded!.chunkSize,
							z: ch.chunk.rect.z * ch.chunk.loaded!.chunkSize,
							xsize: ch.chunk.rect.xsize * ch.chunk.loaded!.chunkSize,
							zsize: ch.chunk.rect.zsize * ch.chunk.loaded!.chunkSize,
						}
					})));
					let file = drawCollision(grid, area, thiscnf.level, thiscnf.pxpersquare, 1);
					return { file: () => file };
				}
			});
		}
		if (cnf.mode == "height") {
			let thiscnf = cnf;
			let filename = `${thiscnf.name}/${x}-${z}.${cnf.usegzip ? "bin.gz" : "bin"}`;
			chunktasks.push({
				layer: thiscnf,
				name: filename,
				hash: depcrc,
				datarect: { x: x, z: z, xsize: 1, zsize: 1 },
				async run(chunks) {
					//TODO what to do with classic 48x48 chunks?
					let file = chunks[0].loaded.grid.getHeightCollisionFile(x * 64, z * 64, thiscnf.level, 64, 64);
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
			let filename = `${thiscnf.name}/${x}-${z}.${cnf.usegzip ? "json.gz" : "json"}`;
			chunktasks.push({
				layer: thiscnf,
				name: filename,
				hash: depcrc,
				datarect: { x: x, z: z, xsize: 1, zsize: 1 },
				async run(chunks) {
					let { grid, modeldata, chunkSize } = chunks[0].loaded.chunkdata;
					let res = chunkSummary(grid, modeldata, { x: x * chunkSize, z: z * chunkSize, xsize: chunkSize, zsize: chunkSize });
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
			let filename = `${thiscnf.name}/${x}-${z}.${cnf.usegzip ? "json.gz" : "json"}`;
			chunktasks.push({
				layer: thiscnf,
				name: filename,
				hash: depcrc,
				datarect: { x: x, z: z, xsize: 1, zsize: 1 },
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

	let savetasks: Promise<any>[] = [];
	let symlinktasks: (() => Promise<void>)[] = [];

	let metas = await config.getMetas(chunktasks);

	//skip tasks that are known to be unchanged
	chunktasks = chunktasks.filter(task => {
		let meta = metas.find(q => q.file == task.name);
		if (task.hash != 0 && meta && meta.hash == task.hash) {
			symlinktasks.push(() => config.symlink(task.name, task.hash, meta!.file, meta!.buildnr));
			return false;
		}
		return true;
	});

	let allparentcandidates = chunktasks.flatMap(q => q.dedupeDependencies ?? []);
	let forked = await depstracker.forkDeps(allparentcandidates);

	for (let task of chunktasks) {
		let chunks = await renderer.setArea(task.datarect.x, task.datarect.z, task.datarect.xsize, task.datarect.zsize);
		await Promise.all(chunks.map(q => q.loadprom));
		// console.log("running", task.file, "old", meta?.hash, "new", task.hash);
		let data = await task.run(chunks as MaprenderSquareLoaded[]);
		if (data.symlink) {
			symlinktasks.push(() => config.symlink(task.name, task.hash, data.symlink!.name, data.symlink!.version));
		} else if (data.file) {
			savetasks.push(data.file().then(buf => config.saveFile(task.name, task.hash, buf)))
		}
	}

	progress.update(x, z, "done");
	let finish = (async () => {
		await Promise.all(savetasks);
		await Promise.all(symlinktasks.map(q => q()));
		miptasks.forEach(q => q());
		progress.update(x, z, (savetasks.length == 0 ? "skipped" : "done"));
		console.log("imaged", x, z, "files", savetasks.length, "symlinks", symlinktasks.length);
	})();

	//TODO returning a promise just gets flattened with our currnet async execution
	return finish;
}


type RenderDepsEntry = {
	x: number,
	z: number,
	metas: Promise<Map<number, ChunkRenderMeta>>
}


class RenderDepsTracker {
	config: MapRender;
	deps: DependencyGraph;
	targetversions: number[];

	cachedMetas: RenderDepsEntry[] = [];
	readonly cacheSize = 15;

	constructor(config: MapRender, deps: DependencyGraph) {
		this.config = config;
		this.deps = deps;
		this.targetversions = this.config.existingVersions
			.slice()
			.sort((a, b) => Math.abs(a - this.config.version) - Math.abs(b - this.config.version))
			.slice(0, 10);
	}

	getEntry(x: number, z: number) {
		let match = this.cachedMetas.find(q => q.x == x && q.z == z);
		if (!match) {
			let metas = (async () => {
				let filename = `${this.config.rendermetaLayer!.name}/${x}-${z}.${this.config.rendermetaLayer!.usegzip ? "json.gz" : "json"}`;
				let urls = await this.config.getRelatedFiles([filename], this.targetversions);
				urls = urls.filter(q => q.buildnr != this.config.version);
				let fetches = urls.map(q => fetch(this.config.getNamedFileUrl(q.file, q.buildnr)).then(async w => [q.buildnr, await w.json()] as [number, ChunkRenderMeta]));
				return new Map(await Promise.all(fetches));
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
		//TODO turn this request into a post because url is too long
		let allFiles: KnownMapFile[] = [];
		const maxgroup = 100;
		for (let i = 0; i + maxgroup < names.length; i += maxgroup) {
			allFiles.push(... await this.config.getRelatedFiles(names.slice(i, i + maxgroup), this.targetversions));
		}
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
					let meta = chunk.get(file.buildnr);
					if (!meta) {
						continue matchloop;
					} else {
						metas.push(meta);
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
