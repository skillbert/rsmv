import fetch from "node-fetch";
import { avatarStringToBytes, lowname } from "../3d/avatar";
import { ScriptOutput } from "../viewer/scriptsui";


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

export async function scrapePlayerAvatars(output: ScriptOutput, skip: number, max: number) {
	let count = 0;
	const pagesize = 25;
	let startpage = Math.floor(skip / pagesize);
	for (let page = startpage; count < max; page++) {
		let players = await getPlayerNames(0, 0, page);
		for (let player of players) {
			let data = await getPlayerAvatar(player);
			if (data) {
				output.writeFile(`playerdata_${lowname(player)}.bin`, data);
				count++;
			}
		}
	}
}
