import { filesource, cliArguments, mapareasource } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheMajors } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseMapsquareUnderlays, parseMapsquareLocations } from "../opdecoder";
import { mapConfigData, mapsquareModels, ParsemapOpts, parseMapsquare } from "../3d/mapsquare";
import sharp from "sharp";
import { mapsquare_locations } from "../../generated/mapsquare_locations";

//for debugging
(global as any).fs = require("fs");

let cmd = command({
	name: "download",
	args: {
		...filesource,
		...mapareasource,
		save: option({ long: "save", short: "s", type: string, defaultValue: () => "cache/mapmodels" }),
		mode: option({ long: "mode", short: "m", type: oneOf(["model", "height", "objects", "floor"]), defaultValue: () => "model" as any })
	},
	handler: async (args) => {
		let opts: ParsemapOpts = { centered: true, invisibleLayers: false };
		let { chunks, grid } = await parseMapsquare(args.source, args.area, opts);
		if (args.mode == "model") {
			//TODO
			console.log("needs repimplementation");
			// let modeldata = await mapsquareModels(args.source, grid, chunks, opts);
			// let file = await mapsquareToGltf(args.source, modeldata);
			// fs.writeFileSync(args.save + "/" + Date.now() + ".glb", file);
		}
		if (args.mode == "objects") {
			let locs: { squarex: number, squarez: number, locs: mapsquare_locations["locations"] }[] = [];
			for (let chunk of chunks) {
				let locationindex = chunk.cacheIndex.subindices.indexOf(0);
				if (locationindex == -1) { return []; }
				let locations = parseMapsquareLocations.read(chunk.archive[locationindex].buffer).locations;
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
			let { underlays, overlays } = await mapConfigData(args.source);
			let allunderlays = Object.fromEntries([...usedunderlays].map(q => [q, { $actualid: q! - 1, ...underlays[q! - 1] }]));
			let alloverlays = Object.fromEntries([...usedoverlays].map(q => [q, { $actualid: q! - 1, ...overlays[q! - 1] }]));
			let r = {
				allunderlays,
				alloverlays,
				tiles: alltiles
			}
			fs.writeFileSync(args.save + "/" + Date.now() + ".json", JSON.stringify(r, undefined, "\t"));
		}
		if (args.mode == "height") {
			let imgw = args.area.width * 64;
			let imgh = args.area.height * 64;
			let data = new Uint8ClampedArray(imgw * imgh * 4);
			for (let dz = 0; dz < args.area.height * 64; dz++) {
				for (let dx = 0; dx < args.area.width * 64; dx++) {
					let i = dx * 4 + dz * imgw * 4;
					let tile = grid.getTile(args.area.x * 64 + dx, args.area.y * 64 + dz, 0);
					if (!tile) { continue; }
					//1/32=1/(tiledimensions*heightscale)
					data[i + 0] = tile.y / 32 | 0;
					data[i + 1] = tile.y / 32 | 0;
					data[i + 2] = tile.y / 32 | 0;
					data[i + 3] = 255;
				}
			}
			let imgfile = await sharp(data, { raw: { width: imgw, height: imgh, channels: 4 } })
				.png()
				.toBuffer();
			fs.writeFileSync(args.save + "/" + Date.now() + ".png", imgfile);
		}
	}
});

run(cmd, cliArguments);