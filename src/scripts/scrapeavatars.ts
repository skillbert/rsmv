import { cliArguments } from "../cliparser";
import { command, number, option, run } from "cmd-ts";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { avatarStringToBytes, lowname } from "../3d/avatar";


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


let cmd2 = command({
	name: "run",
	args: {
		save: option({ long: "save", short: "s" }),
		skip: option({ long: "skip", short: "i", type: number, defaultValue: () => 0 }),
		max: option({ long: "max", short: "m", type: number, defaultValue: () => 500 })
	},
	handler: async (args) => {
		fs.mkdirSync(args.save, { recursive: true });
		let count = 0;
		const pagesize = 25;
		let startpage = Math.floor(args.skip / pagesize);
		for (let page = startpage; count < args.max; page++) {
			let players = await getPlayerNames(0, 0, page);
			for (let player of players) {
				let data = await getPlayerAvatar(player);
				if (data) {
					fs.writeFileSync(path.resolve(args.save, `playerdata_${lowname(player)}.bin`), data);
					count++;
				}
			}
		}
	}
});


run(cmd2, cliArguments());