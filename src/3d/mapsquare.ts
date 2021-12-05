import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { GLTFBuilder } from "./gltf";
import { CacheFileSource, CacheIndex, CacheIndexFile, SubFile } from "../cache";
import { GlTf, MeshPrimitive, Material } from "./gltftype";
import { cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { AttributeSoure, buildAttributeBuffer, glTypeIds } from "./gltfutil";
import { parseMapsquareLocations, parseMapsquareOverlays, parseMapsquareTiles, parseMapsquareUnderlays, parseMapsquareWaterTiles, parseObject } from "../opdecoder";
import { ScanBuffer } from "opcode_reader";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { mapsquare_overlays } from "../../generated/mapsquare_overlays";
import { mapsquare_locations } from "../../generated/mapsquare_locations";
import { addOb3Model, parseOb3Model, GLTFSceneCache, ModelMeshData, ModelData, getMaterialData, MaterialData } from "./ob3togltf";
import { mapsquare_tiles } from "../../generated/mapsquare_tiles";
import { mapsquare_watertiles } from "../../generated/mapsquare_watertiles";
import * as fs from "fs";
import sharp from "sharp";
import { augmentThreeJsFloorMaterial, ThreejsSceneCache, ob3ModelToThree } from "./ob3tothree";
import { BufferAttribute, Object3D, Quaternion, Vector3 } from "three";
import { materialCacheKey } from "./jmat";
import { objects } from "../../generated/objects";

//can't use module import syntax because es6 wants to be more es6 than es6
const THREE = require("three/build/three.js") as typeof import("three");
require("three/examples/js/utils/BufferGeometryUtils");

const upvector = new THREE.Vector3(0, 1, 0);

const tiledimensions = 512;
const squareWidth = 64;
const squareHeight = 64
const squareLevels = 4;
const heightScale = 1 / 16;
const worldStride = 128;

const { tileshapes, defaulttileshape } = generateTileShapes();
const wallmodels = generateWallModels();

const defaultVertexProp: TileVertex = { material: -1, color: [255, 0, 255], usesColor: true };

type CollisionData = {
	settings: number,
	walk: boolean,
	sight: boolean,
	//left,bot,right,top,center
	walkwalls: boolean[],
	sightwalls: boolean[],
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

type TileVertex = {
	material: number,
	color: number[],
	usesColor: boolean
}

export type ChunkData = {
	xoffset: number,
	zoffset: number,
	mapsquarex: number,
	mapsquarez: number,
	tiles: mapsquare_tiles,
	//watertiles: mapsquare_watertiles,
	underlays: mapsquare_underlays[],
	overlays: mapsquare_overlays[],
	archive: SubFile[],
	cacheIndex: CacheIndex
}

export type ClickableMesh<T> = {
	isclickable: true,
	searchPeers: boolean
	subranges: number[],
	subobjects: T[]
}

type ModelExtrasLocation = {
	modeltype: "location",
	isclickable: false,
	modelgroup: string,
	locationid: number,
	worldx: number,
	worldz: number,
	rotation: number,
	mirror: boolean,
	level: number,
	locationInstance: unknown
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

export type MeshTileInfo = { tile: TileProps, x: number, z: number, level: number };

type TileProps = {
	raw: mapsquare_tiles[number],
	rawOverlay: any,
	rawUnderlay: any,
	next01: TileProps | undefined,
	next10: TileProps | undefined,
	next11: TileProps | undefined,
	x: number,
	y: number,
	z: number,
	y10: number,
	y01: number,
	y11: number,
	playery: number,
	shape: TileShape,
	visible: boolean,
	normalX: number,
	normalZ: number,
	bleedsOverlayMaterial: boolean,
	//0 botleft,1 botmid,2 leftmid,3 midmid
	vertexprops: TileVertex[],
	overlayprops: TileVertex,
	originalUnderlayColor: number[],
	underlayprops: TileVertex,
	rawCollision: CollisionData | undefined,
	effectiveCollision: CollisionData | undefined,
	effectiveLevel: number,
	effectiveVisualLevel: number
}

//how much each component adds to the y coord of the vertex
type TileMorph = {
	constant: number,
	//x,y,z
	linear: number[],
	//xy,yz,zx
	quadratic: number[],
	//xyz
	cubic: number
}

type FloorMorph = {
	translate: THREE.Vector3,
	rotation: THREE.Quaternion,
	scale: THREE.Vector3,
	placementMode: "simple" | "followfloor" | "followfloorceiling"
	scaleModelHeightOffset: number,
	level: number
}

function extrudedPolygonMesh(points: { x: number, z: number }[], height: number, color: number[]): ModelMeshData {
	let nvertices = points.length * 4 + points.length * 2;
	let nfaces = points.length + 2;
	let pos = new Float32Array(3 * nvertices);
	let col = new Uint8Array(3 * nvertices);
	for (let a = 0; a < col.length; a += 3) {
		col[a + 0] = color[0]; col[a + 1] = color[1]; col[a + 2] = color[2];
	}
	let indexbuffer = new Uint16Array((nvertices - nfaces) * 3);
	//side faces
	let vertexindex = 0;
	let index = 0;
	let lastpoint = points[points.length - 1];
	//side faces
	for (let a = 0; a < points.length; a++) {
		let point = points[a];
		let firstvertex = vertexindex / 3;
		pos[vertexindex++] = lastpoint.x; pos[vertexindex++] = 0; pos[vertexindex++] = lastpoint.z;
		pos[vertexindex++] = point.x; pos[vertexindex++] = 0; pos[vertexindex++] = point.z;
		pos[vertexindex++] = lastpoint.x; pos[vertexindex++] = height; pos[vertexindex++] = lastpoint.z;
		pos[vertexindex++] = point.x; pos[vertexindex++] = height; pos[vertexindex++] = point.z;

		indexbuffer[index++] = firstvertex; indexbuffer[index++] = firstvertex + 1; indexbuffer[index++] = firstvertex + 3;
		indexbuffer[index++] = firstvertex; indexbuffer[index++] = firstvertex + 3; indexbuffer[index++] = firstvertex + 2;

		lastpoint = point;
	}

	//bottom polygon
	let firstvertex = vertexindex / 3;
	pos[vertexindex++] = points[0].x; pos[vertexindex++] = 0; pos[vertexindex++] = points[0].z;
	let lastvertex = vertexindex / 3;
	pos[vertexindex++] = points[points.length - 1].x; pos[vertexindex++] = 0; pos[vertexindex++] = points[points.length - 1].z;
	for (let a = points.length - 2; a >= 1; a--) {
		let vertex = vertexindex / 3;
		pos[vertexindex++] = points[a].x; pos[vertexindex++] = 0; pos[vertexindex++] = points[a].z;
		indexbuffer[index++] = firstvertex; indexbuffer[index++] = lastvertex; indexbuffer[index++] = vertex;
		lastvertex = vertex
	}
	//top polygon
	firstvertex = vertexindex / 3;
	pos[vertexindex++] = points[0].x; pos[vertexindex++] = height; pos[vertexindex++] = points[0].z;
	lastvertex = vertexindex / 3;
	pos[vertexindex++] = points[1].x; pos[vertexindex++] = height; pos[vertexindex++] = points[1].z;
	for (let a = 2; a < points.length; a++) {
		let vertex = vertexindex / 3;
		pos[vertexindex++] = points[a].x; pos[vertexindex++] = height; pos[vertexindex++] = points[a].z;
		indexbuffer[index++] = firstvertex; indexbuffer[index++] = lastvertex; indexbuffer[index++] = vertex;
		lastvertex = vertex
	}

	return {
		attributes: {
			pos: new THREE.BufferAttribute(pos, 3, false),
			color: new THREE.BufferAttribute(col, 3, true)
		},
		indices: new THREE.BufferAttribute(indexbuffer, 1, false),
		hasVertexAlpha: false,
		materialId: -1
	}
}

function generateWallModels() {
	const thick = tiledimensions / 8;
	const height = tiledimensions * 1.5;
	const white = [255, 255, 255];
	const red = [255, 0, 0];
	const halftile = tiledimensions / 2;
	return {
		wall: {
			maxy: height,
			miny: 0,
			meshes: [extrudedPolygonMesh([
				{ x: -halftile, z: -halftile },
				{ x: -halftile, z: halftile },
				{ x: -halftile + thick, z: halftile },
				{ x: -halftile + thick, z: -halftile }
			], height, white)]
		} as ModelData,
		shortcorner: {
			maxy: height,
			miny: 0,
			meshes: [extrudedPolygonMesh([
				{ x: -halftile, z: halftile },
				{ x: -halftile + thick, z: halftile },
				{ x: -halftile + thick, z: halftile - thick },
				{ x: -halftile, z: halftile - thick }
			], height, white)]
		} as ModelData,
		longcorner: {
			maxy: height,
			miny: 0,
			meshes: [extrudedPolygonMesh([
				{ x: -halftile + thick, z: halftile - thick },
				{ x: -halftile + thick, z: -halftile },
				{ x: -halftile, z: -halftile },
				{ x: -halftile, z: halftile },
				{ x: halftile, z: halftile },
				{ x: halftile, z: halftile - thick },
			], height, white)]
		} as ModelData,
		pillar: {
			maxy: height,
			miny: 0,
			meshes: [extrudedPolygonMesh([
				{ x: -halftile, z: halftile },
				{ x: -halftile + thick, z: halftile },
				{ x: -halftile + thick, z: halftile - thick },
				{ x: -halftile, z: halftile - thick }
			], height, white)]
		} as ModelData,
		diagonal: {
			maxy: height,
			miny: 0,
			meshes: [extrudedPolygonMesh([
				{ x: -halftile, z: -halftile },
				{ x: -halftile, z: -halftile + thick },
				{ x: halftile - thick, z: halftile },
				{ x: halftile, z: halftile },
				{ x: halftile, z: halftile - thick },
				{ x: -halftile + thick, z: -halftile },
			], height, white)]
		} as ModelData,
	}
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
	return { tileshapes, defaulttileshape };
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
		indices: new THREE.BufferAttribute(index, 1),
		hasVertexAlpha: false,
		materialId: -1
	}
	return res;
}

export function modifyMesh(mesh: ModelMeshData, mods: ModelModifications) {
	let newmat = mods.replaceMaterials?.find(q => q[0] == mesh.materialId)?.[1];
	let newmesh = { ...mesh };
	if (typeof newmat != "undefined") {
		newmesh.materialId = (newmat == (1 << 16) - 1 ? -1 : newmat);
	}

	if (mods.replaceColors && mesh.attributes.color) {
		let colors = mesh.attributes.color;
		let clonedcolors: BufferAttribute | undefined = undefined;

		let map: [number, [number, number, number]][] = [];
		for (let repl of mods.replaceColors) {
			let oldcol = HSL2RGB(packedHSL2HSL(repl[0]));
			let newcol = HSL2RGB(packedHSL2HSL(repl[1]));
			map.push([(oldcol[0] << 16) | (oldcol[1] << 8) | oldcol[2], newcol]);
		}

		for (let i = 0; i < colors.count; i++) {
			let key = (colors.getX(i) << 16) | (colors.getY(i) << 8) | colors.getZ(i);
			for (let repl of map) {
				if (key == repl[0]) {
					if (!clonedcolors) {
						clonedcolors = colors.clone();
					}
					clonedcolors.setXYZ(i, ...repl[1]);
					break;
				}
			}
		}
		if (clonedcolors) {
			newmesh.attributes.color = clonedcolors;
		}
	}
	return newmesh;
}

export function transformMesh(mesh: ModelMeshData, morph: FloorMorph, grid: TileGrid, modelheight: number, rootx: number, rootz: number) {
	let matrix = new THREE.Matrix4()
		.makeTranslation(morph.translate.x - rootx, morph.translate.y, morph.translate.z - rootz)
		.multiply(new THREE.Matrix4().makeRotationFromQuaternion(morph.rotation))
		.multiply(new THREE.Matrix4().makeScale(morph.scale.x, morph.scale.y, morph.scale.z));
	let vector = new THREE.Vector3();

	let gridoffsetx = rootx;
	let gridoffsetz = rootz;
	let origin = new Vector3().applyMatrix4(matrix);
	let centery = grid.getHeight((origin.x + gridoffsetx) / tiledimensions, (origin.z + gridoffsetz) / tiledimensions, morph.level);

	let pos = mesh.attributes.pos;
	if (mesh.attributes.pos.itemSize != 3) {
		throw new Error("unexpected mesh pos type during model transform");
	}

	//let ceiling = typeof morph.tiletransform?.scaleModelHeight != "undefined";
	let followfloor = morph.placementMode == "followfloor" || morph.placementMode == "followfloorceiling";
	let followceiling = morph.placementMode == "followfloorceiling";
	let yscale = (followceiling && modelheight > 0 ? 1 / (modelheight + morph.scaleModelHeightOffset) : 1);

	//TODO get this as argument instead
	//needs to be cast to float since int16 overflows
	let newposarray = new Float32Array(mesh.attributes.pos.count * 3);
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
				let floory = grid.getHeight(gridx, gridz, morph.level);
				let ceily = grid.getHeight(gridx, gridz, morph.level + 1);
				vector.y += -vertexy + ceily * wceiling + floory * (1 - wceiling);
			} else {
				vector.y += grid.getHeight(gridx, gridz, morph.level);
			}
		} else {
			vector.y += centery;
		}
		newpos.setXYZ(i, vector.x, vector.y, vector.z);
	}
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
		indices,
		attributes: {
			...mesh.attributes,
			normals: newnorm,
			pos: newpos
		}
	}
	return r;
}

