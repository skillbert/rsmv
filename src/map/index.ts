
import { ThreeJsRenderer } from "../viewer/threejsrender";
import { ParsemapOpts, MapRect, worldStride, parseMapsquare } from "../3d/mapsquare";
import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { EngineCache, ThreejsSceneCache } from "../3d/modeltothree";
import { DependencyGraph } from "../scripts/dependencies";
import { ScriptOutput } from "../scriptrunner";
import { delay, stringToFileRange, trickleTasks } from "../utils";
import { mapsquareFloorDependencies, mapsquareLocDependencies, mapsquareVisuals, RenderDepsTracker } from "./chunksummary";
import { RSMapChunk } from "../3d/modelnodes";
import { MapRender, SymlinkCommand, VersionFilter } from "./backends";
import { ProgressUI, TileLoadState } from "./progressui";
import { MipScheduler } from "./mipper";
import { crc32addInt } from "../libs/crc32util";
import { ChunkrenderContext, ImgNameInfoZoom, MaprenderSquare, MaprenderSquareLoaded, rendermodes, RenderResult, RenderTask } from "./layers";
import { VariantGroup, VariantResolver } from "./varianttracker";

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

export type RenderedMapMeta = {
	versions: {
		version: number,
		date: number,
		build: number,
		source: string
	}[]
}

export type Mapconfig = {
	layers: LayerConfig[],
	tileimgsize: number,
	mapsizex: number,//used to determine lowest scaling mip level and flipped y origin
	mapsizez: number,
	area: string,
	noyflip: boolean | undefined,
	nochunkoffset: boolean | undefined,
	variantdebug: boolean | undefined,
	variantsparse: boolean | undefined,
}

export type LayerConfig = {
	mode: string,
	name: string,
	pxpersquare: number,
	level: number,
	format?: "png" | "webp",
	mipmode?: "default" | "avg",
	usegzip?: boolean,
	subtractlayers?: string[]
} & ({
	mode: "3d" | "minimap" | "interactions",
	dxdy: number,
	dzdy: number,
	hidelocs?: boolean,
	overlaywalls?: boolean,
	overlayicons?: boolean
} | {
	mode: "map",
	wallsonly?: boolean,
	mapicons?: boolean,
	thicklines?: boolean
} | {
	mode: "height"
	allcorners?: boolean
} | {
	mode: "collision"
} | {
	mode: "locs"
} | {
	mode: "maplabels"
} | {
	mode: "rendermeta"
});

async function getVersionsFile(config: MapRender, includeCacheVersion: CacheFileSource | null = null) {
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
	if (includeCacheVersion && !mapversionsinfo.versions.some(q => q.version == config.version)) {
		mapversionsinfo.versions.push({
			version: config.version,
			build: includeCacheVersion.getBuildNr(),
			date: +includeCacheVersion.getCacheMeta().timestamp,
			source: includeCacheVersion.getCacheMeta().name
		});
		mapversionsinfo.versions.sort((a, b) => b.version - a.version);
		//no lock this is technically a race condition when using multiple renderers
		console.log("updating versions file");
		await config.saveFile("versions.json", Buffer.from(JSON.stringify(mapversionsinfo)), 0);
	}
	return mapversionsinfo;
}

export async function purgeBadRenders(config: MapRender, versionfilter: VersionFilter) {
	let timestamp = new Date().toISOString();
	let versions = await getVersionsFile(config);
	for (let version of versions.versions) {
		if (typeof versionfilter.from == "number" && version.version < versionfilter.from) { continue; }
		if (typeof versionfilter.to == "number" && version.version > versionfilter.to) { continue; }

		let configres = await config.getFileResponse("meta.json", version.version);
		if (!configres.ok) {
			console.log("missing meta.json file skipped");
			continue;
		}

		let metajson: RenderedMapVersionMeta = await configres.json();
		metajson.workerid = config.workerid;
		metajson.running = true;
		metajson.rendertimestamp = timestamp;

		await config.saveFile("meta.json", Buffer.from(JSON.stringify(metajson, undefined, "\t")));
	}
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
			mask.push({ x: 43 * 64, z: 27 * 64, xsize: 3 * 64, zsize: 3 * 64 });//aod
			mask.push({ x: 50 * 64, z: 158 * 64, xsize: 2 * 64, zsize: 1 * 64 });//wars retreat

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
		let fileranges = stringToFileRange(areaArgument);
		if (!fileranges || fileranges.length == 0) {
			throw new Error("map area argument did not match a preset name and did not resolve to a rectangle");
		}
		areas = fileranges.map(r => ({ x: r.start[0], z: r.start[1], xsize: r.end[0] - r.start[0] + 1, zsize: r.end[1] - r.start[1] + 1 }));
	}
	if (areas.length == 0) {
		throw new Error("no map area or map name");
	}

	return { areas, mask };
}

