import { filesource, cliArguments, ReadCacheSource } from "./cliparser";
import { run, command, option, flag } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { DecodeMode, cacheFileDecodeModes, extractCacheFiles, cacheFileJsonModes, writeCacheFiles } from "./scripts/extractfiles";
import { CLIScriptFS, CLIScriptOutput, ScriptOutput } from "./viewer/scriptsui";
import { defaultTestDecodeOpts, testDecode } from "./scripts/testdecode";
import * as cmdts from "cmd-ts";
import { indexOverview } from "./scripts/indexoverview";
import { diffCaches } from "./scripts/cachediff";
import { quickChatLookup } from "./scripts/quickchatlookup";
import { scrapePlayerAvatars } from "./scripts/scrapeavatars";

const testdecode = command({
	name: "testdecode",
	args: {
		...filesource,
		mode: option({ long: "mode", short: "m" })
	},
	handler: async (args) => {
		const errdir = new CLIScriptFS("./cache5/errs");
		let olderrfiles = await errdir.readDir(".");
		if (olderrfiles.find(q => !q.match(/^err/))) {
			throw new Error("file not starting with 'err' in error dir");
		}
		await Promise.all(olderrfiles.map(q => errdir.unlink(q)));

		let output = new CLIScriptOutput();
		let source = await args.source();
		let mode = cacheFileJsonModes[args.mode];
		if (!mode) { throw new Error(`mode ${args.mode} not found, possible modes: ${Object.keys(cacheFileJsonModes).join(", ")}`) }
		await output.run(testDecode, errdir, source, mode, defaultTestDecodeOpts());
	}
});

const extract = command({
	name: "extract",
	args: {
		...filesource,
		save: option({ long: "save", short: "s", type: cmdts.string, defaultValue: () => "extract" }),
		mode: option({ long: "mode", short: "m", type: cmdts.string, defaultValue: () => "bin" }),
		files: option({ long: "ids", short: "i", type: cmdts.string, defaultValue: () => "" }),
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

let subcommands = cmdts.subcommands({
	name: "cache tools cli",
	cmds: { extract, indexoverview, testdecode, diff, quickchat, scrapeavatars, edit }
});

cmdts.run(subcommands, cliArguments());