import { packedHSL2HSL, HSL2RGB, ModelModifications, posmod, getOrInsert } from "../utils";
import { cacheConfigPages, cacheMajors, cacheMapFiles, lastClassicBuildnr, lastLegacyBuildnr } from "../constants";
import { parse } from "../opdecoder";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { mapsquare_overlays } from "../../generated/mapsquare_overlays";
import { mapsquare_locations } from "../../generated/mapsquare_locations";
import { ModelMeshData, ModelData } from "./rt7model";
import { mapsquare_tiles } from "../../generated/mapsquare_tiles";
import { mapsquare_watertiles } from "../../generated/mapsquare_watertiles";
import { augmentThreeJsFloorMaterial, ThreejsSceneCache, ob3ModelToThree, EngineCache, applyMaterial, ParsedMaterial, augmentZOffsetMaterial } from "./modeltothree";
import { BufferAttribute, DataTexture, Matrix4, MeshBasicMaterial, Object3D, Quaternion, RGBAFormat, Vector3 } from "three";
import { defaultMaterial, materialCacheKey, MaterialData } from "./jmat";
import { objects } from "../../generated/objects";
import { parseSprite } from "./sprite";
import * as THREE from "three";
import { legacyMajors } from "../cache/legacycache";
import { classicModifyTileGrid, getClassicLoc, getClassicMapData } from "./classicmap";
import { MeshBuilder, computePartialNormals, getAttributeBackingStore, topdown2dWallModels } from "./modelutils";
import { CacheFileSource } from "../cache";
import { CanvasImage } from "../imgutils";
import { minimapFloorMaterial, minimapWaterMaterial } from "../rs3shaders";
import { mapsquare_tiles_nxt } from "../../generated/mapsquare_tiles_nxt";
import { crc32addInt } from "../libs/crc32util";
import { generateFloorHashBoxes, generateLocationHashBoxes } from "../map/chunksummary";


export const tiledimensions = 512;
export const rs2ChunkSize = 64;
export const classicChunkSize = 48;
export const squareLevels = 4;//TODO get rid of this and use grid.levels instead
export const worldStride = 128;
const heightScale = 1 / 16;

const upvector = new THREE.Vector3(0, 1, 0);

const defaultVertexProp: TileVertex = { material: -1, materialTiling: 128, materialBleedpriority: -1, color: [255, 0, 255] };

export const { tileshapes, defaulttileshape, defaulttileshapeflipped } = generateTileShapes();

export type MapRect = {
	x: number,
	z: number,
	xsize: number,
	zsize: number
}

export function mapRectsIntersect(a: MapRect, b: MapRect) {
	if (a.x >= b.x + b.xsize || a.x + a.xsize <= b.x) { return false; }
	if (a.z >= b.z + b.zsize || a.z + a.zsize <= b.z) { return false; }
	return true;
}
export function mapRectContains(rect: MapRect, x: number, z: number) {
	//the point is implicitly of size 1x1
	if (x < rect.x || x >= rect.x + rect.xsize) { return false; }
	if (z < rect.z || z >= rect.z + rect.zsize) { return false; }
	return true;
}

let scratchbuffers = new Map<string, ArrayBuffer>();
let scratchbuffersinuse = new Set<string>();
function borrowScratchbuffer(size: number, key = "default") {
	if (scratchbuffersinuse.has(key)) {
		console.error("scratchbuffer hasn't been returned since last use, leaking memory by creating new buffer.");
		scratchbuffersinuse.delete(key);
		scratchbuffers.delete(key);
	}
	let buf = scratchbuffers.get(key);
	if (!buf || buf && buf.byteLength < size) {
		buf = new ArrayBuffer(size);
		scratchbuffers.set(key, buf);
		console.log("allocating new scratchbuf mb:", (size / 1e6).toFixed(2));
	}
	scratchbuffersinuse.add(key);
	let exit = (copysize: number) => {
		scratchbuffersinuse.delete(key);
		if (copysize > size) { throw new Error("larger slice of scratchbuffer requested than was reserved"); }
		return buf!.slice(0, copysize);
	}
	return [buf, exit] as const;
}

type CollisionData = {
	settings: number,
	//center,left,bot,right,top,topleft,botleft,botright,topright
	walk: boolean[],
	sight: boolean[],
}

type FloorvertexInfo = {
	subvertex: number,
	nextx: boolean,
	nextz: boolean,
	subx: number,
	subz: number
}
type TileShape = {
	underlay: FloorvertexInfo[],
	overlay: FloorvertexInfo[],
};

export type TileVertex = {
	material: number,
	materialTiling: number,
	materialBleedpriority: number,
	color: number[]
}

export type ChunkData = {
	tilerect: MapRect,
	levelcount: number,
	mapsquarex: number,
	mapsquarez: number,
	chunkfilehash: number,
	chunkfileversion: number,
	tiles: mapsquare_tiles["tiles"],
	nxttiles: mapsquare_tiles_nxt | null,
	extra: mapsquare_tiles["extra"],
	rawlocs: mapsquare_locations["locations"],
	locs: WorldLocation[]
}

export type ClickableMesh<T> = {
	isclickable: true,
	searchPeers: boolean
	subranges: number[],
	subobjects: T[]
}

export type ModelExtrasLocation = {
	modeltype: "location",
	isclickable: false,
	modelgroup: string,
	locationid: number,
	worldx: number,
	worldz: number,
	rotation: number,
	mirror: boolean,
	isGroundDecor: boolean,
	level: number,
	locationInstance: WorldLocation
}

type ModelExtrasOverlay = {
	modeltype: "overlay",
	isclickable: false,
	modelgroup: string,
	level: number
}

export type ModelExtras = ModelExtrasLocation | ModelExtrasOverlay | {
	modeltype: "floor" | "floorhidden",
	modelgroup: string,
	mapsquarex: number,
	mapsquarez: number,
	level: number
} & ClickableMesh<MeshTileInfo> | {
	modeltype: "locationgroup",
	modelgroup: string
} & ClickableMesh<ModelExtrasLocation | ModelExtrasOverlay>

export type MeshTileInfo = {
	tile: mapsquare_tiles["tiles"][number] | null,
	tilenxt: unknown,
	x: number,
	z: number,
	level: number,
	underlaycolor: number[]
};

type NxtTileInfo = Exclude<mapsquare_tiles_nxt["level0"], null | undefined>[number];

export class TileProps {
	debug_nxttile: NxtTileInfo | null = null;
	debug_raw: mapsquare_tiles["tiles"][number] | null = null;
	rawOverlay: mapsquare_overlays | undefined = undefined;
	rawUnderlay: mapsquare_underlays | undefined = undefined;
	settings: number;//1=blocking,2=bridge/flag2,4=roofed,8=forcedraw,16=roofoverhang,128=nxtwater
	next01: TileProps | undefined = undefined;
	next10: TileProps | undefined = undefined;
	next11: TileProps | undefined = undefined;
	x: number;
	y: number;
	z: number;
	y10: number;
	y01: number;
	y11: number;
	playery00: number;
	playery01: number;
	playery10: number;
	playery11: number;
	shape = defaulttileshape;
	underlayVisible = false;
	overlayVisible = false;//these should probably be merged
	normalX = 0;
	normalZ = 0;
	bleedsOverlayMaterial = false;
	//0 botleft,1 botmid,2 leftmid,3 midmid;
	vertexprops: TileVertex[];
	overlayprops: TileVertex;
	underlayprops: TileVertex;
	originalUnderlayColor = defaultVertexProp.color;
	rawCollision: CollisionData | undefined = undefined;
	effectiveCollision: CollisionData | undefined = undefined;
	effectiveLevel: number;
	effectiveVisualLevel: number;
	waterProps: { y00: number, y01: number, y10: number, y11: number, props: TileVertex, shape: FloorvertexInfo[], isoriginal: boolean, rawOverlay: mapsquare_overlays } | null = null

	addUnderlay(engine: EngineCache, tileunderlay: number | undefined | null) {
		let underlay = (tileunderlay != undefined ? engine.mapUnderlays[tileunderlay - 1] : undefined);
		if (underlay) {
			if (underlay.color && (underlay.color[0] != 255 || underlay.color[1] != 0 || underlay.color[2] != 255)) {
				this.underlayVisible = true;
			}
			this.underlayprops = {
				material: underlay.material ?? -1,
				materialTiling: underlay.material_tiling ?? 128,
				materialBleedpriority: -1,
				color: underlay.color ?? [255, 0, 255]
			};
			this.rawUnderlay = underlay;
			this.originalUnderlayColor = this.underlayprops.color;
			this.vertexprops.fill(this.underlayprops);
		}
	}

	addOverlay(engine: EngineCache, tileoverlay: number | undefined | null, shape: number | undefined | null) {
		let overlay = (tileoverlay != undefined ? engine.mapOverlays[tileoverlay - 1] : undefined);
		if (overlay) {
			if (overlay.color && (overlay.color[0] != 255 || overlay.color[1] != 0 || overlay.color[2] != 255)) {
				this.overlayVisible = true;
			}
			this.overlayprops = {
				material: overlay.materialbyte ?? overlay.material ?? -1,
				materialTiling: overlay.material_tiling ?? 128,
				materialBleedpriority: overlay.bleedpriority ?? 0,
				color: overlay.color ?? (overlay.materialbyte != null ? [255, 255, 255] : [255, 0, 255])
			};
			this.bleedsOverlayMaterial = !!overlay.bleedToUnderlay;
			this.rawOverlay = overlay;
		}
		if (shape != null) {
			this.shape = tileshapes[shape];
		}
	}

	addUnderWater(engine: EngineCache, height: number, tileoverlay: number | undefined | null, tileunderlay: number | undefined | null) {
		this.waterProps = {
			y00: this.y,
			y01: this.y,
			y10: this.y,
			y11: this.y,
			props: this.overlayprops,
			shape: this.shape.overlay,
			isoriginal: this.shape == defaulttileshape || this.shape == defaulttileshapeflipped,
			rawOverlay: this.rawOverlay!
		}
		let oldunderlay = this.underlayprops;
		this.underlayVisible = false;
		this.overlayVisible = false;
		this.bleedsOverlayMaterial = false;
		this.rawOverlay = undefined;
		this.addUnderlay(engine, tileunderlay);
		this.addOverlay(engine, tileoverlay, null);
		if (!this.overlayVisible) {
			this.overlayVisible = true;
			this.overlayprops = oldunderlay;
			this.bleedsOverlayMaterial = true;
		}

		this.y = this.y01 = this.y10 = this.y11 = this.y - height * tiledimensions * heightScale;
	}

	constructor(height: number, tilesettings: number, tilex: number, tilez: number, level: number, docollision: boolean) {
		let y = height * tiledimensions * heightScale;
		this.settings = tilesettings;
		this.x = tilex;
		this.y = y;
		this.z = tilez;
		this.y01 = y; this.y10 = y; this.y11 = y;
		this.playery00 = y, this.playery01 = y; this.playery10 = y; this.playery11 = y;
		this.effectiveLevel = level;
		this.effectiveVisualLevel = 0;

		let underlayprop = { ...defaultVertexProp };
		this.vertexprops = [underlayprop, underlayprop, underlayprop, underlayprop];
		this.underlayprops = underlayprop;
		this.overlayprops = underlayprop;

		let collision: CollisionData | undefined = undefined;
		if (docollision) {
			let blocked = ((tilesettings ?? 0) & 1) != 0;
			collision = {
				settings: tilesettings ?? 0,
				walk: [blocked, false, false, false, false, false, false, false, false],
				sight: [false, false, false, false, false, false, false, false, false]
			}
		}
		this.rawCollision = collision;
		this.effectiveCollision = collision;
	}
}

type FloorMorph = {
	translate: THREE.Vector3,
	rotation: THREE.Quaternion,
	scale: THREE.Vector3,
	placementMode: "simple" | "followfloor" | "followfloorceiling"
	scaleModelHeightOffset: number,
	originx: number,
	originz: number,
	level: number
}

function generateTileShapes() {
	//we have 8 possible vertices along the corners and halfway on the edges of the tile
	//select these vertices to draw the tile shape
	//from bottom to top: [[0,1,2],[7,<9>,3],[6,5,4]]
	//this allows us to rotate the shape by simply incrementing the index for each vertex
	let nodes: FloorvertexInfo[] = [
		{ subvertex: 0, nextx: false, nextz: true, subx: 0, subz: 1 },
		{ subvertex: 1, nextx: false, nextz: true, subx: 0.5, subz: 1 },
		{ subvertex: 0, nextx: true, nextz: true, subx: 1, subz: 1 },
		{ subvertex: 2, nextx: true, nextz: false, subx: 1, subz: 0.5 },
		{ subvertex: 0, nextx: true, nextz: false, subx: 1, subz: 0 },
		{ subvertex: 1, nextx: false, nextz: false, subx: 0.5, subz: 0 },
		{ subvertex: 0, nextx: false, nextz: false, subx: 0, subz: 0 },
		{ subvertex: 2, nextx: false, nextz: false, subx: 0, subz: 0.5 },
		{ subvertex: 3, nextx: false, nextz: false, subx: 0.5, subz: 0.5 }
	]

	function getvertex(index: number, rotate: number) {
		//center doesn't turn
		if (index == 8) { return nodes[8]; }
		index = (index + rotate * 2) % 8;
		return nodes[index];
	}

	let tileshapes: TileShape[] = [];

	for (let i = 0; i < 48; i++) {
		let overlay: number[] = [];
		let underlay: number[] = [];
		let rotation = i % 4;
		let shape = i - rotation;
		if (shape == 0) {
			overlay.push(0, 2, 4, 6);
			// overlay.push(2, 4, 6, 0);
		} else if (shape == 4 || shape == 36 || shape == 40) {
			overlay.push(0, 4, 6);
			underlay.push(0, 2, 4);
			if (shape == 36) { rotation += 1; }//36 is rounded concave and has an extra vertex halfway the diagonal
			if (shape == 40) { rotation += 3; }//opposite of 36
		} else if (shape == 8) {
			overlay.push(0, 1, 6);
			underlay.push(1, 2, 4, 6)
		} else if (shape == 12) {
			overlay.push(1, 2, 4);
			underlay.push(0, 1, 4, 6);
		} else if (shape == 16) {
			overlay.push(1, 2, 4, 6);
			underlay.push(0, 1, 6);
		} else if (shape == 20) {
			overlay.push(0, 1, 4, 6);
			underlay.push(1, 2, 4);
		} else if (shape == 24) {
			overlay.push(0, 1, 5, 6);
			underlay.push(1, 2, 4, 5);
		} else if (shape == 28) {
			overlay.push(5, 6, 7);
			underlay.push(2, 4, 5, 7, 0);
		} else if (shape == 32) {
			overlay.push(2, 4, 5, 7, 0);
			underlay.push(5, 6, 7);
		} else if (shape == 44) {
			overlay.push(4, 6, 8);
			underlay.push(8, 6, 0, 2, 4);
		} else {
			throw new Error("shouldnt happen");
		}

		tileshapes[i] = {
			overlay: overlay.map(q => getvertex(q, rotation)),
			underlay: underlay.map(q => getvertex(q, rotation))
		}
	}
	let defaulttileshape: TileShape = {
		overlay: [],
		underlay: [0, 2, 4, 6].map(q => getvertex(q, 0))
	}
	let defaulttileshapeflipped: TileShape = {
		overlay: [],
		underlay: [2, 4, 6, 0].map(q => getvertex(q, 0))
	}
	return { tileshapes, defaulttileshape, defaulttileshapeflipped };
}

