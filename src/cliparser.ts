import * as path from "path";
import * as cmdts from "cmd-ts";
import { ArgParser } from "cmd-ts/dist/cjs/argparser";

import { Type, option } from 'cmd-ts';
import fs from 'fs';
import { CacheFileSource } from "./main";
import { Downloader } from "./downloader";
import * as updater from "./updater";
import { GameCacheLoader } from "./cacheloader";

let loadingIndicator = {
	interval: 1000,
	start: async () => { },
	progress: (d: any) => { console.log(`${d.message}${d.max ? ` ${d.value}/${d.max}` : ""}`) },
	done: async () => { console.log("done"); }
}

//expose here so we can override it for ui
export function setLoadingIndicator(ind: typeof loadingIndicator) {
	loadingIndicator = ind;
}

const ReadCacheSource: Type<string, CacheFileSource> = {
	async from(str) {
		let [mode, ...argparts] = str.split(":",);
		let arg = argparts.join(":");
		switch (mode) {
			case "live":
				return new Downloader();
			case "local":
				updater.on("update-progress", loadingIndicator.progress.bind(loadingIndicator));
				await loadingIndicator.start();
				await updater.run(arg || "cache", loadingIndicator.interval);
				await loadingIndicator.done();
				return updater.fileSource;
			case "cache":
				return new GameCacheLoader(arg || path.resolve(process.env.ProgramData!, "jagex/runescape"));
			default:
				throw new Error("unknown mode");
		}
	},
	defaultValue: () => new Downloader(),
	description: "Where to get game files from, can be 'live', 'local[:filedir]' or 'cache[:rscachedir]'"
};

//forces typescript to keep track of the argparser type
function literal<T extends Record<string, ArgParser<any>>>(args: T) {
	return args;
}

export var filesource = literal({
	source: option({ long: "source", short: "o", type: ReadCacheSource })
});


//skip command line arguments until we find two args that aren't flags (electron.exe and the main script)
//we have to do this since electron also includes flags like --inspect in argv
let args = process.argv.slice();
for (let skip = 2; skip > 0 && args.length > 0; args.shift()) {
	if (!args[0].startsWith("-")) { skip--; }
}
export var cliArguments = args;

export function runCliApplication(runner: cmdts.Runner<any, any>) {
	return cmdts.run(runner, cliArguments);
}