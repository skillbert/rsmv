import { filesource, cliArguments, ReadCacheSource } from "../cliparser";
import { run, command, number, option, string, boolean, Type, flag, oneOf, optional } from "cmd-ts";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { quickchatcategories } from "../../generated/quickchatcategories";
import { parseQuickchatCategories, parseQuickchatLines } from "../opdecoder";
import { quickchatlines } from "../../generated/quickchatlines";
import prettyJson from "json-stringify-pretty-compact";


let cmd2 = command({
	name: "run",
	args: {
		...filesource
	},
	handler: async (args) => {
		let source = await args.source();
		let catarch = await source.getArchiveById(cacheMajors.quickchat, 0);
		let linesarch = await source.getArchiveById(cacheMajors.quickchat, 1);

		let cats: quickchatcategories[] = [];
		for (let file of catarch) {
			cats[file.fileid] = parseQuickchatCategories.read(file.buffer);
		}
		let lines: quickchatcategories[] = [];
		for (let file of linesarch) {
			lines[file.fileid] = parseQuickchatLines.read(file.buffer);
		}


		let hotkeys: Record<string, quickchatlines> = {};

		let visited = new Map<quickchatcategories, boolean>();

		let iter = (cat: quickchatcategories, hotkey: string) => {
			if (visited.has(cat)) { return; }
			visited.set(cat, true);
			let hotkeycounter = 1;
			let gethotkey = (key: number) => {
				if (key != 0) { return hotkey + String.fromCharCode(key); }
				return hotkey + ((hotkeycounter++) + "").slice(-1);
			}
			for (let child of cat.subcategories ?? []) {
				iter(cats[child.id], gethotkey(child.hotkey));
			}
			for (let line of cat.lines ?? []) {
				let lineobj = lines[line.id];
				hotkeys[gethotkey(line.hotkey)] = lineobj;
			}
		}

		iter(cats[85], "");

		console.log(prettyJson(hotkeys));
		source.close();
	}
})

run(cmd2, cliArguments());
