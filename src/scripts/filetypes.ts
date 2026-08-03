
import { cacheConfigPages, cacheMajors, cacheMapFiles, internalNameFiles, lastClassicBuildnr, lastLegacyBuildnr } from "../constants";
import { parse, FileParser } from "../opdecoder";
import { Archive, archiveToFileId, CacheFileSource, CacheIndex, fileIdToArchiveminor, SubFile } from "../cache";
import { cacheFilenameHash, constrainedMap } from "../utils";
import prettyJson from "json-stringify-pretty-compact";
import { ScriptFS, ScriptOutput } from "../scriptrunner";
import { JSONSchema6Definition } from "json-schema";
import { parseLegacySprite, parseSprite, parseTgaSprite, spriteHash } from "../3d/materials/sprite";
import { pixelsToImageFile } from "../imgutils";
import { getModelHashes, EngineCache } from "../3d/modeltothree";
import { ParsedTexture } from "../3d/materials/textures";
import { parseMusic } from "./musictrack";
import { legacyGroups, legacyMajors } from "../cache/legacycache";
import { classicGroups } from "../cache/classicloader";
import { renderCutscene } from "./rendercutscene";
import { UiRenderContext, renderRsInterfaceHTML } from "./renderrsinterface";
import { compileClientScript, prepareClientScript, renderClientScript, writeClientVarFile, writeOpcodeFile } from "../clientscript";
import { loadFontMetrics } from "./fontmetrics";


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
	combineSubs(b: Buffer[]) { throw new Error("batch output mode not supported"); }
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

function standardFile(mode: JsonBasedFile<any>, decodername: string): DecodeModeFactory {
	let constr = ((args: Record<string, string>) => {
		let singleschemaurl = "";
		let batchschemaurl = "";
		return {
			...mode.lookup,
			ext: "json",
			parser: mode.parser,
			async prepareDump(output, source) {
				await mode.prepareParser?.(source);
				await mode.prepareDump?.(source);
				let name = Object.entries(cacheFileDecodeModes).find(q => q[1] == constr);
				if (!name) { throw new Error(); }
				let schema = mode.parser.parser.getJsonSchema();
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
				return (typeof mode.namefile == "number" ? source.getInternalNameList(mode.namefile) : undefined);
			},
			async prepareWrite(source) {
				await mode.prepareParser?.(source);
			},
			read(b, id, source, ctx) {
				let obj = mode.parser.read(b, source, { keepbuffers: args.keepbuffers });

				let filename = ctx?.get(id[0]);
				if (filename) { obj.$filename = filename; }
				obj.$fileid = (id.length == 1 ? id[0] : id);
				obj.$decoder = decodername;
				if (!args.batched) {
					obj.$schema = singleschemaurl;
				}
				return prettyJson(obj);
			},
			write(b, id, source) {
				return mode.parser.write(JSON.parse(b.toString("utf8")), source.getDecodeArgs());
			},
			combineSubs(b) {
				return `{"$schema":"${batchschemaurl}","files":[\n\n${b.join("\n,\n\n")}]}`;
			},
			description: "View the JSON representation of a file",
			flagtemplate: {
				keepbuffers: { text: "Keep binary buffers (can be very large)", type: "boolean" }
			}
		}
	}) satisfies DecodeModeFactory<string, Map<number, string> | undefined>;

	return constr;
}

export type DecodeModeFactory<T = Buffer | string, CTX = any> = (flags: Record<string, string>) => DecodeMode<T, CTX>;

type FileId = { major: number, minor: number, subid: number };

type DecodeLookup = {
	major: number | undefined,
	minor: number | undefined,
	logicalDimensions: number,
	usesArchieves: boolean,
	logicalRangeToFiles(source: CacheFileSource, start: LogicalIndex, end: LogicalIndex): Promise<CacheFileId[]>,
	fileToLogical(source: CacheFileSource, major: number, minor: number, subfile: number): LogicalIndex,
	logicalToFile(source: CacheFileSource, id: LogicalIndex): FileId
}

