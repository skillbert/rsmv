
import { cacheConfigPages, cacheMajors, cacheMapFiles, lastClassicBuildnr, lastLegacyBuildnr } from "../constants";
import { parse, FileParser } from "../opdecoder";
import { Archive, archiveToFileId, CacheFileSource, CacheIndex, fileIdToArchiveminor, SubFile } from "../cache";
import { cacheFilenameHash, constrainedMap } from "../utils";
import prettyJson from "json-stringify-pretty-compact";
import { ScriptFS, ScriptOutput } from "../scriptrunner";
import { JSONSchema6Definition } from "json-schema";
import { parseLegacySprite, parseSprite, parseTgaSprite } from "../3d/sprite";
import { pixelsToImageFile } from "../imgutils";
import { crc32, CrcBuilder } from "../libs/crc32util";
import { getModelHashes, EngineCache } from "../3d/modeltothree";
import { ParsedTexture } from "../3d/textures";
import { parseMusic } from "./musictrack";
import { legacyGroups, legacyMajors } from "../cache/legacycache";
import { classicGroups } from "../cache/classicloader";
import { renderCutscene } from "./rendercutscene";
import { UiRenderContext, renderRsInterfaceHTML } from "./renderrsinterface";
import { compileClientScript, prepareClientScript, renderClientScript, writeClientVarFile, writeOpcodeFile } from "../clientscript";


type CacheFileId = {
	index: CacheIndex,
	subindex: number
}

type LogicalIndex = number[];

async function filerange(source: CacheFileSource, startindex: FileId, endindex: FileId) {
	if (startindex.major != endindex.major) { throw new Error("range must span one major"); }
	let files: CacheFileId[] = [];
	if (source.getBuildNr() <= lastLegacyBuildnr) {
		//dummy filerange since we don't have an index
		let itercount = 0;
		for (let minor = startindex.minor; minor <= endindex.minor; minor++) {
			if (itercount++ > 1000) { break; }
			try {
				//bit silly since we download the files and then only return their ids
				//however it doesn't matter that much since the entire cache is <20mb
				let group: SubFile[] = [];
				group = await source.getArchiveById(startindex.major, minor);
				let groupindex: CacheIndex = {
					major: startindex.major,
					minor,
					crc: 0,
					name: null,
					subindexcount: group.length,
					subindices: group.map(q => q.fileid),
					subnames: group.map(q => q.fileid),
					version: 0
				};
				for (let sub of group) {
					if (sub.fileid >= startindex.subid && sub.fileid <= endindex.subid) {
						files.push({
							index: groupindex,
							subindex: sub.fileid
						});
					}
				}
			} catch {
				//omit missing groups from listing
			}
		}
	} else {
		let indexfile = await source.getCacheIndex(startindex.major);
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
	}
	return files;
}

const throwOnNonSimple = {
	prepareDump() { },
	prepareWrite() { },
	write(b) { throw new Error("write not supported"); },
	combineSubs(b: Buffer[]) { throw new Error("not supported"); }
}

function oldWorldmapIndex(key: "l" | "m"): DecodeLookup {
	return {
		major: cacheMajors.mapsquares,
		minor: undefined,
		logicalDimensions: 2,
		usesArchieves: false,
		fileToLogical(source, major, minor, subfile) {
			return [255, minor];
		},
		logicalToFile(source, id) {
			throw new Error("not implemented");
		},
		async logicalRangeToFiles(source, start, end) {
			let index = await source.getCacheIndex(cacheMajors.mapsquares);
			let res: CacheFileId[] = [];
			for (let x = start[0]; x <= Math.min(end[0], 100); x++) {
				for (let z = start[1]; z <= Math.min(end[1], 200); z++) {
					let namehash = cacheFilenameHash(`${key}${x}_${z}`, source.getBuildNr() <= lastLegacyBuildnr);
					let file = index.find(q => q.name == namehash);
					if (file) { res.push({ index: file, subindex: 0 }); }
				}
			}
			return res;
		}
	}
}