function invertTileShape(shape: number) {
	let rotation = shape % 4;
	let mirrorrotation = (rotation + 2) % 4;
	let base = shape - rotation;

	if (base == 0) {
		return 0 + mirrorrotation;
	} else if (base == 4) {
		return 4 + mirrorrotation;
	} else if (base == 8) {
		return 16 + rotation;
	} else if (base == 12) {
		return 20 + rotation;
	} else if (base == 16) {
		return 8 + rotation;
	} else if (base == 20) {
		return 12 + rotation;
	} else if (base == 24) {
		return 24 + mirrorrotation;
	} else if (base == 28) {
		return 32 + rotation;
	} else if (base == 36) {
		return 40 + rotation;
	} else if (base == 40) {
		return 36 + rotation;
	} else if (base == 32) {
		return 28 + rotation;
	} else if (base == 44) {
		console.log("unknown inverse shape");
		return 0;
	}
	throw new Error("unexpected");
}

export function modifyMesh(mesh: ModelMeshData, mods: ModelModifications) {
	let newmat = mods.replaceMaterials?.find(q => q[0] == mesh.materialId)?.[1];
	let newmesh = { ...mesh };
	if (newmat != undefined) {
		newmesh.materialId = (newmat == (1 << 16) - 1 ? -1 : newmat);
	}
	if (typeof mods.lodLevel == "number" && mods.lodLevel != -1) {
		newmesh.indices = mesh.indexLODs[Math.min(mods.lodLevel, mesh.indexLODs.length - 1)];
	}

	let clonedcolors: BufferAttribute | undefined = undefined;
	if (mods.replaceColors && mods.replaceColors.length != 0 && mesh.attributes.color) {
		let colors = mesh.attributes.color;

		let map: [number, [number, number, number]][] = [];
		for (let repl of mods.replaceColors) {
			let oldcol = HSL2RGB(packedHSL2HSL(repl[0]));
			let newcol = HSL2RGB(packedHSL2HSL(repl[1]));
			map.push([(oldcol[0] << 16) | (oldcol[1] << 8) | oldcol[2], newcol]);
		}

		for (let i = 0; i < colors.count; i++) {
			let key = (colors.getX(i) * 255 << 16) | (colors.getY(i) * 255 << 8) | colors.getZ(i) * 255;
			for (let repl of map) {
				if (key == repl[0]) {
					if (!clonedcolors) {
						clonedcolors = colors.clone();
					}
					clonedcolors.setXYZ(i, repl[1][0] / 255, repl[1][1] / 255, repl[1][2] / 255);
					break;
				}
			}
		}
	}
	// if (typeof mods.brightness == "number" && mods.brightness != 1 && mesh.attributes.color) {
	// 	let colors = mesh.attributes.color;
	// 	if (!clonedcolors) {
	// 		clonedcolors = colors.clone();
	// 	}
	// 	const scale = mods.brightness;
	// 	for (let i = 0; i < colors.count; i++) {
	// 		clonedcolors.setXYZ(i, clonedcolors.getX(i) * scale, clonedcolors.getY(i) * scale, clonedcolors.getZ(i) * scale);
	// 	}
	// }
	if (clonedcolors) {
		newmesh.attributes = {
			...mesh.attributes,
			color: clonedcolors
		}
	}

	return newmesh;
}

export function getMorphMatrix(morph: FloorMorph, gridoffsetx: number, gridoffsetz: number) {
	let matrix = new THREE.Matrix4()
		.makeTranslation(morph.translate.x - gridoffsetx, morph.translate.y, morph.translate.z - gridoffsetz)
		.multiply(new THREE.Matrix4().makeRotationFromQuaternion(morph.rotation))
		.multiply(new THREE.Matrix4().makeScale(morph.scale.x, morph.scale.y, morph.scale.z));
	return matrix;
}

export function transformVertexPositions(pos: BufferAttribute, morph: FloorMorph, grid: TileGrid, modelheight: number, gridoffsetx: number, gridoffsetz: number, newpos?: THREE.BufferAttribute, newposindex = 0, inputstart = 0, inputend = pos.count) {
	let matrix = getMorphMatrix(morph, gridoffsetx, gridoffsetz);
	let centery = getTileHeight(grid, morph.originx / tiledimensions, morph.originz / tiledimensions, morph.level);
	let vector = new THREE.Vector3();

	//let ceiling = typeof morph.tiletransform?.scaleModelHeight != "undefined";
	let followfloor = morph.placementMode == "followfloor" || morph.placementMode == "followfloorceiling";
	let followceiling = morph.placementMode == "followfloorceiling";
	let yscale = (followceiling && modelheight > 0 ? 1 / modelheight : 1);

	let inputcount = inputend - inputstart;
	newpos ??= new THREE.BufferAttribute(new Float32Array(inputcount * 3), 3);
	let [oldbuf, oldsuboffset, oldstride] = getAttributeBackingStore(pos);
	let [newbuf, newsuboffset, newstride] = getAttributeBackingStore(newpos);
	let newoffset = newsuboffset + newposindex * newstride;
	let oldoffset = oldsuboffset + inputstart * oldstride;
	for (let i = 0; i < inputcount; i++) {
		let ii = newoffset + newstride * i;
		let jj = oldoffset + oldstride * i;
		vector.x = oldbuf[jj + 0];
		vector.y = oldbuf[jj + 1];
		vector.z = oldbuf[jj + 2];
		let vertexy = vector.y;
		vector.applyMatrix4(matrix);
		if (followfloor) {
			let gridx = (vector.x + gridoffsetx) / tiledimensions;
			let gridz = (vector.z + gridoffsetz) / tiledimensions;

			if (followceiling) {
				let wceiling = vertexy * yscale;
				let floory = getTileHeight(grid, gridx, gridz, morph.level);
				let ceily = getTileHeight(grid, gridx, gridz, morph.level + 1) - morph.scaleModelHeightOffset;
				vector.y += -vertexy + ceily * wceiling + floory * (1 - wceiling);
			} else {
				vector.y += getTileHeight(grid, gridx, gridz, morph.level);
			}
		} else {
			vector.y += centery;
		}
		newbuf[ii + 0] = vector.x;
		newbuf[ii + 1] = vector.y;
		newbuf[ii + 2] = vector.z;
	}
	return newpos;
}

export interface TileGridSource {
	getTile(x: number, z: number, level: number): TileProps | undefined
}

export class CombinedTileGrid implements TileGridSource {
	//use explicit subgrid bounds since squares at the edge won't be blended correctly
	grids: { src: TileGridSource, rect: MapRect }[];
	constructor(grids: { src: TileGridSource, rect: MapRect }[]) {
		this.grids = grids;
	}

	getTile(x: number, z: number, level: number) {
		for (let grid of this.grids) {
			if (x >= grid.rect.x && x < grid.rect.x + grid.rect.xsize && z >= grid.rect.z && z < grid.rect.z + grid.rect.zsize) {
				return grid.src.getTile(x, z, level);
			}
		}
		return undefined;
	}
}

export function getTileHeight(grid: TileGridSource, x: number, z: number, level: number) {
	let xfloor = Math.floor(x);
	let zfloor = Math.floor(z);

	let tile = grid.getTile(xfloor, zfloor, level);
	//can be empty if the region has gaps
	if (!tile) { return 0; }
	if (tile.waterProps) { return tile.waterProps.y00; }

	//TODO saturate weight to edge in case it's outside bounds
	let w00 = (1 - (x - xfloor)) * (1 - (z - zfloor));
	let w01 = (x - xfloor) * (1 - (z - zfloor));
	let w10 = (1 - (x - xfloor)) * (z - zfloor);
	let w11 = (x - xfloor) * (z - zfloor);

	return tile.y * w00 + tile.y01 * w01 + tile.y10 * w10 + tile.y11 * w11;
}

export class TileGrid implements TileGridSource {
	engine: EngineCache;
	area: MapRect;
	tilemask: undefined | MapRect[];
	xsize: number;
	zsize: number;
	levels = 4;
	//position of this grid measured in tiles
	xoffset: number;
	zoffset: number;
	//properties of the southwest corner of each tile
	tiles: TileProps[];
	//array indices offset per move in each direction
	xstep: number;
	zstep: number;
	levelstep: number;
	constructor(engine: EngineCache, area: MapRect, tilemask?: MapRect[] | undefined) {
		this.area = area;
		this.tilemask = tilemask?.filter(q => mapRectsIntersect(q, area));
		this.engine = engine;
		this.xoffset = area.x;
		this.zoffset = area.z;
		this.xsize = area.xsize;
		this.zsize = area.zsize;
		this.xstep = 1;
		this.zstep = this.xstep * area.xsize;
		this.levelstep = this.zstep * area.zsize;
		this.tiles = new Array(this.levelstep * this.levels).fill(undefined);
	}

	getHeightCollisionFile(x: number, z: number, level: number, xsize: number, zsize: number) {
		let file = new Uint16Array(xsize * zsize * 2);
		for (let dz = 0; dz < zsize; dz++) {
			for (let dx = 0; dx < xsize; dx++) {
				let tile = this.getTile(x + dx, z + dz, level);
				if (tile) {
					let index = (dx + dz * xsize) * 2;
					let y = (tile.playery00 + tile.playery01 + tile.playery10 + tile.playery11) / 4;
					file[index + 0] = y / 16;
					let colint = 0;
					let col = tile.effectiveCollision!;
					for (let i = 0; i < 9; i++) {
						let v = (col.walk[i] ? col.sight[i] ? 2 : 1 : 0);
						colint += Math.pow(3, i) * v;
					}
					file[index + 1] = colint;
				}
			}
		}
		return file;
	}
	getTile(x: number, z: number, level: number) {
		x -= this.xoffset;
		z -= this.zoffset;
		if (x < 0 || z < 0 || x >= this.xsize || z >= this.zsize) { return undefined; }
		return this.tiles[this.levelstep * level + z * this.zstep + x * this.xstep];
	}
	blendUnderlays() {
		for (let z = this.zoffset; z < this.zoffset + this.zsize; z++) {
			for (let x = this.xoffset; x < this.xoffset + this.xsize; x++) {
				let effectiveVisualLevel = 0;
				let layer1tile = this.getTile(x, z, 1);
				let flag2 = ((layer1tile?.settings ?? 0) & 2) != 0;
				let leveloffset = (flag2 ? -1 : 0);

				for (let level = 0; level < this.levels; level++) {
					let currenttile = this.getTile(x, z, level);
					if (!currenttile) { continue; }

					//color blending
					if (!currenttile.debug_nxttile) {
						let r = 0, g = 0, b = 0;
						let count = 0;
						//5 deep letsgooooooo
						//kernel is assymetric, so correct when going from tile center
						//based on baked nxt colors
						for (let dz = -4; dz <= 5; dz++) {
							for (let dx = -4; dx <= 5; dx++) {
								let tile = this.getTile(x + dx, z + dz, level);
								if (!tile || !tile.underlayVisible) { continue; }
								let col = tile.originalUnderlayColor;
								// let col = tile.underlayprops.color;
								r += col[0];
								g += col[1];
								b += col[2];
								count++;
							}
						}
						if (count > 0) {
							currenttile.underlayprops.color = [r / count, g / count, b / count];
						}
					}

					let tile_sw = this.getTile(x - 1, z - 1, level);
					let tile_s = this.getTile(x, z - 1, level);
					let tile_se = this.getTile(x + 1, z - 1, level);
					let tile_e = this.getTile(x + 1, z, level);
					let tile_ne = this.getTile(x + 1, z + 1, level);
					let tile_n = this.getTile(x, z + 1, level);
					let tile_nw = this.getTile(x - 1, z + 1, level);
					let tile_w = this.getTile(x - 1, z, level);

					//normals
					let dydx = 0;
					let dydz = 0;
					if (tile_w && tile_e) { dydx = (tile_e.y - tile_w.y) / (2 * tiledimensions); }
					if (tile_s && tile_n) { dydz = (tile_n.y - tile_s.y) / (2 * tiledimensions); }
					//cross product of two line connecting adjectent tiles
					//[1,dydx,0]' x [0,dydz,1]' = [dydx,1,dydz]
					let len = Math.hypot(dydx, dydz, 1);
					currenttile.normalZ = -dydx / len;
					currenttile.normalX = -dydz / len;

					//corners
					currenttile.y01 = tile_e?.y ?? currenttile.y;
					currenttile.y10 = tile_n?.y ?? currenttile.y;
					currenttile.y11 = tile_ne?.y ?? currenttile.y;
					//need 4 separate player y's since the y can be non-continuous because of tile flag-2
					currenttile.playery00 = currenttile.y;
					currenttile.playery01 = tile_e?.y ?? currenttile.y01;
					currenttile.playery10 = tile_n?.y ?? currenttile.y10;
					currenttile.playery11 = tile_ne?.y ?? currenttile.y11;
					if (currenttile.waterProps) {
						currenttile.playery00 = Math.max(currenttile.playery00, currenttile.waterProps.y00);
						currenttile.playery01 = Math.max(currenttile.playery01, currenttile.waterProps.y01);
						currenttile.playery10 = Math.max(currenttile.playery10, currenttile.waterProps.y10);
						currenttile.playery11 = Math.max(currenttile.playery11, currenttile.waterProps.y11);
					}

					currenttile.next01 = tile_e;
					currenttile.next10 = tile_n;
					currenttile.next11 = tile_ne;

					let alwaysshow = ((currenttile.settings ?? 0) & 8) != 0;

					let effectiveLevel = level + leveloffset;
					//weirdness with flag 2 and 8 related to effective levels
					if (alwaysshow) { effectiveVisualLevel = 0; }

					let effectiveTile = this.getTile(x, z, effectiveLevel);
					let hasroof = ((effectiveTile?.settings ?? 0) & 4) != 0;

					if (effectiveTile && effectiveLevel != level) {
						effectiveTile.effectiveCollision = currenttile.rawCollision;
						effectiveTile.playery00 = currenttile.playery00;
						effectiveTile.playery01 = currenttile.playery01;
						effectiveTile.playery10 = currenttile.playery10;
						effectiveTile.playery11 = currenttile.playery11;
					}
					currenttile.effectiveLevel = effectiveLevel;
					currenttile.effectiveVisualLevel = Math.max(currenttile.effectiveVisualLevel, effectiveVisualLevel);

					//spread to our neighbours
					//there is a lot more to it than this but it gives decent results
					for (let dz = -1; dz <= 1; dz++) {
						for (let dx = -1; dx <= 1; dx++) {
							let tile = this.getTile(x + dx, z + dz, level);
							if (tile && ((tile.settings ?? 0) & 0x8) == 0) { tile.effectiveVisualLevel = Math.max(tile.effectiveVisualLevel, effectiveVisualLevel); }
						}
					}
					if (hasroof) { effectiveVisualLevel = effectiveLevel + 1; }

					//auto-link nxt shapeless water
					if (!currenttile.waterProps) {
						let northoreast = (tile_n?.waterProps?.isoriginal || tile_e?.waterProps?.isoriginal);
						if (tile_ne?.waterProps?.isoriginal && northoreast) {
							currenttile.waterProps = {
								...tile_ne.waterProps,
								isoriginal: false,
								shape: tileshapes[0].overlay
							}
						} else if (tile_ne?.waterProps?.isoriginal) {
							currenttile.waterProps = {
								...tile_ne.waterProps,
								isoriginal: false,
								shape: tileshapes[6].overlay
							}
						} else if (tile_nw?.waterProps?.isoriginal && tile_n?.waterProps?.isoriginal) {
							currenttile.waterProps = {
								...tile_nw.waterProps,
								isoriginal: false,
								shape: tileshapes[5].overlay
							}
						} else if (tile_se?.waterProps?.isoriginal && tile_e?.waterProps?.isoriginal) {
							currenttile.waterProps = {
								...tile_se.waterProps,
								isoriginal: false,
								shape: tileshapes[7].overlay
							}
						}
					} else if (currenttile.waterProps.shape.length == 0) {
						if (tile_ne?.waterProps || tile_n?.waterProps || tile_e?.waterProps) {
							currenttile.waterProps.shape = tileshapes[0].overlay;
						} else {
							currenttile.waterProps.shape = tileshapes[4].overlay;
						}
					}
					//smooth water height
					if (currenttile.waterProps) {
						if (tile_e?.waterProps) { currenttile.waterProps.y01 = tile_e.waterProps.y00; }
						if (tile_n?.waterProps) { currenttile.waterProps.y10 = tile_n.waterProps.y00; }
						if (tile_ne?.waterProps) { currenttile.waterProps.y11 = tile_ne.waterProps.y00; }
						else if (tile_e?.waterProps) { currenttile.waterProps.y11 = tile_e.waterProps.y10; }
						else if (tile_n?.waterProps) { currenttile.waterProps.y11 = tile_n.waterProps.y01; }
					}
				}
			}
		}

		for (let z = this.zoffset; z < this.zoffset + this.zsize; z++) {
			for (let x = this.xoffset; x < this.xoffset + this.xsize; x++) {
				for (let level = 0; level < this.levels; level++) {
					let currenttile = this.getTile(x, z, level);
					if (!currenttile) { continue; }
					//bleed overlay materials
					if (currenttile.bleedsOverlayMaterial) {
						for (let vertex of currenttile.shape.overlay) {
							let node: TileProps | undefined = currenttile;
							if (vertex.nextx && vertex.nextz) { node = node.next11; }
							else if (vertex.nextx) { node = node.next01; }
							else if (vertex.nextz) { node = node.next10; }
							if (node) {
								if (node.vertexprops[vertex.subvertex].materialBleedpriority < currenttile.overlayprops.materialBleedpriority) {
									node.vertexprops[vertex.subvertex] = currenttile.overlayprops;
								}
							}
						}
					}
				}
			}
		}
	}

