// import * as fs from "fs";
import * as opcode_reader from "./opcode_reader";
import commentJson from "comment-json";

const typedef = commentJson.parse(require("./opcodes/typedef.json")) as any;

//alloc a large static buffer to write data to without knowing the data size
//then copy what we need out of it
//the buffer is reused so it saves a ton of buffer allocs
const scratchbuf = Buffer.alloc(1024 * 1024);

let bytesleftoverwarncount = 0;

export class FileParser<T> {
	parser: opcode_reader.ChunkParser<T>;

	static fromJson<T>(jsonObject: string) {
		let opcodeobj = commentJson.parse(jsonObject, undefined, true) as any
		return new FileParser<T>(opcodeobj);
	}

	constructor(opcodeobj: opcode_reader.ComposedChunk) {
		this.parser = opcode_reader.buildParser(opcodeobj, typedef as any);
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

	read(buffer: Buffer, args?: Record<string, any>, keepBufferJson = false) {
		let state: opcode_reader.DecodeState = {
			buffer,
			stack: [],
			hiddenstack: [],
			scan: 0,
			startoffset: 0,
			endoffset: buffer.byteLength,
			args: args ?? {},
			keepBufferJson
		};
		return this.readInternal(state);
	}

	write(obj: T) {
		let state = { buffer: scratchbuf, scan: 0 };
		this.parser.write(state, obj);
		if (state.scan > scratchbuf.byteLength) { throw new Error("tried to write file larger than scratchbuffer size"); }
		//do the weird prototype slice since we need a copy, not a ref
		let r: Buffer = Uint8Array.prototype.slice.call(scratchbuf, 0, state.scan);
		//clear it for next use
		scratchbuf.fill(0, 0, state.scan);
		return r;
	}
}

export const parseCacheIndex = FileParser.fromJson<import("../generated/cacheindex").cacheindex>(require("./opcodes/cacheindex.json"));
export const parseNpc = FileParser.fromJson<import("../generated/npcs").npcs>(require("./opcodes/npcs.jsonc"));
export const parseItem = FileParser.fromJson<import("../generated/items").items>(require("./opcodes/items.json"));
export const parseObject = FileParser.fromJson<import("../generated/objects").objects>(require("./opcodes/objects.jsonc"));
export const parseAchievement = FileParser.fromJson<import("../generated/achievements").achievements>(require("./opcodes/achievements.jsonc"));
export const parseMapsquareTiles = FileParser.fromJson<import("../generated/mapsquare_tiles").mapsquare_tiles>(require("./opcodes/mapsquare_tiles.jsonc"));
export const parseMapsquareWaterTiles = FileParser.fromJson<import("../generated/mapsquare_watertiles").mapsquare_watertiles>(require("./opcodes/mapsquare_watertiles.json"));
export const parseMapsquareUnderlays = FileParser.fromJson<import("../generated/mapsquare_underlays").mapsquare_underlays>(require("./opcodes/mapsquare_underlays.json"));
export const parseMapsquareOverlays = FileParser.fromJson<import("../generated/mapsquare_overlays").mapsquare_overlays>(require("./opcodes/mapsquare_overlays.json"));
export const parseMapsquareLocations = FileParser.fromJson<import("../generated/mapsquare_locations").mapsquare_locations>(require("./opcodes/mapsquare_locations.json"));
export const parseMapZones = FileParser.fromJson<import("../generated/mapzones").mapzones>(require("./opcodes/mapzones.json"));
export const parseEnums = FileParser.fromJson<import("../generated/enums").enums>(require("./opcodes/enums.json"));
export const parseMapscenes = FileParser.fromJson<import("../generated/mapscenes").mapscenes>(require("./opcodes/mapscenes.json"));
export const parseSequences = FileParser.fromJson<import("../generated/sequences").sequences>(require("./opcodes/sequences.json"));
export const parseFramemaps = FileParser.fromJson<import("../generated/framemaps").framemaps>(require("./opcodes/framemaps.jsonc"));
export const parseFrames = FileParser.fromJson<import("../generated/frames").frames>(require("./opcodes/frames.json"));
export const parseAnimgroupConfigs = FileParser.fromJson<import("../generated/animgroupconfigs").animgroupconfigs>(require("./opcodes/animgroupconfigs.jsonc"));
export const parseModels = FileParser.fromJson<import("../generated/models").models>(require("./opcodes/models.json"));
export const parseSpotAnims = FileParser.fromJson<import("../generated/spotanims").spotanims>(require("./opcodes/spotanims.json"));
export const parseRootCacheIndex = FileParser.fromJson<import("../generated/rootcacheindex").rootcacheindex>(require("./opcodes/rootcacheindex.json"));
export const parseSkeletalAnim = FileParser.fromJson<import("../generated/skeletalanim").skeletalanim>(require("./opcodes/skeletalanim.jsonc"));
export const parseMaterials = FileParser.fromJson<import("../generated/materials").materials>(require("./opcodes/materials.jsonc"));
export const parseQuickchatCategories = FileParser.fromJson<import("../generated/quickchatcategories").quickchatcategories>(require("./opcodes/quickchatcategories.jsonc"));
export const parseQuickchatLines = FileParser.fromJson<import("../generated/quickchatlines").quickchatlines>(require("./opcodes/quickchatlines.jsonc"));
export const parseEnvironments = FileParser.fromJson<import("../generated/environments").environments>(require("./opcodes/environments.jsonc"));
export const parseAvatars = FileParser.fromJson<import("../generated/avatars").avatars>(require("./opcodes/avatars.jsonc"));
export const parseAvatarOverrides = FileParser.fromJson<import("../generated/avataroverrides").avataroverrides>(require("./opcodes/avataroverrides.jsonc"));
export const parseIdentitykit = FileParser.fromJson<import("../generated/identitykit").identitykit>(require("./opcodes/identitykit.jsonc"));
export const parseStructs = FileParser.fromJson<import("../generated/structs").structs>(require("./opcodes/structs.jsonc"));
export const parseParams = FileParser.fromJson<import("../generated/params").params>(require("./opcodes/params.jsonc"));


