import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseMapsquareUnderlays, parseMapsquareOverlays, parseMapZones, parseAnimations, parseEnums, parseMapscenes, parseMapsquareLocations } from "../opdecoder";
import { achiveToFileId, CacheFileSource, CacheIndex, CacheIndexStub, fileIdToArchiveminor, SubFile } from "../cache";
import { parseSprite } from "../3d/sprite";
import sharp from "sharp";
import { FlatImageData } from "../3d/utils";
import * as cache from "../cache";
import { GameCacheLoader } from "../cacheloader";
import { crc32_backward, forge } from "../libs/crc32util";

type KnownType = {
	index: number,
	subfile?: number,
	minor?: number,
	parser?: FileParser<any>,
	gltf?: (b: Buffer, source: CacheFileSource) => Promise<Uint8Array>,
	img?: (b: Buffer, source: CacheFileSource) => Promise<FlatImageData[]>
}

type CacheFileId = {
	index: CacheIndex,
	subfile: number
}

type LogicalIndex = number[];

async function filerange(source: CacheFileSource, startindex: FileId, endindex: FileId) {
	if (startindex.major != endindex.major) { throw new Error("range must span one major"); }
	let indexfile = await source.getIndexFile(startindex.major);
	let files: CacheFileId[] = [];
	for (let index of indexfile) {
		if (!index) { continue; }
		if (index.minor >= startindex.minor && index.minor <= endindex.minor) {
			for (let fileindex = 0; fileindex < index.subindices.length; fileindex++) {
				let subfileid = index.subindices[fileindex];
				if (index.minor == startindex.minor && subfileid < startindex.subindex) { continue; }
				if (index.minor == endindex.minor && subfileid > endindex.subindex) { continue; }
				files.push({ index, subfile: fileindex });
			}
		}
	}
	return files;
}

function worldmapIndex(subfile: number): DecodeLookup {
	const major = cacheMajors.mapsquares;
	const worldStride = 128;
	return {
		major,
		async logicalRangeToFiles(source, start, end) {
			let indexfile = await source.getIndexFile(major);
			let files: CacheFileId[] = [];
			for (let index of indexfile) {
				if (!index) { continue; }
				let x = index.minor % worldStride;
				let z = Math.floor(index.minor / worldStride);
				if (x >= start[0] && x <= end[0] && z >= start[1] && z <= end[1]) {
					for (let fileindex = 0; fileindex < index.subindices.length; fileindex++) {
						let subfileid = index.subindices[fileindex];
						if (subfileid == subfile) {
							files.push({ index, subfile: fileindex });
						}
					}
				}
			}
			return files;
		},
		fileToLogical(major, minor, subfile) {
			return [minor % worldStride, Math.floor(minor / worldStride)];
		},
		logicalToFile(id: LogicalIndex) {
			return { major, minor: id[0] + id[1] * worldStride, subindex: subfile };
		}
	}
}

function singleMinorIndex(major: number, minor: number): DecodeLookup {
	return {
		major,
		async logicalRangeToFiles(source, start, end) {
			return filerange(source, { major, minor, subindex: start[0] }, { major, minor, subindex: end[0] });
		},
		fileToLogical(major, minor, subfile) {
			return [subfile];
		},
		logicalToFile(id: LogicalIndex) {
			return { major, minor, subindex: id[0] };
		}
	}
}

function chunkedIndex(major: number): DecodeLookup {
	return {
		major,
		async logicalRangeToFiles(source, start, end) {
			let startindex = fileIdToArchiveminor(major, start[0]);
			let endindex = fileIdToArchiveminor(major, end[0]);
			return filerange(source, startindex, endindex);
		},
		fileToLogical(major, minor, subfile) {
			return [achiveToFileId(major, minor, subfile)];
		},
		logicalToFile(id: LogicalIndex) {
			return fileIdToArchiveminor(major, id[0]);
		}
	};
}

function standardIndex(major: number): DecodeLookup {
	return {
		major,
		fileToLogical(major, minor, subfile) { return [minor, subfile]; },
		logicalToFile(id) { return { major, minor: id[0], subindex: id[1] }; },
		async logicalRangeToFiles(source, start, end) {
			return filerange(source, { major, minor: start[0], subindex: start[1] }, { major, minor: end[0], subindex: end[1] });
		}
	}
}

