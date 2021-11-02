import * as fs from "fs";
import * as opcode_reader from "./opcode_reader";

//alloc a large static buffer to write data to without knowing the data size
//then copy what we need out of it
//the buffer is reused so it saves a ton of buffer allocs
const scratchbuf = Object.assign(Buffer.alloc(1024 * 100), { scan: 0 });

export class FileParser<T> {
	parser: opcode_reader.ChunkParser<T>;

	constructor(opcodePath: string) {
		const typedef = JSON.parse(fs.readFileSync(__dirname + "/opcodes/typedef.json", "utf-8"));
		const _opcodes = JSON.parse(fs.readFileSync(opcodePath, "utf-8"));
		this.parser = opcode_reader.buildParser(_opcodes, typedef);
	}

	read(buffer: Buffer) {
		let scanbuf = Object.assign(buffer, { scan: 0 });
		let res = this.parser.read(scanbuf, {});
		if (scanbuf.scan != scanbuf.length) {
			console.log(`bytes left over after decoding file: ${scanbuf.length - scanbuf.scan}`);
		}
		return res;
	}

	write(obj: T) {
		this.parser.write(scratchbuf, obj);
		//do the weird prototype slice since we need a copy, not a ref
		let r: Buffer = Uint8Array.prototype.slice.call(scratchbuf, 0, scratchbuf.scan);
		//clear it for next use
		scratchbuf.fill(0, 0, scratchbuf.scan);
		scratchbuf.scan = 0;
		return r;
	}
}
export const parseCacheIndex = new FileParser<import("../generated/cacheindex").cacheindex>(__dirname + "/opcodes/cacheindex.json");
export const parseNpc = new FileParser<import("../generated/npcs").npcs>(__dirname + "/opcodes/npcs.json");
export const parseItem = new FileParser<import("../generated/items").items>(__dirname + "/opcodes/items.json");
export const parseObject = new FileParser<import("../generated/objects").objects>(__dirname + "/opcodes/objects.json");
export const parseAchievement = new FileParser<import("../generated/achievements").achievements>(__dirname + "/opcodes/achievements.json");
export const parseMapsquareTiles = new FileParser<import("../generated/mapsquare_tiles").mapsquare_tiles>(__dirname + "/opcodes/mapsquare_tiles.json");
export const parseMapsquareUnderlays = new FileParser<import("../generated/mapsquare_underlays").mapsquare_underlays>(__dirname + "/opcodes/mapsquare_underlays.json");


