import { filesource, cliArguments, ReadCacheSource, filerange } from "./cliparser";
import { run, command, option, flag } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { DecodeMode, cacheFileDecodeModes, extractCacheFiles, cacheFileJsonModes, writeCacheFiles } from "./scripts/extractfiles";
import { CLIScriptFS, CLIScriptOutput, ScriptOutput } from "./viewer/scriptsui";
import { defaultTestDecodeOpts, testDecode, testDecodeHistoric, validOpenrs2Caches } from "./scripts/testdecode";
import * as cmdts from "cmd-ts";
import { indexOverview } from "./scripts/indexoverview";
import { diffCaches } from "./scripts/cachediff";
import { quickChatLookup } from "./scripts/quickchatlookup";
import { scrapePlayerAvatars } from "./scripts/scrapeavatars";

const testdecode = command({
	name: "testdecode",
	args: {
		...filesource,
		...filerange,
		save: option({ long: "save", short: "s", type: cmdts.string, defaultValue: () => "cache-errors" }),
		mode: option({ long: "mode", short: "m" })
	},
	handler: async (args) => {
		let errdir = new CLIScriptFS(args.save);
		let olderrfiles = await errdir.readDir(".");
		if (olderrfiles.find(q => !q.match(/^(err|pass|fail)-/))) {
			throw new Error("file not starting with 'err' in error dir");
		}
		await Promise.all(olderrfiles.map(q => errdir.unlink(q)));

		let output = new CLIScriptOutput();
		let source = await args.source();
		let mode = cacheFileJsonModes[args.mode];
		if (!mode) { throw new Error(`mode ${args.mode} not found, possible modes: ${Object.keys(cacheFileJsonModes).join(", ")}`) }
		let opts = defaultTestDecodeOpts();
		opts.outmode = "hextext";
		opts.maxerrs = 500;
		await output.run(testDecode, errdir, source, mode, args.files, opts);
	}
});

const historicdecode = command({
	name: "historicdecode",
	args: {
		...filesource,
		skipcurrent: flag({ long: "skipcurrent", short: "p", description: "skip current cache" }),
		before: option({ long: "before", short: "t", defaultValue: () => "" }),
		maxchecks: option({ long: "maxchecks", short: "n", type: cmdts.number, defaultValue: () => 0 })
	},
	async handler(args) {
		let startcache = await args.source();
		let output = new CLIScriptOutput();
		let fs = new CLIScriptFS("./cache-histerr");
		await output.run(testDecodeHistoric, fs, startcache, args.before, args.maxchecks);
	}
})

const extract = command({
	name: "extract",
	args: {
		...filesource,
		...filerange,
		save: option({ long: "save", short: "s", type: cmdts.string, defaultValue: () => "extract" }),
		mode: option({ long: "mode", short: "m", type: cmdts.string, defaultValue: () => "bin" }),
		edit: flag({ long: "edit", short: "e" }),
		fixhash: flag({ long: "fixhash", short: "h" }),
		batched: flag({ long: "batched", short: "b" }),
		batchlimit: option({ long: "batchsize", type: cmdts.number, defaultValue: () => -1 }),
		keepbuffers: flag({ long: "keepbuffers" })
	},
	async handler(args) {
		let outdir = new CLIScriptFS(args.save);
		let output = new CLIScriptOutput();
		let source = await args.source({ writable: args.edit });
		await output.run(extractCacheFiles, outdir, source, args);
		source.close();
	}
});

const edit = command({
	name: "edit",
	args: {
		...filesource,
		diffdir: option({ long: "diffdir", short: "d", type: cmdts.string })
	},
	async handler(args) {
		let diffdir = new CLIScriptFS(args.diffdir);
		let output = new CLIScriptOutput();
		let source = await args.source({ writable: true });
		await output.run(writeCacheFiles, source, diffdir);
		source.close();
	},
})

const indexoverview = command({
	name: "run",
	args: {
		...filesource
	},
	handler: async (args) => {
		let source = await args.source();
		let output = new CLIScriptOutput();
		let outdir = new CLIScriptFS(".");
		await output.run(indexOverview, outdir, source);
	}
});

const diff = command({
	name: "run",
	args: {
		a: option({ long: "cache1", short: "a", type: ReadCacheSource }),
		b: option({ long: "cache2", short: "b", type: ReadCacheSource }),
		out: option({ long: "out", short: "s", type: cmdts.string })
	},
	handler: async (args) => {
		let sourcea = await args.a();
		let sourceb = await args.b();

		let outdir = new CLIScriptFS(args.out);
		let output = new CLIScriptOutput();
		await output.run(diffCaches, outdir, sourcea, sourceb);

		sourcea.close();
		sourceb.close();
	}
});

const quickchat = command({
	name: "run",
	args: {
		...filesource
	},
	handler: async (args) => {
		let output = new CLIScriptOutput();
		let outdir = new CLIScriptFS(".");
		let source = await args.source();
		output.run(quickChatLookup, outdir, source);
		source.close();
	}
});

const scrapeavatars = command({
	name: "run",
	args: {
		...filesource,
		save: option({ long: "save", short: "s" }),
		skip: option({ long: "skip", short: "i", type: cmdts.number, defaultValue: () => 0 }),
		max: option({ long: "max", short: "m", type: cmdts.number, defaultValue: () => 500 }),
		json: flag({ long: "json", short: "j" })
	},
	handler: async (args) => {
		let outdir = new CLIScriptFS(args.save);
		let output = new CLIScriptOutput();
		let source = (args.json ? await args.source() : null);
		await output.run(scrapePlayerAvatars, outdir, source, args.skip, args.max, args.json);
	}
});

const openrs2ids = command({
	name: "openrs2ids",
	args: {
		date: option({ long: "year", short: "d", defaultValue: () => "" }),
		near: option({ long: "near", short: "n", defaultValue: () => "" })
	},
	async handler(args) {
		let allids = await validOpenrs2Caches();
		if (args.date) {
			let m = args.date.match(/20\d\d/);
			if (!m) { throw new Error("4 digit year expected"); }
			let year = +m[0];
			let enddate = new Date((year + 1) + "");
			let startdate = new Date(year + "");
			allids = allids.filter(q => q.timestamp && new Date(q.timestamp) >= startdate && new Date(q.timestamp) <= enddate);
		}
		if (args.near) {
			let index = allids.findIndex(q => q.id == +args.near);
			if (index == -1) { throw new Error("cache id not found"); }
			let amount = 10;
			let beforeamount = Math.min(index, amount);
			allids = allids.slice(index - beforeamount, index + 1 + amount);
		}
		for (let cache of allids) {
			let line = `id ${cache.id.toString().padStart(4)}, build ${cache.builds[0]?.major ?? "???"}`;
			line += ` - ${cache.timestamp ? new Date(cache.timestamp).toDateString() : "unknown date"}`;
			if (args.near && +args.near == cache.id) { line += " <--"; }
			console.log(line);
		}
	}
})

let subcommands = cmdts.subcommands({
	name: "cache tools cli",
	cmds: { extract, indexoverview, testdecode, diff, quickchat, scrapeavatars, edit, historicdecode, openrs2ids }
});

cmdts.run(subcommands, cliArguments());