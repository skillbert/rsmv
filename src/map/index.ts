
import { GltfRenderer } from "../viewer/gltfrender";
import { mapsquareToGltf } from "../3d/mapsquare";
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { GameCacheLoader } from "../cacheloader";

const hackyCacheFileSource = new GameCacheLoader(path.resolve(process.env.ProgramData!, "jagex/runescape"));


type MaprenderSquare = { prom: Promise<THREE.Group | null>, x: number, z: number, id: number, used: boolean };

export class MapRenderer {
	renderer: GltfRenderer;
	maxunused = 6;
	idcounter = 1;
	squares: MaprenderSquare[] = [];
	constructor(cnv: HTMLCanvasElement) {
		this.renderer = new GltfRenderer(cnv, () => { });
	}

	//TODO move to util file
	// disposeObject3d(node:Object3D){
	// 	node.traverse((obj:BufferGeometry)=>{
	// 		if(obj.material)
	// 	})
	// }

	async setArea(x: number, z: number, width: number, length: number, getfile: (x: number, z: number) => Promise<Uint8Array | null>) {
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
		squares.forEach(model => {
			if (model) {
				this.renderer.scene.add(model);
				model.updateMatrix();
				model.matrixWorldNeedsUpdate = true;
			}
		});
		let obsolete = this.squares.filter(square => !load.includes(square));
		for (let obs of obsolete) {
			let model = await obs.prom;
			if (model) {
				this.renderer.scene.remove(model);
			}
		}
		obsolete.sort((a, b) => a.id - b.id);
		let removed = obsolete.slice(this.maxunused);
		// removed.forEach(q => console.log("removing", q.x, q.z));
		this.squares = this.squares.filter(sq => !removed.includes(sq));
	}
}

export async function downloadMap(x0 = 0, z0 = 0) {
	let cnv = document.createElement("canvas");
	let maprender = new MapRenderer(cnv);
	let errs: Error[] = [];
	const zscan = 4;
	const maxretries = 0;
	let progress = 0;
	for (let z = z0; z < 200; z += zscan) {
		for (let x = (z == z0 ? x0 : 0); x < 100; x++) {
			for (let retry = 0; retry <= maxretries; retry++) {
				try {
					await renderMapsquare(x, z, 1, zscan, maprender);
					progress += 4;
					if (progress % 16 == 0) {
						generateMips();
					}
					break;
				} catch (e) {
					let cnv = document.createElement("canvas");
					maprender = new MapRenderer(cnv);
					console.warn(e);
					errs.push(e);
				}
			}
		}
	}
	console.log(errs);
}

export async function downloadMapsquare(x: number, z: number) {
	console.log(`generating mapsquare ${x} ${z}`);
	let file = await mapsquareToGltf(hackyCacheFileSource, { x, y: z, width: 1, height: 1 }, { centered: false, padfloor: true });
	console.log(`completed mapsquare ${x} ${z}`);
	return file;
}

export async function renderMapsquare(x: number, z: number, bundlex: number, bundlez: number, renderer?: MapRenderer | undefined) {
	if (!renderer) {
		let cnv = document.createElement("canvas");
		renderer = new MapRenderer(cnv);
	}
	let loadsquaremodel = async (x: number, z: number) => {
		let filename = `cache/mapchunks/${x}-${z}.glb`;
		if (!fs.existsSync(filename)) {
			// console.log("generating", x, z);
			let file = await downloadMapsquare(x, z);
			fs.writeFileSync(filename, file);
			return file;
		}
		try {
			// console.log("loading", x, z);
			return fs.readFileSync(filename);
		} catch (e) {
			console.log("nulled", x, z);
			return null;
		}
	}

	for (let dz = 0; dz < bundlez; dz++) {
		for (let dx = 0; dx < bundlex; dx++) {
			let filename = `cache/mapchunkimgs2/${x + dx}-${z + dz}.png`;
			if (fs.existsSync(filename)) { continue; }
			await renderer.setArea(x + dx - 1, z + dz - 1, 2, 2, loadsquaremodel);
			for (let retry = 0; retry <= 2; retry++) {
				let img = await renderer.renderer.takePicture((x + dx) * 64 - 32, (z + dz) * 64 - 32, 64, 2048);
				//need to check this after the image because it can be lost during the image and three wont know
				if (renderer.renderer.renderer.getContext().isContextLost()) {
					console.log("image failed retrying", x + dx, z + dz);
					continue;
				}
				console.log("imaged", x + dx, z + dz);
				fs.writeFileSync(filename, img);
				break;
			}
		}
	}
}

