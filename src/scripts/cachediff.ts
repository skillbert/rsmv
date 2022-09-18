import { filesource, cliArguments, ReadCacheSource } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf, optional } from "cmd-ts";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { FileParser, parseAchievement, parseEnums, parseItem, parseMaterials, parseModels, parseNpc } from "../opdecoder";
import { DepTypes } from "./dependencies";
import { parseObject } from "../opdecoder";
import { archiveToFileId, CacheFileSource, fileIdToArchiveminor } from "../cache";
import * as fs from "fs";
import prettyJson from "json-stringify-pretty-compact";
import { crc32 } from "../libs/crc32util";
import { CLIScriptOutput, ScriptFS, ScriptOutput } from "../viewer/scriptsui";


type FileAction = {
	name: string,
	comparesubfiles: boolean,
	parser: FileParser<any> | null,
	isTexture: boolean,
	getFileName: (major: number, minor: number, subfile: number) => string
}

export type FileEdit = {
	type: "add" | "delete" | "edit",
	major: number, minor: number, subfile: number,
	before: Buffer | null,
	after: Buffer | null,
	action: FileAction
}

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

let majormap: Record<number, FileAction> = {
	[cacheMajors.objects]: { name: "loc", comparesubfiles: true, parser: parseObject, isTexture: false, getFileName: chunkedIndexName },
	[cacheMajors.items]: { name: "item", comparesubfiles: true, parser: parseItem, isTexture: false, getFileName: chunkedIndexName },
	[cacheMajors.npcs]: { name: "npc", comparesubfiles: true, parser: parseNpc, isTexture: false, getFileName: chunkedIndexName },
	[cacheMajors.models]: { name: "model", comparesubfiles: false, parser: null, isTexture: false, getFileName: standardName },
	[cacheMajors.mapsquares]: { name: "mapsquare", comparesubfiles: false, parser: null, isTexture: false, getFileName: worldmapFilename },
	[cacheMajors.enums]: { name: "enum", comparesubfiles: true, parser: parseEnums, isTexture: false, getFileName: chunkedIndexName },
	[cacheMajors.achievements]: { name: "achievements", comparesubfiles: true, parser: parseAchievement, isTexture: false, getFileName: chunkedIndexName },
	[cacheMajors.materials]: { name: "material", comparesubfiles: true, parser: parseMaterials, isTexture: false, getFileName: chunkedIndexName },
	[cacheMajors.texturesBmp]: { name: "texturesBmp", comparesubfiles: false, parser: null, isTexture: true, getFileName: standardName },
	[cacheMajors.texturesDds]: { name: "texturesDds", comparesubfiles: false, parser: null, isTexture: true, getFileName: standardName },
	[cacheMajors.texturesPng]: { name: "texturesPng", comparesubfiles: false, parser: null, isTexture: true, getFileName: standardName },
}
function getMajorAction(major: number) {
	let majorname = Object.entries(cacheMajors).find(q => q[1] == major)?.[0] ?? `unk_${major}`;
	let action = majormap[major] ?? { name: majorname, comparesubfiles: false, parser: null, isTexture: false, getFileName: standardName };
	return action;
}

export async function compareCacheMajors(output: ScriptOutput, sourcea: CacheFileSource, sourceb: CacheFileSource, major: number) {
	let indexa = await sourcea.getIndexFile(major);
	let indexb = await sourceb.getIndexFile(major);
	let len = Math.max(indexa.length, indexb.length);

	let changes: FileEdit[] = [];
	let action = getMajorAction(major);
	output.log(`checking major ${major} ${action.name} subfiles:${action.comparesubfiles}`);

	for (let i = 0; i < len; i++) {
		if (output.state != "running") { break; }
		let metaa = indexa[i], metab = indexb[i];
		if (metaa || metab) {
			if (!metaa || !metab || metaa.version != metab.version) {
				if (action.comparesubfiles) {
					let archa = (metaa ? await sourcea.getFileArchive(metaa) : []);
					let archb = (metab ? await sourceb.getFileArchive(metab) : []);

					for (let a = 0, b = 0; ;) {
						let filea = archa[a], fileb = archb[b];
						if (filea && (!fileb || filea.fileid < fileb.fileid)) {
							a++;
							changes.push({
								type: "delete", major: metaa.major, minor: metaa.minor, subfile: filea.fileid,
								action, before: filea.buffer, after: null
							});
						} else if (fileb && (!filea || fileb.fileid < filea.fileid)) {
							b++;
							changes.push({
								type: "add", major: metab.major, minor: metab.minor, subfile: fileb.fileid,
								action, before: null, after: fileb.buffer
							});
						} else if (filea && fileb && filea.fileid == fileb.fileid) {
							if (Buffer.compare(filea.buffer, fileb.buffer) != 0) {
								changes.push({
									type: "edit", major: metaa.major, minor: metaa.minor, subfile: filea.fileid,
									action, before: filea.buffer, after: fileb.buffer
								});
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
						changes.push({
							type: "add", major: metab.major, minor: metab.minor,
							subfile: -1, action,
							before: null,
							after: await sourceb.getFile(metab.major, metab.minor, metab.crc).catch(() => null)
						});
					}
					else if (!metab) {
						changes.push({
							type: "delete", major: metaa.major, minor: metaa.minor,
							subfile: -1, action,
							before: await sourcea.getFile(metaa.major, metaa.minor, metaa.crc).catch(() => null),
							after: null
						});
					} else {
						changes.push({
							type: "edit", major: metaa.major, minor: metaa.minor,
							subfile: -1, action,
							before: await sourcea.getFile(metaa.major, metaa.minor, metaa.crc).catch(() => null),
							after: await sourceb.getFile(metab.major, metab.minor, metab.crc).catch(() => null)
						});
					}
				}
			}
		}
	}
	return changes;
}

export async function diffCaches(output: ScriptOutput, outdir: ScriptFS, sourcea: CacheFileSource, sourceb: CacheFileSource) {
	let majors: number[] = [];
	let roota = await sourcea.getIndexFile(cacheMajors.index);
	let rootb = await sourceb.getIndexFile(cacheMajors.index);
	let rootmaxlen = Math.max(roota.length, rootb.length);
	for (let i = 0; i < rootmaxlen; i++) {
		if (roota[i] && !rootb[i]) { output.log(`major ${i} removed`); }
		if (!roota[i] && rootb[i]) { output.log(`major ${i} added`); }
		if (roota[i] && rootb[i]) { majors.push(i); }
	}

	let changes: FileEdit[] = [];

	for (let major of majors) {
		if (output.state != "running") { break; }
		let newchanges = await compareCacheMajors(output, sourcea, sourceb, major);
		changes.push(...newchanges);

		for (let change of newchanges) {
			let name = change.action.getFileName(change.major, change.minor, change.subfile);
			let dir = `${change.action.name}`;

			await outdir.mkDir(dir);
			if (change.action.parser) {
				if (change.before) {
					let parsedbefore = change.action.parser.read(change.before);
					await outdir.writeFile(`${dir}/${name}-before.json`, prettyJson(parsedbefore));
				}
				if (change.after) {
					let parsedafter = change.action.parser.read(change.after);
					await outdir.writeFile(`${dir}/${name}-after.json`, prettyJson(parsedafter));
				}
			} else {
				let ext = (change.action.isTexture ? "rstex" : "bin");
				if (change.before) {
					await outdir.writeFile(`${dir}/${name}-before.${ext}`, change.before);
				}
				if (change.after) {
					await outdir.writeFile(`${dir}/${name}-after.${ext}`, change.after);
				}
			}
		}
	}

	output.log("done", changes.length, "total changes");
	return changes;
}

