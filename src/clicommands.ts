import { ReadCacheSource, filerange } from "./cliparser";
import { command, option, flag } from "cmd-ts";
import { cacheFileDecodeModes, cacheFileJsonModes } from "./scripts/filetypes";
import { CLIScriptFS, ScriptFS, ScriptOutput } from "./scriptrunner";
import { defaultTestDecodeOpts, testDecode, testDecodeHistoric } from "./scripts/testdecode";
import { extractCacheFiles, writeCacheFiles } from "./scripts/extractfiles";
import * as cmdts from "cmd-ts";
import { indexOverview } from "./scripts/indexoverview";
import { diffCaches } from "./scripts/cachediff";
import { quickChatLookup } from "./scripts/quickchatlookup";
import { scrapePlayerAvatars } from "./scripts/scrapeavatars";
import { fileHistory } from "./scripts/filehistory";
import { openrs2Ids } from "./scripts/openrs2ids";
import { extractCluecoords } from "./scripts/cluecoords";
import { CacheFileSource } from "./cache";


export type CliApiContext = {
	getFs(name: string): ScriptFS,
	getConsole(): ScriptOutput,
	getDefaultCache?(): CacheFileSource
}

export function cliFsOutputType(ctx: CliApiContext, fsname: string): cmdts.Type<string, ScriptFS> {
	return {
		async from(str) { return new CLIScriptFS(str); },
		defaultValue() { return ctx.getFs(fsname) },
		description: `Where to save files (${fsname})`
	};
}


