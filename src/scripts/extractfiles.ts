import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf, optional } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseMapsquareUnderlays, parseMapsquareOverlays, parseMapZones, parseFrames, parseEnums, parseMapscenes, parseAnimgroupConfigs, parseMapsquareLocations, parseSequences, parseFramemaps, parseModels, parseRootCacheIndex, parseSpotAnims, parseCacheIndex, parseSkeletalAnim, parseMaterials, parseQuickchatCategories, parseQuickchatLines, parseEnvironments, parseAvatars, parseIdentitykit, parseStructs, parseParams } from "../opdecoder";
import { archiveToFileId, CacheFileSource, CacheIndex, fileIdToArchiveminor, SubFile } from "../cache";
import { FlatImageData, constrainedMap } from "../utils";
import { GameCacheLoader } from "../cache/sqlite";
import { crc32_backward, forge } from "../libs/crc32util";
import prettyJson from "json-stringify-pretty-compact";
import { CLIScriptOutput, ScriptOutput } from "../viewer/scriptsui";
import { JSONSchema6Definition } from "json-schema";


type CacheFileId = {
	index: CacheIndex,
	subindex: number
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
				if (index.minor == startindex.minor && subfileid < startindex.subid) { continue; }
				if (index.minor == endindex.minor && subfileid > endindex.subid) { continue; }
				files.push({ index, subindex: fileindex });
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
							files.push({ index, subindex: fileindex });
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
			return { major, minor: id[0] + id[1] * worldStride, subid: subfile };
		}
	}
}