export class TileGrid {
	//position and size of this grid measure in mapsquares
	gridx: number;
	gridz: number;
	width: number;
	height: number;
	//position of this grid measured in tiles
	xoffset: number;
	zoffset: number;
	//properties of the southwest corner of each tile
	tiles: TileProps[];
	//array indices offset per move in each direction
	xstep: number;
	zstep: number;
	levelstep: number;
	constructor(gridx: number, gridz: number, gridwidth: number, gridheight: number) {
		this.gridx = gridx;
		this.gridz = gridz;
		this.xoffset = gridx * squareWidth;
		this.zoffset = gridz * squareHeight;
		this.width = gridwidth * squareWidth;
		this.height = gridheight * squareHeight;
		this.xstep = 1;
		this.zstep = this.xstep * gridwidth * squareWidth;
		this.levelstep = this.zstep * gridheight * squareHeight;
		this.tiles = [];
	}

	getHeightFile(x: number, z: number, level: number, xsize: number, zsize: number) {
		let file = new Uint16Array(xsize * zsize * squareLevels);
		for (let dz = 0; dz < zsize; dz++) {
			for (let dx = 0; dx < xsize; dx++) {
				let tile = this.getTile(x + dx, z + dz, level);
				if (tile) {
					let index = dx + dz * xsize;
					file[index] = tile.playery / 16;
				}
			}
		}
		return file;
	}

