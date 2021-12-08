
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

window.addEventListener("keydown", e => {
	if (e.key == "F5") { document.location.reload(); }
	if (e.key == "F12") { electron.remote.getCurrentWebContents().toggleDevTools(); }
});

//can't use module import syntax because es6 wants to be more es6 than es6
const THREE = require("three/build/three.js") as typeof import("three");

type Mapconfig = {
	basedir: string,
	rawdir: string,
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
	level: number,
	mapsquares?: number,
	subtractlayer?: string
} & ({
	mode: "3d",
	dxdy: number,
	dzdy: number,
	walls?: boolean
} | {
	mode: "map"
});

let cmd = cmdts.command({
	name: "download",
	args: {
		...filesource,
		...mapareasourceoptional,
		overwrite: cmdts.flag({ long: "force", short: "f" }),
		save: cmdts.option({ long: "save", short: "s", type: cmdts.string, defaultValue: () => "cache/map" }),
	},
	handler: async (args) => {
		const tileimgsize = 512;

		const mapsizez = 200;
		const mapsizex = 100;

		let area = args.area ?? { x: 0, y: 0, width: 100, height: 200 };
		let config: Mapconfig = {
			basedir: path.resolve(args.save),
			rawdir: path.resolve(`${args.save}/raw`),
			tileimgsize,
			mapsizex,
			mapsizez,
			overwrite: args.overwrite,
			layers: [{
				mode: "3d",
				name: "topdown",
				dxdy: 0, dzdy: 0,
				level: 3,
				pxpersquare: 16,
				walls: true
			}, {
				mode: "3d",
				name: "level-0",
				dxdy: 0.15, dzdy: 0.5,
				level: 0,
				pxpersquare: 32,
			}, {
				mode: "3d",
				name: "level-1",
				dxdy: 0.15, dzdy: 0.5,
				pxpersquare: 32,
				level: 1,
				subtractlayer: "level-0"
			}, {
				mode: "3d",
				name: "level-2",
				dxdy: 0.15, dzdy: 0.5,
				pxpersquare: 32,
				level: 2,
				subtractlayer: "level-0"
			}, {
				mode: "3d",
				name: "level-3",
				dxdy: 0.15, dzdy: 0.5,
				pxpersquare: 32,
				level: 3,
				subtractlayer: "level-0"
			}, {
				mode: "map",
				name: "map",
				level: 0,
				pxpersquare: 4,
				mapsquares: 2
			}]
		};
		let filesource = await args.source();

		downloadMap(filesource, area, config);
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
		this.renderer = new ThreeJsRenderer(cnv, () => { }, filesource);
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

export function isImageEmpty(pixels: Uint8Array, mode: "black" | "transparent") {
	let intview = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4);
	let mask = (mode == "black" ? 0xffffffff : 0xff);
	let target = 0;
	for (let i = 0; i < intview.length; i++) {
		if ((intview[i] & mask) != target) {
			return false;
		}
	}
	return true;
}

export async function downloadMap(filesource: CacheFileSource, rect: Rect, config: Mapconfig) {
	let cnv = document.createElement("canvas");
	let chunksource = (x: number, z: number) => downloadMapsquareThree(filesource, x, z);
	let maprender = new MapRenderer(cnv, filesource, chunksource);
	fs.mkdirSync(`${config.rawdir}/meta`, { recursive: true });
	fs.mkdirSync(`${config.rawdir}/height`, { recursive: true });
	for (let layer of config.layers) {
		fs.mkdirSync(`${config.rawdir}/${layer.name}`, { recursive: true });
	};

	let errs: Error[] = [];
	const zscan = 4;
	const maxretries = 1;
	let progress = 0;
	for (let z = rect.y; z < rect.y + rect.height; z += zscan) {
		for (let x = rect.x; x < rect.x + rect.width; x++) {
			for (let retry = 0; retry <= maxretries; retry++) {
				try {
					let zsize = Math.min(zscan, rect.y + rect.height - z);
					progress += await renderMapsquare(filesource, { x, z, xsize: 1, zsize }, config, maprender);
					// if (progress >= 16) {
					// 	progress = 0;
					// 	generateMips();
					// }
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
	await generateMips(config);
	console.log(errs);
}

export async function downloadMapsquareThree(filesource: CacheFileSource, x: number, z: number) {
	console.log(`generating mapsquare ${x} ${z}`);
	let opts: ParsemapOpts = { centered: false, padfloor: true, invisibleLayers: false };
	let { chunks, grid } = await parseMapsquare(filesource, { x, z, xsize: 1, zsize: 1 }, opts);
	let modeldata = await mapsquareModels(filesource, grid, chunks, opts);
	let file = await mapsquareToThree(filesource, grid, modeldata);
	console.log(`completed mapsquare ${x} ${z}`);
	return { grid, chunks, model: file, modeldata };
}

export async function renderMapsquare(filesource: CacheFileSource, subrect: MapRect, config: Mapconfig, renderer: MapRenderer) {
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
		}
	}

	let nimages = 0;
	for (let dz = 0; dz < subrect.zsize; dz++) {
		for (let dx = 0; dx < subrect.xsize; dx++) {
			let x = subrect.x + dx;
			let z = subrect.z + dz;
			let metafilename = `${config.rawdir}/meta/${x}-${z}.json`;
			if (!config.overwrite && fs.existsSync(metafilename)) { continue; }

			//move this inside the generator logic?
			let { grid } = await renderer.getChunk(x, z).prom;
			for (let level = 0; level < 4; level++) {
				fs.writeFileSync(`${config.rawdir}/height/${x}-${z}-${level}.bin`, grid.getHeightFile(x * 64, z * 64, level, 64, 64));
			}

			let meta = {};
			let imgs: Record<string, any> = {};

			let imgfiles = 0;
			for (let cnf of config.layers) {
				let squares = cnf.mapsquares ?? 1;
				if (x % squares != 0 || z % squares != 0) { continue; }
				let area: MapRect = { x: x * 64 - 16, z: z * 64 - 16, xsize: 64 * squares, zsize: 64 * squares };

				if (cnf.mode == "3d") {
					await renderer.setArea(x - 1, z - 1, 2, 2);
					setfloors(cnf.level);
					let img = await takepicture(cnf, area);

					if (cnf.subtractlayer) {
						subtractbackground(img.data, imgs[cnf.subtractlayer].data);
					}

					imgs[cnf.name] = img;
					if (!isImageEmpty(img.data, "transparent")) {
						await sharp(img.data, { raw: img })
							.flip()
							.webp({ lossless: true })
							.toFile(`${config.rawdir}/${cnf.name}/${x}-${z}.png`);
						imgfiles++;
					}
				}
				if (cnf.mode == "map") {
					//TODO somehow dedupe this with massive memory cost?
					let { grid, chunks } = await parseMapsquare(filesource, { x: x - 1, z: z - 1, xsize: squares + 1, zsize: squares + 1 }, {});
					let svg = await svgfloor(filesource, grid, chunks.flatMap(q => q.locs), area, cnf.level);
					fs.writeFileSync(`${config.rawdir}/${cnf.name}/${x}-${z}.svg`, svg);
				}
			}
			fs.writeFileSync(metafilename, JSON.stringify(meta, undefined, 2));

			console.log("imaged", x, z, "files", imgfiles);
			nimages++;
			break;
		}
	}
	return nimages;
}

function trickleTasks(name: string, parallel: number, tasks: (() => Promise<any>)[]) {
	console.log(`starting ${name}, ${tasks.length} tasks`);
	return new Promise<void>(done => {
		let index = 0;
		let running = 0;
		let run = () => {
			if (index < tasks.length) {
				tasks[index++]().finally(run);
				if (index % 100 == 0) { console.log(`${name} progress ${index}/${tasks.length}`); }
			} else {
				running--;
				if (running <= 0) {
					console.log(`completed ${name}`);
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

export async function generateMips(config: Mapconfig) {
	fs.mkdirSync(`${config.basedir}`, { recursive: true });
	let skiptime = 0;
	try {
		// let meta = fs.statSync(`${config.basedir}/info.json`);
		// skiptime = +meta.mtime;
	} catch (e) {
		console.log("no meta file")
	}

	fs.writeFileSync(`${config.basedir}/info.json`, JSON.stringify(config, undefined, "\t"));

	let files = fs.readdirSync(`${config.rawdir}/meta`);
	let chunks: { x: number, z: number }[] = [];
	for (let file of files) {
		// if (!config.overwrite) {
		let stat = fs.statSync(`${config.rawdir}/meta/${file}`);
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
			fs.copyFileSync(`${config.rawdir}/height/${chunk.x}-${chunk.z}-${level}.bin`, `${config.basedir}/height/${chunk.x}-${chunk.z}-${level}.bin`);
		}
	}

	console.log("starting with x files", files.length);
	for (let layercnf of config.layers) {
		if (layercnf.name != "map") { continue }//TODO remove


		const minzoom = Math.floor(Math.log2(config.tileimgsize / (Math.max(config.mapsizex, config.mapsizez) * 64)));
		const maxzoom = Math.log2(layercnf.pxpersquare * (layercnf.mapsquares ?? 1));
		const basezoom = Math.log2(config.tileimgsize / 64);

		const outzoom = (zoom: number) => `${config.basedir}/${layercnf.name}/${zoom}`;
		const outpath = (zoom: number, x: number, y: number) => `${outzoom(zoom)}/${x}-${y}.png`;

		for (let zoom = minzoom; zoom <= maxzoom; zoom++) {
			fs.mkdirSync(outzoom(zoom), { recursive: true });
		}
		let basequeue = new Set<string>();
		let tasks: (() => Promise<any>)[] = [];
		for (let chunk of chunks) {
			let tilex = chunk.x;
			let tiley = config.mapsizez - chunk.z;
			let filename = `${config.rawdir}/${layercnf.name}/${chunk.x}-${chunk.z}.${layercnf.mode == "map" ? "svg" : "png"}`;

			if (!fs.existsSync(filename)) { continue; }
			basequeue.add(`${tilex / 2 | 0}:${tiley / 2 | 0}`);

			//slice it up to smaller one and do first mips without quality loss
			let inputsize = layercnf.pxpersquare * (layercnf.mapsquares ?? 1) * 64;
			for (let zoom = 0; (inputsize >> zoom) >= config.tileimgsize; zoom++) {
				let size = inputsize >> zoom;
				let muliplier = 1 << zoom;
				for (let suby = 0; suby * size < inputsize; suby++) {
					for (let subx = 0; subx * size < inputsize; subx++) {
						if (zoom == 0 && layercnf.mode == "map") {
							//don't re-encode svg
							tasks.push(() =>
								fs.promises.copyFile(filename, outpath(zoom + basezoom, tilex * muliplier + subx, tiley * muliplier + suby))
							);
						} else {
							tasks.push(() =>
								sharp(filename)
									.extract({ left: subx * size, top: suby * size, width: size, height: size })
									.resize(config.tileimgsize, config.tileimgsize, { kernel: "mitchell" })
									.webp({ lossless: true })
									.toFile(outpath(zoom + basezoom, tilex * muliplier + subx, tiley * muliplier + suby))
							);
						}
					}
				}
			}
		}
		await trickleTasks(`${layercnf.name} mipmaps`, 4, tasks);

		let queue = basequeue;
		for (let zoom = basezoom - 1; zoom >= minzoom; zoom--) {
			let currentqueue = queue;
			queue = new Set();
			tasks = [];
			for (let chunk of currentqueue) {
				let m = chunk.match(/(\d+):(\d+)/)!;
				let x = +m[1];
				let y = +m[2];
				queue.add(`${x / 2 | 0}:${y / 2 | 0}`);

				let path00 = outpath(zoom + 1, x * 2 + 0, y * 2 + 0);
				let path01 = outpath(zoom + 1, x * 2 + 1, y * 2 + 0);
				let path10 = outpath(zoom + 1, x * 2 + 0, y * 2 + 1);
				let path11 = outpath(zoom + 1, x * 2 + 1, y * 2 + 1);

				let overlays: sharp.OverlayOptions[] = [];
				if (fs.existsSync(path00)) { overlays.push({ blend: "over", input: path00, gravity: "northwest" }); }
				if (fs.existsSync(path01)) { overlays.push({ blend: "over", input: path01, gravity: "northeast" }); }
				if (fs.existsSync(path10)) { overlays.push({ blend: "over", input: path10, gravity: "southwest" }); }
				if (fs.existsSync(path11)) { overlays.push({ blend: "over", input: path11, gravity: "southeast" }); }

				if (overlays.length != 0) {
					tasks.push(
						() => sharp({ create: { channels: 4, width: config.tileimgsize * 2, height: config.tileimgsize * 2, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
							.composite(overlays)
							.raw()
							.toBuffer({ resolveWithObject: true })//need to render to force resize after composite
							.then(combined =>
								sharp(combined.data, { raw: combined.info })
									.resize(config.tileimgsize, config.tileimgsize, { kernel: "mitchell" })
									.webp({ lossless: true })
									.toFile(outpath(zoom, x, y))
							)
					);
				}
			}
			await trickleTasks(`zoomed mipmaps layer ${layercnf.name} level ${zoom}`, 4, tasks);
		}
	}
}