	gatherMaterials(x: number, z: number, xsize: number, zsize: number) {
		let mats = new Map<number, number>();
		let addmat = (id: number, tiling: number) => {
			let repeat = 1;
			const defaultTiling = 128;
			if (tiling < defaultTiling) {
				//our sampling rect is larger than the texture
				repeat = defaultTiling / tiling + 1;
			} else if (tiling % defaultTiling != 0) {
				//our sampling rect does not fit an exact number of times inside our texture
				repeat = 1 + defaultTiling / tiling;
			}
			let old = mats.get(id);
			if (!old || old < repeat) {
				mats.set(id, repeat);
			}
		}
		for (let level = 0; level < this.levels; level++) {
			for (let dz = 0; dz < zsize; dz++) {
				for (let dx = 0; dx < xsize; dx++) {
					let tile = this.getTile(x + dx, z + dz, level);
					if (!tile) { continue; }
					if (tile.underlayprops.material != -1) {
						addmat(tile.underlayprops.material, tile.underlayprops.materialTiling);
					}
					if (tile.overlayprops.material != -1) {
						addmat(tile.overlayprops.material, tile.overlayprops.materialTiling);
					}
					if (tile.waterProps && tile.waterProps.props.material != -1) {
						addmat(tile.waterProps.props.material, tile.waterProps.props.materialTiling);
					}
				}
			}
		}
		return mats;
	}
	addMapsquare(tiles: mapsquare_tiles["tiles"], nxttiles: mapsquare_tiles_nxt | null, chunkrect: MapRect, levels: number, docollision = false) {
		if (tiles.length != chunkrect.xsize * chunkrect.zsize * levels) { throw new Error(); }
		let baseoffset = (chunkrect.x - this.xoffset) * this.xstep + (chunkrect.z - this.zoffset) * this.zstep;
		for (let z = 0; z < chunkrect.zsize; z++) {
			for (let x = 0; x < chunkrect.xsize; x++) {
				if (!mapRectContains(this.area, chunkrect.x + x, chunkrect.z + z)) { continue; }
				if (this.tilemask && !this.tilemask.some(q => mapRectContains(q, chunkrect.x + x, chunkrect.z + z))) { continue; }

				let tilex = (chunkrect.x + x) * tiledimensions;
				let tilez = (chunkrect.z + z) * tiledimensions;
				let tileindex = z + x * chunkrect.zsize;
				let height = 0;
				for (let level = 0; level < this.levels; level++) {
					let tile = (level < levels ? tiles[tileindex] : {} as typeof tiles[number]);
					let nxttile: NxtTileInfo | null = null;
					let extraheight: number | null | undefined = tile.height;
					if (nxttiles) {
						let nxtfloor = [nxttiles.level0, nxttiles.level1, nxttiles.level2, nxttiles.level3][level];
						if (nxtfloor) {
							nxttile = nxtfloor[(x + 1) * 66 + z + 1];
							extraheight = (nxttile.flags & 16 ? nxttile.rest?.waterheight : nxttile.height);
						}
					}
					let waterheight = height;
					if (extraheight != undefined && extraheight != 0) {
						//not sure what the 1=0 thing is about, but seems correct for trees
						height += (extraheight == 1 ? 0 : extraheight);
					} else {
						//TODO there is much much more to this, probably similar to the classic code
						height += 30;
					}
					let outtile: TileProps;
					if (nxttile) {
						let nxtset = nxttile.flags;
						let haswater = (nxtset & 16) != 0;
						//1visible,2blocking,4bridge/flag2,8roofed,16water,32forcedraw,64roofoverhang
						let newsettings = (nxtset & 2 ? 1 : 0) | (nxtset & 4 ? 2 : 0) | (nxtset & 8 ? 4 : 0) | (nxtset & 32 ? 8 : 0) | (nxtset & 64 ? 16 : 0);
						if (haswater) {
							newsettings |= 128;//flag that doesn't exist in java
						}
						outtile = new TileProps(height, newsettings, tilex, tilez, level, docollision);
						// outtile.addUnderlay(this.engine, nxttile.rest?.underlay);
						// outtile.addOverlay(this.engine, nxttile.rest?.overlay, nxttile.rest?.shape);
						let overlay = nxttile.rest?.overlay_under ?? nxttile.rest?.overlay;
						let underlay = nxttile.rest?.underlay_under ?? nxttile.rest?.underlay;
						let shape = haswater ? invertTileShape(nxttile.rest?.shape ?? 0) : nxttile.rest?.shape;
						outtile.addUnderlay(this.engine, underlay);
						outtile.addOverlay(this.engine, overlay, shape);
						if (haswater) {
							outtile.addUnderWater(this.engine, nxttile.height, nxttile.rest?.overlay, nxttile.rest?.underlay);
						}
						// let underwaterheight = height - nxttile.height + (nxttile.rest?.waterheight ?? 0);
						// let outunderwater = new TileProps(this.engine, underwaterheight, nxttile.rest?.shape, nxttile.rest?.underlay_under, nxttile.rest?.overlay_under, newsettings, tilex, tilez, level, false);
						// outtile.underwatergraphics = outunderwater;

						//TODO get rid of this at some point, currently needed to calculate chunkhash for map render
						outtile.debug_raw = tile;
						outtile.debug_nxttile = nxttile;
						outtile.originalUnderlayColor = HSL2RGB(packedHSL2HSL(nxttile.rest?.underlaycolor ?? 0));
						outtile.underlayprops.color = outtile.originalUnderlayColor;
					} else {
						outtile = new TileProps(height, tile.settings ?? 0, tilex, tilez, level, docollision);
						outtile.addUnderlay(this.engine, tile.underlay);
						outtile.addOverlay(this.engine, tile.overlay, tile.shape);
						outtile.debug_raw = tile;
					}
					let newindex = baseoffset + this.xstep * x + this.zstep * z + this.levelstep * level;
					this.tiles[newindex] = outtile;
					tileindex += chunkrect.xsize * chunkrect.zsize;
				}
			}
		}
	}
}

export type ParsemapOpts = { padfloor?: boolean, invisibleLayers?: boolean, collision?: boolean, map2d?: boolean, minimap?: boolean, hashboxes?: boolean, skybox?: boolean, mask?: MapRect[] };

export async function getMapsquareData(engine: EngineCache, chunkx: number, chunkz: number) {
	let squareSize = (engine.classicData ? classicChunkSize : rs2ChunkSize);
	let squareindex = chunkx + chunkz * worldStride;

	let tiles: mapsquare_tiles["tiles"];
	let nxttiles: mapsquare_tiles_nxt | null = null;
	let tilesextra: mapsquare_tiles["extra"] = {};
	let locs: mapsquare_locations["locations"] = [];
	let tilerect: MapRect;
	let levelcount = squareLevels;
	let filehash = 0;
	let fileversion = 0;

	if (engine.getBuildNr() > lastClassicBuildnr) {
		let tilefile: Buffer | null = null;
		let nxttilefile: Buffer | null = null;
		let locsfile: Buffer | null = null;
		if (engine.getBuildNr() >= 759) {
			let mapcacheindex = await engine.getCacheIndex(cacheMajors.mapsquares);
			let chunkindex = mapcacheindex[squareindex];
			if (!chunkindex) {
				// console.log(`skipping mapsquare ${rect.x + x} ${rect.z + z} as it does not exist`);
				return null;
			}
			filehash = chunkindex.crc;
			fileversion = chunkindex.version;
			let selfarchive = await engine.getFileArchive(chunkindex);

			let tileindex = chunkindex.subindices.indexOf(cacheMapFiles.squares);
			if (tileindex == -1) { return null; }
			tilefile = selfarchive[tileindex].buffer;
			let locsindex = chunkindex.subindices.indexOf(cacheMapFiles.locations);
			if (locsindex != -1) {
				locsfile = selfarchive[locsindex].buffer;
			}
			//builds before 861 contain the file, but it's slightly different and seems to be missing water overlay ids
			if (engine.getBuildNr() >= 861) {
				let nxttileindex = chunkindex.subindices.indexOf(cacheMapFiles.square_nxt);
				if (nxttileindex != -1) {
					nxttilefile = selfarchive[nxttileindex].buffer;
				}
			}
		} else if (engine.getBuildNr() > lastLegacyBuildnr) {
			try {
				let index = await engine.findFileByName(cacheMajors.mapsquares, `m${chunkx}_${chunkz}`);
				if (!index) { return null; }
				filehash = index.crc;
				fileversion = index.version;
				tilefile = await engine.getFile(index.major, index.minor, index.crc);
			} catch (e) {
				//missing xtea
				return null;
			}
			try {
				let index = await engine.findFileByName(cacheMajors.mapsquares, `l${chunkx}_${chunkz}`);
				if (index) {
					filehash = crc32addInt(index.crc, filehash);
					fileversion = Math.max(fileversion, index.version);
					locsfile = await engine.getFile(index.major, index.minor, index.crc);
				}
			} catch (e) {
				//ignore
			}
		} else {
			let index = chunkx * 256 + chunkz;
			let info = engine.legacyData?.mapmeta.get(index);
			if (!info) {
				return null
			}
			try {
				filehash = info.crc;
				fileversion = info.version;
				tilefile = await engine.getFile(legacyMajors.map, info.map);
				locsfile = await engine.getFile(legacyMajors.map, info.loc);
			} catch {
				console.warn(`map for ${chunkx}_${chunkz} declared but file did not exist`);
			}
		}
		if (!tilefile) {
			//should only happen when files are missing
			return null
		}
		let tiledata = parse.mapsquareTiles.read(tilefile, engine.rawsource);
		if (nxttilefile) {
			nxttiles = parse.mapsquareTilesNxt.read(nxttilefile, engine.rawsource);
		}
		tiles = tiledata.tiles;
		tilesextra = tiledata.extra;
		if (locsfile) {
			locs = parse.mapsquareLocations.read(locsfile, engine.rawsource).locations;
		}
		tilerect = {
			x: chunkx * squareSize,
			z: chunkz * squareSize,
			xsize: squareSize,
			zsize: squareSize
		};
	} else {
		let mapdata = await getClassicMapData(engine, chunkx, chunkz);
		if (!mapdata) { return null }
		tiles = mapdata.tiles;
		tilerect = mapdata.rect;
		levelcount = mapdata.levels;
		locs = mapdata.locs;
		filehash = mapdata.mapfilehash;

	}
	let chunk: ChunkData = {
		tilerect,
		levelcount,
		mapsquarex: chunkx,
		mapsquarez: chunkz,
		chunkfilehash: filehash,
		chunkfileversion: fileversion,
		tiles: tiles,
		nxttiles,
		extra: tilesextra,
		rawlocs: locs,
		locs: []
	};
	return chunk;
}

export async function parseMapsquare(engine: EngineCache, chunkx: number, chunkz: number, opts?: ParsemapOpts) {
	let chunkfloorpadding = (opts?.padfloor ? 20 : 0);//TODO same as max(blending kernel,max loc size), put this in a const somewhere
	let chunkSize = (engine.classicData ? classicChunkSize : rs2ChunkSize);
	let chunkpadding = Math.ceil(chunkfloorpadding / chunkSize);
	let grid = new TileGrid(engine, {
		x: chunkx * chunkSize - chunkfloorpadding,
		z: chunkz * chunkSize - chunkfloorpadding,
		xsize: chunkSize + chunkfloorpadding * 2,
		zsize: chunkSize + chunkfloorpadding * 2
	}, opts?.mask);
	let chunk: ChunkData | null = null;
	for (let z = -chunkpadding; z <= chunkpadding; z++) {
		for (let x = -chunkpadding; x <= chunkpadding; x++) {
			let chunkdata = await getMapsquareData(engine, chunkx + x, chunkz + z);
			if (!chunkdata) {
				continue;
			}
			grid.addMapsquare(chunkdata.tiles, chunkdata.nxttiles, chunkdata.tilerect, chunkdata.levelcount, !!opts?.collision);

			//only add the actual ones we need to the queue
			if (chunkdata.mapsquarex == chunkx && chunkdata.mapsquarez == chunkz) {
				chunk = chunkdata;
			}
		}
	}
	if (engine.classicData) {
		classicModifyTileGrid(grid);
	}
	grid.blendUnderlays();
	if (chunk) {
		chunk.locs = await mapsquareObjects(engine, grid, chunk.rawlocs, chunk.tilerect.x, chunk.tilerect.z, !!opts?.collision);
	}

	return { grid, chunk, chunkSize, chunkx, chunkz };
}

export async function mapsquareSkybox(scene: ThreejsSceneCache, mainchunk: ChunkData) {
	let skybox = new Object3D();
	let fogColor = [0, 0, 0, 0];
	let skyboxModelid = -1;
	if (mainchunk?.extra.unk00?.unk20) {
		fogColor = mainchunk.extra.unk00.unk20.slice(1);
	}
	if (mainchunk?.extra.unk80) {
		let envarch = await scene.engine.getArchiveById(cacheMajors.config, cacheConfigPages.environments);
		let envfile = envarch.find(q => q.fileid == mainchunk.extra!.unk80!.environment)!;
		let env = parse.environments.read(envfile.buffer, scene.engine.rawsource);
		if (typeof env.model == "number") {
			skyboxModelid = env.model;
			skybox = await ob3ModelToThree(scene, await scene.getModelData(env.model));
		}
	}
	return { skybox, fogColor, skyboxModelid };
}

