import { cacheConfigPages, cacheMajors } from "../constants";
import { parse, FileParser } from "../opdecoder";
import { archiveToFileId, CacheFileSource, CacheIndexFile } from "../cache";
import prettyJson from "json-stringify-pretty-compact";
import { ScriptFS, ScriptOutput } from "../scriptrunner";
import { ParsedTexture } from "../3d/textures";
import { parseSprite } from "../3d/sprite";
import { pixelsToImageFile } from "../imgutils";
import { FileRange } from "../utils";
import { UiRenderContext, renderRsInterfaceHTML } from "./renderrsinterface";


type FileAction = {
	name: string,
	comparesubfiles: boolean,
	parser: FileParser<any> | null,
	outputType: string,
	getFileName: (major: number, minor: number, subfile: number) => string
} & ({
	outputType: "rstex" | "png" | "bin" | "html",//TODO better system for non-json files
} | {
	outputType: "json",
	parser: FileParser<any>
})

//TODO merge all this with defs in extract
function chunkedIndexName(major: number, minor: number, subfile: number) {
	let name = majormap[major]?.name ?? `${major}`;
	return `${name}-${archiveToFileId(major, minor, subfile)}`;
}
function standardName(major: number, minor: number, subfile: number) {
	let name = majormap[major]?.name ?? `${major}`;
	return `${name}-${major}_${minor}${subfile != -1 ? `_${subfile}` : ""}`;
}
function worldmapFilename(major: number, minor: number, subfile: number) {
	const worldStride = 128;
	return `mapsquare-${minor % worldStride}_${Math.floor(minor / worldStride)}`;
}
function subfileFilename(major: number, minor: number, subfile: number) {
	return subfile + "";
}

let configmap: Record<number, FileAction> = {
	[cacheConfigPages.mapoverlays]: { name: "overlays", comparesubfiles: true, parser: parse.mapsquareOverlays, outputType: "json", getFileName: subfileFilename },
	[cacheConfigPages.mapunderlays]: { name: "underlays", comparesubfiles: true, parser: parse.mapsquareUnderlays, outputType: "json", getFileName: subfileFilename },
	[cacheConfigPages.mapscenes]: { name: "mapsscenes", comparesubfiles: true, parser: parse.mapscenes, outputType: "json", getFileName: subfileFilename }
}

let majormap: Record<number, FileAction | ((major: number, minor: number) => FileAction)> = {
	[cacheMajors.objects]: { name: "loc", comparesubfiles: true, parser: parse.object, outputType: "json", getFileName: chunkedIndexName },
	[cacheMajors.items]: { name: "item", comparesubfiles: true, parser: parse.item, outputType: "json", getFileName: chunkedIndexName },
	[cacheMajors.npcs]: { name: "npc", comparesubfiles: true, parser: parse.npc, outputType: "json", getFileName: chunkedIndexName },
	[cacheMajors.models]: { name: "model", comparesubfiles: false, parser: parse.models, outputType: "json", getFileName: standardName },
	[cacheMajors.oldmodels]: { name: "oldmodel", comparesubfiles: false, parser: parse.oldmodels, outputType: "json", getFileName: standardName },
	[cacheMajors.mapsquares]: { name: "mapsquare", comparesubfiles: false, parser: null, outputType: "bin", getFileName: worldmapFilename },
	[cacheMajors.enums]: { name: "enum", comparesubfiles: true, parser: parse.enums, outputType: "json", getFileName: chunkedIndexName },
	[cacheMajors.sequences]: { name: "sequence", comparesubfiles: true, parser: parse.sequences, outputType: "json", getFileName: chunkedIndexName },
	[cacheMajors.spotanims]: { name: "spotanim", comparesubfiles: true, parser: parse.spotAnims, outputType: "json", getFileName: chunkedIndexName },
	[cacheMajors.achievements]: { name: "achievements", comparesubfiles: true, parser: parse.achievement, outputType: "json", getFileName: chunkedIndexName },
	[cacheMajors.materials]: { name: "material", comparesubfiles: true, parser: parse.materials, outputType: "json", getFileName: chunkedIndexName },
	[cacheMajors.texturesBmp]: { name: "texturesBmp", comparesubfiles: false, parser: null, outputType: "png", getFileName: standardName },
	[cacheMajors.texturesDds]: { name: "texturesDds", comparesubfiles: false, parser: null, outputType: "png", getFileName: standardName },
	[cacheMajors.texturesPng]: { name: "texturesPng", comparesubfiles: false, parser: null, outputType: "png", getFileName: standardName },
	[cacheMajors.texturesKtx]: { name: "texturesKtx", comparesubfiles: false, parser: null, outputType: "png", getFileName: standardName },
	[cacheMajors.sprites]: { name: "sprites", comparesubfiles: false, parser: null, outputType: "png", getFileName: standardName },
	[cacheMajors.cutscenes]: { name: "cutscenes", comparesubfiles: false, parser: parse.cutscenes, outputType: "json", getFileName: standardName },
	[cacheMajors.interfaces]: { name: "interfaces", comparesubfiles: false, parser: null, outputType: "html", getFileName: standardName },
	//need to first run deob first before this works
	// [cacheMajors.clientscript]: { name: "clientscript", comparesubfiles: false, parser: parse.clientscript, outputType: "json", getFileName: standardName },
	[cacheMajors.config]: (major, minor) => configmap[minor]
}

