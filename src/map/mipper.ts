import { LayerConfig } from ".";
import { canvasToImageFile, fileToImageData, makeImageData } from "../imgutils";
import { crc32addInt } from "../scripts/dependencies";
import { MapRender, SymlinkCommand, UniqueMapFile } from "./backends";
import { ProgressUI } from "./progressui";


type MipCommand = { layer: LayerConfig, zoom: number, x: number, y: number, files: (UniqueMapFile | null)[] };

export class MipScheduler {
	render: MapRender;
	progress: ProgressUI;
	incompletes = new Map<string, MipCommand>();
	minzoom: number;
	constructor(render: MapRender, progress: ProgressUI) {
		this.render = render;
		this.progress = progress;
		this.minzoom = Math.floor(Math.log2(render.config.tileimgsize / (Math.max(render.config.mapsizex, render.config.mapsizez) * 64)));
	}
	addTask(layer: LayerConfig, zoom: number, hash: number, x: number, y: number, srcfile: string) {
		if (zoom - 1 < this.minzoom) { return; }
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
					symlinks.push({ file: task.name, hash: task.hash, buildnr: this.render.version, symlink: old.file, symlinkbuildnr: old.buildnr, symlinkfirstbuildnr: old.firstbuildnr });
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
						let buf = await mipCanvas(this.render, args.files, args.layer.format ?? "webp", 0.9, args.layer.mipmode == "avg");
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

function avgFilterMipImage(img: ImageData) {
	if (img.width % 2 != 0 || img.height % 2 != 0) { throw new Error("can only use avg mip filter on textures with multiple of 2 size"); }
	let mipped = makeImageData(null, img.width / 2, img.height / 2);
	const stridex = 4;
	const stridey = img.width * 4;
	for (let y = 0; y < mipped.height; y++) {
		for (let x = 0; x < mipped.width; x++) {
			let i = (x * 2) * stridex + (y * 2) * stridey;
			//2 bias to round using floor later
			let r = 2 + img.data[i + 0] + img.data[i + stridex + 0] + img.data[i + stridey + 0] + img.data[i + stridex + stridey + 0];
			let g = 2 + img.data[i + 1] + img.data[i + stridex + 1] + img.data[i + stridey + 1] + img.data[i + stridex + stridey + 1];
			let b = 2 + img.data[i + 2] + img.data[i + stridex + 2] + img.data[i + stridey + 2] + img.data[i + stridex + stridey + 2];
			let a = 2 + img.data[i + 3] + img.data[i + stridex + 3] + img.data[i + stridey + 3] + img.data[i + stridex + stridey + 3];
			let iout = x * 4 + y * mipped.width * 4;
			mipped.data[iout + 0] = r / 4;
			mipped.data[iout + 1] = g / 4;
			mipped.data[iout + 2] = b / 4;
			mipped.data[iout + 3] = a / 4;
		}
	}
	return mipped;
}

async function mipCanvas(render: MapRender, files: (UniqueMapFile | null)[], format: "png" | "webp", quality: number, avgfilter: boolean) {
	let cnv = document.createElement("canvas");
	cnv.width = render.config.tileimgsize;
	cnv.height = render.config.tileimgsize;
	let ctx = cnv.getContext("2d", { willReadFrequently: true })!;
	const subtilesize = render.config.tileimgsize / 2;
	await Promise.all(files.map(async (f, i) => {
		if (!f) { return null; }
		let res = await render.getFileResponse(f.name);
		let mimetype = res.headers.get("content-type");
		let outx = (i % 2) * subtilesize;
		let outy = Math.floor(i / 2) * subtilesize;
		if (avgfilter) {
			let file = await res.arrayBuffer();
			let data = await fileToImageData(new Uint8Array(file), mimetype as any, false);
			let scaled = avgFilterMipImage(data);
			ctx.putImageData(scaled, outx, outy);
		} else {
			let img: any;//Image|VideoFrame
			if (!res.ok) {
				throw new Error("image not found");
			}
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
			ctx.drawImage(img, outx, outy, subtilesize, subtilesize);
		}
	}));
	return canvasToImageFile(cnv, format, quality);
}