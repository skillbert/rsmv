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
import { addOb3Model, parseOb3Model, GLTFSceneCache, ModelMeshData } from "./ob3togltf";
import { mapsquare_tiles } from "../../generated/mapsquare_tiles";
import { mapsquare_watertiles } from "../../generated/mapsquare_watertiles";
import * as fs from "fs";
import sharp from "sharp";

//can't use module import syntax because es6 wants to be more es6 than es6
const THREE = require("three/build/three.js") as typeof import("three");

const tiledimensions = 512;
const squareWidth = 64;
const squareHeight = 64
const squareLevels = 4;
const heightScale = 1 / 16;
const worldStride = 128;

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
	raw01: mapsquare_tiles[number] | undefined,
	raw10: mapsquare_tiles[number] | undefined,
	raw11: mapsquare_tiles[number] | undefined,
	x: number,
	y: number,
	z: number,
	y10: number,
	y01: number,
	y11: number,
	visible: boolean,
	underlayR: number,
	underlayG: number,
	underlayB: number,
	blendedR: number,
	blendedG: number,
	blendedB: number,
	normalX: number,
	normalZ: number
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
	tiles: TileMorph[]
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

export function transformMesh(mesh: ModelMeshData, morph: FloorMorph) {
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
	let newpos = new Float32Array(pos.length);
	for (let i = 0; i < pos.length; i += 3) {
		let x = pos[i + 0];
		let y = pos[i + 1];
		let z = pos[i + 2];
		let newx = x * q00 + z * q01;
		let newz = x * q10 + z * q11;
		let tilex = Math.max(0, Math.min(xsize - 1, Math.floor(newx / tiledimensions + roundoffsetx)));
		let tilez = Math.max(0, Math.min(zsize - 1, Math.floor(newz / tiledimensions + roundoffsetz)));
		let tile = morph.tiles[tilex + tilez * xsize];
		let dx = newx + (-tilex + roundoffsetx - 0.5) * tiledimensions;
		let dy = y;
		let dz = newz + (-tilez + roundoffsetz - 0.5) * tiledimensions;
		let newy = tile.constant// + y
			+ tile.linear[0] * dx + tile.linear[1] * dy + tile.linear[2] * dz
			+ tile.quadratic[0] * dx * dy + tile.quadratic[1] * dy * dz + tile.quadratic[2] * dz * dx
			+ tile.cubic * dx * dy * dz
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

	return {
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
	} as ModelMeshData
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
	//perpeties of the southwest corner of each tile
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
	getObjectPlacement(x: number, z: number, plane: number, linkabove: boolean, modelheight: number, rotation: number, mirror: boolean) {
		//TODO can actually get rid fo the y01 thing again if we're doing 4 lookups anyway
		// let originx = (x+xsize/2)*tiledimensions;
		// let originz = (z+zsize/2)*tiledimensions;
		// x+=Math.floor((xsize-1)/2);xsize=1;
		// z+=Math.floor((zsize-1)/2);zsize=1;
		//if(x==3130 && z==3520 && plane==0){			debugger;		}

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

		if ((rotation % 2 == 1) != mirror) { dydxz = -dydxz; }
		if (rotation == 1) { [dydx, dydz] = [-dydz, dydx]; }
		if (rotation == 2) { [dydx, dydz] = [-dydx, -dydz]; }
		if (rotation == 3) { [dydx, dydz] = [dydz, -dydx]; }
		if (mirror) { dydz = -dydz; }

		let dydxy = 0;
		let dydyz = 0;
		let dydxyz = 0;
		let dydy = 1;


		//TODO remove
		// let test = (dx: number, dy: number, dz: number) => originy
		// 	+ dydx * dx + dydy * dy + dydz * dz
		// 	+ dydxy * dx * dy + dydyz * dy * dz + dydxz * dz * dx
		// 	+ dydxyz * dx * dy * dz;

		// let d = 0;
		// d += Math.abs(test(-256, 0, -256) - tile.y);
		// d += Math.abs(test(256, 0, -256) - tile.y01);
		// d += Math.abs(test(-256, 0, 256) - tile.y10);
		// d += Math.abs(test(256, 0, 256) - tile.y11);
		// if (d > 1) { debugger; }

		if (linkabove) {
			//TODO remove
			const baseheight = modelheight;
			let roof = this.getObjectPlacement(x, z, plane + 1, false, 0, rotation, mirror);
			if (roof) {
				dydy = (roof.constant - originy) / baseheight;
				dydxy = (roof.linear[0] - dydx) / baseheight;
				dydyz = (roof.linear[2] - dydz) / baseheight;
				dydxyz = (roof.quadratic[2] - dydxz) / baseheight;

				//TODO remove
				// let rtile = this.getTile(x, z, plane + 1)!;
				// let d = 0;
				// d += Math.abs(test(-256, modelheight, -256) - rtile.y);
				// d += Math.abs(test(256, modelheight, -256) - rtile.y01);
				// d += Math.abs(test(-256, modelheight, 256) - rtile.y10);
				// d += Math.abs(test(256, modelheight, 256) - rtile.y11);
				// if (d > 1) { debugger; }
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
			modelheight
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
								r += tile.underlayR;
								g += tile.underlayG;
								b += tile.underlayB;
								count++;
							}
						}
						currenttile.blendedR = r / count;
						currenttile.blendedG = g / count;
						currenttile.blendedB = b / count;
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

					currenttile.raw01 = xnext?.raw;
					currenttile.raw10 = znext?.raw;
					currenttile.raw11 = xznext?.raw;
				}
			}
		}
	}
	addMapsquare(chunk: ChunkData) {
		const tiles = chunk.tiles;
		if (tiles.length != squareWidth * squareHeight * squareLevels) { throw new Error(); }
		let baseoffset = (chunk.xoffset - this.xoffset) * this.xstep + (chunk.zoffset - this.zoffset) * this.zstep;
		for (let z = 0; z < squareHeight; z++) {
			for (let x = 0; x < squareWidth; x++) {
				let tileindex = z + x * squareWidth;//TODO are these flipped
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
					let color = [255, 0, 255];
					let visible = false;
					if (typeof tile.underlay != "undefined") {
						//TODO bound checks
						let underlay = chunk.underlays[tile.underlay - 1];
						if (underlay?.color) {
							color = underlay.color;
							if (color[0] != 255 || color[1] != 0 || color[2] != 255) {
								visible = true;
							}
						}
					}
					let newindex = baseoffset + this.xstep * x + this.zstep * z + this.levelstep * level;
					//let newindex = this.levelstep * level + (z + chunk.zoffset - this.zoffset) * this.zstep + (x + chunk.xoffset - this.xoffset) * this.xstep
					let y = height * tiledimensions * heightScale;
					let parsedTile: TileProps = {
						raw: tile,
						raw01: undefined,
						raw10: undefined,
						raw11: undefined,
						x: tilex,
						y: y,
						z: tilez,
						y01: y, y10: y, y11: y,
						visible,
						underlayR: color[0], underlayG: color[1], underlayB: color[2],
						blendedR: 0, blendedG: 0, blendedB: 0,
						normalX: 0, normalZ: 0
					}
					this.tiles[newindex] = parsedTile;
					tileindex += squareWidth * squareHeight;
				}
			}
		}
	}
}

