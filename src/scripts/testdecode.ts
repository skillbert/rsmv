import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseAchievement, parseItem, parseObject, parseNpc, parseMapsquareTiles, FileParser, parseMapsquareUnderlays, parseSequences, parseMapsquareOverlays, parseMapZones, parseAnimations, parseEnums, parseMapscenes, parseMapsquareLocations } from "../opdecoder";
import { achiveToFileId, CacheFileSource, CacheIndex, CacheIndexStub, fileIdToArchiveminor, SubFile } from "../cache";
import { parseSprite } from "../3d/sprite";
import sharp from "sharp";
import { FlatImageData } from "../3d/utils";
import * as cache from "../cache";
import { GameCacheLoader } from "../cacheloader";
import { crc32_backward, forge } from "../libs/crc32util";
import { getDebug } from "../opcode_reader";


let cmd = command({
	name: "download",
	args: {
	},
	handler: async (args) => {
		const errdir = "./cache5/errs";
		const major = 20;
		const decoder = parseSequences;
		let source = new GameCacheLoader();
		let indices = await source.getIndexFile(major);
		fs.mkdirSync(errdir, { recursive: true });
		let olderrfiles = fs.readdirSync(errdir);
		if (olderrfiles.find(q => !q.match(/^err/))) {
			throw new Error("file not starting with 'err' in error dir");
		}
		olderrfiles.forEach(q => fs.unlinkSync(path.resolve(errdir, q)));

		let allfiles: { major: number, minor: number, subfile: number, file: Buffer }[] = [];
		for (let index of indices) {
			let arch = await source.getFileArchive(index);
			allfiles.push(...arch.map((q, i) => ({ major: index.major, minor: index.minor, subfile: index.subindices[i], file: q.buffer })));
		}

		allfiles.sort((a, b) => a.file.byteLength - b.file.byteLength);
		// allfiles = allfiles.filter((q, i) => i % 20 == 0);

		let maxerrs = 20;
		for (let file of allfiles) {
			getDebug(true);
			try {
				decoder.read(file.file);
			} catch (e) {
				// if (!(e as Error).message.includes("unknown chunk 0x1")) {
				// 	continue;
				// }
				let debugdata = getDebug(false)!;
				// if (!debugdata?.opcodes.find(q => q.op == 0x77)) { continue; }
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

				let fillsize = (outindex == 0 ? 0 : Math.ceil((outindex + 33) / 16) * 16 - outindex);
				chunks.push(Buffer.alloc(fillsize, 0xff));
				chunks.push(Buffer.from((e as Error).message, "ascii"));

				fs.writeFileSync(path.resolve(errdir, `err-${file.major}_${file.minor}_${file.subfile}.bin`), Buffer.concat(chunks));
				
				maxerrs--;
				if (maxerrs <= 0) { break; }
			}
		}
	}
});

run(cmd, cliArguments());
