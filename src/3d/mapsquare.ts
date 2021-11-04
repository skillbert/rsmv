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
import { addOb3Model, GLTFSceneCache } from "./ob3togltf";
import { mapsquare_tiles } from "../../generated/mapsquare_tiles";
import { mapsquare_watertiles } from "../../generated/mapsquare_watertiles";

type ChunkData = {
	xoffset: number,
	zoffset: number,
	tiles: mapsquare_tiles,
	//watertiles: mapsquare_watertiles,
	underlays: mapsquare_underlays[],
	overlays: mapsquare_overlays[],
	archive: SubFile[],
	cacheIndex: CacheIndex
}

const tiledimensions = 512;
const squareWidth = 64;
const squareHeight = 64
const squareLevels = 4;
const heightScale = 1 / 16;
const worldStride = 128;

type TileProps = {
	x: number,
	y: number,
	z: number,
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
					if (!currenttile || !currenttile.visible) { continue; }
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
						//TODO tune this together with heightscale to remove gaps
						//from trees and have sensible default height
						height += (level == 0 ? 32 : 30);
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
					this.tiles[newindex] = {
						x: tilex,
						y: height * tiledimensions * heightScale,
						z: tilez,
						visible,
						underlayR: color[0], underlayG: color[1], underlayB: color[2],
						blendedR: 0, blendedG: 0, blendedB: 0,
						normalX: 0, normalZ: 0
					}
					tileindex += squareWidth * squareHeight;
				}
			}
		}
	}
}

export async function mapsquareToGltf(source: CacheFileSource, rect: { x: number, y: number, width: number, height: number }) {

	let scene = new GLTFSceneCache(source.getFileById.bind(source));


	//TODO proper erroring on nulls
	let configunderlaymeta = await source.getIndexFile(cacheMajors.config);
	let underarch = await source.getFileArchive(configunderlaymeta.find(q => q.minor == 1)!);
	let underlays = underarch.map(q => parseMapsquareUnderlays.read(q.buffer));
	let overlays = (await source.getFileArchive(configunderlaymeta.find(q => q.minor == 4)!))
		.map(q => parseMapsquareOverlays.read(q.buffer));


	let grid = new TileGrid(rect.x, rect.y, rect.width, rect.height);
	let chunks: ChunkData[] = [];
	for (let z = 0; z < rect.height; z++) {
		for (let x = 0; x < rect.width; x++) {
			let squareindex = (rect.x + x) + (rect.y + z) * worldStride;
			let mapunderlaymeta = await source.getIndexFile(cacheMajors.mapsquares);
			let selfindex = mapunderlaymeta.find(q => q.minor == squareindex)!;
			let selfarchive = (await source.getFileArchive(selfindex));
			let tileindex = selfindex.subindices.indexOf(3);
			let tileindexwater = selfindex.subindices.indexOf(4);

			if (tileindex == -1) { continue; }
			let tilefile = selfarchive[tileindex].buffer;
			//let watertilefile = selfarchive[tileindexwater]?.buffer;
			//let watertiles = parseMapsquareWaterTiles.read(watertilefile);
			let tiles = parseMapsquareTiles.read(tilefile);
			let chunk: ChunkData = {
				xoffset: (rect.x + x) * squareWidth,
				zoffset: (rect.y + z) * squareHeight,
				tiles, underlays, overlays, cacheIndex: selfindex, archive: selfarchive
			};
			chunks.push(chunk);
			grid.addMapsquare(chunk);
		}
	}
	debugger;
	grid.blendUnderlays();
	let nodes: number[] = [];
	for (let chunk of chunks) {
		let meshnode = await mapsquareMesh(scene, chunk, grid);
		let objectsnode = await mapsquareObjects(scene, chunk, grid);

		nodes.push(scene.gltf.addNode({
			children: [
				meshnode,
				objectsnode
			],
			translation: [chunk.xoffset * tiledimensions, 0, chunk.zoffset * tiledimensions]
		}));
	}
	let rootnode = scene.gltf.addNode({ children: nodes, scale: [1, 1, -1] });
	scene.gltf.addScene({ nodes: [rootnode] });
	let model = await scene.gltf.convert({ glb: true, singlefile: true });
	return model.mainfile;
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
		let meshes = await Promise.all(modelids.map(async m => {
			let file = await scene.getFileById(cacheMajors.models, m.value);
			return { type: m.type, mesh: await addOb3Model(scene, new Stream(file), {}, scene.getFileById) };
		}));

		for (let inst of loc.uses) {
			//console.log("object", inst.x, inst.y, inst.rotation, JSON.stringify(inst.extra), loc.id,);
			let tile = grid.getTile(inst.x + chunk.xoffset, inst.y + chunk.zoffset, inst.plane);
			if (!tile) {
				//TODO is this even possible?
				console.log("object without tile");
				continue;
			}

			//models have their center in the middle, but they always rotate such that their southwest corner
			//corresponds to the southwest corner of the tile
			let dx = (objectmeta.width ?? 1) / 2 * tiledimensions;
			let dz = (objectmeta.length ?? 1) / 2 * tiledimensions;
			//0-3 rotation for 0-270 degrees
			//i messed up something with the quaternion, but this transform worked..
			let rotation = (-inst.rotation + 2) / 4 * Math.PI * 2;
			let flipoffset = (inst.rotation % 2) == 1;

			let children = meshes.filter(m => m.type == inst.type).map(mesh => scene.gltf.addNode({ mesh: mesh.mesh }));

			if (children.length != 0) {
				nodes.push(scene.gltf.addNode({
					children,
					translation: [
						tile.x - rootx + (!flipoffset ? dx : dz),
						tile.y,
						tile.z - rootz + (!flipoffset ? dz : dx)
					],
					scale: [1, 1, (objectmeta.mirror ? -1 : 1)],
					//quaternions, have fun
					rotation: [0, Math.cos(rotation / 2), 0, Math.sin(rotation / 2)]
				}));
			}
		}
	}
	return scene.gltf.addNode({ children: nodes });
}