export async function mapsquareToGltf(source: CacheFileSource, rect: { x: number, y: number, width: number, height: number }, opts?: { centered?: boolean, padfloor?: boolean, invisibleLayers?: boolean }) {

	let scene = new GLTFSceneCache(source.getFileById.bind(source));


	//TODO proper erroring on nulls
	let configunderlaymeta = await source.getIndexFile(cacheMajors.config);
	let underarch = await source.getFileArchive(configunderlaymeta[1]);
	let underlays = underarch.map(q => parseMapsquareUnderlays.read(q.buffer));
	let overlays = (await source.getFileArchive(configunderlaymeta[4]))
		.map(q => parseMapsquareOverlays.read(q.buffer));


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

			//only ad the actual ones we need to the queue
			if (chunk.mapsquarex < rect.x || chunk.mapsquarex >= rect.x + rect.width) { continue; }
			if (chunk.mapsquarez < rect.y || chunk.mapsquarez >= rect.y + rect.height) { continue; }
			chunks.push(chunk);
		}
	}

	grid.blendUnderlays();
	let nodes: number[] = [];
	for (let chunk of chunks) {
		let squarenodes: number[] = [];
		for (let level = 0; level < squareLevels; level++) {
			let meshnode = await mapsquareMesh(scene, grid, chunk, level, false);
			if (meshnode != -1) { squarenodes.push(meshnode); };
		}
		if (opts?.invisibleLayers) {
			for (let level = 0; level < squareLevels; level++) {
				let hiddennode = await mapsquareMesh(scene, grid, chunk, level, true);
				if (hiddennode != -1) { squarenodes.push(hiddennode); }
			}
		}
		let objectsnode = await mapsquareObjects(scene, chunk, grid);
		squarenodes.push(objectsnode);
		nodes.push(scene.gltf.addNode({
			children: squarenodes,
			translation: [
				chunk.xoffset * tiledimensions - originx,
				0,
				chunk.zoffset * tiledimensions - originz
			]
		}));
	}
	let rootnode = scene.gltf.addNode({ children: nodes, scale: [1, 1, -1] });
	scene.gltf.addScene({ nodes: [rootnode] });
	let model = await scene.gltf.convert({ glb: true, singlefile: true });
	return model.mainfile;
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

