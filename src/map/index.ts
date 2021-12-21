
import { ThreeJsRenderer } from "../viewer/threejsrender";
import { mapsquareModels, mapsquareToThree, parseMapsquare, ParsemapOpts, TileGrid, ChunkData, ChunkModelData, MapRect } from "../3d/mapsquare";
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import * as electron from "electron";
import { runCliApplication, cliArguments, filesource, mapareasource, mapareasourceoptional, Rect } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CacheFileSource } from "../cache";
import type { Object3D } from "three";
import { svgfloor } from "./svgrender";
import { cacheMajors } from "../constants";
import { parseEnums, parseMapZones } from "../opdecoder";
import { FlatImageData } from "3d/utils";

window.addEventListener("keydown", e => {
	if (e.key == "F5") { document.location.reload(); }
	if (e.key == "F12") { electron.remote.getCurrentWebContents().toggleDevTools(); }
});

//can't use module import syntax because es6 wants to be more es6 than es6
const THREE = require("three/build/three.js") as typeof import("three");
const watermarkfile = fs.readFileSync(__dirname + "/../assets/watermark.png");

type Mapconfig = {
	basedir: string,
	layers: LayerConfig[],
	tileimgsize: number,
	mapsizex: number,
	mapsizez: number,
	overwrite: boolean
}

type LayerConfig = {
	mode: string,
	name: string,
	pxpersquare: number,
	outputpxpersquare?: number,
	level: number,
	subtractlayer?: string
} & ({
	mode: "3d",
	dxdy: number,
	dzdy: number,
	walls?: boolean
} | {
	mode: "map",
	wallsonly: boolean
});

class MapRender {
	config: Mapconfig;
	overwrite: boolean;
	layers: LayerConfig[];
	basedir: string;
	constructor(config: Mapconfig) {
		this.config = config;
		this.overwrite = config.overwrite;
		this.layers = config.layers;
		this.basedir = config.basedir;
	}
	outzoom(layer: string, zoom: number) {
		return `${this.config.basedir}/${layer}/${zoom}`;
	}
	outpath(layer: string, zoom: number, x: number, y: number, ext = "png") {
		return `${this.outzoom(layer, zoom)}/${x}-${y}.${ext}`;
	}
	metapath(chunkx: number, chunkz: number) {
		return `${this.config.basedir}/meta/${chunkx}-${chunkz}.json`;
	}
	makedirs() {
		fs.mkdirSync(`${this.config.basedir}/meta`, { recursive: true });
		fs.mkdirSync(`${this.config.basedir}/height`, { recursive: true });
		for (let layer of this.config.layers) {
			let zooms = this.getLayerZooms(layer);
			for (let zoom = zooms.min; zoom <= zooms.max; zoom++) {
				fs.mkdirSync(this.outzoom(layer.name, zoom), { recursive: true });
			}
		};
	}
	getLayerZooms(layercnf: LayerConfig) {
		const min = Math.floor(Math.log2(this.config.tileimgsize / (Math.max(this.config.mapsizex, this.config.mapsizez) * 64)));
		const max = Math.log2((layercnf.outputpxpersquare ?? layercnf.pxpersquare));
		const base = Math.log2(this.config.tileimgsize / 64);
		return { min, max, base };
	}
}

type TileProgress = "queued" | "rendering" | "imaged" | "sliced";

class ProgressUI {
	areas: MapRect[];
	tiles = new Map<string, { el: HTMLDivElement, x: number, z: number, progress: TileProgress }>();
	root: HTMLElement;

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
		this.root = grid;
	}
	update(x: number, z: number, state: TileProgress) {
		let id = `${x}-${z}`;
		let tile = this.tiles.get(id);
		if (!tile) { throw new Error("untrakced tile"); }

		tile.progress = state;
		tile.el.style.background = ProgressUI.backgrounds[state];
	}
}