function singleMinorIndex(major: number, minor: number): DecodeLookup {
	return {
		major,
		async logicalRangeToFiles(source, start, end) {
			return filerange(source, { major, minor, subid: start[0] }, { major, minor, subid: end[0] });
		},
		fileToLogical(major, minor, subfile) {
			return [subfile];
		},
		logicalToFile(id: LogicalIndex) {
			return { major, minor, subid: id[0] };
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
			return [archiveToFileId(major, minor, subfile)];
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
		logicalToFile(id) { return { major, minor: id[0], subid: id[1] }; },
		async logicalRangeToFiles(source, start, end) {
			return filerange(source, { major, minor: start[0], subid: start[1] }, { major, minor: end[0], subid: end[1] });
		}
	}
}
function indexfileIndex(): DecodeLookup {
	return {
		major: cacheMajors.index,
		fileToLogical(major, minor, subfile) { return [minor]; },
		logicalToFile(id) { return { major: cacheMajors.index, minor: id[0], subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			let indices = await source.getIndexFile(cacheMajors.index);
			return indices
				.filter(index => index.minor >= start[0] && index.minor <= end[0])
				.map(index => ({ index, subindex: 0 }));
		}
	}
}

function rootindexfileIndex(): DecodeLookup {
	return {
		major: cacheMajors.index,
		fileToLogical(major, minor, subfile) { return []; },
		logicalToFile(id) { return { major: cacheMajors.index, minor: 255, subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			return [
				{ index: { major: 255, minor: 255, crc: 0, size: 0, version: 0, subindexcount: 1, subindices: [0] }, subindex: 0 }
			];
		}
	}
}

function standardFile(parser: FileParser<any>, lookup: DecodeLookup): DecodeModeFactory {
	let constr: DecodeModeFactory = (args: Record<string, string>) => {
		let singleschemaurl = "";
		let batchschemaurl = "";
		return {
			...lookup,
			ext: "json",
			parser: parser,
			prepareDump(output: ScriptOutput) {
				let name = Object.entries(cacheFileDecodeModes).find(q => q[1] == constr);
				if (!name) { throw new Error(); }
				let schema = parser.parser.getJsonSchema();
				//need seperate files since vscode doesn't seem to support hastag paths in the uri
				if (args.batched) {
					let batchschema: JSONSchema6Definition = {
						type: "object",
						properties: {
							files: { type: "array", items: schema }
						}
					};
					let relurl = `.schema-${name[0]}_batch.json`;
					output.writeFile(relurl, prettyJson(batchschema));
					batchschemaurl = relurl;
				} else {
					let relurl = `.schema-${name[0]}.json`;
					output.writeFile(relurl, prettyJson(schema));
					singleschemaurl = relurl;
				}
			},
			read(b, id) {
				let obj = parser.read(b);
				if (args.batched) {
					obj.$fileid = (id.length == 1 ? id[0] : id);
				} else {
					obj.$schema = singleschemaurl;
				}
				return prettyJson(obj);
			},
			write(b) {
				return parser.write(JSON.parse(b.toString("utf8")));
			},
			combineSubs(b) {
				return `{"$schema":"${batchschemaurl}","files":[\n\n${b.join("\n,\n\n")}]}`;
			}
		}
	}
	return constr;
}

export type DecodeModeFactory = (flags: Record<string, string>) => DecodeMode;

type FileId = { major: number, minor: number, subid: number };

type DecodeLookup = {
	major: number | undefined,
	logicalRangeToFiles(source: CacheFileSource, start: LogicalIndex, end: LogicalIndex): Promise<CacheFileId[]>,
	fileToLogical(major: number, minor: number, subfile: number): LogicalIndex,
	logicalToFile(id: LogicalIndex): FileId,
}

export type DecodeMode<T = Buffer | string> = {
	ext: string,
	parser?: FileParser<any>,
	read(buf: Buffer, fileid: LogicalIndex): T,
	prepareDump(output: ScriptOutput): void,
	write(files: Buffer): Buffer,
	combineSubs(files: T[]): T
} & DecodeLookup;

const decodeBinary: DecodeModeFactory = () => {
	return {
		ext: "bin",
		major: undefined,
		fileToLogical(major, minor, subfile) { return [major, minor, subfile]; },
		logicalToFile(id) { return { major: id[0], minor: id[1], subid: id[2] }; },
		async logicalRangeToFiles(source, start, end) {
			if (start[0] != end[0]) { throw new Error("can only do one major at a time"); }
			let major = start[0];
			return filerange(source, { major, minor: start[1], subid: start[2] }, { major, minor: end[1], subid: end[2] });
		},
		prepareDump() { },
		read(b) { return b; },
		write(b) { return b; },
		combineSubs(b: Buffer[]) { return Buffer.concat(b); }
	}
}

export const cacheFileDecodeModes = constrainedMap<DecodeModeFactory>()({
	bin: decodeBinary,

	framemaps: standardFile(parseFramemaps, chunkedIndex(cacheMajors.framemaps)),
	items: standardFile(parseItem, chunkedIndex(cacheMajors.items)),
	enums: standardFile(parseEnums, chunkedIndex(cacheMajors.enums)),
	npcs: standardFile(parseNpc, chunkedIndex(cacheMajors.npcs)),
	objects: standardFile(parseObject, chunkedIndex(cacheMajors.objects)),
	achievements: standardFile(parseAchievement, chunkedIndex(cacheMajors.achievements)),
	structs: standardFile(parseStructs, chunkedIndex(cacheMajors.structs)),
	sequences: standardFile(parseSequences, chunkedIndex(cacheMajors.sequences)),
	spotanims: standardFile(parseSpotAnims, chunkedIndex(cacheMajors.spotanims)),
	materials: standardFile(parseMaterials, chunkedIndex(cacheMajors.materials)),
	quickchatcats: standardFile(parseQuickchatCategories, singleMinorIndex(cacheMajors.quickchat, 0)),
	quickchatlines: standardFile(parseQuickchatLines, singleMinorIndex(cacheMajors.quickchat, 1)),

	overlays: standardFile(parseMapsquareOverlays, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapoverlays)),
	identitykit: standardFile(parseIdentitykit, singleMinorIndex(cacheMajors.config, cacheConfigPages.identityKit)),
	params: standardFile(parseParams, singleMinorIndex(cacheMajors.config, cacheConfigPages.params)),
	underlays: standardFile(parseMapsquareUnderlays, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapunderlays)),
	mapscenes: standardFile(parseMapscenes, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapscenes)),
	environments: standardFile(parseEnvironments, singleMinorIndex(cacheMajors.config, cacheConfigPages.environments)),
	animgroupconfigs: standardFile(parseAnimgroupConfigs, singleMinorIndex(cacheMajors.config, cacheConfigPages.animgroups)),

	maptiles: standardFile(parseMapsquareTiles, worldmapIndex(cacheMapFiles.squares)),
	maplocations: standardFile(parseMapsquareLocations, worldmapIndex(cacheMapFiles.locations)),

	frames: standardFile(parseFrames, standardIndex(cacheMajors.frames)),
	models: standardFile(parseModels, standardIndex(cacheMajors.models)),
	skeletons: standardFile(parseSkeletalAnim, standardIndex(cacheMajors.skeletalAnims)),

	indices: standardFile(parseCacheIndex, indexfileIndex()),
	rootindex: standardFile(parseRootCacheIndex, rootindexfileIndex()),

	avatars: standardFile(parseAvatars, standardIndex(0)),
});