async function mapsquareMesh(scene: GLTFSceneCache, chunk: ChunkData, grid: TileGrid) {
	const maxtiles = squareWidth * squareHeight * squareLevels;
	const maxVerticesPerTile = 8;
	const vertexstride = 4 * 3 + 4 * 3 + 4;//3x float32 pos, 3x uint8 pos, aligned
	//overalloce worst case scenario
	let vertexbuffer = new ArrayBuffer(maxtiles * vertexstride * maxVerticesPerTile);
	let indexbuffer = new Uint16Array(maxtiles * maxVerticesPerTile);
	let posbuffer = new Float32Array(vertexbuffer, 0);//offset 0, size 12 bytes
	let normalbuffer = new Float32Array(vertexbuffer, 12);//offset 12, size 12 bytes
	let colorbuffer = new Uint8Array(vertexbuffer, 24);//offset 24, size 4 bytes
	const posstride = vertexstride / 4 | 0;//position indices to skip per vertex (cast to int32)
	const normalstride = vertexstride / 4 | 0;//normal indices to skip per vertex (cast to int32)
	const colorstride = vertexstride | 0;//color indices to skip per vertex (cast to int32)

	let vertexindex = 0;
	let indexpointer = 0;

	const modelx = chunk.xoffset * tiledimensions;
	const modelz = chunk.zoffset * tiledimensions;

	let minx = Infinity, miny = Infinity, minz = Infinity;
	let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
	const writeVertex = (tile: TileProps, color: number[]) => {
		const pospointer = vertexindex * posstride;
		const normalpointer = vertexindex * normalstride;
		const colpointer = vertexindex * colorstride;

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
		return vertexindex++;
	}

	for (let level = 0; level < 4; level++) {
		for (let z = 0; z < squareHeight; z++) {
			for (let x = 0; x < squareWidth; x++) {
				let tile = chunk.tiles[x * squareWidth + z + level * squareWidth * squareHeight];//TODO are these flipped?
				if (!tile) { continue; }

				//we have 8 possible vertices along the corners and halfway on the edges of the tile
				//select these vertices to draw the tile shape
				//from bottom to top: [[0,1,2],[7,<9>,3],[6,5,4]]
				//this allows us to rotate the shape by simply incrementing the index for each vertex
				let overlay: number[] = [];
				let underlay: number[] = []

				if (typeof tile.shape == "undefined") {
					underlay.push(0, 2, 4, 6);
				} else {
					let shape = tile.shape;
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
							x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2,
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

				if (overlay.length != 0) {
					let overlaytype = chunk.overlays[typeof tile.overlay == "number" ? tile.overlay - 1 : 0];
					let color = overlaytype.primary_colour ?? [255, 0, 255];
					let isvisible = color[0] != 255 || color[1] != 0 || color[2] != 255;
					if (isvisible) {
						let firstvertex = -1;
						let lastvertex = -1;
						for (let i = 0; i < overlay.length; i++) {
							let vertex = getSubTile(overlay[i]);
							if (!vertex) { continue; }

							let vertexptr = writeVertex(vertex, color);
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
					for (let i = 0; i < underlay.length; i++) {
						let vertex = getSubTile(underlay[i]);
						if (!vertex || !vertex.visible) { continue; }

						let vertexptr = writeVertex(vertex, [vertex.blendedR, vertex.blendedG, vertex.blendedB]);
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
	}

	let attrs: MeshPrimitive["attributes"] = {};

	//TODO either ref or copy all the buffers
	let gltf = scene.gltf;
	let view = gltf.addBufferWithView(new Uint8Array(vertexbuffer, 0, vertexindex * vertexstride), vertexstride, false);
	attrs.POSITION = gltf.addAttributeAccessor({
		byteoffset: posbuffer.byteOffset,
		bytestride: vertexstride,
		gltype: glTypeIds.f32.gltype,
		max: [maxx, maxy, maxz],
		min: [minx, miny, minz],
		name: "position",
		normalize: false,
		veclength: 3
	}, view, vertexindex);
	attrs.NORMAL = gltf.addAttributeAccessor({
		byteoffset: normalbuffer.byteOffset,
		bytestride: vertexstride,
		gltype: glTypeIds.f32.gltype,
		max: undefined as any,
		min: undefined as any,
		name: "normals",
		normalize: false,
		veclength: 3
	}, view, vertexindex);
	attrs.COLOR_0 = gltf.addAttributeAccessor({
		byteoffset: colorbuffer.byteOffset,
		bytestride: vertexstride,
		gltype: glTypeIds.u8.gltype,
		max: undefined as any,
		min: undefined as any,
		name: "color",
		normalize: true,
		veclength: 3
	}, view, vertexindex);
	let viewIndex = gltf.addBufferWithView(indexbuffer.slice(0, indexpointer), undefined, true);

	let indices = gltf.addAccessor({
		componentType: glTypeIds.u16.gltype,
		count: indexpointer,
		type: "SCALAR",
		bufferView: viewIndex
	});

	let floormaterial = gltf.addMaterial({
		alphaMode: "MASK",
		alphaCutoff: 0.9
	})

	let mesh = gltf.addMesh({
		primitives: [{
			attributes: attrs,
			indices: indices,
			material: floormaterial
		}]
	});
	return gltf.addNode({ mesh });
}
