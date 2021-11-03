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

export async function mapsquareToGltf(source: CacheFileSource, rect: { x: number, y: number, width: number, height: number }) {

	let scene = new GLTFSceneCache(source.getFileById.bind(source));


	//TODO proper erroring on nulls
	let configunderlaymeta = await source.getIndexFile(cacheMajors.config);
	let underarch = await source.getFileArchive(configunderlaymeta.find(q => q.minor == 1)!);
	let underlays = underarch.map(q => parseMapsquareUnderlays.read(q.buffer));
	let overlays = (await source.getFileArchive(configunderlaymeta.find(q => q.minor == 4)!))
		.map(q => parseMapsquareOverlays.read(q.buffer));

	let nodes: number[] = [];
	for (let squarey = rect.y; squarey < rect.y + rect.height; squarey++) {
		for (let squarex = rect.x; squarex < rect.x + rect.width; squarex++) {
			let squareindex = squarex + squarey * 128;
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
			let chunk: ChunkData = { tiles, underlays, overlays, cacheIndex: selfindex, archive: selfarchive };
			let meshnode = await mapsquareMesh(scene, chunk);
			let objectsnode = await mapsquareObjects(scene, chunk);

			nodes.push(scene.gltf.addNode({
				children: [meshnode, objectsnode],
				translation: [
					squarex * tiledimensions * squareWidth,
					0,
					squarey * tiledimensions * squareHeight
				]
			}));
		}
	}
	let rootnode = scene.gltf.addNode({ children: nodes, scale: [1, 1, -1] });
	scene.gltf.addScene({ nodes: [rootnode] });
	let model = await scene.gltf.convert({ glb: true, singlefile: true });
	return model.mainfile;
}


function getTile(chunk: ChunkData, x: number, z: number, level: number) {
	if (x < 0 || x >= squareWidth || z < 0 || z >= squareHeight) { return undefined; }
	let tile = chunk.tiles[level * squareWidth * squareHeight + x * squareHeight + z];
	if (!tile) {
		//console.log(`tile expected at ${x} ${y}`)
		return undefined;
	}
	let underlayid = typeof tile.underlay == "number" ? tile.underlay : 0;
	let overlayid = typeof tile.overlay == "number" ? tile.overlay : 0;
	let underlay = chunk.underlays[underlayid - 1];
	let overlay = chunk.overlays[overlayid - 1] ?? undefined;

	let parentheight: number = (level > 0 ? getTile(chunk, x, z, level - 1)?.y : undefined) ?? 0;
	return {
		x: x * tiledimensions,
		y: (tile.height ?? 30) * heightScale * tiledimensions + parentheight,
		z: z * tiledimensions,
		underlay,
		overlay,
		color: overlay?.primary_colour ?? underlay?.color ?? [255, 0, 255, 0]
	}
}

async function mapsquareObjects(scene: GLTFSceneCache, chunk: ChunkData) {
	let locationindex = chunk.cacheIndex.subindices.indexOf(0);
	if (locationindex == -1) { return scene.gltf.addNode({}); }
	let locations = parseMapsquareLocations.read(chunk.archive[locationindex].buffer).locations;

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
			console.log("object", inst.x, inst.y, inst.rotation, JSON.stringify(inst.extra), loc.id,);
			let tile = getTile(chunk, inst.x, inst.y, inst.plane);
			if (!tile) {
				//TODO is this even possible?
				console.log("object without tile");
				continue;
			}

			//models have their center in the middle, but they always rotate such that their southwest corner
			//corresponds to the southwest corner of the tile
			let dx = (objectmeta.width ?? 1) / 2 * tiledimensions;
			let dz = (objectmeta.length ?? 1) / 2 * tiledimensions;
			let rotation = (-inst.rotation + 2) / 4 * Math.PI * 2;
			let flipoffset = (inst.rotation % 2) == 1;

			nodes.push(scene.gltf.addNode({
				children: meshes.filter(m => m.type == inst.type).map(mesh => scene.gltf.addNode({ mesh: mesh.mesh })),
				translation: [
					tile.x + (!flipoffset ? dx : dz),
					tile.y,
					tile.z + (!flipoffset ? dz : dx)
				],
				scale: [1, 1, (objectmeta.mirror ? -1 : 1)],
				//quaternions, even more fun
				rotation: [0, Math.cos(rotation / 2), 0, Math.sin(rotation / 2)]
			}));
		}
	}
	return scene.gltf.addNode({ children: nodes });
}

