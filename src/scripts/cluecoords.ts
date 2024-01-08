import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { CacheFileSource } from "../cache";
import { ScriptFS, ScriptOutput } from "../scriptrunner";

type Coord = { x: number, z: number, level: number };

export async function extractCluecoords(output: ScriptOutput, fs: ScriptFS, filesource: CacheFileSource) {
	let enums: number[] = [];
	let itemindex = await filesource.getCacheIndex(cacheMajors.items);
	for (let index of itemindex) {
		let files = await filesource.getFileArchive(index);
		for (let file of files) {
			let item = parse.item.read(file.buffer, filesource);
			let prop = item.extra?.find(q => q.prop == 235);
			if (prop) { enums.push(prop.intvalue!); }
		}
	}

	let allcoords: Coord[][] = [];

	for (let enumid of enums) {
		let file = await filesource.getFileById(cacheMajors.enums, enumid);
		let parsed = parse.enums.read(file, filesource);
		let coords: Coord[] = parsed.intArrayValue2!.values.map(v => ({
			x: (v[1] >> 14) & 16383,
			z: (v[1] >> 0) & 16383,
			level: (v[1] >> 28) & 3
		}));
		// if (enumid == 13504) { debugger; }
		fs.writeFile(`${enumid}.json`, JSON.stringify(coords, undefined, "\t"));
		allcoords.push(coords);
	}
	let idmapping = [
		4,//ardougne
		3,//varrock
		11,//isafdar and lletya
		2,//falador
		10,//piscatoris
		23,//menaphos
		6,//haunted woods
		8,//north of nardah
		22,//deep wildy
		21,//wilderness volcano
		7,//khazari jungle
		5,//jatiszo and nezzy
		16,//keldagrim
		20,//zanaris
		15,//fremmy slayer
		17,//lumby swamp caves
		14,//dorgesh-kaan
		12,//brimhaven dungeon
		18,//taverley dungeon
		9,//mos'le harmless
		13,//chaos tunnels
		0,//main world compass clue
		24,//priff
		25,//darkemeyer
		27,//heart of geilinor
		26,//torle islands
		50,//eastern lands compass
	];
	let indexedcoords = allcoords.flatMap((q, i) => {
		let clueid = idmapping[i];
		return q.map(w => ({ ...w, clueid }));
	})
	await fs.writeFile(`allcoords.json`, JSON.stringify(indexedcoords, undefined, "\t"));
	output.log("done");
}