function worldmapIndex(subfile: number): DecodeLookup {
	const major = cacheMajors.mapsquares;
	const worldStride = 128;
	return {
		major,
		minor: undefined,
		logicalDimensions: 2,
		usesArchieves: true,
		fileToLogical(source, major, minor, subfile) {
			return [minor % worldStride, Math.floor(minor / worldStride)];
		},
		logicalToFile(source, id: LogicalIndex) {
			return { major, minor: id[0] + id[1] * worldStride, subid: subfile };
		},
		async logicalRangeToFiles(source, start, end) {
			let indexfile = await source.getCacheIndex(major);
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
		minor,
		logicalDimensions: 1,
		usesArchieves: true,
		fileToLogical(source, major, minor, subfile) {
			return [subfile];
		},
		logicalToFile(source, id: LogicalIndex) {
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
		minor: undefined,
		logicalDimensions: 1,
		usesArchieves: true,
		fileToLogical(source, major, minor, subfile) {
			return [archiveToFileId(major, minor, subfile)];
		},
		logicalToFile(source, id: LogicalIndex) {
			return fileIdToArchiveminor(major, id[0], source.getBuildNr());
		},
		async logicalRangeToFiles(source, start, end) {
			let startindex = fileIdToArchiveminor(major, start[0], source.getBuildNr());
			let endindex = fileIdToArchiveminor(major, end[0], source.getBuildNr());
			return filerange(source, startindex, endindex);
		}
	};
}

function anyFileIndex(): DecodeLookup {
	return {
		major: undefined,
		minor: undefined,
		logicalDimensions: 3,
		usesArchieves: true,
		fileToLogical(source, major, minor, subfile) { return [major, minor, subfile]; },
		logicalToFile(source, id) { return { major: id[0], minor: id[1], subid: id[2] }; },
		async logicalRangeToFiles(source, start, end) {
			if (start[0] != end[0]) { throw new Error("can only do one major at a time"); }
			let major = start[0];
			return filerange(source, { major, minor: start[1], subid: start[2] }, { major, minor: end[1], subid: end[2] });
		}
	}
}

function noArchiveIndex(major: number): DecodeLookup {
	return {
		major,
		minor: undefined,
		logicalDimensions: 1,
		usesArchieves: false,
		fileToLogical(source, major, minor, subfile) { if (subfile != 0) { throw new Error("nonzero subfile in noarch index"); } return [minor]; },
		logicalToFile(source, id) { return { major, minor: id[0], subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			return filerange(source, { major, minor: start[0], subid: 0 }, { major, minor: end[0], subid: 0 });
		}
	}
}

function standardIndex(major: number): DecodeLookup {
	return {
		major,
		minor: undefined,
		logicalDimensions: 2,
		usesArchieves: true,
		fileToLogical(source, major, minor, subfile) { return [minor, subfile]; },
		logicalToFile(source, id) { return { major, minor: id[0], subid: id[1] }; },
		async logicalRangeToFiles(source, start, end) {
			return filerange(source, { major, minor: start[0], subid: start[1] }, { major, minor: end[0], subid: end[1] });
		}
	}
}
function blacklistIndex(parent: DecodeLookup, blacklist: { major: number, minor: number }[]): DecodeLookup {
	return {
		...parent,
		async logicalRangeToFiles(source, start, end) {
			let res = await parent.logicalRangeToFiles(source, start, end);
			return res.filter(q => !blacklist.some(w => w.major == q.index.major && w.minor == q.index.minor));
		},
	}
}
function indexfileIndex(): DecodeLookup {
	return {
		major: cacheMajors.index,
		minor: undefined,
		logicalDimensions: 1,
		usesArchieves: false,
		fileToLogical(source, major, minor, subfile) { return [minor]; },
		logicalToFile(source, id) { return { major: cacheMajors.index, minor: id[0], subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			let indices = await source.getCacheIndex(cacheMajors.index);
			return indices
				.filter(index => index && index.minor >= start[0] && index.minor <= end[0])
				.map(index => ({ index, subindex: 0 }));
		}
	}
}

function rootindexfileIndex(): DecodeLookup {
	return {
		major: cacheMajors.index,
		minor: 255,
		logicalDimensions: 0,
		usesArchieves: false,
		fileToLogical(source, major, minor, subfile) { return []; },
		logicalToFile(source, id) { return { major: cacheMajors.index, minor: 255, subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			return [
				{ index: { major: 255, minor: 255, crc: 0, size: 0, version: 0, name: null, subindexcount: 1, subindices: [0], subnames: null }, subindex: 0 }
			];
		}
	}
}

function standardFile(parser: FileParser<any>, lookup: DecodeLookup, prepareDump?: ((source: CacheFileSource) => Promise<void> | void) | null, prepareParser?: ((source: CacheFileSource) => Promise<void> | void) | null): DecodeModeFactory {
	let constr: DecodeModeFactory = (args: Record<string, string>) => {
		let singleschemaurl = "";
		let batchschemaurl = "";
		return {
			...lookup,
			ext: "json",
			parser: parser,
			async prepareDump(output, source) {
				await prepareParser?.(source);
				await prepareDump?.(source);
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
			prepareWrite(source) {
				return prepareParser?.(source);
			},
			read(b, id, source) {
				let obj = parser.read(b, source, { keepbuffers: args.keepbuffers });

				if (args.batched) {
					obj.$fileid = (id.length == 1 ? id[0] : id);
				} else {
					obj.$schema = singleschemaurl;
				}
				return prettyJson(obj);
			},
			write(b, id, source) {
				return parser.write(JSON.parse(b.toString("utf8")), source.getDecodeArgs());
			},
			combineSubs(b) {
				return `{"$schema":"${batchschemaurl}","files":[\n\n${b.join("\n,\n\n")}]}`;
			},
			description: "View the JSON representation of a file",
			flagtemplate: {
				keepbuffers: { text: "Keep binary buffers (can be very large)", type: "boolean" }
			}
		}
	}

	return constr;
}

export type DecodeModeFactory = (flags: Record<string, string>) => DecodeMode;

type FileId = { major: number, minor: number, subid: number };

type DecodeLookup = {
	major: number | undefined,
	minor: number | undefined,
	logicalDimensions: number,
	usesArchieves: boolean;
	logicalRangeToFiles(source: CacheFileSource, start: LogicalIndex, end: LogicalIndex): Promise<CacheFileId[]>,
	fileToLogical(source: CacheFileSource, major: number, minor: number, subfile: number): LogicalIndex,
	logicalToFile(source: CacheFileSource, id: LogicalIndex): FileId
}

export type DecodeMode<T = Buffer | string> = {
	ext: string,
	parser?: FileParser<any>,
	read(buf: Buffer, fileid: LogicalIndex, source: CacheFileSource): T | Promise<T>,
	prepareDump(output: ScriptFS, source: CacheFileSource): Promise<void> | void,
	prepareWrite(source: CacheFileSource): Promise<void> | void,
	write(file: Buffer, fileid: LogicalIndex, source: CacheFileSource): Buffer | Promise<Buffer>,
	combineSubs(files: T[]): T,
	description: string,
	flagtemplate?: Record<string, { text: string, type: "boolean" }>
} & DecodeLookup;

const decodeBinary: DecodeModeFactory = () => {
	return {
		...anyFileIndex(),
		ext: "bin",
		prepareDump() { },
		prepareWrite() { },
		read(b) { return b; },
		write(b) { return b; },
		combineSubs(b: Buffer[]) { return Buffer.concat(b); },
		description: "Outputs the raw files as they are in the cache"
	}
}

const decodeMusic: DecodeModeFactory = () => {
	return {
		ext: "ogg",
		major: cacheMajors.music,
		minor: undefined,
		logicalDimensions: 1,
		usesArchieves: false,
		fileToLogical(source, major, minor, subfile) { return [minor]; },
		logicalToFile(source, id) { return { major: cacheMajors.music, minor: id[0], subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			let enumfile = await source.getFileById(cacheMajors.enums, 1351);
			let enumdata = parse.enums.read(enumfile, source);
			let indexfile = await source.getCacheIndex(cacheMajors.music);
			return enumdata.intArrayValue2!.values
				.filter(q => q[1] >= start[0] && q[1] <= end[0])
				.sort((a, b) => a[1] - b[1])
				.filter((q, i, arr) => i == 0 || arr[i - 1][1] != q[1])//filter duplicates
				.map<CacheFileId>(q => ({ index: indexfile[q[1]], subindex: 0 }))
		},
		...throwOnNonSimple,
		read(buf, fileid, source) {
			return parseMusic(source, cacheMajors.music, fileid[0], buf, true);
		},
		description: "Stitches child music fragments onto header fragments, only a small number of music fragments are header fragments, ids that lead to child fragments are ignored."
	}
}
const decodeSound = (major: number, allowdownload: boolean): DecodeModeFactory => () => {
	return {
		ext: "ogg",
		...noArchiveIndex(major),
		...throwOnNonSimple,
		read(buf, fileid, source) {
			return parseMusic(source, major, fileid[0], buf, allowdownload);
		},
		description: "Extracts sound files from cache"
	}
}

const decodeCutscene: DecodeModeFactory = () => {
	return {
		ext: "html",
		...noArchiveIndex(cacheMajors.cutscenes),
		...throwOnNonSimple,
		async read(buf, fileid, source) {
			let res = await renderCutscene(source, buf);
			return res.doc;
		},
		description: "Decodes and assembles 2d vector cutscenes (first added in 2023). These cutscenes are saved in cache without image compression so take a while to decode. Sounds effects might be missing if you use a local game cache since the game normally only downloads them on demand."
	}
}

const decodeInterface: DecodeModeFactory = () => {
	return {
		ext: "html",
		major: cacheMajors.interfaces,
		minor: undefined,
		logicalDimensions: 1,
		usesArchieves: true,
		fileToLogical(source, major, minor, subfile) { if (subfile != 0) { throw new Error("subfile 0 expected") } return [minor]; },
		logicalToFile(source, id) { return { major: cacheMajors.interfaces, minor: id[0], subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			let indexfile = await source.getCacheIndex(cacheMajors.interfaces);
			return indexfile.filter(q => q && q.minor >= start[0] && q.minor <= end[0]).map(q => ({ index: q, subindex: 0 }));
		},
		...throwOnNonSimple,
		async read(buf, fileid, source) {
			let res = await renderRsInterfaceHTML(new UiRenderContext(source), fileid[0]);
			return res;
		},
		description: "Extracts an interface and converts the template to a html file. Model and scripts will be missing and therefore the result might be incomplete."
	}
}
const decodeInterface2: DecodeModeFactory = () => {
	return {
		ext: "ui.json",
		major: cacheMajors.interfaces,
		minor: undefined,
		logicalDimensions: 1,
		usesArchieves: true,
		fileToLogical(source, major, minor, subfile) { if (subfile != 0) { throw new Error("subfile 0 expected") } return [minor]; },
		logicalToFile(source, id) { return { major: cacheMajors.interfaces, minor: id[0], subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			let indexfile = await source.getCacheIndex(cacheMajors.interfaces);
			return indexfile.filter(q => q && q.minor >= start[0] && q.minor <= end[0]).map(q => ({ index: q, subindex: 0 }));
		},
		...throwOnNonSimple,
		async read(buf, fileid, source) {
			return JSON.stringify({ id: fileid[0] });
		},
		description: "Doesn't extract anything but invokes the built-in RSMV interface viewer."
	}
}

const decodeClientScript: DecodeModeFactory = (ops) => {
	return {
		ext: "ts",
		...noArchiveIndex(cacheMajors.clientscript),
		...throwOnNonSimple,
		async prepareDump(out, source) {
			let calli = await prepareClientScript(source);
			out.writeFile("tsconfig.json", JSON.stringify({ "compilerOptions": { "lib": [], "target": "ESNext" } }, undefined, "\t"));//tsconfig to make the folder a project
			out.writeFile("opcodes.d.ts", writeOpcodeFile(calli));
			out.writeFile("clientvars.d.ts", writeClientVarFile(calli));
		},
		read(buf, fileid, source) {
			return renderClientScript(source, buf, fileid[0], ops.cs2relativecomps == "true", ops.cs2notypes == "true", ops.cs2intcasts == "true");
		},
		async write(file, fileid, source) {
			let obj = await compileClientScript(source, file.toString("utf8"));
			let res = parse.clientscript.write(obj, source.getDecodeArgs());
			// throw new Error("exit dryrun");
			return res;
		},
		description: "Extracts clientscript VM code (cs2) and converts it to something that is typescript-compatible.",
		flagtemplate: {
			cs2relativecomps: { text: "Hide subcomponent ids (can't be compiled, but offers stable diffing)", type: "boolean" },
			cs2notypes: { text: "Don't output TS types (can't be compiled)", type: "boolean" },
			cs2intcasts: { text: "Explicit JS int32 casts during math (can't be compiled)", type: "boolean" }
		}
	}
}

const decodeClientScriptViewer: DecodeModeFactory = () => {
	return {
		ext: "cs2.json",
		...noArchiveIndex(cacheMajors.clientscript),
		...throwOnNonSimple,
		async prepareDump(fs, source) {
			await prepareClientScript(source);
		},
		read(buf, fileid, source) {
			return JSON.stringify(parse.clientscript.read(buf, source));
		},
		description: "Basic implementation of the clientscript VM (cs2). Can be used to debug programs and step through code."
	}
}

const decodeOldProcTexture: DecodeModeFactory = () => {
	return {
		ext: "png",
		...singleMinorIndex(cacheMajors.texturesOldPng, 0),
		...throwOnNonSimple,
		async read(b, id, source) {
			let obj = parse.oldproctexture.read(b, source);
			let spritefile = await source.getFileById(cacheMajors.sprites, obj.spriteid);
			let sprites = parseSprite(spritefile);
			if (sprites.length != 1) { throw new Error("exactly one subsprite expected"); }
			return pixelsToImageFile(sprites[0].img, "png", 1);
		},
		description: "Procedural textures are highly compressed textures used in early rshd."
	}
}

const decodeLegacySprite = (minor: number): DecodeModeFactory => () => {
	return {
		ext: "png",
		...singleMinorIndex(legacyMajors.data, minor),
		...throwOnNonSimple,
		async read(b, id, source) {
			let metafile = await source.findSubfileByName(legacyMajors.data, minor, "INDEX.DAT");
			let img = parseLegacySprite(metafile!.buffer, b);
			return pixelsToImageFile(img.img, "png", 1);
		},
		description: "Textures from the 'legacy' era, very early rs2"
	}
}

const decodeSprite = (major: number): DecodeModeFactory => () => {
	return {
		ext: "png",
		...noArchiveIndex(major),
		...throwOnNonSimple,
		read(b, id) {
			//TODO support subimgs
			return pixelsToImageFile(parseSprite(b)[0].img, "png", 1);
		},
		description: "Sprites are all images that are used in ui. The client stores sprites are uncompressed bitmaps. Currently only the first frame for multi-frame sprites is extracted."
	}
}

const decodeTexture = (major: number): DecodeModeFactory => () => {
	return {
		ext: "png",
		...noArchiveIndex(major),
		prepareDump() { },
		prepareWrite() { },
		read(b, id) {
			let p = new ParsedTexture(b, false, true);
			return p.toImageData().then(q => pixelsToImageFile(q, "png", 1));
		},
		write(b) { throw new Error("write not supported"); },
		combineSubs(b: Buffer[]) {
			if (b.length != 1) { throw new Error("not supported"); }
			return b[0];
		},
		description: "Textures are images that are wrapped around models to display colors are fine details."
	}
}

const decodeSpriteHash: DecodeModeFactory = () => {
	return {
		ext: "json",
		...noArchiveIndex(cacheMajors.sprites),
		...throwOnNonSimple,
		async read(b, id) {
			let images = parseSprite(b);
			let str = "";
			for (let [sub, img] of images.entries()) {
				const data = img.img.data;
				// for some reason 0 blue isn't possible in-game
				for (let i = 0; i < data.length; i += 4) { if (data[i + 2] == 0) { data[i + 2] = 1; } }
				let hash = crc32(img.img.data);
				str += (str == "" ? "" : ",") + `{"id":${id[0]},"sub":${sub},"hash":${hash}}`;
			}
			return str;
		},
		combineSubs(b: string[]) { return "[" + b.join(",\n") + "]"; },
		description: "Used to efficiently compare images."
	}
}

const decodeMeshHash: DecodeModeFactory = () => {
	return {
		ext: "json",
		...noArchiveIndex(cacheMajors.models),
		...throwOnNonSimple,
		read(b, id, source) {
			let model = parse.models.read(b, source);
			let meshhashes = getModelHashes(model, id[0]);
			return JSON.stringify(meshhashes);
		},
		combineSubs(b: string[]) { return "[" + b.filter(q => q).join(",\n") + "]"; },
		description: "Used to efficiently compare models."
	}
}


export type JsonBasedFile = {
	parser: FileParser<any>,
	lookup: DecodeLookup,
	prepareParser?: (source: CacheFileSource) => Promise<void> | void,
	prepareDump?: (source: CacheFileSource) => Promise<void> | void
}

export const cacheFileJsonModes = constrainedMap<JsonBasedFile>()({
	framemaps: { parser: parse.framemaps, lookup: chunkedIndex(cacheMajors.framemaps) },
	items: { parser: parse.item, lookup: chunkedIndex(cacheMajors.items) },
	enums: { parser: parse.enums, lookup: chunkedIndex(cacheMajors.enums) },
	npcs: { parser: parse.npc, lookup: chunkedIndex(cacheMajors.npcs) },
	soundjson: { parser: parse.audio, lookup: blacklistIndex(standardIndex(cacheMajors.sounds), [{ major: cacheMajors.sounds, minor: 0 }]) },
	musicjson: { parser: parse.audio, lookup: blacklistIndex(standardIndex(cacheMajors.music), [{ major: cacheMajors.music, minor: 0 }]) },
	objects: { parser: parse.object, lookup: chunkedIndex(cacheMajors.objects) },
	achievements: { parser: parse.achievement, lookup: chunkedIndex(cacheMajors.achievements) },
	structs: { parser: parse.structs, lookup: chunkedIndex(cacheMajors.structs) },
	sequences: { parser: parse.sequences, lookup: chunkedIndex(cacheMajors.sequences) },
	spotanims: { parser: parse.spotAnims, lookup: chunkedIndex(cacheMajors.spotanims) },
	materials: { parser: parse.materials, lookup: chunkedIndex(cacheMajors.materials) },
	oldmaterials: { parser: parse.oldmaterials, lookup: singleMinorIndex(cacheMajors.materials, 0) },
	quickchatcats: { parser: parse.quickchatCategories, lookup: singleMinorIndex(cacheMajors.quickchat, 0) },
	quickchatlines: { parser: parse.quickchatLines, lookup: singleMinorIndex(cacheMajors.quickchat, 1) },
	dbtables: { parser: parse.dbtables, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.dbtables) },
	dbrows: { parser: parse.dbrows, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.dbrows) },

	overlays: { parser: parse.mapsquareOverlays, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.mapoverlays) },
	identitykit: { parser: parse.identitykit, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.identityKit) },
	params: { parser: parse.params, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.params) },
	underlays: { parser: parse.mapsquareUnderlays, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.mapunderlays) },
	mapscenes: { parser: parse.mapscenes, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.mapscenes) },
	environments: { parser: parse.environments, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.environments) },
	animgroupconfigs: { parser: parse.animgroupConfigs, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.animgroups) },
	maplabels: { parser: parse.maplabels, lookup: singleMinorIndex(cacheMajors.config, cacheConfigPages.maplabels) },
	mapzones: { parser: parse.mapZones, lookup: singleMinorIndex(cacheMajors.worldmap, 0) },
	cutscenes: { parser: parse.cutscenes, lookup: noArchiveIndex(cacheMajors.cutscenes) },

	particles0: { parser: parse.particles_0, lookup: singleMinorIndex(cacheMajors.particles, 0) },
	particles1: { parser: parse.particles_1, lookup: singleMinorIndex(cacheMajors.particles, 1) },

	maptiles: { parser: parse.mapsquareTiles, lookup: worldmapIndex(cacheMapFiles.squares) },
	maptiles_nxt: { parser: parse.mapsquareTilesNxt, lookup: worldmapIndex(cacheMapFiles.square_nxt) },
	maplocations: { parser: parse.mapsquareLocations, lookup: worldmapIndex(cacheMapFiles.locations) },
	mapenvs: { parser: parse.mapsquareEnvironment, lookup: worldmapIndex(cacheMapFiles.env) },
	maptiles_old: { parser: parse.mapsquareTiles, lookup: oldWorldmapIndex("m") },
	maplocations_old: { parser: parse.mapsquareLocations, lookup: oldWorldmapIndex("l") },

	frames: { parser: parse.frames, lookup: standardIndex(cacheMajors.frames) },
	models: { parser: parse.models, lookup: noArchiveIndex(cacheMajors.models) },
	oldmodels: { parser: parse.oldmodels, lookup: noArchiveIndex(cacheMajors.oldmodels) },
	skeletons: { parser: parse.skeletalAnim, lookup: noArchiveIndex(cacheMajors.skeletalAnims) },
	proctextures: { parser: parse.proctexture, lookup: noArchiveIndex(cacheMajors.texturesOldPng) },
	oldproctextures: { parser: parse.oldproctexture, lookup: singleMinorIndex(cacheMajors.texturesOldPng, 0) },
	interfaces: { parser: parse.interfaces, lookup: standardIndex(cacheMajors.interfaces) },

	classicmodels: { parser: parse.classicmodels, lookup: singleMinorIndex(0, classicGroups.models) },

	indices: { parser: parse.cacheIndex, lookup: indexfileIndex() },
	rootindex: { parser: parse.rootCacheIndex, lookup: rootindexfileIndex() },

	test: { parser: FileParser.fromJson(`["struct",\n  \n]`), lookup: anyFileIndex() },

	clientscriptops: { parser: parse.clientscript, lookup: noArchiveIndex(cacheMajors.clientscript), prepareParser: source => prepareClientScript(source).then(() => undefined) },
});

