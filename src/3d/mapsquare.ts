import { JMat, JMatInternal } from "./jmat";
import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { GLTFBuilder } from "./gltf";
import { CacheFileSource, CacheIndex, SubFile } from "../cache";
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
import type { Object3D } from "three";

//can't use module import syntax because es6 wants to be more es6 than es6
const THREE = require("three/build/three.js") as typeof import("three");

const tiledimensions = 512;
const squareWidth = 64;
const squareHeight = 64
const squareLevels = 4;
const heightScale = 1 / 16;
const worldStride = 128;

const { tileshapes, defaulttileshape } = generateTileShapes();

//TODO use material -1 instead?
const defaultVertexProp: TileVertex = { material: -1, color: [255, 0, 255] };

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
	color: number[]
}

type ChunkData = {
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

export type ModelExtras = {
	modeltype: "location",
	modelgroup: string,
	locationid: number,
	worldx: number,
	worldz: number,
	level: number,
} | {
	modeltype: "floor" | "floorhidden",
	modelgroup: string,
	mapsquarex: number,
	mapsquarez: number,
	level: number
}

type TileProps = {
	raw: mapsquare_tiles[number],
	next01: TileProps | undefined,
	next10: TileProps | undefined,
	next11: TileProps | undefined,
	x: number,
	y: number,
	z: number,
	y10: number,
	y01: number,
	y11: number,
	shape: TileShape,
	visible: boolean,
	normalX: number,
	normalZ: number,
	bleedsOverlayMaterial: boolean,
	//0 botleft,1 botmid,2 leftmid,3 midmid
	vertexprops: TileVertex[],
	overlayprops: TileVertex,
	originalUnderlayColor: number[],
	underlayprops: TileVertex
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
	rotation: number,
	mirror: boolean,
	width: number,
	length: number,
	tiles: TileMorph[] | undefined,
	scaleModelHeight: boolean,
	scaleModelHeightOffset: number
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
			pos: { newtype: "f32", source: pos, vecsize: 3 },
			color: { newtype: "u8", source: col, vecsize: 3 }
		},
		indices: index,
		hasVertexAlpha: false,
		materialId: -1
	}
	return res;
}

export function transformMesh(mesh: ModelMeshData, morph: FloorMorph, modelheight: number) {
	let q00: number, q01: number, q10: number, q11: number;
	if (morph.rotation % 2 == 1) {
		q00 = 0; q01 = 1;
		q10 = -1; q11 = 0;
	} else {
		q00 = 1; q01 = 0;
		q10 = 0; q11 = 1;
	}
	if (morph.rotation >= 2) {
		q00 *= -1; q01 *= -1; q10 *= -1; q11 *= -1;
	}
	if (morph.mirror) {
		q11 *= -1; q01 *= -1;
	}
	let xsize = (morph.rotation % 2 == 1 ? morph.length : morph.width);
	let zsize = (morph.rotation % 2 == 1 ? morph.width : morph.length);

	let roundoffsetx = xsize / 2;
	let roundoffsetz = zsize / 2;
	let pos = mesh.attributes.pos.source;
	if (mesh.attributes.pos.vecsize != 3 || mesh.attributes.pos.newtype != "f32") {
		throw new Error("unexpected mesh pos type during model transform");
	}

	let yscale = (morph.scaleModelHeight ? 1 / (modelheight + morph.scaleModelHeightOffset) : 1);

	const tiles = morph.tiles;
	let newpos = new Float32Array(pos.length);
	for (let i = 0; i < pos.length; i += 3) {
		let x = pos[i + 0];
		let y = pos[i + 1];
		let z = pos[i + 2];
		let newx = x * q00 + z * q01;
		let newz = x * q10 + z * q11;
		let newy = y;
		if (tiles) {
			let tilex = Math.max(0, Math.min(xsize - 1, Math.floor(newx / tiledimensions + roundoffsetx)));
			let tilez = Math.max(0, Math.min(zsize - 1, Math.floor(newz / tiledimensions + roundoffsetz)));
			let tile = tiles[tilex + tilez * xsize];
			let dx = newx + (-tilex + roundoffsetx - 0.5) * tiledimensions;
			let dy = y * yscale;
			let dz = newz + (-tilez + roundoffsetz - 0.5) * tiledimensions;
			newy = tile.constant
				+ tile.linear[0] * dx + tile.linear[1] * dy + tile.linear[2] * dz
				+ tile.quadratic[0] * dx * dy + tile.quadratic[1] * dy * dz + tile.quadratic[2] * dz * dx
				+ tile.cubic * dx * dy * dz
		}
		newpos[i + 0] = newx;
		newpos[i + 1] = newy;
		newpos[i + 2] = newz;
	}

	let indices = mesh.indices;
	if (morph.mirror) {
		//reverse the winding order if the model is mirrored
		if (!(indices instanceof Uint16Array)) { throw new Error("uint16 indices expected"); }
		let oldindices = indices;
		indices = new Uint16Array(indices.length)
		for (let i = 0; i < indices.length; i += 3) {
			indices[i + 0] = oldindices[i + 0]
			indices[i + 1] = oldindices[i + 2];
			indices[i + 2] = oldindices[i + 1];
		}
	}

	let r: ModelMeshData = {
		materialId: mesh.materialId,
		hasVertexAlpha: mesh.hasVertexAlpha,
		indices,
		attributes: {
			...mesh.attributes,
			pos: {
				newtype: mesh.attributes.pos.newtype,
				source: newpos,
				vecsize: 3
			}
		}
	}
	return r;
}