let cmd = cmdts.command({
	name: "download",
	args: {
		...filesource,
		...mapareasourceoptional,
		mapname: cmdts.option({ long: "mapname", defaultValue: () => "" }),
		overwrite: cmdts.flag({ long: "force", short: "f" }),
		save: cmdts.option({ long: "save", short: "s", type: cmdts.string, defaultValue: () => "cache/map" }),
	},
	handler: async (args) => {
		const tileimgsize = 512;
		const mapsizez = 200;
		const mapsizex = 100;
		let filesource = await args.source();

		let areas: MapRect[] = [];
		let mask: MapRect[] | undefined = undefined;
		if (args.mapname) {
			if (args.mapname == "main") {

				//enums 708 seems to be the map select dropdown in-game
				let file = await filesource.getFileById(cacheMajors.enums, 708);
				let mapenum = parseEnums.read(file);

				let indexmeta = await filesource.getIndexFile(cacheMajors.worldmap);
				let index = indexmeta.find(q => q.minor == 0)!;
				let files = await filesource.getFileArchive(index);
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


				areas = mask.map(q => {
					let x = Math.floor(q.x / 64);
					let z = Math.floor(q.z / 64);
					return { x, z, xsize: Math.ceil((q.x + q.xsize) / 64) - x + 1, zsize: Math.ceil((q.z + q.zsize) / 64) - z + 1 };
				});
			}
			if (args.mapname == "test") {
				areas = [
					{ x: 47, z: 48, xsize: 2, zsize: 2 }
				]
				mask = [
					{ x: 3032, z: 3150, xsize: 95, zsize: 100 },
				]
			}
			if (args.mapname == "gwd3") {
				areas = [
					{ x: 31, z: 20, xsize: 1, zsize: 1 }
				];
				mask = [
					{ x: 1984, z: 1280, xsize: 64, zsize: 64 }
				]
			}
			if (args.mapname == "tower") {
				areas = [
					{ x: 49, z: 51, xsize: 1, zsize: 1 }
				];
			}
		} else {
			areas = args.area ? [args.area] : [{ x: 0, z: 0, xsize: 100, zsize: 200 }];
		}
		if (areas.length == 0) {
			throw new Error("no map area or map name");
		}

		let allfloors = [0, 1, 2, 3];

		let config = new MapRender({
			basedir: path.resolve(args.save),
			tileimgsize,
			mapsizex,
			mapsizez,
			overwrite: args.overwrite,
			layers: [
				...allfloors.map(level => ({
					mode: "3d",
					name: `level-${level}`,
					dxdy: 0.15, dzdy: 0.5,
					level,
					pxpersquare: 64,
					outputpxpersquare: 64,
					subtractlayer: (level == 0 ? undefined : `level-0`)
				} as LayerConfig)),
				...allfloors.map(level => ({
					mode: "3d",
					name: `topdown-${level}`,
					dxdy: 0, dzdy: 0,
					level,
					pxpersquare: 64,
					outputpxpersquare: 64,
					subtractlayer: (level == 0 ? undefined : `topdown-0`)
				} as LayerConfig)),
				...allfloors.map(level => ({
					mode: "map",
					name: `map-${level}`,
					level,
					pxpersquare: 8,
					wallsonly: false
				} as LayerConfig)),
				...allfloors.map(level => ({
					mode: "map",
					name: `walls-${level}`,
					level,
					pxpersquare: 8,
					wallsonly: true
				} as LayerConfig)),
				// ...allfloors({
				// 	mode: "height",
				// 	name: "height",
				// 	level: 0,
				// 	pxpersquare: 1,
				// }, false)
			]
		});

		config.makedirs();
		let progress = new ProgressUI(areas);

		document.body.appendChild(progress.root);


		await downloadMap(filesource, areas, mask, config, progress);
		await generateMips(config, progress);
		console.log("done");
	}
});

let url = new URL(document.location.href);
let argvbase64 = url.searchParams.get("argv");
let currentdir = url.searchParams.get("cwd");
if (currentdir) {
	process.chdir(atob(currentdir));
}
if (argvbase64) {
	let argv = JSON.parse(atob(argvbase64));
	cmdts.run(cmd, cliArguments(argv));
}

type MaprenderSquare = { prom: Promise<ChunkResult>, x: number, z: number, id: number, used: boolean };

type ChunkResult = { chunks: ChunkData[], grid: TileGrid, model: Object3D, modeldata: ChunkModelData[]; };

