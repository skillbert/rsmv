import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheMajors } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseMapsquareUnderlays } from "../opdecoder";
import { mapsquareToGltf } from "../3d/mapsquare";
import { CacheFileSource } from "main";

let cmd = command({
	name: "download",
	args: {
		...filesource,
		save: option({ long: "save", short: "s", type: string, defaultValue: () => "cache/mapmodels" }),
		startindex: option({ long: "start", short: "b", type: number }),
		width: option({ long: "width", short: "w", type: number, defaultValue: () => 1 }),
		height: option({ long: "height", short: "h", type: number, defaultValue: () => 1 }),
	},
	handler: async (args) => {
		let file = await mapsquareToGltf(args.source, args.startindex, args.width, args.height);
		fs.writeFileSync(args.save + "/" + Date.now() + ".gltf", file);
	}
});

run(cmd, cliArguments);