export async function mapsquareFloors(scene: ThreejsSceneCache, grid: TileGrid, chunk: ChunkData, opts?: ParsemapOpts) {
	let floors: FloorMeshData[] = [];
	let matids = grid.gatherMaterials(chunk.tilerect.x, chunk.tilerect.z, chunk.tilerect.xsize + 1, chunk.tilerect.zsize + 1);
	let textures = new Map<number, { tex: CanvasImage, repeat: number }>();
	let textureproms: Promise<void>[] = [];
	for (let [matid, repeat] of matids.entries()) {
		let mat = scene.engine.getMaterialData(matid);
		if (mat.textures.diffuse && scene.textureType != "none") {
			textureproms.push(scene.getTextureFile("diffuse", mat.textures.diffuse, mat.stripDiffuseAlpha)
				.then(tex => tex.toWebgl())
				.then(src => {
					textures.set(mat.textures.diffuse!, { tex: src, repeat });
				})
			);
		}
	}
	await Promise.all(textureproms);
	let atlas!: SimpleTexturePacker;
	//sort from large to small for more efficient packing
	let sortedtextures = [...textures.entries()].sort((a, b) => b[1].tex.width * b[1].repeat - a[1].tex.width * a[1].repeat);
	let sizelist: [number, number][] = [
		[256, 256],
		[512, 512],
		[1024, 512],
		[1024, 1024],
		[1024, 2048],
		[2048, 1024],//try both orientations because the layout algo isnt symmetric
		[2048, 2048],
		[2048, 2048 + 1024],
		[2048, 4096],
		[2048 + 1024, 4096],
		[4096, 4096]
	];
	retrysize: for (let size of sizelist) {
		atlas = new SimpleTexturePacker(size[0], size[1]);
		for (let [id, { tex, repeat }] of sortedtextures) {
			if (!atlas.addTexture(id, tex, repeat)) {
				continue retrysize;
			}
		}
		break;
	}

	for (let level = 0; level < squareLevels; level++) {
		floors.push(mapsquareMesh(grid, chunk, level, atlas, true, "default"));
		floors.push(mapsquareMesh(grid, chunk, level, atlas, true, "default", true));
		if (opts?.map2d) {
			floors.push(mapsquareMesh(grid, chunk, level, atlas, false, "worldmap"));
			floors.push(mapsquareMesh(grid, chunk, level, atlas, false, "worldmap", true));
		}
		if (opts?.invisibleLayers) {
			floors.push(mapsquareMesh(grid, chunk, level, atlas, false, "wireframe"));
			floors.push(mapsquarePathMesh(grid, chunk, level));
		}
		if (opts?.minimap) {
			floors.push(mapsquareMesh(grid, chunk, level, atlas, false, "minimap"));
			floors.push(mapsquareMesh(grid, chunk, level, atlas, false, "minimap", true));
		}
	}
	return floors
}

export type ThreeJsRenderSection = {
	mesh: RSBatchMesh,
	startindex: number,
	endindex: number,
	startvertex: number,
	endvertex: number,
	hidden: boolean
}

export type RSMapChunkData = {
	grid: TileGrid,
	chunk: ChunkData | null,
	chunkSize: number,
	sky: { skybox: Object3D, fogColor: number[], skyboxModelid: number } | null,
	modeldata: Map<WorldLocation, PlacedMesh[]>,
	chunkroot: THREE.Group,
	chunkx: number,
	chunkz: number,
	locRenders: Map<WorldLocation, ThreeJsRenderSection[]>
}

export async function renderMapSquare(cache: ThreejsSceneCache, parsedsquare: ReturnType<typeof parseMapsquare>, chunkx: number, chunkz: number, opts: ParsemapOpts): Promise<RSMapChunkData> {
	let { grid, chunk } = await parsedsquare;
	let modeldata: Map<WorldLocation, PlacedMesh[]>;
	let chunkroot = new THREE.Group();
	chunkroot.name = `mapsquare ${chunkx}.${chunkz}`;
	let locRenders = new Map<WorldLocation, ThreeJsRenderSection[]>();
	if (chunk) {
		let floordatas = await mapsquareFloors(cache, grid, chunk, opts);
		let overlays = (!opts?.map2d ? [] : await mapsquareOverlays(cache.engine, grid, chunk.locs));
		let locmeshes = await generateLocationMeshgroups(cache, chunk.locs);
		let allmeshes = [...locmeshes.byMaterial, ...overlays];
		if (opts.minimap) {
			let minimeshes = await generateLocationMeshgroups(cache, chunk.locs, true);
			allmeshes.push(...minimeshes.byMaterial);
		}

		let rootx = chunk.tilerect.x * tiledimensions;
		let rootz = chunk.tilerect.z * tiledimensions;

		chunkroot.matrixAutoUpdate = false;
		chunkroot.position.set(rootx, 0, rootz);
		chunkroot.updateMatrix();

		if (allmeshes.length != 0) {
			let materials = await Promise.all(allmeshes.map(q => q.material ?? cache.getMaterial(q.materialId, q.hasVertexAlpha, q.minimapVariant)));
			chunkroot.add(...allmeshes.map((q, i) => meshgroupsToThree(grid, q, rootx, rootz, materials[i], locRenders)));
		}

		let floors = (await Promise.all(floordatas.map(f => floorToThree(cache, f)))).filter(q => q) as any;
		if (floors.length != 0) { chunkroot.add(...floors); }

		for (let level = 0; level < squareLevels; level++) {
			let boxes = mapsquareCollisionToThree(grid, chunk, level);
			if (boxes) { chunkroot.add(boxes); }
			let rawboxes = mapsquareCollisionToThree(grid, chunk, level, true);
			if (rawboxes) { chunkroot.add(rawboxes); }
		}
		if (opts.hashboxes) {
			for (let level = 0; level < squareLevels; level++) {
				chunkroot.add(await generateLocationHashBoxes(cache, locmeshes.byLogical, grid, chunk.mapsquarex, chunk.mapsquarez, level));
				chunkroot.add(await generateFloorHashBoxes(cache, grid, chunk, level));
			}
		}
		modeldata = locmeshes.byLogical;
	} else {
		modeldata = new Map();
	}
	let sky = (chunk && opts?.skybox ? await mapsquareSkybox(cache, chunk) : null);
	let chunkSize = (cache.engine.classicData ? classicChunkSize : rs2ChunkSize);

	chunkroot?.traverse(node => {
		if (node instanceof THREE.Mesh) {
			let parent: THREE.Object3D | null = node;
			let iswireframe = false;
			//TODO this data should be on the mesh it concerns instead of a parent
			while (parent) {
				if (parent.userData.modeltype == "floorhidden") {
					iswireframe = true;
				}
				parent = parent.parent;
			}
			if (iswireframe && node.material instanceof THREE.MeshPhongMaterial) {
				node.material.wireframe = true;
			}
		}
	});

	return { chunkx, chunkz, grid, chunk, sky, modeldata, chunkroot, chunkSize, locRenders };
}

type SimpleTexturePackerAlloc = { u: number, v: number, usize: number, vsize: number, x: number, y: number, repeatWidth: number, repeatHeight: number, totalpixels: number, img: CanvasImage }

class SimpleTexturePacker {
	padsize = 32;//was still bleeding at 16
	width: number;
	height: number;
	allocs: SimpleTexturePackerAlloc[] = [];
	map = new Map<number, SimpleTexturePackerAlloc>()
	allocx = 0;
	allocy = 0;
	allocLineHeight = 0;
	result: HTMLCanvasElement | null = null;
	resultSource: THREE.Texture | null = null;
	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
	}

	addTexture(id: number, img: CanvasImage, repeat: number) {
		if (this.result != null) {
			this.result = null;
			console.log("adding textures to atlas after creation of texture");
		}
		let repeatWidth = Math.floor(img.width * repeat);
		let repeatHeight = Math.floor(img.height * repeat);
		let sizex = repeatWidth + 2 * this.padsize;
		let sizey = repeatHeight + 2 * this.padsize;
		if (this.allocx + sizex > this.width) {
			this.allocx = 0;
			this.allocy += this.allocLineHeight;
			this.allocLineHeight = 0;
		}
		this.allocLineHeight = Math.max(this.allocLineHeight, sizey);
		if (this.allocy + this.allocLineHeight > this.height) {
			return false;
		}
		let alloc: SimpleTexturePackerAlloc = {
			u: (this.allocx + this.padsize) / this.width,
			v: (this.allocy + this.padsize) / this.height,
			usize: img.width / this.width,
			vsize: img.height / this.height,
			x: this.allocx + this.padsize,
			y: this.allocy + this.padsize,
			repeatWidth: repeatWidth,
			repeatHeight: repeatHeight,
			totalpixels: (this.padsize + repeatWidth + this.padsize) * (this.padsize + repeatHeight + this.padsize),
			img
		};
		this.allocs.push(alloc);
		this.allocx += sizex;
		this.map.set(id, alloc);
		return true;
	}
	convertToThreeTexture() {
		return this.resultSource ??= (() => {
			let map = new THREE.CanvasTexture(this.convert());
			map.flipY = false;//FALFALSEFLASEFALSE WHY IS THIS ON BY DEFAULT
			map.magFilter = THREE.LinearFilter;
			map.minFilter = THREE.LinearMipMapNearestFilter;
			map.generateMipmaps = true;
			map.colorSpace = THREE.SRGBColorSpace;
			return map;
		})();
	}
	convert() {
		if (this.result) { return this.result; }
		let cnv = document.createElement("canvas");
		cnv.width = this.width;
		cnv.height = this.height;
		let ctx = cnv.getContext("2d", { willReadFrequently: true })!;

		let drawSubimg = (src: CanvasImage, destx: number, desty: number, srcx = 0, srcy = 0, width = src.width, height = src.height) => {
			ctx.drawImage(src, srcx, srcy, width, height, destx, desty, width, height);
		}

		// let usedpixels = this.allocs.reduce((a, v) => a + v.totalpixels, 0);
		// let texpixels = this.width * this.height;
		// console.log("floor texatlas imgs", this.allocs.length, `size: ${this.width}x${this.height}`, "size (kb)", +(texpixels / 1024).toFixed(0), "used (kb)", +(usedpixels / 1024).toFixed(0), "%", +(usedpixels / texpixels * 100).toFixed(0));
		for (let alloc of this.allocs) {
			let xx1 = -this.padsize;
			let xx2 = alloc.repeatWidth + this.padsize
			let yy1 = -this.padsize;
			let yy2 = alloc.repeatHeight + this.padsize;

			for (let y = yy1; y < yy2; y = nexty) {
				var nexty = Math.min(yy2, Math.ceil((y + 1) / alloc.img.height) * alloc.img.height);
				for (let x = xx1; x < xx2; x = nextx) {
					var nextx = Math.min(xx2, Math.ceil((x + 1) / alloc.img.width) * alloc.img.width);

					drawSubimg(alloc.img,
						alloc.x + x,
						alloc.y + y,
						posmod(x, alloc.img.width),
						posmod(y, alloc.img.height),
						nextx - x,
						nexty - y
					);

				}
			}
		}
		this.result = cnv;
		return cnv;
	}
}

export type PlacedMeshBase<T> = {
	model: ModelMeshData,
	morph: FloorMorph,
	miny: number,
	maxy: number,
	extras: T
}

export type PlacedMesh = PlacedMeshBase<ModelExtrasLocation> | PlacedMeshBase<ModelExtrasOverlay>;

export type PlacedModel = {
	models: PlacedMesh[],
	materialId: number,
	material: ParsedMaterial | null,
	hasVertexAlpha: boolean,
	minimapVariant: boolean,
	overlayIndex: number,
	groupid: string
}

type MapsquareLocation = {
	models: { model: number, morph: FloorMorph }[],
	mods: ModelModifications,
	extras: ModelExtrasLocation
}

export function defaultMorphId(locmeta: objects) {
	let newid = -1;
	if (locmeta.morphs_1) { newid = locmeta.morphs_1.unk2[0] ?? locmeta.morphs_1.unk3; }
	if (locmeta.morphs_2) { newid = locmeta.morphs_2.unk2; }
	if (newid == (1 << 15) - 1) { newid = -1; }//new caches with varuint
	if (newid == (1 << 16) - 1) { newid = -1; }//old caches which use ushort
	return newid;
}

//TODO move this to a more logical location
export async function resolveMorphedObject(source: EngineCache, id: number) {
	let resolvedid = id;
	if (source.classicData) {
		let locdata = getClassicLoc(source, id);
		return { rawloc: locdata, morphedloc: locdata, resolvedid };
	} else {
		let objectfile = await source.getGameFile("objects", id);
		let rawloc = parse.object.read(objectfile, source);
		let morphedloc = rawloc;
		if (rawloc.morphs_1 || rawloc.morphs_2) {
			let newid = defaultMorphId(rawloc);
			if (newid != -1) {
				let newloc = await source.getGameFile("objects", newid);
				morphedloc = {
					...rawloc,
					...parse.object.read(newloc, source)
				};
				resolvedid = newid;
			}
		}
		return { rawloc, morphedloc, resolvedid };
	}
}

export async function mapsquareOverlays(engine: EngineCache, grid: TileGrid, locs: WorldLocation[]) {
	let mat = new THREE.MeshBasicMaterial();
	mat.transparent = true;
	mat.depthTest = false;
	let floorgroup = (level: number) => {
		let wallgroup: PlacedModel = {
			models: [],
			groupid: "walls" + level,
			minimapVariant: false,
			hasVertexAlpha: false,
			materialId: -1,
			material: { mat, matmeta: { ...defaultMaterial() } },
			overlayIndex: 1
		}

		let mapscenes = new Map<number, PlacedModel>();
		return { wallgroup, mapscenes };
	}
	let floors = [floorgroup(0), floorgroup(1), floorgroup(2), floorgroup(3)]

	let addwall = (model: ModelData, loc: WorldLocation) => {
		let translate = new THREE.Vector3().set((loc.x + loc.sizex / 2) * tiledimensions, 0, (loc.z + loc.sizez / 2) * tiledimensions);
		let rotation = new THREE.Quaternion().setFromAxisAngle(upvector, loc.rotation / 2 * Math.PI);
		let scale = new THREE.Vector3(1, 1, 1);

		floors[loc.effectiveLevel].wallgroup.models.push({
			model: model.meshes[0],
			morph: {
				level: loc.plane,
				placementMode: "followfloor",
				translate, rotation, scale,
				scaleModelHeightOffset: 0,
				originx: translate.x,
				originz: translate.z
			},
			miny: model.miny,
			maxy: model.maxy,
			extras: {
				modeltype: "overlay",
				isclickable: false,
				modelgroup: "walls" + loc.visualLevel,
				level: loc.effectiveLevel
			}
		});
	}

	let addMapscene = async (loc: WorldLocation, sceneid: number) => {
		let group = floors[loc.effectiveLevel].mapscenes.get(sceneid);
		// if (!group) {
		let mapscene = grid.engine.mapMapscenes[sceneid];
		if (mapscene.sprite_id == undefined) { return; }
		let spritefile = await engine.getFileById(cacheMajors.sprites, mapscene.sprite_id);
		let sprite = parseSprite(spritefile);
		let mat = new THREE.MeshBasicMaterial();
		mat.map = new THREE.DataTexture(sprite[0].img.data, sprite[0].img.width, sprite[0].img.height, THREE.RGBAFormat);
		mat.depthTest = false;
		mat.transparent = true;
		mat.needsUpdate = true;
		group = {
			groupid: "mapscenes" + loc.effectiveLevel,
			hasVertexAlpha: false,
			materialId: -1,
			minimapVariant: false,
			material: { mat, matmeta: { ...defaultMaterial(), alphamode: "cutoff" } },
			models: [],
			overlayIndex: 2
		};
		floors[loc.effectiveLevel].mapscenes.set(sceneid, group);
		// }
		// let tex = (group.material.mat as MeshBasicMaterial).map! as DataTexture;
		//TODO add either remove this alltogether or add model combining back
		console.warn("using very inefficient code path for 3d mapscenes");

		let tex = mat.map;

		const spritescale = 128;
		let w = tex.image.width * spritescale;
		let h = tex.image.height * spritescale;
		let mesh = new MeshBuilder(null)
			.addParallelogram([255, 255, 255], [-w / 2, 0, -h / 2], [w, 0, 0], [0, 0, h])
			.convertSubmesh(0);
		let translate = new THREE.Vector3((loc.x + loc.sizex / 2) * tiledimensions, 0, (loc.z + loc.sizez / 2) * tiledimensions);
		group.models.push({
			model: mesh,
			morph: {
				level: loc.plane,
				placementMode: "simple",
				rotation: new THREE.Quaternion(),
				scale: new THREE.Vector3(1, 1, 1),
				translate: translate,
				scaleModelHeightOffset: 0,
				originx: translate.x,
				originz: translate.z
			},
			miny: 0,
			maxy: 0,
			extras: {
				modeltype: "overlay",
				isclickable: false,
				level: loc.visualLevel,
				modelgroup: "mapscenes"
			}
		});
	}

	for (let loc of locs) {
		if (loc.effectiveLevel == -1) { continue; }
		if (loc.type == 0) {
			addwall(topdown2dWallModels.wall, loc);
		} else if (loc.type == 1) {
			addwall(topdown2dWallModels.shortcorner, loc);
		} else if (loc.type == 2) {
			addwall(topdown2dWallModels.longcorner, loc);
		} else if (loc.type == 3) {
			addwall(topdown2dWallModels.pillar, loc);
		} else if (loc.type == 9) {
			addwall(topdown2dWallModels.diagonal, loc);
		}

		if (loc.location.mapscene != undefined) {
			await addMapscene(loc, loc.location.mapscene);
		}
	}

	return floors.flatMap(f => [f.wallgroup, ...f.mapscenes.values()]);
}

