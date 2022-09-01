
import { ThreeJsRenderer } from "../viewer/threejsrender";
import { ParsemapOpts, TileGrid, ChunkData, ChunkModelData, MapRect, worldStride, CombinedTileGrid, squareSize } from "../3d/mapsquare";
import { runCliApplication, cliArguments, filesource, mapareasource, mapareasourceoptional, Rect, stringToMapArea } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CacheFileSource } from "../cache";
import type { Material, Object3D } from "three";
import { svgfloor } from "./svgrender";
import { cacheMajors } from "../constants";
import { parseEnums, parseMapZones } from "../opdecoder";
import { canvasToImageFile, FlatImageData, flipImage, isImageEqual, pixelsToImageFile } from "../imgutils";
import * as THREE from "three";
import { EngineCache, ThreejsSceneCache } from "../3d/ob3tothree";
import { RSMapChunk } from "../viewer/scenenodes";
import { crc32addInt, DependencyGraph, getDependencies } from "../scripts/dependencies";
import { CLIScriptOutput, ScriptOutput } from "../viewer/scriptsui";
import { delay } from "../utils";
import { drawCollision } from "./collisionimage";
import prettyJson from "json-stringify-pretty-compact";
import { chunkSummary } from "./chunksummary";

// @ts-ignore type import also fails when targeting web
import type * as electronType from "electron/renderer";

const electron = (() => {
	try {
		if (typeof __non_webpack_require__ != "undefined") {
			return __non_webpack_require__("electron/renderer") as typeof electronType;
		}
	} catch (e) { }
	return null;
})();


if (electron?.ipcRenderer) {
	window.addEventListener("keydown", e => {
		if (e.key == "F5") { document.location.reload(); }
		if (e.key == "F12") { electron.ipcRenderer.send("toggledevtools"); }
	});
	electron.ipcRenderer.invoke("getargv").then(async obj => {
		console.log(obj);
		process.chdir(obj.cwd);
		let res = await cmdts.runSafely(cmd, cliArguments(obj.argv));
		if (res._tag == "error") {
			console.error(res.error.config.message);
		} else {
			console.log("cmd completed", res.value);
		}
	});
}

let cmd = cmdts.command({
	name: "download",
	args: {
		...filesource,
		mapname: cmdts.option({ long: "mapname", defaultValue: () => "main" }),
		endpoint: cmdts.option({ long: "endpoint", short: "e" }),
		auth: cmdts.option({ long: "auth", short: "p" }),
		mapid: cmdts.option({ long: "mapid", type: cmdts.number })
	},
	handler: async (args) => {
		let output = new CLIScriptOutput("");
		//for some reason electron crashes if you pass it any argument with a `:` in it, so pass urls without scheme instead
		let endpoint = args.endpoint;
		if (endpoint.startsWith("localhost")) { endpoint = "http://" + endpoint; }
		else { endpoint = "https://" + endpoint; }
		await runMapRender(output, await args.source(), args.mapname, endpoint, args.auth, args.mapid, false);
	}
});

type Mapconfig = {
	layers: LayerConfig[],
	tileimgsize: number,
	mapsizex: number,
	mapsizez: number
}

type LayerConfig = {
	mode: string,
	name: string,
	pxpersquare: number,
	level: number,
	addmipmaps: boolean,
	format?: "png" | "webp",
	subtractlayer?: string
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
});

async function initMapConfig(endpoint: string, auth: string, uploadmapid: number, version: number, overwrite: boolean) {
	let res = await fetch(`${endpoint}/config.json`, { headers: { "Authorization": auth } });
	if (!res.ok) { throw new Error("map config fetch error"); }
	let config: Mapconfig = await res.json();
	return new MapRender(endpoint, auth, uploadmapid, config, version, overwrite);
}

