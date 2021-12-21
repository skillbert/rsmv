import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheConfigPages, cacheMajors } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseMapsquareUnderlays, parseMapsquareOverlays, parseMapZones, parseEnums, parseMapscenes } from "../opdecoder";
import { achiveToFileId, CacheFileSource } from "../cache";
import { parseSprite } from "../3d/sprite";
import sharp from "sharp";
import { FlatImageData } from "../3d/utils";

type KnownType = {
	index: number,
	subfile?: number,
	minor?: number,
	parser?: FileParser<any>,
	gltf?: (b: Buffer, source: CacheFileSource) => Promise<Uint8Array>,
	img?: (b: Buffer, source: CacheFileSource) => Promise<FlatImageData[]>
}

const decoders: Record<string, KnownType> = {
	items: { index: cacheMajors.items, parser: parseItem },
	npcs: { index: cacheMajors.npcs, parser: parseNpc },
	objects: { index: cacheMajors.objects, parser: parseObject },
	achievements: { index: cacheMajors.achievements, parser: parseAchievement },
	sprites: { index: cacheMajors.sprites, img: (b) => Promise.resolve(parseSprite(b)) },

	overlays: { index: cacheMajors.config, minor: cacheConfigPages.mapoverlays, parser: parseMapsquareOverlays },
	underlays: { index: cacheMajors.config, minor: cacheConfigPages.mapunderlays, parser: parseMapsquareOverlays },
	mapscenes: { index: cacheMajors.config, minor: cacheConfigPages.mapscenes, parser: parseMapscenes },

	mapzones: { index: cacheMajors.worldmap, minor: 0, parser: parseMapZones },

	enums: { index: cacheMajors.enums, minor: 0, parser: parseEnums },
	
	maptiles: { index: cacheMajors.mapsquares, subfile: 3, parser: parseMapsquareTiles },
}

let cmd = command({
	name: "download",
	args: {
		...filesource,
		major: option({ long: "major", type: string }),
		minor: option({ long: "minor", type: string, defaultValue: () => "all" }),
		save: option({ long: "save", short: "s", type: string, defaultValue: () => "extract" }),
		decode: option({ long: "format", short: "t", type: oneOf(["json", "batchjson", "bin", "gltf", "img"]), defaultValue: () => "bin" as any }),
		subfile: option({ long: "subfile", short: "a", type: number, defaultValue: () => -1 })
	},
	handler: async (args) => {
		let major = isNaN(+args.major) ? cacheMajors[args.major] : +args.major;
		if (isNaN(major)) { throw new Error("could not find major: " + args.major); }
		let filesource = await args.source();
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

		let indexfile = await filesource.getIndexFile(major);
		let decoder = (args.decode ? Object.values(decoders).find(q =>
			q.index == major
			&& (typeof q.minor == "undefined" || q.minor == minorstart)
			&& (typeof q.subfile == "undefined" || q.subfile == args.subfile)
		) : undefined);

		if (args.decode != "bin" && !decoder) { throw new Error("no decoder known for this cache major"); }

		let outdir = path.resolve(args.save)
		fs.mkdirSync(outdir, { recursive: true });
		for (let index of indexfile) {
			if (!index) { continue; }
			if (index.minor >= minorstart && index.minor < minorend) {
				let files = await filesource.getFileArchive(index);
				let batchedoutput: string[] = [];
				for (let fileindex in index.subindices) {
					if (args.subfile != -1 && index.subindices[fileindex] != args.subfile) { continue; }
					let filename = path.resolve(outdir, `${index.minor}${index.subindexcount == 1 ? "" : "-" + index.subindices[fileindex]}.${args.decode}`);
					let file = files[fileindex].buffer;
					if (args.decode == "bin") {
						fs.writeFileSync(filename, file);
						console.log(filename, files[fileindex].size);
					} else if (args.decode == "json" || args.decode == "batchjson") {
						if (!decoder?.parser) { throw new Error(); }
						let json = decoder.parser.read(file);
						if (args.decode == "json") {
							fs.writeFileSync(filename, JSON.stringify(json, undefined, "  "), "utf-8");
							console.log(filename, files[fileindex].size);
						} else {
							json.$subfile = index.subindices[fileindex];
							json.$fileid = achiveToFileId(index.major, index.minor, index.subindices[fileindex]);
							batchedoutput.push(JSON.stringify(json, undefined, "  "));
						}
					} else if (args.decode == "gltf") {
						if (!decoder?.gltf) { throw new Error(); }
						let buf = await decoder.gltf(file, filesource);
						fs.writeFileSync(filename, buf);
						console.log(filename, files[fileindex].size);
					} else if (args.decode == "img") {
						if (!decoder?.img) { throw new Error(); }
						try {
							let imgs = await decoder.img(file, filesource);
							for (let i = 0; i < imgs.length; i++) {
								let filename = path.resolve(outdir, `${index.minor}${imgs.length == 1 ? "" : "-" + i}.png`);
								let img = imgs[i];
								let info = await sharp(img.data, { raw: img })
									.png()
									.toFile(filename);

								console.log(filename, info.size);
							}
						} catch (e) {
							console.error(e);
							fs.writeFileSync("img" + Date.now() + ".bin", file);
							//TODO bugs with bzip2 stopping to soon
						}
					}
				}
				if (args.decode == "batchjson" && batchedoutput.length != 0) {
					let filename = path.resolve(outdir, `${index.minor}-batch.json`);
					fs.writeFileSync(filename, "[\n\n" + batchedoutput.join(",\n\n") + "\n\n]\n", "utf-8");
					console.log(filename, "batch", batchedoutput.length);
				}
			}
		}
		filesource.close();
		console.log("done");
	}
});

run(cmd, cliArguments());