export function mapsquareObjectModels(cache: CacheFileSource, inst: WorldLocation, minimap = false) {
	let locmodels: MapsquareLocation["models"] = [];
	let objectmeta = inst.location;
	let isGroundDecor = inst.type == 22 && !objectmeta.unknown_49;

	let modelmods: ModelModifications = {
		replaceColors: objectmeta.color_replacements ?? undefined,
		replaceMaterials: objectmeta.material_replacements ?? undefined,
		lodLevel: (minimap ? 100 : undefined)
	};
	if (cache.getBuildNr() > lastClassicBuildnr && cache.getBuildNr() < 377) {
		//old caches just use one prop to replace both somehow
		//TODO buildnr cutoff for this is off by like 2 years
		modelmods.replaceMaterials = modelmods.replaceColors;
	}

	const translatefactor = 4;//no clue why but seems right
	let translate = new Vector3(
		(objectmeta.translateX ?? 0) * translatefactor,
		-(objectmeta.translateY ?? 0) * translatefactor,//minus y!!!
		(objectmeta.translateZ ?? 0) * translatefactor
	);
	const scalefactor = 1 / 128;//estimated fit was 127.5 ...
	let scale = new Vector3(
		(objectmeta.scaleX ?? 128) * scalefactor,
		(objectmeta.scaleY ?? 128) * scalefactor,
		(objectmeta.scaleZ ?? 128) * scalefactor
	);

	let originx = (inst.x + inst.sizex / 2) * tiledimensions;
	let originz = (inst.z + inst.sizez / 2) * tiledimensions;

	let rotation = new THREE.Quaternion().setFromAxisAngle(upvector, inst.rotation / 2 * Math.PI);
	if (inst.rotation % 2 == 1) {
		let tmp = scale.x;
		scale.x = scale.z;
		scale.z = tmp;
	}
	if (objectmeta.mirror) { scale.z *= -1; }
	translate.add(new Vector3(originx, 0, originz));
	if (minimap) { translate.y -= 0.2 * tiledimensions; }

	if (inst.placement) {
		translate.add(new Vector3().set(
			inst.placement.translateX ?? 0,
			-(inst.placement.translateY ?? 0),
			inst.placement.translateZ ?? 0
		));
		if (inst.placement.scale) {
			scale.multiplyScalar((inst.placement.scale ?? 128) / 128);
		}
		if (inst.placement.scaleX || inst.placement.scaleY || inst.placement.scaleZ) {
			scale.multiply(new Vector3().set(
				(inst.placement.scaleX ?? 128) / 128,
				(inst.placement.scaleY ?? 128) / 128,
				(inst.placement.scaleZ ?? 128) / 128,
			));
		}
		if (inst.placement.rotation) {
			let scale = 1 / (1 << 15);
			//flip the y axis by flipping x and z sign
			let rot = new THREE.Quaternion(
				-inst.placement.rotation[0] * scale,
				inst.placement.rotation[1] * scale,
				-inst.placement.rotation[2] * scale,
				inst.placement.rotation[3] * scale
			);
			rotation.premultiply(rot);
		}
	}
	let linkabove = typeof objectmeta.probably_morphCeilingOffset != "undefined";
	let followfloor = linkabove || !!objectmeta.probably_morphFloor;

	let morph: FloorMorph = {
		translate, rotation, scale,
		level: inst.plane,
		placementMode: (linkabove ? "followfloorceiling" : followfloor ? "followfloor" : "simple"),
		scaleModelHeightOffset: objectmeta.probably_morphCeilingOffset ?? 0,
		originx, originz
	};

	let extras: ModelExtrasLocation = {
		modeltype: "location",
		isclickable: false,
		modelgroup: (minimap ? `mini_objects${inst.resolvedlocid == inst.locid && inst.location.probably_animation == undefined ? inst.visualLevel : 0}` : `objects${inst.visualLevel}`),
		locationid: inst.locid,
		worldx: inst.x,
		worldz: inst.z,
		rotation: inst.rotation,
		mirror: !!objectmeta.mirror,
		isGroundDecor,
		level: inst.visualLevel,
		locationInstance: inst
	};

	let modelcount = 0;
	let addmodel = (type: number, finalmorph: FloorMorph) => {
		if (minimap && isGroundDecor) { return; }
		if (objectmeta.models) {
			for (let ch of objectmeta.models) {
				if (ch.type != type) { continue; }
				modelcount++;
				for (let modelid of ch.values) {
					locmodels.push({ model: modelid, morph: finalmorph });
				}
			}
		} else if (objectmeta.models_05) {
			for (let ch of objectmeta.models_05.models) {
				if (ch.type != type) { continue; }
				modelcount++;
				for (let modelid of ch.values) {
					locmodels.push({ model: modelid, morph: finalmorph });
				}
			}
		}
	}
	//0 straight wall
	//1 wall short corner
	//2 wall long corner (only half of model is stored and needs to be copied+transformed)
	//3 end of wall/pillar
	//4 wall attachment
	//5 wall attachment on inside wall, translates a little in local x (model taken from type 4)
	//6 wall attachment on diagonal inside wall, translates a little and uses model 4
	//7 diagonal outside wall ornament 225deg diagonal using model 4
	//8 BOTH 6 and 7, both using model 4
	//9 diagonal wall
	//10 scenery (most areas are built exclusively from this type)
	//11 diagonal scenery (uses model 10)
	//12 straight roof
	//13 corner roof (diagonal)
	//14 concave corner roof 
	//15 concave roof (with angle)
	//16 also corner roof (with angle)
	//17 flat center roof
	//18 roof overhang
	//19 corner roof overhang (diagonal)
	//21 corner roof overhang (with angle)
	//22 floor decoration
	if (inst.type == 11) {
		addmodel(10, {
			...morph,
			rotation: new Quaternion().setFromAxisAngle(upvector, Math.PI / 4).premultiply(morph.rotation)
		});
	} else if (inst.type == 8 || inst.type == 7 || inst.type == 6) {
		if (inst.type == 6 || inst.type == 8) {
			let dx = tiledimensions * 0.6;
			let angle = Math.PI / 4;
			let rotation = new THREE.Quaternion().setFromAxisAngle(upvector, angle).premultiply(morph.rotation)
			addmodel(4, {
				...morph,
				rotation,
				translate: new THREE.Vector3(dx, 0, 0).applyQuaternion(rotation).add(morph.translate)
			});
		}
		if (inst.type == 7 || inst.type == 8) {
			let dx = tiledimensions * 0.5;
			let angle = Math.PI / 4 * 5;
			let rotation = new THREE.Quaternion().setFromAxisAngle(upvector, angle).premultiply(morph.rotation)
			addmodel(4, {
				...morph,
				rotation,
				translate: new THREE.Vector3(dx, 0, 0).applyQuaternion(rotation).add(morph.translate)
			});
		}
	} else if (inst.type == 2) {
		//corner wall made out of 2 pieces
		addmodel(2, {
			...morph,
			scale: new Vector3(1, 1, -1).multiply(morph.scale)
		});
		addmodel(2, {
			...morph,
			rotation: new Quaternion().setFromAxisAngle(upvector, Math.PI / 2).premultiply(morph.rotation)
		});
	} else if (inst.type == 5) {
		//moves the model some amount in x direction
		//this might actually for real try to move depending on the size of objects it shares a tile with
		//this doesn't take every other transform into account! but should be good enough for old 
		//models that actually use this prop
		let dx = tiledimensions / 6;
		addmodel(4, {
			...morph,
			translate: new THREE.Vector3(dx, 0, 0).applyQuaternion(morph.rotation).add(morph.translate)
		});
	} else {
		addmodel(inst.type, morph);
	}

	return { models: locmodels, mods: modelmods, extras: extras };
}

export type WorldLocation = {
	x: number,
	z: number,
	type: number,
	rotation: number,
	plane: number,
	locid: number,
	resolvedlocid: number,
	location: objects,
	sizex: number,
	sizez: number,
	placement: mapsquare_locations["locations"][number]["uses"][number]["extra"],
	visualLevel: number,
	effectiveLevel: number,
	forceVisible: boolean
}

export async function mapsquareObjects(engine: EngineCache, grid: TileGrid, locations: mapsquare_locations["locations"], originx: number, originz: number, collision = false) {
	let locs: WorldLocation[] = [];

	let locdatas = await Promise.all(locations.map(q => resolveMorphedObject(engine, q.id)));
	for (let locindex = 0; locindex < locations.length; locindex++) {
		let loc = locations[locindex];
		let { morphedloc, rawloc, resolvedid } = locdatas[locindex];
		if (!morphedloc) { continue; }

		for (let inst of loc.uses) {
			let callingtile = grid.getTile(inst.x + originx, inst.y + originz, inst.plane);
			if (!callingtile) {
				// console.log("callingtile not found");
				continue;
			}

			//models have their center in the middle, but they always rotate such that their southwest corner
			//corresponds to the southwest corner of the tile
			let sizex = (morphedloc.width ?? 1);
			let sizez = (morphedloc.length ?? 1);
			if ((inst.rotation % 2) == 1) {
				//flip offsets if we are rotated with 90deg or 270deg
				[sizex, sizez] = [sizez, sizex];
			}

			let visualLevel = callingtile.effectiveVisualLevel;
			for (let dz = 0; dz < sizez; dz++) {
				for (let dx = 0; dx < sizex; dx++) {
					let tile = grid.getTile(inst.x + originx + dx, inst.y + originz + dz, inst.plane);
					if (tile && tile.effectiveVisualLevel > visualLevel) {
						visualLevel = tile.effectiveVisualLevel;
					}
				}
			}

			locs.push({
				location: morphedloc,
				locid: loc.id,
				resolvedlocid: resolvedid,
				placement: inst.extra,
				sizex,
				sizez,
				x: inst.x + originx,
				z: inst.y + originz,
				type: inst.type,
				rotation: inst.rotation,
				plane: inst.plane,
				visualLevel,
				effectiveLevel: callingtile.effectiveLevel,
				forceVisible: !!(callingtile.settings & 0x8)
			});

			const fullcollisiontypes = [
				9,//is actually diagonal wall
				10, 11,
				12, 13, 14, 15, 16, 17, 18, 19, 20, 21//roof types, only some are confirmed
			]

			if (collision && !rawloc.probably_nocollision) {
				for (let dz = 0; dz < sizez; dz++) {
					for (let dx = 0; dx < sizex; dx++) {
						let tile = grid.getTile(inst.x + originx + dx, inst.y + originz + dz, callingtile.effectiveLevel);
						if (tile) {
							let col = tile.effectiveCollision!;
							//TODO check for other loc types
							//22 should block, 4 should not
							if (inst.type == 22 && rawloc.maybe_blocks_movement) {
								col.walk[0] = true;
							}
							if (inst.type == 0) {
								col.walk[1 + inst.rotation] = true;
								if (!rawloc.maybe_allows_lineofsight) {
									col.sight[1 + inst.rotation] = true;
								}
							} else if (inst.type == 2) {
								col.walk[1 + inst.rotation] = true;
								col.walk[1 + (inst.rotation + 1) % 4] = true;
								if (!rawloc.maybe_allows_lineofsight) {
									col.sight[1 + inst.rotation] = true;
									col.sight[1 + (inst.rotation + 1) % 4] = true;
								}
							} else if (inst.type == 1 || inst.type == 3) {
								col.walk[5 + inst.rotation] = true;
								if (!rawloc.maybe_allows_lineofsight) {
									col.sight[5 + inst.rotation] = true;
								}
							} else if (fullcollisiontypes.includes(inst.type)) {
								col.walk[0] = true;
								if (!rawloc.maybe_allows_lineofsight) {
									col.sight[0] = true;
								}
							}
						}
					}
				}
			}
		}
	}
	return locs;
}

