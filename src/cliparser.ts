import * as cmdts from "cmd-ts";
import { ArgParser } from "cmd-ts/dist/cjs/argparser";

import { Type, option } from 'cmd-ts';
import { CacheFileSource } from "./cache";
import { Downloader } from "./cache/downloader";
import * as updater from "./cache/updater";
import { GameCacheLoader } from "./cache/sqlite";
import { MapRect } from "./3d/mapsquare";
import { RawFileLoader } from "./cache/rawfiles";
import { Openrs2CacheSource } from "./cache/openrs2loader";

export type Rect = { x: number, y: number, width: number, height: number };

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

export const ReadCacheSource: Type<string, (opts?: { writable?: boolean }) => Promise<CacheFileSource>> = {
	async from(str) {
		let [mode, ...argparts] = str.split(":",);
		let arg = argparts.join(":");
		return async (opts) => {
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
					return new GameCacheLoader(arg, !!opts?.writable);
				case "files":
					return new RawFileLoader(arg, 0);
				case "openrs2":
					return new Openrs2CacheSource(arg);
				default:
					throw new Error("unknown mode");
			}
		}
	},
	defaultValue: () => () => Promise.resolve(new GameCacheLoader()),//yep, you saw it here first, the double lambda without brackets
	description: "Where to get game files from, can be 'live', 'local[:filedir]' or 'cache[:rscachedir]'"
};

export function stringToMapArea(str: string) {
	let [x, z, xsize, zsize] = str.split(/[,\.\/:;]/).map(n => +n);
	xsize = xsize ?? 1;
	zsize = zsize ?? xsize;
	if (isNaN(x) || isNaN(z) || isNaN(xsize) || isNaN(zsize)) { return null; }
	return { x, z, xsize, zsize };
}

const MapRectangle: Type<string, MapRect> = {
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
	source: option({ long: "source", short: "o", type: ReadCacheSource })
});

export var mapareasource = literal({
	area: option({ long: "area", short: "a", type: MapRectangle })
});
export var mapareasourceoptional = literal({
	area: option({ long: "area", short: "a", defaultValue: () => null, type: MapRectangle as cmdts.Type<string, MapRect | null> })
});


export function cliArguments(argv?: string[]) {
	//skip command line arguments until we find two args that aren't flags (electron.exe and the main script)
	//we have to do this since electron also includes flags like --inspect in argv
	let args = argv ?? process.argv.slice();
	for (let skip = 2; skip > 0 && args.length > 0; args.shift()) {
		if (!args[0].startsWith("-")) { skip--; }
	}
	return args;
}
export function runCliApplication(runner: cmdts.Runner<any, any>) {
	return cmdts.run(runner, cliArguments());
}