class TileGrid {
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
	getObjectPlacement(x: number, z: number, plane: number, linkabove: boolean, rotation: number, mirror: boolean) {
		let tile = this.getTile(x, z, plane);
		if (!tile) {
			console.log("could not find all corner tiles of object");
			return undefined;
		}
		let xdist = tiledimensions / 2;
		let zdist = tiledimensions / 2;
		let originy = (tile.y + tile.y01 + tile.y10 + tile.y11) / 4;
		let dydx = (tile.y01 / 2 + tile.y11 / 2 - originy) / xdist;
		let dydz = (tile.y10 / 2 + tile.y11 / 2 - originy) / xdist;
		let dydxz = (tile.y11 - originy - dydx * xdist - dydz * zdist) / xdist / zdist;

		//TODO rotation and mirror should be handled in the transform instead
		if ((rotation % 2 == 1) != mirror) { dydxz = -dydxz; }
		if (rotation == 1) { [dydx, dydz] = [-dydz, dydx]; }
		if (rotation == 2) { [dydx, dydz] = [-dydx, -dydz]; }
		if (rotation == 3) { [dydx, dydz] = [dydz, -dydx]; }
		if (mirror) { dydz = -dydz; }

		let dydxy = 0;
		let dydyz = 0;
		let dydxyz = 0;
		let dydy = 1;

		if (linkabove) {
			let roof = this.getObjectPlacement(x, z, plane + 1, false, rotation, mirror);
			if (roof) {
				dydy = (roof.constant - originy);
				dydxy = (roof.linear[0] - dydx);
				dydyz = (roof.linear[2] - dydz);
				dydxyz = (roof.quadratic[2] - dydxz);
			}

		}

		//pos=dot(lin,pos)+dot(pos,quad*pos)+cube*pos.x*pos.y*pos.z;
		let deformation: TileMorph = {
			constant: originy,
			linear: [dydx, dydy, dydz],
			quadratic: [dydxy, dydyz, dydxz],
			cubic: dydxyz
		}

		return {
			...deformation,
			tile,//TODO remove
			roof: (linkabove ? this.getTile(x, z, plane) : undefined),
			// modelheight
		}
	}
	getTile(x: number, z: number, level: number) {
		x -= this.xoffset;
		z -= this.zoffset;
		if (x < 0 || z < 0 || x >= this.width || z >= this.height) { return undefined; }
		return this.tiles[this.levelstep * level + z * this.zstep + x * this.xstep];
	}
	blendUnderlays(kernelRadius = 3) {
		//5 deep letsgooooooo
		for (let z = this.zoffset; z < this.zoffset + this.height; z++) {
			for (let x = this.xoffset; x < this.xoffset + this.width; x++) {
				for (let level = 0; level < squareLevels; level++) {
					let currenttile = this.getTile(x, z, level);
					if (!currenttile) { continue; }
					if (currenttile.visible) {
						let r = 0, g = 0, b = 0;
						let count = 0;
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

					currenttile.next01 = xnext;
					currenttile.next10 = znext;
					currenttile.next11 = xznext;
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
					mats.add(tile.underlayprops.material ?? 0);
					mats.add(tile.overlayprops.material ?? 0);
				}
			}
		}
		return mats;
	}
	addMapsquare(chunk: ChunkData) {
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
						//TODO this is an arbitrary guess
						height += 32;
					}
					let visible = false;
					let shape = (typeof tile.shape == "undefined" ? defaulttileshape : tileshapes[tile.shape]);
					let bleedsOverlayMaterial = false;
					let underlayprop = defaultVertexProp;
					let overlayprop = defaultVertexProp;
					if (typeof tile.underlay != "undefined") {
						//TODO bound checks
						let underlay = chunk.underlays[tile.underlay - 1];
						if (underlay.color && (underlay.color[0] != 255 || underlay.color[1] != 0 || underlay.color[2] != 255)) {
							visible = true;
						}
						underlayprop = { material: underlay.material ?? 0, color: underlay.color ?? [255, 0, 255] };
					}
					if (typeof tile.overlay != "undefined") {
						let overlay = chunk.overlays[tile.overlay - 1];
						overlayprop = { material: overlay.material ?? 0, color: overlay.primary_colour ?? [255, 0, 255] };
						bleedsOverlayMaterial = !!overlay.unknown_0x0C;
					}
					let newindex = baseoffset + this.xstep * x + this.zstep * z + this.levelstep * level;
					//let newindex = this.levelstep * level + (z + chunk.zoffset - this.zoffset) * this.zstep + (x + chunk.xoffset - this.xoffset) * this.xstep
					let y = height * tiledimensions * heightScale;
					let parsedTile: TileProps = {
						raw: tile,
						next01: undefined,
						next10: undefined,
						next11: undefined,
						x: tilex,
						y: y,
						z: tilez,
						y01: y, y10: y, y11: y,
						shape,
						visible,
						normalX: 0, normalZ: 0,
						bleedsOverlayMaterial,
						vertexprops: [underlayprop, underlayprop, underlayprop, underlayprop],
						underlayprops: underlayprop,
						overlayprops: overlayprop,
						originalUnderlayColor: underlayprop.color
					}
					this.tiles[newindex] = parsedTile;
					tileindex += squareWidth * squareHeight;
				}
			}
		}
	}
}

