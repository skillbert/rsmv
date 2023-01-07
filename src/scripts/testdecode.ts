import { DecodeState, getDebug } from "../opcode_reader";
import { CacheFileSource, CacheIndex, SubFile } from "../cache";
import { JsonBasedFile } from "./extractfiles";
import { CLIScriptOutput, ScriptFS, ScriptOutput } from "../viewer/scriptsui";
import { FileParser, parse } from "../opdecoder";
import { FileRange } from "../cliparser";
import { compareCacheMajors } from "./cachediff";
import { GameCacheLoader } from "../cache/sqlite";
import { Openrs2CacheSource } from "../cache/openrs2loader";
import { cacheMajors } from "../constants";


export type DecodeErrorJson = {
	chunks: { offset: number, bytes: string, text: string }[],
	remainder: string,
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

//TODO move this somewhere
export async function validOpenrs2Caches() {

	const openrs2Blacklist = [
		423,//osrs cache wrongly labeled as rs3
		623,//seems to have different builds in it
		840,//multiple builds
		734, 736, 733,//don't have items index
		20, 19, 17, 13, 10, 9, 8, 7, 6, 5,//don't have items index
	];
	let allcaches = await Openrs2CacheSource.getCacheIds();
	let checkedcaches = allcaches.filter(q =>
		q.language == "en" && q.environment == "live" && !openrs2Blacklist.includes(q.id)
		&& q.game == "runescape" && q.timestamp && q.builds.length != 0
	).sort((a, b) => +new Date(b.timestamp!) - +new Date(a.timestamp!));

	return checkedcaches;
}

export async function testDecodeHistoric(output: ScriptOutput, outdir: ScriptFS, basecache: CacheFileSource | null, before = "") {
	type CacheInput = { source: CacheFileSource, buildnr: number, info: string, date: number };

	const maxerrs = 50;

	let beforeDate = new Date(before);

	let checkedcaches = await validOpenrs2Caches();
	checkedcaches = checkedcaches.filter(q => q.timestamp && (!before || new Date(q.timestamp) < beforeDate));

	// output.log(cachelist.map(q => `${q.source.getCacheName()} - ${q.info}`).slice(0, 20));

	let checkedmajors = [
		// cacheMajors.config,
		// cacheMajors.materials,
		// cacheMajors.items,
		cacheMajors.npcs,
		// cacheMajors.objects,
		// cacheMajors.mapsquares,
		// cacheMajors.models
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
			output.log(`starting cache diff check ${currentcache.buildnr}->${prevcache.buildnr} - ${currentcache.source.getCacheName()}->${prevcache.source.getCacheName()} - ${currentcache.info}->${prevcache.info})`);
		} else {
			output.log(`starting cache check ${currentcache.buildnr} (${currentcache.source.getCacheName()} - ${currentcache.info})`);
		}

		for (let major of checkedmajors) {
			let errorcount = 0;
			let totalcount = 0;
			let changes = await compareCacheMajors(output, prevcache?.source, currentcache.source, major);
			for (let change of changes) {
				if (change.type == "add" || change.type == "edit") {
					if (!change.after) { throw new Error("after file expected"); }
					if (change.action.parser) {
						let res = testDecodeFile(change.action.parser, change.after, currentcache.source);
						totalcount++;
						if (!res.success) {
							errorcount++;
							if (errorcount < maxerrs) {
								let errlocation = change.action.getFileName(change.major, change.minor, change.subfile);
								let filename = `${currentcache.source.getCacheName().replace(/\W/g, "_")}_${errlocation}`;
								output.log(`error in ${change.action.name} ${errlocation}`);

								let debugfile = res.getDebugFile("hextext");
								let errfilechunks = [debugfile as Buffer];
								if (prevcache && change.before) {
									let prevres = testDecodeFile(change.action.parser, change.before, prevcache.source);
									errfilechunks.push(Buffer.alloc(64 + 16 - (debugfile.length % 16)));
									errfilechunks.push(prevres.getDebugFile("hextext") as Buffer);
								}

								outdir.writeFile(filename, Buffer.concat(errfilechunks));
							}
						}
					}
				}
			}

			output.log(`major ${major} - ${errorcount}/${totalcount} errors`);
		}

	}
}