function standardFile(parser: FileParser<any>, lookup: DecodeLookup): DecodeModeFactory {
	let constr: DecodeModeFactory = (outdir) => {
		let name = Object.entries(modes).find(q => q[1] == constr);
		if (!name) { throw new Error(); }
		let schema = parser.parser.getJsonSChema();
		let relurl = `./.schema-${name[0]}.json`;
		fs.writeFileSync(path.resolve(outdir, relurl), JSON.stringify(schema, undefined, "\t"));
		return {
			...lookup,
			ext: "json",
			read(b) {
				let obj = parser.read(b);
				obj.$schema = relurl;
				return JSON.stringify(obj, undefined, "\t");
			},
			write(b) {
				return parser.write(JSON.parse(b.toString("utf8")));
			}
		}
	}
	return constr;
}

type DecodeModeFactory = (outdir: string) => DecodeMode;

type FileId = { major: number, minor: number, subindex: number };

type DecodeLookup = {
	major: number | undefined,
	logicalRangeToFiles(source: CacheFileSource, start: LogicalIndex, end: LogicalIndex): Promise<CacheFileId[]>,
	fileToLogical(major: number, minor: number, subfile: number): LogicalIndex,
	logicalToFile(id: LogicalIndex): FileId,
}

type DecodeMode = {
	ext: string,
	read(buf: Buffer): (Buffer | string),
	write(files: Buffer): Buffer
} & DecodeLookup;

const decodeBinary: DecodeModeFactory = () => {
	return {
		ext: "bin",
		major: undefined,
		fileToLogical(major, minor, subfile) { return [major, minor, subfile]; },
		logicalToFile(id) { return { major: id[0], minor: id[1], subindex: id[2] }; },
		async logicalRangeToFiles(source, start, end) {
			if (start[0] != end[0]) { throw new Error("can only do one major at a time"); }
			let major = start[0];
			return filerange(source, { major, minor: start[1], subindex: start[2] }, { major, minor: end[1], subindex: end[2] });
		},
		read(b) { return b; },
		write(b) { return b; }
	}
}


const modes: Record<string, DecodeModeFactory> = {
	bin: decodeBinary,

	items: standardFile(parseItem, chunkedIndex(cacheMajors.items)),
	npcs: standardFile(parseNpc, chunkedIndex(cacheMajors.npcs)),
	objects: standardFile(parseObject, chunkedIndex(cacheMajors.objects)),
	achievements: standardFile(parseAchievement, chunkedIndex(cacheMajors.achievements)),

	overlays: standardFile(parseMapsquareOverlays, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapoverlays)),
	underlays: standardFile(parseMapsquareUnderlays, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapunderlays)),
	mapscenes: standardFile(parseMapscenes, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapscenes)),

	maptiles: standardFile(parseMapsquareTiles, worldmapIndex(cacheMapFiles.squares)),
	maplocations: standardFile(parseMapsquareLocations, worldmapIndex(cacheMapFiles.locations)),

	anims: standardFile(parseAnimations, standardIndex(cacheMajors.anims))
}

const decoders: Record<string, KnownType> = {
	items: { index: cacheMajors.items, parser: parseItem },
	npcs: { index: cacheMajors.npcs, parser: parseNpc },
	objects: { index: cacheMajors.objects, parser: parseObject },
	achievements: { index: cacheMajors.achievements, parser: parseAchievement },
	sprites: { index: cacheMajors.sprites, img: async (b) => parseSprite(b) },

	overlays: { index: cacheMajors.config, minor: cacheConfigPages.mapoverlays, parser: parseMapsquareOverlays },
	underlays: { index: cacheMajors.config, minor: cacheConfigPages.mapunderlays, parser: parseMapsquareOverlays },
	mapscenes: { index: cacheMajors.config, minor: cacheConfigPages.mapscenes, parser: parseMapscenes },

	mapzones: { index: cacheMajors.worldmap, minor: 0, parser: parseMapZones },

	enums: { index: cacheMajors.enums, minor: 0, parser: parseEnums },

	maptiles: { index: cacheMajors.mapsquares, subfile: 3, parser: parseMapsquareTiles },
}

