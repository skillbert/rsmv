
import { cliArguments, filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CLIScriptFS, CLIScriptOutput } from "../viewer/scriptsui";
import { runMapRender } from ".";
import { Openrs2CacheSource, openrs2GetEffectiveBuildnr, validOpenrs2Caches } from "../cache/openrs2loader";
import { stringToFileRange } from "../utils";
import { classicBuilds, ClassicFileSource, detectClassicVersions } from "../cache/classicloader";

let cmd = cmdts.command({
	name: "download",
	args: {
		...filesource,
		classicFiles: cmdts.option({ long: "classicfiles" }),
		endpoint: cmdts.option({ long: "endpoint", short: "e" }),
		auth: cmdts.option({ long: "auth", short: "p" }),
		mapid: cmdts.option({ long: "mapid", type: cmdts.number }),
		builds: cmdts.option({ long: "builds", type: cmdts.string, defaultValue: () => "" })
	},
	handler: async (args) => {
		let output = new CLIScriptOutput();

		if (!args.builds) {
			let source = await args.source();
			await runMapRender(output, source, args.endpoint, args.auth, args.mapid, false);
		} else {
			let ranges = stringToFileRange(args.builds);

			let cacheiterator = async function* () {
				let caches = await validOpenrs2Caches();
				for (let cache of caches) {
					let buildnr = openrs2GetEffectiveBuildnr(cache);
					if (!ranges.some(q => q.start[0] <= buildnr && q.end[0] >= buildnr)) {
						continue;
					}
					yield new Openrs2CacheSource(cache);
				}

				if (args.classicFiles) {
					let fs = new CLIScriptFS(args.classicFiles);
					let versions = detectClassicVersions(await fs.readDir("."));
					versions.reverse();//high to low
					for (let version of versions) {
						if (!ranges.some(q => q.start[0] <= version.buildnr && q.end[0] >= version.buildnr)) {
							continue;
						}
						yield new ClassicFileSource(fs, version);
					}
				}
			}

			for await (let source of cacheiterator()) {
				output.log(`Starting '${source.getCacheMeta().name}', build: ${source.getBuildNr()}`);
				let cleanup = await runMapRender(output, source, args.endpoint, args.auth, args.mapid, false);
				cleanup();
			}
		}
	}
});

(async () => {
	let res = await cmdts.runSafely(cmd, cliArguments());
	if (res._tag == "error") {
		console.error(res.error.config.message);
	} else {
		console.log("cmd completed", res.value);
	}
})();