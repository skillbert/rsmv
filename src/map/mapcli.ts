
import { cliArguments, filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CLIScriptFS, CLIScriptOutput } from "../scriptrunner";
import { runMapRender } from ".";
import { MapRender, MapRenderDatabaseBacked, MapRenderFsBacked, parseMapConfig } from "./backends";
import { Openrs2CacheSource, openrs2GetEffectiveBuildnr, validOpenrs2Caches } from "../cache/openrs2loader";
import { stringToFileRange } from "../utils";
import { classicBuilds, ClassicFileSource, detectClassicVersions } from "../cache/classicloader";
import path from "path";
import fs from "fs/promises";

let cmd = cmdts.command({
	name: "download",
	args: {
		...filesource,
		classicFiles: cmdts.option({ long: "classicfiles", type: cmdts.optional(cmdts.string) }),
		builds: cmdts.option({ long: "builds", type: cmdts.optional(cmdts.string) }),
		ascending: cmdts.flag({ long: "ascending", short: "a" }),
		force: cmdts.flag({ long: "force", short: "f" }),
		ignorebefore: cmdts.option({ long: "ignorebefore", type: cmdts.optional(cmdts.string) }),
		//remote
		endpoint: cmdts.option({ long: "endpoint", short: "e", type: cmdts.optional(cmdts.string) }),
		auth: cmdts.option({ long: "auth", short: "p", type: cmdts.optional(cmdts.string) }),
		mapid: cmdts.option({ long: "mapid", type: cmdts.optional(cmdts.number) }),
		//fs
		configfile: cmdts.option({ long: "config", short: "c", type: cmdts.optional(cmdts.string) }),
		outdir: cmdts.option({ long: "out", short: "s", type: cmdts.optional(cmdts.string) })
	},
	handler: async (args) => {
		let output = new CLIScriptOutput();

		let ignorebefore = new Date(args?.ignorebefore ?? 0);

		let config: MapRender;
		if (args.endpoint) {
			if (!args.endpoint || !args.auth || typeof args.mapid != "number") {
				throw new Error("need --endpoint, --auth and --mapid to use a remote map save");
			}
			config = await MapRenderDatabaseBacked.create(args.endpoint, args.auth, args.mapid, false, ignorebefore);
		} else if (args.configfile) {
			let outdir = args.outdir ?? path.dirname(args.configfile!);
			let configfile = await fs.readFile(args.configfile!, "utf8");
			await fs.access(outdir);//check if we're allowed to write the outdir
			let scriptfs = new CLIScriptFS(outdir);
			config = new MapRenderFsBacked(scriptfs, parseMapConfig(configfile));
		} else {
			throw new Error("no map endpoint selected");
		}

		if (!args.builds) {
			let source = await args.source();
			await runMapRender(output, source, config, args.force);
		} else {
			let ranges = stringToFileRange(args.builds);

			let classicIterator = async function* (ascending: boolean) {
				if (args.classicFiles) {
					let fs = new CLIScriptFS(args.classicFiles);
					let versions = detectClassicVersions((await fs.readDir(".")).map(q => q.name));
					if (!ascending) {
						//defaults to heigh->low
						versions.reverse();
					}
					for (let version of versions) {
						if (!ranges.some(q => q.start[0] <= version.buildnr && q.end[0] >= version.buildnr)) {
							continue;
						}
						yield new ClassicFileSource(fs, version);
					}
				}
			}
			let rs2Iterator = async function* (ascending: boolean) {
				let caches = await validOpenrs2Caches();
				if (ascending) {
					caches.reverse();
				}
				for (let cache of caches) {
					let buildnr = openrs2GetEffectiveBuildnr(cache);
					if (!ranges.some(q => q.start[0] <= buildnr && q.end[0] >= buildnr)) {
						continue;
					}
					yield new Openrs2CacheSource(cache);
				}
			}

			let cacheiterator = async function* (ascending: boolean) {
				if (ascending) {
					yield* classicIterator(ascending);
					yield* rs2Iterator(ascending);
				} else {
					yield* rs2Iterator(ascending);
					yield* classicIterator(ascending);
				}
			}

			for await (let source of cacheiterator(args.ascending)) {
				output.log(`Starting '${source.getCacheMeta().name}', build: ${source.getBuildNr()}`);
				let cleanup = await runMapRender(output, source, config, args.force);
				cleanup();
			}
		}
	}
});

(async () => {
	let res = await cmdts.runSafely(cmd, cliArguments());
	let code = 0;
	if (res._tag == "error") {
		console.error(res.error.config.message);
		code = res.error.config.exitCode;
	} else {
		console.log("cmd completed", res.value);
	}
	if (globalThis.onCliCompleted) {
		globalThis.onCliCompleted(code);
	}
})();