function defaultAction(major: number) {
	let majorname = Object.entries(cacheMajors).find(q => q[1] == major)?.[0] ?? `unk_${major}`;
	let r: FileAction = { name: majorname, comparesubfiles: false, parser: null, outputType: "bin", getFileName: standardName };
	return r;
}

type CacheEditType = "add" | "delete" | "edit";

class Loadable {
	source: CacheFileSource;
	major: number;
	minor: number;
	crc: number;
	constructor(source: CacheFileSource, major: number, minor: number, crc: number) {
		this.source = source;
		this.major = major;
		this.minor = minor;
		this.crc = crc;
	}
	load() {
		return this.source.getFile(this.major, this.minor, this.crc);
	}
}

export class FileEdit {
	type: CacheEditType;
	major: number;
	minor: number;
	subfile: number;
	action: FileAction;
	before: Buffer | Loadable | null;
	after: Buffer | Loadable | null;
	constructor(action: FileAction, type: CacheEditType, major: number, minor: number, subfile: number, before: Buffer | Loadable | null, after: Buffer | Loadable | null) {
		this.action = action;
		this.type = type;
		this.major = major;
		this.minor = minor;
		this.subfile = subfile;
		this.before = before;
		this.after = after;
	}

	async getBefore() {
		try {
			if (this.before == null) { throw new Error("no before file"); }
			if (Buffer.isBuffer(this.before)) { return this.before; }
			return await this.before.load();
		} catch (e) {
			return null;
		}
	}

	async getAfter() {
		try {
			if (this.after == null) { throw new Error("no after file"); }
			if (Buffer.isBuffer(this.after)) { return this.after; }
			return await this.after.load();
		} catch (e) {
			return null;
		}
	}
}

export async function compareCacheMajors(output: ScriptOutput, sourcea: CacheFileSource | null | undefined, sourceb: CacheFileSource | null | undefined, major: number, minorstart = 0, minorend = 1 << 30) {
	//sources can be empty, allow diffing to nothing
	let indexa: CacheIndexFile = [];
	let indexb: CacheIndexFile = [];
	try {
		if (sourcea) {
			indexa = await sourcea.getCacheIndex(major);
		}
	} catch (e) { }
	try {
		if (sourceb) {
			indexb = await sourceb.getCacheIndex(major);
		}
	} catch (e) { }

	let len = Math.max(indexa.length, indexb.length);

	let changes: FileEdit[] = [];
	let actionarg = majormap[major] ?? defaultAction(major);
	// if (typeof actionarg == "function") {
	// 	output.log(`checking major ${major}, different settings per minor`);
	// } else {
	// 	output.log(`checking major ${major} ${actionarg.name} subfiles:${actionarg.comparesubfiles}`);
	// }

	minorstart = Math.max(0, minorstart);
	minorend = Math.min(len, minorend);
	for (let i = minorstart; i < minorend; i++) {
		if (output.state != "running") { break; }

		var action = (typeof actionarg == "function" ? actionarg(major, i) ?? defaultAction(major) : actionarg);

		let metaa = indexa[i], metab = indexb[i];
		if (metaa || metab) {
			if (!metaa || !metab || metaa.version != metab.version) {
				if (action.comparesubfiles) {
					try {
						var archa = (metaa && sourcea ? await sourcea.getFileArchive(metaa) : []);
						var archb = (metab && sourceb ? await sourceb.getFileArchive(metab) : []);
					} catch (e) {
						output.log((e as Error).message);
						continue;
					}
					for (let a = 0, b = 0; ;) {
						let filea = archa[a], fileb = archb[b];
						if (filea && (!fileb || filea.fileid < fileb.fileid)) {
							a++;
							changes.push(new FileEdit(action, "delete", metaa.major, metaa.minor, filea.fileid, filea.buffer, null));
						} else if (fileb && (!filea || fileb.fileid < filea.fileid)) {
							b++;
							changes.push(new FileEdit(action, "add", metab.major, metab.minor, fileb.fileid, null, fileb.buffer));
						} else if (filea && fileb && filea.fileid == fileb.fileid) {
							if (Buffer.compare(filea.buffer, fileb.buffer) != 0) {
								changes.push(new FileEdit(action, "edit", metaa.major, metaa.minor, filea.fileid, filea.buffer, fileb.buffer));
							}
							a++;
							b++;
						} else if (!filea && !fileb) {
							break;
						} else {
							output.log(filea, fileb);
							throw new Error("shouldnt happen");
						}
					}
				} else {
					if (!metaa) {
						let file = (!sourceb ? null : new Loadable(sourceb, metab.major, metab.minor, metab.crc));
						changes.push(new FileEdit(action, "add", metab.major, metab.minor, -1, null, file));
					} else if (!metab) {
						let file = (!sourcea ? null : new Loadable(sourcea, metaa.major, metaa.minor, metaa.crc));
						changes.push(new FileEdit(action, "delete", metaa.major, metaa.minor, -1, file, null));
					} else {
						let before = (!sourcea ? null : new Loadable(sourcea, metaa.major, metaa.minor, metaa.crc));
						let after = (!sourceb ? null : new Loadable(sourceb, metab.major, metab.minor, metab.crc));
						changes.push(new FileEdit(action, "add", metaa.major, metaa.minor, -1, before, after));
					}
				}
			}
		}
	}
	return changes;
}

