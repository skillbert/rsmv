import { filesource, cliArguments, mapareasource } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheMajors } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseMapsquareUnderlays } from "../opdecoder";
import { mapsquareToGltf, parseMapsquare } from "../3d/mapsquare";

//for debugging
(global as any).fs = require("fs");

let cmd = command({
	name: "download",
	args: {
		...filesource,
		...mapareasource,
		save: option({ long: "save", short: "s", type: string, defaultValue: () => "cache/mapmodels" }),
	},
	handler: async (args) => {
		let square = await parseMapsquare(args.source, args.area, { centered: true, invisibleLayers: true });
		let file = await mapsquareToGltf(args.source, square);
		fs.writeFileSync(args.save + "/" + Date.now() + ".glb", file);
	}
});

run(cmd, cliArguments);