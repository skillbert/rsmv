// import * as fs from "fs";
import * as opcode_reader from "./opcode_reader";
import commentJson from "comment-json";

const typedef = commentJson.parse(require("./opcodes/typedef.json")) as any;

//alloc a large static buffer to write data to without knowing the data size
//then copy what we need out of it
//the buffer is reused so it saves a ton of buffer allocs
const scratchbuf = Object.assign(Buffer.alloc(1024 * 100), { scan: 0 });

let bytesleftoverwarncount = 0;

export class FileParser<T> {
	parser: opcode_reader.ChunkParser<T>;

	constructor(_opcodes: string) {
		let opcodeobj = commentJson.parse(_opcodes, undefined, true);
		// const typedef = JSON.parse(fs.readFileSync(__dirname + "/opcodes/typedef.json", "utf-8"));
		// const _opcodes = JSON.parse(fs.readFileSync(opcodePath, "utf-8"));
		this.parser = opcode_reader.buildParser(opcodeobj as any, typedef as any);
		this.parser.setReferenceParent?.(null);
	}

	readInternal(state: opcode_reader.DecodeState) {
		let res = this.parser.read(state);
		if (state.scan != state.endoffset) {
			bytesleftoverwarncount++;
			if (bytesleftoverwarncount < 100) {
				console.log(`bytes left over after decoding file: ${state.endoffset - state.scan}`);
				// let name = `cache/bonusbytes-${Date.now()}.bin`;
				// require("fs").writeFileSync(name, scanbuf.slice(scanbuf.scan));
			}
			if (bytesleftoverwarncount == 100) {
				console.log("too many bytes left over warning, no more warnings will be logged");
			}
			// TODO remove this stupid condition, needed this to fail only in some situations
			if (state.buffer.byteLength < 100000) {
				throw new Error(`bytes left over after decoding file: ${state.endoffset - state.scan}`);
			}
		}
		return res;
	}

	read(buffer: Buffer) {
		let state: opcode_reader.DecodeState = {
			buffer,
			stack: [],
			hiddenstack: [],
			scan: 0,
			startoffset: 0,
			endoffset: buffer.byteLength
		};
		return this.readInternal(state);
	}

	write(obj: T) {
		let state = { buffer: scratchbuf, scan: 0 };
		this.parser.write(state, obj);
		if (state.scan > scratchbuf.byteLength) { throw new Error("tried to write file larger than scratchbuffer size"); }
		//do the weird prototype slice since we need a copy, not a ref
		let r: Buffer = Uint8Array.prototype.slice.call(scratchbuf, 0, scratchbuf.scan);
		//clear it for next use
		scratchbuf.fill(0, 0, scratchbuf.scan);
		scratchbuf.scan = 0;
		return r;
	}
}
export const parseCacheIndex = new FileParser<import("../generated/cacheindex").cacheindex>(require("./opcodes/cacheindex.json"));
export const parseNpc = new FileParser<import("../generated/npcs").npcs>(require("./opcodes/npcs.jsonc"));
export const parseItem = new FileParser<import("../generated/items").items>(require("./opcodes/items.json"));
export const parseObject = new FileParser<import("../generated/objects").objects>(require("./opcodes/objects.jsonc"));
export const parseAchievement = new FileParser<import("../generated/achievements").achievements>(require("./opcodes/achievements.jsonc"));
export const parseMapsquareTiles = new FileParser<import("../generated/mapsquare_tiles").mapsquare_tiles>(require("./opcodes/mapsquare_tiles.jsonc"));
export const parseMapsquareWaterTiles = new FileParser<import("../generated/mapsquare_watertiles").mapsquare_watertiles>(require("./opcodes/mapsquare_watertiles.json"));
export const parseMapsquareUnderlays = new FileParser<import("../generated/mapsquare_underlays").mapsquare_underlays>(require("./opcodes/mapsquare_underlays.json"));
export const parseMapsquareOverlays = new FileParser<import("../generated/mapsquare_overlays").mapsquare_overlays>(require("./opcodes/mapsquare_overlays.json"));
export const parseMapsquareLocations = new FileParser<import("../generated/mapsquare_locations").mapsquare_locations>(require("./opcodes/mapsquare_locations.json"));
export const parseMapZones = new FileParser<import("../generated/mapzones").mapzones>(require("./opcodes/mapzones.json"));
export const parseEnums = new FileParser<import("../generated/enums").enums>(require("./opcodes/enums.json"));
export const parseMapscenes = new FileParser<import("../generated/mapscenes").mapscenes>(require("./opcodes/mapscenes.json"));
export const parseSequences = new FileParser<import("../generated/sequences").sequences>(require("./opcodes/sequences.json"));
export const parseFramemaps = new FileParser<import("../generated/framemaps").framemaps>(require("./opcodes/framemaps.json"));
export const parseFrames = new FileParser<import("../generated/frames").frames>(require("./opcodes/frames.json"));
export const parseAnimgroupConfigs = new FileParser<import("../generated/animgroupconfigs").animgroupconfigs>(require("./opcodes/animgroupconfigs.jsonc"));
export const parseModels = new FileParser<import("../generated/models").models>(require("./opcodes/models.json"));
export const parseSpotAnims = new FileParser<import("../generated/spotanims").spotanims>(require("./opcodes/spotanims.json"));
export const parseRootCacheIndex = new FileParser<import("../generated/rootcacheindex").rootcacheindex>(require("./opcodes/rootcacheindex.json"));
export const parseSkeletalAnim = new FileParser<import("../generated/skeletalanim").skeletalanim>(require("./opcodes/skeletalanim.jsonc"));
export const parseMaterials = new FileParser<import("../generated/materials").materials>(require("./opcodes/materials.jsonc"));
export const parseQuickchatCategories = new FileParser<import("../generated/quickchatcategories").quickchatcategories>(require("./opcodes/quickchatcategories.jsonc"));
export const parseQuickchatLines = new FileParser<import("../generated/quickchatlines").quickchatlines>(require("./opcodes/quickchatlines.jsonc"));
export const parseEnvironments = new FileParser<import("../generated/environments").environments>(require("./opcodes/environments.jsonc"));
export const parseAvatars = new FileParser<import("../generated/avatars").avatars>(require("./opcodes/avatars.jsonc"));
export const parseIdentitykit = new FileParser<import("../generated/identitykit").identitykit>(require("./opcodes/identitykit.jsonc"));
export const parseStructs = new FileParser<import("../generated/structs").structs>(require("./opcodes/structs.jsonc"));
export const parseParams = new FileParser<import("../generated/params").params>(require("./opcodes/params.jsonc"));


