import { cacheMajors } from "../constants";
import { CLIScriptOutput, ScriptFS, ScriptOutput } from "../scriptrunner";
import { CacheFileSource } from "cache";
import prettyJson from "json-stringify-pretty-compact";


export async function indexOverview(output: ScriptOutput, outdir: ScriptFS, source: CacheFileSource) {
	let rootindex = await source.getCacheIndex(cacheMajors.index);

	let majors: any[] = [];
	for (let indexfile of rootindex) {
		if (!indexfile) { continue; }
		let index = await source.getCacheIndex(indexfile.minor);
		let minorcount = index.reduce((a, v) => a + 1, 0);
		let subfilecount = index.reduce((a, v) => a + v.subindexcount, 0);
		let maxsubfiles = index.reduce((a, v) => Math.max(a, v.subindexcount), 0);
		let minsubfiles = index.reduce((a, v) => Math.min(a, v.subindexcount), Infinity);
		let totalsize = 0;
		for (let minor of index) { if (minor && minor.size) { totalsize += minor.size; } }
		let highestindex = index[index.length - 1]?.minor ?? -1;
		let missingminors = highestindex + 1 - minorcount;
		let avgsubfiles = +(subfilecount / minorcount).toFixed(2);
		let avgsize = Math.round(totalsize / minorcount);
		let avgsubsize = Math.round(totalsize / subfilecount);
		let totalsizemb = Math.round(totalsize / 1000) / 1000;

		let name = Object.entries(cacheMajors).find(([name, id]) => id == indexfile.minor)?.[0] ?? `unknown`;

		majors.push({ major: indexfile.minor, name, minorcount, subfilecount, highestindex, missingminors, avgsubfiles, maxsubfiles, minsubfiles, totalsizemb, avgsize, avgsubsize });
	}
	let configs: any[] = [];
	let configindices = await source.getCacheIndex(cacheMajors.config);
	for (let i in configindices) {//has gaps so cant use for of
		let index = configindices[i];
		configs.push({
			minor: index.minor,
			subindices: index.subindexcount,
			minindex: Math.min(...index.subindices),
			maxindex: Math.max(...index.subindices),
			missingindices: index.subindices[index.subindices.length - 1] + 1 - index.subindexcount
		});
	}
	outdir.writeFile("indexoverview.json", prettyJson({ majors, configs }));
}