	getHeight(x: number, z: number, level: number) {
		let xfloor = Math.floor(x);
		let zfloor = Math.floor(z);
		let x0 = Math.max(this.xoffset, Math.min(this.xoffset + this.width - 1, xfloor));
		let z0 = Math.max(this.zoffset, Math.min(this.zoffset + this.height - 1, zfloor));

		//TODO saturate weight to edge in case it's outside bounds
		let w00 = (1 - (x - xfloor)) * (1 - (z - zfloor));
		let w01 = (x - xfloor) * (1 - (z - zfloor));
		let w10 = (1 - (x - xfloor)) * (z - zfloor);
		let w11 = (x - xfloor) * (z - zfloor);

		let tile = this.getTile(x0, z0, level)!;

		return tile.y * w00 + tile.y01 * w01 + tile.y10 * w10 + tile.y11 * w11;
	}
	getTile(x: number, z: number, level: number) {
		x -= this.xoffset;
		z -= this.zoffset;
		if (x < 0 || z < 0 || x >= this.width || z >= this.height) { return undefined; }
		return this.tiles[this.levelstep * level + z * this.zstep + x * this.xstep];
	}
	blendUnderlays(kernelRadius = 3) {
		for (let z = this.zoffset; z < this.zoffset + this.height; z++) {
			for (let x = this.xoffset; x < this.xoffset + this.width; x++) {
				let effectiveLevel = -1;
				let effectiveVisualLevel = 0;
				for (let level = 0; level < squareLevels; level++) {
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
					currenttile.playery = (currenttile.y + currenttile.y01 + currenttile.y10 + currenttile.y11) / 4;

					currenttile.next01 = xnext;
					currenttile.next10 = znext;
					currenttile.next11 = xznext;

					let mergeunder = ((currenttile.raw.settings ?? 0) & 2) != 0;
					let alwaysshow = ((currenttile.raw.settings ?? 0) & 8) != 0;

					//weirdness with flag 2 and 8 related to effective levels
					if (!mergeunder) { effectiveLevel++; }
					if (alwaysshow) { effectiveVisualLevel = 0; }
					effectiveLevel = Math.max(0, effectiveLevel);

					let effectiveTile = this.getTile(x, z, effectiveLevel)!;
					let hasroof = ((effectiveTile.raw.settings ?? 0) & 4) != 0;

					if (effectiveLevel != level) {
						let receivingtile = this.getTile(x, z, effectiveLevel)!;
						receivingtile.effectiveCollision = currenttile.rawCollision;
						receivingtile.playery = currenttile.playery;
					}
					currenttile.effectiveLevel = effectiveLevel;
					currenttile.effectiveVisualLevel = Math.max(currenttile.effectiveVisualLevel, effectiveVisualLevel);

					//spread to our neighbours
					//there is a lot more to it than this but it gives decent results
					if (xnext && ((xnext.raw.settings ?? 0) & 0x8) == 0) { xnext.effectiveVisualLevel = Math.max(xnext.effectiveVisualLevel, effectiveVisualLevel); }
					if (znext && ((znext.raw.settings ?? 0) & 0x8) == 0) { znext.effectiveVisualLevel = Math.max(znext.effectiveVisualLevel, effectiveVisualLevel); }
					if (xprev && ((xprev.raw.settings ?? 0) & 0x8) == 0) { xprev.effectiveVisualLevel = Math.max(xprev.effectiveVisualLevel, effectiveVisualLevel); }
					if (zprev && ((zprev.raw.settings ?? 0) & 0x8) == 0) { zprev.effectiveVisualLevel = Math.max(zprev.effectiveVisualLevel, effectiveVisualLevel); }

					if (hasroof) { effectiveVisualLevel = effectiveLevel + 1; }
				}
			}
		}

		for (let z = this.zoffset; z < this.zoffset + this.height; z++) {
			for (let x = this.xoffset; x < this.xoffset + this.width; x++) {
				for (let level = 0; level < squareLevels; level++) {
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
		let mats = new Set<number>();
		for (let level = 0; level < squareLevels; level++) {
			for (let dz = 0; dz < zsize; dz++) {
				for (let dx = 0; dx < xsize; dx++) {
					let tile = this.getTile(x + dx, z + dz, level);
					if (!tile) { continue; }
					//TODO skip 0/-1 values?
					mats.add(tile.underlayprops.material ?? -1);
					mats.add(tile.overlayprops.material ?? -1);
				}
			}
		}
		return mats;
	}
	addMapsquare(chunk: ChunkData, docollision = false) {
		const tiles = chunk.tiles;
		if (tiles.length != squareWidth * squareHeight * squareLevels) { throw new Error(); }
		let baseoffset = (chunk.xoffset - this.xoffset) * this.xstep + (chunk.zoffset - this.zoffset) * this.zstep;
		for (let z = 0; z < squareHeight; z++) {
			for (let x = 0; x < squareWidth; x++) {
				let tileindex = z + x * squareHeight;//TODO are these flipped
				let tilex = (chunk.xoffset + x) * tiledimensions;
				let tilez = (chunk.zoffset + z) * tiledimensions;
				let height = 0;
				for (let level = 0; level < squareLevels; level++) {
					let tile = tiles[tileindex];
					if (typeof tile.height != "undefined") {
						height += tile.height;
					} else {
						//TODO this is a guess that sort of fits
						height += 30;
					}
					let visible = false;
					let shape = (typeof tile.shape == "undefined" ? defaulttileshape : tileshapes[tile.shape]);
					let bleedsOverlayMaterial = false;
					let underlayprop: TileVertex | undefined = undefined;
					let overlayprop: TileVertex | undefined = undefined;
					//TODO bound checks
					let underlay = (typeof tile.underlay != "undefined" ? chunk.underlays[tile.underlay - 1] : undefined);
					if (underlay) {
						if (underlay.color && (underlay.color[0] != 255 || underlay.color[1] != 0 || underlay.color[2] != 255)) {
							visible = true;
						}
						underlayprop = { material: underlay.material ?? 0, color: underlay.color ?? [255, 0, 255], usesColor: !underlay.unknown_0x04 };
					}
					let overlay = (typeof tile.overlay != "undefined" ? chunk.overlays[tile.overlay - 1] : undefined);
					if (overlay) {
						overlayprop = { material: overlay.material ?? 0, color: overlay.primary_colour ?? [255, 0, 255], usesColor: !overlay.unknown_0x0A };
						bleedsOverlayMaterial = !!overlay.bleedToUnderlay;
					}
					let newindex = baseoffset + this.xstep * x + this.zstep * z + this.levelstep * level;
					//let newindex = this.levelstep * level + (z + chunk.zoffset - this.zoffset) * this.zstep + (x + chunk.xoffset - this.xoffset) * this.xstep
					let y = height * tiledimensions * heightScale;
					//need to clone here since its colors will be modified
					underlayprop ??= { ...defaultVertexProp };
					overlayprop ??= { ...defaultVertexProp };
					let collision: CollisionData | undefined = undefined;
					if (docollision) {
						let blocked = ((tile.settings ?? 0) & 1) != 0;
						collision = {
							settings: tile.settings ?? 0,
							walk: blocked,
							sight: false,
							walkwalls: [false, false, false, false],
							sightwalls: [false, false, false, false]
						}
					}
					let parsedTile: TileProps = {
						raw: tile,
						rawOverlay: overlay,
						rawUnderlay: underlay,
						next01: undefined,
						next10: undefined,
						next11: undefined,
						x: tilex,
						y: y,
						z: tilez,
						y01: y, y10: y, y11: y,
						playery: y,
						shape,
						visible,
						normalX: 0, normalZ: 0,
						bleedsOverlayMaterial,
						vertexprops: [underlayprop, underlayprop, underlayprop, underlayprop],
						underlayprops: underlayprop,
						overlayprops: overlayprop,
						originalUnderlayColor: underlayprop.color,
						rawCollision: collision,
						effectiveCollision: collision,
						effectiveLevel: level,
						effectiveVisualLevel: 0
					}
					this.tiles[newindex] = parsedTile;
					tileindex += squareWidth * squareHeight;
				}
			}
		}
	}
}

export type ParsemapOpts = { centered?: boolean, padfloor?: boolean, invisibleLayers?: boolean, collision?: boolean };
type ChunkModelData = { floors: FloorMeshData[], models: MapsquareLocation[], overlays: PlacedModel[], chunk: ChunkData, grid: TileGrid };

export async function mapConfigData(source: CacheFileSource) {
	//TODO proper erroring on nulls
	let configunderlaymeta = await source.getIndexFile(cacheMajors.config);
	let underarch = await source.getFileArchive(configunderlaymeta[1]);
	let underlays = underarch.map(q => parseMapsquareUnderlays.read(q.buffer));
	let overlays = (await source.getFileArchive(configunderlaymeta[4]))
		.map(q => parseMapsquareOverlays.read(q.buffer));
	return { underlays, overlays };
}

export async function parseMapsquare(source: CacheFileSource, rect: { x: number, y: number, width: number, height: number }, opts?: ParsemapOpts) {

	let { underlays, overlays } = await mapConfigData(source);

	//TODO implement this again
	let originx = (opts?.centered ? (rect.x + rect.width / 2) * tiledimensions * squareWidth : 0);
	let originz = (opts?.centered ? (rect.y + rect.height / 2) * tiledimensions * squareHeight : 0);

	let chunkfloorpadding = (opts?.padfloor ? 1 : 0);
	let grid = new TileGrid(rect.x - chunkfloorpadding, rect.y - chunkfloorpadding, rect.width + chunkfloorpadding * 2, rect.height + chunkfloorpadding * 2);
	let chunks: ChunkData[] = [];
	for (let z = -chunkfloorpadding; z < rect.height + chunkfloorpadding; z++) {
		for (let x = -chunkfloorpadding; x < rect.width + chunkfloorpadding; x++) {
			let squareindex = (rect.x + x) + (rect.y + z) * worldStride;
			let mapunderlaymeta = await source.getIndexFile(cacheMajors.mapsquares);
			let selfindex = mapunderlaymeta[squareindex];
			if (!selfindex) {
				console.log(`skipping mapsquare ${rect.x + x} ${rect.y + z} as it does not exist`);
				continue;
			}
			let selfarchive = (await source.getFileArchive(selfindex));
			let tileindex = selfindex.subindices.indexOf(3);
			let tileindexwater = selfindex.subindices.indexOf(4);

			if (tileindex == -1) {
				console.log(`skipping mapsquare ${rect.x + x} ${rect.y + z} as it has no tiles`);
				continue;
			}
			let tilefile = selfarchive[tileindex].buffer;
			//let watertilefile = selfarchive[tileindexwater]?.buffer;
			//let watertiles = parseMapsquareWaterTiles.read(watertilefile);
			let tiles = parseMapsquareTiles.read(tilefile);
			let chunk: ChunkData = {
				xoffset: (rect.x + x) * squareWidth,
				zoffset: (rect.y + z) * squareHeight,
				mapsquarex: rect.x + x,
				mapsquarez: rect.y + z,
				tiles, underlays, overlays, cacheIndex: selfindex, archive: selfarchive
			};
			grid.addMapsquare(chunk, !!opts?.collision);

			//only add the actual ones we need to the queue
			if (chunk.mapsquarex < rect.x || chunk.mapsquarex >= rect.x + rect.width) { continue; }
			if (chunk.mapsquarez < rect.y || chunk.mapsquarez >= rect.y + rect.height) { continue; }
			chunks.push(chunk);
		}
	}

	grid.blendUnderlays();
	return { grid, chunks };
}

export async function mapsquareModels(source: CacheFileSource, grid: TileGrid, chunks: ChunkData[], opts?: ParsemapOpts) {
	let squareDatas: ChunkModelData[] = [];

	for (let chunk of chunks) {
		let floors: FloorMeshData[] = [];
		let matids = grid.gatherMaterials(chunk.xoffset, chunk.zoffset, squareWidth + 1, squareHeight + 1);
		let materials = new Map<number, MaterialData>();
		let materialproms: Promise<any>[] = [];
		for (let matid of matids) {
			materialproms.push(getMaterialData(source.getFileById.bind(source), matid).then(mat => materials.set(matid, mat)));
		}
		await Promise.all(materialproms);
		let textures = new Map<number, ImageData>();
		let textureproms: Promise<void>[] = [];
		for (let mat of materials.values()) {
			if (mat.textures.diffuse) {
				textureproms.push(
					source.getFileById(cacheMajors.texturesDds, mat.textures.diffuse)
						.then(file => new ParsedTexture(file, false).toImageData())
						.then(tex => { textures.set(mat.textures.diffuse!, tex); })
				);
			}
		}
		await Promise.all(textureproms);
		let atlas!: SimpleTexturePacker;
		retrysize: for (let size = 1024; size <= 4096; size *= 2) {
			atlas = new SimpleTexturePacker(size);
			for (let [id, tex] of textures.entries()) {
				try {
					atlas.addTexture(tex, id);
				} catch (e) {
					continue retrysize;
				}
			}
			break;
		}

		for (let level = 0; level < squareLevels; level++) {
			floors.push(await mapsquareMesh(grid, chunk, level, materials, atlas, false, true));//TODO remove keeptileinfo last arg
		}
		if (opts?.invisibleLayers) {
			for (let level = 0; level < squareLevels; level++) {
				floors.push(await mapsquareMesh(grid, chunk, level, materials, atlas, true));
			}
		}
		let { locs, walls } = await mapsquareObjects(source, chunk, grid, !!opts?.collision);
		let models = await mapsquareObjectModels(locs);
		squareDatas.push({
			chunk,
			floors,
			models,
			grid,
			overlays: [...walls]
		});
	}
	return squareDatas;
}

export async function mapsquareToThree(source: CacheFileSource, grid: TileGrid, chunks: ChunkModelData[]) {
	let scene = new ThreejsSceneCache(source.getFileById.bind(source));
	let root = new THREE.Group();

	for (let chunk of chunks) {
		let node = new THREE.Group();
		node.matrixAutoUpdate = false;
		node.position.set(chunk.chunk.xoffset * tiledimensions, 0, chunk.chunk.zoffset * tiledimensions);
		node.updateMatrix();
		let models = await generateLocationMeshgroups(scene, chunk.models);

		let rootx = chunk.chunk.xoffset * tiledimensions;
		let rootz = chunk.chunk.zoffset * tiledimensions;
		node.add(...models.map(q => meshgroupsToThree(grid, q, rootx, rootz)));

		node.add(... (await Promise.all(chunk.floors.map(f => floorToThree(scene, f)))).filter(q => q) as any);
		for (let level = 0; level < squareLevels; level++) {
			let boxes = mapsquareCollisionToThree(chunk, level);
			if (boxes) { node.add(boxes); }
		}
		root.add(node);
	}

	root.scale.set(1, 1, -1);
	return root;
}

function copyImageData(dest: ImageData, src: ImageData, destx: number, desty: number, srcx = 0, srcy = 0, width?: number, height?: number) {
	const targetStride = 4 * dest.width;
	const srcStride = 4 * src.width;
	const targetdata = dest.data;
	const srcdata = src.data;
	if (typeof width == "undefined") { width = src.width; }
	if (typeof height == "undefined") { height = src.height; }
	for (let dy = 0; dy < height; dy++) {
		for (let dx = 0; dx < width; dx++) {
			let isrc = (dx + srcx) * 4 + (dy + srcy) * srcStride;
			let itarget = (dx + destx) * 4 + (dy + desty) * targetStride;
			targetdata[itarget + 0] = srcdata[isrc + 0];
			targetdata[itarget + 1] = srcdata[isrc + 1];
			targetdata[itarget + 2] = srcdata[isrc + 2];
			targetdata[itarget + 3] = srcdata[isrc + 3];
		}
	}
}

type SimpleTexturePackerAlloc = { u: number, v: number, usize: number, vsize: number, x: number, y: number, img: ImageData }

class SimpleTexturePacker {
	padsize = 32;//was still bleeding at 16
	size: number;
	allocs: SimpleTexturePackerAlloc[] = [];
	map = new Map<number, SimpleTexturePackerAlloc>()
	allocx = 0;
	allocy = 0;
	allocLineHeight = 0;
	constructor(size: number) {
		this.size = size;
	}

	addTexture(img: ImageData, id: number) {
		let sizex = img.width + 2 * this.padsize;
		let sizey = img.height + 2 * this.padsize;
		if (this.allocx + sizex > this.size) {
			this.allocx = 0;
			this.allocy += this.allocLineHeight;
			this.allocLineHeight = 0;
		}
		this.allocLineHeight = Math.max(this.allocLineHeight, sizey);
		if (this.allocy + this.allocLineHeight > this.size) {
			throw new Error("atlas is full");
		}
		let alloc: SimpleTexturePackerAlloc = {
			u: (this.allocx + this.padsize) / this.size, v: (this.allocy + this.padsize) / this.size,
			usize: img.width / this.size, vsize: img.height / this.size,
			x: this.allocx + this.padsize, y: this.allocy + this.padsize,
			img
		};
		this.allocs.push(alloc);
		this.allocx += sizex;
		if (typeof id != "undefined") {
			this.map.set(id, alloc);
		}
		return alloc;
	}
	convert() {
		let atlas = new ImageData(this.size, this.size);
		console.log("floor texatlas imgs", this.allocs.length, "fullness", +((this.allocy + this.allocLineHeight) / this.size).toFixed(2));
		for (let alloc of this.allocs) {
			const x0 = alloc.x - this.padsize;
			const x1 = alloc.x;
			const x2 = alloc.x + alloc.img.width;
			const y0 = alloc.y - this.padsize;
			const y1 = alloc.y;
			const y2 = alloc.y + alloc.img.height;
			//YIKES
			copyImageData(atlas, alloc.img, x0, y0, alloc.img.width - this.padsize, alloc.img.height - this.padsize, this.padsize, this.padsize);
			copyImageData(atlas, alloc.img, x1, y0, 0, alloc.img.height - this.padsize, alloc.img.width, this.padsize);
			copyImageData(atlas, alloc.img, x2, y0, 0, alloc.img.height - this.padsize, this.padsize, this.padsize);

			copyImageData(atlas, alloc.img, x0, y1, alloc.img.width - this.padsize, 0, this.padsize, alloc.img.height);
			copyImageData(atlas, alloc.img, x1, y1, 0, 0, alloc.img.width, alloc.img.height);
			copyImageData(atlas, alloc.img, x2, y1, 0, 0, this.padsize, alloc.img.height);

			copyImageData(atlas, alloc.img, x0, y2, alloc.img.width - this.padsize, 0, this.padsize, this.padsize);
			copyImageData(atlas, alloc.img, x1, y2, 0, 0, alloc.img.width, this.padsize);
			copyImageData(atlas, alloc.img, x2, y2, 0, 0, this.padsize, this.padsize);
		}
		return atlas;
	}
}

type PlacedModel = {
	models: { model: ModelMeshData, maxy: number, miny: number, morph: FloorMorph, extras: ModelExtrasLocation | ModelExtrasOverlay }[],
	material: THREE.Material,
	overlayIndex: number,
	groupid: string
}

type MapsquareLocation = {
	modelid: number,
	morph: FloorMorph,
	mods: ModelModifications,
	extras: ModelExtrasLocation
}

//TODO move this to a more logical location
export async function resolveMorphedObject(source: CacheFileSource, id: number) {
	let objectfile = await source.getFileById(cacheMajors.objects, id);
	let objectmeta = parseObject.read(objectfile);
	if (objectmeta.morphs_1 || objectmeta.morphs_2) {
		let newid = -1;
		if (objectmeta.morphs_1) { newid = objectmeta.morphs_1.unk2[0] ?? objectmeta.morphs_1.unk3; }
		if (objectmeta.morphs_2) { newid = objectmeta.morphs_2.unk2; }
		if (newid == (1 << 15) - 1) {
			return undefined;
		}
		if (newid != -1) {
			objectfile = await source.getFileById(cacheMajors.objects, newid);
			objectmeta = {
				...objectmeta,
				...parseObject.read(objectfile)
			};
		}
	}
	return objectmeta;
}

async function mapsquareObjectModels(locs: WorldLocation[]) {
	type CachedLoc = {
		translate: THREE.Vector3,
		rotate: THREE.Quaternion,
		scale: THREE.Vector3,
		modelmods: ModelModifications
	}
	let modelcache = new Map<number, CachedLoc>();

	let models: MapsquareLocation[] = [];

	for (let inst of locs) {
		let model = modelcache.get(inst.locid);
		let objectmeta = inst.location;
		if (!model) {
			let modelmods: ModelModifications = {
				replaceColors: objectmeta.color_replacements,
				replaceMaterials: objectmeta.material_replacements
			};
			const translatefactor = 4;//no clue why but seems right
			let translate = new Vector3().set(
				(objectmeta.translateX ?? 0) * translatefactor,
				-(objectmeta.translateY ?? 0) * translatefactor,//minus y!!!
				(objectmeta.translateZ ?? 0) * translatefactor
			);
			const scalefactor = 1 / 128;//estimated fit was 127.5 ...
			let scale = new Vector3().set(
				(objectmeta.scaleX ?? 128) * scalefactor,
				(objectmeta.scaleY ?? 128) * scalefactor,
				(objectmeta.scaleZ ?? 128) * scalefactor
			);
			if (objectmeta.mirror) {
				scale.multiply(new Vector3().set(1, 1, -1));
			}
			let rotate = new THREE.Quaternion();
			model = {
				rotate,
				scale,
				translate,
				modelmods
			};
			modelcache.set(inst.locid, model);
		}
		let modelmods = model.modelmods;

		let translate = new THREE.Vector3().set(
			(inst.x + inst.sizex / 2) * tiledimensions,//- rootx,
			0,//modely,
			(inst.z + inst.sizez / 2) * tiledimensions// - rootz
		).add(model.translate);

		let scale = new THREE.Vector3().copy(model.scale);
		let rotation = new THREE.Quaternion().setFromAxisAngle(upvector, inst.rotation / 2 * Math.PI);

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
			scaleModelHeightOffset: objectmeta.probably_morphCeilingOffset ?? 0
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
			for (let ch of objectmeta!.models ?? []) {
				if (ch.type != type) { continue; }
				modelcount++;
				for (let modelid of ch.values) {
					models.push({ extras, modelid, morph: finalmorph, mods: modelmods });
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
			addmodel(10, { ...morph, rotation: new Quaternion().setFromAxisAngle(upvector, Math.PI / 4).premultiply(morph.rotation) });
		} else if (inst.type == 8 || inst.type == 7 || inst.type == 6) {
			if (inst.type == 6 || inst.type == 8) {
				let dx = tiledimensions * 0.6;
				let angle = Math.PI / 4;
				let rotation = morph.rotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(upvector, angle));
				addmodel(4, {
					...morph,
					rotation,
					translate: morph.translate.clone().add(new THREE.Vector3().set(dx, 0, 0).applyQuaternion(rotation))
				});
			}
			if (inst.type == 7 || inst.type == 8) {
				let dx = tiledimensions * 0.5;
				let angle = Math.PI / 4 * 5;
				let rotation = morph.rotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(upvector, angle))
				addmodel(4, {
					...morph,
					rotation,
					translate: morph.translate.clone().add(new THREE.Vector3().set(dx, 0, 0).applyQuaternion(rotation))
				});
			}
		} else if (inst.type == 2) {
			//corner wall made out of 2 pieces
			addmodel(2, { ...morph, scale: new Vector3().set(1, 1, -1).multiply(morph.scale) });
			addmodel(2, { ...morph, rotation: new Quaternion().setFromAxisAngle(upvector, Math.PI / 2).premultiply(morph.rotation) });
		} else if (inst.type == 5) {
			//moves the model some amount in x direction
			//this might actually for real try to move depending on the size of objects it shares a tile with
			//this doesn't take every other transform into account! but should be good enough for old 
			//models that actually use this prop
			let dx = tiledimensions / 6;
			addmodel(4, { ...morph, translate: new THREE.Vector3().set(dx, 0, 0).applyQuaternion(morph.rotation).add(morph.translate) });
		} else {
			addmodel(inst.type, morph);
		}
		if (modelcount == 0) {
			console.log("model not found for render type", inst.type, objectmeta);
		}
	}
	return models;
}

type WorldLocation = {
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
	visualLevel: number
}

async function mapsquareObjects(source: CacheFileSource, chunk: ChunkData, grid: TileGrid, collision = false) {
	let walls: PlacedModel[] = [];
	let locs: WorldLocation[] = [];

	let locationindex = chunk.cacheIndex.subindices.indexOf(0);
	if (locationindex == -1) { return { locs, walls }; }
	let locations = parseMapsquareLocations.read(chunk.archive[locationindex].buffer).locations;


	for (let loc of locations) {
		let objectmeta = await resolveMorphedObject(source, loc.id);
		if (!objectmeta) { continue; }

		for (let inst of loc.uses) {
			let callingtile = grid.getTile(inst.x + chunk.xoffset, inst.y + chunk.zoffset, inst.plane);
			if (!callingtile) { console.log("callingtile not found"); continue; }

			//models have their center in the middle, but they always rotate such that their southwest corner
			//corresponds to the southwest corner of the tile
			let sizex = (objectmeta.width ?? 1);
			let sizez = (objectmeta.length ?? 1);
			if ((inst.rotation % 2) == 1) {
				//flip offsets if we are rotated with 90deg or 270deg
				[sizex, sizez] = [sizez, sizex];
			}

			let visualLevel = callingtile.effectiveVisualLevel;
			for (let dz = 0; dz < sizez; dz++) {
				for (let dx = 0; dx < sizex; dx++) {
					let tile = grid.getTile(inst.x + chunk.xoffset + dx, inst.y + chunk.zoffset + dz, inst.plane);
					if (tile && tile.effectiveVisualLevel > visualLevel) {
						visualLevel = tile.effectiveVisualLevel;
					}
				}
			}

			locs.push({
				location: objectmeta,
				locid: loc.id,
				placement: inst.extra,
				sizex,
				sizez,
				x: inst.x + chunk.xoffset,
				z: inst.y + chunk.zoffset,
				type: inst.type,
				rotation: inst.rotation,
				plane: inst.plane,
				visualLevel
			});

			//wall drawing
			//TODO just use same extras?
			// let wallextra: ModelExtrasCollision = {
			// 	modeltype: "collision",
			// 	isclickable: false,
			// 	modelgroup: "walls" + visualLevel,
			// 	level: visualLevel
			// }
			// if (inst.type == 0) {
			// 	walls.push({ extras: wallextra, modelid: wallmodels.wall, mods: {}, morph: morph });
			// } else if (inst.type == 1) {
			// 	walls.push({ extras: wallextra, modelid: wallmodels.shortcorner, mods: {}, morph: morph });
			// } else if (inst.type == 2) {
			// 	walls.push({ extras: wallextra, modelid: wallmodels.longcorner, mods: {}, morph: morph });
			// } else if (inst.type == 3) {
			// 	walls.push({ extras: wallextra, modelid: wallmodels.pillar, mods: {}, morph: morph });
			// } else if (inst.type == 9) {
			// 	walls.push({ extras: wallextra, modelid: wallmodels.diagonal, mods: {}, morph: morph });
			// }

			if (collision && !objectmeta.probably_nocollision) {
				for (let dz = 0; dz < sizez; dz++) {
					for (let dx = 0; dx < sizex; dx++) {
						let tile = grid.getTile(inst.x + chunk.xoffset + dx, inst.y + chunk.zoffset + dz, inst.plane);
						if (tile) {
							let col = tile.rawCollision!;
							if (inst.type == 0) {
								col.walkwalls[inst.rotation] = true;
								if (!objectmeta.maybe_allows_lineofsight) {
									col.sightwalls[inst.rotation] = true;
								}
							} else if (inst.type == 2) {
								col.walkwalls[inst.rotation] = true;
								col.walkwalls[(inst.rotation + 1) % 4] = true;
								if (!objectmeta.maybe_allows_lineofsight) {
									col.sightwalls[inst.rotation] = true;
									col.sightwalls[(inst.rotation + 1) % 4] = true;
								}
							} else if (inst.type == 9 || inst.type == 10 || inst.type == 11) {
								col.walk = true;
								if (!objectmeta.maybe_allows_lineofsight) {
									col.sight = true;
								}
							}
						}
					}
				}
			}
		}
	}
	return { locs, walls };
}

function mapsquareCollisionMesh(grid: TileGrid, chunk: ChunkData, level: number) {
	const maxtriangles = squareHeight * squareWidth * 5 * 6 * 2;
	let posoffset = 0;
	let coloroffset = 12;
	let stride = 16;
	const posstride = stride / 4 | 0;
	const colorstride = stride;
	let buf = new ArrayBuffer(stride * maxtriangles * 3);
	let indexbuf = new Uint32Array(maxtriangles * 3);
	let posbuffer = new Float32Array(buf);
	let colorbuffer = new Uint8Array(buf);

	let rootx = chunk.xoffset * tiledimensions;
	let rootz = chunk.zoffset * tiledimensions;

	let vertexindex = 0;
	let indexpointer = 0;
	let writevertex = (tile: TileProps, dx: number, dy: number, dz: number, color: number[]) => {
		const pospointer = vertexindex * posstride + posoffset;
		const colorpointer = vertexindex * colorstride + coloroffset;
		posbuffer[pospointer + 0] = tile.x + dx * tiledimensions - rootx;
		posbuffer[pospointer + 1] = tile.y * (1 - dx) * (1 - dz) + tile.y01 * dx * (1 - dz) + tile.y10 * (1 - dx) * dz + tile.y11 * dx * dz + dy * tiledimensions;
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
	for (let z = chunk.zoffset; z < chunk.zoffset + squareHeight; z++) {
		for (let x = chunk.xoffset; x < chunk.xoffset + squareWidth; x++) {
			let tile = grid.getTile(x, z, level);
			if (tile?.rawCollision) {
				if (tile.rawCollision.walk) {
					let height = (tile.rawCollision.sight ? 1.8 : 0.3);
					writebox(tile, 0.05, 0, 0.05, 0.9, height, 0.9, [100, 50, 50, 255]);
				}
				if (tile.rawCollision.settings & (2 | 4 | 8 | 16)) {
					let r = 0, g = 0, b = 0;
					if (tile.rawCollision.settings & 2) { r += 0; g += 127; b += 127; }
					if (tile.rawCollision.settings & 4) { r += 0; g += 127; b += 0; }
					if (tile.rawCollision.settings & 8) { r += 127; g += 0; b += 0; }
					if (tile.rawCollision.settings & ~(1 | 2 | 4 | 8)) { r += 0; g += 0; b += 127; }
					writebox(tile, -0.05, -0.05, 0, 1.1, 0.25, 1.1, [r, g, b, 255]);
				}
				for (let dir = 0; dir < 4; dir++) {
					if (tile.rawCollision.walkwalls[dir]) {
						let height = (tile.rawCollision.sightwalls[dir] ? 2 : 0.5);
						let col = [255, 60, 60, 255];
						if (dir == 0) { writebox(tile, 0, 0, 0, 0.15, height, 1, col); }
						if (dir == 1) { writebox(tile, 0, 0, 0.85, 1, height, 0.15, col); }
						if (dir == 2) { writebox(tile, 0.85, 0, 0, 0.15, height, 1, col); }
						if (dir == 3) { writebox(tile, 0, 0, 0, 1, height, 0.15, col); }
					}
				}
			}
		}
	}

	let extra: ModelExtras = {
		modeltype: "overlay",
		isclickable: false,
		modelgroup: "collision" + level,
		level
	}

	return {
		pos: new Float32Array(buf, 0, vertexindex * posstride),
		color: new Uint8Array(buf, 0, vertexindex * colorstride),
		indices: new Uint32Array(indexbuf.buffer, 0, indexpointer),
		posstride,
		colorstride,
		posoffset,
		coloroffset,
		extra
	}
}

function mapsquareCollisionToThree(modeldata: ChunkModelData, level: number) {
	let { color, indices, pos, coloroffset, colorstride, posoffset, posstride, extra } = mapsquareCollisionMesh(modeldata.grid, modeldata.chunk, level);

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

async function generateLocationMeshgroups(scene: ThreejsSceneCache, models: MapsquareLocation[]) {
	let modelcache = new Map<number, ModelData>();

	let matmeshes: Map<string, Map<number, PlacedModel>> = new Map();

	for (let obj of models) {
		let model: ModelData | undefined;
		if (typeof obj.modelid == "object") {
			model = obj.modelid;
		} else {
			model = modelcache.get(obj.modelid);
			if (!model) {
				let file = await scene.getFileById(cacheMajors.models, obj.modelid);
				model = parseOb3Model(file);
				modelcache.set(obj.modelid, model);
			}
		}
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
					material: await scene.getMaterial(rawmesh.materialId, rawmesh.hasVertexAlpha),
					models: [],
					overlayIndex: 0,
					groupid: obj.extras.modelgroup
				};
				group.set(matkey, matgroup);
			}
			matgroup.models.push({ morph: obj.morph, model: modified, maxy: model!.maxy, miny: model!.miny, extras: obj.extras });
		};
	}
	let r: PlacedModel[] = [];
	for (let group of matmeshes.values()) {
		r.push(...group.values());
	}
	return r;
}

function meshgroupsToThree(grid: TileGrid, meshgroup: PlacedModel, rootx: number, rootz: number) {
	let geos = meshgroup.models.map(m => {
		let transformed = transformMesh(m.model, m.morph, grid, m.maxy, rootx, rootz);
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
	let mergedgeo = THREE.BufferGeometryUtils.mergeBufferGeometries(geos);
	let mesh = new THREE.Mesh(mergedgeo, meshgroup.material);

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
	mesh.userData = clickable;

	mesh.matrixAutoUpdate = false;
	mesh.updateMatrix();
	return mesh;
}


async function mapsquareMesh(grid: TileGrid, chunk: ChunkData, level: number, materials: Map<number, MaterialData>, atlas: SimpleTexturePacker, showhidden: boolean, keeptileinfo = false) {
	const maxtiles = squareWidth * squareHeight * squareLevels;
	const maxVerticesPerTile = 8;
	const posoffset = 0;// 0/4
	const normaloffset = 3;// 12/4
	const coloroffset = 24;// 24/1
	const texusescoloroffset = 28;// 28/1
	const texweightoffset = 32;// 32/1
	const texuvoffset = 18;// 36/2
	const vertexstride = 52;
	//overalloce worst case scenario
	let vertexbuffer = new ArrayBuffer(maxtiles * vertexstride * maxVerticesPerTile);
	let indexbuffer = new Uint16Array(maxtiles * maxVerticesPerTile);
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
	const textuvstride = vertexstride / 2 | 0;

	let vertexindex = 0;
	let indexpointer = 0;

	const modelx = chunk.xoffset * tiledimensions;
	const modelz = chunk.zoffset * tiledimensions;
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
		const texuvpointer = vertexindex * textuvstride + texuvoffset;

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

		for (let i = 0; i < polyprops.length; i++) {
			const subprop = polyprops[i];
			let texdata: SimpleTexturePackerAlloc | undefined = undefined;
			if (subprop && subprop.material != -1) {
				let mat = materials.get(subprop.material);
				if (mat?.textures.diffuse) {
					texdata = atlas.map.get(mat.textures.diffuse)!;
				}
			}
			if (!texdata) {
				//a weight sum of below 1 automatically fils in with vertex color in the fragment shader
				//not writing anything simple leaves the weight for this texture at 0
				continue;
			}
			//TODO is the 128px per tile a constant?
			//definitely not, there are also 64px textures
			let gridsize = Math.max(1, texdata.img.width / 128);
			let ubase = (tile.x / tiledimensions) % gridsize;
			let vbase = (tile.z / tiledimensions) % gridsize;
			const maxuv = 0x10000;
			texuvbuffer[texuvpointer + 2 * i + 0] = (texdata.u + texdata.usize * (ubase + subx) / gridsize) * maxuv;
			texuvbuffer[texuvpointer + 2 * i + 1] = (texdata.v + texdata.vsize * (vbase + subz) / gridsize) * maxuv;
			texweightbuffer[texweightpointer + i] = (i == currentmat ? 255 : 0);
			texusescolorbuffer[texusescolorpointer + i] = (subprop.usesColor ? 255 : 0);
		}

		return vertexindex++;
	}

	for (let tilelevel = level; tilelevel < squareLevels; tilelevel++) {
		if (showhidden && tilelevel != level) { continue; }
		for (let z = 0; z < squareHeight; z++) {
			for (let x = 0; x < squareWidth; x++) {
				let tile = grid.getTile(chunk.xoffset + x, chunk.zoffset + z, tilelevel);
				if (!tile) { continue; }
				if (!showhidden && tile.effectiveVisualLevel != level) { continue; }

				let rawtile = tile.raw;
				let shape = tile.shape;
				let hasneighbours = tile.next01 && tile.next10 && tile.next11;

				if (keeptileinfo) {
					tileinfos.push({ tile, x, z, level: tilelevel });
					tileindices.push(indexpointer);
				}
				if (hasneighbours && shape.overlay.length != 0) {
					let overlaytype = chunk.overlays[typeof rawtile.overlay == "number" ? rawtile.overlay - 1 : 0];
					let color = overlaytype.primary_colour ?? [255, 0, 255];
					let isvisible = color[0] != 255 || color[1] != 0 || color[2] != 255;
					if (isvisible || showhidden) {
						let props = shape.overlay.map(vertex => {
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
					let props = shape.underlay.map(vertex => {
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
		modelgroup: (showhidden ? "floorhidden" : "floor") + level,
		modeltype: (showhidden ? "floorhidden" : "floor"),
		mapsquarex: chunk.mapsquarex,
		mapsquarez: chunk.mapsquarez,
		level: level,
		isclickable: true,
		searchPeers: false,
		subobjects: tileinfos,
		subranges: tileindices
	};

	return {
		chunk,
		level,
		showhidden,
		tileinfos,

		buffer: new Uint8Array(vertexbuffer, 0, vertexindex * vertexstride),
		vertexstride: vertexstride,
		//TODO i'm not actually using these, can get rid of it again
		indices: new Uint16Array(indexbuffer.buffer, indexbuffer.byteOffset, indexpointer),
		nvertices: vertexindex,
		atlas,

		pos: { src: posbuffer as ArrayBufferView, offset: posoffset, vecsize: 3, normalized: false },
		normal: { src: normalbuffer, offset: normaloffset, vecsize: 3, normalized: false },
		color: { src: colorbuffer, offset: coloroffset, vecsize: 3, normalized: true },
		_RA_FLOORTEX_UV01: { src: texuvbuffer, offset: texuvoffset + 0, vecsize: 4, normalized: true },
		_RA_FLOORTEX_UV23: { src: texuvbuffer, offset: texuvoffset + 4, vecsize: 4, normalized: true },
		_RA_FLOORTEX_WEIGHTS: { src: texweightbuffer, offset: texweightoffset, vecsize: 4, normalized: true },
		_RA_FLOORTEX_USESCOLOR: { src: texusescolorbuffer, offset: texusescoloroffset, vecsize: 4, normalized: true },

		posmax: [maxx, maxy, maxz],
		posmin: [minx, miny, minz],

		extra
	}
}

type FloorMeshData = typeof mapsquareMesh extends (...args: any[]) => Promise<infer Q> ? Q : never;

function floorToThree(scene: ThreejsSceneCache, floor: FloorMeshData) {
	if (floor.nvertices == 0) { return undefined; }
	let makeAttribute = (attr: FloorMeshData["pos"]) => {
		//TODO typing sucks here
		let buf = new THREE.InterleavedBuffer(attr.src as any, floor.vertexstride / (attr.src as any).BYTES_PER_ELEMENT);
		return new THREE.InterleavedBufferAttribute(buf, attr.vecsize, attr.offset, attr.normalized);
	}
	let geo = new THREE.BufferGeometry();
	geo.setAttribute("position", makeAttribute(floor.pos));
	geo.setAttribute("color", makeAttribute(floor.color));
	geo.setAttribute("normal", makeAttribute(floor.normal));
	geo.setAttribute("_ra_floortex_uv01", makeAttribute(floor._RA_FLOORTEX_UV01));
	geo.setAttribute("_ra_floortex_uv23", makeAttribute(floor._RA_FLOORTEX_UV23));
	geo.setAttribute("_ra_floortex_weights", makeAttribute(floor._RA_FLOORTEX_WEIGHTS));
	geo.setAttribute("_ra_floortex_usescolor", makeAttribute(floor._RA_FLOORTEX_USESCOLOR));
	let mat = new THREE.MeshPhongMaterial({ shininess: 0 });
	mat.vertexColors = true;
	if (!floor.showhidden) {
		augmentThreeJsFloorMaterial(mat);
		let img = floor.atlas.convert();
		mat.map = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat);
		mat.map.minFilter = THREE.NearestMipMapLinearFilter;
		mat.map.generateMipmaps = true;
		mat.map.encoding = THREE.sRGBEncoding;
	} else {
		mat.wireframe = true;
	}
	let model = new THREE.Mesh(geo, mat);
	model.userData = floor.extra;
	return model;
}