export function cliApi(ctx: CliApiContext) {
	const filesource = {
		source: cmdts.option({
			long: "source",
			short: "o",
			type: ReadCacheSource,
			defaultValue: ctx.getDefaultCache ? () => async () => ctx.getDefaultCache!() : undefined
		})
	};
	function saveArg(name: string) {
		return {
			save: option({
				long: "save",
				short: "s",
				type: cliFsOutputType(ctx, name)
			})
		} as const;
	}
	const testdecode = command({
		name: "testdecode",
		args: {
			...filesource,
			...filerange,
			...saveArg("save"),
			mode: option({ long: "mode", short: "m", description: `A json decode mode ${Object.keys(cacheFileJsonModes).join(", ")}` })
		},
		handler: async (args) => {
			let errdir = args.save;
			let olderrfiles = await errdir.readDir(".");
			if (olderrfiles.find(q => !q.match(/^(err|pass|fail)-/))) {
				throw new Error("file not starting with 'err' in error dir");
			}
			await Promise.all(olderrfiles.map(q => errdir.unlink(q)));

			let output = ctx.getConsole();
			let source = await args.source();
			let mode = cacheFileJsonModes[args.mode];
			if (!mode) { throw new Error(`mode ${args.mode} not found, possible modes: ${Object.keys(cacheFileJsonModes).join(", ")}`) }
			let opts = defaultTestDecodeOpts();
			opts.outmode = "hextext";
			opts.maxerrs = 500;
			await output.run(testDecode, errdir, source, mode, args.files, opts);
		}
	});

	const cluecoords = command({
		name: "download",
		args: {
			...filesource,
			...saveArg("extract")
		},
		handler: async (args) => {
			let output = ctx.getConsole();
			await output.run(extractCluecoords, args.save, await args.source());
		}
	});

	const historicdecode = command({
		name: "historicdecode",
		args: {
			...filesource,
			...saveArg("cache-histerr"),
			skipcurrent: flag({ long: "skipcurrent", short: "p", description: "skip current cache" }),
			before: option({ long: "before", short: "t", defaultValue: () => "" }),
			maxchecks: option({ long: "maxchecks", short: "n", type: cmdts.number, defaultValue: () => 0 })
		},
		async handler(args) {
			let startcache = await args.source();
			let output = ctx.getConsole();
			await output.run(testDecodeHistoric, args.save, startcache, args.before, args.maxchecks);
		}
	})

	const extract = command({
		name: "extract",
		args: {
			...filesource,
			...filerange,
			...saveArg("extract"),
			mode: option({ long: "mode", short: "m", type: cmdts.string, defaultValue: () => "bin", description: `A decode mode ${Object.keys(cacheFileDecodeModes).join(", ")}` }),
			edit: flag({ long: "edit", short: "e" }),
			skipread: flag({ long: "noread", short: "n" }),
			fixhash: flag({ long: "fixhash", short: "h" }),
			batched: flag({ long: "batched", short: "b" }),
			batchlimit: option({ long: "batchsize", type: cmdts.number, defaultValue: () => -1 }),
			keepbuffers: flag({ long: "keepbuffers" })
		},
		async handler(args) {
			let output = ctx.getConsole();
			let source = await args.source({ writable: args.edit });
			await output.run(extractCacheFiles, args.save, source, args);
		}
	});


	const filehist = command({
		name: "filehist",
		args: {
			...saveArg("extract"),
			id: option({ long: "id", short: "i", type: cmdts.string }),
			mode: option({ long: "mode", short: "m", type: cmdts.string, defaultValue: () => "bin", description: `A decode mode ${Object.keys(cacheFileDecodeModes).join(", ")}` })
		},
		async handler(args) {
			let output = ctx.getConsole();
			if (!cacheFileDecodeModes[args.mode]) { throw new Error("unkown mode"); }

			let id = args.id.split(".").map(q => +q);
			if (id.length == 0 || id.some(q => isNaN(q))) { throw new Error("invalid id"); }
			await output.run(fileHistory, args.save, args.mode as any, id, null, null);
		}
	});

	const edit = command({
		name: "edit",
		args: {
			...filesource,
			...saveArg("extract"),
		},
		async handler(args) {
			let output = ctx.getConsole();
			let source = await args.source({ writable: true });
			await output.run(writeCacheFiles, source, args.save);
		}
	})

	const indexoverview = command({
		name: "run",
		args: {
			...filesource,
			...saveArg("save")
		},
		handler: async (args) => {
			let source = await args.source();
			let output = ctx.getConsole();
			await output.run(indexOverview, args.save, source);
		}
	});

	const diff = command({
		name: "run",
		args: {
			...filerange,
			...saveArg("out"),
			a: option({ long: "cache1", short: "a", type: ReadCacheSource }),
			b: option({ long: "cache2", short: "b", type: ReadCacheSource })
		},
		handler: async (args) => {
			let sourcea = await args.a();
			let sourceb = await args.b();

			let output = ctx.getConsole();
			await output.run(diffCaches, args.save, sourcea, sourceb, args.files);

			sourcea.close();
			sourceb.close();
		}
	});

	const quickchat = command({
		name: "run",
		args: {
			...filesource,
			...saveArg("extract")
		},
		handler: async (args) => {
			let output = ctx.getConsole();
			let source = await args.source();
			output.run(quickChatLookup, args.save, source);
		}
	});

	const scrapeavatars = command({
		name: "run",
		args: {
			...filesource,
			...saveArg("extract"),
			skip: option({ long: "skip", short: "i", type: cmdts.number, defaultValue: () => 0 }),
			max: option({ long: "max", short: "m", type: cmdts.number, defaultValue: () => 500 }),
			json: flag({ long: "json", short: "j" })
		},
		handler: async (args) => {
			let output = ctx.getConsole();
			let source = (args.json ? await args.source() : null);
			await output.run(scrapePlayerAvatars, args.save, source, args.skip, args.max, args.json);
		}
	});

	const openrs2ids = command({
		name: "openrs2ids",
		args: {
			date: option({ long: "year", short: "d", defaultValue: () => "" }),
			near: option({ long: "near", short: "n", defaultValue: () => "" }),
			full: flag({ long: "full", short: "f" })
		},
		async handler(args) {
			let output = ctx.getConsole();
			await output.run(openrs2Ids, args.date, args.near, args.full);
		}
	})

	let subcommands = cmdts.subcommands({
		name: "",
		cmds: { extract, indexoverview, testdecode, diff, quickchat, scrapeavatars, edit, historicdecode, openrs2ids, filehist, cluecoords }
	});

	return {
		subcommands
	}
}