export async function diffCaches(output: ScriptOutput, outdir: ScriptFS, sourcea: CacheFileSource, sourceb: CacheFileSource, ranges: FileRange[]) {
	let majors: number[] = [];
	let roota = await sourcea.getCacheIndex(cacheMajors.index);
	let rootb = await sourceb.getCacheIndex(cacheMajors.index);
	let rootmaxlen = Math.max(roota.length, rootb.length);
	for (let i = 0; i < rootmaxlen; i++) {
		if (ranges.length != 0 && !ranges.some(q => q.end[0] >= i && q.start[0] <= i)) { continue; }
		if (roota[i] && !rootb[i]) { output.log(`major ${i} removed`); }
		if (!roota[i] && rootb[i]) { output.log(`major ${i} added`); }
		if (roota[i] && rootb[i]) { majors.push(i); }
	}

	let changes: FileEdit[] = [];

	for (let major of majors) {
		if (output.state != "running") { break; }
		let matchedrange = ranges.find(q => q.start[1] <= major && q.end[0] >= major);
		let newchanges = await compareCacheMajors(output, sourcea, sourceb, major, matchedrange?.start[1], matchedrange?.end[1]);
		changes.push(...newchanges);

		for (let change of newchanges) {
			let name = change.action.getFileName(change.major, change.minor, change.subfile);
			let dir = `${change.action.name}`;

			await outdir.mkDir(dir);
			let before = await change.getBefore();
			let after = await change.getAfter();
			let addfile = async (ext: string, isafter: boolean, data: string | Buffer) => {
				await outdir.writeFile(`${dir}/${name}-${isafter ? "after" : "before"}.${ext}`, data);
			}
			if (change.action.outputType == "json") {
				if (before) {
					await addfile("json", false, prettyJson(change.action.parser.read(before, sourcea)));
				}
				if (after) {
					await addfile("json", true, prettyJson(change.action.parser.read(after, sourceb)));
				}
			} else if (change.action.outputType == "bin" || change.action.outputType == "rstex") {
				if (before) {
					await addfile(change.action.outputType, false, before);
				}
				if (after) {
					await addfile(change.action.outputType, true, after);
				}
			} else if (change.action.outputType == "png") {
				if (before) {
					let tex = (change.major == cacheMajors.sprites ? parseSprite(before)[0].img : await new ParsedTexture(before, false, false).toImageData(0));
					await addfile("png", false, await pixelsToImageFile(tex, "png", 1));
				}
				if (after) {
					let tex = (change.major == cacheMajors.sprites ? parseSprite(after)[0].img : await new ParsedTexture(after, false, false).toImageData(0));
					await addfile("png", true, await pixelsToImageFile(tex, "png", 1));
				}
			} else if (change.action.outputType == "html") {
				//TODO make standardised way to deal with different decoder types
				if (before) {
					let iface = await renderRsInterfaceHTML(new UiRenderContext(sourcea), change.minor);
					await addfile("html", false, iface);
				}
				if (after) {
					let iface = await renderRsInterfaceHTML(new UiRenderContext(sourceb), change.minor);
					await addfile("html", true, iface);
				}
			}
		}
	}

	output.log("done", changes.length, "total changes");
	return changes;
}

