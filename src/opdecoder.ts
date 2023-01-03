// import * as fs from "fs";
import * as opcode_reader from "./opcode_reader";
import commentJson from "comment-json";
import type { CacheFileSource } from "cache";

const typedef = commentJson.parse(require("./opcodes/typedef.jsonc")) as any;

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

	read(buffer: Buffer, source: CacheFileSource, args?: Record<string, any>, keepBufferJson = false) {
		let state: opcode_reader.DecodeState = {
			buffer,
			stack: [],
			hiddenstack: [],
			scan: 0,
			startoffset: 0,
			endoffset: buffer.byteLength,
			args: args ?? {},
			keepBufferJson,
			clientVersion: source.getBuildNr()
		};
		return this.readInternal(state);
	}

	write(obj: T) {
		let state: opcode_reader.EncodeState = {
			buffer: scratchbuf,
			scan: 0,
			clientVersion: 1000//TODO
		};
		this.parser.write(state, obj);
		if (state.scan > scratchbuf.byteLength) { throw new Error("tried to write file larger than scratchbuffer size"); }
		//do the weird prototype slice since we need a copy, not a ref
		let r: Buffer = Uint8Array.prototype.slice.call(scratchbuf, 0, state.scan);
		//clear it for next use
		scratchbuf.fill(0, 0, state.scan);
		return r;
	}
}

export const parse = allParsers();
function allParsers() {
	return {
		cacheIndex: FileParser.fromJson<import("../generated/cacheindex").cacheindex>(require("./opcodes/cacheindex.json")),
		npc: FileParser.fromJson<import("../generated/npcs").npcs>(require("./opcodes/npcs.jsonc")),
		item: FileParser.fromJson<import("../generated/items").items>(require("./opcodes/items.json")),
		object: FileParser.fromJson<import("../generated/objects").objects>(require("./opcodes/objects.jsonc")),
		achievement: FileParser.fromJson<import("../generated/achievements").achievements>(require("./opcodes/achievements.jsonc")),
		mapsquareTiles: FileParser.fromJson<import("../generated/mapsquare_tiles").mapsquare_tiles>(require("./opcodes/mapsquare_tiles.jsonc")),
		mapsquareTilesNxt: FileParser.fromJson<import("../generated/mapsquare_tiles_nxt").mapsquare_tiles_nxt>(require("./opcodes/mapsquare_tiles_nxt.jsonc")),
		mapsquareWaterTiles: FileParser.fromJson<import("../generated/mapsquare_watertiles").mapsquare_watertiles>(require("./opcodes/mapsquare_watertiles.json")),
		mapsquareUnderlays: FileParser.fromJson<import("../generated/mapsquare_underlays").mapsquare_underlays>(require("./opcodes/mapsquare_underlays.json")),
		mapsquareOverlays: FileParser.fromJson<import("../generated/mapsquare_overlays").mapsquare_overlays>(require("./opcodes/mapsquare_overlays.json")),
		mapsquareLocations: FileParser.fromJson<import("../generated/mapsquare_locations").mapsquare_locations>(require("./opcodes/mapsquare_locations.json")),
		mapZones: FileParser.fromJson<import("../generated/mapzones").mapzones>(require("./opcodes/mapzones.json")),
		enums: FileParser.fromJson<import("../generated/enums").enums>(require("./opcodes/enums.json")),
		mapscenes: FileParser.fromJson<import("../generated/mapscenes").mapscenes>(require("./opcodes/mapscenes.json")),
		sequences: FileParser.fromJson<import("../generated/sequences").sequences>(require("./opcodes/sequences.json")),
		framemaps: FileParser.fromJson<import("../generated/framemaps").framemaps>(require("./opcodes/framemaps.jsonc")),
		frames: FileParser.fromJson<import("../generated/frames").frames>(require("./opcodes/frames.json")),
		animgroupConfigs: FileParser.fromJson<import("../generated/animgroupconfigs").animgroupconfigs>(require("./opcodes/animgroupconfigs.jsonc")),
		models: FileParser.fromJson<import("../generated/models").models>(require("./opcodes/models.json")),
		spotAnims: FileParser.fromJson<import("../generated/spotanims").spotanims>(require("./opcodes/spotanims.json")),
		rootCacheIndex: FileParser.fromJson<import("../generated/rootcacheindex").rootcacheindex>(require("./opcodes/rootcacheindex.json")),
		skeletalAnim: FileParser.fromJson<import("../generated/skeletalanim").skeletalanim>(require("./opcodes/skeletalanim.jsonc")),
		materials: FileParser.fromJson<import("../generated/materials").materials>(require("./opcodes/materials.jsonc")),
		quickchatCategories: FileParser.fromJson<import("../generated/quickchatcategories").quickchatcategories>(require("./opcodes/quickchatcategories.jsonc")),
		quickchatLines: FileParser.fromJson<import("../generated/quickchatlines").quickchatlines>(require("./opcodes/quickchatlines.jsonc")),
		environments: FileParser.fromJson<import("../generated/environments").environments>(require("./opcodes/environments.jsonc")),
		avatars: FileParser.fromJson<import("../generated/avatars").avatars>(require("./opcodes/avatars.jsonc")),
		avatarOverrides: FileParser.fromJson<import("../generated/avataroverrides").avataroverrides>(require("./opcodes/avataroverrides.jsonc")),
		identitykit: FileParser.fromJson<import("../generated/identitykit").identitykit>(require("./opcodes/identitykit.jsonc")),
		structs: FileParser.fromJson<import("../generated/structs").structs>(require("./opcodes/structs.jsonc")),
		params: FileParser.fromJson<import("../generated/params").params>(require("./opcodes/params.jsonc")),
	}
}