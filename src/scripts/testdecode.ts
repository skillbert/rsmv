import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseCacheIndex, parseMapsquareTiles, FileParser, parseModels, parseMapsquareUnderlays, parseSequences, parseMapsquareOverlays, parseMapZones, parseFrames, parseEnums, parseMapscenes, parseMapsquareLocations, parseFramemaps, parseAnimgroupConfigs, parseSpotAnims, parseRootCacheIndex, parseSkeletalAnim, parseMaterials, parseQuickchatLines, parseEnvironments, parseAvatars, parseIdentitykit, parseStructs, parseParams } from "../opdecoder";
import { archiveToFileId, CacheFileSource, CacheIndex, fileIdToArchiveminor, SubFile } from "../cache";
import { parseSprite } from "../3d/sprite";
import sharp from "sharp";
import { FlatImageData } from "../3d/utils";
import * as cache from "../cache";
import { GameCacheLoader } from "../cacheloader";
import { crc32_backward, forge } from "../libs/crc32util";
import { getDebug } from "../opcode_reader";
import { Downloader } from "../downloader";
import prettyJson from "json-stringify-pretty-compact";


let cmd = command({
	name: "download",
	args: {
		directfiles: option({ long: "directfiles", short: "f", defaultValue: () => "" })
	},
	handler: async (args) => {
		const errdir = "./cache5/errs";
		const decoder = parseParams;
		const major = cacheMajors.config;
		const minor: number =cacheConfigPages.params;
		const subfileid: number = -1;
		const skipMinorAfterError = false;
		const skipFilesizeAfterError = false;
		const memlimit = 200e6;
		const orderBySize = true;

		fs.mkdirSync(errdir, { recursive: true });
		let olderrfiles = fs.readdirSync(errdir);
		if (olderrfiles.find(q => !q.match(/^err/))) {
			throw new Error("file not starting with 'err' in error dir");
		}
		olderrfiles.forEach(q => fs.unlinkSync(path.resolve(errdir, q)));

		type DecodeEntry = { major: number, minor: number, subfile: number, file: Buffer, name?: string };
		let memuse = 0;
		let errminors: number[] = [];
		let errfilesizes: number[] = [];
		let maxerrs = 20;
		let nsuccess = 0;
		let lastProgress = Date.now();

		let fileiter: () => AsyncGenerator<DecodeEntry>;

		if (!args.directfiles) {
			let source = new GameCacheLoader();
			// let source = new Downloader();
			let indices = await source.getIndexFile(major);

			//pre-sort to get more small file under mem limit
			indices.sort((a, b) => (a.size ?? 0) - (b.size ?? 0));

			fileiter = async function* () {
				let allfiles: DecodeEntry[] = [];
				for (let index of indices) {
					if (!index) { continue; }
					if (minor != -1 && index.minor != minor) { continue; }
					if (index.crc == 0) { continue }

					let arch = await source.getFileArchive(index);
					memuse += arch.reduce((a, v) => a + v.size, 0);

					let entries = arch.map((q, i): DecodeEntry => ({ major: index.major, minor: index.minor, subfile: index.subindices[i], file: q.buffer }))
						.filter(q => subfileid == -1 || q.subfile == subfileid);
					if (orderBySize) {
						allfiles.push(...entries);
						if (memuse > memlimit) {
							console.log("skipping file because of memory limit", indices.indexOf(index), "/", indices.length);
							return false;
						}
					} else {
						yield* entries;
					}
				}

				if (allfiles.length != 0) {
					allfiles.sort((a, b) => a.file.byteLength - b.file.byteLength);
					console.log("starting files:", allfiles.length);
					// allfiles = allfiles.filter((q, i) => i % 20 == 0);
					yield* allfiles;
				}
			}
		} else {
			//TODO just use a rawfileloader for this instead
			fileiter = async function* () {
				let count = 0;
				let files = fs.readdirSync(args.directfiles);
				let allfiles: DecodeEntry[] = [];
				for (let file of files) {
					let buf = fs.readFileSync(path.join(args.directfiles, file));
					let entry: DecodeEntry = { file: buf, major: 0, minor: count++, subfile: 0, name: file };
					if (orderBySize) { allfiles.push(entry); }
					else { yield entry; }
				}
				allfiles.sort((a, b) => a.file.byteLength - b.file.byteLength);
				yield* allfiles;
			}
		}

		function testFile(file: DecodeEntry) {
			if (skipMinorAfterError && errminors.indexOf(file.minor) != -1) { return true; }
			if (skipFilesizeAfterError && errfilesizes.indexOf(file.file.byteLength) != -1) { return true; }
			if (Date.now() - lastProgress > 10000) {
				console.log("progress, file ", file.major, file.minor, file.subfile);
				lastProgress = Date.now();
			}

			getDebug(true);
			try {
				// console.log("reading ", file.major, file.minor, file.subfile);
				let res = decoder.read(file.file);
				// if(file.file.length>30){throw new Error("success")}
				// if(res.player && res.player.unk16!=0){throw new Error("unk16")}
				// if (res.player) {
				// 	for (let [key, v] of Object.entries(res.player)) {
				// 		if (!key.startsWith("cust")) { continue; }
				// 		let q = v as any as NonNullable<typeof res.player>["cust0"];
				// 		if (q && q.type & 1) { throw new Error("model"); }
				// 	}
				// }
				nsuccess++;
				return true;
			} catch (e) {
				errminors.push(file.minor);
				errfilesizes.push(file.file.byteLength);
				let debugdata = getDebug(false)!;
				console.log("decode", file.minor, file.subfile, (e as Error).message);

				// let chunks = [file.file];
				let chunks: Buffer[] = [];
				let index = 0;
				let outindex = 0;
				let lastopstr = "";
				for (let op of debugdata.opcodes) {
					chunks.push(file.file.slice(index, op.index));
					outindex += op.index - index;
					index = op.index;
					let opstr = lastopstr;
					let minfill = opstr.length + 1;
					let fillsize = (outindex == 0 ? 0 : Math.ceil((outindex + minfill) / 16) * 16 - outindex);
					if (fillsize > 0) {
						chunks.push(Buffer.alloc(1, 0xDD));
						chunks.push(Buffer.alloc(fillsize - 1 - opstr.length, 0xff));
						chunks.push(Buffer.from(opstr, "ascii"));
					}
					outindex += fillsize;
					lastopstr = (op.op + "").slice(0, 6).padStart(6, "\0");
				}
				chunks.push(file.file.slice(index));
				outindex += file.file.byteLength - index;
				chunks.push(Buffer.alloc(2, 0xcc));
				outindex += 2;
				let fillsize = (outindex == 0 ? 0 : Math.ceil((outindex + 33) / 16) * 16 - outindex);
				chunks.push(Buffer.alloc(fillsize, 0xff));
				chunks.push(Buffer.from((e as Error).message, "ascii"));
				chunks.push(Buffer.alloc(5))
				chunks.push(Buffer.from(JSON.stringify(debugdata.structstack[debugdata.structstack.length - 1] ?? null), "ascii"));

				let name = (file.name ? `err-${file.name}` : `err-${file.major}_${file.minor}_${file.subfile}.bin`);
				fs.writeFileSync(path.resolve(errdir, name), Buffer.concat(chunks));

				maxerrs--;
				return maxerrs > 0;
			}
		}

		for await (let file of fileiter()) {
			if (!testFile(file)) {
				break;
			}
		}

		console.log("completed files: ", nsuccess);
	}
});

run(cmd, cliArguments());
