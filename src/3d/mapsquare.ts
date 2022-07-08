import { packedHSL2HSL, HSL2RGB, ModelModifications } from "../utils";
import { CacheFileSource, CacheIndex, CacheIndexFile, SubFile } from "../cache";
import { cacheConfigPages, cacheMajors, cacheMapFiles } from "../constants";
import { parseEnvironments, parseMapscenes, parseMapsquareLocations, parseMapsquareOverlays, parseMapsquareTiles, parseMapsquareUnderlays, parseMapsquareWaterTiles, parseObject } from "../opdecoder";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { mapsquare_overlays } from "../../generated/mapsquare_overlays";
import { mapsquare_locations } from "../../generated/mapsquare_locations";
import { ModelMeshData, ModelData } from "./ob3togltf";
import { mapsquare_tiles } from "../../generated/mapsquare_tiles";
import { mapsquare_watertiles } from "../../generated/mapsquare_watertiles";
import { augmentThreeJsFloorMaterial, ThreejsSceneCache, ob3ModelToThree, EngineCache } from "./ob3tothree";
import { BufferAttribute, DataTexture, MeshBasicMaterial, Object3D, Quaternion, RGBAFormat, Vector3 } from "three";
import { materialCacheKey, MaterialData } from "./jmat";
import { objects } from "../../generated/objects";
import { parseSprite } from "./sprite";
import * as THREE from "three";
import { mergeBufferGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";


module.hot?.accept(["../3d/ob3tothree", "../3d/ob3togltf"]);

const upvector = new THREE.Vector3(0, 1, 0);

export const tiledimensions = 512;
export const squareSize = 64;
export const squareLevels = 4;
const heightScale = 1 / 16;
export const worldStride = 128;

const { tileshapes, defaulttileshape, defaulttileshapeflipped } = generateTileShapes();
const wallmodels = generateWallModels();

const defaultVertexProp: TileVertex = { material: -1, color: [255, 0, 255], usesColor: true };

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

export type TileVertex = {
	material: number,
	color: number[],
	usesColor: boolean
}

export type ChunkData = {
	xoffset: number,
	zoffset: number,
	mapsquarex: number,
	mapsquarez: number,
	tiles: mapsquare_tiles["tiles"],
	extra: mapsquare_tiles["extra"],
	archive: SubFile[],
	cacheIndex: CacheIndex,
	locs: WorldLocation[]
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

export type MeshTileInfo = { tile: mapsquare_tiles["tiles"][number], x: number, z: number, level: number };

export type TileProps = {
	raw: mapsquare_tiles["tiles"][number],
	rawOverlay: mapsquare_overlays | undefined,
	rawUnderlay: mapsquare_underlays | undefined,
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

function squareMesh(sizex: number, sizez: number, color: number[]): ModelMeshData {
	let pos = new Float32Array([
		-sizex / 2, 0, -sizez / 2,
		sizex / 2, 0, -sizez / 2,
		-sizex / 2, 0, sizez / 2,
		sizex / 2, 0, sizez / 2
	]);
	let col = new Uint8Array([
		color[0], color[1], color[2],
		color[0], color[1], color[2],
		color[0], color[1], color[2],
		color[0], color[1], color[2]
	]);
	let uvs = new Float32Array([
		0, 1,
		1, 1,
		0, 0,
		1, 0
	]);
	let indexbuffer = new Uint16Array([
		0, 3, 1,
		0, 2, 3
	]);
	return {
		attributes: {
			pos: new THREE.BufferAttribute(pos, 3, false),
			color: new THREE.BufferAttribute(col, 3, true),
			texuvs: new THREE.BufferAttribute(uvs, 2, false)
		},
		indices: new THREE.BufferAttribute(indexbuffer, 1, false),
		hasVertexAlpha: false,
		materialId: -1
	}
}

function extrudedPolygonMesh(points: { x: number, z: number }[], height: number, color: number[]): ModelMeshData {
	let nvertices = points.length * 2;
	let nfaces = 2;
	if (height != 0) {
		nvertices += points.length * 4;
		nfaces += points.length;
	}
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
	if (height != 0) {
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
	const height = 0;//tiledimensions * 1.5;
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
			newmesh.attributes = {
				...mesh.attributes,
				color: clonedcolors
			}
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
	let centery = getTileHeight(grid, (morph.originx) / tiledimensions, (morph.originz) / tiledimensions, morph.level);

	let pos = mesh.attributes.pos;
	if (mesh.attributes.pos.itemSize != 3) {
		throw new Error("unexpected mesh pos type during model transform");
	}

	//let ceiling = typeof morph.tiletransform?.scaleModelHeight != "undefined";
	let followfloor = morph.placementMode == "followfloor" || morph.placementMode == "followfloorceiling";
	let followceiling = morph.placementMode == "followfloorceiling";
	let yscale = (followceiling && modelheight > 0 ? 1 / modelheight : 1);

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
	constructor(engine: EngineCache, area: MapRect, tilemask: MapRect[] | undefined) {
		this.area = area;
		this.tilemask = tilemask && tilemask.filter(q => mapRectsIntersect(q, area));
		this.engine = engine;
		this.xoffset = area.x;
		this.zoffset = area.z;
		this.width = area.xsize;
		this.height = area.zsize;
		this.xstep = 1;
		this.zstep = this.xstep * area.xsize;
		this.levelstep = this.zstep * area.zsize;
		this.tiles = [];
	}

	getHeightFile(x: number, z: number, level: number, xsize: number, zsize: number) {
		let file = new Uint16Array(xsize * zsize);
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
						//keep using old effectivelevel if it was already determined
						if (effectiveLevel == effectiveTile.effectiveLevel) {
							effectiveVisualLevel = effectiveTile.effectiveVisualLevel;
						}
						effectiveTile.effectiveCollision = currenttile.rawCollision;
						effectiveTile.playery = currenttile.playery;
					}
					currenttile.effectiveLevel = (alwaysshow ? 0 : effectiveLevel);
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
					if (tile.overlayprops.material == 0 || tile.underlayprops.material == 0) {
						debugger;
					}
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
		if (tiles.length != squareSize * squareSize * squareLevels) { throw new Error(); }
		let baseoffset = (chunk.xoffset - this.xoffset) * this.xstep + (chunk.zoffset - this.zoffset) * this.zstep;
		for (let z = 0; z < squareSize; z++) {
			for (let x = 0; x < squareSize; x++) {
				let tilex = (chunk.xoffset + x) * tiledimensions;
				let tilez = (chunk.zoffset + z) * tiledimensions;
				if (!mapRectContains(this.area, chunk.xoffset + x, chunk.zoffset + z)) { continue; }
				if (this.tilemask && !this.tilemask.some(q => mapRectContains(q, chunk.xoffset + x, chunk.zoffset + z))) { continue; }
				let tileindex = z + x * squareSize;
				let height = 0;
				for (let level = 0; level < squareLevels; level++) {
					let tile = tiles[tileindex];
					if (tile.height != undefined) {
						//not sure what the 1=0 thing is about, but seems correct for trees
						height += (tile.height == 1 ? 0 : tile.height);
					} else {
						//TODO this is a guess that sort of fits
						height += 30;
					}
					let visible = false;
					let shape = (tile.shape == undefined ? defaulttileshape : tileshapes[tile.shape]);
					let bleedsOverlayMaterial = false;
					let underlayprop: TileVertex | undefined = undefined;
					let overlayprop: TileVertex | undefined = undefined;
					//TODO bound checks
					let underlay = (tile.underlay != undefined ? this.engine.mapUnderlays[tile.underlay - 1] : undefined);
					if (underlay) {
						if (underlay.color && (underlay.color[0] != 255 || underlay.color[1] != 0 || underlay.color[2] != 255)) {
							visible = true;
						}
						underlayprop = { material: underlay.material ?? -1, color: underlay.color ?? [255, 0, 255], usesColor: !underlay.unknown_0x04 };
					}
					let overlay = (tile.overlay != undefined ? this.engine.mapOverlays[tile.overlay - 1] : undefined);
					if (overlay) {
						overlayprop = { material: overlay.material ?? -1, color: overlay.primary_colour ?? [255, 0, 255], usesColor: !overlay.unknown_0x0A };
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
					tileindex += squareSize * squareSize;
				}
			}
		}
	}
}

export type ParsemapOpts = { padfloor?: boolean, invisibleLayers?: boolean, collision?: boolean, map2d?: boolean, skybox?: boolean, mask?: MapRect[] };
export type ChunkModelData = { floors: FloorMeshData[], models: MapsquareLocation[], overlays: PlacedModel[], chunk: ChunkData, grid: TileGrid };

export async function parseMapsquare(scene: EngineCache, rect: MapRect, opts?: ParsemapOpts) {

	let chunkfloorpadding = (opts?.padfloor ? 10 : 0);//TODO same as max(blending kernel,max loc size), put this in a const somewhere
	let chunkpadding = Math.ceil(chunkfloorpadding / squareSize);
	let grid = new TileGrid(scene, {
		x: rect.x * squareSize - chunkfloorpadding,
		z: rect.z * squareSize - chunkfloorpadding,
		xsize: rect.xsize * squareSize + chunkfloorpadding * 2,
		zsize: rect.zsize * squareSize + chunkfloorpadding * 2
	}, opts?.mask);
	let chunks: ChunkData[] = [];
	for (let z = -chunkpadding; z < rect.zsize + chunkpadding; z++) {
		for (let x = -chunkpadding; x < rect.xsize + chunkpadding; x++) {
			let squareindex = (rect.x + x) + (rect.z + z) * worldStride;
			let mapunderlaymeta = await scene.source.getIndexFile(cacheMajors.mapsquares);
			let selfindex = mapunderlaymeta[squareindex];
			if (!selfindex) {
				console.log(`skipping mapsquare ${rect.x + x} ${rect.z + z} as it does not exist`);
				continue;
			}
			let selfarchive = (await scene.source.getFileArchive(selfindex));
			let tileindex = selfindex.subindices.indexOf(cacheMapFiles.squares);
			let tileindexwater = selfindex.subindices.indexOf(cacheMapFiles.squaresWater);

			if (tileindex == -1) {
				console.log(`skipping mapsquare ${rect.x + x} ${rect.z + z} as it has no tiles`);
				continue;
			}
			let tilefile = selfarchive[tileindex].buffer;
			//let watertilefile = selfarchive[tileindexwater]?.buffer;
			//let watertiles = parseMapsquareWaterTiles.read(watertilefile);
			let tiledata = parseMapsquareTiles.read(tilefile);
			let chunk: ChunkData = {
				xoffset: (rect.x + x) * squareSize,
				zoffset: (rect.z + z) * squareSize,
				mapsquarex: rect.x + x,
				mapsquarez: rect.z + z,
				tiles: tiledata.tiles, extra: tiledata.extra, cacheIndex: selfindex, archive: selfarchive,
				locs: []
			};
			grid.addMapsquare(chunk, !!opts?.collision);

			//only add the actual ones we need to the queue
			if (chunk.mapsquarex < rect.x || chunk.mapsquarex >= rect.x + rect.xsize) { continue; }
			if (chunk.mapsquarez < rect.z || chunk.mapsquarez >= rect.z + rect.zsize) { continue; }
			chunks.push(chunk);
		}
	}
	grid.blendUnderlays();
	for (let chunk of chunks) {
		chunk.locs = await mapsquareObjects(scene, chunk, grid, !!opts?.collision);
	}

	return { grid, chunks };
}

export async function mapsquareSkybox(scene: ThreejsSceneCache, mainchunk: ChunkData) {
	let skybox = new Object3D();
	let fogColor = [0, 0, 0, 0];
	if (mainchunk?.extra.unk00?.unk20) {
		fogColor = mainchunk.extra.unk00.unk20.slice(1);
	}
	if (mainchunk?.extra.unk80) {
		let envarch = await scene.source.getArchiveById(cacheMajors.config, cacheConfigPages.environments);
		let envfile = envarch.find(q => q.fileid == mainchunk.extra!.unk80!.environment)!;
		let env = parseEnvironments.read(envfile.buffer);
		if (typeof env.model == "number") {
			skybox = await ob3ModelToThree(scene, await scene.getModelData(env.model));
		}
	}
	return { skybox, fogColor };
}

export async function mapsquareModels(scene: ThreejsSceneCache, grid: TileGrid, chunks: ChunkData[], opts?: ParsemapOpts) {
	let squareDatas: ChunkModelData[] = [];

	for (let chunk of chunks) {
		let floors: FloorMeshData[] = [];
		let matids = grid.gatherMaterials(chunk.xoffset, chunk.zoffset, squareSize + 1, squareSize + 1);
		let textures = new Map<number, CanvasImage>();
		let textureproms: Promise<void>[] = [];
		for (let matid of matids) {
			let mat = scene.cache.getMaterialData(matid);
			if (mat.textures.diffuse) {
				textureproms.push(scene.getTextureFile(mat.textures.diffuse, mat.stripDiffuseAlpha)
					.then(tex => tex.toWebgl())
					.then(src => { textures.set(mat.textures.diffuse!, src); })
				);
			}
		}
		await Promise.all(textureproms);
		let atlas!: SimpleTexturePacker;
		retrysize: for (let size = 256; size <= 4096; size *= 2) {
			atlas = new SimpleTexturePacker(size);
			for (let [id, tex] of textures.entries()) {
				if (!atlas.addTexture(tex, id)) {
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
		let models = mapsquareObjectModels(chunk.locs);
		let overlays = (!opts?.map2d ? [] : await mapsquareOverlays(scene.cache, grid, chunk.locs));
		squareDatas.push({
			chunk,
			floors,
			models,
			grid,
			overlays
		});
	}
	return squareDatas;
}

export async function mapsquareToThreeSingle(scene: ThreejsSceneCache, grid: TileGrid, chunk: ChunkModelData) {
	let node = new THREE.Group();
	node.matrixAutoUpdate = false;
	node.position.set(chunk.chunk.xoffset * tiledimensions, 0, chunk.chunk.zoffset * tiledimensions);
	node.updateMatrix();
	let models = await generateLocationMeshgroups(scene, chunk.models);

	let rootx = chunk.chunk.xoffset * tiledimensions;
	let rootz = chunk.chunk.zoffset * tiledimensions;
	if (models.length != 0) { node.add(...models.map(q => meshgroupsToThree(grid, q, rootx, rootz))); }
	let chunkoverlays = chunk.overlays.filter(q => q.models.length != 0).map(q => meshgroupsToThree(grid, q, rootx, rootz));
	if (chunkoverlays.length != 0) { node.add(...chunkoverlays); }
	let floors = (await Promise.all(chunk.floors.map(f => floorToThree(scene, f)))).filter(q => q) as any;
	if (floors.length != 0) { node.add(...floors); }
	for (let level = 0; level < squareLevels; level++) {
		let boxes = mapsquareCollisionToThree(chunk, level);
		if (boxes) { node.add(boxes); }
	}
	return node;
}


/**
 * @deprecated
 */
export async function mapsquareToThree(scene: ThreejsSceneCache, grid: TileGrid, chunks: ChunkModelData[]) {
	let root = new THREE.Group();

	let chunkmodels = await Promise.all(chunks.map(q => mapsquareToThreeSingle(scene, grid, q)));
	if (chunkmodels.length != 0) {
		root.add(...chunkmodels);
	}

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

function copyCanvasImage(ctx: CanvasRenderingContext2D, src: CanvasImage, destx: number, desty: number, srcx = 0, srcy = 0, width = src.width, height = src.height) {
	ctx.drawImage(src, srcx, srcy, width, height, destx, desty, width, height);
}

type CanvasImage = Exclude<CanvasImageSource, SVGImageElement>;
type SimpleTexturePackerAlloc = { u: number, v: number, usize: number, vsize: number, x: number, y: number, img: CanvasImage }

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

	addTexture(img: CanvasImage, id: number) {
		if (this.result != null) {
			this.result = null;
			console.log("adding textures to atlas after creation of texture");
		}
		let sizex = img.width + 2 * this.padsize;
		let sizey = img.height + 2 * this.padsize;
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
		return true;
	}
	convert() {
		if (this.result) { return this.result; }
		let cnv = document.createElement("canvas");
		cnv.width = this.size; cnv.height = this.size;
		let ctx = cnv.getContext("2d")!;
		console.log("floor texatlas imgs", this.allocs.length, "fullness", +((this.allocy + this.allocLineHeight) / this.size).toFixed(2));
		for (let alloc of this.allocs) {
			const x0 = alloc.x - this.padsize;
			const x1 = alloc.x;
			const x2 = alloc.x + alloc.img.width;
			const y0 = alloc.y - this.padsize;
			const y1 = alloc.y;
			const y2 = alloc.y + alloc.img.height;
			//YIKES
			copyCanvasImage(ctx, alloc.img, x0, y0, alloc.img.width - this.padsize, alloc.img.height - this.padsize, this.padsize, this.padsize);
			copyCanvasImage(ctx, alloc.img, x1, y0, 0, alloc.img.height - this.padsize, alloc.img.width, this.padsize);
			copyCanvasImage(ctx, alloc.img, x2, y0, 0, alloc.img.height - this.padsize, this.padsize, this.padsize);

			copyCanvasImage(ctx, alloc.img, x0, y1, alloc.img.width - this.padsize, 0, this.padsize, alloc.img.height);
			copyCanvasImage(ctx, alloc.img, x1, y1, 0, 0, alloc.img.width, alloc.img.height);
			copyCanvasImage(ctx, alloc.img, x2, y1, 0, 0, this.padsize, alloc.img.height);

			copyCanvasImage(ctx, alloc.img, x0, y2, alloc.img.width - this.padsize, 0, this.padsize, this.padsize);
			copyCanvasImage(ctx, alloc.img, x1, y2, 0, 0, alloc.img.width, this.padsize);
			copyCanvasImage(ctx, alloc.img, x2, y2, 0, 0, this.padsize, this.padsize);
		}
		this.result = cnv;
		return cnv;
	}
}

type PlacedModel = {
	models: {
		model: ModelMeshData,
		morph: FloorMorph,
		miny: number,
		maxy: number,
		extras: ModelExtrasLocation | ModelExtrasOverlay
	}[],
	material: THREE.Material,
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
	if (newid == (1 << 15) - 1) { newid = -1; }
	return newid;
}

//TODO move this to a more logical location
export async function resolveMorphedObject(source: CacheFileSource, id: number) {
	let objectfile = await source.getFileById(cacheMajors.objects, id);
	let objectmeta = parseObject.read(objectfile);
	if (objectmeta.morphs_1 || objectmeta.morphs_2) {
		let newid = defaultMorphId(objectmeta);
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

async function mapsquareOverlays(engine: EngineCache, grid: TileGrid, locs: WorldLocation[]) {
	let mat = new THREE.MeshBasicMaterial();
	mat.transparent = true;
	mat.depthTest = false;
	let floorgroup = (level: number) => {
		let wallgroup: PlacedModel = {
			models: [],
			groupid: "walls" + level,
			material: mat,
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
		if (!group) {
			let mapscene = grid.engine.mapMapscenes[sceneid];
			if (mapscene.sprite_id == undefined) { return; }
			let spritefile = await engine.source.getFileById(cacheMajors.sprites, mapscene.sprite_id);
			let sprite = parseSprite(spritefile);
			let mat = new THREE.MeshBasicMaterial();
			mat.map = new THREE.DataTexture(sprite[0].data, sprite[0].width, sprite[0].height, THREE.RGBAFormat);
			mat.depthTest = false;
			mat.transparent = true;
			mat.needsUpdate = true;
			group = {
				groupid: "mapscenes" + loc.effectiveLevel,
				material: mat,
				models: [],
				overlayIndex: 2
			};
			floors[loc.effectiveLevel].mapscenes.set(sceneid, group);
		}
		let tex = (group.material as MeshBasicMaterial).map! as DataTexture;

		const spritescale = 128;
		let mesh = squareMesh(tex.image.width * spritescale, tex.image.height * spritescale, [255, 255, 255]);
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
			addwall(wallmodels.wall, loc);
		} else if (loc.type == 1) {
			addwall(wallmodels.shortcorner, loc);
		} else if (loc.type == 2) {
			addwall(wallmodels.longcorner, loc);
		} else if (loc.type == 3) {
			addwall(wallmodels.pillar, loc);
		} else if (loc.type == 9) {
			addwall(wallmodels.diagonal, loc);
		}

		if (loc.location.mapscene != undefined) {
			await addMapscene(loc, loc.location.mapscene);
		}
	}

	return floors.flatMap(f => [f.wallgroup, ...f.mapscenes.values()]);
}

function mapsquareObjectModels(locs: WorldLocation[]) {
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
		let locmodels: MapsquareLocation["models"] = [];
		let objectmeta = inst.location;
		if (!model) {
			let modelmods: ModelModifications = {
				replaceColors: objectmeta.color_replacements ?? undefined,
				replaceMaterials: objectmeta.material_replacements ?? undefined
			};
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
				(objectmeta.scaleZ ?? 128) * scalefactor * (objectmeta.mirror ? -1 : 1)
			);
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

		let originx = (inst.x + inst.sizex / 2) * tiledimensions;
		let originz = (inst.z + inst.sizez / 2) * tiledimensions
		let translate = new THREE.Vector3(originx, 0, originz).add(model.translate);

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
			for (let ch of objectmeta!.models ?? []) {
				if (ch.type != type) { continue; }
				modelcount++;
				for (let modelid of ch.values) {
					locmodels.push({ model: modelid, morph: finalmorph });
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
					translate: new THREE.Vector3(dx, 0, 0).add(morph.translate).applyQuaternion(rotation)
				});
			}
			if (inst.type == 7 || inst.type == 8) {
				let dx = tiledimensions * 0.5;
				let angle = Math.PI / 4 * 5;
				let rotation = new THREE.Quaternion().setFromAxisAngle(upvector, angle).premultiply(morph.rotation)
				addmodel(4, {
					...morph,
					rotation,
					translate: new THREE.Vector3(dx, 0, 0).add(morph.translate).applyQuaternion(rotation)
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

export async function mapsquareObjects(engine: EngineCache, chunk: ChunkData, grid: TileGrid, collision = false) {
	let locs: WorldLocation[] = [];

	let locationindex = chunk.cacheIndex.subindices.indexOf(cacheMapFiles.locations);
	if (locationindex == -1) { return locs; }
	let locations = parseMapsquareLocations.read(chunk.archive[locationindex].buffer).locations;


	for (let loc of locations) {
		let objectmeta = await resolveMorphedObject(engine.source, loc.id);
		if (!objectmeta) { continue; }

		for (let inst of loc.uses) {
			let callingtile = grid.getTile(inst.x + chunk.xoffset, inst.y + chunk.zoffset, inst.plane);
			if (!callingtile) {
				// console.log("callingtile not found");
				continue;
			}

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
				visualLevel,
				effectiveLevel: callingtile.effectiveLevel
			});

			const fullcollisiontypes = [
				9,//is actually diagonal wall
				10, 11,
				12, 13, 14, 15, 16, 17, 18, 19, 20, 21//roof types, only some are confirmed
			]

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
							} else if (fullcollisiontypes.includes(inst.type)) {
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
	return locs;
}

function mapsquareCollisionMesh(grid: TileGrid, chunk: ChunkData, level: number) {
	const maxtriangles = squareSize * squareSize * 5 * 6 * 2;
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
	for (let z = chunk.zoffset; z < chunk.zoffset + squareSize; z++) {
		for (let x = chunk.xoffset; x < chunk.xoffset + squareSize; x++) {
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

async function generateLocationMeshgroups(scene: ThreejsSceneCache, locs: MapsquareLocation[]) {
	let loadedmodels = new Map<number, ModelData>();

	let matmeshes: Map<string, Map<number, PlacedModel>> = new Map();

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
						material: await scene.getMaterial(modified.materialId, modified.hasVertexAlpha),
						models: [],
						groupid: obj.extras.modelgroup,
						overlayIndex: 0
					};
					group.set(matkey, matgroup);
				}
				matgroup.models.push({
					model: modified,
					morph: modelinst.morph,
					miny: miny,
					maxy: maxy,
					extras: obj.extras
				});
			}
		}
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
	let mergedgeo = mergeBufferGeometries(geos);
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
	mesh.renderOrder = meshgroup.overlayIndex;
	mesh.userData = clickable;

	mesh.matrixAutoUpdate = false;
	mesh.updateMatrix();
	return mesh;
}


function mapsquareMesh(grid: TileGrid, chunk: ChunkData, level: number, atlas: SimpleTexturePacker, showhidden: boolean, keeptileinfo = false, worldmap = false) {
	const maxtiles = squareSize * squareSize * squareLevels;
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
	//TODO get rid of indexbuffer since we're not actually using it and it doesn't fit in uint16 anyway
	let indexbuffer = new Uint32Array(maxtiles * maxVerticesPerTile);
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
		colorbuffer[colpointer + 3] = 255;//4 alpha channel because of gltf

		for (let i = 0; i < polyprops.length; i++) {
			const subprop = polyprops[i];
			let texdata: SimpleTexturePackerAlloc | undefined = undefined;
			if (subprop && subprop.material != -1) {
				let mat = grid.engine.getMaterialData(subprop.material);
				if (mat.textures.diffuse) {
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
		for (let z = 0; z < squareSize; z++) {
			for (let x = 0; x < squareSize; x++) {
				let tile = grid.getTile(chunk.xoffset + x, chunk.zoffset + z, tilelevel);
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
					let color = overlaytype.primary_colour ?? [255, 0, 255];
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
							props = Array(shape.overlay.length).fill({
								color,
								material: 0,
								usesColor: true
							} as TileVertex);
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
						props = Array(shape.underlay.length).fill({ color: tile.underlayprops.color, material: 0, usesColor: true } as TileVertex);
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

	return {
		chunk,
		level,
		showhidden,
		tileinfos,
		worldmap,

		buffer: new Uint8Array(vertexbuffer, 0, vertexindex * vertexstride),
		vertexstride: vertexstride,
		//TODO i'm not actually using these, can get rid of it again
		indices: indexbuffer.subarray(0, indexpointer),
		nvertices: vertexindex,
		atlas,

		pos: { src: posbuffer.subarray(0, vertexindex * posstride) as ArrayBufferView, offset: posoffset, vecsize: 3, normalized: false },
		normal: { src: normalbuffer.subarray(0, vertexindex * normalstride), offset: normaloffset, vecsize: 3, normalized: false },
		color: { src: colorbuffer.subarray(0, vertexindex * colorstride), offset: coloroffset, vecsize: 4, normalized: true },
		_RA_FLOORTEX_UV01: { src: texuvbuffer.subarray(0, vertexindex * textuvstride), offset: texuvoffset + 0, vecsize: 4, normalized: true },
		_RA_FLOORTEX_UV23: { src: texuvbuffer.subarray(0, vertexindex * textuvstride), offset: texuvoffset + 4, vecsize: 4, normalized: true },
		_RA_FLOORTEX_WEIGHTS: { src: texweightbuffer.subarray(0, vertexindex * texweightstride), offset: texweightoffset, vecsize: 4, normalized: true },
		_RA_FLOORTEX_USESCOLOR: { src: texusescolorbuffer.subarray(0, vertexindex * texusescolorstride), offset: texusescoloroffset, vecsize: 4, normalized: true },

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
			let data = img.getContext("2d")!.getImageData(0, 0, img.width, img.height);
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
