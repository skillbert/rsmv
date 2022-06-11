import { filesource, cliArguments, ReadCacheSource } from "./cliparser";
import { run, command, option, flag } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";
import { DecodeMode, cacheFileDecodeModes, extractCacheFiles } from "./scripts/extractfiles";
import { CLIScriptOutput, ScriptOutput } from "./viewer/scriptsui";
import { defaultTestDecodeOpts, testDecode } from "./scripts/testdecode";
import * as cmdts from "cmd-ts";
import { indexOverview } from "./scripts/indexoverview";
import { diffCaches } from "./scripts/cachediff";
import { quickChatLookup } from "./scripts/quickchatlookup";
import { scrapePlayerAvatars } from "./scripts/scrapeavatars";

const testdecode = command({
	name: "testdecode",
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
		await output.run(testDecode, source, mode, defaultTestDecodeOpts());
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
		batchlimit: option({ long: "batchsize", type: cmdts.number, defaultValue: () => -1 })
	},
	handler: async (args) => {
		let outdir = path.resolve(args.save);
		fs.mkdirSync(outdir, { recursive: true });
		let output = new CLIScriptOutput(outdir);
		let source = await args.source({ writable: args.edit });
		await output.run(extractCacheFiles, source, args);
		source.close();
	}
});

const indexoverview = command({
	name: "run",
	args: {
		...filesource
	},
	handler: async (args) => {
		let source = await args.source();
		let output = new CLIScriptOutput("");
		await output.run(indexOverview, source);
	}
});

const diff = command({
	name: "run",
	args: {
		a: option({ long: "cache1", short: "a", type: ReadCacheSource }),
		b: option({ long: "cache2", short: "b", type: ReadCacheSource }),
	},
	handler: async (args) => {
		let sourcea = await args.a();
		let sourceb = await args.b();

		let output = new CLIScriptOutput("cache5/changes2");
		await output.run(diffCaches, sourcea, sourceb);

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
		let output = new CLIScriptOutput("");
		let source = await args.source();
		output.run(quickChatLookup, source);
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
		let output = new CLIScriptOutput(args.save);
		let source = (args.json ? await args.source() : null);
		await output.run(scrapePlayerAvatars, source, args.skip, args.max, args.json);
	}
});

let subcommands = cmdts.subcommands({
	name: "cache tools cli",
	cmds: { extract, indexoverview, testdecode, diff, quickchat, scrapeavatars }
});

cmdts.run(subcommands, cliArguments());