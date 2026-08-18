// import * as fs from "fs";
import * as opcode_reader from "./opcode_reader";
import commentJson from "comment-json";
import type { CacheFileSource } from "../cache";
import { cacheConfigPages, cacheMajors, cacheMapFiles, internalNameFiles } from "../constants";
import { anyFileIndex, blacklistIndex, chunkedIndex, DecodeLookup, indexfileIndex, noArchiveIndex, oldWorldmapIndex, rootindexfileIndex, singleMinorIndex, standardIndex, worldmapIndex } from "./filelookup";

const typedef = commentJson.parse(require("../opcodes/typedef.jsonc")) as any;

//alloc a large static buffer to write data to without knowing the data size
//then copy what we need out of it
//the buffer is reused so it saves a ton of buffer allocs
const scratchbuf = Buffer.alloc(2 * 1024 * 1024);

let bytesleftoverwarncount = 0;

export class FileParser<T> {
	parser: opcode_reader.ChunkParser;
	originalSource: string;
	totaltime = 0;

	static fromJson<T>(jsonObject: string) {
		let opcodeobj = commentJson.parse(jsonObject, undefined, true) as any
		return new FileParser<T>(opcodeobj, jsonObject);
	}

	constructor(opcodeobj: unknown, originalSource?: string) {
		this.parser = opcode_reader.buildParser(null, opcodeobj, typedef as any);
		this.originalSource = originalSource ?? JSON.stringify(opcodeobj, undefined, "\t");
	}