export async function extractCacheFiles(output: ScriptOutput, source: CacheFileSource, args: { batched: boolean, batchlimit: number, mode: string, files: string }) {
	let modeconstr: DecodeModeFactory = cacheFileDecodeModes[args.mode];
	if (!modeconstr) { throw new Error("unknown mode"); }
	let flags: Record<string, string> = {};
	if (args.batched || args.batchlimit != -1) { flags.batched = "true"; }
	let mode = modeconstr(flags);
	mode.prepareDump(output);

	let batchMaxFiles = args.batchlimit;
	let batchSubfile = args.batched;

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

	let allfiles = (await Promise.all(ranges.map(q => mode.logicalRangeToFiles(source, q.start, q.end))))
		.flat()
		.sort((a, b) => a.index.major != b.index.major ? a.index.major - b.index.major : a.index.minor != b.index.minor ? a.index.minor - b.index.minor : a.subindex - b.subindex);


	let lastarchive: null | { index: CacheIndex, subfiles: SubFile[] } = null;
	let currentBatch: { name: string, startIndex: CacheIndex, arch: SubFile[], outputs: (string | Buffer)[], batchchunknr: number } | null = null;
	let flushbatch = () => {
		if (currentBatch) {
			//return promise instead of async function so we only switch stacks when actually doing anything
			return (async () => {
				let filename = `${args.mode}-${currentBatch.startIndex.major}_${currentBatch.startIndex.minor}.batch`;
				if (batchMaxFiles != -1) { filename += "." + currentBatch.batchchunknr; }
				filename += `.${mode.ext}`;
				output.writeFile(filename, mode.combineSubs(currentBatch.outputs));
				currentBatch = null;
			})();
		}
	}
	for (let fileid of allfiles) {
		if (output.state != "running") { break; }
		let arch: SubFile[];
		if (lastarchive && lastarchive.index == fileid.index) {
			arch = lastarchive.subfiles;
		} else {
			arch = await source.getFileArchive(fileid.index);
			lastarchive = { index: fileid.index, subfiles: arch };
		}
		let file = arch[fileid.subindex];
		let logicalid = mode.fileToLogical(fileid.index.major, fileid.index.minor, file.fileid);
		let res = mode.read(file.buffer, logicalid);
		if (args.batched) {
			let maxedbatchsize = currentBatch && batchMaxFiles != -1 && currentBatch.outputs.length >= batchMaxFiles;
			let newarch = currentBatch && currentBatch.arch != arch
			if (!currentBatch || maxedbatchsize || (batchSubfile && newarch)) {
				let nextbatchchunknr = (newarch || !maxedbatchsize || !currentBatch ? 0 : currentBatch.batchchunknr + 1);
				let p = flushbatch();
				if (p) { await p; }
				currentBatch = {
					name: "",
					startIndex: fileid.index,
					arch,
					outputs: [],
					batchchunknr: nextbatchchunknr
				};
			}
			currentBatch.outputs.push(res);
		} else {
			let filename = `${args.mode}${logicalid.length == 0 ? "" : "-" + logicalid.join("_")}.${mode.ext}`;
			await output.writeFile(filename, res);
		}
	}
	flushbatch();


	// if (args.edit) {
	// 	await new Promise<any>(d => process.stdin.once('data', d));

	// 	let archedited = () => {
	// 		if (!(source instanceof GameCacheLoader)) { throw new Error("can only do this on file source of type gamecacheloader"); }
	// 		if (lastarchive) {
	// 			console.log("writing archive", lastarchive.index.major, lastarchive.index.minor, "files", lastarchive.subfiles.length);
	// 			console.log(lastarchive.index);
	// 			// let arch = new cache.Archive(lastarchive.subfiles.map(q => q.buffer));
	// 			// arch.forgecrc(lastarchive.index.uncompressed_crc, lastarchive.index.subindices.indexOf(3), 10);
	// 			// return source.writeFile(lastarchive.index.major, lastarchive.index.minor, arch.packSqlite());
	// 			return source.writeFileArchive(lastarchive.index, lastarchive.subfiles.map(q => q.buffer));
	// 		}
	// 	}

	// 	for (let fileid of allfiles) {
	// 		let arch: SubFile[];
	// 		if (lastarchive && lastarchive.index == fileid.index) {
	// 			arch = lastarchive.subfiles;
	// 		} else {
	// 			await archedited();
	// 			arch = await source.getFileArchive(fileid.index);
	// 			lastarchive = { index: fileid.index, subfiles: arch };
	// 		}
	// 		let logicalid = mode.fileToLogical(fileid.index.major, fileid.index.minor, arch[fileid.subindex].fileid);
	// 		let filename = path.resolve(outdir, `${args.mode}-${logicalid.join("_")}.${mode.ext}`);
	// 		let newfile = fs.readFileSync(filename);
	// 		arch[fileid.subindex].buffer = mode.write(newfile);
	// 	}
	// 	await archedited();
	// }
	output.log("done");
}

// run(cmd2, cliArguments());
