import { LayerConfig } from ".";
import { canvasToImageFile, fileToImageData, makeImageData } from "../imgutils";
import { crc32addInt } from "../libs/crc32util";
import { getOrInsert } from "../utils";
import { MapRender, SymlinkCommand } from "./backends";
import { ImgNameInfoZoom } from "./layers";
import { ProgressUI } from "./progressui";
import { VariantResolver } from "./varianttracker";

type MipFile = {
	sourcelayer: string,
	sourceversion: number,
	sourceinfo: ImgNameInfoZoom,
	hash: number,
	exacthash: number
};
type MipCommand = {
	layer: LayerConfig,
	imgname: ImgNameInfoZoom,
	files: (MipFile | null)[]
};

export class MipScheduler {
	render: MapRender;
	varianttracker: VariantResolver;
	progress: ProgressUI;
	incompletes = new Map<string, MipCommand>();
	minzoom: number;
	constructor(render: MapRender, varianttracker: VariantResolver, progress: ProgressUI) {
		this.render = render;
		this.varianttracker = varianttracker;
		this.progress = progress;
		this.minzoom = Math.floor(Math.log2(render.config.tileimgsize / (Math.max(render.config.mapsizex, render.config.mapsizez) * 64)));
	}
	addTask(layer: LayerConfig, srclayer: string, src: ImgNameInfoZoom, srcversion: number, hash: number, exacthash: number) {
		if (src.zoom - 1 < this.minzoom) { return; }
		let newname = this.render.makeFileName(layer.name, src.zoom - 1, Math.floor(src.x / 2), Math.floor(src.y / 2), layer.format ?? "webp");
		let incomp = getOrInsert(this.incompletes, newname, () => ({
			layer,
			imgname: {
				x: Math.floor(src.x / 2),
				y: Math.floor(src.y / 2),
				zoom: src.zoom - 1,
				ext: layer.format ?? "webp"
			},
			files: [null, null, null, null]
		}));
		let isright = (src.x % 2) != 0;
		let isbot = (src.y % 2) != 0;
		if (this.render.config.noyflip) { isbot = !isbot; }
		let subindex = (isright ? 1 : 0) + (isbot ? 2 : 0);
		incomp.files[subindex] = {
			sourcelayer: srclayer,
			sourceversion: srcversion,
			sourceinfo: src,
			hash,
			exacthash
		};
	}
	async run(includeIncomplete = false) {
		const maxgroup = 200;
		let completed = 0;
		let skipped = 0;
		let tasks: { name: string, hash: number, exacthash: number, args: MipCommand, run: () => Promise<void> }[] = [];
		let processTasks = async () => {

			// dedupe using varianttracker
			let candidatesprom = tasks.map(q => {
				let resolver = this.varianttracker.getOrCreateResolver(q.args.layer, q.args.imgname.zoom ?? null);
				return resolver.findCandidate(q.args.imgname.x, q.args.imgname.y, q.exacthash, true);
			});

			let candidates = await Promise.all(candidatesprom);
			let proms: Promise<void>[] = [];
			let savemetaqueue: Promise<void>[] = [];
			let symlinks: SymlinkCommand[] = [];
			let callbacks: (() => void)[] = [];
			for (let taskindex = 0; taskindex < tasks.length; taskindex++) {
				let task = tasks[taskindex];
				let resolver = this.varianttracker.getOrCreateResolver(task.args.layer, task.args.imgname.zoom);

				let storedlayername = task.args.layer.name;
				let storedlayerversion = this.render.version;

				let hashmatch = candidates[taskindex];
				if (hashmatch) {
					storedlayername = hashmatch.savedLayerName;
					storedlayerversion = hashmatch.savedLayerVersion;
					symlinks.push({
						file: task.name,
						version: this.render.version,
						target: this.render.makeFileName(hashmatch.savedLayerName, task.args.imgname.zoom, task.args.imgname.x, task.args.imgname.y, task.args.imgname.ext),
						targetversion: hashmatch.savedLayerVersion
					});
					skipped++;
				} else {
					proms.push(task.run().catch(e => console.warn("mipping", task.name, "failed", e)));
					completed++;
				}
				savemetaqueue.push(resolver.addFile(task.args.imgname.x, task.args.imgname.y, task.hash, task.exacthash, storedlayername, storedlayerversion));

				callbacks.push(() => {
					this.addTask(task.args.layer, storedlayername, task.args.imgname, storedlayerversion, task.hash, task.exacthash);
				});
			}
			proms.push(this.render.symlinkBatch(symlinks));
			await Promise.all(proms);
			await Promise.all(savemetaqueue);
			callbacks.forEach(q => q());
			tasks = [];
			this.progress.updateProp("mipqueue", "" + this.incompletes.size);
		}
		do {
			// ensure the highest zoom level is processed first, also order by layer index to support subtractlayers
			let zoomlevel = -100;
			let layer: LayerConfig | null = null;
			let layerindex = 0;
			for (let args of this.incompletes.values()) {
				let thislayerindex = this.render.config.layers.indexOf(args.layer);
				if (args.imgname.zoom > zoomlevel || (args.imgname.zoom == zoomlevel && thislayerindex < layerindex)) {
					zoomlevel = args.imgname.zoom;
					layer = args.layer;
					layerindex = thislayerindex;
				}
			}
			if (!layer) { throw new Error("unexpected state: no layer found"); }
			for (let [out, args] of this.incompletes.entries()) {
				if (layer != args.layer || args.imgname.zoom != zoomlevel) { continue; }
				if (!includeIncomplete && args.files.some(q => !q)) { continue; }

				let hash = 0;
				let exacthash = 0;
				for (let file of args.files) {
					hash = crc32addInt(file?.hash ?? 0, hash);
					exacthash = crc32addInt(file?.exacthash ?? 0, exacthash);
				}

				tasks.push({
					name: out,
					hash: hash,
					exacthash: exacthash,
					args: args,
					run: async () => {
						let buf = await mipCanvas(this.render, args.files, args.layer.format ?? "webp", 0.9, args.layer.mipmode == "avg");
						await this.render.saveFile(out, buf);
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

async function mipCanvas(render: MapRender, files: (MipFile | null)[], format: "png" | "webp", quality: number, avgfilter: boolean) {
	let cnv = document.createElement("canvas");
	cnv.width = render.config.tileimgsize;
	cnv.height = render.config.tileimgsize;
	let ctx = cnv.getContext("2d", { willReadFrequently: true })!;
	const subtilesize = render.config.tileimgsize / 2;
	await Promise.all(files.map(async (f, i) => {
		if (!f) { return null; }
		let filename = render.makeFileName(f.sourcelayer, f.sourceinfo.zoom, f.sourceinfo.x, f.sourceinfo.y, f.sourceinfo.ext);
		let res = await render.getFileResponse(filename, f.sourceversion);
		let mimetype = res.headers.get("content-type");
		//old sanity check
		// let hashheader = res.headers.get("x-amz-meta-mapfile-hash");
		// if (typeof hashheader == "string" && +hashheader != f.fshash) { throw new Error("hash mismatch while creating mip file"); }

		let outx = (i % 2) * subtilesize;
		let outy = Math.floor(i / 2) * subtilesize;
		if (avgfilter) {
			let file = await res.arrayBuffer();
			let data = await fileToImageData(new Uint8Array(file), mimetype as any, false);
			let scaled = avgFilterMipImage(data);
			ctx.putImageData(scaled, outx, outy);
		} else {
			let img: HTMLImageElement | VideoFrame;
			if (!res.ok) {
				throw new Error("image not found");
			}
			// imagedecoder API doesn't support svg
			if (mimetype != "image/svg+xml" && typeof ImageDecoder != "undefined") {
				//typescript types seem broken here? these properties are not depricated either
				let decoder = new ImageDecoder({ data: res.body, type: mimetype, desiredWidth: subtilesize, desiredHeight: subtilesize } as any);
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