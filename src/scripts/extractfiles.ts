import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheMajors } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseMapsquareUnderlays } from "../opdecoder";
import { CacheFileSource } from "../cache";

type KnownType = {
	index: number,
	parser: FileParser<any>,
	gltf?: (b: Buffer, source: CacheFileSource) => Promise<Uint8Array>
}

const decoders: Record<string, KnownType> = {
	items: { index: cacheMajors.items, parser: parseItem },
	npcs: { index: cacheMajors.npcs, parser: parseNpc },
	objects: { index: cacheMajors.objects, parser: parseObject },
	achievements: { index: cacheMajors.achievements, parser: parseAchievement },
	mapsquares: { index: cacheMajors.mapsquares, parser: parseMapsquareTiles },
	mapunderlays: { index: cacheMajors.config, parser: parseMapsquareUnderlays }
}

let cmd = command({
	name: "download",
	args: {
		...filesource,
		major: option({ long: "major", type: string }),
		minor: option({ long: "minor", type: string, defaultValue: () => "all" }),
		save: option({ long: "save", short: "s", type: string, defaultValue: () => "extract" }),
		decode: option({ long: "format", short: "t", type: oneOf(["json", "bin", "gltf"]), defaultValue: () => "bin" as any })
	},
	handler: async (args) => {
		let major = isNaN(+args.major) ? cacheMajors[args.major] : +args.major;
		if (isNaN(major)) { throw new Error("could not find major: " + args.major); }
		let minorstart = 0;
		let minorend = 0;
		if (args.minor == "all") {
			minorend = Infinity;
		} else {
			let minorparts = args.minor.split("-");
			minorstart = +minorparts[0];
			if (minorparts.length == 2) {
				minorend = +minorparts[1] + 1;
			} else {
				minorend = +minorparts[0] + 1;
			}
		}

		let indexfile = await args.source.getIndexFile(major);
		let decoder = (args.decode ? Object.values(decoders).find(q => q.index == major) : undefined);
		if (args.decode != "bin" && !decoder) { throw new Error("no decoder known for this cache major"); }

		let outdir = path.resolve(args.save)
		fs.mkdirSync(outdir, { recursive: true });
		for (let index of indexfile) {
			if (index.minor >= minorstart && index.minor < minorend) {
				let files = await args.source.getFileArchive(index);
				for (let fileindex of index.subindices) {
					if (fileindex != 3) { continue; }
					let filename = path.resolve(outdir, `${index.minor}${index.subindexcount == 1 ? "" : "-" + fileindex}.${args.decode}`);
					let file = files[fileindex].buffer;
					if (args.decode == "bin") {
						fs.writeFileSync(filename, file);
					} else if (args.decode == "json") {
						if (!decoder?.parser) { throw new Error(); }
						let json = decoder.parser.read(file);
						fs.writeFileSync(filename, JSON.stringify(json), "utf-8");
					} else if (args.decode == "gltf") {
						if (!decoder?.gltf) { throw new Error(); }
						let buf = await decoder.gltf(file, args.source);
						fs.writeFileSync(filename, buf);
					}
					console.log(filename, files[fileindex].size);
				}
			}
		}
		args.source.close();
		console.log("done");
	}
});

run(cmd, cliArguments);