export type DecodeMode<T = Buffer | string, CTX = void> = {
	ext: string,
	parser?: FileParser<any>,
	read(buf: Buffer, fileid: LogicalIndex, source: CacheFileSource, ctx: CTX | undefined): T | Promise<T>,
	prepareDump(output: ScriptFS, source: CacheFileSource): Promise<CTX> | CTX,
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

const fontViewer: DecodeModeFactory = () => {
	return {
		ext: "font.json",
		major: cacheMajors.fontmetrics,
		minor: undefined,
		logicalDimensions: 1,
		usesArchieves: false,
		fileToLogical(source, major, minor, subfile) { if (subfile != 0) { throw new Error("subfile 0 expected") } return [minor]; },
		logicalToFile(source, id) { return { major: cacheMajors.fontmetrics, minor: id[0], subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			let indexfile = await source.getCacheIndex(cacheMajors.fontmetrics);
			return indexfile.filter(q => q && q.minor >= start[0] && q.minor <= end[0]).map(q => ({ index: q, subindex: 0 }));
		},
		...throwOnNonSimple,
		async read(buf, fileid, source) {
			return JSON.stringify(await loadFontMetrics(source, buf, fileid[0], true));
		},
		description: "Opens the built-in font viewer. Does not support newer vector fonts"
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
			if (b.length != 1) { throw new Error("texture batching not supported"); }
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
				let hash = spriteHash(img.img);
				str += (str == "" ? "" : ",") + `{"id":${id[0]},"sub":${sub},"hash":${hash}}`;
			}
			return str;
		},
		combineSubs(b: string[]) { return "[" + b.join(",\n") + "]"; },
		description: "Used to efficiently compare images."
	}
}

