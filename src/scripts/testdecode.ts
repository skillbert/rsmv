import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseModels, parseMapsquareUnderlays, parseSequences, parseMapsquareOverlays, parseMapZones, parseFrames, parseEnums, parseMapscenes, parseMapsquareLocations, parseFramemaps, parseAnimgroupConfigs, parseSpotAnims } from "../opdecoder";
import { achiveToFileId, CacheFileSource, CacheIndex, CacheIndexStub, fileIdToArchiveminor, SubFile } from "../cache";
import { parseSprite } from "../3d/sprite";
import sharp from "sharp";
import { FlatImageData } from "../3d/utils";
import * as cache from "../cache";
import { GameCacheLoader } from "../cacheloader";
import { crc32_backward, forge } from "../libs/crc32util";
import { getDebug } from "../opcode_reader";
import { Buffer } from "buffer";


let cmd = command({
	name: "download",
	args: {
	},
	handler: async (args) => {
		const errdir = "./cache5/errs";
		const major = cacheMajors.spotanims;
		const minor = -1;
		const decoder = parseSpotAnims;
		const skipMinorAftError = false;
		const skipFilesizeAfterError = true;
		const memlimit = 10e6;
		
		let source = new GameCacheLoader();
		let indices = await source.getIndexFile(major);
		fs.mkdirSync(errdir, { recursive: true });
		let olderrfiles = fs.readdirSync(errdir);
		if (olderrfiles.find(q => !q.match(/^err/))) {
			throw new Error("file not starting with 'err' in error dir");
		}
		olderrfiles.forEach(q => fs.unlinkSync(path.resolve(errdir, q)));

		let memuse = 0;
		let allfiles: { major: number, minor: number, subfile: number, file: Buffer }[] = [];
		for (let index of indices) {
			if (!index) { continue; }
			if (minor != -1 && index.minor != minor) { continue; }
			let arch = await source.getFileArchive(index);
			memuse += arch.reduce((a, v) => a + v.size, 0);
			allfiles.push(...arch.map((q, i) => ({ major: index.major, minor: index.minor, subfile: index.subindices[i], file: q.buffer })));
			if (memuse > memlimit) {
				console.log("skipping file because of memory limit", indices.indexOf(index), "/", indices.length);
				break;
			}
		}

		// allfiles.sort((a, b) => a.file.byteLength - b.file.byteLength);
		console.log("starting files:", allfiles.length);
		// allfiles = allfiles.filter((q, i) => i % 20 == 0);


		let errminors: number[] = [];
		let errfilesizes: number[] = [];
		let maxerrs = 20;
		let nsuccess = 0;
		for (let file of allfiles) {
			// if (skipMinorAftError && errminors.indexOf(file.minor) != -1) { continue; }
			// if (skipFilesizeAfterError && errfilesizes.indexOf(file.file.byteLength) != -1) { continue; }
			getDebug(true);
			try {
				decoder.read(file.file);
				nsuccess++;
			} catch (e) {
				errminors.push(file.minor);
				errfilesizes.push(file.file.byteLength);
				let debugdata = getDebug(false)!;
				// if (!debugdata?.opcodes.find(q => q.op == 0x1d)) { continue; }
				// if (debugdata?.opcodes.find(q => q.op == 0x0d)) { continue; }
				console.log("decode", file.minor, file.subfile, (e as Error).message);

				// fs.writeFileSync(path.resolve(errdir, `err-${file.major}_${file.minor}_${file.subfile}.bin`), file.file);
				let chunks: Buffer[] = [];
				let index = 0;
				let outindex = 0;
				for (let op of debugdata.opcodes) {
					chunks.push(file.file.slice(index, op.index));
					outindex += op.index - index;
					index = op.index;
					let fillsize = (outindex == 0 ? 0 : Math.ceil((outindex + 1) / 16) * 16 - outindex);
					chunks.push(Buffer.alloc(fillsize, 0xff));
					outindex += fillsize;
					chunks.push(file.file.slice(index, op.index + 1));
					// chunks.push(Buffer.from([0x88]));
					index = op.index + 1;
					// outindex += 2;
					outindex += 1;
				}
				chunks.push(file.file.slice(index));
				outindex += file.file.byteLength - index;
				chunks.push(Buffer.alloc(2, 0xcc));
				outindex += 2;
				let fillsize = (outindex == 0 ? 0 : Math.ceil((outindex + 33) / 16) * 16 - outindex);
				chunks.push(Buffer.alloc(fillsize, 0xff));
				chunks.push(Buffer.from((e as Error).message, "ascii"));
				chunks.push(Buffer.alloc(5))
				chunks.push(Buffer.from(JSON.stringify(debugdata.rootstruct), "ascii"));

				fs.writeFileSync(path.resolve(errdir, `err-${file.major}_${file.minor}_${file.subfile}.bin`), Buffer.concat(chunks));

				maxerrs--;
				if (maxerrs <= 0) { break; }
			}
		}
		console.log("completed files: ", nsuccess);
	}
});

run(cmd, cliArguments());