type TileMaterialWeight = { weightx: number, weightz: number, alloc: SimpleTexturePackerAlloc };

type SimpleTexturePackerAlloc = { u: number, v: number, usize: number, vsize: number, x: number, y: number, img: ImageData }

class SimpleTexturePacker {
	padsize = 16;
	size: number;
	allocs: SimpleTexturePackerAlloc[] = [];
	allocx = 0;
	allocy = 0;
	allocLineHeight = 0;
	constructor(size: number) {
		this.size = size;
	}

	addTexture(img: ImageData) {
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
		return alloc;
	}
	async convert() {
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

async function mapsquareObjects(scene: GLTFSceneCache, chunk: ChunkData, grid: TileGrid) {
	let locationindex = chunk.cacheIndex.subindices.indexOf(0);
	if (locationindex == -1) { return scene.gltf.addNode({}); }
	let locations = parseMapsquareLocations.read(chunk.archive[locationindex].buffer).locations;

	let rootx = chunk.xoffset * tiledimensions;
	let rootz = chunk.zoffset * tiledimensions;
	let nodes: number[] = [];
	for (let loc of locations) {
		let objectfile = await scene.getFileById(cacheMajors.objects, loc.id);
		let objectmeta = parseObject.read(objectfile);
		//TODO yikes
		//rework the whole model loading strategy
		//make the model loader reserve a mesh slot and return immediately with the 
		//reserved id and add a promise to the queue
		let modelids = objectmeta.models?.flatMap(q => q.values.map(v => ({ type: q.type, value: v }))) ?? [];
		var meshes = await Promise.all(modelids.map(async m => {
			let file = await scene.getFileById(cacheMajors.models, m.value);
			let modeldata = parseOb3Model(new Stream(file), {});
			let mesh = await addOb3Model(scene, modeldata);
			return { type: m.type, mesh: mesh.mesh, maxy: mesh.maxy, modeldata };
		}));

		instloop: for (let inst of loc.uses) {
			// if(loc.id<63151-10||loc.id>63151+10){continue}
			// if (inst.x > 2 || inst.y < 17 || inst.y > 20) { continue }
			// if (inst.x != 3347 % 64 || inst.y != 3085 % 64) { continue; }
			//if (loc.id > 63002 - 100 && loc.id < 63002 + 100) { continue; }//TODO unhide dominion tower

			let sizex = (objectmeta.width ?? 1);
			let sizez = (objectmeta.length ?? 1);

			let maxy = 0;
			let visiblemeshes = 0;
			for (let mesh of meshes) {
				if (mesh.type != inst.type) { continue; }
				maxy = Math.max(maxy, mesh.maxy);
				visiblemeshes++;
			}

			let callingtile = grid.getTile(inst.x + chunk.xoffset, inst.y + chunk.zoffset, inst.plane);

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
				callingtile,
				locationInstance: inst
			} as ModelExtras;

			//TODO find out the meaning of this
			//TODO thse are definitely wrong
			let linkabove = ((objectmeta.tileMorph ?? 0) & 2) != 0;
			let followfloor = ((objectmeta.tileMorph ?? 0) & 1) != 0 || linkabove;
			if ((followfloor || linkabove) && (sizex > 1 || sizez > 1)) {
				let tilemorphs: TileMorph[] = [];
				for (let dz = 0; dz < sizez; dz++) {
					for (let dx = 0; dx < sizex; dx++) {
						let pl = grid.getObjectPlacement(chunk.xoffset + inst.x + dx, chunk.zoffset + inst.y + dz, inst.plane, linkabove, maxy, 0, false)
						if (!pl) {
							console.log("could not find multitile placement")
							continue instloop;
						}
						tilemorphs.push(pl);
					}
				}
				let morph: FloorMorph = {
					width: objectmeta.width ?? 1,
					length: objectmeta.length ?? 1,
					mirror: !!objectmeta.mirror,
					rotation: inst.rotation,
					tiles: tilemorphs
				};
				let children: number[] = [];
				// let box = boxMesh(morph.width * tiledimensions, morph.length * tiledimensions, maxy);
				// box = transformMesh(box, morph);
				// children.push(scene.gltf.addNode({ mesh: (await addOb3Model(scene, [box])).mesh }))
				for (let ch of meshes) {
					if (ch.type != inst.type) { continue; }
					let morphmesh = ch.modeldata.map(m => transformMesh(m, morph));
					let mesh = await addOb3Model(scene, morphmesh);
					children.push(scene.gltf.addNode({ mesh: mesh.mesh }));
				}
				if (children.length != 0) {
					nodes.push(scene.gltf.addNode({
						children,
						translation: [
							(chunk.xoffset + inst.x + sizex / 2) * tiledimensions - rootx,
							0,//TODO give it a logical y again
							(chunk.zoffset + inst.y + sizez / 2) * tiledimensions - rootz
						],
						extras,
					}));
				}
			} else {
				let placement = grid.getObjectPlacement(inst.x + chunk.xoffset, inst.y + chunk.zoffset, inst.plane, linkabove, maxy, inst.rotation, !!objectmeta.mirror);
				if (!placement) {
					console.log("couldnt find object placement at", inst.x, inst.y);
					continue;
				}
				let children: number[] = [];
				for (let ch of meshes) {
					//TODO dedupe this
					if (ch.type != inst.type) { continue; }
					let mesh = await addOb3Model(scene, ch.modeldata);
					children.push(scene.gltf.addNode({ mesh: mesh.mesh }));
				}
				//0-3 rotation for 0-270 degrees
				//i messed up something with the quaternion, but this transform worked..
				let rotation = (-inst.rotation + 2) / 4 * Math.PI * 2;
				let modely = placement.constant;
				placement.constant = 0;
				if (children.length != 0) {
					nodes.push(scene.gltf.addNode({
						children,
						translation: [
							(chunk.xoffset + inst.x + sizex / 2) * tiledimensions - rootx,
							modely,
							(chunk.zoffset + inst.y + sizez / 2) * tiledimensions - rootz
						],
						scale: [1, 1, (objectmeta.mirror ? -1 : 1)],
						//quaternions, have fun
						rotation: [0, Math.cos(rotation / 2), 0, Math.sin(rotation / 2)],
						extensions: {
							RA_nodes_floortransform: (followfloor ? placement : undefined)
						},
						extras,
					}));
				}
			}
		}
	}

	scene.gltf.addExtension("RA_nodes_floortransform", false);
	return scene.gltf.addNode({ children: nodes });
}

async function mapsquareMesh(scene: GLTFSceneCache, grid: TileGrid, chunk: ChunkData, level: number, showhidden: boolean) {
	const maxtiles = squareWidth * squareHeight * squareLevels;
	const maxVerticesPerTile = 8;
	const vertexstride = 4 * 3 + 4 * 3 + 4 + 8 * 4;//3x float32 pos, 3x uint8 pos, aligned
	//overalloce worst case scenario
	let vertexbuffer = new ArrayBuffer(maxtiles * vertexstride * maxVerticesPerTile);
	let indexbuffer = new Uint16Array(maxtiles * maxVerticesPerTile);
	let posbuffer = new Float32Array(vertexbuffer, 0);//offset 0, size 12 bytes
	let normalbuffer = new Float32Array(vertexbuffer, 12);//offset 12, size 12 bytes
	let colorbuffer = new Uint8Array(vertexbuffer, 24);//offset 24, size 4 bytes
	let texweightbuffer = new Uint8Array(vertexbuffer, 28);//4 bytes
	let texuvbuffer = new Uint16Array(vertexbuffer, 32);//16 bytes [u,v][4]
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
	const writeVertex = (origintile: TileProps, tile: TileProps, color: number[], mats: TileMaterialWeight[]) => {
		const pospointer = vertexindex * posstride;
		const normalpointer = vertexindex * normalstride;
		const colpointer = vertexindex * colorstride;
		const texweightpointer = vertexindex * texweightstride;
		const texuvpointer = vertexindex * textuvstride;

		const x = tile.x - modelx;
		const z = tile.z - modelz;
		minx = Math.min(minx, x); miny = Math.min(miny, tile.y); minz = Math.min(minz, z);
		maxx = Math.max(maxx, x); maxy = Math.max(maxy, tile.y); maxz = Math.max(maxz, z);
		posbuffer[pospointer + 0] = x;
		posbuffer[pospointer + 1] = tile.y;
		posbuffer[pospointer + 2] = z;
		normalbuffer[normalpointer + 0] = tile.normalX;
		normalbuffer[normalpointer + 1] = Math.sqrt(1 - tile.normalX * tile.normalX - tile.normalZ * tile.normalZ);
		normalbuffer[normalpointer + 2] = tile.normalZ;
		colorbuffer[colpointer + 0] = color[0];
		colorbuffer[colpointer + 1] = color[1];
		colorbuffer[colpointer + 2] = color[2];

		const weightx = (tile.x - origintile.x) / tiledimensions;
		const weightz = (tile.z - origintile.z) / tiledimensions;
		// let corners: any[] = [];
		for (let i = 0; i < mats.length; i++) {
			const mat = mats[i];
			const texdata = mat.alloc;
			let dx = Math.abs(weightx - mat.weightx);
			let dz = Math.abs(weightz - mat.weightz);
			let weight = 1 - dx - dz + dx * dz;
			let gridsize = mat.alloc.img.width * 4;//TODO is the 4 a constant?
			let ubase = origintile.x % gridsize;
			let vbase = origintile.z % gridsize;
			const maxuv = 0x10000;
			texuvbuffer[texuvpointer + 2 * i + 0] = (texdata.u + texdata.usize * (ubase + tile.x - origintile.x) / gridsize) * maxuv;
			texuvbuffer[texuvpointer + 2 * i + 1] = (texdata.v + texdata.vsize * (vbase + tile.z - origintile.z) / gridsize) * maxuv;
			texweightbuffer[texweightpointer + i] = weight * 255;
			// corners.push({
			// 	u: texuvbuffer[texuvpointer + 2 * i + 0] / maxuv,
			// 	v: texuvbuffer[texuvpointer + 2 * i + 1] / maxuv,
			// 	weight: texweightbuffer[texweightpointer + i] / 255
			// })
		}
		// console.log(corners);

		return vertexindex++;
	}

	const atlas = new SimpleTexturePacker(level == 0 ? 4096 : 2048);
	const materialMap = new Map<number, SimpleTexturePackerAlloc>();
	// const whiteTexture = new ImageData(32, 32);
	// for (let i = 0; i < whiteTexture.data.length; i++) { whiteTexture.data[i] = 255; }
	// materialMap.set(0, atlas.addTexture(whiteTexture));

	for (let z = 0; z < squareHeight; z++) {
		for (let x = 0; x < squareWidth; x++) {

			// if (x < 6 || x > 12 || z < 50 || z > 52) { continue; }

			let tile = grid.getTile(chunk.xoffset + x, chunk.zoffset + z, level);
			// console.log(tile);
			//let tile = chunk.tiles[x * squareWidth + z + level * squareWidth * squareHeight];//TODO are these flipped?

			if (!tile) { continue; }
			let rawtile = tile.raw;

			//we have 8 possible vertices along the corners and halfway on the edges of the tile
			//select these vertices to draw the tile shape
			//from bottom to top: [[0,1,2],[7,<9>,3],[6,5,4]]
			//this allows us to rotate the shape by simply incrementing the index for each vertex
			let overlay: number[] = [];
			let underlay: number[] = []

			if (typeof rawtile.shape == "undefined") {
				underlay.push(0, 2, 4, 6);
			} else {
				let shape = rawtile.shape;
				let rotation = shape % 4;
				shape -= rotation;
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
					overlay.push(0, 2, 9);
					underlay.push(9, 2, 4, 6, 0);
				} else {
					console.log("unknown tile shape", shape, "rot", rotation, "at", x, z);
				}
				overlay = overlay.map(v => (v == 9 ? v : (v + 2 * rotation) % 8));
				underlay = underlay.map(v => (v == 9 ? v : (v + 2 * rotation) % 8));
			}
			const getSubTile = (i: number): TileProps | undefined => {
				if (i % 2 == 1) {
					//return the average of 2 corner vertices if we are an edge vertex
					//special case at 9 (center)
					let a = getSubTile(i == 9 ? 1 : i - 1);
					let b = getSubTile(i == 9 ? 5 : (i + 1) % 8);
					if (!a || !b) { return undefined }
					let r: TileProps = {
						raw: a.raw, raw01: a.raw01, raw10: a.raw10, raw11: a.raw11,
						x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2,
						y01: 0, y10: 0, y11: 0,
						visible: a.visible && b.visible,
						underlayR: (a.underlayR + b.underlayR) / 2, underlayG: (a.underlayG + b.underlayG) / 2, underlayB: (a.underlayB + b.underlayB) / 2,
						blendedR: (a.blendedR + b.blendedR) / 2, blendedG: (a.blendedG + b.blendedG) / 2, blendedB: (a.blendedB + b.blendedB) / 2,
						normalX: (a.normalX + b.normalX) / 2, normalZ: (a.normalZ + b.normalZ) / 2
					}
					return r;
				}
				let dx = (i == 2 || i == 4 ? 1 : 0);
				let dz = (i == 4 || i == 6 ? 0 : 1);
				return grid.getTile(chunk.xoffset + x + dx, chunk.zoffset + z + dz, level);
			}

			//TODO un-async this if at all possible (currenty forces 16k tasks/stack switches)
			let getuvweight = async (matid: number) => {
				if (!materialMap.has(matid)) {
					let mat = await scene.getMaterialData(matid);
					if (mat.textures.diffuse) {
						let img = await scene.getFileById(cacheMajors.texturesDds, mat.textures.diffuse)
							.then(buf => new ParsedTexture(buf).toImageData());
						materialMap.set(matid, atlas.addTexture(img));
					}
				}
				return materialMap.get(matid)!;
			}

			if (overlay.length != 0) {
				let overlaytype = chunk.overlays[typeof rawtile.overlay == "number" ? rawtile.overlay - 1 : 0];
				let color = overlaytype.primary_colour ?? [255, 0, 255];
				let isvisible = color[0] != 255 || color[1] != 0 || color[2] != 255;
				if (isvisible || showhidden) {
					let firstvertex = -1;
					let lastvertex = -1;

					let alloc = await getuvweight(overlaytype.material ?? 0)
					//TODO get rid of these awaits
					let texuvs: TileMaterialWeight[];
					if (showhidden) {
						texuvs = [];
					} else {
						texuvs = [
							{ weightx: 0, weightz: 0, alloc: alloc },
							{ weightx: 1, weightz: 0, alloc: alloc },
							{ weightx: 0, weightz: 1, alloc: alloc },
							{ weightx: 1, weightz: 1, alloc: alloc },
						];
					}

					for (let i = 0; i < overlay.length; i++) {
						let vertex = getSubTile(overlay[i]);
						if (!vertex) { continue; }

						let vertexptr = writeVertex(tile, vertex, color, texuvs);
						if (firstvertex == -1) { firstvertex = vertexptr; continue; }
						if (lastvertex == -1) { lastvertex = vertexptr; continue; }

						indexbuffer[indexpointer++] = firstvertex;
						indexbuffer[indexpointer++] = lastvertex;
						indexbuffer[indexpointer++] = vertexptr;
						lastvertex = vertexptr;
					}
				}
			}
			if (underlay.length != 0) {
				let firstvertex = -1;
				let lastvertex = -1;

				let underlay00 = chunk.underlays[typeof rawtile.underlay != "undefined" ? rawtile.underlay - 1 : 0];
				let underlay01 = chunk.underlays[typeof tile.raw01?.underlay != "undefined" ? tile.raw01.underlay - 1 : 0];
				let underlay10 = chunk.underlays[typeof tile.raw10?.underlay != "undefined" ? tile.raw10.underlay - 1 : 0];
				let underlay11 = chunk.underlays[typeof tile.raw11?.underlay != "undefined" ? tile.raw11.underlay - 1 : 0];
				//TODO get rid of these awaits
				let texuvs: TileMaterialWeight[];
				if (showhidden) {
					texuvs = [];
				} else {
					texuvs = [
						{ weightx: 0, weightz: 0, alloc: await getuvweight(underlay00.material ?? 0) },
						{ weightx: 1, weightz: 0, alloc: await getuvweight(underlay01.material ?? 0) },
						{ weightx: 0, weightz: 1, alloc: await getuvweight(underlay10.material ?? 0) },
						{ weightx: 1, weightz: 1, alloc: await getuvweight(underlay11.material ?? 0) },
					];
				}
				for (let i = 0; i < underlay.length; i++) {
					let vertex = getSubTile(underlay[i]);
					if (!vertex || (!vertex.visible && !showhidden)) { continue; }

					let vertexptr = writeVertex(tile, vertex, [vertex.blendedR, vertex.blendedG, vertex.blendedB], texuvs);
					if (firstvertex == -1) { firstvertex = vertexptr; continue; }
					if (lastvertex == -1) { lastvertex = vertexptr; continue; }

					indexbuffer[indexpointer++] = firstvertex;
					indexbuffer[indexpointer++] = lastvertex;
					indexbuffer[indexpointer++] = vertexptr;
					lastvertex = vertexptr;
				}
			}
		}
	}

