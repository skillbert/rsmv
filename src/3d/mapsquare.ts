import { packedHSL2HSL, HSL2RGB, ModelModifications, posmod } from "../utils";
import { cacheConfigPages, cacheMajors, cacheMapFiles, lastClassicBuildnr, lastLegacyBuildnr } from "../constants";
import { parse } from "../opdecoder";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { mapsquare_overlays } from "../../generated/mapsquare_overlays";
import { mapsquare_locations } from "../../generated/mapsquare_locations";
import { ModelMeshData, ModelData } from "./rt7model";
import { mapsquare_tiles } from "../../generated/mapsquare_tiles";
import { mapsquare_watertiles } from "../../generated/mapsquare_watertiles";
import { augmentThreeJsFloorMaterial, ThreejsSceneCache, ob3ModelToThree, EngineCache, ParsedMaterial, applyMaterial } from "./modeltothree";
import { BufferAttribute, DataTexture, Matrix4, MeshBasicMaterial, Object3D, Quaternion, RGBAFormat, Vector3 } from "three";
import { defaultMaterial, materialCacheKey, MaterialData } from "./jmat";
import { objects } from "../../generated/objects";
import { parseSprite } from "./sprite";
import * as THREE from "three";
import { mergeBufferGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { legacyMajors } from "../cache/legacycache";
import { classicModifyTileGrid, getClassicLoc, getClassicMapData } from "./classicmap";
import { MeshBuilder, topdown2dWallModels } from "./modelutils";
import { crc32addInt } from "../scripts/dependencies";
import { CacheFileSource } from "../cache";


export const tiledimensions = 512;
export const rs2ChunkSize = 64;
export const classicChunkSize = 48;
export const squareLevels = 4;
export const worldStride = 128;
const heightScale = 1 / 16;

const upvector = new THREE.Vector3(0, 1, 0);

const defaultVertexProp: TileVertex = { material: -1, materialTiling: 128, color: [255, 0, 255] };

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

export type MeshTileInfo = { tile: mapsquare_tiles["tiles"][number], x: number, z: number, level: number };


export class TileProps {
	raw: mapsquare_tiles["tiles"][number];
	rawOverlay: mapsquare_overlays | undefined;
	rawUnderlay: mapsquare_underlays | undefined;
	next01: TileProps | undefined;
	next10: TileProps | undefined;
	next11: TileProps | undefined;
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
	shape: TileShape;
	visible: boolean;
	normalX: number;
	normalZ: number;
	bleedsOverlayMaterial: boolean;
	//0 botleft,1 botmid,2 leftmid,3 midmi;
	vertexprops: TileVertex[];
	overlayprops: TileVertex;
	originalUnderlayColor: number[];
	underlayprops: TileVertex;
	rawCollision: CollisionData | undefined;
	effectiveCollision: CollisionData | undefined;
	effectiveLevel: number;
	effectiveVisualLevel: number;

	constructor(engine: EngineCache, height: number, tile: mapsquare_tiles["tiles"][number], tilex: number, tilez: number, level: number, docollision: boolean) {
		let visible = false;
		let shape = (tile.shape == undefined ? defaulttileshape : tileshapes[tile.shape]);
		let bleedsOverlayMaterial = false;
		let underlayprop: TileVertex | undefined = undefined;
		let overlayprop: TileVertex | undefined = undefined;
		//TODO bound checks
		let underlay = (tile.underlay != undefined ? engine.mapUnderlays[tile.underlay - 1] : undefined);
		if (underlay) {
			if (underlay.color && (underlay.color[0] != 255 || underlay.color[1] != 0 || underlay.color[2] != 255)) {
				visible = true;
			}
			underlayprop = {
				material: underlay.material ?? -1,
				materialTiling: underlay.material_tiling ?? 128,
				color: underlay.color ?? [255, 0, 255]
			};
		}
		let overlay = (tile.overlay != undefined ? engine.mapOverlays[tile.overlay - 1] : undefined);
		if (overlay) {
			overlayprop = {
				material: overlay.materialbyte ?? overlay.material ?? -1,
				materialTiling: overlay.material_tiling ?? 128,
				color: overlay.color ?? (overlay.materialbyte != null ? [255, 255, 255] : [255, 0, 255])
			};
			bleedsOverlayMaterial = !!overlay.bleedToUnderlay;
		}
		let y = height * tiledimensions * heightScale;
		//need to clone here since its colors will be modified
		underlayprop ??= { ...defaultVertexProp };
		overlayprop ??= { ...defaultVertexProp };
		let collision: CollisionData | undefined = undefined;
		if (docollision) {
			let blocked = ((tile.settings ?? 0) & 1) != 0;
			collision = {
				settings: tile.settings ?? 0,
				walk: [blocked, false, false, false, false, false, false, false, false],
				sight: [false, false, false, false, false, false, false, false, false]
			}
		}
		this.raw = tile;
		this.rawOverlay = overlay;
		this.rawUnderlay = underlay;
		this.next01 = undefined;
		this.next10 = undefined;
		this.next11 = undefined;
		this.x = tilex;
		this.y = y;
		this.z = tilez;
		this.y01 = y; this.y10 = y; this.y11 = y;
		this.playery00 = y, this.playery01 = y; this.playery10 = y; this.playery11 = y;
		this.shape = shape;
		this.visible = visible;
		this.normalX = 0;
		this.normalZ = 0;
		this.bleedsOverlayMaterial = bleedsOverlayMaterial;
		this.vertexprops = [underlayprop, underlayprop, underlayprop, underlayprop];
		this.underlayprops = underlayprop;
		this.overlayprops = overlayprop;
		this.originalUnderlayColor = underlayprop.color;
		this.rawCollision = collision;
		this.effectiveCollision = collision;
		this.effectiveLevel = level;
		this.effectiveVisualLevel = 0
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
			//TODO find out what these are about
			if (shape == 36) { rotation += 1; }
			if (shape == 40) { rotation += 3; }
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

function boxMesh(width: number, length: number, height: number) {
	const steps = 20;
	const ysteps = 5;
	let pos = new Float32Array(4 * 3 * steps * steps * (ysteps + 1));
	let col = new Uint8Array(4 * 3 * steps * steps * (ysteps + 1));
	let index = new Uint16Array(6 * steps * steps * (ysteps + 1));
	let vertexindex = 0;
	let indexoffset = 0;
	for (let yindex = 0; yindex <= ysteps; yindex++) {
		let y = height / ysteps * yindex;
		for (let zindex = 0; zindex < steps; zindex++) {
			let z = -length / 2 + length / steps * zindex;
			for (let xindex = 0; xindex < steps; xindex++) {
				let x = -width / 2 + width / steps * xindex;
				let vertexoffset = vertexindex * 3;
				pos[vertexoffset + 0] = x;
				pos[vertexoffset + 1] = y;
				pos[vertexoffset + 2] = z;

				pos[vertexoffset + 3] = x + width / steps;
				pos[vertexoffset + 4] = y;
				pos[vertexoffset + 5] = z;

				pos[vertexoffset + 6] = x;
				pos[vertexoffset + 7] = y;
				pos[vertexoffset + 8] = z + length / steps;

				pos[vertexoffset + 9] = x + width / steps;
				pos[vertexoffset + 10] = y;
				pos[vertexoffset + 11] = z + length / steps;

				index[indexoffset + 0] = vertexindex + 0;
				index[indexoffset + 1] = vertexindex + 2;
				index[indexoffset + 2] = vertexindex + 1;

				index[indexoffset + 3] = vertexindex + 1;
				index[indexoffset + 4] = vertexindex + 2;
				index[indexoffset + 5] = vertexindex + 3;

				vertexindex += 4;
				indexoffset += 6;
			}
		}
	}
	let r = Math.random() * 255 | 0;
	let g = Math.random() * 255 | 0;
	let b = Math.random() * 255 | 0;
	for (let i = 0; i < col.length; i += 3) { col[i + 0] = r; col[i + 1] = g; col[i + 2] = b; }

	let res: ModelMeshData = {
		attributes: {
			pos: new THREE.BufferAttribute(pos, 3),
			color: new THREE.BufferAttribute(col, 3)
		},
		needsNormalBlending: false,
		indices: new THREE.BufferAttribute(index, 1),
		hasVertexAlpha: false,
		materialId: -1
	}
	return res;
}

export function modifyMesh(mesh: ModelMeshData, mods: ModelModifications) {
	let newmat = mods.replaceMaterials?.find(q => q[0] == mesh.materialId)?.[1];
	let newmesh = { ...mesh };
	if (newmat != undefined) {
		newmesh.materialId = (newmat == (1 << 16) - 1 ? -1 : newmat);
	}

	if (mods.replaceColors && mods.replaceColors.length != 0 && mesh.attributes.color) {
		let colors = mesh.attributes.color;
		let clonedcolors: BufferAttribute | undefined = undefined;

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
		if (clonedcolors) {
			newmesh.attributes = {
				...mesh.attributes,
				color: clonedcolors
			}
		}
	}
	return newmesh;
}

export function transformVertexPositions(pos: BufferAttribute, morph: FloorMorph, grid: TileGrid, modelheight: number, gridoffsetx: number, gridoffsetz: number) {
	let matrix = new THREE.Matrix4()
		.makeTranslation(morph.translate.x - gridoffsetx, morph.translate.y, morph.translate.z - gridoffsetz)
		.multiply(new THREE.Matrix4().makeRotationFromQuaternion(morph.rotation))
		.multiply(new THREE.Matrix4().makeScale(morph.scale.x, morph.scale.y, morph.scale.z));

	let vector = new THREE.Vector3();

	let centery = getTileHeight(grid, (morph.originx) / tiledimensions, (morph.originz) / tiledimensions, morph.level);

	//let ceiling = typeof morph.tiletransform?.scaleModelHeight != "undefined";
	let followfloor = morph.placementMode == "followfloor" || morph.placementMode == "followfloorceiling";
	let followceiling = morph.placementMode == "followfloorceiling";
	let yscale = (followceiling && modelheight > 0 ? 1 / modelheight : 1);

	let newposarray = new Float32Array(pos.count * 3);
	let newpos = new THREE.BufferAttribute(newposarray, 3);
	// const maxdistance = tiledimensions / 2;
	for (let i = 0; i < pos.count; i++) {
		vector.fromBufferAttribute(pos, i);
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
		newpos.setXYZ(i, vector.x, vector.y, vector.z);
	}
	return { newpos, matrix };
}

export function transformMesh(mesh: ModelMeshData, morph: FloorMorph, grid: TileGrid, modelheight: number, gridoffsetx: number, gridoffsetz: number) {
	let { newpos, matrix } = transformVertexPositions(mesh.attributes.pos, morph, grid, modelheight, gridoffsetx, gridoffsetz);

	let vector = new THREE.Vector3();
	let newnorm = mesh.attributes.normals;
	if (mesh.attributes.normals) {
		let matrix3 = new THREE.Matrix3().setFromMatrix4(matrix);
		let norm = mesh.attributes.normals;
		newnorm = mesh.attributes.normals.clone();
		for (let i = 0; i < norm.count; i++) {
			vector.fromBufferAttribute(norm, i);
			vector.applyMatrix3(matrix3);
			newnorm.setXYZ(i, vector.x, vector.y, vector.z);
		}
	}

	let indices = mesh.indices;
	if (matrix.determinant() < 0) {
		//reverse the winding order if the model is mirrored
		let oldindices = indices;
		indices = indices.clone();
		for (let i = 0; i < indices.count; i += 3) {
			indices.setX(i + 0, oldindices.getX(i + 0));
			indices.setX(i + 1, oldindices.getX(i + 2));
			indices.setX(i + 2, oldindices.getX(i + 1));
		}
	}

	let r: ModelMeshData = {
		materialId: mesh.materialId,
		hasVertexAlpha: mesh.hasVertexAlpha,
		needsNormalBlending: mesh.needsNormalBlending,
		indices,
		attributes: {
			...mesh.attributes,
			normals: newnorm,
			pos: newpos
		}
	}
	return r;
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

	//TODO saturate weight to edge in case it's outside bounds
	let w00 = (1 - (x - xfloor)) * (1 - (z - zfloor));
	let w01 = (x - xfloor) * (1 - (z - zfloor));
	let w10 = (1 - (x - xfloor)) * (z - zfloor);
	let w11 = (x - xfloor) * (z - zfloor);
	let tile = grid.getTile(xfloor, zfloor, level);
	//can be empty if the region has gaps
	if (!tile) { return 0; }

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
	blendUnderlays(kernelRadius = 3) {
		for (let z = this.zoffset; z < this.zoffset + this.zsize; z++) {
			for (let x = this.xoffset; x < this.xoffset + this.xsize; x++) {
				let effectiveVisualLevel = 0;
				let layer1tile = this.getTile(x, z, 1);
				let flag2 = ((layer1tile?.raw.settings ?? 0) & 2) != 0;
				let leveloffset = (flag2 ? -1 : 0);

				for (let level = 0; level < this.levels; level++) {
					let currenttile = this.getTile(x, z, level);
					if (!currenttile) { continue; }

					//color blending
					let r = 0, g = 0, b = 0;
					let count = 0;
					//5 deep letsgooooooo
					for (let dz = -kernelRadius; dz <= kernelRadius; dz++) {
						for (let dx = -kernelRadius; dx <= kernelRadius; dx++) {
							let tile = this.getTile(x + dx, z + dz, level);
							if (!tile || !tile.visible) { continue; }
							let col = tile.underlayprops.color;
							r += col[0];
							g += col[1];
							b += col[2];
							count++;
						}
					}
					if (count > 0) {
						currenttile.underlayprops.color = [r / count, g / count, b / count];
					}

					//normals
					let dydx = 0;
					let dydz = 0;
					let xprev = this.getTile(x - 1, z, level);
					let xnext = this.getTile(x + 1, z, level);
					if (xprev && xnext) { dydx = (xnext.y - xprev.y) / (2 * tiledimensions); }
					let zprev = this.getTile(x, z - 1, level);
					let znext = this.getTile(x, z + 1, level);
					if (zprev && znext) { dydz = (znext.y - zprev.y) / (2 * tiledimensions); }
					//cross product of two line connecting adjectent tiles
					//[1,dydx,0]' x [0,dydz,1]' = [dydx,1,dydz]
					let len = Math.hypot(dydx, dydz, 1);
					currenttile.normalZ = dydx / len;
					currenttile.normalX = dydz / len;

					//corners
					let xznext = this.getTile(x + 1, z + 1, level);
					currenttile.y01 = xnext?.y ?? currenttile.y;
					currenttile.y10 = znext?.y ?? currenttile.y;
					currenttile.y11 = xznext?.y ?? currenttile.y;
					//need 4 separate player y's since the y can be non-continuous because of tile flag-2
					currenttile.playery00 = currenttile.y;
					currenttile.playery01 = xnext?.y ?? currenttile.y01;
					currenttile.playery10 = znext?.y ?? currenttile.y10;
					currenttile.playery11 = xznext?.y ?? currenttile.y11;

					currenttile.next01 = xnext;
					currenttile.next10 = znext;
					currenttile.next11 = xznext;

					let alwaysshow = ((currenttile.raw.settings ?? 0) & 8) != 0;

					let effectiveLevel = level + leveloffset;
					//weirdness with flag 2 and 8 related to effective levels
					if (alwaysshow) { effectiveVisualLevel = 0; }

					let effectiveTile = this.getTile(x, z, effectiveLevel);
					let hasroof = ((effectiveTile?.raw.settings ?? 0) & 4) != 0;

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
							if (tile && ((tile.raw.settings ?? 0) & 0x8) == 0) { tile.effectiveVisualLevel = Math.max(tile.effectiveVisualLevel, effectiveVisualLevel); }
						}
					}
					if (hasroof) { effectiveVisualLevel = effectiveLevel + 1; }
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
								node.vertexprops[vertex.subvertex] = currenttile.overlayprops;
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
				}
			}
		}
		return mats;
	}
	addMapsquare(tiles: mapsquare_tiles["tiles"], chunkrect: MapRect, levels: number, docollision = false) {
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
					if (tile.height != undefined) {
						//not sure what the 1=0 thing is about, but seems correct for trees
						height += (tile.height == 1 ? 0 : tile.height);
					} else {
						//TODO this is a guess that sort of fits
						height += 30;
					}
					let newindex = baseoffset + this.xstep * x + this.zstep * z + this.levelstep * level;
					this.tiles[newindex] = new TileProps(this.engine, height, tile, tilex, tilez, level, docollision);
					tileindex += chunkrect.xsize * chunkrect.zsize;
				}
			}
		}
	}
}

