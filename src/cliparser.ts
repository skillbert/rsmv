import * as cmdts from "cmd-ts";
import { ArgParser } from "cmd-ts/dist/cjs/argparser";

import { CacheFileSource, CallbackCacheLoader } from "./cache";
import { CacheDownloader } from "./cache/downloader";
import { GameCacheLoader } from "./cache/sqlite";
import { RawFileLoader } from "./cache/rawfiles";
import { Openrs2CacheSource, validOpenrs2Caches } from "./cache/openrs2loader";
import type { MapRect } from "./3d/mapsquare";
import { FileRange, stringToFileRange, stringToMapArea } from "./utils";
import { selectFsCache } from "./cache/autocache";
import { CLIScriptFS } from "./scriptrunner";

export type Rect = { x: number, y: number, width: number, height: number };

export type CacheOpts = { writable?: boolean } | undefined;

function cacheSourceFromString(str: string) {
	let [mode, ...argparts] = str.split(":",);
	let arg = argparts.join(":");
	return async (opts: CacheOpts) => {
		switch (mode) {
			case "live":
				return new CacheDownloader();
			case "auto":
				let fs = new CLIScriptFS(arg);
				return selectFsCache(fs, opts);
			case "nxt":
			case "cache":
				return new GameCacheLoader(arg, opts?.writable ?? false);
			case "cache-write":
				return new GameCacheLoader(arg, true);
			case "openrs":
			case "openrs2":
				return Openrs2CacheSource.fromId(+arg);
			case "openrslast":
			case "openrs2last":
				let target = await Openrs2CacheSource.getRecentCache(+(arg ?? "0"));
				if (!target) { throw new Error(`cache index ${arg} not found`); }
				console.log(`opening openrs2:${target.id}`);
				return new Openrs2CacheSource(target);
			case "extracted":
				return new RawFileLoader(arg, 0);
			case "global":
				let fn = globalThis[arg];
				if (typeof fn != "function") {
					throw new Error("the 'global' cache source requires a callback function with name <arg> to be exposed on the global scope");
				}
				return new CallbackCacheLoader(fn, false);
			default:
				throw new Error("unknown cache mode");
		}
	}
}

export const ReadCacheSource: cmdts.Type<string, (opts?: { writable?: boolean }) => Promise<CacheFileSource>> = {
	async from(str) { return cacheSourceFromString(str); },
	defaultValue: () => cacheSourceFromString("cache"),
	description: "Where to get game files from, can be 'live', 'cache[:rscachedir]', openrs2[:ors2cacheid] or openrs2last[:skipcount]"
};

const FileRange: cmdts.Type<string, FileRange[]> = {
	async from(str) { return stringToFileRange(str); },
	description: "A file range with possible multiple components. '10', '10-20', '10,12' or '5.10-5.20' etc"
};

const MapRectangle: cmdts.Type<string, MapRect> = {
	async from(str) {
		let rect = stringToMapArea(str);
		if (!rect) { throw new Error("expected maprect format: x,y,xsize,zsize"); }
		return rect;
	},
	description: "A square of map coordinates as 'x,y', 'x,y,size' or 'x,y,w,h'"
};

//forces typescript to keep track of the argparser type
function literal<T extends Record<string, ArgParser<any>>>(args: T) {
	return args;
}

export var filesource = literal({
	source: cmdts.option({ long: "source", short: "o", type: ReadCacheSource })
});
export var filerange = literal({
	files: cmdts.option({ long: "ids", short: "i", type: FileRange, defaultValue: () => [{ start: [0, 0, 0], end: [Infinity, Infinity, Infinity] }] as FileRange[] })
});
export var mapareasource = literal({
	area: cmdts.option({ long: "area", short: "a", type: MapRectangle })
});
export var mapareasourceoptional = literal({
	area: cmdts.option({ long: "area", short: "a", defaultValue: () => null, type: MapRectangle as cmdts.Type<string, MapRect | null> })
});


declare var originalcmd: { argv: string[], cwd: string };

export function cliArguments(argv?: string[]) {
	//skip command line arguments until we find two args that aren't flags (electron.exe and the main script)
	//we have to do this since electron also includes flags like --inspect in argv
	let args = argv ?? (typeof originalcmd != "undefined" ? originalcmd.argv : process.argv.slice());
	for (let skip = 2; skip > 0 && args.length > 0; args.shift()) {
		if (!args[0].startsWith("-")) { skip--; }
	}
	return args;
}
export function runCliApplication(runner: cmdts.Runner<any, any>) {
	return cmdts.run(runner, cliArguments());
}