async function mapsquareMesh(scene: GLTFSceneCache, chunk: ChunkData) {

	//worst case allocs
	//maybe move these to static scratch buffer allocs
	let posbuffer = new Float32Array(squareWidth * squareHeight * squareLevels * 4 * 3);
	let colorbuffer = new Uint8Array(squareWidth * squareHeight * squareLevels * 4 * 4);
	let indexbuffer = new Uint16Array(squareWidth * squareHeight * squareLevels * 6);
	let vertexpointerbuffer = new Uint16Array((squareWidth + 1) * (squareHeight + 1) * squareLevels);

	let vertexindex = 0;
	let indexpointer = 0;

	let getvertexindex = (x: number, z: number, level: number) => {
		return -1 + vertexpointerbuffer[level * (squareWidth + 1) * (squareHeight + 1) + z * (squareWidth + 1) + x];
	}
	let setvertexindex = (x: number, z: number, level: number, index: number) => {
		return vertexpointerbuffer[level * (squareWidth + 1) * (squareHeight + 1) + z * (squareWidth + 1) + x] = index + 1;
	}

	let writeTile = (x: number, z: number, level: number) => {
		let tile = getTile(chunk, x, z, level);
		if (!tile) { return; }
		const pospointer = vertexindex * 3;
		const colpointer = vertexindex * 4;

		posbuffer[pospointer + 0] = tile.x;
		posbuffer[pospointer + 1] = tile.y;
		posbuffer[pospointer + 2] = tile.z;
		colorbuffer[colpointer + 0] = tile.color[0];
		colorbuffer[colpointer + 1] = tile.color[1];
		colorbuffer[colpointer + 2] = tile.color[2];
		colorbuffer[colpointer + 3] = (tile.color[0] == 255 && tile.color[1] == 0 && tile.color[2] == 255 ? 0 : 255);

		setvertexindex(x, z, level, vertexindex);
		vertexindex++;
	}

	debugger;

	for (let level = 0; level < 4; level++) {
		for (let y = 0; y < squareHeight; y++) {
			for (let x = 0; x < squareWidth; x++) {
				writeTile(x, y, level);
			}
		}

		for (let y = 0; y < squareHeight; y++) {
			for (let x = 0; x < squareWidth; x++) {
				let tile = getTile(chunk, x, y, level);
				if (!tile) { continue; }

				let i00 = getvertexindex(x, y, level);
				let i01 = getvertexindex(x + 1, y, level);
				let i10 = getvertexindex(x, y + 1, level);
				let i11 = getvertexindex(x + 1, y + 1, level);
				if (i00 == -1 || i01 == -1 || i10 == -1 || i11 == -1) { continue; }
				//TODO tile shape

				//draw 2 triangles on these vertices
				indexbuffer[indexpointer + 0] = i00;
				indexbuffer[indexpointer + 1] = i10;
				indexbuffer[indexpointer + 2] = i01;

				indexbuffer[indexpointer + 3] = i01;
				indexbuffer[indexpointer + 4] = i10;
				indexbuffer[indexpointer + 5] = i11;

				indexpointer += 6;
			}
		}
	}

	let attrsources = {
		pos: { newtype: "f32", vecsize: 3, source: posbuffer.slice(0, vertexindex * 3) } as AttributeSoure,
		//TODO go back to opaque color
		color: { newtype: "u8", vecsize: 4, source: colorbuffer.slice(0, vertexindex * 4) } as AttributeSoure
	};

	let { buffer, attributes, bytestride, vertexcount } = buildAttributeBuffer(attrsources);

	let attrs: MeshPrimitive["attributes"] = {};

	let gltf = scene.gltf;
	let view = gltf.addBufferWithView(buffer, bytestride, false);
	attrs.POSITION = gltf.addAttributeAccessor(attributes.pos, view, vertexcount);
	attributes.color.normalize = true;
	attrs.COLOR_0 = gltf.addAttributeAccessor(attributes.color, view, vertexcount);
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
