import { filesource, cliArguments } from "../cliparser";
import { run, command, number, option, string } from "cmd-ts";
import * as fs from "fs";
import * as path from "path";

let cmd = command({
	name: "download",
	args: {
		...filesource,
		major: option({ long: "major", type: number }),
		minor: option({ long: "minor", type: string }),
		save: option({ long: "save", short: "s", type: string })
	},
	handler: async (args) => {
		let minorparts = args.minor.split("-");
		let minormin = +minorparts[0];
		let minormax = +minorparts[0];
		if (minorparts.length == 2) { minormax = +minorparts[1]; }
		let indexfile = await args.source.getIndexFile(args.major);

		let outdir = path.resolve(args.save)
		fs.mkdirSync(outdir, { recursive: true });
		for (let index of indexfile) {
			let subindices: number[] = [];
			for (let i = 0; i < index.subindices.length; i++) {
				if (index.subindices[i] >= minormin && index.subindices[i] <= minormax) {
					subindices.push(i);
				}
			}
			if (subindices.length != 0) {
				let files = await args.source.getFileArchive(index);
				for (let i of subindices) {
					let filename = path.resolve(outdir, `${index.subindices[i]}.bin`);
					fs.writeFileSync(filename, files[i].buffer);
					console.log(filename, files[i].size);
				}
			}
		}
		args.source.close();
	}
});

run(cmd, cliArguments);