export class MapRenderer {
	renderer: ThreeJsRenderer;
	maxunused = 6;
	idcounter = 1;
	squares: MaprenderSquare[] = [];
	chunksource: (x: number, z: number) => Promise<ChunkResult>;
	constructor(cnv: HTMLCanvasElement, filesource: CacheFileSource, chunksource: (x: number, z: number) => Promise<ChunkResult>) {
		this.renderer = new ThreeJsRenderer(cnv, { alpha: false }, () => { }, filesource);
		this.renderer.renderer.setClearColor(new THREE.Color(0, 0, 0), 255);
		this.renderer.scene.background = new THREE.Color(0, 0, 0);
		this.chunksource = chunksource;
		cnv.addEventListener("webglcontextlost", async () => {
			let isrestored = await Promise.race([
				new Promise(d => setTimeout(() => d(false), 10 * 1000)),
				new Promise(d => cnv.addEventListener("webglcontextrestored", () => d(true), { once: true }))
			]);
			console.log(`context restore detection ${isrestored ? "restored before trigger" : "triggered and focusing window"}`);
			if (!isrestored) {
				electron.remote.getCurrentWebContents().focus();
			}
		});
	}

	getChunk(x: number, z: number) {
		let existing = this.squares.find(q => q.x == x && q.z == z);
		if (existing) {
			return existing;
		} else {
			let square: MaprenderSquare = {
				x: x,
				z: z,
				prom: this.chunksource(x, z),
				id: this.idcounter++,
				used: false
			}
			this.squares.push(square)
			return square;
		}
	}

	async setArea(x: number, z: number, width: number, length: number) {
		let load: MaprenderSquare[] = [];
		for (let dz = 0; dz < length; dz++) {
			for (let dx = 0; dx < width; dx++) {
				load.push(this.getChunk(x + dx, z + dz))
			}
		}
		let squares = await Promise.all(load.map(q => q.prom));
		let combined = new THREE.Group();
		combined.scale.setScalar(1 / 512);
		squares.forEach(model => {
			if (model) { combined.add(model.model); }
		});
		if (this.renderer.modelnode) { this.renderer.scene.remove(this.renderer.modelnode); }
		this.renderer.modelnode = combined;
		this.renderer.scene.add(combined);
		let obsolete = this.squares.filter(square => !load.includes(square));
		obsolete.sort((a, b) => b.id - a.id);
		let removed = obsolete.slice(this.maxunused);
		// removed.forEach(q => console.log("removing", q.x, q.z));
		removed.forEach(r => r.prom.then(q => disposeThreeTree(q.model)));
		this.squares = this.squares.filter(sq => !removed.includes(sq));
	}
}

