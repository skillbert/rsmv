import { filesource, cliArguments } from "../cliparser";
import { run, command } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { getDebug } from "../opcode_reader";
import { CacheFileSource, CacheIndex, SubFile } from "../cache";
import { DecodeMode, cacheFileDecodeModes } from "./extractfiles";
import { CLIScriptOutput, ScriptOutput } from "../viewer/scriptsui";



let cmd = command({
	name: "download",
	args: {
		...filesource
	},
	handler: async (args) => {
		const errdir = "./cache5/errs";
		fs.mkdirSync(errdir, { recursive: true });
		let olderrfiles = fs.readdirSync(errdir);
		if (olderrfiles.find(q => !q.match(/^err/))) {
			throw new Error("file not starting with 'err' in error dir");
		}
		olderrfiles.forEach(q => fs.unlinkSync(path.resolve(errdir, q)));

		let output = new CLIScriptOutput(errdir);

		let source = await args.source();
		let mode = cacheFileDecodeModes.objects({});
		await testDecode(output, source, mode, defaultTestDecodeOpts());
	}
});

export type DecodeErrorJson = {
	chunks: { offset: number, bytes: string, text: string }[],
	remainder: string,
	state: any,
	error: string
}

export type DecodeEntry = { major: number, minor: number, subfile: number, file: Buffer, name?: string };

export function defaultTestDecodeOpts() {
	return {
		skipMinorAfterError: false,
		skipFilesizeAfterError: false,
		memlimit: 200e6,
		orderBySize: false,
		outmode: "json" as "json" | "hextext" | "original" | "none"
	};
}

export async function testDecode(output: ScriptOutput, source: CacheFileSource, mode: DecodeMode, opts: ReturnType<typeof defaultTestDecodeOpts>) {
	const { skipMinorAfterError, skipFilesizeAfterError, memlimit, orderBySize } = opts;
	if (!mode.parser) { throw new Error("decode mode doesn't have a standard parser"); }
	const decoder = mode.parser;
	let memuse = 0;
	let errminors: number[] = [];
	let errfilesizes: number[] = [];
	let maxerrs = 20;
	let nsuccess = 0;
	let lastProgress = Date.now();

	let fileiter: () => AsyncGenerator<DecodeEntry>;

	let files = await mode.logicalRangeToFiles(source, [0, 0], [Infinity, Infinity]);

	//pre-sort to get more small file under mem limit
	// files.sort((a, b) => (a.index.size ?? 0) - (b.index.size ?? 0));

	fileiter = async function* () {
		let allfiles: DecodeEntry[] = [];
		let currentarch: SubFile[] | null = null;
		let currentarchindex: CacheIndex | null = null;
		for (let file of files) {
			let index = file.index;
			if (index != currentarchindex) {
				currentarch = await source.getFileArchive(index);
				currentarchindex = index;
				memuse += currentarch.reduce((a, v) => a + v.size, 0);
			}

			let subfile = currentarch![file.subindex];
			if (!subfile) {
				output.log("subfile not found");
				continue;
			}
			let entry: DecodeEntry = { major: index.major, minor: index.minor, subfile: file.subindex, file: subfile.buffer };
			if (orderBySize) {
				allfiles.push(entry);
				if (memuse > memlimit) {
					output.log("skipping file because of memory limit", files.indexOf(file), "/", files.length);
					return false;
				}
			} else {
				yield entry;
			}
		}

		if (allfiles.length != 0) {
			allfiles.sort((a, b) => a.file.byteLength - b.file.byteLength);
			output.log("starting files:", allfiles.length);
			// allfiles = allfiles.filter((q, i) => i % 20 == 0);
			yield* allfiles;
		}
	}

	function testFile(file: DecodeEntry) {
		if (skipMinorAfterError && errminors.indexOf(file.minor) != -1) { return true; }
		if (skipFilesizeAfterError && errfilesizes.indexOf(file.file.byteLength) != -1) { return true; }
		if (Date.now() - lastProgress > 10000) {
			output.log("progress, file ", file.major, file.minor, file.subfile);
			lastProgress = Date.now();
		}

		getDebug(true);
		try {
			// output.log("reading ", file.major, file.minor, file.subfile);
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
			output.log("decode", file.minor, file.subfile, (e as Error).message);

			if (output.state == "running") {
				let outname = (file.name ? `err-${file.name}` : `err-${file.major}_${file.minor}_${file.subfile}.bin`);
				if (opts.outmode == "original") {
					output.writeFile(outname, file.file, "bin");
				}
				if (opts.outmode == "json" || opts.outmode == "hextext") {
					let err: DecodeErrorJson = {
						chunks: [],
						remainder: "",
						state: null,
						error: (e as Error).message
					};
					let index = 0;
					let outindex = 0;
					let lastopstr = "";
					for (let op of debugdata.opcodes) {
						let bytes = file.file.slice(index, op.index).toString("hex");
						outindex += op.index - index;
						err.chunks.push({ offset: index, bytes, text: lastopstr });
						index = op.index;
						lastopstr = " ".repeat(op.stacksize - 1) + (typeof op.op == "number" ? "0x" + op.op.toString(16).padStart(2, "0") : op.op);
					}
					err.remainder = file.file.slice(index).toString("hex");
					err.state = debugdata.structstack[debugdata.structstack.length - 1] ?? null;

					if (opts.outmode == "json") {
						output.writeFile(outname, JSON.stringify(err), "filedecodeerror");
					}
					if (opts.outmode == "hextext") {
						let chunks: Buffer[] = [];
						let outindex = 0;
						for (let chunk of err.chunks) {
							chunks.push(Buffer.from(chunk.bytes, "hex"));
							outindex += chunk.bytes.length;
							let opstr = chunk.text.slice(0, 6).padStart(6, "\0");
							let minfill = opstr.length + 1;
							let fillsize = (outindex == 0 ? 0 : Math.ceil((outindex + minfill) / 16) * 16 - outindex);
							if (fillsize > 0) {
								chunks.push(Buffer.alloc(1, 0xDD));
								chunks.push(Buffer.alloc(fillsize - 1 - opstr.length, 0xff));
								chunks.push(Buffer.from(opstr, "ascii"));
							}
							outindex += fillsize;
						}
						let remainder = Buffer.from(err.remainder, "hex");
						chunks.push(remainder);
						outindex += remainder.byteLength
						chunks.push(Buffer.alloc(2, 0xcc));
						outindex += 2;
						let fillsize = (outindex == 0 ? 0 : Math.ceil((outindex + 33) / 16) * 16 - outindex);
						chunks.push(Buffer.alloc(fillsize, 0xff));
						chunks.push(Buffer.from(err.error, "ascii"));
						chunks.push(Buffer.alloc(5));
						chunks.push(Buffer.from(err.state, "ascii"));

						output.writeFile(outname, Buffer.concat(chunks), "bin");
					}
				}
			}

			maxerrs--;
			return maxerrs > 0;
		}
	}

	for await (let file of fileiter()) {
		if (output.state != "running") {
			break;
		}
		if (!testFile(file)) {
			break;
		}
	}

	output.log("completed files:", nsuccess);
}

// 	run(cmd, cliArguments());