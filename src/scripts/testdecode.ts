import { DecodeState, getDebug } from "../opcode_reader";
import { CacheFileSource, CacheIndex, SubFile } from "../cache";
import { JsonBasedFile } from "./filetypes";
import { ScriptFS, ScriptOutput } from "../scriptrunner";
import { FileParser } from "../opdecoder";
import { compareCacheMajors } from "./cachediff";
import { Openrs2CacheSource, validOpenrs2Caches } from "../cache/openrs2loader";
import { cacheMajors } from "../constants";
import { FileRange } from "../utils";
import { EngineCache } from "../3d/modeltothree";


export type DecodeErrorJson = {
	originalFile: string,
	chunks: { offset: number, len: number, label: string }[],
	state: any,
	error: string
}

export type DecodeEntry = { major: number, minor: number, subfile: number, file: Buffer, name?: string };

type Outputmode = "json" | "hextext" | "original" | "none";

export function defaultTestDecodeOpts() {
	return {
		skipMinorAfterError: false,
		skipFilesizeAfterError: false,
		memlimit: 200e6,
		maxerrs: 20,
		orderBySize: false,
		outmode: "json" as Outputmode,
		dumpall: false
	};
}

export async function testDecodeHistoric(output: ScriptOutput, outdir: ScriptFS, basecache: CacheFileSource | null, before = "", maxchecks = 0) {
	type CacheInput = { source: CacheFileSource, buildnr: number, info: string, date: number };

	const maxerrs = 50;

	let beforeDate = new Date(before);

	let checkedcaches = await validOpenrs2Caches();
	checkedcaches = checkedcaches.filter(q => q.timestamp && (!before || new Date(q.timestamp) < beforeDate));

	// output.log(cachelist.map(q => `${q.source.getCacheMeta().name} - ${q.info}`).slice(0, 20));

	let checkedmajors = [
		cacheMajors.config,//~2007
		cacheMajors.materials,//works up to different material system in 2013
		cacheMajors.items,//~2012
		cacheMajors.npcs,//2008
		cacheMajors.objects,//~2016, breaks on morphs
		cacheMajors.mapsquares,
		cacheMajors.models,//not used before 2018
		cacheMajors.oldmodels//~2015
	];

	let caches = function* (): Generator<CacheInput> {
		if (!before && basecache) {
			yield { source: basecache, info: "base cache", date: Date.now(), buildnr: basecache.getBuildNr() };
		}
		for (let src of checkedcaches) {
			let cache = new Openrs2CacheSource(src);
			let date = new Date(src.timestamp ?? "");
			yield {
				source: cache,
				info: `${date.toDateString()}`,
				date: +date,
				buildnr: cache.getBuildNr()
			};
		}
	}

	let prevcache: CacheInput | null = null;
	let currentcache: CacheInput | null = null;
	for (let nextcache of caches()) {
		prevcache = currentcache;
		currentcache = nextcache;
		if (before && !prevcache) { continue; }

		if (prevcache) {
			output.log(`starting cache diff check ${currentcache.buildnr}->${prevcache.buildnr} - ${currentcache.source.getCacheMeta().name}->${prevcache.source.getCacheMeta().name} - ${currentcache.info}->${prevcache.info})`);
		} else {
			output.log(`starting cache check ${currentcache.buildnr} (${currentcache.source.getCacheMeta().name} - ${currentcache.info})`);
		}

		for (let major of checkedmajors) {
			let errorcount = 0;
			let totalcount = 0;
			let changes = await compareCacheMajors(output, prevcache?.source, currentcache.source, major);
			for (let change of changes) {
				if (change.type == "add" || change.type == "edit") {
					let after = await change.getAfter();
					if (!after) {
						// throw new Error("after file expected"); 
						console.error(`After file expected, ${change.major}.${change.minor}`);
						continue;
					}
					if (change.action.parser) {
						let res = testDecodeFile(change.action.parser, after, currentcache.source);
						totalcount++;
						if (!res.success) {
							errorcount++;
							if (errorcount < maxerrs) {
								let errlocation = change.action.getFileName(change.major, change.minor, change.subfile);
								let filename = `${currentcache.source.getCacheMeta().name.replace(/\W/g, "_")}_${errlocation}`;
								output.log(`error in ${change.action.name} ${errlocation}`);

								let debugfile = res.getDebugFile("hextext");
								let errfilechunks = [debugfile as Buffer];
								let before = await change.getBefore();
								if (prevcache && before) {
									let prevres = testDecodeFile(change.action.parser, before, prevcache.source);
									errfilechunks.push(Buffer.alloc(64 + 16 - (debugfile.length % 16)));
									errfilechunks.push(prevres.getDebugFile("hextext") as Buffer);
								}

								outdir.writeFile(filename, Buffer.concat(errfilechunks));
							}
						}
					}
				}
				if (maxchecks != 0 && totalcount >= maxchecks) {
					break;
				}
			}

			output.log(`major ${major} - ${errorcount}/${totalcount} errors`);
		}

	}
}

