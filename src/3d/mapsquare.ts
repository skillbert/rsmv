import { JMat, JMatInternal } from "./jmat";
import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { GLTFBuilder } from "./gltf";
import { CacheFileSource } from "../cache";
import { GlTf, MeshPrimitive, Material } from "./gltftype";
import { cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { AttributeSoure, buildAttributeBuffer, glTypeIds } from "./gltfutil";
import { parseMapsquareLocations, parseMapsquareOverlays, parseMapsquareTiles, parseMapsquareUnderlays, parseObject } from "../opdecoder";
import { ScanBuffer } from "opcode_reader";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { mapsquare_overlays } from "../../generated/mapsquare_overlays";
import { mapsquare_locations } from "../../generated/mapsquare_locations";
import { addOb3Model } from "./ob3togltf";

type Tile = {
	flags: number,
	underlay?: number,
	overlay?: number,
	shape?: number,
	height?: number
}

const squareWidth = 64;
const squareHeight = 64
const squareLevels = 4;
const heightScale = 1 / 16;

export async function mapsquareToGltf(source: CacheFileSource, rect: { x: number, y: number, width: number, height: number }) {

	let gltf = new GLTFBuilder();


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
			let meshnode = await mapsquareMesh(gltf, source, underlays, overlays, squareindex);
			let objectsnode = await mapsquareObjects(gltf, source, squareindex);

			nodes.push(gltf.addNode({ children: [meshnode, objectsnode], translation: [squarey * 512 * 64, 0, squarex * 512 * 64] }));
		}
	}

	gltf.addScene({ nodes });
	let model = await gltf.convert({ glb: true, singlefile: true });
	return model.mainfile;
}


function getTile(tiles: Tile[], underlays: mapsquare_underlays[], overlays: mapsquare_overlays[], x: number, y: number, level: number) {
	if (x < 0 || x >= squareWidth || y < 0 || y >= squareHeight) { return undefined; }
	let tile = tiles[level * squareWidth * squareHeight + y * squareWidth + x];
	if (!tile) {
		//console.log(`tile expected at ${x} ${y}`)
		return undefined;
	}
	let underlayid = typeof tile.underlay == "number" ? tile.underlay : 0;
	let overlayid = typeof tile.overlay == "number" ? tile.overlay : 0;
	let underlay = underlays[underlayid - 1];
	let overlay = overlays[overlayid - 1] ?? undefined;
	return {
		height: tile.height ?? 0,
		underlay,
		overlay,
		color: overlay?.primary_colour ?? underlay?.color ?? [255, 255, 255]
	}
}

async function mapsquareObjects(gltf: GLTFBuilder, source: CacheFileSource, squareid: number) {
	let mapunderlaymeta = await source.getIndexFile(cacheMajors.mapsquares);
	let selfindex = mapunderlaymeta.find(q => q.minor == squareid)!;
	let selfarchive = (await source.getFileArchive(selfindex));
	let locationindex = selfindex.subindices.indexOf(0);
	if (locationindex == -1) { return gltf.addNode({}); }
	let locations = parseMapsquareLocations.read(selfarchive[locationindex].buffer).locations;

	let nodes: number[] = [];
	for (let loc of locations) {
		let objectfile = await source.getFileById(cacheMajors.objects, loc.id);
		let objectmeta = parseObject.read(objectfile);
		let modelids = objectmeta.models?.flatMap(q => q.values) ?? [];
		let modelnodes = await Promise.all(modelids.map(async m => {
			let file = await source.getFile(cacheMajors.models, m);
			return addOb3Model(gltf, new Stream(file), {}, source.getFileById.bind(source));
		}));

		for (let inst of loc.uses) {
			nodes.push(gltf.addNode({
				children: modelnodes,
				translation: [inst.y * 512, 0, inst.x * 512],
				//quaternions, have fun
				rotation: [0, Math.cos((inst.rotation+3) / 4 * Math.PI), 0, Math.sin((inst.rotation+3) / 4 * Math.PI)]
			}));
		}
	}
	return gltf.addNode({ children: nodes });
}

async function mapsquareMesh(gltf: GLTFBuilder, source: CacheFileSource, underlays: mapsquare_underlays[], overlays: mapsquare_overlays[], squareid: number) {
	let mapunderlaymeta = await source.getIndexFile(cacheMajors.mapsquares);
	let selfindex = mapunderlaymeta.find(q => q.minor == squareid)!;
	let selfarchive = (await source.getFileArchive(selfindex));
	let tileindex = selfindex.subindices.indexOf(3);

	if (tileindex == -1) { return -1; }
	let tilefile = selfarchive[tileindex].buffer;


	// let offset = 0;
	// let levels: Tile[][] = [];
	// while (offset < tilefile.length - 4096) {
	// 	let slice: ScanBuffer = Object.assign(tilefile.slice(offset), { scan: 0 });
	// 	levels.push(parseMapsquareTiles.read(slice));
	// 	offset += slice.scan;
	// }
	let tiles: Tile[] = parseMapsquareTiles.read(tilefile);



	//worst case allocs
	//maybe move these to static scratch buffer allocs
	let posbuffer = new Float32Array(squareWidth * squareHeight * squareLevels * 4 * 3);
	let colorbuffer = new Uint8Array(squareWidth * squareHeight * squareLevels * 4 * 3);
	let indexbuffer = new Uint16Array(squareWidth * squareHeight * squareLevels * 6);
	let vertexpointerbuffer = new Uint16Array((squareWidth + 1) * (squareHeight + 1) * squareLevels);

	let vertexindex = 0;
	let indexpointer = 0;

	let getvertexindex = (x: number, y: number, level: number) => {
		return -1 + vertexpointerbuffer[level * (squareWidth + 1) * (squareHeight + 1) + y * (squareWidth + 1) + x];
	}
	let setvertexindex = (x: number, y: number, level: number, index: number) => {
		return vertexpointerbuffer[level * (squareWidth + 1) * (squareHeight + 1) + y * (squareWidth + 1) + x] = index + 1;
	}

	let writeTile = (tiles: Tile[], x: number, y: number, level: number) => {
		let tile = getTile(tiles, underlays, overlays, x, y, level);
		if (!tile) { return; }
		const pospointer = vertexindex * 3;
		const colpointer = vertexindex * 3;

		posbuffer[pospointer + 0] = x * 512;
		posbuffer[pospointer + 1] = tile.height * 512 * heightScale;
		posbuffer[pospointer + 2] = y * 512;
		colorbuffer[colpointer + 0] = tile.color[0];
		colorbuffer[colpointer + 1] = tile.color[1];
		colorbuffer[colpointer + 2] = tile.color[2];

		setvertexindex(x, y, level, vertexindex);
		vertexindex++;
	}

	for (let level = 0; level < squareLevels; level++) {
		for (let y = 0; y < squareHeight; y++) {
			for (let x = 0; x < squareWidth; x++) {
				writeTile(tiles, x, y, level);
			}
		}

		for (let y = 0; y < squareHeight; y++) {
			for (let x = 0; x < squareWidth; x++) {
				let tile = getTile(tiles, underlays, overlays, x, y, level);
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
		color: { newtype: "u8", vecsize: 3, source: colorbuffer.slice(0, vertexindex * 3) } as AttributeSoure
	};

	let { buffer, attributes, bytestride, vertexcount } = buildAttributeBuffer(attrsources);

	let attrs: MeshPrimitive["attributes"] = {};

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


	let mesh = gltf.addMesh({
		primitives: [{
			attributes: attrs,
			indices: indices
		}]
	});
	return gltf.addNode({ mesh });
}