function mapsquareCollisionMesh(grid: TileGrid, tilerect: MapRect, level: number, rawmode = false) {
	const maxtriangles = tilerect.xsize * tilerect.zsize * 5 * 6 * 2;
	let posoffset = 0;
	let coloroffset = 12;
	let stride = 16;
	const posstride = stride / 4 | 0;
	const colorstride = stride;
	let [buf, slicebuf] = borrowScratchbuffer(stride * maxtriangles * 3);
	let [indexbufdata, sliceindexbuf] = borrowScratchbuffer(maxtriangles * 3 * 4, "index");
	let indexbuf = new Uint32Array(indexbufdata);
	let posbuffer = new Float32Array(buf);
	let colorbuffer = new Uint8Array(buf);

	let rootx = tilerect.x * tiledimensions;
	let rootz = tilerect.z * tiledimensions;

	let vertexindex = 0;
	let indexpointer = 0;
	let writevertex = (tile: TileProps, dx: number, dy: number, dz: number, color: number[]) => {
		const pospointer = vertexindex * posstride + posoffset;
		const colorpointer = vertexindex * colorstride + coloroffset;
		const y00 = (rawmode ? tile.y : tile.playery00) * (1 - dx) * (1 - dz);
		const y01 = (rawmode ? tile.y01 : tile.playery01) * dx * (1 - dz);
		const y10 = (rawmode ? tile.y10 : tile.playery10) * (1 - dx) * dz;
		const y11 = (rawmode ? tile.y11 : tile.playery11) * dx * dz;
		posbuffer[pospointer + 0] = tile.x + dx * tiledimensions - rootx;
		posbuffer[pospointer + 1] = y00 + y01 + y10 + y11 + dy * tiledimensions;
		posbuffer[pospointer + 2] = tile.z + dz * tiledimensions - rootz;

		colorbuffer[colorpointer + 0] = color[0];
		colorbuffer[colorpointer + 1] = color[1];
		colorbuffer[colorpointer + 2] = color[2];
		colorbuffer[colorpointer + 3] = color[3];
		return vertexindex++;
	}
	let writebox = (tile: TileProps, dx: number, dy: number, dz: number, sizex: number, sizey: number, sizez: number, color: number[]) => {
		//all corners of the box
		let v000 = writevertex(tile, dx, dy, dz, color);
		let v001 = writevertex(tile, dx + sizex, dy, dz, color);
		let v010 = writevertex(tile, dx, dy + sizey, dz, color);
		let v011 = writevertex(tile, dx + sizex, dy + sizey, dz, color);
		let v100 = writevertex(tile, dx, dy, dz + sizez, color);
		let v101 = writevertex(tile, dx + sizex, dy, dz + sizez, color);
		let v110 = writevertex(tile, dx, dy + sizey, dz + sizez, color);
		let v111 = writevertex(tile, dx + sizex, dy + sizey, dz + sizez, color);
		//front
		indexbuf[indexpointer++] = v000; indexbuf[indexpointer++] = v011; indexbuf[indexpointer++] = v001;
		indexbuf[indexpointer++] = v000; indexbuf[indexpointer++] = v010; indexbuf[indexpointer++] = v011;
		//right
		indexbuf[indexpointer++] = v001; indexbuf[indexpointer++] = v111; indexbuf[indexpointer++] = v101;
		indexbuf[indexpointer++] = v001; indexbuf[indexpointer++] = v011; indexbuf[indexpointer++] = v111;
		//left
		indexbuf[indexpointer++] = v000; indexbuf[indexpointer++] = v110; indexbuf[indexpointer++] = v010;
		indexbuf[indexpointer++] = v000; indexbuf[indexpointer++] = v100; indexbuf[indexpointer++] = v110;
		//top
		indexbuf[indexpointer++] = v010; indexbuf[indexpointer++] = v111; indexbuf[indexpointer++] = v011;
		indexbuf[indexpointer++] = v010; indexbuf[indexpointer++] = v110; indexbuf[indexpointer++] = v111;
		//bottom
		indexbuf[indexpointer++] = v000; indexbuf[indexpointer++] = v101; indexbuf[indexpointer++] = v100;
		indexbuf[indexpointer++] = v000; indexbuf[indexpointer++] = v001; indexbuf[indexpointer++] = v101;
		//back
		indexbuf[indexpointer++] = v100; indexbuf[indexpointer++] = v111; indexbuf[indexpointer++] = v110;
		indexbuf[indexpointer++] = v100; indexbuf[indexpointer++] = v101; indexbuf[indexpointer++] = v111;
	}
	for (let z = tilerect.z; z < tilerect.z + tilerect.zsize; z++) {
		for (let x = tilerect.x; x < tilerect.x + tilerect.xsize; x++) {
			let tile = grid.getTile(x, z, level);
			let collision = (rawmode ? tile?.rawCollision : tile?.effectiveCollision);
			if (tile && collision) {
				if (collision.walk[0]) {
					let height = (collision.sight[0] ? 1.8 : 0.3);
					writebox(tile, 0.05, 0, 0.05, 0.9, height, 0.9, [100, 50, 50, 255]);
				}
				if (rawmode && collision.settings & (2 | 4 | 8 | 16)) {
					let r = 0, g = 0, b = 0;
					if (collision.settings & 2) { r += 0; g += 127; b += 127; }
					if (collision.settings & 4) { r += 0; g += 127; b += 0; }
					if (collision.settings & 8) { r += 127; g += 0; b += 0; }
					if (collision.settings & ~(1 | 2 | 4 | 8)) { r += 0; g += 0; b += 127; }
					writebox(tile, -0.05, -0.05, 0, 1.1, 0.25, 1.1, [r, g, b, 255]);
				}
				for (let dir = 0; dir < 4; dir++) {
					if (collision.walk[1 + dir]) {
						let height = (collision.sight[1 + dir] ? 2 : 0.5);
						let col = [255, 60, 60, 255];
						if (dir == 0) { writebox(tile, 0, 0, 0, 0.15, height, 1, col); }
						if (dir == 1) { writebox(tile, 0, 0, 0.85, 1, height, 0.15, col); }
						if (dir == 2) { writebox(tile, 0.85, 0, 0, 0.15, height, 1, col); }
						if (dir == 3) { writebox(tile, 0, 0, 0, 1, height, 0.15, col); }
					}
					if (collision.walk[5 + dir]) {
						let height = (collision.sight[5 + dir] ? 2 : 0.5);
						let col = [255, 60, 60, 255];
						if (dir == 0) { writebox(tile, 0, 0, 0.85, 0.15, height, 0.15, col); }
						if (dir == 1) { writebox(tile, 0.85, 0, 0.85, 0.15, height, 0.15, col); }
						if (dir == 2) { writebox(tile, 0.85, 0, 0, 0.15, height, 0.15, col); }
						if (dir == 3) { writebox(tile, 0, 0, 0, 0.15, height, 0.15, col); }
					}
				}
			}
		}
	}

	let extra: ModelExtras = {
		modeltype: "overlay",
		isclickable: false,
		modelgroup: (rawmode ? "collision-raw" : "collision") + level,
		level
	}

	// console.log(`using ${vertexindex * stride}/${buf.byteLength} of collision buf`);

	let bufslice = slicebuf(vertexindex * stride);
	let indexslice = sliceindexbuf(indexpointer * 4);

	return {
		pos: new Float32Array(bufslice),
		color: new Uint8Array(bufslice),
		indices: new Uint32Array(indexslice),
		posstride,
		colorstride,
		posoffset,
		coloroffset,
		extra
	}
}

function mapsquareCollisionToThree(grid: TileGrid, chunk: ChunkData, level: number, rawmode = false) {
	let { color, indices, pos, coloroffset, colorstride, posoffset, posstride, extra } = mapsquareCollisionMesh(grid, chunk.tilerect, level, rawmode);

	if (indices.length == 0) { return undefined; }
	let geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(pos, posstride), 3, posoffset, false));
	geo.setAttribute("color", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(color, colorstride), 4, coloroffset, true));
	geo.index = new THREE.BufferAttribute(indices, 1, false);
	let mat = new THREE.MeshPhongMaterial({ shininess: 0 });
	mat.flatShading = true;
	augmentZOffsetMaterial(mat, 1);
	// mat.wireframe = true;
	mat.vertexColors = true;
	let model = new THREE.Mesh(geo, mat);
	model.userData = extra;
	model.name = `${rawmode ? "raw " : ""}collision ${chunk.mapsquarex},${chunk.mapsquarez} (${level})`;
	return model;
}

export async function generateLocationMeshgroups(scene: ThreejsSceneCache, locbases: WorldLocation[], minimap = false) {
	let loadedmodels = new Map<number, ModelData>();

	let matmeshes: Map<string, Map<number, PlacedModel>> = new Map();
	let byLogical = new Map<WorldLocation, PlacedMesh[]>;

	let locs = locbases.map(loc => mapsquareObjectModels(scene.engine, loc, minimap));
	let loadproms: Promise<any>[] = [];
	//dedupe fetches even though the scenecache already dedupes it, this still prevents a bunch of async microtasks
	let queuedmodels = new Set<number>();
	for (let loc of locs) {
		for (let model of loc.models) {
			if (queuedmodels.has(model.model)) { continue; }
			queuedmodels.add(model.model);
			loadproms.push(scene.getModelData(model.model).catch(e => {
				console.warn("ignoring missing model", model.model, "in loc", loc.extras.locationInstance.location.name ?? loc.extras.locationid);
				return { bonecount: 0, skincount: 0, miny: 0, maxy: 0, meshes: [] } as ModelData;
			}).then(m => loadedmodels.set(model.model, m)));
		}
	}
	await Promise.all(loadproms);

	for (let index = 0; index < locs.length; index++) {
		let obj = locs[index];
		let miny = 0;
		let maxy = 0;
		for (let modelinst of obj.models) {
			let model = loadedmodels.get(modelinst.model)!;
			miny = Math.min(model.miny, miny);
			maxy = Math.max(model.maxy, maxy);
		}
		let meshes: PlacedModel["models"] = [];
		for (let modelinst of obj.models) {
			let model = loadedmodels.get(modelinst.model)!;
			for (let rawmesh of model.meshes) {
				let modified = modifyMesh(rawmesh, obj.mods);
				let matkey = materialCacheKey(modified.materialId, modified.hasVertexAlpha, minimap);
				let group = matmeshes.get(obj.extras.modelgroup);
				if (!group) {
					group = new Map();
					matmeshes.set(obj.extras.modelgroup, group);
				}
				let matgroup = getOrInsert(group, matkey, () => ({
					materialId: modified.materialId,
					material: null,
					hasVertexAlpha: modified.hasVertexAlpha,
					minimapVariant: minimap,
					models: [],
					groupid: obj.extras.modelgroup,
					overlayIndex: 0
				}));
				let mesh: PlacedModel["models"][number] = {
					model: modified,
					morph: modelinst.morph,
					miny: miny,
					maxy: maxy,
					extras: obj.extras
				}
				meshes.push(mesh);
				matgroup.models.push(mesh);
			}
		}
		if (meshes.length != 0) {
			byLogical.set(locbases[index], meshes);
		}
	}
	let byMaterial: PlacedModel[] = [];
	for (let group of matmeshes.values()) {
		byMaterial.push(...group.values());
	}
	return { byMaterial, byLogical };
}

class RSBatchMesh extends THREE.Mesh {
	renderSections: ThreeJsRenderSection[] = [];
	constructor(geo?: THREE.BufferGeometry, mat?: THREE.Material | THREE.Material[]) {
		super(geo, mat);
	}
	cloneSection(section: ThreeJsRenderSection) {
		let geo = new THREE.BufferGeometry();
		for (let attrname in this.geometry.attributes) {
			let attr = this.geometry.attributes[attrname];
			let cloned = new BufferAttribute(attr.array.slice(section.startvertex * attr.itemSize, section.endvertex * attr.itemSize), attr.itemSize, attr.normalized);
			geo.setAttribute(attrname, cloned);
		}
		let indexarr = this.geometry.index!.array.slice(section.startindex, section.endindex);
		for (let i = 0; i < indexarr.length; i++) { indexarr[i] -= section.startvertex; }
		geo.setIndex(new THREE.BufferAttribute(indexarr, 1));
		let clone = new RSBatchMesh(geo, this.material);
		let newsection: ThreeJsRenderSection = {
			mesh: clone,
			startindex: 0,
			endindex: section.endindex - section.startindex,
			startvertex: 0,
			endvertex: section.endvertex - section.startvertex,
			hidden: false
		};
		clone.renderSections.push(newsection);
		return newsection;
	}
	setSectionHide(section: ThreeJsRenderSection, hide: boolean) {
		if (section.hidden == hide) { return; }
		section.hidden = hide;
		let drawend = this.geometry.drawRange.count;
		if (this.geometry.drawRange.start != 0) { throw new Error("unexpected"); }
		if (!this.geometry.index) { throw new Error("unexpected"); }
		if (!isFinite(drawend)) { drawend = this.geometry.index.count }

		let len = section.endindex - section.startindex;
		let newoffset = (hide ? drawend - len : drawend);

		if (hide) {
			let tmp = this.geometry.index.array.slice(section.startindex, section.endindex);
			this.geometry.index.array.copyWithin(section.startindex, section.endindex, drawend);
			this.geometry.index.array.set(tmp, newoffset);
		} else {
			let tmp = this.geometry.index.array.slice(section.startindex, section.endindex);
			this.geometry.index.array.copyWithin(drawend + len, drawend, section.startindex);
			this.geometry.index.array.set(tmp, newoffset);
		}

		let front = (hide ? section.startindex : newoffset);
		let back = (hide ? drawend : section.endindex);
		let changediff = (hide ? -len : len);
		for (let i = 0; i < this.renderSections.length; i++) {
			let other = this.renderSections[i];
			if (other == section) { continue; }
			if (other.startindex < front || other.startindex >= back) { continue; }
			other.startindex += changediff;
			other.endindex += changediff;
		}
		section.startindex = newoffset;
		section.endindex = newoffset + len;

		this.geometry.setDrawRange(0, drawend + changediff);
		this.geometry.index.needsUpdate = true;
	}
}

export function meshgroupsToThree(grid: TileGrid, meshgroup: PlacedModel, rootx: number, rootz: number, material: ParsedMaterial, locrenders: Map<WorldLocation, ThreeJsRenderSection[]>) {
	let totalverts = meshgroup.models.reduce((a, v) => a + v.model.vertexend - v.model.vertexstart, 0);
	let totalindices = meshgroup.models.reduce((a, v) => a + v.model.indices.count, 0);
	let vertalphas = meshgroup.models.reduce((a, v) => a + +v.model.hasVertexAlpha, 0);
	if (vertalphas != 0 && vertalphas != meshgroup.models.length) { throw new Error("all meshes are expected to have same vertexAlpha setting"); }
	let hasvertexAlpha = vertalphas != 0;
	let vertindex = 0;
	let indexindex = 0;

	let pos = new BufferAttribute(new Float32Array(totalverts * 3), 3);
	let uvs = new BufferAttribute(new Float32Array(totalverts * 2), 2);
	let col = new BufferAttribute(new Uint8Array(totalverts * (hasvertexAlpha ? 4 : 3)), (hasvertexAlpha ? 4 : 3), true);
	let normals = new BufferAttribute(new Int8Array(totalverts * 3), 3, true);
	let indices = new BufferAttribute(totalverts > 0xffff ? new Uint32Array(totalindices) : new Uint16Array(totalindices), 1);

	let mergedgeo = new THREE.BufferGeometry();
	mergedgeo.setAttribute("position", pos);
	mergedgeo.setAttribute("normal", normals);
	mergedgeo.setAttribute("color", col);
	mergedgeo.setAttribute("uv", uvs);
	mergedgeo.setIndex(indices);
	let mergedmesh = new RSBatchMesh(mergedgeo);

	let indexcounts: number[] = [];
	for (let m of meshgroup.models) {
		let mesh = m.model;
		let matrix = getMorphMatrix(m.morph, rootx, rootz);
		let vertexcount = mesh.vertexend - mesh.vertexstart;
		let indexcount = mesh.indices.count;
		indexcounts.push(indexindex);

		let section: ThreeJsRenderSection = {
			mesh: mergedmesh,
			startindex: indexindex,
			endindex: indexindex + indexcount,
			startvertex: vertindex,
			endvertex: vertindex + vertexcount,
			hidden: false
		};
		mergedmesh.renderSections.push(section);
		if (m.extras.modeltype == "location") {
			let v = getOrInsert(locrenders, m.extras.locationInstance, () => []);
			v.push(section);
		}

		//indices
		{
			let vertoffset = vertindex - mesh.vertexstart;
			let oldindices = mesh.indices;
			if (matrix.determinant() < 0) {
				//reverse the winding order if the model is mirrored
				for (let i = 0; i < indexcount; i += 3) {
					let ii = indexindex + i;
					indices.setX(ii + 0, vertoffset + oldindices.getX(i + 0));
					indices.setX(ii + 1, vertoffset + oldindices.getX(i + 2));
					indices.setX(ii + 2, vertoffset + oldindices.getX(i + 1));
				}
			} else {
				for (let i = 0; i < indexcount; i += 3) {
					let ii = indexindex + i;
					indices.setX(ii + 0, vertoffset + oldindices.getX(i + 0));
					indices.setX(ii + 1, vertoffset + oldindices.getX(i + 1));
					indices.setX(ii + 2, vertoffset + oldindices.getX(i + 2));
				}
			}
		}

		//position
		transformVertexPositions(mesh.attributes.pos, m.morph, grid, m.maxy - m.miny, rootx, rootz, pos, vertindex, mesh.vertexstart, mesh.vertexend);

		//normals
		{
			let vector = new THREE.Vector3();
			if (mesh.attributes.normals) {
				let norm = mesh.attributes.normals;
				let [oldbuf, oldsuboffset, oldstride] = getAttributeBackingStore(norm);
				let [newbuf, newsuboffset, newstride] = getAttributeBackingStore(normals);
				let oldoffset = mesh.vertexstart * oldstride + oldsuboffset;
				let newoffset = vertindex * newstride + newsuboffset;
				let rotation = new THREE.Matrix4().makeRotationFromQuaternion(m.morph.rotation)
				for (let i = 0; i < vertexcount; i++) {
					let ii = newoffset + i * newstride;
					let jj = oldoffset + i * oldstride;
					vector.set(oldbuf[jj + 0], oldbuf[jj + 1], oldbuf[jj + 2]);
					// vector.fromBufferAttribute(norm, i);
					vector.applyMatrix4(rotation);
					newbuf[ii + 0] = Math.round(vector.x);
					newbuf[ii + 1] = Math.round(vector.y);
					newbuf[ii + 2] = Math.round(vector.z);
				}
			} else {
				computePartialNormals(indices, pos, normals, indexindex, indexindex + indexcount);
			}
		}

		//color
		{
			let [newbuf, newsuboffset, newstride] = getAttributeBackingStore(col);
			let newoffset = vertindex * newstride + newsuboffset;
			if (mesh.attributes.color) {
				let [oldbuf, oldsuboffset, oldstride] = getAttributeBackingStore(mesh.attributes.color);
				let oldoffset = mesh.vertexstart * oldstride + oldsuboffset;
				if (hasvertexAlpha) {
					for (let i = 0; i < vertexcount; i++) {
						let ii = newoffset + i * newstride;
						let jj = oldoffset + i * oldstride;
						newbuf[ii + 0] = oldbuf[jj + 0];
						newbuf[ii + 1] = oldbuf[jj + 1];
						newbuf[ii + 2] = oldbuf[jj + 2];
						newbuf[ii + 3] = oldbuf[jj + 3];
					}
				} else {
					for (let i = 0; i < vertexcount; i++) {
						let ii = newoffset + i * newstride;
						let jj = oldoffset + i * oldstride;
						newbuf[ii + 0] = oldbuf[jj + 0];
						newbuf[ii + 1] = oldbuf[jj + 1];
						newbuf[ii + 2] = oldbuf[jj + 2];
					}
				}
			} else {
				for (let i = 0; i < vertexcount; i++) {
					let ii = newoffset + i * newstride;
					newbuf[ii + 0] = 1;
					newbuf[ii + 1] = 1;
					newbuf[ii + 2] = 1;
					if (hasvertexAlpha) {
						newbuf[ii + 3] = 1;
					}
				}
			}
		}

		//uvs
		{
			let olduvs = mesh.attributes.texuvs;
			if (olduvs) {
				for (let i = 0; i < vertexcount; i++) {
					uvs.setXY(vertindex + i, olduvs.getX(mesh.vertexstart + i), olduvs.getY(mesh.vertexstart + i));
				}
			} else {
				for (let i = 0; i < vertexcount; i++) {
					uvs.setXY(vertindex + i, 0, 0);
				}
			}
		}

		vertindex += vertexcount;
		indexindex += indexcount;
	}

	applyMaterial(mergedmesh, material, meshgroup.minimapVariant);

	let clickable: ModelExtras = {
		modeltype: "locationgroup",
		modelgroup: meshgroup.groupid,
		isclickable: true,
		subranges: indexcounts,
		searchPeers: true,
		subobjects: meshgroup.models.map(q => q.extras)
	}
	mergedmesh.renderOrder = meshgroup.overlayIndex;
	mergedmesh.userData = clickable;

	mergedmesh.matrixAutoUpdate = false;
	mergedmesh.updateMatrix();
	mergedmesh.name = "merged locs";
	return mergedmesh;
}