export async function generateMips() {
	const targetsize = 512;
	const inputsize = 2048;

	const mapsizez = 200;
	const mapsizex = 100;
	const defaultzoom = Math.ceil(Math.log2(Math.max(mapsizex, mapsizez)));
	const maxzoom = defaultzoom + 3;

	const srcdir = `cache/mapchunkimgs2`;
	const outdir = `cache/map`;
	const outzoom = (zoom: number) => `${outdir}/${zoom}`;
	const outpath = (zoom: number, x: number, y: number) => `${outzoom(zoom)}/${x}-${y}.png`;


	let skiptime = 0;
	try {
		let meta = fs.statSync(`${outdir}/info.json`);
		skiptime = +meta.mtime;
	} catch (e) {
		console.log("no meta file")
	}

	fs.writeFileSync(`${outdir}/info.json`, "{}");

	let files = fs.readdirSync(srcdir)
		.filter(file => {
			let stat = fs.statSync(`${srcdir}/${file}`);
			return +stat.mtime >= skiptime;
		});


	let queue = new Set<string>();

	for (let zoom = 0; zoom < maxzoom; zoom++) {
		fs.mkdirSync(outzoom(zoom), { recursive: true });
	}

	console.log("starting with x files", files.length);
	let tasks: Promise<any>[] = [];
	for (let file of files) {
		let m = file.match(/(\/|^)(\d+)-(\d+)\./);
		if (!m) {
			console.log("unexpected file in src dir " + file);
			continue;
		}
		let chunkx = +m[2];
		let chunkz = +m[3];
		let tilex = chunkx;
		let tiley = mapsizez - chunkz;

		queue.add(`${tilex / 2 | 0}:${tiley / 2 | 0}`);

		//slice it up to smaller one and do first mips without quality loss
		for (let zoom = 0; (inputsize >> zoom) >= targetsize; zoom++) {
			let size = inputsize >> zoom;
			let muliplier = 1 << zoom;
			for (let suby = 0; suby * size < inputsize; suby++) {
				for (let subx = 0; subx * size < inputsize; subx++) {
					tasks.push(
						sharp(`${srcdir}/${file}`)
							.extract({ left: subx * size, top: suby * size, width: size, height: size })
							.resize(targetsize, targetsize)
							.webp({ nearLossless: true })
							.toFile(outpath(zoom + defaultzoom, tilex * muliplier + subx, tiley * muliplier + suby))
					);
				}
			}
		}
	}
	await Promise.all(tasks);

	for (let zoom = defaultzoom - 1; zoom >= 0; zoom--) {
		let currentqueue = queue;
		console.log("zoom level", zoom, "queue", currentqueue.size);
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
				sharp({ create: { channels: 4, width: targetsize * 2, height: targetsize * 2, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
					.composite(overlays)
					.raw()
					.toBuffer({ resolveWithObject: true })//need to render to force resize after composite
					.then(scaled =>
						sharp(scaled.data, { raw: scaled.info })
							.resize(targetsize, targetsize)
							.webp({ nearLossless: true })
							.toFile(outpath(zoom, x, y))
					).then(() =>
						console.log("combine", zoom, x, y)
					)
			);
		}

		await Promise.all(tasks);
	}
}