export async function parseMapsquare(source: CacheFileSource, rect: { x: number, y: number, width: number, height: number }, opts?: { centered?: boolean, padfloor?: boolean, invisibleLayers?: boolean }) {

	//TODO proper erroring on nulls
	let configunderlaymeta = await source.getIndexFile(cacheMajors.config);
	let underarch = await source.getFileArchive(configunderlaymeta[1]);
	let underlays = underarch.map(q => parseMapsquareUnderlays.read(q.buffer));
	let overlays = (await source.getFileArchive(configunderlaymeta[4]))
		.map(q => parseMapsquareOverlays.read(q.buffer));

	//TODO implement this again
	let originx = (opts?.centered ? (rect.x + rect.width / 2) * tiledimensions * squareWidth : 0);
	let originz = (opts?.centered ? (rect.y + rect.height / 2) * tiledimensions * squareHeight : 0);

	let chunkfloorpadding = (opts?.padfloor ? 1 : 0);
	let grid = new TileGrid(rect.x, rect.y, rect.width + chunkfloorpadding, rect.height + chunkfloorpadding);
	let chunks: ChunkData[] = [];
	for (let z = 0; z < rect.height + chunkfloorpadding; z++) {
		for (let x = 0; x < rect.width + chunkfloorpadding; x++) {
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
			grid.addMapsquare(chunk);

			//only add the actual ones we need to the queue
			if (chunk.mapsquarex < rect.x || chunk.mapsquarex >= rect.x + rect.width) { continue; }
			if (chunk.mapsquarez < rect.y || chunk.mapsquarez >= rect.y + rect.height) { continue; }
			chunks.push(chunk);
		}
	}

	grid.blendUnderlays();

	let squareDatas: { floors: FloorMeshData[], models: MapsquareLocation[], chunk: ChunkData }[] = [];

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
						.then(file => new ParsedTexture(file).toImageData())
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
			floors.push(await mapsquareMesh(grid, chunk, level, materials, atlas, false));
		}
		if (opts?.invisibleLayers) {
			for (let level = 0; level < squareLevels; level++) {
				floors.push(await mapsquareMesh(grid, chunk, level, materials, atlas, true));
			}
		}
		squareDatas.push({
			chunk,
			floors,
			models: await mapsquareObjects(source, chunk, grid)
		})
	}
	return squareDatas;
}

export async function mapsquareToGltf(source: CacheFileSource, chunks: typeof parseMapsquare extends (...args: any[]) => Promise<infer Q> ? Q : never) {
	let scene = new GLTFSceneCache(source.getFileById.bind(source));
	let nodes: number[] = [];

	for (let chunk of chunks) {
		let squarenodes: number[] = [];
		squarenodes.push(... (await Promise.all(chunk.floors.map(f => floorToGltf(scene, f)))).filter(q => q != -1));
		squarenodes.push(await mapSquareLocationsToGltf(scene, chunk.models));
		nodes.push(scene.gltf.addNode({
			children: squarenodes,
			translation: [
				chunk.chunk.xoffset * tiledimensions,//- originx,//TODO
				0,
				chunk.chunk.zoffset * tiledimensions //- originz
			]
		}));
	}

	let rootnode = scene.gltf.addNode({ children: nodes, scale: [1, 1, -1] });
	scene.gltf.addScene({ nodes: [rootnode] });
	let model = await scene.gltf.convert({ glb: true, singlefile: true });
	return model.mainfile;
}

