import { filesource, cliArguments, mapareasource } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheMajors } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseMapsquareUnderlays } from "../opdecoder";
import { mapsquareModels, mapsquareToGltf, ParsemapOpts, parseMapsquare } from "../3d/mapsquare";
import sharp from "sharp";

//for debugging
(global as any).fs = require("fs");

let cmd = command({
	name: "download",
	args: {
		...filesource,
		...mapareasource,
		save: option({ long: "save", short: "s", type: string, defaultValue: () => "cache/mapmodels" }),
		mode: option({ long: "mode", short: "m", type: oneOf(["model", "height"]), defaultValue: () => "model" as any })
	},
	handler: async (args) => {
		let opts: ParsemapOpts = { centered: true, invisibleLayers: false };
		let { chunks, grid } = await parseMapsquare(args.source, args.area, opts);
		if (args.mode == "model") {
			let modeldata = await mapsquareModels(args.source, grid, chunks, opts);
			let file = await mapsquareToGltf(args.source, modeldata);
			fs.writeFileSync(args.save + "/" + Date.now() + ".glb", file);
		}
		if (args.mode == "height") {
			let imgw = args.area.width * 64;
			let imgh = args.area.height * 64;
			let data = new Uint8ClampedArray(imgw * imgh * 4);
			for (let dz = 0; dz < args.area.height * 64; dz++) {
				for (let dx = 0; dx < args.area.width * 64; dx++) {
					let i = dx * 4 + dz * imgw * 4;
					let tile = grid.getTile(args.area.x * 64 + dx, args.area.y * 64 + dz, 0);
					if (!tile) {continue; throw new Error("tile not found, this shouldnt happen"); }
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