const decodeFontHash: DecodeModeFactory = () => {
	return {
		ext: "json",
		...noArchiveIndex(cacheMajors.fontmetrics),
		...throwOnNonSimple,
		async read(buf, id, source) {
			return JSON.stringify(await loadFontMetrics(source, buf, id[0]));
		},
		combineSubs(b: string[]) { return "[" + b.join(",\n") + "]"; },
		description: "Used to efficiently compare fonts."
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


export type JsonBasedFile<T> = {
	parser: FileParser<T>,
	lookup: DecodeLookup,
	namefile?: number,
	prepareParser?: (source: CacheFileSource) => Promise<void> | void,
	prepareDump?: (source: CacheFileSource) => Promise<void> | void
}

function JsonBasedFile<T>(parser: FileParser<T>, lookup: DecodeLookup, namefile?: number, prepareParser?: JsonBasedFile<T>["prepareParser"], prepareDump?: JsonBasedFile<T>["prepareDump"]): JsonBasedFile<T> {
	return { parser, lookup, namefile, prepareParser, prepareDump };
}

export const cacheFileJsonModes = {
	framemaps: JsonBasedFile(parse.framemaps, chunkedIndex(cacheMajors.framemaps)),
	items: JsonBasedFile(parse.item, chunkedIndex(cacheMajors.items), internalNameFiles.obj),
	enums: JsonBasedFile(parse.enums, chunkedIndex(cacheMajors.enums), internalNameFiles.enum),
	npcs: JsonBasedFile(parse.npc, chunkedIndex(cacheMajors.npcs), internalNameFiles.npc),
	soundjson: JsonBasedFile(parse.audio, blacklistIndex(standardIndex(cacheMajors.sounds), [{ major: cacheMajors.sounds, minor: 0 }]), internalNameFiles.sound),
	musicjson: JsonBasedFile(parse.audio, blacklistIndex(standardIndex(cacheMajors.music), [{ major: cacheMajors.music, minor: 0 }])),
	locs: JsonBasedFile(parse.loc, chunkedIndex(cacheMajors.locs), internalNameFiles.loc),
	achievements: JsonBasedFile(parse.achievement, chunkedIndex(cacheMajors.achievements), internalNameFiles.achievement),
	structs: JsonBasedFile(parse.structs, chunkedIndex(cacheMajors.structs), internalNameFiles.struct),
	sequences: JsonBasedFile(parse.sequences, chunkedIndex(cacheMajors.sequences), internalNameFiles.seq),
	spotanims: JsonBasedFile(parse.spotAnims, chunkedIndex(cacheMajors.spotanims)),
	materials: JsonBasedFile(parse.materials, chunkedIndex(cacheMajors.materials), internalNameFiles.material),
	oldmaterials: JsonBasedFile(parse.oldmaterials, singleMinorIndex(cacheMajors.materials, 0)),
	quickchatcats: JsonBasedFile(parse.quickchatCategories, singleMinorIndex(cacheMajors.quickchat, 0)),
	quickchatlines: JsonBasedFile(parse.quickchatLines, singleMinorIndex(cacheMajors.quickchat, 1)),
	dbtables: JsonBasedFile(parse.dbtables, singleMinorIndex(cacheMajors.config, cacheConfigPages.dbtables), internalNameFiles.dbtable),
	dbrows: JsonBasedFile(parse.dbrows, singleMinorIndex(cacheMajors.config, cacheConfigPages.dbrows), internalNameFiles.dbrow),
	quests: JsonBasedFile(parse.quest, singleMinorIndex(cacheMajors.config, cacheConfigPages.quests), internalNameFiles.quest),
	
	varbits: JsonBasedFile(parse.varbits, singleMinorIndex(cacheMajors.config, cacheConfigPages.varbits)),
	var_player: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varplayer), internalNameFiles.var_player),
	var_npc: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varnpc), internalNameFiles.var_npc),
	var_client: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varclient), internalNameFiles.var_client),
	var_world: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varworld)),
	var_region: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varregion)),
	var_object: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varobject), internalNameFiles.var_object),
	var_clan: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varclan), internalNameFiles.var_clan),
	var_clansetting: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varclansettings), internalNameFiles.var_clan_setting),
	var_campaign: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varcampaign)),
	var_player_group: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varplayergroup), internalNameFiles.var_player_group),

	overlays: JsonBasedFile(parse.mapsquareOverlays, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapoverlays)),
	identitykit: JsonBasedFile(parse.identitykit, singleMinorIndex(cacheMajors.config, cacheConfigPages.identityKit)),
	params: JsonBasedFile(parse.params, singleMinorIndex(cacheMajors.config, cacheConfigPages.params), internalNameFiles.param),
	underlays: JsonBasedFile(parse.mapsquareUnderlays, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapunderlays)),
	mapscenes: JsonBasedFile(parse.mapscenes, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapscenes)),
	environments: JsonBasedFile(parse.environments, singleMinorIndex(cacheMajors.config, cacheConfigPages.environments)),
	animgroupconfigs: JsonBasedFile(parse.animgroupConfigs, singleMinorIndex(cacheMajors.config, cacheConfigPages.animgroups), internalNameFiles.bas),
	cursors: JsonBasedFile(parse.cursors, singleMinorIndex(cacheMajors.config, cacheConfigPages.cursors), internalNameFiles.cursor),
	maplabels: JsonBasedFile(parse.maplabels, singleMinorIndex(cacheMajors.config, cacheConfigPages.maplabels), internalNameFiles.maplabel),
	maplabellocations: JsonBasedFile(parse.maplabellocations, standardIndex(cacheMajors.maplabellocations)),
	mapzones: JsonBasedFile(parse.mapZones, singleMinorIndex(cacheMajors.worldmap, 0)),
	mappastes: JsonBasedFile(parse.mapPastes, singleMinorIndex(cacheMajors.worldmap, 1)),
	mapzones_sub3: JsonBasedFile(parse.mapZonesSub3, singleMinorIndex(cacheMajors.worldmap, 3)),
	mapzones_sub4: JsonBasedFile(parse.mapZonesSub4, singleMinorIndex(cacheMajors.worldmap, 4)),
	cutscenes: JsonBasedFile(parse.cutscenes, noArchiveIndex(cacheMajors.cutscenes), internalNameFiles.ui_anim),

	particles0: JsonBasedFile(parse.particles_0, singleMinorIndex(cacheMajors.particles, 0)),
	particles1: JsonBasedFile(parse.particles_1, singleMinorIndex(cacheMajors.particles, 1)),

	maptiles: JsonBasedFile(parse.mapsquareTiles, worldmapIndex(cacheMapFiles.squares)),
	maptiles_nxt: JsonBasedFile(parse.mapsquareTilesNxt, worldmapIndex(cacheMapFiles.square_nxt)),
	maplocations: JsonBasedFile(parse.mapsquareLocations, worldmapIndex(cacheMapFiles.locations)),
	mapenvs: JsonBasedFile(parse.mapsquareEnvironment, worldmapIndex(cacheMapFiles.env)),
	maptiles_old: JsonBasedFile(parse.mapsquareTiles, oldWorldmapIndex("m")),
	maplocations_old: JsonBasedFile(parse.mapsquareLocations, oldWorldmapIndex("l")),

	frames: JsonBasedFile(parse.frames, standardIndex(cacheMajors.frames)),
	models: JsonBasedFile(parse.models, noArchiveIndex(cacheMajors.models), internalNameFiles.model),
	oldmodels: JsonBasedFile(parse.oldmodels, noArchiveIndex(cacheMajors.oldmodels)),
	skeletons: JsonBasedFile(parse.skeletalAnim, noArchiveIndex(cacheMajors.skeletalAnims)),
	proctextures: JsonBasedFile(parse.proctexture, noArchiveIndex(cacheMajors.texturesOldPng)),
	oldproctextures: JsonBasedFile(parse.oldproctexture, singleMinorIndex(cacheMajors.texturesOldPng, 0)),
	interfaces: JsonBasedFile(parse.interfaces, standardIndex(cacheMajors.interfaces), internalNameFiles.interface),
	fontmetrics: JsonBasedFile(parse.fontmetrics, standardIndex(cacheMajors.fontmetrics), internalNameFiles.fontmetrics),

	classicmodels: JsonBasedFile(parse.classicmodels, singleMinorIndex(0, classicGroups.models)),

	indices: JsonBasedFile(parse.cacheIndex, indexfileIndex()),
	rootindex: JsonBasedFile(parse.rootCacheIndex, rootindexfileIndex()),

	test: JsonBasedFile(FileParser.fromJson(`["struct",\n  \n]`), anyFileIndex()),

	clientscriptops: JsonBasedFile(parse.clientscript, noArchiveIndex(cacheMajors.clientscript), undefined, source => prepareClientScript(source).then(() => undefined)),
} satisfies Record<string, JsonBasedFile<any>>;

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
	fontviewer: fontViewer,
	clientscript: decodeClientScript,
	clientscriptviewer: decodeClientScriptViewer,
})
const cacheFileDecodersOther = constrainedMap<DecodeModeFactory>()({
	bin: decodeBinary,
	spritehash: decodeSpriteHash,
	fonthash: decodeFontHash,
	modelhash: decodeMeshHash,
	npcmodels: npcmodels,
});

const cacheFileDecodersJson = (Object.fromEntries(Object.entries(cacheFileJsonModes)
	.map(([k, v]) => [k, standardFile(v as JsonBasedFile<any>, k)])) as Record<keyof typeof cacheFileJsonModes, DecodeModeFactory>)

export const cacheFileDecodeGroups = {
	image: cacheFileDecodersImage,
	legacyImage: cacheFileDecodersLegacyImage,
	interactive: cacheFileDecodersInteractive,
	sound: cacheFileDecodersSound,
	other: cacheFileDecodersOther,
	json: cacheFileDecodersJson,
}

export const cacheFileDecodeModes = Object.fromEntries(Object.values(cacheFileDecodeGroups).flatMap(q => Object.entries(q)))