function mapsquarePathMesh(grid: TileGrid, chunk: ChunkData, level: number): FloorMeshData {
	const maxtiles = chunk.tilerect.xsize * chunk.tilerect.zsize * grid.levels;
	const maxVerticesPerTile = 6;
	//TODO compact all this of refactor to threejs buffers
	const posoffset = 0;// 0/4
	const normaloffset = 3;// 12/4
	const coloroffset = 24;// 24/1
	const texusescoloroffset = 28;// 28/1
	const texweightoffset = 32;// 32/1
	const texuvoffset = 18;// 36/2
	const vertexstride = 52;
	//write to oversized static buffer, then copy out what we actually used
	let [vertexbuffer, slicebuffer] = borrowScratchbuffer(maxtiles * vertexstride * maxVerticesPerTile);
	let [indexbufferdata, sliceindexbuffer] = borrowScratchbuffer(maxtiles * maxVerticesPerTile * 4, "index");
	//TODO get rid of indexbuffer since we're not actually using it and it doesn't fit in uint16 anyway
	let indexbuffer = new Uint32Array(indexbufferdata);
	let posbuffer = new Float32Array(vertexbuffer);//size 12 bytes
	let normalbuffer = new Float32Array(vertexbuffer);//size 12 bytes
	let colorbuffer = new Uint8Array(vertexbuffer);//4 bytes
	let texusescolorbuffer = new Uint8Array(vertexbuffer);//4 bytes
	let texweightbuffer = new Uint8Array(vertexbuffer);//4 bytes
	let texuvbuffer = new Uint16Array(vertexbuffer);//16 bytes [u,v][4]
	const posstride = vertexstride / 4 | 0;//position indices to skip per vertex (cast to int32)
	const normalstride = vertexstride / 4 | 0;//normal indices to skip per vertex (cast to int32)
	const colorstride = vertexstride | 0;//color indices to skip per vertex (cast to int32)
	const texusescolorstride = vertexstride | 0;//wether each texture uses vertex colors or not
	const texweightstride = vertexstride | 0;
	const texuvstride = vertexstride / 2 | 0;

	let vertexindex = 0;
	let indexpointer = 0;

	const modelx = chunk.tilerect.x * tiledimensions;
	const modelz = chunk.tilerect.z * tiledimensions;
	let tileinfos: MeshTileInfo[] = [];
	let tileindices: number[] = [];

	let minx = Infinity, miny = Infinity, minz = Infinity;
	let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
	const writeVertex = (tile: TileProps, subx: number, subz: number, polyprops: TileVertex[], currentmat: number) => {
		const pospointer = vertexindex * posstride + posoffset;
		const normalpointer = vertexindex * normalstride + normaloffset;
		const colpointer = vertexindex * colorstride + coloroffset;
		const texweightpointer = vertexindex * texweightstride + texweightoffset;
		const texusescolorpointer = vertexindex * texusescolorstride + texusescoloroffset;
		const texuvpointer = vertexindex * texuvstride + texuvoffset;

		const w00 = (1 - subx) * (1 - subz);
		const w01 = subx * (1 - subz);
		const w10 = (1 - subx) * subz
		const w11 = subx * subz;

		const x = tile.x + subx * tiledimensions - modelx;
		const z = tile.z + subz * tiledimensions - modelz;

		// const y = (tile.waterProps
		// 	? tile.waterProps!.y00 * w00 + tile.waterProps!.y01 * w01 + tile.waterProps!.y10 * w10 + tile.waterProps!.y11 * w11
		// 	: tile.y * w00 + tile.y01 * w01 + tile.y10 * w10 + tile.y11 * w11
		// );
		const y = tile.playery00 * w00 + tile.playery01 * w01 + tile.playery10 * w10 + tile.playery11 * w11;
		minx = Math.min(minx, x); miny = Math.min(miny, y); minz = Math.min(minz, z);
		maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); maxz = Math.max(maxz, z);
		posbuffer[pospointer + 0] = x;
		posbuffer[pospointer + 1] = y;
		posbuffer[pospointer + 2] = z;

		let r = polyprops[currentmat].color[0];
		let g = polyprops[currentmat].color[1];
		let b = polyprops[currentmat].color[2];

		colorbuffer[colpointer + 0] = r;
		colorbuffer[colpointer + 1] = g;
		colorbuffer[colpointer + 2] = b;
		colorbuffer[colpointer + 3] = 255;//4 alpha channel because of gltf

		return vertexindex++;
	}

	let polypropswalkable: TileVertex[] = [{
		material: -1,
		materialTiling: 128,
		materialBleedpriority: 0,
		color: [0, 0, 0]
	}];
	let polypropsblocked: TileVertex[] = [{
		material: -1,
		materialTiling: 128,
		materialBleedpriority: 0,
		color: [255, 0, 255]
	}];

	// run 2 seperate passes to make nonblocked lines show on top
	for (let blockedpass of [true, false]) {
		for (let z = 0; z < chunk.tilerect.zsize; z++) {
			for (let x = 0; x < chunk.tilerect.xsize; x++) {
				let tile = grid.getTile(chunk.tilerect.x + x, chunk.tilerect.z + z, level);
				let effectivetile = tile;
				// find the highest tiledata that renders on our level
				for (let tilelevel = level + 1; tilelevel < chunk.levelcount; tilelevel++) {
					let leveltile = grid.getTile(chunk.tilerect.x + x, chunk.tilerect.z + z, tilelevel);
					if (leveltile && leveltile.effectiveLevel == level) { effectivetile = leveltile; }
				}
				if (!tile || !effectivetile) { continue; }
				// let isblocked = !!(effectivetile.settings & 1);//map itself is blocked, ignore locs
				let isblocked = !!tile.effectiveCollision?.walk[0];
				let polyprops = (isblocked ? polypropsblocked : polypropswalkable);
				if (isblocked != blockedpass) { continue; }
				// if (isblocked) { continue; }

				indexbuffer[indexpointer++] = writeVertex(tile, 0, 0, polyprops, 0);
				indexbuffer[indexpointer++] = writeVertex(tile, 0, 1, polyprops, 0);
				indexbuffer[indexpointer++] = writeVertex(tile, 1, 1, polyprops, 0);
				indexbuffer[indexpointer++] = writeVertex(tile, 0, 0, polyprops, 0);
				indexbuffer[indexpointer++] = writeVertex(tile, 1, 1, polyprops, 0);
				indexbuffer[indexpointer++] = writeVertex(tile, 1, 0, polyprops, 0);

				// can't use indexed mesh since the renderer expects non-indexed here
				// let v00 = writeVertex(tile, 0, 0, polyprops, 0);
				// let v01 = writeVertex(tile, 0, 1, polyprops, 0);
				// let v10 = writeVertex(tile, 1, 0, polyprops, 0);
				// let v11 = writeVertex(tile, 1, 1, polyprops, 0);

				// indexbuffer[indexpointer++] = v00;
				// indexbuffer[indexpointer++] = v01;
				// indexbuffer[indexpointer++] = v11;
				// indexbuffer[indexpointer++] = v00;
				// indexbuffer[indexpointer++] = v11;
				// indexbuffer[indexpointer++] = v10;
			}
		}
	}

	let extra: ModelExtras = {
		modelgroup: "walkmesh" + level,
		modeltype: "floorhidden",
		mapsquarex: chunk.mapsquarex,
		mapsquarez: chunk.mapsquarez,
		level: level,
		isclickable: true,
		searchPeers: false,
		subobjects: tileinfos,
		subranges: tileindices
	};

	// console.log(`using ${vertexindex * vertexstride}/${vertexbuffer.byteLength} bytes of floor buffer`);

	//copy the part of the buffer that we actually used
	let vertexslice = slicebuffer(vertexindex * vertexstride);
	let indexslice = sliceindexbuffer(indexpointer * 4);

	let vertexfloat = new Float32Array(vertexslice);
	let vertexubyte = new Uint8Array(vertexslice);
	let vertexushort = new Uint16Array(vertexslice);

	return {
		chunk,
		level,
		tileinfos,
		mode: "walkmesh",
		iswater: false,

		vertexstride: vertexstride,
		//TODO i'm not actually using these, can get rid of it again
		indices: new Uint32Array(indexslice),
		nvertices: vertexindex,
		atlas: null,

		pos: { src: vertexfloat as ArrayBufferView, offset: posoffset, vecsize: 3, normalized: false },
		normal: { src: vertexfloat, offset: normaloffset, vecsize: 3, normalized: false },
		color: { src: vertexubyte, offset: coloroffset, vecsize: 4, normalized: true },
		_RA_FLOORTEX_UV0: { src: vertexushort, offset: texuvoffset + 0, vecsize: 2, normalized: true },
		_RA_FLOORTEX_UV1: { src: vertexushort, offset: texuvoffset + 2, vecsize: 2, normalized: true },
		_RA_FLOORTEX_UV2: { src: vertexushort, offset: texuvoffset + 4, vecsize: 2, normalized: true },
		_RA_FLOORTEX_WEIGHTS: { src: vertexubyte, offset: texweightoffset, vecsize: 3, normalized: true },
		_RA_FLOORTEX_USESCOLOR: { src: vertexubyte, offset: texusescoloroffset, vecsize: 3, normalized: true },

		posmax: [maxx, maxy, maxz],
		posmin: [minx, miny, minz],

		extra
	}
}