//The Runeapps map saves directly to the server and keeps a version history, the server side code for this is non-public
//this class is designed so it could also implement a direct fs backing
//The render code decides which (opaque to server) file names should exist and checks if that name+hash already exists,
//if not it will generate the file and save it together with some metadata (hash+build nr)
class MapRender {
	config: Mapconfig;
	layers: LayerConfig[];
	endpoint: string;
	uploadmapid: number;
	auth: string;
	version: number;
	overwrite: boolean;
	minzoom: number;
	constructor(endpoint: string, auth: string, uploadmapid: number, config: Mapconfig, version: number, overwrite: boolean) {
		this.endpoint = endpoint;
		this.auth = auth;
		this.config = config;
		this.layers = config.layers;
		this.version = version;
		this.overwrite = overwrite;
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
	async symlink(name: string, hash: number, target: string) {
		let send = await fetch(`${this.endpoint}/upload?file=${encodeURIComponent(name)}&hash=${hash}&buildnr=${this.version}&mapid=${this.uploadmapid}&symlink=${target}`, {
			method: "post",
			headers: { "Authorization": this.auth },
		});
		if (!send.ok) { throw new Error("file symlink failed"); }
	}
	async getMetas(names: string[]) {
		if (this.overwrite) {
			return [];
		} else {
			let req = await fetch(`${this.endpoint}/getmetas?file=${encodeURIComponent(names.join(","))}&mapid=${this.uploadmapid}`, {
				headers: { "Authorization": this.auth },
			});
			if (!req.ok) { throw new Error("req failed"); }
			return await req.json() as { hash: number, file: string, time: number }[]
		}
	}
	getFileUrl(name: string, hash: number) {
		return `${this.endpoint}/getfile?file=${encodeURIComponent(name)}&hash=${+hash}&mapid=${this.uploadmapid}`;
	}
}

type TileProgress = "queued" | "rendering" | "imaged" | "sliced";

class ProgressUI {
	areas: MapRect[];
	tiles = new Map<string, { el: HTMLDivElement, x: number, z: number, progress: TileProgress }>();
	props: Record<string, { el: HTMLDivElement, text: string }> = {};
	root: HTMLElement;
	proproot: HTMLElement;

	static backgrounds: Record<TileProgress, string> = {
		sliced: "green",
		queued: "black",
		rendering: "yellow",
		imaged: "orange"
	};

	constructor(areas: MapRect[]) {
		this.areas = areas;

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
						this.tiles.set(id, { x: area.x + dx, z: area.z + dz, el, progress: "queued" });
					}
				}
			}
		}

		let grid = document.createElement("div");
		const longsize = 700;
		let scale = longsize / Math.max(maxx - minx + 1, maxz - minz + 1);
		grid.style.display = "grid";
		grid.style.width = `${(maxx - minx + 1) * scale}px`;
		grid.style.height = `${(maxz - minz + 1) * scale}px`;
		grid.style.gridTemplateColumns = `repeat(${maxx - minx + 1},1fr)`;
		grid.style.gridTemplateRows = `repeat(${maxz - minz + 1},1fr)`;

		for (let tile of this.tiles.values()) {
			tile.el.style.gridColumn = (tile.x - minx + 1) + "";
			tile.el.style.gridRow = (maxz - minz - (tile.z - minz) + 1) + "";
			tile.el.style.background = ProgressUI.backgrounds.queued;
			grid.appendChild(tile.el);
		}

		let proproot = document.createElement("div");
		proproot.style.left = `${(maxx - minx + 1) * scale}px`;
		this.proproot = proproot;

		let root = document.createElement("div");
		root.style.display = "grid";
		root.style.grid = "'a b'/auto 1fr";
		root.appendChild(grid);
		root.appendChild(proproot);
		this.root = root;
	}
	update(x: number, z: number, state: TileProgress) {
		let id = `${x}-${z}`;
		let tile = this.tiles.get(id);
		if (!tile) { throw new Error("untrakced tile"); }

		tile.progress = state;
		tile.el.style.background = ProgressUI.backgrounds[state];
	}
	updateProp(propname: string, value: string) {
		let prop = this.props[propname];
		if (!value && prop) {
			this.proproot.removeChild(prop.el);
			delete this.props[propname];
			return;
		}
		if (value && !prop) {
			prop = { el: document.createElement("div"), text: "" };
			this.props[propname] = prop;
			this.proproot.appendChild(prop.el);
		}
		prop.text = value;
		prop.el.innerText = propname + ": " + value;
	}
}