const npcmodels: DecodeModeFactory = function () {
	return {
		...chunkedIndex(cacheMajors.npcs),
		ext: "json",
		prepareDump(output) { },
		prepareWrite() { },
		read(b, id, source) {
			let obj = parse.npc.read(b, source);
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
		},
		description: "Extract model metadata from npc configs."
	}
}

const cacheFileDecodersImage = constrainedMap<DecodeModeFactory>()({
	sprites: decodeSprite(cacheMajors.sprites),
	textures_dds: decodeTexture(cacheMajors.texturesDds),
	textures_png: decodeTexture(cacheMajors.texturesPng),
	textures_bmp: decodeTexture(cacheMajors.texturesBmp),
	textures_ktx: decodeTexture(cacheMajors.texturesKtx)
});

const cacheFileDecodersLegacyImage = constrainedMap<DecodeModeFactory>()({
	legacy_sprites: decodeLegacySprite(legacyGroups.sprites),
	legacy_textures: decodeLegacySprite(legacyGroups.textures),
	textures_proc: decodeOldProcTexture,
	textures_oldpng: decodeTexture(cacheMajors.texturesOldPng),
	textures_2015png: decodeTexture(cacheMajors.textures2015Png),
	textures_2015dds: decodeTexture(cacheMajors.textures2015Dds),
	textures_2015pngmips: decodeTexture(cacheMajors.textures2015PngMips),
	textures_2015compoundpng: decodeTexture(cacheMajors.textures2015CompoundPng),
	textures_2015compounddds: decodeTexture(cacheMajors.textures2015CompoundDds),
	textures_2015compoundpngmips: decodeTexture(cacheMajors.textures2015CompoundPngMips),
});
const cacheFileDecodersSound = constrainedMap<DecodeModeFactory>()({
	sounds: decodeSound(cacheMajors.sounds, true),
	musicfragments: decodeSound(cacheMajors.music, false),
	music: decodeMusic,
});
const cacheFileDecodersInteractive = constrainedMap<DecodeModeFactory>()({
	cutscenehtml: decodeCutscene,
	interfacehtml: decodeInterface,
	interfaceviewer: decodeInterface2,
	clientscript: decodeClientScript,
	clientscriptviewer: decodeClientScriptViewer,
})
const cacheFileDecodersOther = constrainedMap<DecodeModeFactory>()({
	bin: decodeBinary,
	spritehash: decodeSpriteHash,
	modelhash: decodeMeshHash,
	npcmodels: npcmodels,
});

const cacheFileDecodersJson = (Object.fromEntries(Object.entries(cacheFileJsonModes)
	.map(([k, v]) => [k, standardFile(v.parser, v.lookup, v.prepareDump, v.prepareParser)])) as Record<keyof typeof cacheFileJsonModes, DecodeModeFactory>)

export const cacheFileDecodeGroups = {
	image: cacheFileDecodersImage,
	legacyImage: cacheFileDecodersLegacyImage,
	interactive: cacheFileDecodersInteractive,
	sound: cacheFileDecodersSound,
	other: cacheFileDecodersOther,
	json: cacheFileDecodersJson,
}

export const cacheFileDecodeModes = Object.fromEntries(Object.values(cacheFileDecodeGroups).flatMap(q => Object.entries(q)))