//TODO just turn this monster into a class
function mapsquareMesh(grid: TileGrid, chunk: ChunkData, level: number, atlas: SimpleTexturePacker, keeptileinfo = false, mode: "default" | "wireframe" | "minimap" | "worldmap" = "default", drawWater = false) {
	const showhidden = mode == "wireframe";
	const worldmap = mode == "worldmap";
	const isMinimap = mode == "minimap";

	const maxtiles = chunk.tilerect.xsize * chunk.tilerect.zsize * grid.levels;
	const maxVerticesPerTile = 8;
	//TODO can be compacted since we got rid of uv3
	const posoffset = 0;// 0/4
	const normaloffset = 3;// 12/4
	const coloroffset = 24;// 24/1
	const texusescoloroffset = 28;// 28/1
	const texweightoffset = 32;// 32/1
	const texuvoffset = 18;// 36/2
	const vertexstride = 52;
	//write to oversized static buffer, then copy out what we actually used
	let [vertexbuffer, slicebuffer] = borrowScratchbuffer(maxtiles * vertexstride * maxVerticesPerTile);
	let [indexbufferdata, sliceindexbuffer] = borrowScratchbuffer(maxtiles * maxVerticesPerTile * 4, "index");
	//TODO get rid of indexbuffer since we're not actually using it and it doesn't fit in uint16 anyway
	let indexbuffer = new Uint32Array(indexbufferdata);
	let posbuffer = new Float32Array(vertexbuffer);//size 12 bytes
	let normalbuffer = new Float32Array(vertexbuffer);//size 12 bytes
	let colorbuffer = new Uint8Array(vertexbuffer);//4 bytes
	let texusescolorbuffer = new Uint8Array(vertexbuffer);//4 bytes
	let texweightbuffer = new Uint8Array(vertexbuffer);//4 bytes
	let texuvbuffer = new Uint16Array(vertexbuffer);//16 bytes [u,v][4]
	const posstride = vertexstride / 4 | 0;//position indices to skip per vertex (cast to int32)
	const normalstride = vertexstride / 4 | 0;//normal indices to skip per vertex (cast to int32)
	const colorstride = vertexstride | 0;//color indices to skip per vertex (cast to int32)
	const texusescolorstride = vertexstride | 0;//wether each texture uses vertex colors or not
	const texweightstride = vertexstride | 0;
	const texuvstride = vertexstride / 2 | 0;

	let vertexindex = 0;
	let indexpointer = 0;

	const modelx = chunk.tilerect.x * tiledimensions;
	const modelz = chunk.tilerect.z * tiledimensions;
	let tileinfos: MeshTileInfo[] = [];
	let tileindices: number[] = [];

	let minx = Infinity, miny = Infinity, minz = Infinity;
	let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
	const writeVertex = (tile: TileProps, subx: number, subz: number, polyprops: TileVertex[], currentmat: number) => {
		const pospointer = vertexindex * posstride + posoffset;
		const normalpointer = vertexindex * normalstride + normaloffset;
		const colpointer = vertexindex * colorstride + coloroffset;
		const texweightpointer = vertexindex * texweightstride + texweightoffset;
		const texusescolorpointer = vertexindex * texusescolorstride + texusescoloroffset;
		const texuvpointer = vertexindex * texuvstride + texuvoffset;

		const w00 = (1 - subx) * (1 - subz);
		const w01 = subx * (1 - subz);
		const w10 = (1 - subx) * subz
		const w11 = subx * subz;

		const x = tile.x + subx * tiledimensions - modelx;
		const z = tile.z + subz * tiledimensions - modelz;

		const y = (drawWater
			? tile.waterProps!.y00 * w00 + tile.waterProps!.y01 * w01 + tile.waterProps!.y10 * w10 + tile.waterProps!.y11 * w11
			: tile.y * w00 + tile.y01 * w01 + tile.y10 * w10 + tile.y11 * w11
		);
		const normalx = (drawWater ? 0 : tile.normalX * w00 + (tile.next01 ?? tile).normalX * w01 + (tile.next10 ?? tile).normalX * w10 + (tile.next11 ?? tile).normalX * w11);
		const normalz = (drawWater ? 0 : tile.normalZ * w00 + (tile.next01 ?? tile).normalZ * w01 + (tile.next10 ?? tile).normalZ * w10 + (tile.next11 ?? tile).normalZ * w11)

		minx = Math.min(minx, x); miny = Math.min(miny, y); minz = Math.min(minz, z);
		maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); maxz = Math.max(maxz, z);
		posbuffer[pospointer + 0] = x;
		posbuffer[pospointer + 1] = y;
		posbuffer[pospointer + 2] = z;
		normalbuffer[normalpointer + 0] = normalx;
		normalbuffer[normalpointer + 1] = Math.sqrt(1 - normalx * normalx - normalz * normalz);
		normalbuffer[normalpointer + 2] = normalz;

		let r = polyprops[currentmat].color[0];
		let g = polyprops[currentmat].color[1];
		let b = polyprops[currentmat].color[2];

		if (isMinimap) {
			//based on linear regression of a bunch of overlays
			//i don't have any clue why
			r = 20 + 0.656 * r;
			g = 28 + 0.577 * g;
			b = 23 + 0.604 * b;
			if (drawWater) {
				r = Math.pow(r / 255, 2.2) * 255;
				g = Math.pow(g / 255, 2.2) * 255;
				b = Math.pow(b / 255, 2.2) * 255;
			}
		}

		colorbuffer[colpointer + 0] = r;
		colorbuffer[colpointer + 1] = g;
		colorbuffer[colpointer + 2] = b;
		colorbuffer[colpointer + 3] = 255;//4 alpha channel because of gltf

		for (let i = 0; i < 3; i++) {
			//a weight sum of below 1 automatically fils in with vertex color in the fragment shader
			//not writing anything simple leaves the weight for this texture at 0
			texuvbuffer[texuvpointer + 2 * i + 0] = 0;
			texuvbuffer[texuvpointer + 2 * i + 1] = 0;
			texweightbuffer[texweightpointer + i] = 0;
			texusescolorbuffer[texusescolorpointer + i] = 0;

			if (i < polyprops.length) {
				const subprop = polyprops[i];
				let texdata: SimpleTexturePackerAlloc | undefined = undefined;
				let whitemix = 0;
				if (subprop && subprop.material != -1) {
					let mat = grid.engine.getMaterialData(subprop.material);
					//TODO use linear scale here instead of bool
					whitemix = mat.baseColorFraction;

					if (mat.textures.diffuse) {
						texdata = atlas.map.get(mat.textures.diffuse)!;
					}
				}
				if (texdata) {
					//TODO is the 128px per tile a constant?
					//definitely not, there are also 64px textures
					let gridsize = subprop.materialTiling / 128;
					let ubase = (tile.x / tiledimensions) % gridsize;
					let vbase = (tile.z / tiledimensions) % gridsize;
					const maxuv = 0x10000;
					texuvbuffer[texuvpointer + 2 * i + 0] = (texdata.u + texdata.usize * (ubase + subx) / gridsize) * maxuv;
					texuvbuffer[texuvpointer + 2 * i + 1] = (texdata.v + texdata.vsize * (vbase + subz) / gridsize) * maxuv;

					texweightbuffer[texweightpointer + i] = (i == currentmat ? 255 : 0);
					texusescolorbuffer[texusescolorpointer + i] = 255 - whitemix * 255;
				}
			}
		}

		return vertexindex++;
	}

	for (let tilelevel = level; tilelevel < chunk.levelcount; tilelevel++) {
		if (showhidden && tilelevel != level) { continue; }
		for (let z = 0; z < chunk.tilerect.zsize; z++) {
			for (let x = 0; x < chunk.tilerect.xsize; x++) {
				let tile = grid.getTile(chunk.tilerect.x + x, chunk.tilerect.z + z, tilelevel);
				if (!tile) { continue; }
				if (!showhidden && tile.effectiveVisualLevel != level) { continue; }

				let shape = tile.shape;
				let hasneighbours = tile.next01 && tile.next10 && tile.next11;

				//it somehow prefers to split the tile in a way that keeps underlays together
				if (shape == defaulttileshape && hasneighbours) {

					let dcpos = Math.abs(tile.underlayprops.color[0] - tile.next11!.underlayprops.color[0])
						+ Math.abs(tile.underlayprops.color[1] - tile.next11!.underlayprops.color[1])
						+ Math.abs(tile.underlayprops.color[2] - tile.next11!.underlayprops.color[2]);
					let dcinv = Math.abs(tile.next01!.underlayprops.color[0] - tile.next10!.underlayprops.color[0])
						+ Math.abs(tile.next01!.underlayprops.color[1] - tile.next10!.underlayprops.color[1])
						+ Math.abs(tile.next01!.underlayprops.color[2] - tile.next10!.underlayprops.color[2]);

					//TODO still not quite the right criteria
					if (dcpos < dcinv) {
						shape = defaulttileshapeflipped;
					}
				}

				if (keeptileinfo) {
					tileinfos.push({ tile: tile.debug_raw, x, z, level: tilelevel, tilenxt: tile.debug_nxttile, underlaycolor: tile.originalUnderlayColor });
					tileindices.push(indexpointer);
				}
				if (drawWater) {
					if (tile.waterProps) {
						// let props: TileVertex = {
						// 	...tile.waterProps.props,
						// 	color: tile.waterProps.props.color.map((q, i) => (i == 3 ? q : Math.pow(q, 2.2)))
						// }
						let props = tile.waterProps.props;
						let polyprops = [props, props, props];
						let shape = tile.waterProps.shape
						for (let i = 2; i < shape.length; i++) {
							let v0 = shape[0];
							let v1 = shape[i - 1];
							let v2 = shape[i];
							if (!v0 || !v1 || !v2) { continue; }
							indexbuffer[indexpointer++] = writeVertex(tile, v0.subx, v0.subz, polyprops, 0);
							indexbuffer[indexpointer++] = writeVertex(tile, v1.subx, v1.subz, polyprops, 1);
							indexbuffer[indexpointer++] = writeVertex(tile, v2.subx, v2.subz, polyprops, 2);
						}
					}
				} else {
					if (hasneighbours && shape.overlay.length != 0) {
						//TODO default id 0 makes no sense here
						let overlaytype = tile.rawOverlay;
						let color = overlaytype?.color ?? (overlaytype && typeof overlaytype.materialbyte != "undefined" ? [255, 255, 255] : [255, 0, 255]);
						let isvisible = tile.overlayVisible;
						if (worldmap && !isvisible && overlaytype?.secondary_colour) {
							color = overlaytype.secondary_colour;
							isvisible = true;
						}
						if (isvisible || showhidden) {
							let props: TileVertex[];
							if (!worldmap) {
								props = shape.overlay.map(vertex => {
									if (!tile!.bleedsOverlayMaterial) { return tile!.overlayprops; }
									else {
										let node: TileProps | undefined = tile;
										if (vertex.nextx && vertex.nextz) { node = tile!.next11; }
										else if (vertex.nextx) { node = tile!.next01; }
										else if (vertex.nextz) { node = tile!.next10; }
										if (node) { return node.vertexprops[vertex.subvertex]; }
									}
									return defaultVertexProp;
								});
							} else {
								let vert: TileVertex = {
									material: 0,
									materialTiling: 128,
									materialBleedpriority: 0,
									color,
								};
								props = Array(shape.overlay.length).fill(vert);
							}
							for (let i = 2; i < shape.overlay.length; i++) {
								let v0 = shape.overlay[0];
								let v1 = shape.overlay[i - 1];
								let v2 = shape.overlay[i];
								if (!v0 || !v1 || !v2) { continue; }
								let polyprops = [props[0], props[i - 1], props[i]];
								indexbuffer[indexpointer++] = writeVertex(tile, v0.subx, v0.subz, polyprops, 0);
								indexbuffer[indexpointer++] = writeVertex(tile, v1.subx, v1.subz, polyprops, 1);
								indexbuffer[indexpointer++] = writeVertex(tile, v2.subx, v2.subz, polyprops, 2);
							}
						}
					}
					if (hasneighbours && shape.underlay.length != 0 && (tile.underlayVisible || showhidden)) {
						let props: TileVertex[];
						if (!worldmap) {
							props = shape.underlay.map(vertex => {
								let node: TileProps | undefined = tile;
								if (vertex.nextx && vertex.nextz) { node = tile!.next11; }
								else if (vertex.nextx) { node = tile!.next01; }
								else if (vertex.nextz) { node = tile!.next10; }
								if (node) {
									let prop = node.vertexprops[vertex.subvertex];
									if (prop.material == -1) {
										//TODO there seems to be more to the underlay thing
										//maybe materials themselves also get blended somehow
										//just copy our own materials for now if the neighbour is missing
										return { ...prop, material: tile!.underlayprops.material };
									} else {
										return prop;
									}
								}
								return defaultVertexProp;
							});
						} else {
							let prop: TileVertex = {
								material: 0,
								materialTiling: 128,
								materialBleedpriority: -1,
								color: tile.underlayprops.color
							};
							props = Array<TileVertex>(shape.underlay.length).fill(prop);
						}
						for (let i = 2; i < shape.underlay.length; i++) {
							let v0 = shape.underlay[0];
							let v1 = shape.underlay[i - 1];
							let v2 = shape.underlay[i];
							if (!v0 || !v1 || !v2) { continue; }
							let polyprops = [props[0], props[i - 1], props[i]];
							indexbuffer[indexpointer++] = writeVertex(tile, v0.subx, v0.subz, polyprops, 0);
							indexbuffer[indexpointer++] = writeVertex(tile, v1.subx, v1.subz, polyprops, 1);
							indexbuffer[indexpointer++] = writeVertex(tile, v2.subx, v2.subz, polyprops, 2);
						}
					}
				}
			}
		}
	}

	let extra: ModelExtras = {
		modelgroup: (mode == "wireframe" ? "floorhidden" : mode == "worldmap" ? "map" : mode == "minimap" ? "mini_floor" : "floor") + level,
		modeltype: (showhidden ? "floorhidden" : "floor"),
		mapsquarex: chunk.mapsquarex,
		mapsquarez: chunk.mapsquarez,
		level: level,
		isclickable: true,
		searchPeers: false,
		subobjects: tileinfos,
		subranges: tileindices
	};

	// console.log(`using ${vertexindex * vertexstride}/${vertexbuffer.byteLength} bytes of floor buffer`);

	//copy the part of the buffer that we actually used
	let vertexslice = slicebuffer(vertexindex * vertexstride);
	let indexslice = sliceindexbuffer(indexpointer * 4);

	let vertexfloat = new Float32Array(vertexslice);
	let vertexubyte = new Uint8Array(vertexslice);
	let vertexushort = new Uint16Array(vertexslice);

	return {
		chunk,
		level,
		tileinfos,
		mode: mode as typeof mode | "walkmesh",
		iswater: drawWater,

		vertexstride: vertexstride,
		//TODO i'm not actually using these, can get rid of it again
		indices: new Uint32Array(indexslice),
		nvertices: vertexindex,
		atlas: (mode != "worldmap" ? atlas : null),

		pos: { src: vertexfloat as ArrayBufferView, offset: posoffset, vecsize: 3, normalized: false },
		normal: { src: vertexfloat, offset: normaloffset, vecsize: 3, normalized: false },
		color: { src: vertexubyte, offset: coloroffset, vecsize: 4, normalized: true },
		_RA_FLOORTEX_UV0: { src: vertexushort, offset: texuvoffset + 0, vecsize: 2, normalized: true },
		_RA_FLOORTEX_UV1: { src: vertexushort, offset: texuvoffset + 2, vecsize: 2, normalized: true },
		_RA_FLOORTEX_UV2: { src: vertexushort, offset: texuvoffset + 4, vecsize: 2, normalized: true },
		_RA_FLOORTEX_WEIGHTS: { src: vertexubyte, offset: texweightoffset, vecsize: 3, normalized: true },
		_RA_FLOORTEX_USESCOLOR: { src: vertexubyte, offset: texusescoloroffset, vecsize: 3, normalized: true },

		posmax: [maxx, maxy, maxz],
		posmin: [minx, miny, minz],

		extra
	}
}


type FloorMeshData = typeof mapsquareMesh extends (...args: any[]) => infer Q ? Q : never;

function floorToThree(scene: ThreejsSceneCache, floor: FloorMeshData) {
	if (floor.nvertices == 0) { return undefined; }
	let makeAttribute = (attr: FloorMeshData["pos"]) => {
		//TODO typing sucks here
		let buf = new THREE.InterleavedBuffer(attr.src as any, floor.vertexstride / (attr.src as any).BYTES_PER_ELEMENT);
		return new THREE.InterleavedBufferAttribute(buf, attr.vecsize, attr.offset, attr.normalized);
	}
	let geo = new THREE.BufferGeometry();
	//not actually used, remove this
	// geo.index = new THREE.BufferAttribute(floor.indices, 1);
	geo.setAttribute("position", makeAttribute(floor.pos));
	geo.setAttribute("color", makeAttribute(floor.color));
	geo.setAttribute("normal", makeAttribute(floor.normal));
	geo.setAttribute("texcoord_0", makeAttribute(floor._RA_FLOORTEX_UV0));
	geo.setAttribute("texcoord_1", makeAttribute(floor._RA_FLOORTEX_UV1));
	geo.setAttribute("texcoord_2", makeAttribute(floor._RA_FLOORTEX_UV2));
	geo.setAttribute("color_1", makeAttribute(floor._RA_FLOORTEX_WEIGHTS));
	geo.setAttribute("color_2", makeAttribute(floor._RA_FLOORTEX_USESCOLOR));
	let mat = (floor.mode != "worldmap" ? new THREE.MeshPhongMaterial({ shininess: 0 }) : new THREE.MeshBasicMaterial());
	mat.vertexColors = true;
	if (floor.mode == "walkmesh") {
		augmentZOffsetMaterial(mat, 1);
	}
	if (floor.mode == "wireframe") {
		mat.wireframe = true;
	}
	if (floor.atlas) {
		let map = floor.atlas.convertToThreeTexture();
		if (floor.mode == "minimap") {
			if (floor.iswater) {
				mat = minimapWaterMaterial(map) as any;
			} else {
				mat = minimapFloorMaterial(map) as any;
			}
		} else {
			// augmentThreeJsFloorMaterial(mat, floor.mode == "minimap");
			augmentThreeJsFloorMaterial(mat, false);
			mat.map = map;
		}
	}

	let model = new THREE.Mesh(geo, mat);
	model.userData = floor.extra;
	model.name = `floor ${floor.chunk.mapsquarex},${floor.chunk.mapsquarez} (${floor.level})`;
	return model;
}
