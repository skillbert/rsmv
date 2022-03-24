import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseMapsquareUnderlays, parseMapsquareOverlays, parseMapZones, parseFrames, parseEnums, parseMapscenes, parseAnimgroupConfigs, parseMapsquareLocations, parseSequences, parseFramemaps, parseModels, parseSpotAnims } from "../opdecoder";
import { achiveToFileId, CacheFileSource, CacheIndex, CacheIndexStub, fileIdToArchiveminor, SubFile } from "../cache";
import { parseSprite } from "../3d/sprite";
import sharp from "sharp";
import { FlatImageData } from "../3d/utils";
import * as cache from "../cache";
import { GameCacheLoader } from "../cacheloader";
import { crc32_backward, forge } from "../libs/crc32util";
import prettyJson from "json-stringify-pretty-compact";

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
	let constr: DecodeModeFactory = (outdir, args: Record<string, string>) => {
		let name = Object.entries(modes).find(q => q[1] == constr);
		if (!name) { throw new Error(); }
		let schema = parser.parser.getJsonSChema();
		let relurl = `./.schema-${name[0]}.json`;
		fs.writeFileSync(path.resolve(outdir, relurl), prettyJson(schema));
		return {
			...lookup,
			ext: "json",
			read(b, id) {
				let obj = parser.read(b);
				if (args.batched) {
					obj.$fileid = (id.length == 1 ? id[0] : id);
				} else {
					obj.$schema = relurl;
				}
				return prettyJson(obj);
			},
			write(b) {
				return parser.write(JSON.parse(b.toString("utf8")));
			},
			combineSubs(b) {
				return "[\n\n" + b.join("\n,\n\n") + "]";
			}
		}
	}
	return constr;
}

type DecodeModeFactory = (outdir: string, flags: Record<string, string>) => DecodeMode;

type FileId = { major: number, minor: number, subindex: number };

type DecodeLookup = {
	major: number | undefined,
	logicalRangeToFiles(source: CacheFileSource, start: LogicalIndex, end: LogicalIndex): Promise<CacheFileId[]>,
	fileToLogical(major: number, minor: number, subfile: number): LogicalIndex,
	logicalToFile(id: LogicalIndex): FileId,
}

type DecodeMode<T = Buffer | string> = {
	ext: string,
	read(buf: Buffer, fileid: LogicalIndex): T,
	write(files: Buffer): Buffer,
	combineSubs(files: T[]): T
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
		write(b) { return b; },
		combineSubs(b: Buffer[]) { return Buffer.concat(b); }
	}
}


const modes: Record<string, DecodeModeFactory> = {
	bin: decodeBinary,

	framemaps: standardFile(parseFramemaps, chunkedIndex(cacheMajors.framemaps)),
	items: standardFile(parseItem, chunkedIndex(cacheMajors.items)),
	npcs: standardFile(parseNpc, chunkedIndex(cacheMajors.npcs)),
	objects: standardFile(parseObject, chunkedIndex(cacheMajors.objects)),
	achievements: standardFile(parseAchievement, chunkedIndex(cacheMajors.achievements)),
	sequences: standardFile(parseSequences, chunkedIndex(cacheMajors.sequences)),
	spotanims: standardFile(parseSpotAnims, chunkedIndex(cacheMajors.spotanims)),

	overlays: standardFile(parseMapsquareOverlays, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapoverlays)),
	underlays: standardFile(parseMapsquareUnderlays, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapunderlays)),
	mapscenes: standardFile(parseMapscenes, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapscenes)),
	animgroupconfigs: standardFile(parseAnimgroupConfigs, singleMinorIndex(cacheMajors.config, cacheConfigPages.animgroups)),

	maptiles: standardFile(parseMapsquareTiles, worldmapIndex(cacheMapFiles.squares)),
	maplocations: standardFile(parseMapsquareLocations, worldmapIndex(cacheMapFiles.locations)),

	frames: standardFile(parseFrames, standardIndex(cacheMajors.frames)),
	models: standardFile(parseModels, standardIndex(cacheMajors.models))
}

let cmd2 = command({
	name: "run",
	args: {
		...filesource,
		save: option({ long: "save", short: "s", type: string, defaultValue: () => "extract" }),
		mode: option({ long: "mode", short: "m", type: string }),
		files: option({ long: "ids", short: "i", type: string, defaultValue: () => "" }),
		edit: flag({ long: "edit", short: "e" }),
		fixhash: flag({ long: "fixhash", short: "h" }),
		batched: flag({ long: "batched", short: "b" })
	},
	handler: async (args) => {
		let modeconstr = modes[args.mode];
		if (!modeconstr) { throw new Error("unknown mode"); }
		let outdir = path.resolve(args.save);
		fs.mkdirSync(outdir, { recursive: true });
		let flags: Record<string, string> = {};
		if (args.batched) { flags.batched = "true"; }
		let mode = modeconstr(outdir, flags);

		let parts = args.files.split(",");
		let ranges = parts.map(q => {
			let ends = q.split("-");
			let start = ends[0] ? ends[0].split(".") : [];
			let end = (ends[0] || ends[1]) ? (ends[1] ?? ends[0]).split(".") : [];
			return {
				start: [+(start[0] ?? 0), +(start[1] ?? 0)] as [number, number],
				end: [+(end[0] ?? Infinity), +(end[1] ?? Infinity)] as [number, number]
			}
		});

		let source = await args.source({ writable: args.edit });

		let allfiles = (await Promise.all(ranges.map(q => mode.logicalRangeToFiles(source, q.start, q.end))))
			.flat()
			.sort((a, b) => a.index.major != b.index.major ? a.index.major - b.index.major : a.index.minor != b.index.minor ? a.index.minor - b.index.minor : a.subfile - b.subfile);


		let lastarchive: null | { index: CacheIndex, subfiles: SubFile[], outputs: (string | Buffer)[] } = null;
		let flushbatch = () => {
			if (lastarchive && args.batched) {
				let filename = path.resolve(outdir, `${args.mode}-${lastarchive.index.major}_${lastarchive.index.minor}.batch.${mode.ext}`);
				fs.writeFileSync(filename, mode.combineSubs(lastarchive.outputs));
			}
		}
		for (let fileid of allfiles) {
			let arch: SubFile[];
			if (lastarchive && lastarchive.index == fileid.index) {
				arch = lastarchive.subfiles;
			} else {
				// console.log(fileid.index);
				flushbatch();
				arch = await source.getFileArchive(fileid.index);
				lastarchive = { index: fileid.index, subfiles: arch, outputs: [] };
			}
			let file = arch[fileid.subfile].buffer;
			let logicalid = mode.fileToLogical(fileid.index.major, fileid.index.minor, fileid.subfile);
			let res = mode.read(file, logicalid);
			if (args.batched) {
				lastarchive.outputs.push(res);
			} else {
				let filename = path.resolve(outdir, `${args.mode}-${logicalid.join("_")}.${mode.ext}`);
				fs.writeFileSync(filename, res);
			}
		}
		flushbatch();


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
					lastarchive = { index: fileid.index, subfiles: arch, outputs: [] };
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

run(cmd2, cliArguments());
