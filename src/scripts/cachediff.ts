import { filesource, cliArguments, ReadCacheSource } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf, optional } from "cmd-ts";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";


let cmd2 = command({
	name: "run",
	args: {
		a: option({ long: "cache-a", short: "a", type: ReadCacheSource }),
		b: option({ long: "cache-b", short: "b", type: ReadCacheSource }),
	},
	handler: async (args) => {
		let sourcea = await args.a();
		let sourceb = await args.b();

		let majors: number[] = [];
		let roota = await sourcea.getIndexFile(cacheMajors.index);
		let rootb = await sourceb.getIndexFile(cacheMajors.index);
		let rootmaxlen = Math.max(roota.length, rootb.length);
		for (let i = 0; i < rootmaxlen; i++) {
			if (roota[i] && !rootb[i]) { console.log(`major ${i} removed`); }
			if (!roota[i] && rootb[i]) { console.log(`major ${i} added`); }
			if (roota[i] && rootb[i]) { majors.push(i); }
		}
		for (let major of majors) {
			let majorname = Object.entries(cacheMajors).find(q => q[1] == major)?.[0] ?? `${major}`;
			let indexa = await sourcea.getIndexFile(major);
			let indexb = await sourceb.getIndexFile(major);
			let len = Math.max(indexa.length, indexb.length);
			for (let i = 0; i < len; i++) {
				let metaa = indexa[i], metab = indexb[i];
				if (metaa && !metab) { console.log(`${majorname}.${i} removed`); }
				if (!metaa && metab) { console.log(`${majorname}.${i} added`); }
				if (metaa && metab) {
					if (metaa.version != metab.version) {
						console.log(`${majorname}.${i} changed`);
					}
				}
			}
		}
	}
})

run(cmd2, cliArguments());
