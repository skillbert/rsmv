
import { cliArguments, filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CLIScriptFS, CLIScriptOutput } from "../scriptrunner";
import { getVersionsFile, runMapRender } from ".";
import { MapRender, MapRenderFsBacked, MapRenderS3Backed, parseMapConfig, S3BackendConfig } from "./backends";
import { Openrs2CacheSource, openrs2GetEffectiveBuildnr, validOpenrs2Caches } from "../cache/openrs2loader";
import { stringToFileRange } from "../utils";
import { classicBuilds, ClassicFileSource, detectClassicVersions } from "../cache/classicloader";
import { extractVersionSlice } from "./varianttracker";
import path from "path";
import fs from "fs/promises";
import { CacheFileSource } from "../cache";

let cmd = cmdts.command({
	name: "download",
	args: {
		...filesource,
		classicFiles: cmdts.option({ long: "classicfiles", type: cmdts.optional(cmdts.string) }),
		builds: cmdts.option({ long: "builds", type: cmdts.optional(cmdts.string) }),
		cacheids: cmdts.option({ long: "cacheids", type: cmdts.optional(cmdts.string) }),
		livefolder: cmdts.option({ long: "livefolder", type: cmdts.optional(cmdts.string) }),
		ascending: cmdts.flag({ long: "ascending", short: "a" }),
		force: cmdts.flag({ long: "force", short: "f" }),
		configfile: cmdts.option({ long: "config", short: "c", type: cmdts.string }),
		//remote
		mapname: cmdts.option({ long: "mapname", type: cmdts.optional(cmdts.string) }),
		s3host: cmdts.option({ long: "s3host", short: "e", type: cmdts.optional(cmdts.string) }),
		s3bucket: cmdts.option({ long: "s3bucket", type: cmdts.optional(cmdts.string) }),
		s3id: cmdts.option({ long: "s3id", type: cmdts.optional(cmdts.string) }),
		s3key: cmdts.option({ long: "s3key", type: cmdts.optional(cmdts.string) }),
		//fs
		outdir: cmdts.option({ long: "out", short: "s", type: cmdts.optional(cmdts.string) })
	},
	handler: async (args) => {
		let output = new CLIScriptOutput();

		let ismultiversion = !!args.builds || !!args.cacheids || !!args.livefolder;

		let renderconfig = parseMapConfig(await fs.readFile(args.configfile!, "utf8"));
		let config: MapRender;
		if (args.s3host) {
			if (!args.s3host || !args.s3bucket || !args.s3id || !args.s3key) {
				throw new Error("need --s3host, --s3bucket, --s3id and --s3key to save to s3");
			}
			let s3conf: S3BackendConfig = {
				endpoint: args.s3host,
				bucket: args.s3bucket,
				prefix: args.mapname ? `${args.mapname}/` : "",
				accessKeyId: args.s3id,
				secretAccessKey: args.s3key
			};
			config = new MapRenderS3Backed(s3conf, renderconfig, ismultiversion);
		} else {
			let outdir = args.outdir ?? path.dirname(args.configfile!);
			// await fs.access(outdir);//check if we're allowed to write the outdir
			let scriptfs = new CLIScriptFS(outdir);
			config = new MapRenderFsBacked(scriptfs, renderconfig, ismultiversion);
		}

		if (!ismultiversion) {
			let source = await args.source();
			await runMapRender(output, source, config, args.force);
		} else {
			if (args.builds || args.cacheids) {
				let cacheiterator: AsyncGenerator<CacheFileSource>;
				if (args.builds) {
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

					cacheiterator = (async function* () {
						let ascending = !!args.ascending;
						if (ascending) {
							yield* classicIterator(ascending);
							yield* rs2Iterator(ascending);
						} else {
							yield* rs2Iterator(ascending);
							yield* classicIterator(ascending);
						}
					})();
				} else {
					cacheiterator = (async function* () {
						let ids = args.cacheids!.split(",").map(q => q.trim());
						for (let id of ids) {
							if (!isFinite(+id)) { throw new Error(`invalid cache id ${id}`); }
							let cache = await Openrs2CacheSource.fromId(+id);
							if (!cache) {
								output.log(`cache with id ${id} not found, skipping`);
								continue;
							}
							yield cache;
						}
					})();
				}

				for await (let source of cacheiterator) {
					output.log(`Starting '${source.getCacheMeta().name}', build: ${source.getBuildNr()}`);
					globalThis.onWatchdogProgress?.();
					let cleanup = await runMapRender(output, source, config, args.force);
					cleanup();
					cleanup = null!;//prevent memory leak
					globalThis.onWatchdogProgress?.();
				}
			}
			if (args.livefolder) {
				let versionsfile = await getVersionsFile(config);
				let version = versionsfile.versions.sort((a, b) => b.version - a.version)[0];
				await extractVersionSlice(output, config, version.version, args.livefolder);
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
	globalThis.onCliCompleted?.(code);
})();