let cmd2 = command({
	name: "run",
	args: {
		...filesource,
		save: option({ long: "save", short: "s", type: string, defaultValue: () => "extract" }),
		mode: option({ long: "mode", short: "m", type: string }),
		files: option({ long: "ids", short: "i", type: string }),
		edit: flag({ long: "edit", short: "e" }),
		fixhash: flag({ long: "fixhash", short: "h" })
	},
	handler: async (args) => {
		let modeconstr = modes[args.mode];
		if (!modeconstr) { throw new Error("unknown mode"); }
		let outdir = path.resolve(args.save);
		fs.mkdirSync(outdir, { recursive: true });
		let mode = modeconstr(outdir);

		let parts = args.files.split(",");
		let ranges = parts.map(q => {
			let ends = q.split("-");
			let start = ends[0].split(".");
			let end = (ends[1] ?? ends[0]).split(".");
			return {
				start: [+start[0], +(start[1] ?? 0)] as [number, number],
				end: [+end[0], +(end[1] ?? Infinity)] as [number, number]
			}
		});

		let source = await args.source({ writable: args.edit });

		let allfiles = (await Promise.all(ranges.map(q => mode.logicalRangeToFiles(source, q.start, q.end))))
			.flat()
			.sort((a, b) => a.index.major != b.index.major ? a.index.major - b.index.major : a.index.minor != b.index.minor ? a.index.minor - b.index.minor : a.subfile - b.subfile);


		let lastarchive: null | { index: CacheIndex, subfiles: SubFile[] } = null;
		for (let fileid of allfiles) {
			let arch: SubFile[];
			if (lastarchive && lastarchive.index == fileid.index) {
				arch = lastarchive.subfiles;
			} else {
				// console.log(fileid.index);
				arch = await source.getFileArchive(fileid.index);
				lastarchive = { index: fileid.index, subfiles: arch };
			}
			let file = arch[fileid.subfile].buffer;
			let res = mode.read(file);
			let logicalid = mode.fileToLogical(fileid.index.major, fileid.index.minor, fileid.subfile);
			let filename = path.resolve(outdir, `${args.mode}-${logicalid.join("_")}.${mode.ext}`);
			fs.writeFileSync(filename, res);
		}


		if (args.edit) {
			await new Promise<any>(d => process.stdin.once('data', d));

			let archedited = () => {
				if (!(source instanceof GameCacheLoader)) { throw new Error("can only do this on file source of type gamecacheloader"); }
				if (lastarchive) {
					console.log("writing archive", lastarchive.index.major, lastarchive.index.minor, "files", lastarchive.subfiles.length);
					console.log(lastarchive.index);
					// let arch = new cache.Archive(lastarchive.subfiles.map(q => q.buffer));
					// arch.forgecrc(lastarchive.index.uncompressed_crc, lastarchive.index.subindices.indexOf(3), 10);
					// return source.writeFile(lastarchive.index.major, lastarchive.index.minor, arch.packSqlite());
					return source.writeFileArchive(lastarchive.index, lastarchive.subfiles.map(q => q.buffer));
				}
			}

			for (let fileid of allfiles) {
				let arch: SubFile[];
				if (lastarchive && lastarchive.index == fileid.index) {
					arch = lastarchive.subfiles;
				} else {
					await archedited();
					arch = await source.getFileArchive(fileid.index);
					lastarchive = { index: fileid.index, subfiles: arch };
				}
				let logicalid = mode.fileToLogical(fileid.index.major, fileid.index.minor, fileid.subfile);
				let filename = path.resolve(outdir, `${args.mode}-${logicalid.join("_")}.${mode.ext}`);
				let newfile = fs.readFileSync(filename);
				arch[fileid.subfile].buffer = mode.write(newfile);
			}
			await archedited();
		}
		source.close();
		console.log("done");
	}
})

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

run(cmd2, cliArguments());
