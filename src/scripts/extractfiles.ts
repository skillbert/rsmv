import { CacheFileSource, CacheIndex, SubFile } from "../cache";
import { GameCacheLoader } from "../cache/sqlite";
import { FileRange, getOrInsert } from "../utils";
import { ScriptFS, ScriptOutput } from "../scriptrunner";
import { cacheFileDecodeModes, DecodeMode, DecodeModeFactory } from "./filetypes";

export async function extractCacheFiles(output: ScriptOutput, outdir: ScriptFS, source: CacheFileSource, args: { batched: boolean, batchlimit: number, mode: string, files: FileRange[], edit: boolean, skipread: boolean }, decoderflags: Record<string, string>) {
	let modeconstr: DecodeModeFactory = cacheFileDecodeModes[args.mode];
	if (!modeconstr) { throw new Error("unknown mode"); }
	let flags = { ...decoderflags };
	if (args.batched || args.batchlimit != -1) { flags.batched = "true"; }
	let mode = modeconstr(flags);
	await mode.prepareDump(outdir, source);

	let batchMaxFiles = args.batchlimit;
	let batchSubfile = args.batched;

	let ranges = args.files;

	let allfiles = (await Promise.all(ranges.map(q => mode.logicalRangeToFiles(source, q.start, q.end))))
		.flat()
		.sort((a, b) => a.index.major != b.index.major ? a.index.major - b.index.major : a.index.minor != b.index.minor ? a.index.minor - b.index.minor : a.subindex - b.subindex);


	if (!args.skipread) {
		let lastarchive: null | { index: CacheIndex, subfiles: SubFile[], error: Error | null } = null;
		let currentBatch: { name: string, startIndex: CacheIndex, arch: SubFile[], outputs: (string | Buffer)[], batchchunknr: number } | null = null;
		let flushbatch = () => {
			if (currentBatch) {
				//return promise instead of async function so we only switch stacks when actually doing anything
				return (async () => {
					let filename = `${args.mode}-${currentBatch.startIndex.major}_${currentBatch.startIndex.minor}.batch`;
					if (batchMaxFiles != -1) { filename += "." + currentBatch.batchchunknr; }
					filename += `.${mode.ext}`;
					outdir.writeFile(filename, mode.combineSubs(currentBatch.outputs));
					currentBatch = null;
				})();
			}
		}
		for (let fileid of allfiles) {
			if (output.state != "running") { break; }
			let arch: SubFile[];
			if (lastarchive && lastarchive.index == fileid.index) {
				arch = lastarchive.subfiles;
			} else {
				let err: Error | null = null;
				try {
					arch = await source.getFileArchive(fileid.index);
				} catch (e) {
					err = e;
					arch = [];
				}
				lastarchive = { index: fileid.index, subfiles: arch, error: err };
			}
			let file = arch[fileid.subindex];
			if (!file) {
				output.log(`skipped ${mode.fileToLogical(source, fileid.index.major, fileid.index.minor, fileid.subindex).join(".")} due to error: ${lastarchive.error}`);
				continue;
			}
			let logicalid = mode.fileToLogical(source, fileid.index.major, fileid.index.minor, file.fileid);

			try {
				var res = mode.read(file.buffer, logicalid, source);
				if (res instanceof Promise) { res = await res; }
			} catch (e) {
				output.log(`file ${logicalid.join(".")}: ${e}`);
				continue;
			}
			if (batchSubfile || batchMaxFiles != -1) {
				let maxedbatchsize = currentBatch && batchMaxFiles != -1 && currentBatch.outputs.length >= batchMaxFiles;
				let newarch = currentBatch && currentBatch.arch != arch
				if (!currentBatch || maxedbatchsize || (batchSubfile && newarch)) {
					let nextbatchchunknr = (newarch || !maxedbatchsize || !currentBatch ? 0 : currentBatch.batchchunknr + 1);
					let p = flushbatch();
					if (p) { await p; }
					currentBatch = {
						name: "",
						startIndex: fileid.index,
						arch,
						outputs: [],
						batchchunknr: nextbatchchunknr
					};
				}
				currentBatch.outputs.push(res);
			} else {
				let filename = `${args.mode}${logicalid.length == 0 ? "" : "-" + logicalid.join("_")}.${mode.ext}`;
				await outdir.writeFile(filename, res);
			}
		}
		flushbatch();
	}

	if (args.edit) {
		output.log("press enter to save edits");
		await new Promise<any>(d => process.stdin.once('data', d));

		let lastarchive: null | { index: CacheIndex, subfiles: SubFile[], error: Error | null } = null;
		let archedited = () => {
			if (!(source instanceof GameCacheLoader)) { throw new Error("can only do this on file source of type gamecacheloader"); }
			if (lastarchive) {
				console.log("writing archive", lastarchive.index.major, lastarchive.index.minor, "files", lastarchive.subfiles.length);
				console.log(lastarchive.index);
				// let arch = new Archive(lastarchive.subfiles.map(q => q.buffer));
				// arch.forgecrc(lastarchive.index.uncompressed_crc, lastarchive.index.subindices.indexOf(3), 10);
				// return source.writeFile(lastarchive.index.major, lastarchive.index.minor, arch.packSqlite());
				return source.writeFileArchive(lastarchive.index.major, lastarchive.index.minor, lastarchive.subfiles.map(q => q.buffer));
			}
		}

		for (let fileid of allfiles) {
			let arch: SubFile[];
			if (lastarchive && lastarchive.index == fileid.index) {
				arch = lastarchive.subfiles;
			} else {
				await archedited();
				arch = await source.getFileArchive(fileid.index);
				lastarchive = { index: fileid.index, subfiles: arch, error: null };
			}
			let logicalid = mode.fileToLogical(source, fileid.index.major, fileid.index.minor, arch[fileid.subindex].fileid);
			let newfile = await outdir.readFileBuffer(`${args.mode}-${logicalid.join("_")}.${mode.ext}`);
			arch[fileid.subindex].buffer = await mode.write(newfile, logicalid, source);
		}
		await archedited();
	}
	output.log("done");
}

