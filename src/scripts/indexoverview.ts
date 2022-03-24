import { cliArguments } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf } from "cmd-ts";
import { cacheMajors } from "../constants";
import { GameCacheLoader } from "../cacheloader";

let cmd2 = command({
	name: "run",
	args: {
		// save: option({ long: "save", short: "s", type: string, defaultValue: () => "extract" }),
	},
	handler: async (args) => {
		let source = new GameCacheLoader();
		let majors = source.scanMajors();
		console.log("[");
		for (let major of majors) {
			let index = await source.getIndexFile(major);
			let minorcount = index.reduce((a, v) => a + 1, 0);
			let subfilecount = index.reduce((a, v) => a + v.subindexcount, 0);
			let maxsubfiles = index.reduce((a, v) => Math.max(a, v.subindexcount), 0);
			let minsubfiles = index.reduce((a, v) => Math.min(a, v.subindexcount), Infinity);
			let highestindex = index[index.length - 1].minor;
			let missingminors = highestindex + 1 - minorcount;
			let avgsubfiles = subfilecount / minorcount;

			let name = Object.entries(cacheMajors).find(([name, id]) => id == major)?.[0] ?? `unknown`;

			console.log(JSON.stringify({ major, name, minorcount, subfilecount, highestindex, missingminors, avgsubfiles, maxsubfiles, minsubfiles }, null, "  "), ",");
		}
		let configindices = await source.getIndexFile(cacheMajors.config);
		// console.log("/////////////////   CONFIG SUBFILES  ////////////////////////////");
		for (let i in configindices) {//has gaps so cant use for of
			let index = configindices[i];
			console.log(JSON.stringify({
				minor: index.minor,
				subindices: index.subindexcount,
				minindex: Math.min(...index.subindices),
				maxindex: Math.max(...index.subindices),
				missingindices: index.subindexcount + 1 - index.subindices[index.subindices.length - 1]
			}, null, "  "));
			console.log(",");
		}
		console.log("]");
	}
})


run(cmd2, cliArguments());