export async function runMapRender(output: ScriptOutput, filesource: CacheFileSource, areaArgument: string, endpoint: string, auth: string, uploadmapid: number, overwrite = false) {
	let engine = await EngineCache.create(filesource);

	let areas: MapRect[] = [];
	let mask: MapRect[] | undefined = undefined;
	if (areaArgument.match(/^\w+$/)) {
		if (areaArgument == "main") {

			//enums 708 seems to be the map select dropdown in-game
			let file = await filesource.getFileById(cacheMajors.enums, 708);
			let mapenum = parseEnums.read(file);

			let files = await filesource.getArchiveById(cacheMajors.worldmap, 0);
			mask = mapenum.intArrayValue2!.values
				.map(q => parseMapZones.read(files[q[1]].buffer))
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
				{ x: 47, z: 48, xsize: 2, zsize: 2 }
			]
			mask = [
				{ x: 3032, z: 3150, xsize: 95, zsize: 100 },
			]
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
	} else if (areaArgument.length == 0) {
		areas = [{ x: 0, z: 0, xsize: 100, zsize: 200 }];
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

	let progress = new ProgressUI(areas);
	document.body.appendChild(progress.root);
	output.setUI(progress.root);

	progress.updateProp("deps", "starting dependency graph");
	let deps = await getDependencies(engine);
	progress.updateProp("deps", `completed, ${deps.dependencyMap.size} nodes`);
	progress.updateProp("version", new Date(deps.maxVersion * 1000).toUTCString());

	let config = await initMapConfig(endpoint, auth, uploadmapid, deps.maxVersion, overwrite);

	let getRenderer = () => {
		let cnv = document.createElement("canvas");
		return new MapRenderer(cnv, engine, { mask });
	}
	await downloadMap(output, getRenderer, engine, deps, areas, config, progress);
	output.log("done");
}

type MaprenderSquare = { chunk: RSMapChunk, x: number, z: number, id: number };

export class MapRenderer {
	renderer: ThreeJsRenderer;
	engine: EngineCache;
	scenecache: ThreejsSceneCache | null = null;
	maxunused = 6;
	minunused = 3;
	idcounter = 0;
	squares: MaprenderSquare[] = [];
	opts: ParsemapOpts;
	constructor(cnv: HTMLCanvasElement, engine: EngineCache, opts: ParsemapOpts) {
		this.engine = engine;
		this.opts = opts;
		//TODO revert to using local renderer
		this.renderer = new ThreeJsRenderer(cnv, { alpha: false });
		// this.renderer = globalThis.render;
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

	private getChunk(x: number, z: number) {
		let existing = this.squares.find(q => q.x == x && q.z == z);
		if (existing) {
			return existing;
		} else {
			let id = this.idcounter++;
			// if (!this.scenecache || (id % 16 == 0)) {
			if (!this.scenecache) {
				console.log("refreshing scenecache");
				this.scenecache = new ThreejsSceneCache(this.engine);
			}
			let square: MaprenderSquare = {
				x: x,
				z: z,
				chunk: new RSMapChunk({ x, z, xsize: 1, zsize: 1 }, this.scenecache, this.opts),
				id
			}
			this.squares.push(square);
			return square;
		}
	}

	async setArea(x: number, z: number, xsize: number, zsize: number) {
		let load: MaprenderSquare[] = [];
		for (let dz = 0; dz < zsize; dz++) {
			for (let dx = 0; dx < xsize; dx++) {
				load.push(this.getChunk(x + dx, z + dz))
			}
		}
		await Promise.all(load.map(q => q.chunk.model));
		load.forEach(q => q.chunk.addToScene(this.renderer));
		let obsolete = this.squares.filter(square => !load.includes(square));
		if (obsolete.length >= this.maxunused) {
			obsolete.sort((a, b) => b.id - a.id);
			let removed = obsolete.slice(this.minunused);
			removed.forEach(r => {
				r.chunk.model.then(m => m.chunkmodels.forEach(ch => disposeThreeTree(ch)));
				r.chunk.cleanup();
			});
			this.squares = this.squares.filter(sq => !removed.includes(sq));
		}
		return load;
	}
}

function disposeThreeTree(node: THREE.Object3D | null) {
	if (!node) { return; }

	const cleanMaterial = (material: Material) => {
		count++;
		material.dispose();

		// dispose textures
		for (const key of Object.keys(material)) {
			const value = material[key]
			if (value && typeof value === 'object' && 'minFilter' in value) {
				value.dispose();
				count++;
			}
		}
	}

	let count = 0;
	(node as any).traverse((object: any) => {
		if (!object.isMesh) return

		count++;
		object.geometry.dispose();

		if (object.material.isMaterial) {
			cleanMaterial(object.material);
		} else {
			// an array of materials
			for (const material of object.material) {
				cleanMaterial(material);
			}
		}
	});

	console.log("disposed scene objects", count);
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

	let mipper = new MipScheduler(config, progress);

	let completed = 0;
	for (let chunk of chunks) {
		if (output.state != "running") { break; }
		for (let retry = 0; retry <= maxretries; retry++) {
			try {
				maprender ??= getRenderer();
				await renderMapsquare(engine, config, maprender, deps, mipper, progress, chunk.x, chunk.z);
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
	output.log(errs);
}

type MipCommand = { layer: LayerConfig, zoom: number, x: number, y: number, files: ({ name: string, hash: number } | null)[] };

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
		let tasks: { file: string, hash: number, run: () => Promise<void>, finally: () => void }[] = [];
		let processTasks = async () => {
			let oldhashes = await this.render.getMetas(tasks.map(q => q.file));
			let proms: Promise<void>[] = [];
			for (let task of tasks) {
				let old = oldhashes.find(q => q.file == task.file);

				if (!old || old.hash != task.hash) {
					proms.push(task.run().catch(e => console.warn("mipping", task.file, "failed", e)));
					completed++;
				} else {
					skipped++;
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
					file: out,
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

async function mipCanvas(render: MapRender, files: MipCommand["files"], format: "png" | "webp", quality: number) {
	let cnv = document.createElement("canvas");
	cnv.width = render.config.tileimgsize;
	cnv.height = render.config.tileimgsize;
	let ctx = cnv.getContext("2d")!;
	const subtilesize = render.config.tileimgsize / 2;
	await Promise.all(files.map(async (f, i) => {
		if (!f) { return null; }
		let src = render.getFileUrl(f.name, f.hash);

		//use fetch here since we can't prevent cache on redirected images otherwise
		// let res = await fetch(src, { cache: "reload" });
		// if (!res.ok) { throw new Error("image no found"); }
		//imagedecoder API doesn't support svg
		// //@ts-ignore
		// let decoder = new ImageDecoder({ data: res.body, type: res.headers.get("content-type"), desiredWidth: subtilesize, desiredHeight: subtilesize });
		// let frame = await decoder.decode();

		let img = new Image(subtilesize, subtilesize);
		// let blobsrc = URL.createObjectURL(await res.blob());
		img.crossOrigin = "";
		img.src = src;
		// img.src = blobsrc;
		await img.decode();
		ctx.drawImage(img, (i % 2) * subtilesize, Math.floor(i / 2) * subtilesize, subtilesize, subtilesize);
		// URL.revokeObjectURL(blobsrc);
	}));
	return canvasToImageFile(cnv, format, quality);
}

export async function renderMapsquare(engine: EngineCache, config: MapRender, renderer: MapRenderer, deps: DependencyGraph, mipper: MipScheduler, progress: ProgressUI, x: number, z: number) {
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

	let baseimgs: Record<string, FlatImageData> = {};
	progress.update(x, z, "rendering");
	let rootdeps = [
		deps.makeDeptName("mapsquare", (x - 1) + (z - 1) * worldStride),
		deps.makeDeptName("mapsquare", (x) + (z - 1) * worldStride),
		deps.makeDeptName("mapsquare", (x - 1) + (z) * worldStride),
		deps.makeDeptName("mapsquare", (x) + (z) * worldStride)
	];
	let depcrc = rootdeps.reduce((a, v) => deps.hashDependencies(v, a), 0);
	// let depfiles = rootdeps.reduce((a, v) => deps.cascadeDependencies(v, a), []);

	let chunktasks: {
		layer: LayerConfig,
		file: string,
		hash: number,
		//first callback depends on state and should be series, 2nd is deferred and can be parallel
		run: () => Promise<{ file?: () => Promise<Buffer>, symlink?: string }>
	}[] = [];
	let miptasks: (() => void)[] = [];
	for (let cnf of config.layers) {
		let squares = 1;//cnf.mapsquares ?? 1;//TODO remove or reimplement
		if (x % squares != 0 || z % squares != 0) { continue; }
		let area: MapRect = { x: x * 64 - 16, z: z * 64 - 16, xsize: 64 * squares, zsize: 64 * squares };
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
						let subtractfilename = (thiscnf.subtractlayer ? config.makeFileName(thiscnf.subtractlayer, zoom, x * subslices + subx, y * subslices + suby, cnf.format ?? "webp") : "")
						chunktasks.push({
							layer: thiscnf,
							file: filename,
							hash: depcrc,
							async run() {
								let chunks = await renderer.setArea(x - 1, z - 1, squares + 1, squares + 1);
								setfloors(chunks, thiscnf.level);
								let img = await renderer!.renderer.takeMapPicture(area.x + tiles * subx, area.z + tiles * subz, tiles, pxpersquare, thiscnf.dxdy, thiscnf.dzdy);

								flipImage(img);
								// isImageEmpty(img, "black");
								baseimgs[filename] = img;
								let useparent = subtractfilename && baseimgs[subtractfilename] && isImageEqual(img, baseimgs[subtractfilename]);
								return {
									file: () => pixelsToImageFile(img, thiscnf.format ?? "webp", 0.9),
									symlink: (useparent ? subtractfilename : undefined)
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
				file: filename,
				hash: depcrc,
				async run() {
					//TODO try enable 2d map render without loading all the 3d stuff
					let chunks = await renderer.setArea(x - 1, z - 1, squares + 1, squares + 1);
					let grid = new CombinedTileGrid(chunks.map(ch => ({
						src: ch.chunk.loaded!.grid,
						rect: {
							x: ch.chunk.rect.x * squareSize,
							z: ch.chunk.rect.z * squareSize,
							xsize: ch.chunk.rect.xsize * squareSize,
							zsize: ch.chunk.rect.zsize * squareSize,
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
		if (cnf.mode == "height") {
			let thiscnf = cnf;
			let filename = `${thiscnf.name}/${x}-${z}.bin`;
			chunktasks.push({
				layer: thiscnf,
				file: filename,
				hash: depcrc,
				async run() {
					let chunks = await renderer.setArea(x, z, 1, 1);
					let { grid } = await chunks[0].chunk.model;
					let file = grid.getHeightCollisionFile(x * 64, z * 64, thiscnf.level, 64, 64);
					return { file: () => Promise.resolve(Buffer.from(file.buffer, file.byteOffset, file.byteLength)) };
				}
			});
		}
		if (cnf.mode == "locs") {
			let thiscnf = cnf;
			let filename = `${thiscnf.name}/${x}-${z}.json`;
			chunktasks.push({
				layer: thiscnf,
				file: filename,
				hash: depcrc,
				async run() {
					let chunks = await renderer.setArea(x, z, 1, 1);
					let { grid, modeldata } = await chunks[0].chunk.model;
					let res = await chunkSummary(engine, grid, modeldata, { x: x * squareSize, z: z * squareSize, xsize: squareSize, zsize: squareSize });
					let textual = prettyJson(res, { indent: "\t" });
					return { file: () => Promise.resolve(Buffer.from(textual, "utf8")) };
				}
			});
		}
		if (cnf.mode == "collision") {
			let thiscnf = cnf;
			let filename = config.makeFileName(thiscnf.name, zooms.base, x, y, cnf.format ?? "webp");

			chunktasks.push({
				layer: thiscnf,
				file: filename,
				hash: depcrc,
				async run() {
					//TODO try enable 2d map render without loading all the 3d stuff
					let chunks = await renderer.setArea(x - 1, z - 1, squares + 1, squares + 1);
					let grid = new CombinedTileGrid(chunks.map(ch => ({
						src: ch.chunk.loaded!.grid,
						rect: {
							x: ch.chunk.rect.x * squareSize,
							z: ch.chunk.rect.z * squareSize,
							xsize: ch.chunk.rect.xsize * squareSize,
							zsize: ch.chunk.rect.zsize * squareSize,
						}
					})));
					let file = drawCollision(grid, area, thiscnf.level, thiscnf.pxpersquare, 1);
					return { file: () => file };
				}
			});
		}
	}

	let savetasks: Promise<any>[] = [];
	let symlinktasks: (() => Promise<void>)[] = [];
	let metas = await config.getMetas(chunktasks.map(q => q.file));
	for (let task of chunktasks) {
		let meta = metas.find(q => q.file == task.file);
		if (!meta || meta.hash != task.hash) {
			// console.log("running", task.file, "old", meta?.hash, "new", task.hash);
			let data = await task.run();
			if (data.symlink) {
				symlinktasks.push(() => config.symlink(task.file, task.hash, data.symlink!));
			} else if (data.file) {
				savetasks.push(data.file().then(buf => config.saveFile(task.file, task.hash, buf)))
			}
		}
	}
	progress.update(x, z, "imaged");
	let finish = (async () => {
		await Promise.all(savetasks);
		await Promise.all(symlinktasks.map(q => q()));
		miptasks.forEach(q => q());
		progress.update(x, z, "sliced");
		console.log("imaged", x, z, "files", savetasks.length, "symlinks", symlinktasks.length);
	})();

	//TODO returning a promise just gets flattened with our currnet async execution
	return finish;
}

function trickleTasks(name: string, parallel: number, tasks: (() => Promise<any>)[]) {
	if (name) { console.log(`starting ${name}, ${tasks.length} tasks`); }
	return new Promise<void>(done => {
		let index = 0;
		let running = 0;
		let run = () => {
			if (index < tasks.length) {
				tasks[index++]().finally(run);
				if (index % 100 == 0 && name) { console.log(`${name} progress ${index}/${tasks.length}`); }
			} else {
				running--;
				if (running <= 0) {
					if (name) { console.log(`completed ${name}`); }
					done();
				}
			}
		}
		for (let i = 0; i < parallel; i++) {
			running++;
			run();
		}
	})
}