export async function testDecode(output: ScriptOutput, outdir: ScriptFS, source: CacheFileSource, mode: JsonBasedFile, ranges: FileRange, opts: ReturnType<typeof defaultTestDecodeOpts>) {
	const { skipMinorAfterError, skipFilesizeAfterError, memlimit, orderBySize } = opts;
	let memuse = 0;
	let errminors: number[] = [];
	let errfilesizes: number[] = [];
	let errorcount = 0;
	let nsuccess = 0;
	let lastProgress = Date.now();

	let fileiter: () => AsyncGenerator<DecodeEntry>;

	let files = (await Promise.all(ranges.map(q => mode.lookup.logicalRangeToFiles(source, q.start, q.end)))).flat();

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
		let res = testDecodeFile(mode.parser, file.file, source);

		if (output.state == "running") {
			if (res.success) {
				nsuccess++;
			} else {
				errminors.push(file.minor);
				errfilesizes.push(file.file.byteLength);
				errorcount++;
			}
			if (opts.dumpall || !res.success) {
				let filename = `${res.success ? "pass" : "fail"}-${file.name ? `${file.name}` : `${file.major}_${file.minor}_${file.subfile}`}`;
				if (opts.outmode == "json") {
					outdir.writeFile(filename + ".hexerr.json", res.getDebugFile(opts.outmode));
				}
				if (opts.outmode == "original" || opts.outmode == "hextext") {
					outdir.writeFile(filename + ".bin", res.getDebugFile(opts.outmode));
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
		buffer: buffer,
		stack: [],
		hiddenstack: [],
		scan: 0,
		startoffset: 0,
		endoffset: buffer.byteLength,
		args: args ?? {},
		keepBufferJson: false,
		clientVersion: source.getBuildNr()
	};
	try {
		res = decoder.readInternal(state);
		success = true;
	} catch (e) {
		error = e;
	}
	// let opcodeerr = (e + "").match(/unknown chunk 0x(\w+)/);
	// if (opcodeerr && parseInt(opcodeerr[1], 16) > (globalThis.decodemax ?? 0x16)) {
	// 	return { success: true as true, result: {} };
	// }
	let debugdata = getDebug(false)!;

	let getDebugFile = function <T extends Outputmode>(outmode: T): T extends "hextext" | "original" ? Buffer : string {
		let errorfile: string | Buffer = "";

		if (outmode == "original") {
			errorfile = buffer;
		}
		if (outmode == "json" || outmode == "hextext") {
			let err: DecodeErrorJson = {
				chunks: [],
				remainder: "",
				state: null,
				error: error?.message ?? "success"
			};
			let index = 0;
			for (let i = 0; i < debugdata.opcodes.length; i++) {
				let op = debugdata.opcodes[i];
				let endindex = (i + 1 < debugdata.opcodes.length ? debugdata.opcodes[i + 1].index : state.scan);
				let sliceend = endindex;
				if (op.external) {
					index = op.external.start;
					sliceend = op.external.start + op.external.len;
				}
				let bytes = buffer.slice(index, sliceend).toString("hex");
				let opstr = " ".repeat(op.stacksize - 1) + (typeof op.op == "number" ? "0x" + op.op.toString(16).padStart(2, "0") : op.op);
				err.chunks.push({ offset: index, bytes, text: opstr });
				index = endindex;
			}
			err.remainder = buffer.slice(index, state.endoffset).toString("hex");
			// err.state = state.stack[state.stack.length - 1] ?? null;
			err.state = debugdata.structstack[debugdata.structstack.length - 1] ?? null;

			if (outmode == "json") {
				errorfile = JSON.stringify(err);
			}
			if (outmode == "hextext") {
				let chunks: Buffer[] = [];
				let outindex = 0;
				for (let chunk of err.chunks) {
					let databytes = Buffer.from(chunk.bytes, "hex");
					chunks.push(databytes);
					outindex += databytes.length;
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
				chunks.push(Buffer.from(JSON.stringify(err.state), "ascii"));

				errorfile = Buffer.concat(chunks);
			}
		}
		return errorfile as any;
	}
	return { success, error, getDebugFile };
}