export type ParsemapOpts = { padfloor?: boolean, invisibleLayers?: boolean, collision?: boolean, map2d?: boolean, skybox?: boolean, mask?: MapRect[] };
export type ChunkModelData = { floors: FloorMeshData[], models: MapsquareLocation[], overlays: PlacedModel[], chunk: ChunkData, grid: TileGrid };

export async function getMapsquareData(engine: EngineCache, chunkx: number, chunkz: number) {
	let squareSize = (engine.classicData ? classicChunkSize : rs2ChunkSize);
	let squareindex = chunkx + chunkz * worldStride;

	let tiles: mapsquare_tiles["tiles"];
	let tilesextra: mapsquare_tiles["extra"] = {};
	let locs: mapsquare_locations["locations"] = [];
	let tilerect: MapRect;
	let levelcount = squareLevels;
	let filehash = 0;
	let fileversion = 0;

	if (engine.getBuildNr() > lastClassicBuildnr) {
		let tilefile: Buffer | null = null;
		let locsfile: Buffer | null = null;
		if (engine.getBuildNr() >= 759) {
			let mapunderlaymeta = await engine.getCacheIndex(cacheMajors.mapsquares);
			let selfindex = mapunderlaymeta[squareindex];
			if (!selfindex) {
				// console.log(`skipping mapsquare ${rect.x + x} ${rect.z + z} as it does not exist`);
				return null;
			}
			filehash = selfindex.crc;
			fileversion = selfindex.version;
			let selfarchive = await engine.getFileArchive(selfindex);

			let tileindex = selfindex.subindices.indexOf(cacheMapFiles.squares);
			if (tileindex == -1) { return null; }
			tilefile = selfarchive[tileindex].buffer;
			let locsindex = selfindex.subindices.indexOf(cacheMapFiles.locations);
			if (locsindex != -1) {
				locsfile = selfarchive[locsindex].buffer;
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
		extra: tilesextra,
		rawlocs: locs,
		locs: []
	};
	return chunk;
}

export async function parseMapsquare(engine: EngineCache, rect: MapRect, opts?: ParsemapOpts) {
	let chunkfloorpadding = (opts?.padfloor ? 20 : 0);//TODO same as max(blending kernel,max loc size), put this in a const somewhere
	let squareSize = (engine.classicData ? classicChunkSize : rs2ChunkSize);
	let chunkpadding = Math.ceil(chunkfloorpadding / squareSize);
	let grid = new TileGrid(engine, {
		x: rect.x * squareSize - chunkfloorpadding,
		z: rect.z * squareSize - chunkfloorpadding,
		xsize: rect.xsize * squareSize + chunkfloorpadding * 2,
		zsize: rect.zsize * squareSize + chunkfloorpadding * 2
	}, opts?.mask);
	let chunks: ChunkData[] = [];
	for (let z = -chunkpadding; z < rect.zsize + chunkpadding; z++) {
		for (let x = -chunkpadding; x < rect.xsize + chunkpadding; x++) {
			let chunk = await getMapsquareData(engine, rect.x + x, rect.z + z);
			if (!chunk) {
				continue;
			}
			grid.addMapsquare(chunk.tiles, chunk.tilerect, chunk.levelcount, !!opts?.collision);

			//only add the actual ones we need to the queue
			if (chunk.mapsquarex < rect.x || chunk.mapsquarex >= rect.x + rect.xsize) { continue; }
			if (chunk.mapsquarez < rect.z || chunk.mapsquarez >= rect.z + rect.zsize) { continue; }
			chunks.push(chunk);
		}
	}
	if (engine.classicData) {
		classicModifyTileGrid(grid);
	}
	grid.blendUnderlays();
	for (let chunk of chunks) {
		chunk.locs = await mapsquareObjects(engine, grid, chunk.rawlocs, chunk.tilerect.x, chunk.tilerect.z, !!opts?.collision);
	}

	return { grid, chunks };
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

export async function mapsquareModels(scene: ThreejsSceneCache, grid: TileGrid, chunk: ChunkData, opts?: ParsemapOpts) {
	let floors = await mapsquareFloors(scene, grid, chunk, opts);
	let models = mapsquareObjectModels(scene.engine, chunk.locs);
	let overlays = (!opts?.map2d ? [] : await mapsquareOverlays(scene.engine, grid, chunk.locs));
	let r: ChunkModelData = {
		chunk,
		floors,
		models,
		grid,
		overlays
	}
	return r;
}

async function mapsquareFloors(scene: ThreejsSceneCache, grid: TileGrid, chunk: ChunkData, opts?: ParsemapOpts) {
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
	retrysize: for (let size = 256; size <= 4096; size *= 2) {
		atlas = new SimpleTexturePacker(size);
		for (let [id, { tex, repeat }] of textures.entries()) {
			if (!atlas.addTexture(id, tex, repeat)) {
				continue retrysize;
			}
		}
		break;
	}

	for (let level = 0; level < squareLevels; level++) {
		floors.push(mapsquareMesh(grid, chunk, level, atlas, false, true, false));
		if (opts?.map2d) {
			floors.push(mapsquareMesh(grid, chunk, level, atlas, false, false, true));
		}
		if (opts?.invisibleLayers) {
			floors.push(mapsquareMesh(grid, chunk, level, atlas, true));
		}
	}
	return floors
}

export async function mapsquareToThreeSingle(scene: ThreejsSceneCache, grid: TileGrid, chunk: ChunkModelData, placedlocs: PlacedModel[]) {
	let node = new THREE.Group();
	node.matrixAutoUpdate = false;
	node.position.set(chunk.chunk.tilerect.x * tiledimensions, 0, chunk.chunk.tilerect.z * tiledimensions);
	node.updateMatrix();

	let rootx = chunk.chunk.tilerect.x * tiledimensions;
	let rootz = chunk.chunk.tilerect.z * tiledimensions;

	if (placedlocs.length != 0) { node.add(...await Promise.all(placedlocs.map(q => meshgroupsToThree(scene, grid, q, rootx, rootz)))); }
	let chunkoverlays = await Promise.all(chunk.overlays.filter(q => q.models.length != 0).map(q => meshgroupsToThree(scene, grid, q, rootx, rootz)));
	if (chunkoverlays.length != 0) { node.add(...chunkoverlays); }

	let floors = (await Promise.all(chunk.floors.map(f => floorToThree(scene, f)))).filter(q => q) as any;
	if (floors.length != 0) { node.add(...floors); }

	for (let level = 0; level < squareLevels; level++) {
		let boxes = mapsquareCollisionToThree(chunk, level);
		if (boxes) { node.add(boxes); }
		let rawboxes = mapsquareCollisionToThree(chunk, level, true);
		if (rawboxes) { node.add(rawboxes); }
	}
	return node;
}

type CanvasImage = Exclude<CanvasImageSource, SVGImageElement>;
type SimpleTexturePackerAlloc = { u: number, v: number, usize: number, vsize: number, x: number, y: number, repeatWidth: number, repeatHeight: number, img: CanvasImage }

class SimpleTexturePacker {
	padsize = 32;//was still bleeding at 16
	size: number;
	allocs: SimpleTexturePackerAlloc[] = [];
	map = new Map<number, SimpleTexturePackerAlloc>()
	allocx = 0;
	allocy = 0;
	allocLineHeight = 0;
	result: HTMLCanvasElement | null = null;
	constructor(size: number) {
		this.size = size;
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
		if (this.allocx + sizex > this.size) {
			this.allocx = 0;
			this.allocy += this.allocLineHeight;
			this.allocLineHeight = 0;
		}
		this.allocLineHeight = Math.max(this.allocLineHeight, sizey);
		if (this.allocy + this.allocLineHeight > this.size) {
			return false;
		}
		let alloc: SimpleTexturePackerAlloc = {
			u: (this.allocx + this.padsize) / this.size,
			v: (this.allocy + this.padsize) / this.size,
			usize: img.width / this.size,
			vsize: img.height / this.size,
			x: this.allocx + this.padsize,
			y: this.allocy + this.padsize,
			repeatWidth: repeatWidth,
			repeatHeight: repeatHeight,
			img
		};
		this.allocs.push(alloc);
		this.allocx += sizex;
		this.map.set(id, alloc);
		return true;
	}
	convert() {
		if (this.result) { return this.result; }
		let cnv = document.createElement("canvas");
		cnv.width = this.size; cnv.height = this.size;
		let ctx = cnv.getContext("2d", { willReadFrequently: true })!;

		let drawSubimg = (src: CanvasImage, destx: number, desty: number, srcx = 0, srcy = 0, width = src.width, height = src.height) => {
			ctx.drawImage(src, srcx, srcy, width, height, destx, desty, width, height);
		}

		// console.log("floor texatlas imgs", this.allocs.length, "fullness", +((this.allocy + this.allocLineHeight) / this.size).toFixed(2));
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

type PlacedModel = {
	models: PlacedMesh[],
	materialId: number,
	hasVertexAlpha: boolean,
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
	if (source.classicData) {
		let locdata = getClassicLoc(source, id);
		return { rawloc: locdata, morphedloc: locdata };
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
			}
		}
		return { rawloc, morphedloc };
	}
}

async function mapsquareOverlays(engine: EngineCache, grid: TileGrid, locs: WorldLocation[]) {
	let mat = new THREE.MeshBasicMaterial();
	mat.transparent = true;
	mat.depthTest = false;
	let floorgroup = (level: number) => {
		let wallgroup: PlacedModel = {
			models: [],
			groupid: "walls" + level,
			hasVertexAlpha: false,
			materialId: 0,
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
			materialId: 0,
			// material: { mat, matmeta: { ...defaultMaterial(), alphamode: "cutoff" } },
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

function mapsquareObjectModels(cache: CacheFileSource, locs: WorldLocation[]) {
	type CachedLoc = {
		translate: THREE.Vector3,
		rotate: THREE.Quaternion,
		scale: THREE.Vector3,
		mirrored: boolean,
		modelmods: ModelModifications
	}
	let modelcache = new Map<number, CachedLoc>();

	let models: MapsquareLocation[] = [];

	for (let inst of locs) {
		let model = modelcache.get(inst.locid);
		let locmodels: MapsquareLocation["models"] = [];
		let objectmeta = inst.location;
		if (!model) {
			let modelmods: ModelModifications = {
				replaceColors: objectmeta.color_replacements ?? undefined,
				replaceMaterials: objectmeta.material_replacements ?? undefined
			};
			if (cache.getBuildNr() < 337) {
				//old caches just use one prop to replace both somehow
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
			let rotate = new THREE.Quaternion();
			model = {
				rotate,
				scale,
				translate,
				modelmods,
				mirrored: !!objectmeta.mirror
			};
			modelcache.set(inst.locid, model);
		}
		let modelmods = model.modelmods;

		let originx = (inst.x + inst.sizex / 2) * tiledimensions;
		let originz = (inst.z + inst.sizez / 2) * tiledimensions
		let translate = new THREE.Vector3().copy(model.translate);

		let scale = new THREE.Vector3().copy(model.scale);
		let rotation = new THREE.Quaternion().setFromAxisAngle(upvector, inst.rotation / 2 * Math.PI);
		if (inst.rotation % 2 == 1) {
			let tmp = scale.x;
			scale.x = scale.z;
			scale.z = tmp;
		}
		if (model.mirrored) { scale.z *= -1; }
		translate.add(new Vector3(originx, 0, originz));

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
			modelgroup: "objects" + inst.visualLevel,
			locationid: inst.locid,
			worldx: inst.x,
			worldz: inst.z,
			rotation: inst.rotation,
			mirror: !!objectmeta.mirror,
			level: inst.visualLevel,
			locationInstance: inst
		};

		let modelcount = 0;
		let addmodel = (type: number, finalmorph: FloorMorph) => {
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
		if (modelcount == 0) {
			// console.log("model not found for render type", inst.type, objectmeta);
		}
		models.push({ models: locmodels, mods: modelmods, extras: extras });
	}
	return models;
}

export type WorldLocation = {
	x: number,
	z: number,
	type: number,
	rotation: number,
	plane: number,
	locid: number,
	location: objects,
	sizex: number,
	sizez: number,
	placement: mapsquare_locations["locations"][number]["uses"][number]["extra"],
	visualLevel: number,
	effectiveLevel: number
}

export async function mapsquareObjects(engine: EngineCache, grid: TileGrid, locations: mapsquare_locations["locations"], originx: number, originz: number, collision = false) {
	let locs: WorldLocation[] = [];

	//prefetch all loc files
	// locations.map(q => resolveMorphedObject(engine, q.id));

	for (let loc of locations) {
		let { morphedloc, rawloc } = await resolveMorphedObject(engine, loc.id);
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
				placement: inst.extra,
				sizex,
				sizez,
				x: inst.x + originx,
				z: inst.y + originz,
				type: inst.type,
				rotation: inst.rotation,
				plane: inst.plane,
				visualLevel,
				effectiveLevel: callingtile.effectiveLevel
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

function mapsquareCollisionMesh(grid: TileGrid, chunk: ChunkData, level: number, rawmode = false) {
	const maxtriangles = chunk.tilerect.xsize * chunk.tilerect.zsize * 5 * 6 * 2;
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

	let rootx = chunk.tilerect.x * tiledimensions;
	let rootz = chunk.tilerect.z * tiledimensions;

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
	for (let z = chunk.tilerect.z; z < chunk.tilerect.z + chunk.tilerect.zsize; z++) {
		for (let x = chunk.tilerect.x; x < chunk.tilerect.x + chunk.tilerect.xsize; x++) {
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

function mapsquareCollisionToThree(modeldata: ChunkModelData, level: number, rawmode = false) {
	let { color, indices, pos, coloroffset, colorstride, posoffset, posstride, extra } = mapsquareCollisionMesh(modeldata.grid, modeldata.chunk, level, rawmode);

	if (indices.length == 0) { return undefined; }
	let geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(pos, posstride), 3, posoffset, false));
	geo.setAttribute("color", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(color, colorstride), 4, coloroffset, true));
	geo.index = new THREE.BufferAttribute(indices, 1, false);
	let mat = new THREE.MeshPhongMaterial({ shininess: 0 });
	mat.flatShading = true;
	// mat.wireframe = true;
	mat.vertexColors = true;
	let model = new THREE.Mesh(geo, mat);
	model.userData = extra;
	return model;
}

export async function generateLocationMeshgroups(scene: ThreejsSceneCache, locs: MapsquareLocation[]) {
	let loadedmodels = new Map<number, ModelData>();

	let matmeshes: Map<string, Map<number, PlacedModel>> = new Map();
	let byLogical: PlacedMesh[][] = [];

	let loadproms: Promise<any>[] = [];
	for (let loc of locs) {
		for (let model of loc.models) {
			loadproms.push(scene.getModelData(model.model).then(m => loadedmodels.set(model.model, m)));
		}
	}
	await Promise.all(loadproms);

	for (let obj of locs) {
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
				let matkey = materialCacheKey(modified.materialId, modified.hasVertexAlpha);
				let group = matmeshes.get(obj.extras.modelgroup);
				if (!group) {
					group = new Map();
					matmeshes.set(obj.extras.modelgroup, group);
				}
				let matgroup = group.get(matkey);
				if (!matgroup) {
					matgroup = {
						materialId: modified.materialId,
						hasVertexAlpha: modified.hasVertexAlpha,
						models: [],
						groupid: obj.extras.modelgroup,
						overlayIndex: 0
					};
					group.set(matkey, matgroup);
				}
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
			byLogical.push(meshes);
		}
	}
	let byMaterial: PlacedModel[] = [];
	for (let group of matmeshes.values()) {
		byMaterial.push(...group.values());
	}
	return { byMaterial, byLogical };
}

async function meshgroupsToThree(scene: ThreejsSceneCache, grid: TileGrid, meshgroup: PlacedModel, rootx: number, rootz: number) {
	let geos = meshgroup.models.map(m => {
		let transformed = transformMesh(m.model, m.morph, grid, m.maxy - m.miny, rootx, rootz);
		let attrs = transformed.attributes;
		let geo = new THREE.BufferGeometry();
		geo.setAttribute("position", attrs.pos.clone());
		if (attrs.color) { geo.setAttribute("color", attrs.color); }
		if (attrs.normals) { geo.setAttribute("normal", attrs.normals); }
		else {
			//TODO remove this
			// console.log("calculating missing normals");
			geo.computeVertexNormals();
		}
		if (attrs.texuvs) { geo.setAttribute("uv", attrs.texuvs); }
		geo.index = transformed.indices;
		return geo;
	});
	let mergedgeo = mergeBufferGeometries(geos);
	let mesh = new THREE.Mesh(mergedgeo);
	let material = await scene.getMaterial(meshgroup.materialId, meshgroup.hasVertexAlpha);
	applyMaterial(mesh, material);

	let count = 0;
	let counts: number[] = [];
	for (let geo of geos) {
		counts.push(count);
		count += geo.index!.count;
	}
	let clickable: ModelExtras = {
		modeltype: "locationgroup",
		modelgroup: meshgroup.groupid,
		isclickable: true,
		subranges: counts,
		searchPeers: true,
		subobjects: meshgroup.models.map(q => q.extras)
	}
	mesh.renderOrder = meshgroup.overlayIndex;
	mesh.userData = clickable;

	mesh.matrixAutoUpdate = false;
	mesh.updateMatrix();
	return mesh;
}


function mapsquareMesh(grid: TileGrid, chunk: ChunkData, level: number, atlas: SimpleTexturePacker, showhidden: boolean, keeptileinfo = false, worldmap = false) {
	const maxtiles = chunk.tilerect.xsize * chunk.tilerect.zsize * grid.levels;
	const maxVerticesPerTile = 8;
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

		const y = tile.y * w00 + tile.y01 * w01 + tile.y10 * w10 + tile.y11 * w11;
		const normalx = tile.normalX * w00 + (tile.next01 ?? tile).normalX * w01 + (tile.next10 ?? tile).normalX * w10 + (tile.next11 ?? tile).normalX * w11;
		const normalz = tile.normalZ * w00 + (tile.next01 ?? tile).normalZ * w01 + (tile.next10 ?? tile).normalZ * w10 + (tile.next11 ?? tile).normalZ * w11;

		minx = Math.min(minx, x); miny = Math.min(miny, y); minz = Math.min(minz, z);
		maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); maxz = Math.max(maxz, z);
		posbuffer[pospointer + 0] = x;
		posbuffer[pospointer + 1] = y;
		posbuffer[pospointer + 2] = z;
		normalbuffer[normalpointer + 0] = normalx;
		normalbuffer[normalpointer + 1] = Math.sqrt(1 - normalx * normalx - normalz * normalz);
		normalbuffer[normalpointer + 2] = normalz;
		colorbuffer[colpointer + 0] = polyprops[currentmat].color[0];
		colorbuffer[colpointer + 1] = polyprops[currentmat].color[1];
		colorbuffer[colpointer + 2] = polyprops[currentmat].color[2];
		colorbuffer[colpointer + 3] = 255;//4 alpha channel because of gltf

		for (let i = 0; i < 4; i++) {
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
					if (mat.textures.diffuse) {
						texdata = atlas.map.get(mat.textures.diffuse)!;
					}
					//TODO use linear scale here instead of bool
					whitemix = mat.baseColorFraction;
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

				let rawtile = tile.raw;
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
					tileinfos.push({ tile: tile.raw, x, z, level: tilelevel });
					tileindices.push(indexpointer);
				}
				if (hasneighbours && shape.overlay.length != 0) {
					//code is a bit weird here, shouldnt have to call back to the raw overlay props
					let overlaytype = grid.engine.mapOverlays[typeof rawtile.overlay == "number" ? rawtile.overlay - 1 : 0];
					let color = overlaytype.color ?? (typeof overlaytype.materialbyte != "undefined" ? [255, 255, 255] : [255, 0, 255]);
					let isvisible = color[0] != 255 || color[1] != 0 || color[2] != 255;
					if (worldmap && !isvisible && overlaytype.secondary_colour) {
						color = overlaytype.secondary_colour;
						isvisible = true;
					}
					if (isvisible || showhidden) {
						let props: TileVertex[];
						if (!worldmap) {
							props = shape.overlay.map(vertex => {
								if (!overlaytype.bleedToUnderlay) { return tile!.overlayprops; }
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
							props = Array<TileVertex>(shape.overlay.length).fill({
								color,
								material: 0,
								materialTiling: 128
							});
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
				if (hasneighbours && shape.underlay.length != 0 && (tile.visible || showhidden)) {
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
						props = Array<TileVertex>(shape.underlay.length).fill({ color: tile.underlayprops.color, material: 0, materialTiling: 128 });
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

	let extra: ModelExtras = {
		modelgroup: (showhidden ? "floorhidden" : worldmap ? "map" : "floor") + level,
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
		showhidden,
		tileinfos,
		worldmap,

		vertexstride: vertexstride,
		//TODO i'm not actually using these, can get rid of it again
		indices: new Uint32Array(indexslice),
		nvertices: vertexindex,
		atlas,

		pos: { src: vertexfloat as ArrayBufferView, offset: posoffset, vecsize: 3, normalized: false },
		normal: { src: vertexfloat, offset: normaloffset, vecsize: 3, normalized: false },
		color: { src: vertexubyte, offset: coloroffset, vecsize: 4, normalized: true },
		_RA_FLOORTEX_UV01: { src: vertexushort, offset: texuvoffset + 0, vecsize: 4, normalized: true },
		_RA_FLOORTEX_UV23: { src: vertexushort, offset: texuvoffset + 4, vecsize: 4, normalized: true },
		_RA_FLOORTEX_WEIGHTS: { src: vertexubyte, offset: texweightoffset, vecsize: 4, normalized: true },
		_RA_FLOORTEX_USESCOLOR: { src: vertexubyte, offset: texusescoloroffset, vecsize: 4, normalized: true },

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
	geo.setAttribute("_ra_floortex_uv01", makeAttribute(floor._RA_FLOORTEX_UV01));
	geo.setAttribute("_ra_floortex_uv23", makeAttribute(floor._RA_FLOORTEX_UV23));
	geo.setAttribute("_ra_floortex_weights", makeAttribute(floor._RA_FLOORTEX_WEIGHTS));
	geo.setAttribute("_ra_floortex_usescolor", makeAttribute(floor._RA_FLOORTEX_USESCOLOR));
	let mat = (!floor.worldmap ? new THREE.MeshPhongMaterial({ shininess: 0 }) : new THREE.MeshBasicMaterial());
	mat.vertexColors = true;
	if (!floor.showhidden) {
		if (!floor.worldmap) {
			augmentThreeJsFloorMaterial(mat);
			let img = floor.atlas.convert();

			//no clue why this doesn't work
			// mat.map = new THREE.Texture(img);
			// globalThis.bug = mat.map;
			let data = img.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, img.width, img.height);
			mat.map = new THREE.DataTexture(data.data, img.width, img.height, RGBAFormat);

			mat.map.magFilter = THREE.LinearFilter;
			mat.map.minFilter = THREE.LinearMipMapNearestFilter;
			mat.map.generateMipmaps = true;
			mat.map.encoding = THREE.sRGBEncoding;
			mat.map.needsUpdate = true;
		}
	} else {
		mat.wireframe = true;
	}
	let model = new THREE.Mesh(geo, mat);
	model.userData = floor.extra;
	return model;
}