export async function mapsquareToThree(source: CacheFileSource, chunks: typeof parseMapsquare extends (...args: any[]) => Promise<infer Q> ? Q : never) {
	let scene = new ThreejsSceneCache(source.getFileById.bind(source));
	let root = new THREE.Group();

	for (let chunk of chunks) {
		let node = new THREE.Group();
		node.matrixAutoUpdate = false;
		node.position.set(chunk.chunk.xoffset * tiledimensions, 0, chunk.chunk.zoffset * tiledimensions);
		node.updateMatrix();
		//TODO fix hidden floors tag
		node.add(... (await Promise.all(chunk.floors.filter(f => !f.showhidden).map(f => floorToThree(scene, f)))).filter(q => q) as any);
		node.add(await mapSquareLocationsToThree(scene, chunk.models));
		root.add(node);
	}

	// root.scale.set(1 / tiledimensions, 1 / tiledimensions, -1 / tiledimensions);
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
	padsize = 16;
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

type MapsquareLocation = {
	modelid: number,
	morph: FloorMorph,
	position: [number, number, number],
	posttransform?: {
		scale?: [number, number, number],
		translate?: [number, number, number],
		rotateY?: number
	},
	extras: ModelExtras
}

async function mapsquareObjects(source: CacheFileSource, chunk: ChunkData, grid: TileGrid) {
	let locationindex = chunk.cacheIndex.subindices.indexOf(0);
	if (locationindex == -1) { return []; }
	let locations = parseMapsquareLocations.read(chunk.archive[locationindex].buffer).locations;

	let rootx = chunk.xoffset * tiledimensions;
	let rootz = chunk.zoffset * tiledimensions;

	let models: MapsquareLocation[] = [];

	for (let loc of locations) {
		let objectfile = await source.getFileById(cacheMajors.objects, loc.id);
		let objectmeta = parseObject.read(objectfile);

		let posttransform: MapsquareLocation["posttransform"] = undefined;
		if (objectmeta.translateX || objectmeta.translateY || objectmeta.translateZ) {
			posttransform ||= {};
			const translatefactor = 4;//no clue why but seems right
			posttransform.translate = [
				(objectmeta.translateX ?? 0) * translatefactor,
				(objectmeta.translateY ?? 0) * translatefactor,
				(objectmeta.translateZ ?? 0) * translatefactor
			];
		}
		if (objectmeta.scaleX || objectmeta.scaleY || objectmeta.scaleZ) {
			posttransform ||= {};
			const scalefactor = 1 / 128;//estimated fit was 127.5 ...
			posttransform.scale = [
				(objectmeta.scaleX ?? 128) * scalefactor,
				(objectmeta.scaleY ?? 128) * scalefactor,
				(objectmeta.scaleZ ?? 128) * scalefactor
			];
		}

		instloop: for (let inst of loc.uses) {
			// if(loc.id<63151-10||loc.id>63151+10){continue}
			// if (inst.x > 2 || inst.y < 17 || inst.y > 20) { continue }
			// if (inst.x != 3347 % 64 || inst.y != 3085 % 64) { continue; }
			//if (loc.id > 63002 - 100 && loc.id < 63002 + 100) { continue; }//TODO unhide dominion tower

			let sizex = (objectmeta.width ?? 1);
			let sizez = (objectmeta.length ?? 1);

			// let callingtile = grid.getTile(inst.x + chunk.xoffset, inst.y + chunk.zoffset, inst.plane);

			//models have their center in the middle, but they always rotate such that their southwest corner
			//corresponds to the southwest corner of the tile
			if ((inst.rotation % 2) == 1) {
				//flip offsets if we are rotated with 90deg or 270deg
				[sizex, sizez] = [sizez, sizex];
			}

			let extras = {
				modeltype: "location",
				modelgroup: "objects",
				locationid: loc.id,
				worldx: chunk.xoffset + inst.x,
				worldz: chunk.zoffset + inst.y,
				rotation: inst.rotation,
				mirror: !!objectmeta.mirror,
				level: inst.plane,
				// callingtile,
				locationInstance: inst
			} as ModelExtras;

			let modely: number;

			//TODO find out the meaning of this
			//TODO thse are definitely wrong
			let linkabove = typeof objectmeta.unknown_5F != "undefined"; //((objectmeta.tileMorph ?? 0) & 2) != 0;
			let followfloor = linkabove || !!objectmeta.unknown_15; //((objectmeta.tileMorph ?? 0) & 1) != 0 || linkabove;
			let morph: FloorMorph = {
				width: objectmeta.width ?? 1,
				length: objectmeta.length ?? 1,
				mirror: !!objectmeta.mirror,
				rotation: inst.rotation,
				tiles: undefined,
				scaleModelHeight: false,
				scaleModelHeightOffset: 0
			};
			if (followfloor || linkabove) {
				let tilemorphs: TileMorph[] = [];
				for (let dz = 0; dz < sizez; dz++) {
					for (let dx = 0; dx < sizex; dx++) {
						let pl = grid.getObjectPlacement(chunk.xoffset + inst.x + dx, chunk.zoffset + inst.y + dz, inst.plane, linkabove, 0, false)
						if (!pl) {
							console.log("could not find multitile placement")
							continue instloop;
						}
						tilemorphs.push(pl);
					}
				}
				if (linkabove) {
					morph.scaleModelHeight = true;
					morph.scaleModelHeightOffset = objectmeta.unknown_5F ?? 0;
				}
				morph.tiles = tilemorphs;
				modely = 0//TODO give it a logical y again
			} else {
				let y00 = grid.getTile(inst.x + chunk.xoffset, inst.y + chunk.zoffset, inst.plane)!.y;
				let y01 = grid.getTile(inst.x + chunk.xoffset + sizex - 1, inst.y + chunk.zoffset, inst.plane)?.y01 ?? y00;
				let y10 = grid.getTile(inst.x + chunk.xoffset, inst.y + chunk.zoffset + sizez - 1, inst.plane)?.y10 ?? y00;
				let y11 = grid.getTile(inst.x + chunk.xoffset + sizex - 1, inst.y + chunk.zoffset + sizez - 1, inst.plane)?.y11 ?? y00;

				//TODO there it probably more logic and a flag that toggles between average and min

				modely = (sizex > 1 || sizez > 1 ? Math.min(y00, y01, y10, y11) : (y00 + y01 + y10 + y11) / 4);
			}

			for (let ch of objectmeta.models ?? []) {
				if (ch.type != inst.type) { continue; }
				for (let modelid of ch.values) {
					models.push({
						extras,
						modelid,
						morph,
						posttransform,
						position: [
							(chunk.xoffset + inst.x + sizex / 2) * tiledimensions - rootx,
							modely,
							(chunk.zoffset + inst.y + sizez / 2) * tiledimensions - rootz
						]
					});
				}
			}
		}
	}
	return models;
}

async function mapSquareLocationsToGltf(scene: GLTFSceneCache, models: MapsquareLocation[]) {
	let modelcache = new Map<number, { modeldata: ModelData, gltfmesh: number }>();
	let nodes: number[] = [];

	for (let obj of models) {
		let model = modelcache.get(obj.modelid);
		if (!model) {
			let file = await scene.getFileById(cacheMajors.models, obj.modelid);
			let modeldata = parseOb3Model(new Stream(file), {});
			model = { modeldata, gltfmesh: -1 };
			modelcache.set(obj.modelid, model);
		}

		if (obj.morph.tiles) {
			//generate morphed model
			let morphmesh = model.modeldata.meshes.map(m => transformMesh(m, obj.morph, model!.modeldata.maxy));
			let mesh = await addOb3Model(scene, { maxy: model.modeldata.maxy, meshes: morphmesh });
			nodes.push(scene.gltf.addNode({
				mesh: mesh,
				translation: obj.position,
				extras: obj.extras,
			}));
		} else {
			//cache and reuse the model if it only has afine transforms
			if (model.gltfmesh == -1) {
				model.gltfmesh = await addOb3Model(scene, model.modeldata);
			}
			//0-3 rotation for 0-270 degrees
			//i messed up something with the quaternion, but this transform worked..
			let rotation = (-obj.morph.rotation + 2) / 4 * Math.PI * 2;
			nodes.push(scene.gltf.addNode({
				mesh: model.gltfmesh,
				translation: obj.position,
				scale: [1, 1, (obj.morph.mirror ? -1 : 1)],
				//quaternions, have fun
				rotation: [0, Math.cos(rotation / 2), 0, Math.sin(rotation / 2)],
				extras: obj.extras,
			}));
		}
	}

	return scene.gltf.addNode({ children: nodes });
}
async function mapSquareLocationsToThree(scene: ThreejsSceneCache, models: MapsquareLocation[]) {
	let modelcache = new Map<number, { modeldata: ModelData, instancemesh: THREE.Object3D | undefined }>();
	let nodes: THREE.Object3D[] = [];

	for (let obj of models) {
		let model = modelcache.get(obj.modelid);
		if (!model) {
			let file = await scene.getFileById(cacheMajors.models, obj.modelid);
			let modeldata = parseOb3Model(new Stream(file), {});
			model = { modeldata, instancemesh: undefined };
			modelcache.set(obj.modelid, model);
		}

		let node: Object3D;

		if (obj.morph.tiles) {
			//generate morphed model
			let morphmesh = model.modeldata.meshes.map(m => transformMesh(m, obj.morph, model!.modeldata.maxy));
			node = await ob3ModelToThree(scene, { maxy: model.modeldata.maxy, meshes: morphmesh });
			node.position.set(...obj.position);
		} else {
			//cache and reuse the model if it only has afine transforms
			if (!model.instancemesh) {
				model.instancemesh = await ob3ModelToThree(scene, model.modeldata);
			}
			node = model.instancemesh.clone(true);
			node.rotation.set(0, obj.morph.rotation / 4 * 2 * Math.PI, 0);
			if (obj.morph.mirror) {
				node.scale.multiply(new THREE.Vector3(1, 1, -1));
			}
		}
		node.userData = obj.extras;
		node.position.set(...obj.position);
		node.userData = obj.extras;
		if (obj.posttransform) {
			if (obj.posttransform.translate) {
				let tr = obj.posttransform.translate;
				//no clue why it is -y and +x +z
				node.position.add(new THREE.Vector3(tr[0], -tr[1], tr[2]));
				node.updateMatrix();
			}
			if (obj.posttransform.scale) {
				node.scale.multiply(new THREE.Vector3(...obj.posttransform.scale));
				node.updateMatrix();
			}
			if (obj.posttransform.rotateY) {
				node.rotateY(obj.posttransform.rotateY);
			}
		}
		node.matrixAutoUpdate = false;
		node.updateMatrix();
		nodes.push(node);
	}
	let root = new THREE.Group();
	root.add(...nodes);
	return root;
}

async function mapsquareMesh(grid: TileGrid, chunk: ChunkData, level: number, materials: Map<number, MaterialData>, atlas: SimpleTexturePacker, showhidden: boolean) {
	const maxtiles = squareWidth * squareHeight * squareLevels;
	const maxVerticesPerTile = 8;
	const posoffset = 0;// 0/4
	const normaloffset = 3;// 12/4
	const coloroffset = 24;// 24/1
	const texweightoffset = 28;// 28/1
	const texuvoffset = 16;// 32/2
	const vertexstride = 48;
	//overalloce worst case scenario
	let vertexbuffer = new ArrayBuffer(maxtiles * vertexstride * maxVerticesPerTile);
	let indexbuffer = new Uint16Array(maxtiles * maxVerticesPerTile);
	let posbuffer = new Float32Array(vertexbuffer);//size 12 bytes
	let normalbuffer = new Float32Array(vertexbuffer);//size 12 bytes
	let colorbuffer = new Uint8Array(vertexbuffer);//4 bytes
	let texweightbuffer = new Uint8Array(vertexbuffer);//4 bytes
	let texuvbuffer = new Uint16Array(vertexbuffer);//16 bytes [u,v][4]
	const posstride = vertexstride / 4 | 0;//position indices to skip per vertex (cast to int32)
	const normalstride = vertexstride / 4 | 0;//normal indices to skip per vertex (cast to int32)
	const colorstride = vertexstride | 0;//color indices to skip per vertex (cast to int32)
	const texweightstride = vertexstride | 0;
	const textuvstride = vertexstride / 2 | 0;

	let vertexindex = 0;
	let indexpointer = 0;

	const modelx = chunk.xoffset * tiledimensions;
	const modelz = chunk.zoffset * tiledimensions;

	let minx = Infinity, miny = Infinity, minz = Infinity;
	let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
	const writeVertex = (tile: TileProps, subx: number, subz: number, color: number[], mats: SimpleTexturePackerAlloc[], currentmat: number) => {
		const pospointer = vertexindex * posstride + posoffset;
		const normalpointer = vertexindex * normalstride + normaloffset;
		const colpointer = vertexindex * colorstride + coloroffset;
		const texweightpointer = vertexindex * texweightstride + texweightoffset;
		const texuvpointer = vertexindex * textuvstride + texuvoffset;

		//TODO remove
		// subz = 1 - subz;
		const x = tile.x + subx * tiledimensions - modelx;
		const y = tile.y * (1 - subx) * (1 - subz) + tile.y01 * subx * (1 - subz) + tile.y10 * (1 - subx) * subz + tile.y11 * subx * subz;
		const z = tile.z + subz * tiledimensions - modelz;
		// subz = 1 - subz;

		minx = Math.min(minx, x); miny = Math.min(miny, y); minz = Math.min(minz, z);
		maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); maxz = Math.max(maxz, z);
		posbuffer[pospointer + 0] = x;
		posbuffer[pospointer + 1] = y;
		posbuffer[pospointer + 2] = z;
		normalbuffer[normalpointer + 0] = tile.normalX;
		normalbuffer[normalpointer + 1] = Math.sqrt(1 - tile.normalX * tile.normalX - tile.normalZ * tile.normalZ);
		normalbuffer[normalpointer + 2] = tile.normalZ;
		colorbuffer[colpointer + 0] = color[0];
		colorbuffer[colpointer + 1] = color[1];
		colorbuffer[colpointer + 2] = color[2];

		for (let i = 0; i < mats.length; i++) {
			const texdata = mats[i];
			let gridsize = texdata.img.width / 128;//TODO is the 4/512 a constant?
			let ubase = (tile.x / tiledimensions) % gridsize;
			let vbase = (tile.z / tiledimensions) % gridsize;
			const maxuv = 0x10000;
			texuvbuffer[texuvpointer + 2 * i + 0] = (texdata.u + texdata.usize * (ubase + subx) / gridsize) * maxuv;
			texuvbuffer[texuvpointer + 2 * i + 1] = (texdata.v + texdata.vsize * (vbase + subz) / gridsize) * maxuv;
			texweightbuffer[texweightpointer + i] = (i == currentmat ? 255 : 0);
		}

		return vertexindex++;
	}

	for (let z = 0; z < squareHeight; z++) {
		for (let x = 0; x < squareWidth; x++) {
			let tile = grid.getTile(chunk.xoffset + x, chunk.zoffset + z, level);
			if (!tile) { continue; }
			let rawtile = tile.raw;

			let shape = tile.shape;

			if (shape.overlay.length != 0) {
				let overlaytype = chunk.overlays[typeof rawtile.overlay == "number" ? rawtile.overlay - 1 : 0];
				let color = overlaytype.primary_colour ?? [255, 0, 255];
				let isvisible = color[0] != 255 || color[1] != 0 || color[2] != 255;
				if (isvisible || showhidden) {
					let props = shape.overlay.map(vertex => {
						if (!overlaytype.unknown_0x0C) { return tile!.overlayprops; }
						else {
							let node: TileProps | undefined = tile;
							if (vertex.nextx && vertex.nextz) { node = tile!.next11; }
							else if (vertex.nextx) { node = tile!.next01; }
							else if (vertex.nextz) { node = tile!.next10; }
							if (node) { return node.vertexprops[vertex.subvertex]; }
						}
						return defaultVertexProp;
					});
					let mats = props.map(prop => {
						if (prop && prop.material != -1) {
							let mat = materials.get(prop.material);
							if (mat?.textures.diffuse) {
								return atlas.map.get(mat.textures.diffuse);
							}
						}
						return undefined;
					});
					for (let i = 2; i < shape.overlay.length; i++) {
						let mat0 = mats[0];
						let mat1 = mats[i - 1];
						let mat2 = mats[i];
						//TODO continue with white instead
						if (!mat0 || !mat1 || !mat2) { continue; }

						let submats = [mat0, mat1, mat2];
						let v0 = shape.overlay[0];
						let v1 = shape.overlay[i - 1];
						let v2 = shape.overlay[i];

						indexbuffer[indexpointer++] = writeVertex(tile, v0.subx, v0.subz, props[0].color, submats, 0);
						indexbuffer[indexpointer++] = writeVertex(tile, v1.subx, v1.subz, props[i - 1].color, submats, 1);
						indexbuffer[indexpointer++] = writeVertex(tile, v2.subx, v2.subz, props[i].color, submats, 2);
					}
				}
			}
			if (shape.underlay.length != 0) {
				if (tile.next01 && tile.next10 && tile.next11) {
					let props = shape.underlay.map(vertex => {
						let node: TileProps | undefined = tile;
						if (vertex.nextx && vertex.nextz) { node = tile!.next11; }
						else if (vertex.nextx) { node = tile!.next01; }
						else if (vertex.nextz) { node = tile!.next10; }
						if (node) { return node.vertexprops[vertex.subvertex]; }
						return defaultVertexProp;
					});
					let mats = props.map(prop => {
						if (prop && prop.material != -1) {
							let mat = materials.get(prop.material);
							if (mat?.textures.diffuse) {
								return atlas.map.get(mat.textures.diffuse);
							}
						}
						return undefined;
					});
					for (let i = 2; i < shape.underlay.length; i++) {
						let mat0 = mats[0];
						let mat1 = mats[i - 1];
						let mat2 = mats[i];
						//TODO continue with white instead
						if (!mat0 || !mat1 || !mat2) { continue; }
						let submats = [mat0, mat1, mat2];

						let v0 = shape.underlay[0];
						let v1 = shape.underlay[i - 1];
						let v2 = shape.underlay[i];

						indexbuffer[indexpointer++] = writeVertex(tile, v0.subx, v0.subz, props[0].color, submats, 0);
						indexbuffer[indexpointer++] = writeVertex(tile, v1.subx, v1.subz, props[i - 1].color, submats, 1);
						indexbuffer[indexpointer++] = writeVertex(tile, v2.subx, v2.subz, props[i].color, submats, 2);
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
		level: level
	};

	return {
		chunk,
		level,
		showhidden,

		buffer: new Uint8Array(vertexbuffer, 0, vertexindex * vertexstride),
		vertexstride: vertexstride,
		indices: new Uint16Array(indexbuffer.buffer, indexbuffer.byteOffset, indexpointer),
		nvertices: vertexindex,
		atlas,

		pos: { src: posbuffer as ArrayBufferView, offset: posoffset, vecsize: 3, normalized: false },
		normal: { src: normalbuffer, offset: normaloffset, vecsize: 3, normalized: false },
		color: { src: colorbuffer, offset: coloroffset, vecsize: 3, normalized: true },
		_RA_FLOORTEX_UV01: { src: texuvbuffer, offset: texuvoffset + 0, vecsize: 4, normalized: true },
		_RA_FLOORTEX_UV23: { src: texuvbuffer, offset: texuvoffset + 4, vecsize: 4, normalized: true },
		_RA_FLOORTEX_WEIGHTS: { src: texweightbuffer, offset: texweightoffset, vecsize: 4, normalized: true },

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

async function floorToGltf(scene: GLTFSceneCache, floor: FloorMeshData) {
	if (floor.nvertices == 0) { return -1; }
	let attrs: MeshPrimitive["attributes"] = {};

	//TODO either ref or copy all the buffers
	let gltf = scene.gltf;
	let view = gltf.addBufferWithView(floor.buffer, floor.vertexstride, false);
	let addAccessor = (name: string, attr: FloorMeshData["pos"], max?: number[] | undefined, min?: number[] | undefined) => {
		let type = Object.values(glTypeIds).find(q => attr.src instanceof q.constr)!;
		return gltf.addAttributeAccessor({
			byteoffset: attr.offset * type.constr.BYTES_PER_ELEMENT,
			bytestride: floor.vertexstride,
			max: max!,
			min: min!,
			gltype: type.gltype,
			name,
			normalize: attr.normalized,
			veclength: attr.vecsize
		}, view, floor.nvertices);
	}
	attrs.POSITION = addAccessor("position", floor.pos, floor.posmax, floor.posmin);
	attrs.NORMAL = addAccessor("normals", floor.normal);
	attrs.COLOR_0 = addAccessor("color", floor.color)
	attrs._RA_FLOORTEX_UV01 = addAccessor("texuv_01", floor._RA_FLOORTEX_UV01);
	attrs._RA_FLOORTEX_UV23 = addAccessor("texuv_23", floor._RA_FLOORTEX_UV23);
	attrs._RA_FLOORTEX_WEIGHTS = addAccessor("texuv_weights", floor._RA_FLOORTEX_WEIGHTS);

	let floortex = -1;
	if (!floor.showhidden) {
		let atlasimg = floor.atlas.convert();
		let img = sharp(Buffer.from(atlasimg.data.buffer), { raw: { width: atlasimg.width, height: atlasimg.height, channels: 4 } });
		let atlasfile = await img.png().toBuffer({ resolveWithObject: false });
		floortex = gltf.addImageWithTexture(atlasfile);
		gltf.addExtension("RA_FLOORTEX", false);
	}
	let viewIndex = gltf.addBufferWithView(floor.indices, undefined, true);
	let indices = gltf.addAccessor({
		componentType: glTypeIds.u16.gltype,
		count: floor.indices.length,
		type: "SCALAR",
		bufferView: viewIndex
	});

	let floormaterial = gltf.addMaterial({
		alphaMode: "MASK",
		alphaCutoff: 0.9,
		pbrMetallicRoughness: (floortex != -1 ? {
			baseColorTexture: { index: floortex }
		} : undefined)
	});

	let mesh = gltf.addMesh({
		primitives: [{
			attributes: attrs,
			indices: indices,
			material: floormaterial,
		}]
	});
	return gltf.addNode({
		mesh,
		extensions: (floortex != -1 ? { RA_FLOORTEX: {} } : undefined),
		extras: floor.extra
	});
}
