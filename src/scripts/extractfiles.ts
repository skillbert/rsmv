
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseMapsquareUnderlays, parseMapsquareOverlays, parseMapZones, parseFrames, parseEnums, parseMapscenes, parseAnimgroupConfigs, parseMapsquareLocations, parseSequences, parseFramemaps, parseModels, parseRootCacheIndex, parseSpotAnims, parseCacheIndex, parseSkeletalAnim, parseMaterials, parseQuickchatCategories, parseQuickchatLines, parseEnvironments, parseAvatars, parseIdentitykit, parseStructs, parseParams } from "../opdecoder";
import { Archive, archiveToFileId, CacheFileSource, CacheIndex, fileIdToArchiveminor, SubFile } from "../cache";
import { constrainedMap } from "../utils";
import prettyJson from "json-stringify-pretty-compact";
import { ScriptOutput } from "../viewer/scriptsui";
import { JSONSchema6Definition } from "json-schema";
import { parseSprite } from "../3d/sprite";
import { pixelsToImageFile } from "../imgutils";
import { crc32, CrcBuilder } from "../libs/crc32util";
import { getModelHashes } from "../3d/ob3tothree";
import { GameCacheLoader } from "../cache/sqlite";


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
		logicalDimensions: 2,
		fileToLogical(major, minor, subfile) {
			return [minor % worldStride, Math.floor(minor / worldStride)];
		},
		logicalToFile(id: LogicalIndex) {
			return { major, minor: id[0] + id[1] * worldStride, subid: subfile };
		},
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
		}
	}
}

function singleMinorIndex(major: number, minor: number): DecodeLookup {
	return {
		major,
		logicalDimensions: 1,
		fileToLogical(major, minor, subfile) {
			return [subfile];
		},
		logicalToFile(id: LogicalIndex) {
			return { major, minor, subid: id[0] };
		},
		async logicalRangeToFiles(source, start, end) {
			return filerange(source, { major, minor, subid: start[0] }, { major, minor, subid: end[0] });
		}
	}
}

function chunkedIndex(major: number): DecodeLookup {
	return {
		major,
		logicalDimensions: 1,
		fileToLogical(major, minor, subfile) {
			return [archiveToFileId(major, minor, subfile)];
		},
		logicalToFile(id: LogicalIndex) {
			return fileIdToArchiveminor(major, id[0]);
		},
		async logicalRangeToFiles(source, start, end) {
			let startindex = fileIdToArchiveminor(major, start[0]);
			let endindex = fileIdToArchiveminor(major, end[0]);
			return filerange(source, startindex, endindex);
		}
	};
}

