import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { quickchatcategories } from "../../generated/quickchatcategories";
import { parse } from "../opdecoder";
import { quickchatlines } from "../../generated/quickchatlines";
import prettyJson from "json-stringify-pretty-compact";
import { CLIScriptOutput, ScriptFS, ScriptOutput } from "../scriptrunner";
import { CacheFileSource } from "../cache";


export async function quickChatLookup(output: ScriptOutput, outdir: ScriptFS, source: CacheFileSource) {
	let catarch = await source.getArchiveById(cacheMajors.quickchat, 0);
	let linesarch = await source.getArchiveById(cacheMajors.quickchat, 1);

	let cats: quickchatcategories[] = [];
	for (let file of catarch) {
		cats[file.fileid] = parse.quickchatCategories.read(file.buffer, source);
	}
	let lines: quickchatcategories[] = [];
	for (let file of linesarch) {
		lines[file.fileid] = parse.quickchatLines.read(file.buffer, source);
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

	await outdir.writeFile("quickchat.json", prettyJson(hotkeys));
}
