
import { ThreeJsRenderer } from "../viewer/threejsrender";
import { mapsquareModels, mapsquareToThree, parseMapsquare, ParsemapOpts } from "../3d/mapsquare";
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import * as electron from "electron";
import { runCliApplication, cliArguments, filesource, mapareasource, mapareasourceoptional, Rect } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CacheFileSource } from "../cache";

window.addEventListener("keydown", e => {
	if (e.key == "F5") { document.location.reload(); }
	if (e.key == "F12") { electron.remote.getCurrentWebContents().toggleDevTools(); }
});

//can't use module import syntax because es6 wants to be more es6 than es6
const THREE = require("three/build/three.js") as typeof import("three");

type Mapconfig = {
	basedir: string,
	rawdir: string,
	//the capture size of one game square of 64 tiles (pxpertile=capturesize/64)
	capturesize: number,
	targetsize: number,
	mapsizex: number,
	mapsizez: number
}


let cmd = cmdts.command({
	name: "download",
	args: {
		...filesource,
		...mapareasourceoptional,
		save: cmdts.option({ long: "save", short: "s", type: cmdts.string, defaultValue: () => "cache/map" }),
	},
	handler: async (args) => {

		const targetsize = 512;
		const capturesize = 2048;

		const mapsizez = 200;
		const mapsizex = 100;

		let area = args.area ?? { x: 0, y: 0, width: 100, height: 200 };
		let config: Mapconfig = {
			basedir: path.resolve(args.save),
			rawdir: path.resolve(`${args.save}/raw`),
			capturesize,
			targetsize,
			mapsizex,
			mapsizez
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

type MaprenderSquare = { prom: Promise<THREE.Group | null>, x: number, z: number, id: number, used: boolean };

export class MapRenderer {
	renderer: ThreeJsRenderer;
	maxunused = 6;
	idcounter = 1;
	squares: MaprenderSquare[] = [];
	constructor(cnv: HTMLCanvasElement, filesource: CacheFileSource) {
		this.renderer = new ThreeJsRenderer(cnv, () => { }, filesource);
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

	async setArea(x: number, z: number, width: number, length: number, getfile: (x: number, z: number) => Promise<Uint8Array | null | THREE.Group>) {
		let load: MaprenderSquare[] = [];
		for (let dz = 0; dz < length; dz++) {
			for (let dx = 0; dx < width; dx++) {
				let existing = this.squares.find(q => q.x == x + dx && q.z == z + dz);
				if (existing) {
					load.push(existing);
				} else {
					let square: MaprenderSquare = {
						x: x + dx,
						z: z + dz,
						prom: (async () => {
							let f = await getfile(x + dx, z + dz);
							if (!f) { return null; }
							if (f instanceof THREE.Object3D) {
								//f.scale.setScalar(1 / 512);
								return f;
							}
							let model = await this.renderer.parseGltfFile(f)
							model.rootnode.scale.setScalar(1 / 512);
							return model.rootnode;
						})(),
						id: this.idcounter++,
						used: false
					}
					load.push(square);
					this.squares.push(square)
				}
			}
		}
		let squares = await Promise.all(load.map(q => q.prom));
		let combined = new THREE.Group();
		combined.scale.setScalar(1 / 512);
		squares.forEach(model => {
			if (model) { combined.add(model); }
		});
		if (this.renderer.modelnode) { this.renderer.scene.remove(this.renderer.modelnode); }
		this.renderer.modelnode = combined;
		this.renderer.scene.add(combined);
		let obsolete = this.squares.filter(square => !load.includes(square));
		obsolete.sort((a, b) => b.id - a.id);
		let removed = obsolete.slice(this.maxunused);
		// removed.forEach(q => console.log("removing", q.x, q.z));
		removed.forEach(r => r.prom.then(disposeThreeTree));
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

export async function downloadMap(filesource: CacheFileSource, rect: Rect, config: Mapconfig) {
	let cnv = document.createElement("canvas");
	let maprender = new MapRenderer(cnv, filesource);
	fs.mkdirSync(config.rawdir, { recursive: true });

	let errs: Error[] = [];
	const zscan = 4;
	const maxretries = 1;
	let progress = 0;
	for (let z = rect.y; z < rect.y + rect.height; z += zscan) {
		for (let x = rect.x; x < rect.x + rect.width; x++) {
			for (let retry = 0; retry <= maxretries; retry++) {
				try {
					let zsize = Math.min(zscan, rect.y + rect.height - z);
					progress += await renderMapsquare(filesource, { x, y: z, width: 1, height: zsize }, config, maprender);
					// if (progress >= 16) {
					// 	progress = 0;
					// 	generateMips();
					// }
					break;
				} catch (e) {
					let cnv = document.createElement("canvas");
					maprender = new MapRenderer(cnv, filesource);
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
	let { chunks, grid } = await parseMapsquare(filesource, { x, y: z, width: 1, height: 1 }, opts);
	let modeldata = await mapsquareModels(filesource, grid, chunks, opts);
	let file = await mapsquareToThree(filesource, modeldata);
	console.log(`completed mapsquare ${x} ${z}`);
	return file;
}

export async function renderMapsquare(filesource: CacheFileSource, subrect: Rect, config: Mapconfig, renderer?: MapRenderer) {
	if (!renderer) {
		let cnv = document.createElement("canvas");
		renderer = new MapRenderer(cnv, filesource);
	}
	let loadsquaremodel = async (x: number, z: number) => {
		return downloadMapsquareThree(filesource, x, z);
	}

	let nimages = 0;
	for (let dz = 0; dz < subrect.height; dz++) {
		for (let dx = 0; dx < subrect.width; dx++) {
			let x = subrect.x + dx;
			let z = subrect.y + dz;
			let filename = `${config.rawdir}/${x}-${z}.png`;
			if (fs.existsSync(filename)) { continue; }
			await renderer.setArea(x - 1, z - 1, 2, 2, loadsquaremodel);
			for (let retry = 0; retry <= 2; retry++) {
				let img = await renderer.renderer.takePicture(x * 64 - 16, z * 64 - 16, 64, config.capturesize);
				//need to check this after the image because it can be lost during the image and three wont know
				//TODO this shouldn't be needed anymore since guaranteeframe handles it
				if (renderer.renderer.renderer.getContext().isContextLost()) {
					console.log("image failed retrying", x, z);
					continue;
				}
				console.log("imaged", x, z);
				fs.writeFileSync(filename, img);
				nimages++;
				break;
			}
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
	const minzoom = Math.floor(Math.log2(config.targetsize / (Math.max(config.mapsizex, config.mapsizez) * 64)));
	const maxzoom = Math.log2(config.capturesize / 64);
	const basezoom = Math.log2(config.targetsize / 64);

	const outzoom = (zoom: number) => `${config.basedir}/${zoom}`;
	const outpath = (zoom: number, x: number, y: number) => `${outzoom(zoom)}/${x}-${y}.png`;

	let skiptime = 0;
	try {
		let meta = fs.statSync(`${config.basedir}/info.json`);
		skiptime = +meta.mtime;
	} catch (e) {
		console.log("no meta file")
	}

	fs.writeFileSync(`${config.basedir}/info.json`, JSON.stringify(config, undefined, "\t"));

	let files = fs.readdirSync(config.rawdir)
		.filter(file => {
			let stat = fs.statSync(`${config.rawdir}/${file}`);
			return +stat.mtime >= skiptime;
		}).map(file => `${config.rawdir}/${file}`)


	let queue = new Set<string>();

	for (let zoom = minzoom; zoom <= maxzoom; zoom++) {
		fs.mkdirSync(outzoom(zoom), { recursive: true });
	}

	console.log("starting with x files", files.length);
	let tasks: (() => Promise<any>)[] = [];
	for (let file of files) {
		let m = file.match(/(\/|^)(\d+)-(\d+)\./);
		if (!m) {
			console.log("unexpected file in src dir " + file);
			continue;
		}
		let chunkx = +m[2];
		let chunkz = +m[3];
		let tilex = chunkx;
		let tiley = config.mapsizez - chunkz;

		queue.add(`${tilex / 2 | 0}:${tiley / 2 | 0}`);

		//slice it up to smaller one and do first mips without quality loss
		for (let zoom = 0; (config.capturesize >> zoom) >= config.targetsize; zoom++) {
			let size = config.capturesize >> zoom;
			let muliplier = 1 << zoom;
			for (let suby = 0; suby * size < config.capturesize; suby++) {
				for (let subx = 0; subx * size < config.capturesize; subx++) {
					tasks.push(() =>
						sharp(file)
							.extract({ left: subx * size, top: suby * size, width: size, height: size })
							.resize(config.targetsize, config.targetsize)
							.webp({ lossless: true })
							.toFile(outpath(zoom + basezoom, tilex * muliplier + subx, tiley * muliplier + suby))
					);
				}
			}
		}
	}
	await trickleTasks("sub image mipmaps", 4, tasks);

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


			tasks.push(
				() => sharp({ create: { channels: 4, width: config.targetsize * 2, height: config.targetsize * 2, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
					.composite(overlays)
					.raw()
					.toBuffer({ resolveWithObject: true })//need to render to force resize after composite
					.then(combined =>
						sharp(combined.data, { raw: combined.info })
							.resize(config.targetsize, config.targetsize)
							.webp({ lossless: true })
							.toFile(outpath(zoom, x, y))
					)
			);
		}

		await trickleTasks(`zoomed mipmaps level ${zoom}`, 4, tasks);
	}
}