export async function writeCacheFiles(output: ScriptOutput, source: CacheFileSource, inputdir: ScriptFS | undefined, inputfiles: { name: string, file: Buffer }[]) {
	let cachedmodes: Record<string, DecodeMode> = {};
	let incompletearchs: Map<number, Map<number, { fetchsiblings: boolean, files: { subid: number, file: Buffer }[] }>> = new Map();

	let getmode = async (str: string) => {
		let mode = cachedmodes[str]
		if (!mode) {
			let modecontr = cacheFileDecodeModes[str as keyof typeof cacheFileDecodeModes];
			if (!modecontr) { throw new Error(`cache decode mode "${str}" not recognized`); }
			mode = cacheFileDecodeModes[str as keyof typeof cacheFileDecodeModes]({});
			cachedmodes[str] = mode;
			await mode.prepareWrite(source);
		}
		return mode;
	}

	let getarch = (major: number, minor: number, mode: DecodeMode, fetchsiblings = mode.usesArchieves) => {
		let majormap = getOrInsert(incompletearchs, major, () => new Map());
		let group = getOrInsert(majormap, minor, () => ({ fetchsiblings, files: [] }));
		return group;
	}

	let processfile = async (filename: string, file: Buffer) => {
		let singlematch = filename.match(/(^|\/)(\w+)-([\d_]+)\.(\w+)$/);
		if (singlematch) {
			let logicalid = singlematch[3].split(/_/g).map(q => +q);
			let mode = await getmode(singlematch[2]);

			let archid = mode.logicalToFile(source, logicalid);
			let arch = getarch(archid.major, archid.minor, mode);

			let buf = await mode.write(file, logicalid, source);
			arch.files.push({ subid: archid.subid, file: buf });

			return;
		}

		let batchjson = filename.match(/(^|\/)(\w+)-([\d_]+)\.batch\.json$/);
		if (batchjson) {
			let mode = await getmode(batchjson[2]);
			let raw: { files: any[] } = JSON.parse(file.toString("utf-8"));

			if (!mode.parser) { throw new Error(`batch files only supported for json based modes, mode ${batchjson[2]} does not have a json parser`); }
			for (let file of raw.files) {
				let archid = mode.logicalToFile(source, file.$fileid);
				let arch = getarch(archid.major, archid.minor, mode);
				let buf = mode.parser!.write(file, source.getDecodeArgs());
				arch.files.push({ subid: archid.subid, file: buf });
			}
			return;
		}

		output.log("can't interpret file: " + filename);
	}

	let processdir = async (inputdir: ScriptFS, node: string) => {
		let files = await inputdir.readDir(node);
		let base = (node == "." ? "" : node + "/")
		for (let file of files) {
			//ignore dotfiles
			if (file.name.match(/(^|\/)\.[^\/]*$/)) { continue; }

			let filename = base + file.name;
			if (file.kind == "file") { await processfile(filename, await inputdir.readFileBuffer(filename)); }
			if (file.kind == "directory") { await processdir(inputdir, filename); }
		}
	}
	if (inputdir) { await processdir(inputdir, "."); }
	for (let file of inputfiles) {
		await processfile(file.name, file.file);
	}

	for (let [major, majormap] of incompletearchs) {
		let indexfile = await source.getCacheIndex(major);
		for (let [minor, group] of majormap) {
			let index = indexfile[minor] as CacheIndex | undefined;
			let prevarch: SubFile[] = [];
			if (index && group.fetchsiblings) {
				prevarch = await source.getFileArchive(index);
			}

			let newfiles = group.files;
			newfiles.sort((a, b) => a.subid - b.subid);
			let p = 0, a = 0;
			let fileids: number[] = [];
			let files: Buffer[] = [];
			while (true) {
				let hasold = p < prevarch.length;
				let hasnew = a < newfiles.length;
				if (hasnew && (!hasold || newfiles[a].subid <= prevarch[p].fileid)) {
					fileids.push(newfiles[a].subid);
					files.push(newfiles[a].file);
					if (hasold && prevarch[p].fileid == newfiles[a].subid) {
						p++;
					}
					a++;
				} else if (hasold) {
					fileids.push(prevarch[p].fileid);
					files.push(prevarch[p].buffer);
					p++;
				} else {
					break;
				}
			}

			let matches = true;
			if (!index) {
				output.log(`group ${major}.${minor} does not have an index entry, writing anyway`);
			} else if (files.length != index.subindices.length) {
				matches = false;
			} else {
				for (let a = 0; a < files.length; a++) {
					if (fileids[a] != index.subindices[a]) {
						matches = false;
					}
				}
			}
			if (!matches) {
				throw new Error("tried to replace archive with different subfile ids, need to rewrite index file to make this work");
			}

			console.log("writing", major, minor, fileids);
			await source.writeFileArchive(major, minor, files);
		}
	}
}
