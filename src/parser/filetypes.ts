
import { cacheConfigPages, cacheMajors, internalNameFiles } from "../constants";
import { parse, FileParser, JsonBasedFile, cacheFileJsonModes } from "./jsondecoders";
import { CacheFileSource } from "../cache";
import { constrainedMap } from "../utils";
import prettyJson from "json-stringify-pretty-compact";
import { ScriptFS } from "../scriptrunner";
import { JSONSchema6Definition } from "json-schema";
import { parseLegacySprite, parseSprite, spriteHash } from "../3d/materials/sprite";
import { pixelsToImageFile } from "../imgutils";
import { getModelHashes } from "../3d/modeltothree";
import { ParsedTexture } from "../3d/materials/textures";
import { parseMusic } from "../scripts/musictrack";
import { legacyGroups, legacyMajors } from "../cache/legacycache";
import { renderCutscene } from "../scripts/rendercutscene";
import { UiRenderContext, renderRsInterfaceHTML } from "../scripts/renderrsinterface";
import { ClientScriptDeobLoader, compileClientScript, renderClientScript, writeClientVarFile, writeOpcodeFile } from "../clientscript";
import { loadFontMetrics } from "../scripts/fontmetrics";
import { anyFileIndex, CacheFileId, chunkedIndex, DecodeLookup, LogicalIndex, noArchiveIndex, singleMinorIndex, standardIndex } from "./filelookup";
import { crc32 } from "../libs/crc32util";
import { renderSlideshow } from "../scripts/renderslideshow";


export type DecodeModeFactory<T = Buffer | string, CTX = any> = (flags: Record<string, string>) => DecodeMode<T, CTX>;

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

const throwOnNonSimple = {
	prepareDump() { },
	prepareWrite() { },
	write() { throw new Error("write not supported"); },
	combineSubs(b: Buffer[]) { throw new Error("batch output mode not supported"); }
}


function standardFile(mode: JsonBasedFile<any>, decodername: string): DecodeModeFactory {
	let constr = ((args: Record<string, string>) => {
		let singleschemaurl = "";
		let batchschemaurl = "";
		return {
			ext: "json",
			...mode.lookup,
			parser: mode.parser,
			async prepareDump(output, source) {
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
				return (typeof mode.lookup.internalNamefile == "number" ? source.getInternalNameList(mode.lookup.internalNamefile) : undefined);
			},
			async prepareWrite(source) {
				// nop
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
		internalNamefile: internalNameFiles.midi,
		fileToLogical(source, major, minor, subfile) { return [minor]; },
		logicalToFile(source, id) { return { major: cacheMajors.music, minor: id[0], subid: 0 }; },
		async logicalRangeToFiles(source, start, end) {
			// the music index contains ~10sec music fragments, only a small fraction of those are header fragments
			// only these header fragments contain a list of fragment ids that make up the music track
			// brute force searching for these tracks is not feasible.
			// use the cs2 internal name file to find the header ids if it exists
			// otherwise fall back to using the enum 1351 which contains a music tracks shown in-game (but excludes hidden tracks)
			let indexfile = await source.getCacheIndex(cacheMajors.music);
			let namefile = await source.getInternalNameList(internalNameFiles.midi);
			if (namefile.size != 0) {
				return [...namefile.keys()]
					.filter(q => q >= start[0] && q <= end[0])
					.map<CacheFileId>(q => ({ index: indexfile[q], subindex: 0 }));
			} else {
				let enumdata = await source.getObject("enums", 1351);
				return enumdata.intArrayValue2!.values
					.filter(q => q[1] >= start[0] && q[1] <= end[0])
					.sort((a, b) => a[1] - b[1])
					.filter((q, i, arr) => i == 0 || arr[i - 1][1] != q[1])//filter duplicates
					.map<CacheFileId>(q => ({ index: indexfile[q[1]], subindex: 0 }))
			}
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
		...noArchiveIndex(major, internalNameFiles.sound),
		...throwOnNonSimple,
		read(buf, fileid, source) {
			return parseMusic(source, major, fileid[0], buf, allowdownload);
		},
		description: "Extracts sound files from cache"
	}
}

const decodeSlideshow: DecodeModeFactory = () => {
	return {
		ext: "html",
		major: cacheMajors.config,
		minor: cacheConfigPages.dbrows,
		logicalDimensions: 1,
		usesArchieves: true,
		internalNamefile: undefined,
		fileToLogical(source, major, minor, subfile) { return [subfile]; },
		logicalToFile(source, id) { return { major: cacheMajors.config, minor: cacheConfigPages.dbrows, subid: id[0] }; },
		async logicalRangeToFiles(source, start, end) {
			let dbarch = await source.getArchiveById(cacheMajors.config, cacheConfigPages.dbrows);
			let indexfile = await source.getCacheIndex(cacheMajors.config);
			let ids: number[] = [];
			for (let subfile of dbarch) {
				if (subfile.fileid < start[0] || subfile.fileid > end[0]) { continue; }
				let dbrow = parse.dbrows.read(subfile.buffer, source);
				if (dbrow.table == 40) { ids.push(subfile.fileid); }
			}
			return ids.map(q => ({ index: indexfile[cacheConfigPages.dbrows], subindex: q }));
		},
		...throwOnNonSimple,
		async read(buf, fileid, source) {
			let res = await renderSlideshow(source, parse.dbrows.read(buf, source));
			return res.doc;
		},
		description: ""
	}
}

const decodeCutscene: DecodeModeFactory = () => {
	return {
		ext: "html",
		...noArchiveIndex(cacheMajors.cutscenes),
		...throwOnNonSimple,
		async read(buf, fileid, source) {
			let parsed = parse.cutscenes.read(buf, source);
			let res = await renderCutscene(source, parsed, crc32(buf) >>> 0);
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
		internalNamefile: internalNameFiles.interface,
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
		internalNamefile: internalNameFiles.interface,
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
		...noArchiveIndex(cacheMajors.fontmetrics, internalNameFiles.fontmetrics),
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
			let calli = await ClientScriptDeobLoader.forCache(source).loadOrGenerate(source);
			out.writeFile("tsconfig.json", JSON.stringify({ "compilerOptions": { "lib": [], "target": "ESNext" } }, undefined, "\t"));//tsconfig to make the folder a project
			out.writeFile("opcodes.d.ts", writeOpcodeFile(calli));
			out.writeFile("clientvars.d.ts", writeClientVarFile(calli));
		},
		async read(buf, fileid, source) {
			let { writer, rootfunc } = await renderClientScript(source, buf, fileid[0], ops.cs2relativecomps == "true", ops.cs2notypes == "true", ops.cs2intcasts == "true");
			return writer.getCodeString(rootfunc);
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
			await ClientScriptDeobLoader.forCache(source).loadOrGenerate(source);
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
		...singleMinorIndex(legacyMajors.data, minor, internalNameFiles.graphic),
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
		...noArchiveIndex(major, internalNameFiles.graphic),
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
		...noArchiveIndex(cacheMajors.sprites, internalNameFiles.graphic),
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
		...noArchiveIndex(cacheMajors.fontmetrics, internalNameFiles.fontmetrics),
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
		...noArchiveIndex(cacheMajors.models, internalNameFiles.model),
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

const npcmodels: DecodeModeFactory = function () {
	return {
		ext: "json",
		...chunkedIndex(cacheMajors.npcs, internalNameFiles.npc),
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
	slideshowhtml: decodeSlideshow,
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