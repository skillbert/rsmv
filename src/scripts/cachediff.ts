import { filesource, cliArguments, ReadCacheSource } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf, optional } from "cmd-ts";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { FileParser, parseAchievement, parseEnums, parseItem, parseMaterials, parseModels, parseNpc } from "../opdecoder";
import { DepTypes } from "./dependencies";
import { parseObject } from "../opdecoder";
import { archiveToFileId } from "../cache";
import * as fs from "fs";
import prettyJson from "json-stringify-pretty-compact";


type FileAction = {
	name: DepTypes,
	comparesubfiles: boolean,
	parser: FileParser<any> | null,
	getFileName: (major: number, minor: number, subfile: number) => string
}

type FileEdit = {
	type: "add" | "delete" | "edit",
	major: number, minor: number, subfile: number,
	before: Buffer | null,
	after: Buffer | null,
	action: FileAction
}

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
	[cacheMajors.objects]: { name: "loc", comparesubfiles: true, parser: parseObject, getFileName: chunkedIndexName },
	[cacheMajors.items]: { name: "item", comparesubfiles: true, parser: parseItem, getFileName: chunkedIndexName },
	[cacheMajors.npcs]: { name: "npc", comparesubfiles: true, parser: parseNpc, getFileName: chunkedIndexName },
	[cacheMajors.models]: { name: "model", comparesubfiles: false, parser: null, getFileName: standardName },
	[cacheMajors.mapsquares]: { name: "mapsquare", comparesubfiles: false, parser: null, getFileName: worldmapFilename },
	[cacheMajors.enums]: { name: "enum", comparesubfiles: true, parser: parseEnums, getFileName: chunkedIndexName },
	[cacheMajors.achievements]: { name: "achievements" as any, comparesubfiles: true, parser: parseAchievement, getFileName: chunkedIndexName },
	[cacheMajors.materials]: { name: "material", comparesubfiles: true, parser: parseMaterials, getFileName: chunkedIndexName }
}

let cmd2 = command({
	name: "run",
	args: {
		a: option({ long: "cache-a", short: "a", type: ReadCacheSource }),
		b: option({ long: "cache-b", short: "b", type: ReadCacheSource }),
	},
	handler: async (args) => {
		let sourcea = await args.a();
		let sourceb = await args.b();

		let majors: number[] = [];
		let roota = await sourcea.getIndexFile(cacheMajors.index);
		let rootb = await sourceb.getIndexFile(cacheMajors.index);
		let rootmaxlen = Math.max(roota.length, rootb.length);
		for (let i = 0; i < rootmaxlen; i++) {
			if (roota[i] && !rootb[i]) { console.log(`major ${i} removed`); }
			if (!roota[i] && rootb[i]) { console.log(`major ${i} added`); }
			if (roota[i] && rootb[i]) { majors.push(i); }
		}

		let changes: FileEdit[] = [];

		for (let major of majors) {
			let indexa = await sourcea.getIndexFile(major);
			let indexb = await sourceb.getIndexFile(major);
			let len = Math.max(indexa.length, indexb.length);

			let majorname = Object.entries(cacheMajors).find(q => q[1] == major)?.[0] ?? `${major}`;
			let action = majormap[major] ?? { name: majorname, parser: null, comparesubfiles: false, getFileName: standardName };


			for (let i = 0; i < len; i++) {
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
									console.log(filea, fileb);
									throw new Error("shouldnt happen");
								}
							}
						} else {
							if (!metaa) {
								changes.push({
									type: "add", major: metab.major, minor: metab.minor,
									subfile: -1, action,
									before: null,
									after: await sourceb.getFile(metab.major, metab.minor, metab.crc)
								});
							}
							else if (!metab) {
								changes.push({
									type: "delete", major: metaa.major, minor: metaa.minor,
									subfile: -1, action,
									before: await sourcea.getFile(metaa.major, metaa.minor, metaa.crc),
									after: null
								});
							} else {
								changes.push({
									type: "edit", major: metaa.major, minor: metaa.minor,
									subfile: -1, action,
									before: await sourcea.getFile(metaa.major, metaa.minor, metaa.crc),
									after: await sourceb.getFile(metab.major, metab.minor, metab.crc)
								});
							}
						}
					}
				}
			}
		}

		let rootdir = "cache5/changes2";

		for (let change of changes) {
			let name = change.action.getFileName(change.major, change.minor, change.subfile);
			let dir = `${rootdir}/${change.action.name}`;
			fs.mkdirSync(dir, { recursive: true });
			if (change.action.parser) {
				if (change.before) {
					let parsedbefore = change.action.parser.read(change.before);
					fs.writeFileSync(`${dir}/${name}-before.json`, prettyJson(parsedbefore));
				}
				if (change.after) {
					let parsedafter = change.action.parser.read(change.after);
					fs.writeFileSync(`${dir}/${name}-after.json`, prettyJson(parsedafter));
				}
			} else {
				if (change.before) {
					fs.writeFileSync(`${dir}/${name}-before.bin`, change.before);
				}
				if (change.after) {
					fs.writeFileSync(`${dir}/${name}-after.bin`, change.after);
				}
			}
		}
		sourcea.close();
		sourceb.close();
	}
});

run(cmd2, cliArguments());