export async function runMapRender(output: ScriptOutput, filesource: CacheFileSource, config: MapRender, forceCheck: boolean) {
	let versionid = filesource.getBuildNr();
	if (filesource.getBuildNr() > 900) {
		//use build number for older caches since they wont have version timestamps
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
	await config.beginMapVersion(versionid);

	if (!forceCheck) {
		let prevconfigreq = await config.getFileResponse("meta.json");
		if (!prevconfigreq.ok) {
			console.log(`starting new render ${config.version}`);
		} else {
			let prevconfig: RenderedMapVersionMeta = await prevconfigreq.json();
			let prevdate = new Date(prevconfig.rendertimestamp);

			let isownrun = prevconfig.workerid == config.workerid;
			let hoursold = (Date.now() - +prevdate) / 1000 / 60 / 60;
			//take work from other worker if the timestamp is older than 20 hours which probably means something crashed
			if (prevconfig.running && isownrun) {
				console.log(`continuing render ${config.version} which was locked by current worker`);
			} else if (prevconfig.running && hoursold > 20) {
				console.log(`continuing render ${config.version} which was locked by other worker and presumed abandoned. (locked ${hoursold | 0} hours ago)`);
			} else {
				output.log("skipping", config.version);
				return () => { };
			}
		}
	}

	let engine = await EngineCache.create(filesource);
	globalThis.onWatchdogProgress?.();

	let progress = new ProgressUI();
	progress.updateProp("source", filesource.getCacheMeta().name + "\n" + filesource.getCacheMeta().descr);
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
		var deps = await engine.getDependencyGraph();
		globalThis.onWatchdogProgress?.();
		await deps.preloadChunkDependencies({ area: deparea });
		globalThis.onWatchdogProgress?.();
	} catch (e) {
		console.error(e);
		progress.updateProp("deps", "starting dependency graph");
		return cleanup;
	}
	progress.updateProp("deps", `completed, ${deps.dependencyMap.size} nodes`);
	// progress.updateProp("version", new Date(deps.maxVersion * 1000).toUTCString());


	let opts: ParsemapOpts = { mask };
	if (config.config.layers.some(q => q.mode == "minimap")) { opts.minimap = true; }
	if (config.config.layers.some(q => q.mode == "collision")) { opts.collision = true; }
	opts = RSMapChunk.defaultopts(opts);
	let getRenderer = () => {
		let cnv = document.createElement("canvas");
		let renderer = new MapRenderer(cnv, config, engine, deps, opts);
		renderer.loadcallback = (x, z, state) => progress.update(x, z, "", state);
		return renderer;
	}
	await downloadMap(output, getRenderer, engine, deps, areas, config, progress);
	output.log("done");
	globalThis.onWatchdogProgress?.();

	return cleanup;
}

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
		//TODO turn opaquebackground back on for map renders
		this.renderer.addSceneElement({ getSceneElements() { return { options: { autoFrames: "never", hideFog: true } }; } });
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

	private async getChunk(x: number, z: number, needsmodels: boolean) {
		let square = this.squares.find(q => q.x == x && q.z == z);
		if (square && (!needsmodels || square.model)) {
			return square;
		} else {
			this.loadcallback?.(x, z, "loading");
			if (!this.scenecache) {
				console.log("refreshing scenecache");
				this.scenecache = await ThreejsSceneCache.create(this.engine);
			}
			if (!square) {
				let parseprom = parseMapsquare(this.scenecache.engine, x, z, this.opts);
				let id = this.idcounter++;
				square = {
					id,
					x: x,
					z: z,
					parseprom: parseprom,
					parsed: null,
					model: null,
					loaded: null,
					loadprom: null,
				}
				parseprom.then(res => square!.parsed = res);
				this.squares.push(square);
			}
			if (needsmodels) {
				square.model = new RSMapChunk(this.scenecache, square.parseprom, x, z, this.opts);
				square.loadprom = (async () => {
					let chunkdata = await square.model!.chunkdata;
					let floordeps = (!chunkdata.chunk ? [] : mapsquareFloorDependencies(chunkdata.grid, this.deps, chunkdata.chunk));
					let locdeps = mapsquareLocDependencies(chunkdata.grid, this.deps, chunkdata.modeldata, chunkdata.chunkx, chunkdata.chunkz);
					square!.loaded = {
						rendermeta: {
							x: chunkdata.chunkx,
							z: chunkdata.chunkz,
							version: this.config.version,
							floor: floordeps,
							locs: locdeps,
							visuals: mapsquareVisuals(floordeps, locdeps)
						},
						grid: chunkdata.grid,
						chunkdata: chunkdata
					};
					this.loadcallback?.(x, z, "loaded");
					return square!.loaded;
				})()
			}
			return square;
		}
	}

	async setArea(x: number, z: number, xsize: number, zsize: number, needsmodels: boolean) {
		let load: MaprenderSquare[] = [];
		//load topright last to increase chance of cache hit later on
		for (let dx = 0; dx < xsize; dx++) {
			for (let dz = 0; dz < zsize; dz++) {
				load.push(await this.getChunk(x + dx, z + dz, needsmodels))
			}
		}
		await Promise.all(load.map(q => q.loadprom));
		load.forEach(q => q.model?.addToScene(this.renderer));
		let obsolete = this.squares.filter(square => !load.includes(square));
		if (obsolete.length >= this.maxunused) {
			obsolete.sort((a, b) => b.id - a.id);
			let removed = obsolete.slice(this.minunused);
			removed.forEach(r => {
				r.model?.cleanup();
				this.loadcallback?.(r.x, r.z, "unloaded");
			});
			this.squares = this.squares.filter(sq => !removed.includes(sq));
		}
		return load as MaprenderSquareLoaded[];
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

	await config.saveFile("meta.json", Buffer.from(JSON.stringify(configjson, undefined, "\t")));

	let versionsFile = await getVersionsFile(config, engine);
	let versiontime = +engine.getCacheMeta().timestamp;
	let targetversions = versionsFile.versions
		.slice()
		.sort((a, b) => Math.abs(a.date - versiontime) - Math.abs(b.date - versiontime))
		.slice(0, 10)
		.map(q => q.version);

	let depstracker = new RenderDepsTracker(config, deps, targetversions);
	let varianttracker = new VariantResolver(config, targetversions);
	let mipper = new MipScheduler(config, varianttracker, progress);
	let maprender: MapRenderer | null = null;
	let activerender = Promise.resolve();

	let render = function* () {
		let completed = 0;
		for (let chunk of chunks) {
			if (output.state != "running") { break; }

			let task = renderMapsquare(engine, config, depstracker, varianttracker, mipper, progress, chunk.x, chunk.z);
			let lastrender = activerender;
			let fn = (async () => {
				if (output.state != "running") { return; }
				for (let retry = 0; retry <= maxretries; retry++) {
					try {
						await lastrender;
						maprender ??= getRenderer();
						await task.runTasks(maprender);
						await varianttracker.finishChunk();
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
			//TODO consider not making fn an iife and just let .then call it
			activerender = activerender.then(() => fn);
			yield fn;
			completed++;
			if (completed % 20 == 0) {
				yield mipper.run();
				yield varianttracker.finishChunk(true);
			}
		}
	}

	await trickleTasks("", 10, render);
	await mipper.run(true);
	await varianttracker.finishChunk(true);
	configjson.errorcount = errs.length;
	configjson.running = false;
	await config.saveFile("meta.json", Buffer.from(JSON.stringify(configjson, undefined, "\t")));
	output.log(errs);
}

export class SimpleHasher {
	depstracker: RenderDepsTracker;
	subhashes: { x: number, z: number, hash: number }[] = [];
	constructor(deps: RenderDepsTracker) {
		this.depstracker = deps;
	}
	getsubhash(x: number, z: number) {
		let h = this.subhashes.find(q => q.x == x && q.z == z);
		if (!h) {
			let hash = this.depstracker.deps.hashDependencies(this.depstracker.deps.makeDeptName("mapsquare", x + z * worldStride));
			this.subhashes.push({ x, z, hash });
			return hash;
		} else {
			return h.hash;
		}
	}
	recthash(rect: MapRect) {
		let hash = 0;
		for (let z = rect.z; z < rect.z + rect.zsize; z++) {
			for (let x = rect.x; x < rect.x + rect.xsize; x++) {
				hash = crc32addInt(this.getsubhash(x, z), hash);
			}
		}
		return hash;
	}
	rectexists(rect: MapRect) {
		let exists = false;
		for (let z = rect.z; z < rect.z + rect.zsize; z++) {
			for (let x = rect.x; x < rect.x + rect.xsize; x++) {
				exists ||= this.depstracker.deps.hasEntry("mapsquare", x + z * worldStride);
			}
		}
		return exists;
	}
}


export function renderMapsquare(engine: EngineCache, config: MapRender, depstracker: RenderDepsTracker, varianttracker: VariantResolver, mipper: MipScheduler, progress: ProgressUI, chunkx: number, chunkz: number) {
	progress.update(chunkx, chunkz, "imaging");

	let filebasecoord = {
		x: chunkx,
		y: (config.config.noyflip ? chunkz : config.config.mapsizez - 1 - chunkz)
	};
	let deps = new SimpleHasher(depstracker);

	let chunktasks: RenderTask[] = [];
	let miptasks: (() => void)[] = [];
	for (let layer of config.config.layers) {
		let squares = 1;//layer.mapsquares ?? 1;//TODO remove or reimplement
		if (chunkx % squares != 0 || chunkz % squares != 0) { continue; }

		let maprect: MapRect = { x: chunkx, z: chunkz, xsize: squares, zsize: squares };

		let modefunc = rendermodes[layer.mode];
		if (!modefunc) { throw new Error("unknown render mode"); }
		let ctx: ChunkrenderContext<any> = { engine, config, deps, baseoutput: filebasecoord, layer, maprect, variants: varianttracker };
		chunktasks.push(...modefunc(ctx));
	}


	let runTask = async (renderer: MapRenderer, task: RenderTask): Promise<RenderResult | null> => {
		let resolver = varianttracker.getOrCreateResolver(task.layer, task.nameinfo.zoom ?? null);

		let load3dmodels = !!task.run;
		let chunks = await renderer.setArea(task.datarect.x, task.datarect.z, task.datarect.xsize, task.datarect.zsize, load3dmodels);

		let exacthash: number | undefined = undefined;
		// try find match
		if (task.getExactHash) {
			exacthash = task.getExactHash(chunks) ?? task.dependencyhash;
			let exacthashmatch = await resolver.findCandidate(task.nameinfo.x, task.nameinfo.y, exacthash, true);
			if (exacthashmatch) {
				return {
					exacthash: exacthashmatch.exacthash,
					storedvariant: exacthashmatch
				}
			}
		}

		//no actual chunks loaded, this shouldn't happen (not often) because we filter existing rects before
		if (!chunks.some(q => q.parsed.chunk)) {
			console.warn("no chunk data found for task, skipping", task.layer.name, task.nameinfo);
			return null;
		}

		//run the render task
		if (task.run) {
			await Promise.all(chunks.map(q => q.loadprom));
			let res = await task.run(chunks, renderer);
			res.exacthash = exacthash;
			return res;
		} else if (task.run2d) {
			let res = await task.run2d(chunks.map(q => q.parsed));
			res.exacthash = exacthash;
			return res;
		} else {
			throw new Error("task has no run and also no run2d method");
		}
	}

	// dedupe using varianttracker
	let candidatesprom = chunktasks.map(q => {
		let resolver = varianttracker.getOrCreateResolver(q.layer, q.nameinfo.zoom ?? null);
		return resolver.findCandidate(q.nameinfo.x, q.nameinfo.y, q.dependencyhash, false);
	});

	let runTasks = async (renderer: MapRenderer) => {
		let savequeue: Promise<any>[] = [];
		let savemetaqueue: Promise<any>[] = [];
		let symlinkcommands: SymlinkCommand[] = [];


		let candidates = await Promise.all(candidatesprom);
		for (let taskindex = 0; taskindex < chunktasks.length; taskindex++) {
			let task = chunktasks[taskindex];
			let resolver = varianttracker.getOrCreateResolver(task.layer, task.nameinfo.zoom ?? null);
			let isempty = !deps.rectexists(task.datarect);

			// naive hash dedupe
			let res: RenderResult | null = null;
			let hashmatch = candidates[taskindex];
			if (hashmatch) {
				res = {
					exacthash: hashmatch.exacthash,
					storedvariant: hashmatch,
				};
			} else if (!isempty) {
				// actual render
				res = await runTask(renderer, task);
			}

			//store it
			let exacthash = res?.exacthash ?? task.dependencyhash;
			let storedlayername = res?.storedvariant ? res.storedvariant.savedLayerName : task.layer.name;
			let storedlayerversion = res?.storedvariant ? res.storedvariant.savedLayerVersion : config.version;
			let storedfilename = "";
			if (!res) {
				// empty chunk, store nothing
			} else if (res.storedvariant) {
				storedfilename = config.makeFileName(res.storedvariant.savedLayerName, task.nameinfo.zoom, task.nameinfo.x, task.nameinfo.y, task.nameinfo.ext);
				symlinkcommands.push({
					file: config.makeFileName(task.layer.name, task.nameinfo.zoom, task.nameinfo.x, task.nameinfo.y, task.nameinfo.ext),
					version: config.version,
					target: storedfilename,
					targetversion: res.storedvariant.savedLayerVersion
				});
			} else if (res.file) {
				storedfilename = config.makeFileName(task.layer.name, task.nameinfo.zoom, task.nameinfo.x, task.nameinfo.y, task.nameinfo.ext);
				savequeue.push(res.file.then(buf => config.saveFile(storedfilename, buf)));
			}

			// store its reference
			savemetaqueue.push(resolver.addFile(task.nameinfo.x, task.nameinfo.y, task.dependencyhash, exacthash, storedlayername, storedlayerversion));

			// queue mipping if needed
			if (task.mippable) {
				miptasks.push(() => {
					let nameinfo = task.nameinfo;
					if (nameinfo.zoom == null) { throw new Error("only zoomed tasks can be mipped"); }
					mipper.addTask(task.layer, storedlayername, nameinfo as ImgNameInfoZoom, storedlayerversion, task.dependencyhash, exacthash);
				});
			}
		}

		progress.update(chunkx, chunkz, "done");

		await Promise.all(savequeue);
		await config.symlinkBatch(symlinkcommands);
		await Promise.all(savemetaqueue);
		miptasks.forEach(q => q());

		progress.update(chunkx, chunkz, (savequeue.length == 0 ? "skipped" : "done"));
		let localsymlinkcount = symlinkcommands.filter(q => q.targetversion == config.version && q.file != q.target).length;
		console.log("imaged", chunkx, chunkz, "files", savequeue.length, "symlinks", localsymlinkcount, "(unchanged)", symlinkcommands.length - localsymlinkcount);
		globalThis.onWatchdogProgress?.();
	}

	//TODO returning a promise just gets flattened with our current async execution
	return { runTasks };
}
