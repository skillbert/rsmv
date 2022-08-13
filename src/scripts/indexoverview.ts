import { cacheMajors } from "../constants";
import { CLIScriptOutput, ScriptOutput } from "viewer/scriptsui";
import { CacheFileSource } from "cache";
import prettyJson from "json-stringify-pretty-compact";


export async function indexOverview(output: ScriptOutput, source: CacheFileSource) {
	let rootindex = await source.getIndexFile(cacheMajors.index);

	let majors: any[] = [];
	for (let indexfile of rootindex) {
		if (!indexfile) { continue; }
		let index = await source.getIndexFile(indexfile.minor);
		let minorcount = index.reduce((a, v) => a + 1, 0);
		let subfilecount = index.reduce((a, v) => a + v.subindexcount, 0);
		let maxsubfiles = index.reduce((a, v) => Math.max(a, v.subindexcount), 0);
		let minsubfiles = index.reduce((a, v) => Math.min(a, v.subindexcount), Infinity);
		let highestindex = index[index.length - 1].minor;
		let missingminors = highestindex + 1 - minorcount;
		let avgsubfiles = subfilecount / minorcount;

		let name = Object.entries(cacheMajors).find(([name, id]) => id == indexfile.minor)?.[0] ?? `unknown`;

		majors.push({ major: indexfile.minor, name, minorcount, subfilecount, highestindex, missingminors, avgsubfiles, maxsubfiles, minsubfiles });
	}
	let configs: any[] = [];
	let configindices = await source.getIndexFile(cacheMajors.config);
	for (let i in configindices) {//has gaps so cant use for of
		let index = configindices[i];
		configs.push({
			minor: index.minor,
			subindices: index.subindexcount,
			minindex: Math.min(...index.subindices),
			maxindex: Math.max(...index.subindices),
			missingindices: index.subindexcount + 1 - index.subindices[index.subindices.length - 1]
		});
	}
	output.writeFile("indexoverview.json", prettyJson({ majors, configs }));
}