function disposeThreeTree(node: THREE.Object3D | null) {
	if (!node) { return; }

	const cleanMaterial = material => {
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
	(node as any).traverse(object => {
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

export function subtractbackground(overlay: Uint8Array, background: Uint8Array) {
	for (let i = 0; i < overlay.length; i += 4) {
		let d = Math.abs(overlay[i + 0] - background[i + 0])
			+ Math.abs(overlay[i + 1] - background[i + 1])
			+ Math.abs(overlay[i + 2] - background[i + 2])
			+ Math.abs(overlay[i + 3] - background[i + 3])
		if (d < 5) {
			overlay[i + 0] = 0;
			overlay[i + 1] = 0;
			overlay[i + 2] = 0;
			overlay[i + 3] = 0;
		}
	}
}

export function isImageEqual(overlay: FlatImageData, background: FlatImageData, x1 = 0, y1 = 0, width = overlay.width, height = overlay.height) {
	if (overlay.width != background.width || overlay.height != background.height) {
		throw new Error("only equal sized images supported");
	}
	let adata = overlay.data;
	let bdata = background.data;

	let x2 = x1 + width;
	let y2 = y1 + height;

	let stride = 4 * overlay.width;
	for (let yy = y1; yy < y2; yy++) {
		for (let xx = x1; xx < x2; xx++) {
			let i = xx * 4 + yy * stride;
			let d = Math.abs(adata[i + 0] - bdata[i + 0])
				+ Math.abs(adata[i + 1] - bdata[i + 1])
				+ Math.abs(adata[i + 2] - bdata[i + 2])
				+ Math.abs(adata[i + 3] - bdata[i + 3])
			if (d >= 5) { return false; }
		}
	}
	return true;
}

export function isImageEmpty(img: FlatImageData, mode: "black" | "transparent", x1 = 0, y1 = 0, width = img.width, height = img.height) {
	let intview = new Uint32Array(img.data.buffer, img.data.byteOffset, img.data.byteLength / 4);
	let mask = (mode == "black" ? 0xffffffff : 0xff);
	let target = 0;

	let x2 = x1 + width;
	let y2 = y1 + height;
	let stride = img.width;
	for (let yy = y1; yy < y2; yy++) {
		for (let xx = x1; xx < x2; xx++) {
			let i = xx + yy * stride;
			if ((intview[i] & mask) != target) {
				return false;
			}
		}
	}
	return true;
}

export async function downloadMap(filesource: CacheFileSource, rects: MapRect[], mask: MapRect[] | undefined, config: MapRender, progress: ProgressUI) {
	let cnv = document.createElement("canvas");
	let extraopts: ParsemapOpts = { mask };
	let chunksource = (x: number, z: number) => downloadMapsquareThree(filesource, extraopts, x, z);
	let maprender = new MapRenderer(cnv, filesource, chunksource);

	let errs: Error[] = [];
	const zscan = 4;
	const maxretries = 1;
	for (let rect of rects) {
		for (let z = rect.z; z < rect.z + rect.zsize; z += zscan) {
			for (let x = rect.x; x < rect.x + rect.xsize; x++) {
				for (let retry = 0; retry <= maxretries; retry++) {
					try {
						let zsize = Math.min(zscan, rect.z + rect.zsize - z);
						await renderMapsquare(filesource, { x, z, xsize: 1, zsize }, extraopts, config, maprender, progress);
						break;
					} catch (e) {
						let cnv = document.createElement("canvas");
						maprender = new MapRenderer(cnv, filesource, chunksource);
						console.warn(e);
						errs.push(e);
					}
				}
			}
		}
	}
	console.log(errs);
}

export async function downloadMapsquareThree(filesource: CacheFileSource, extraopts: ParsemapOpts, x: number, z: number) {
	console.log(`generating mapsquare ${x} ${z}`);
	let opts: ParsemapOpts = { centered: false, padfloor: true, invisibleLayers: false, ...extraopts };
	let { chunks, grid } = await parseMapsquare(filesource, { x, z, xsize: 1, zsize: 1 }, opts);
	let modeldata = await mapsquareModels(filesource, grid, chunks, opts);
	let file = await mapsquareToThree(filesource, grid, modeldata);
	console.log(`completed mapsquare ${x} ${z}`);
	return { grid, chunks, model: file, modeldata };
}

export async function renderMapsquare(filesource: CacheFileSource, subrect: MapRect, extraopts: ParsemapOpts, config: MapRender, renderer: MapRenderer, progress: ProgressUI) {
	let takepicture = async (cnf: LayerConfig & { mode: "3d" }, rect: MapRect) => {
		for (let retry = 0; retry <= 2; retry++) {
			let img = await renderer!.renderer.takePicture(rect.x, rect.z, rect.xsize, cnf.pxpersquare, cnf.dxdy, cnf.dzdy);
			//need to check this after the image because it can be lost during the image and three wont know
			//TODO this shouldn't be needed anymore since guaranteeframe handles it
			if (renderer!.renderer.renderer.getContext().isContextLost()) {
				console.log("image failed retrying", rect.x, rect.z);
				continue;
			}
			return img;
		}
		throw new Error("failed to take picture");
	}
	let setfloors = (floornr: number) => {
		for (let i = 0; i < 4; i++) {
			renderer!.renderer.setValue("floor" + i, i <= floornr);
			renderer!.renderer.setValue("objects" + i, i <= floornr);
			renderer!.renderer.setValue("map" + i, false);
			renderer!.renderer.setValue("mapscenes" + i, false);
			renderer!.renderer.setValue("walls" + i, false);
		}
	}

	let nimages = 0;
	let grouptasks: Promise<any>[] = [];
	for (let dz = 0; dz < subrect.zsize; dz++) {
		for (let dx = 0; dx < subrect.xsize; dx++) {
			let x = subrect.x + dx;
			let z = subrect.z + dz;
			let metafilename = config.metapath(x, z);
			if (!config.overwrite && fs.existsSync(metafilename)) {
				progress.update(x, z, "sliced"); continue;
			}

			let meta = {};
			let imgs: Record<string, any> = {};
			progress.update(x, z, "rendering");

			let imgfiles = 0;
			let tiletasks: Promise<any>[] = [];
			for (let cnf of config.layers) {
				let squares = 1;//cnf.mapsquares ?? 1;//TODO remove or reimplement
				if (x % squares != 0 || z % squares != 0) { continue; }
				let area: MapRect = { x: x * 64 - 16, z: z * 64 - 16, xsize: 64 * squares, zsize: 64 * squares };

				if (cnf.mode == "3d") {
					await renderer.setArea(x - 1, z - 1, 2, 2);
					setfloors(cnf.level);
					let img = await takepicture(cnf, area);

					imgs[cnf.name] = img;
					let tasks = saveSlices(config, cnf, x, z, img, cnf.subtractlayer && imgs[cnf.subtractlayer]);
					let savetask = trickleTasks("", 4, tasks);
					tiletasks.push(savetask)
					grouptasks.push(savetask);
					imgfiles += tasks.length;
				}
				if (cnf.mode == "map") {
					//TODO somehow dedupe this with massive memory cost?
					//TODO this ignores mask
					let { grid, chunks } = await parseMapsquare(filesource, { x: x - 1, z: z - 1, xsize: squares + 1, zsize: squares + 1 }, extraopts);
					let svg = await svgfloor(filesource, grid, chunks.flatMap(q => q.locs), area, cnf.level, cnf.pxpersquare, cnf.wallsonly);
					let zooms = config.getLayerZooms(cnf);
					fs.writeFileSync(config.outpath(cnf.name, zooms.base, x, config.config.mapsizez - z - 1, "svg"), svg);
					imgfiles++;
				}
			}

			//move this inside the generator logic?
			let { grid } = await renderer.getChunk(x, z).prom;
			for (let level = 0; level < 4; level++) {
				fs.writeFileSync(`${config.basedir}/height/${x}-${z}-${level}.bin`, grid.getHeightFile(x * 64, z * 64, level, 64, 64));
			}

			fs.writeFileSync(metafilename, JSON.stringify(meta, undefined, 2));

			console.log("imaged", x, z, "files", imgfiles);
			progress.update(x, z, "imaged");
			Promise.all(tiletasks).then(() => progress.update(x, z, "sliced"));
			nimages++;
			break;
		}
	}
	await Promise.all(grouptasks);
	return nimages;
}

function saveSlices(config: MapRender, layercnf: LayerConfig, chunkx: number, chunkz: number, img: FlatImageData, subtract: FlatImageData | undefined) {
	let tilex = chunkx;
	let tiley = config.config.mapsizez - chunkz - 1;//(layercnf.mapsquares ?? 1);

	let basemultiplier = 1 / 1;//(layercnf.mapsquares ?? 1);

	let inputsize = layercnf.pxpersquare * 64;//* (layercnf.mapsquares ?? 1);
	let zooms = config.getLayerZooms(layercnf);
	let tasks: any[] = [];
	for (let zoom = zooms.base; zoom <= zooms.max; zoom++) {
		let size = inputsize >> (zoom - zooms.base);
		let muliplier = basemultiplier * (1 << (zoom - zooms.base));
		for (let suby = 0; suby * size < inputsize; suby++) {
			for (let subx = 0; subx * size < inputsize; subx++) {
				let x = subx * size;
				//weird y offset because the image is flipped
				let y = inputsize - size - suby * size;
				if (subtract && isImageEqual(img, subtract, x, y, size, size)) {
					continue;
				}

				tasks.push(() => {
					let raster = sharp(img.data, { raw: img })
						.extract({ left: x, top: y, width: size, height: size })
						.flip()
						.resize(config.config.tileimgsize, config.config.tileimgsize, { kernel: "mitchell" })
						.withMetadata({
							exif: {
								IFD0: {
									Copyright: 'RuneApps'
								}
							}
						})
					if (zoom == zooms.max) {
						raster = raster.composite([{ gravity: "center", input: watermarkfile }])
					}
					return raster
						.webp({ quality: 90 })
						.toFile(config.outpath(layercnf.name, zoom, tilex * muliplier + subx, tiley * muliplier + suby))
				});
			}
		}
	}
	return tasks;
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

export async function generateMips(config: MapRender, progress: ProgressUI) {
	fs.mkdirSync(`${config.basedir}`, { recursive: true });
	let skiptime = 0;
	try {
		// let meta = fs.statSync(`${config.basedir}/info.json`);
		// skiptime = +meta.mtime;
	} catch (e) {
		console.log("no meta file")
	}

	fs.writeFileSync(`${config.basedir}/info.json`, JSON.stringify(config.config, undefined, "\t"));

	let files = fs.readdirSync(`${config.basedir}/meta`);
	let chunks: { x: number, z: number }[] = [];
	for (let file of files) {
		// if (!config.overwrite) {
		let stat = fs.statSync(`${config.basedir}/meta/${file}`);
		if (+stat.mtime < skiptime) { continue; }
		// }
		let m = file.match(/(\/|^)(\d+)-(\d+)\./);
		if (!m) {
			console.log("unexpected file in src dir " + file);
			continue;
		}
		chunks.push({ x: +m[2], z: +m[3] })
	}
	console.log(chunks);
	fs.mkdirSync(`${config.basedir}/height`, { recursive: true });
	for (let chunk of chunks) {
		for (let level = 0; level < 4; level++) {
			fs.copyFileSync(`${config.basedir}/height/${chunk.x}-${chunk.z}-${level}.bin`, `${config.basedir}/height/${chunk.x}-${chunk.z}-${level}.bin`);
		}
	}


	for (let layercnf of config.layers) {
		let zooms = config.getLayerZooms(layercnf);
		let basequeue = new Set<string>();
		chunks.forEach(q => {
			let mult = 0.5;
			basequeue.add(`${Math.floor(q.x * mult)}:${Math.floor((config.config.mapsizez - q.z - 1) * mult)}`);
		});
		let queue = basequeue;
		for (let zoom = zooms.base - 1; zoom >= zooms.min; zoom--) {
			let currentqueue = queue;
			queue = new Set();
			let tasks: (() => Promise<any>)[] = [];
			for (let chunk of currentqueue) {
				let m = chunk.match(/(\d+):(\d+)/)!;
				let x = +m[1];
				let y = +m[2];
				let outfile = config.outpath(layercnf.name, zoom, x, y);

				let overlays: sharp.OverlayOptions[] = [];
				let noriginal = 0;
				for (let dy = 0; dy <= 1; dy++) {
					for (let dx = 0; dx <= 1; dx++) {
						let opts = [
							config.outpath(layercnf.name, zoom + 1, x * 2 + dx, y * 2 + dy),
							config.outpath(layercnf.name, zoom + 1, x * 2 + dx, y * 2 + dy, "svg"),
						];
						if (layercnf.subtractlayer) {
							opts.push(
								config.outpath(layercnf.subtractlayer, zoom + 1, x * 2 + dx, y * 2 + dy),
								config.outpath(layercnf.subtractlayer, zoom + 1, x * 2 + dx, y * 2 + dy, "svg"),
							)
						}
						let fileindex = opts.findIndex(q => fs.existsSync(q));
						if (fileindex < 2) { noriginal++; }
						if (fileindex != -1) {
							let file = opts[fileindex];
							overlays.push({ blend: "over", input: file, gravity: `${dy == 0 ? "north" : "south"}${dx == 0 ? "west" : "east"}` });
						}
					}
				}

				if (overlays.length != 0 && noriginal != 0) {
					queue.add(`${x / 2 | 0}:${y / 2 | 0}`);
					if (!fs.existsSync(outfile) || config.overwrite) {
						let cominedsize = config.config.tileimgsize * 2;
						tasks.push(
							() => sharp({ create: { channels: 4, width: cominedsize, height: cominedsize, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
								.composite(overlays)
								.raw()
								.toBuffer({ resolveWithObject: true })//need to render to force resize after composite
								.then(combined =>
									sharp(combined.data, { raw: combined.info })
										.resize(config.config.tileimgsize, config.config.tileimgsize, { kernel: "mitchell" })
										.webp({ quality: 90 })
										.toFile(outfile)
								)
						);
					}
				}
			}
			await trickleTasks(`zoomed mipmaps layer ${layercnf.name} level ${zoom}`, 4, tasks);
		}
	}
}