function standardIndex(major: number): DecodeLookup {
	return {
		major,
		logicalDimensions: 2,
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
		logicalDimensions: 1,
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
		logicalDimensions: 0,
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
				if (args.batched == "true") {
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
				let obj = parser.read(b, undefined, args.keepbuffers == "true");
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
	logicalDimensions: number,
	logicalRangeToFiles(source: CacheFileSource, start: LogicalIndex, end: LogicalIndex): Promise<CacheFileId[]>,
	fileToLogical(major: number, minor: number, subfile: number): LogicalIndex,
	logicalToFile(id: LogicalIndex): FileId,
}

export type DecodeMode<T = Buffer | string> = {
	ext: string,
	parser?: FileParser<any>,
	read(buf: Buffer, fileid: LogicalIndex): T | Promise<T>,
	prepareDump(output: ScriptOutput): void,
	write(files: Buffer): Buffer,
	combineSubs(files: T[]): T
} & DecodeLookup;

const decodeBinary: DecodeModeFactory = () => {
	return {
		ext: "bin",
		major: undefined,
		logicalDimensions: 3,
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

const decodeSprite: DecodeModeFactory = () => {
	return {
		ext: "png",
		major: cacheMajors.sprites,
		logicalDimensions: 1,
		fileToLogical(major, minor, subfile) { return [minor]; },
		logicalToFile(id) { return { major: cacheMajors.sprites, minor: id[0], subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			let major = cacheMajors.sprites;
			return filerange(source, { major, minor: start[0], subid: 0 }, { major, minor: end[0], subid: 0 });
		},
		prepareDump() { },
		read(b, id) {
			//TODO support subimgs
			return pixelsToImageFile(parseSprite(b)[0], "png", 1);
		},
		write(b) { throw new Error("write not supported"); },
		combineSubs(b: Buffer[]) { throw new Error("not supported"); }
	}
}

const decodeSpriteHash: DecodeModeFactory = () => {
	return {
		ext: "json",
		major: cacheMajors.sprites,
		logicalDimensions: 1,
		fileToLogical(major, minor, subfile) { return [minor]; },
		logicalToFile(id) { return { major: cacheMajors.sprites, minor: id[0], subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			let major = cacheMajors.sprites;
			return filerange(source, { major, minor: start[0], subid: 0 }, { major, minor: end[0], subid: 0 });
		},
		prepareDump() { },
		async read(b, id) {
			//TODO support subimgs
			let images = parseSprite(b);
			let str = "";
			for (let [sub, img] of images.entries()) {
				let hash = crc32(img.data);
				str += (str == "" ? "" : ",") + `{"id":${id[0]},"sub":${sub},"hash":${hash}}`;
			}
			return str;
		},
		write(b) { throw new Error("write not supported"); },
		combineSubs(b: string[]) { return "[" + b.join(",\n") + "]"; }
	}
}

const decodeMeshHash: DecodeModeFactory = () => {
	return {
		ext: "json",
		major: cacheMajors.models,
		logicalDimensions: 1,
		fileToLogical(major, minor, subfile) { return [minor]; },
		logicalToFile(id) { return { major: cacheMajors.models, minor: id[0], subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			let major = cacheMajors.models;
			return filerange(source, { major, minor: start[0], subid: 0 }, { major, minor: end[0], subid: 0 });
		},
		prepareDump() { },
		read(b, id) {
			let model = parseModels.read(b);
			let meshhashes = getModelHashes(model, id[0]);
			return JSON.stringify(meshhashes);
		},
		write(b) { throw new Error("write not supported"); },
		combineSubs(b: string[]) { return "[" + b.filter(q => q).join(",\n") + "]"; }
	}
}


export type JsonBasedFile = {
	parser: FileParser<any>,
	lookup: DecodeLookup
}

export const cacheFileJsonModes = constrainedMap<JsonBasedFile>()({
	framemaps: { parser: parseFramemaps, lookup: chunkedIndex(cacheMajors.framemaps) },
	items: { parser: parseItem, lookup: chunkedIndex(cacheMajors.items) },
	enums: { parser: parseEnums, lookup: chunkedIndex(cacheMajors.enums) },
	npcs: { parser: parseNpc, lookup: chunkedIndex(cacheMajors.npcs) },
	objects: { parser: parseObject, lookup: chunkedIndex(cacheMajors.objects) },
	achievements: { parser: parseAchievement, lookup: chunkedIndex(cacheMajors.achievements) },
	structs: { parser: parseStructs, lookup: chunkedIndex(cacheMajors.structs) },
	sequences: { parser: parseSequences, lookup: chunkedIndex(cacheMajors.sequences) },
	spotanims: { parser: parseSpotAnims, lookup: chunkedIndex(cacheMajors.spotanims) },
	materials: { parser: parseMaterials, lookup: chunkedIndex(cacheMajors.materials) },
	quickchatcats: { parser: parseQuickchatCategories, lookup: singleMinorIndex(cacheMajors.quickchat, 0) },
	quickchatlines: { parser: parseQuickchatLines, lookup: singleMinorIndex(cacheMajors.quickchat, 1) },

	overlays: { parser: parseMapsquareOverlays, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.mapoverlays) },
	identitykit: { parser: parseIdentitykit, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.identityKit) },
	params: { parser: parseParams, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.params) },
	underlays: { parser: parseMapsquareUnderlays, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.mapunderlays) },
	mapscenes: { parser: parseMapscenes, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.mapscenes) },
	environments: { parser: parseEnvironments, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.environments) },
	animgroupconfigs: { parser: parseAnimgroupConfigs, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.animgroups) },

	maptiles: { parser: parseMapsquareTiles, lookup: worldmapIndex(cacheMapFiles.squares) },
	maplocations: { parser: parseMapsquareLocations, lookup: worldmapIndex(cacheMapFiles.locations) },

	frames: { parser: parseFrames, lookup: standardIndex(cacheMajors.frames) },
	models: { parser: parseModels, lookup: standardIndex(cacheMajors.models) },
	skeletons: { parser: parseSkeletalAnim, lookup: standardIndex(cacheMajors.skeletalAnims) },

	indices: { parser: parseCacheIndex, lookup: indexfileIndex() },
	rootindex: { parser: parseRootCacheIndex, lookup: rootindexfileIndex() }
});

const npcmodels: DecodeModeFactory = function (flags) {
	return {
		...chunkedIndex(cacheMajors.npcs),
		ext: "json",
		prepareDump(output) { },
		read(b, id) {
			let obj = parseNpc.read(b);
			return prettyJson({
				id: id[0],
				size: obj.boundSize ?? 1,
				name: obj.name ?? "",
				models: obj.models ?? []
			});
		},
		write(files) {
			throw new Error("");
		},
		combineSubs(b) {
			return `[${b.join(",\n")}]`;
		}
	}
}

export const cacheFileDecodeModes: Record<keyof typeof cacheFileJsonModes | "bin", DecodeModeFactory> = {
	bin: decodeBinary,
	sprites: decodeSprite,
	spritehash: decodeSpriteHash,
	modelhash: decodeMeshHash,

	npcmodels: npcmodels,

	...Object.fromEntries(Object.entries(cacheFileJsonModes).map(([k, v]) => [k, standardFile(v.parser, v.lookup)]))
} as any;

export async function extractCacheFiles(output: ScriptOutput, source: CacheFileSource, args: { batched: boolean, batchlimit: number, mode: string, files: string, edit: boolean, keepbuffers: boolean }) {
	let modeconstr: DecodeModeFactory = cacheFileDecodeModes[args.mode];
	if (!modeconstr) { throw new Error("unknown mode"); }
	let flags: Record<string, string> = {};
	if (args.batched || args.batchlimit != -1) { flags.batched = "true"; }
	if (args.keepbuffers) { flags.keepbuffers = "true"; }
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
		if (res instanceof Promise) { res = await res; }
		if (batchSubfile || batchMaxFiles != -1) {
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


	if (args.edit) {
		output.log("press any key to save edits");
		await new Promise<any>(d => process.stdin.once('data', d));

		let archedited = () => {
			if (!(source instanceof GameCacheLoader)) { throw new Error("can only do this on file source of type gamecacheloader"); }
			if (lastarchive) {
				console.log("writing archive", lastarchive.index.major, lastarchive.index.minor, "files", lastarchive.subfiles.length);
				console.log(lastarchive.index);
				// let arch = new Archive(lastarchive.subfiles.map(q => q.buffer));
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
			let logicalid = mode.fileToLogical(fileid.index.major, fileid.index.minor, arch[fileid.subindex].fileid);
			let newfile = await output.readFileBuffer(`${args.mode}-${logicalid.join("_")}.${mode.ext}`);
			arch[fileid.subindex].buffer = mode.write(newfile);
		}
		await archedited();
	}
	output.log("done");
}