	readInternal(state: opcode_reader.DecodeState) {
		let t = performance.now();
		let res = this.parser.read(state);
		this.totaltime += performance.now() - t;
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

	read(buffer: Buffer, source: CacheFileSource, args?: Record<string, any>) {
		let state: opcode_reader.DecodeState = {
			isWrite: false,
			buffer,
			stack: [],
			hiddenstack: [],
			scan: 0,
			endoffset: buffer.byteLength,
			args: {
				...source.getDecodeArgs(),
				...args
			}
		};
		return this.readInternal(state) as T;
	}

	write(obj: T, args?: Record<string, any>) {
		let state: opcode_reader.EncodeState = {
			isWrite: true,
			stack: [],
			hiddenstack: [],
			buffer: scratchbuf,
			scan: 0,
			endoffset: scratchbuf.byteLength,
			args: {
				clientVersion: 1000,//TODO
				...args
			}
		};
		this.parser.write(state, obj);
		if (state.scan > state.endoffset) { throw new Error("tried to write file larger than scratchbuffer size"); }
		//append footer data to end of normal data
		state.buffer.copyWithin(state.scan, state.endoffset, scratchbuf.byteLength);
		state.scan += scratchbuf.byteLength - state.endoffset;
		let r = Buffer.from(state.buffer.subarray(0, state.scan));
		//clear it for next use
		scratchbuf.fill(0, 0, state.scan);
		return r;
	}
}

globalThis.parserTimings = () => {
	let all = Object.entries(parse).map(q => ({ name: q[0], t: q[1].totaltime }));
	all.sort((a, b) => b.t - a.t);
	all.slice(0, 10).filter(q => q.t > 0.01).forEach(q => console.log(`${q.name} ${q.t.toFixed(3)}s`));
}

export const parse = allParsers();
function allParsers() {
	return {
		cacheIndex: FileParser.fromJson<import("../../generated/cacheindex").cacheindex>(require("../opcodes/cacheindex.json")),
		npc: FileParser.fromJson<import("../../generated/npcs").npcs>(require("../opcodes/npcs.jsonc")),
		item: FileParser.fromJson<import("../../generated/items").items>(require("../opcodes/items.jsonc")),
		loc: FileParser.fromJson<import("../../generated/locs").locs>(require("../opcodes/locs.jsonc")),
		achievement: FileParser.fromJson<import("../../generated/achievements").achievements>(require("../opcodes/achievements.jsonc")),
		mapsquareTiles: FileParser.fromJson<import("../../generated/mapsquare_tiles").mapsquare_tiles>(require("../opcodes/mapsquare_tiles.jsonc")),
		mapsquareTilesNxt: FileParser.fromJson<import("../../generated/mapsquare_tiles_nxt").mapsquare_tiles_nxt>(require("../opcodes/mapsquare_tiles_nxt.jsonc")),
		mapsquareWaterTiles: FileParser.fromJson<import("../../generated/mapsquare_watertiles").mapsquare_watertiles>(require("../opcodes/mapsquare_watertiles.json")),
		mapsquareUnderlays: FileParser.fromJson<import("../../generated/mapsquare_underlays").mapsquare_underlays>(require("../opcodes/mapsquare_underlays.jsonc")),
		mapsquareOverlays: FileParser.fromJson<import("../../generated/mapsquare_overlays").mapsquare_overlays>(require("../opcodes/mapsquare_overlays.jsonc")),
		mapsquareLocations: FileParser.fromJson<import("../../generated/mapsquare_locations").mapsquare_locations>(require("../opcodes/mapsquare_locations.json")),
		mapsquareEnvironment: FileParser.fromJson<import("../../generated/mapsquare_envs").mapsquare_envs>(require("../opcodes/mapsquare_envs.jsonc")),
		mapZones: FileParser.fromJson<import("../../generated/mapzones").mapzones>(require("../opcodes/mapzones.json")),
		mapPastes: FileParser.fromJson<import("../../generated/mapzones_pastes").mapzones_pastes>(require("../opcodes/mapzones_pastes.json")),
		mapZonesSub3: FileParser.fromJson<import("../../generated/mapzones_sub3").mapzones_sub3>(require("../opcodes/mapzones_sub3.jsonc")),
		mapZonesSub4: FileParser.fromJson<import("../../generated/mapzones_sub4").mapzones_sub4>(require("../opcodes/mapzones_sub4.jsonc")),
		enums: FileParser.fromJson<import("../../generated/enums").enums>(require("../opcodes/enums.json")),
		fontmetrics: FileParser.fromJson<import("../../generated/fontmetrics").fontmetrics>(require("../opcodes/fontmetrics.jsonc")),
		mapscenes: FileParser.fromJson<import("../../generated/mapscenes").mapscenes>(require("../opcodes/mapscenes.json")),
		sequences: FileParser.fromJson<import("../../generated/sequences").sequences>(require("../opcodes/sequences.json")),
		framemaps: FileParser.fromJson<import("../../generated/framemaps").framemaps>(require("../opcodes/framemaps.jsonc")),
		frames: FileParser.fromJson<import("../../generated/frames").frames>(require("../opcodes/frames.json")),
		animgroupConfigs: FileParser.fromJson<import("../../generated/animgroupconfigs").animgroupconfigs>(require("../opcodes/animgroupconfigs.jsonc")),
		cursors: FileParser.fromJson<import("../../generated/cursors").cursors>(require("../opcodes/cursors.jsonc")),
		models: FileParser.fromJson<import("../../generated/models").models>(require("../opcodes/models.jsonc")),
		oldmodels: FileParser.fromJson<import("../../generated/oldmodels").oldmodels>(require("../opcodes/oldmodels.jsonc")),
		classicmodels: FileParser.fromJson<import("../../generated/classicmodels").classicmodels>(require("../opcodes/classicmodels.jsonc")),
		spotAnims: FileParser.fromJson<import("../../generated/spotanims").spotanims>(require("../opcodes/spotanims.json")),
		rootCacheIndex: FileParser.fromJson<import("../../generated/rootcacheindex").rootcacheindex>(require("../opcodes/rootcacheindex.jsonc")),
		skeletalAnim: FileParser.fromJson<import("../../generated/skeletalanim").skeletalanim>(require("../opcodes/skeletalanim.jsonc")),
		materials: FileParser.fromJson<import("../../generated/materials").materials>(require("../opcodes/materials.jsonc")),
		oldmaterials: FileParser.fromJson<import("../../generated/oldmaterials").oldmaterials>(require("../opcodes/oldmaterials.jsonc")),
		quest: FileParser.fromJson<import("../../generated/quests").quests>(require("../opcodes/quests.jsonc")),
		hitmarks: FileParser.fromJson<import("../../generated/hitmarks").hitmarks>(require("../opcodes/hitmarks.jsonc")),
		headbars: FileParser.fromJson<import("../../generated/headbars").headbars>(require("../opcodes/headbars.jsonc")),
		quickchatCategories: FileParser.fromJson<import("../../generated/quickchatcategories").quickchatcategories>(require("../opcodes/quickchatcategories.jsonc")),
		quickchatLines: FileParser.fromJson<import("../../generated/quickchatlines").quickchatlines>(require("../opcodes/quickchatlines.jsonc")),
		skyboxes: FileParser.fromJson<import("../../generated/skyboxes").skyboxes>(require("../opcodes/skyboxes.jsonc")),
		avatars: FileParser.fromJson<import("../../generated/avatars").avatars>(require("../opcodes/avatars.jsonc")),
		avatarOverrides: FileParser.fromJson<import("../../generated/avataroverrides").avataroverrides>(require("../opcodes/avataroverrides.jsonc")),
		identitykit: FileParser.fromJson<import("../../generated/identitykit").identitykit>(require("../opcodes/identitykit.jsonc")),
		inventories: FileParser.fromJson<import("../../generated/inventories").inventories>(require("../opcodes/inventories.jsonc")),
		structs: FileParser.fromJson<import("../../generated/structs").structs>(require("../opcodes/structs.jsonc")),
		params: FileParser.fromJson<import("../../generated/params").params>(require("../opcodes/params.jsonc")),
		particles_0: FileParser.fromJson<import("../../generated/particles_0").particles_0>(require("../opcodes/particles_0.jsonc")),
		particles_1: FileParser.fromJson<import("../../generated/particles_1").particles_1>(require("../opcodes/particles_1.jsonc")),
		audio: FileParser.fromJson<import("../../generated/audio").audio>(require("../opcodes/audio.jsonc")),
		proctexture: FileParser.fromJson<import("../../generated/proctexture").proctexture>(require("../opcodes/proctexture.jsonc")),
		oldproctexture: FileParser.fromJson<import("../../generated/oldproctexture").oldproctexture>(require("../opcodes/oldproctexture.jsonc")),
		maplabels: FileParser.fromJson<import("../../generated/maplabels").maplabels>(require("../opcodes/maplabels.jsonc")),
		maplabellocations: FileParser.fromJson<import("../../generated/maplabellocations").maplabellocations>(require("../opcodes/maplabellocations.jsonc")),
		stylesheets: FileParser.fromJson<import("../../generated/stylesheets").stylesheets>(require("../opcodes/stylesheets.jsonc")),
		cutscenes: FileParser.fromJson<import("../../generated/cutscenes").cutscenes>(require("../opcodes/cutscenes.jsonc")),
		clientscript: FileParser.fromJson<import("../../generated/clientscript").clientscript>(require("../opcodes/clientscript.jsonc")),
		clientscriptdata: FileParser.fromJson<import("../../generated/clientscriptdata").clientscriptdata>(require("../opcodes/clientscriptdata.jsonc")),
		interfaces: FileParser.fromJson<import("../../generated/interfaces").interfaces>(require("../opcodes/interfaces.jsonc")),
		dbtables: FileParser.fromJson<import("../../generated/dbtables").dbtables>(require("../opcodes/dbtables.jsonc")),
		dbrows: FileParser.fromJson<import("../../generated/dbrows").dbrows>(require("../opcodes/dbrows.jsonc")),
		vars: FileParser.fromJson<import("../../generated/vars").vars>(require("../opcodes/vars.jsonc")),
		varbits: FileParser.fromJson<import("../../generated/varbits").varbits>(require("../opcodes/varbits.jsonc")),
		config83: FileParser.fromJson<import("../../generated/config83").config83>(require("../opcodes/config83.jsonc")),
		client_cutscenes: FileParser.fromJson<import("../../generated/client_cutscenes").client_cutscenes>(require("../opcodes/client_cutscenes.jsonc")),
	}
}


export type JsonBasedFile<T> = {
	parser: FileParser<T>,
	lookup: DecodeLookup,
	prepareParser?: (source: CacheFileSource) => Promise<void> | void,
	prepareDump?: (source: CacheFileSource) => Promise<void> | void
}

function JsonBasedFile<T>(parser: FileParser<T>, lookup: DecodeLookup, prepareParser?: JsonBasedFile<T>["prepareParser"], prepareDump?: JsonBasedFile<T>["prepareDump"]): JsonBasedFile<T> {
	return { parser, lookup, prepareParser, prepareDump };
}

export const cacheFileJsonModes = {
	framemaps: JsonBasedFile(parse.framemaps, chunkedIndex(cacheMajors.framemaps)),
	items: JsonBasedFile(parse.item, chunkedIndex(cacheMajors.items, internalNameFiles.obj)),
	enums: JsonBasedFile(parse.enums, chunkedIndex(cacheMajors.enums, internalNameFiles.enum)),
	npcs: JsonBasedFile(parse.npc, chunkedIndex(cacheMajors.npcs, internalNameFiles.npc)),
	soundjson: JsonBasedFile(parse.audio, blacklistIndex(noArchiveIndex(cacheMajors.sounds, internalNameFiles.sound), [{ major: cacheMajors.sounds, minor: 0 }])),
	musicjson: JsonBasedFile(parse.audio, blacklistIndex(noArchiveIndex(cacheMajors.music, internalNameFiles.midi), [{ major: cacheMajors.music, minor: 0 }])),
	locs: JsonBasedFile(parse.loc, chunkedIndex(cacheMajors.locs, internalNameFiles.loc)),
	achievements: JsonBasedFile(parse.achievement, chunkedIndex(cacheMajors.achievements, internalNameFiles.achievement)),
	structs: JsonBasedFile(parse.structs, chunkedIndex(cacheMajors.structs, internalNameFiles.struct)),
	sequences: JsonBasedFile(parse.sequences, chunkedIndex(cacheMajors.sequences, internalNameFiles.seq)),
	spotanims: JsonBasedFile(parse.spotAnims, chunkedIndex(cacheMajors.spotanims)),
	materials: JsonBasedFile(parse.materials, chunkedIndex(cacheMajors.materials, internalNameFiles.material)),
	oldmaterials: JsonBasedFile(parse.oldmaterials, singleMinorIndex(cacheMajors.materials, 0)),
	quickchatcats: JsonBasedFile(parse.quickchatCategories, singleMinorIndex(cacheMajors.quickchat, 0)),
	quickchatlines: JsonBasedFile(parse.quickchatLines, singleMinorIndex(cacheMajors.quickchat, 1)),
	dbtables: JsonBasedFile(parse.dbtables, singleMinorIndex(cacheMajors.config, cacheConfigPages.dbtables, internalNameFiles.dbtable)),
	dbrows: JsonBasedFile(parse.dbrows, singleMinorIndex(cacheMajors.config, cacheConfigPages.dbrows, internalNameFiles.dbrow)),
	quests: JsonBasedFile(parse.quest, singleMinorIndex(cacheMajors.config, cacheConfigPages.quests, internalNameFiles.quest)),
	hitmarks: JsonBasedFile(parse.hitmarks, singleMinorIndex(cacheMajors.config, cacheConfigPages.hitmarks, internalNameFiles.hitmark)),
	headbars: JsonBasedFile(parse.headbars, singleMinorIndex(cacheMajors.config, cacheConfigPages.headbars, internalNameFiles.headbar)),

	varbits: JsonBasedFile(parse.varbits, singleMinorIndex(cacheMajors.config, cacheConfigPages.varbits, internalNameFiles.varbit)),
	var_player: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varplayer, internalNameFiles.var_player)),
	var_npc: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varnpc, internalNameFiles.var_npc)),
	var_client: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varclient, internalNameFiles.var_client)),
	var_world: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varworld)),
	var_region: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varregion)),
	var_object: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varobject, internalNameFiles.var_object)),
	var_clan: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varclan, internalNameFiles.var_clan)),
	var_clansetting: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varclansettings, internalNameFiles.var_clan_setting)),
	var_campaign: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varcampaign)),
	var_player_group: JsonBasedFile(parse.vars, singleMinorIndex(cacheMajors.config, cacheConfigPages.varplayergroup, internalNameFiles.var_player_group)),

	overlays: JsonBasedFile(parse.mapsquareOverlays, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapoverlays)),
	identitykit: JsonBasedFile(parse.identitykit, singleMinorIndex(cacheMajors.config, cacheConfigPages.identityKit)),
	inventories: JsonBasedFile(parse.inventories, singleMinorIndex(cacheMajors.config, cacheConfigPages.inventories, internalNameFiles.inv)),
	params: JsonBasedFile(parse.params, singleMinorIndex(cacheMajors.config, cacheConfigPages.params, internalNameFiles.param)),
	underlays: JsonBasedFile(parse.mapsquareUnderlays, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapunderlays)),
	mapscenes: JsonBasedFile(parse.mapscenes, singleMinorIndex(cacheMajors.config, cacheConfigPages.mapscenes)),
	skyboxes: JsonBasedFile(parse.skyboxes, singleMinorIndex(cacheMajors.config, cacheConfigPages.skyboxes)),
	animgroupconfigs: JsonBasedFile(parse.animgroupConfigs, singleMinorIndex(cacheMajors.config, cacheConfigPages.animgroups, internalNameFiles.bas)),
	cursors: JsonBasedFile(parse.cursors, singleMinorIndex(cacheMajors.config, cacheConfigPages.cursors, internalNameFiles.cursor)),
	maplabels: JsonBasedFile(parse.maplabels, singleMinorIndex(cacheMajors.config, cacheConfigPages.maplabels, internalNameFiles.maplabel)),
	maplabellocations: JsonBasedFile(parse.maplabellocations, noArchiveIndex(cacheMajors.maplabellocations)),
	mapzones: JsonBasedFile(parse.mapZones, singleMinorIndex(cacheMajors.worldmap, 0)),
	mappastes: JsonBasedFile(parse.mapPastes, singleMinorIndex(cacheMajors.worldmap, 1)),
	mapzones_sub3: JsonBasedFile(parse.mapZonesSub3, singleMinorIndex(cacheMajors.worldmap, 3)),
	mapzones_sub4: JsonBasedFile(parse.mapZonesSub4, singleMinorIndex(cacheMajors.worldmap, 4)),
	stylesheets: JsonBasedFile(parse.stylesheets, noArchiveIndex(cacheMajors.stylesheets, internalNameFiles.stylesheet)),
	cutscenes: JsonBasedFile(parse.cutscenes, noArchiveIndex(cacheMajors.cutscenes)),
	client_cutscenes: JsonBasedFile(parse.client_cutscenes, noArchiveIndex(cacheMajors.client_cutscenes)),

	particles0: JsonBasedFile(parse.particles_0, singleMinorIndex(cacheMajors.particles, 0)),
	particles1: JsonBasedFile(parse.particles_1, singleMinorIndex(cacheMajors.particles, 1)),

	maptiles: JsonBasedFile(parse.mapsquareTiles, worldmapIndex(cacheMapFiles.squares)),
	maptiles_nxt: JsonBasedFile(parse.mapsquareTilesNxt, worldmapIndex(cacheMapFiles.square_nxt)),
	maplocations: JsonBasedFile(parse.mapsquareLocations, worldmapIndex(cacheMapFiles.locations)),
	mapenvs: JsonBasedFile(parse.mapsquareEnvironment, worldmapIndex(cacheMapFiles.env)),
	maptiles_old: JsonBasedFile(parse.mapsquareTiles, oldWorldmapIndex("m")),
	maplocations_old: JsonBasedFile(parse.mapsquareLocations, oldWorldmapIndex("l")),

	frames: JsonBasedFile(parse.frames, standardIndex(cacheMajors.frames)),
	models: JsonBasedFile(parse.models, noArchiveIndex(cacheMajors.models, internalNameFiles.model)),
	oldmodels: JsonBasedFile(parse.oldmodels, noArchiveIndex(cacheMajors.oldmodels)),
	skeletons: JsonBasedFile(parse.skeletalAnim, noArchiveIndex(cacheMajors.skeletalAnims)),
	proctextures: JsonBasedFile(parse.proctexture, noArchiveIndex(cacheMajors.texturesOldPng)),
	oldproctextures: JsonBasedFile(parse.oldproctexture, singleMinorIndex(cacheMajors.texturesOldPng, 0)),
	interfaces: JsonBasedFile(parse.interfaces, standardIndex(cacheMajors.interfaces, internalNameFiles.interface)),
	fontmetrics: JsonBasedFile(parse.fontmetrics, noArchiveIndex(cacheMajors.fontmetrics, internalNameFiles.fontmetrics)),

	config83: JsonBasedFile(parse.config83, singleMinorIndex(cacheMajors.config, 83)),

	indices: JsonBasedFile(parse.cacheIndex, indexfileIndex()),
	rootindex: JsonBasedFile(parse.rootCacheIndex, rootindexfileIndex()),

	clientscriptops: JsonBasedFile(parse.clientscript, noArchiveIndex(cacheMajors.clientscript)),

	test: JsonBasedFile(FileParser.fromJson(`["struct",\n  \n]`), anyFileIndex()),
} satisfies Record<string, JsonBasedFile<any>>;