export async function testDecode(output: ScriptOutput, outdir: ScriptFS, source: CacheFileSource, mode: JsonBasedFile, ranges: FileRange[], opts: ReturnType<typeof defaultTestDecodeOpts>) {
	const { skipMinorAfterError, skipFilesizeAfterError, memlimit, orderBySize } = opts;
	let memuse = 0;
	let errminors: number[] = [];
	let errfilesizes: number[] = [];
	let errorcount = 0;
	let nsuccess = 0;
	let lastProgress = Date.now();

	let fileiter: () => AsyncGenerator<DecodeEntry>;

	await mode.prepareDump?.(source);
	let files = (await Promise.all(ranges.map(q => mode.lookup.logicalRangeToFiles(source, q.start, q.end)))).flat();

	//pre-sort to get more small file under mem limit
	// files.sort((a, b) => (a.index.size ?? 0) - (b.index.size ?? 0));

	fileiter = async function* () {
		let allfiles: DecodeEntry[] = [];
		let currentarch: { index: CacheIndex, subfiles: SubFile[], error: Error | null } | null = null;
		for (let file of files) {
			let index = file.index;
			if (!currentarch || index != currentarch.index) {
				let subfiles: SubFile[];
				let error: Error | null = null;
				try {
					subfiles = await source.getFileArchive(index);
				} catch (e) {
					subfiles = [];
					error = e;
				}
				currentarch = { index, subfiles, error };
				memuse += subfiles.reduce((a, v) => a + v.size, 0);
			}

			let subfile = currentarch.subfiles[file.subindex];
			if (!subfile) {
				if (currentarch.error) {
					let id = mode.lookup.fileToLogical(source, file.index.major, file.index.minor, file.subindex);
					output.log(`skipped ${id.join(".")} due to error: ${currentarch.error}`);
				} else {
					output.log("subfile not found");
				}
				continue;
			}
			let entry: DecodeEntry = { major: index.major, minor: index.minor, subfile: file.subindex, file: subfile.buffer };
			if (globalThis.testDecodeFilter && !globalThis.testDecodeFilter(entry)) {
				continue;
			}
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
		let res = testDecodeFile(mode.parser, file.file, source);

		if (output.state == "running") {
			if (!globalThis.testDecodeOutputFilter || globalThis.testDecodeOutputFilter(res.state, res.debugdata.rootstate)) {
				if (res.success) {
					nsuccess++;
				} else {
					errminors.push(file.minor);
					errfilesizes.push(file.file.byteLength);
					errorcount++;
				}
				if (opts.dumpall || !res.success) {
					let logicalindex = mode.lookup.fileToLogical(source, file.major, file.minor, file.subfile);
					let filename = `${res.success ? "pass" : "fail"}-${file.name ? `${file.name}` : `${logicalindex.join("_")}`}`;
					if (opts.outmode == "json") {
						outdir.writeFile(filename + ".hexerr.json", res.getDebugFile(opts.outmode));
					}
					if (opts.outmode == "original" || opts.outmode == "hextext") {
						outdir.writeFile(filename + ".bin", res.getDebugFile(opts.outmode));
					}
				}
			}
		}
		return errorcount < opts.maxerrs;
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
	output.log(errorcount, "errors");
}


export function testDecodeFile(decoder: FileParser<any>, buffer: Buffer, source: CacheFileSource, args?: Record<string, any>) {
	getDebug(true);
	let error: Error | null = null;
	let success = false;
	let res: any = null;
	let state: DecodeState = {
		isWrite: false,
		buffer: buffer,
		stack: [],
		hiddenstack: [],
		scan: 0,
		endoffset: buffer.byteLength,
		args: {
			...source.getDecodeArgs(),
			...args
		}
	};
	try {
		res = decoder.readInternal(state);
		success = true;
	} catch (e) {
		error = e;
	}
	let debugdata = getDebug(false)!;

	let getDebugFile = function <T extends Outputmode>(outmode: T): T extends "hextext" | "original" ? Buffer : string {
		let errorfile: string | Buffer = "";

		if (outmode == "original") {
			errorfile = buffer;
		}
		if (outmode == "json" || outmode == "hextext") {
			let err: DecodeErrorJson = {
				originalFile: buffer.toString("hex"),
				chunks: [],
				state: null,
				error: error?.message ?? "success"
			};
			let index = 0;
			for (let i = 0; i < debugdata.opcodes.length; i++) {
				let op = debugdata.opcodes[i];
				let nextop = (i + 1 < debugdata.opcodes.length ? debugdata.opcodes[i + 1] : null);
				let endindex = nextop?.index ?? state.scan;
				let sliceend = endindex;
				if (op.jump) {
					index = op.jump.to;
					if (index == endindex) {
						continue;
					}
				}
				let opstr = " ".repeat(Math.max(0, op.stacksize - 1)) + op.op;
				err.chunks.push({ offset: index, len: sliceend - index, label: opstr });
				index = endindex;
			}
			let remainingbytes = state.endoffset - index;
			let remainderchunk: DecodeErrorJson["chunks"][number] = { offset: index, len: remainingbytes, label: `remainder: ${remainingbytes}` };
			err.chunks.push(remainderchunk);
			// err.state = state.stack[state.stack.length - 1] ?? null;

			if (outmode == "json") {
				errorfile = JSON.stringify(err);
			}
			if (outmode == "hextext") {
				let chunks: Buffer[] = [];
				let outindex = 0;
				for (let chunk of err.chunks) {
					if (chunk == remainderchunk) { continue; }
					let databytes = buffer.slice(chunk.offset, chunk.offset + chunk.len);
					chunks.push(databytes);
					outindex += databytes.length;
					let opstr = chunk.label.slice(0, 6).padStart(6, "\0");
					let minfill = opstr.length + 1;
					let fillsize = (outindex == 0 ? 0 : Math.ceil((outindex + minfill) / 16) * 16 - outindex);
					if (fillsize > 0) {
						chunks.push(Buffer.alloc(1, 0xDD));
						chunks.push(Buffer.alloc(fillsize - 1 - opstr.length, 0xff));
						chunks.push(Buffer.from(opstr, "ascii"));
					}
					outindex += fillsize;
				}
				if (remainderchunk) {
					let remainder = buffer.slice(remainderchunk.offset, remainderchunk.offset + remainderchunk.len);
					chunks.push(remainder);
					outindex += remainder.byteLength;
					chunks.push(Buffer.alloc(2, 0xcc));
					outindex += 2;
				}
				let fillsize = (outindex == 0 ? 0 : Math.ceil((outindex + 33) / 16) * 16 - outindex);
				chunks.push(Buffer.alloc(fillsize, 0xff));
				chunks.push(Buffer.from(err.error, "ascii"));
				chunks.push(Buffer.alloc(5));
				chunks.push(Buffer.from(JSON.stringify(err.state), "ascii"));

				errorfile = Buffer.concat(chunks);
			}
		}
		return errorfile as any;
	}
	return { success, error, getDebugFile, state, debugdata };
}