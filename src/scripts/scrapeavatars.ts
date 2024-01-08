import { EngineCache, ThreejsSceneCache } from "../3d/modeltothree";
import fetch from "node-fetch";
import { avatarStringToBytes, avatarToModel, lowname } from "../3d/avatar";
import { CLIScriptFS, ScriptFS, ScriptOutput } from "../scriptrunner";
import prettyJson from "json-stringify-pretty-compact";
import { CacheFileSource } from "../cache";


async function getPlayerNames(cat: number, subcat: number, page: number) {
	//the api for this doesn't allow you to go past first page...
	let res = await fetch(`https://secure.runescape.com/m=hiscore/ranking?category_type=${cat}&table=${subcat}&page=${page + 1}`);
	if (!res.ok) { throw new Error(`getplayernames fetch failed ${res.status}, ${res.statusText}`); }
	let html = await res.text();
	let matches = html.matchAll(/\/m=avatar-rs\/([\w+\-]{2,12})\/chat.png\b/g);
	return [...matches].map(q => lowname(q[1]));
}

async function getPlayerAvatar(name: string) {
	let res = await fetch(`https://secure.runescape.com/m=avatar-rs/${encodeURIComponent(name)}/appearance.dat`);
	if (!res.ok) {
		if (res.status == 404) { return null; }
		throw new Error(`getplayeravatar fetch ${res.url} failed ${res.status}, ${res.statusText}`);
	}
	return avatarStringToBytes(await res.text());
}

export async function scrapePlayerAvatars(output: ScriptOutput, outdir: ScriptFS, source: CacheFileSource | null, skip: number, max: number, parsed: boolean) {
	let scene: ThreejsSceneCache | null = null;
	if (parsed) {
		if (!source) { throw new Error("need file source when extracting avatar data"); }
		let engine = await EngineCache.create(source);
		scene = await ThreejsSceneCache.create(engine);
	}
	for await (let file of fetchPlayerAvatars(skip, max)) {
		if (output.state != "running") { break; }
		if (parsed) {
			let data = await avatarToModel(scene!.engine, file.buf, false);
			await outdir.writeFile(`playerdata_${file.name}.json`, prettyJson(data.info.avatar));
		} else {
			outdir.writeFile(`playerdata_${file.name}.bin`, file.buf);
		}
	}
}

async function* fetchPlayerAvatars(skip: number, max: number) {
	let count = 0;
	const pagesize = 25;
	let startpage = Math.floor(skip / pagesize);
	for (let page = startpage; count < max; page++) {
		let players = await getPlayerNames(0, 0, page);
		for (let player of players) {
			let data = await getPlayerAvatar(player);
			if (data) {
				count++;
				yield { name: lowname(player), buf: data };
			}
		}
	}
}
