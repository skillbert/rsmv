import { filesource, cliArguments, mapareasource } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import { parse } from "../opdecoder";
import { ParsemapOpts, parseMapsquare } from "../3d/mapsquare";
import { mapsquare_locations } from "../../generated/mapsquare_locations";
import { EngineCache } from "../3d/ob3tothree";
import { makeImageData, pixelsToImageFile } from "../imgutils";

let cmd = command({
	name: "download",
	args: {
		...filesource,
		...mapareasource,
		save: option({ long: "save", short: "s", type: string, defaultValue: () => "cache/mapmodels" }),
		mode: option({ long: "mode", short: "m", type: oneOf(["model", "height", "objects", "floor"]), defaultValue: () => "model" as any })
	},
	handler: async (args) => {
		let opts: ParsemapOpts = { invisibleLayers: false };
		let filesource = await args.source();
		let engine = await EngineCache.create(filesource);
		let { chunks, grid } = await parseMapsquare(engine, args.area, opts);
		fs.mkdirSync(args.save, { recursive: true });
		if (args.mode == "model") {
			//TODO
			console.log("needs repimplementation");
		}
		if (args.mode == "objects") {
			let locs: { squarex: number, squarez: number, locs: mapsquare_locations["locations"] }[] = [];
			for (let chunk of chunks) {
				let locationindex = chunk.cacheIndex.subindices.indexOf(0);
				if (locationindex == -1) { return []; }
				let locations = parse.mapsquareLocations.read(chunk.archive[locationindex].buffer, filesource).locations;
				locs.push({
					squarex: chunk.xoffset,
					squarez: chunk.zoffset,
					locs: locations
				});
			}
			fs.writeFileSync(args.save + "/" + Date.now() + ".json", JSON.stringify(locs, undefined, "\t"));
		}
		if (args.mode == "floor") {
			let alltiles = chunks.flatMap(q => q.tiles.map((t, i) => ({ $coord: `${i / 64 | 0}_${i % 64}`, ...t })));
			let usedunderlays = new Set(alltiles.map(q => q.underlay).filter(q => typeof q != "undefined"));
			let usedoverlays = new Set(alltiles.map(q => q.overlay).filter(q => typeof q != "undefined"));
			let allunderlays = Object.fromEntries([...usedunderlays].map(q => [q, { $actualid: q! - 1, ...engine.mapUnderlays[q! - 1] }]));
			let alloverlays = Object.fromEntries([...usedoverlays].map(q => [q, { $actualid: q! - 1, ...engine.mapOverlays[q! - 1] }]));
			let r = {
				allunderlays,
				alloverlays,
				tiles: alltiles
			}
			fs.writeFileSync(args.save + "/" + Date.now() + ".json", JSON.stringify(r, undefined, "\t"));
		}
		if (args.mode == "height") {
			let imgw = args.area.xsize * 64;
			let imgh = args.area.zsize * 64;
			let data = new Uint8ClampedArray(imgw * imgh * 4);
			for (let dz = 0; dz < args.area.zsize * 64; dz++) {
				for (let dx = 0; dx < args.area.xsize * 64; dx++) {
					let i = dx * 4 + dz * imgw * 4;
					let tile = grid.getTile(args.area.x * 64 + dx, args.area.z * 64 + dz, 0);
					if (!tile) { continue; }
					//1/32=1/(tiledimensions*heightscale)
					data[i + 0] = tile.y / 32 | 0;
					data[i + 1] = tile.y / 32 | 0;
					data[i + 2] = tile.y / 32 | 0;
					data[i + 3] = 255;
				}
			}
			let imgfile = await pixelsToImageFile(makeImageData(data, imgw, imgh), "png", 1);
			fs.writeFileSync(args.save + "/" + Date.now() + ".png", imgfile);
		}
	}
});

run(cmd, cliArguments());