	let attrs: MeshPrimitive["attributes"] = {};

	//TODO either ref or copy all the buffers
	let gltf = scene.gltf;
	let view = gltf.addBufferWithView(new Uint8Array(vertexbuffer, 0, vertexindex * vertexstride), vertexstride, false);
	let addAccessor = (name: string, buf: ArrayBufferView, normalize: boolean, veclength: number, eloffset = 0, max?: number[] | undefined, min?: number[] | undefined) => {
		let type = Object.values(glTypeIds).find(q => buf instanceof q.constr)!;
		return gltf.addAttributeAccessor({
			byteoffset: buf.byteOffset + eloffset * type.constr.BYTES_PER_ELEMENT,
			bytestride: vertexstride,
			max: max!,
			min: min!,
			gltype: type.gltype,
			name,
			normalize,
			veclength
		}, view, vertexindex);
	}
	attrs.POSITION = addAccessor("position", posbuffer, false, 3, 0, [maxx, maxy, maxz], [minx, miny, minz]);
	attrs.NORMAL = addAccessor("normals", normalbuffer, false, 3);
	attrs.COLOR_0 = addAccessor("color", colorbuffer, true, 3)
	attrs._RA_FLOORTEX_UV01 = addAccessor("texuv_01", texuvbuffer, true, 4, 0);
	attrs._RA_FLOORTEX_UV23 = addAccessor("texuv_23", texuvbuffer, true, 4, 4);
	attrs._RA_FLOORTEX_WEIGHTS = addAccessor("texuv_weights", texweightbuffer, true, 4);

	let floortex = -1;
	if (!showhidden) {
		let atlasimg = await atlas.convert();
		let img = sharp(Buffer.from(atlasimg.data.buffer), { raw: { width: atlasimg.width, height: atlasimg.height, channels: 4 } });
		let atlasfile = await img.png().toBuffer({ resolveWithObject: false });
		floortex = gltf.addImageWithTexture(atlasfile);
		gltf.addExtension("RA_FLOORTEX", false);
		//TODO remove
		fs.writeFileSync("cache/blobs/" + Date.now() + ".png", atlasfile);
	}
	let viewIndex = gltf.addBufferWithView(indexbuffer.slice(0, indexpointer), undefined, true);
	let indices = gltf.addAccessor({
		componentType: glTypeIds.u16.gltype,
		count: indexpointer,
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
	let extra = {
		modelgroup: (showhidden ? "floorhidden" : "floor") + level,
		modeltype: (showhidden ? "floorhidden" : "floor"),
		mapsquarex: chunk.mapsquarex,
		mapsquarez: chunk.mapsquarez,
		level: level
	} as ModelExtras;
	return gltf.addNode({
		mesh,
		extensions: (floortex != -1 ? { RA_FLOORTEX: true } : undefined),
		extras: extra
	});
}
