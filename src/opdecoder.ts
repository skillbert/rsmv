// import * as fs from "fs";
import * as opcode_reader from "./opcode_reader";

const typedef = require("./opcodes/typedef.json");

//alloc a large static buffer to write data to without knowing the data size
//then copy what we need out of it
//the buffer is reused so it saves a ton of buffer allocs
const scratchbuf = Object.assign(Buffer.alloc(1024 * 100), { scan: 0 });


let bytesleftoverwarncount = 0;
export class FileParser<T> {
	parser: opcode_reader.ChunkParser<T>;

	constructor(_opcodes: any) {
		// const typedef = JSON.parse(fs.readFileSync(__dirname + "/opcodes/typedef.json", "utf-8"));
		// const _opcodes = JSON.parse(fs.readFileSync(opcodePath, "utf-8"));
		this.parser = opcode_reader.buildParser(_opcodes, typedef as any);
	}

	read(buffer: Buffer) {
		let scanbuf = Object.assign(buffer, { scan: 0 });
		let res = this.parser.read(scanbuf, {});
		if (scanbuf.scan != scanbuf.length) {
			bytesleftoverwarncount++;
			if (bytesleftoverwarncount < 100) {
				console.log(`bytes left over after decoding file: ${scanbuf.length - scanbuf.scan}`);
				// let name = `cache/bonusbytes-${Date.now()}.bin`;
				// fs.writeFileSync(name, scanbuf.slice(scanbuf.scan));
			}
			if (bytesleftoverwarncount == 100) {
				console.log("too many bytes left over warning, no more warnings will be logged");
			}
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
export const parseCacheIndex = new FileParser<import("../generated/cacheindex").cacheindex>(require("./opcodes/cacheindex.json"));
export const parseNpc = new FileParser<import("../generated/npcs").npcs>(require("./opcodes/npcs.json"));
export const parseItem = new FileParser<import("../generated/items").items>(require("./opcodes/items.json"));
export const parseObject = new FileParser<import("../generated/objects").objects>(require("./opcodes/objects.json"));
export const parseAchievement = new FileParser<import("../generated/achievements").achievements>(require("./opcodes/achievements.json"));
export const parseMapsquareTiles = new FileParser<import("../generated/mapsquare_tiles").mapsquare_tiles>(require("./opcodes/mapsquare_tiles.json"));
export const parseMapsquareWaterTiles = new FileParser<import("../generated/mapsquare_watertiles").mapsquare_watertiles>(require("./opcodes/mapsquare_watertiles.json"));
export const parseMapsquareUnderlays = new FileParser<import("../generated/mapsquare_underlays").mapsquare_underlays>(require("./opcodes/mapsquare_underlays.json"));
export const parseMapsquareOverlays = new FileParser<import("../generated/mapsquare_overlays").mapsquare_overlays>(require("./opcodes/mapsquare_overlays.json"));
export const parseMapsquareLocations = new FileParser<import("../generated/mapsquare_locations").mapsquare_locations>(require("./opcodes/mapsquare_locations.json"));
export const parseMapZones = new FileParser<import("../generated/mapzones").mapzones>(require("./opcodes/mapzones.json"));
export const parseEnums = new FileParser<import("../generated/enums").enums>(require("./opcodes/enums.json"));
export const parseMapscenes = new FileParser<import("../generated/mapscenes").mapscenes>(require("./opcodes/mapscenes.json"));
export const parseAnimations = new FileParser<import("../generated/mapscenes").mapscenes>(require("./opcodes/anims.json"));


