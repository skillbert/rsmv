import { JMat, JMatInternal } from "./jmat";
import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { GLTFBuilder } from "./gltf";
import { GlTf, MeshPrimitive, Material } from "./gltftype";
import { cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { AttributeSoure, buildAttributeBuffer, glTypeIds } from "./gltfutil";
import { parseMapsquareTiles, parseMapsquareUnderlays } from "../opdecoder";
import { CacheFileSource } from "main";
import { ScanBuffer } from "opcode_reader";

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

export async function mapsquareToGltf(source: CacheFileSource, startindex: number, width: number, height = 0) {

	let gltf = new GLTFBuilder();

	let nodes: number[] = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let mesh = await mapsquareMesh(gltf, source, startindex + x + y * 128);
			if (mesh != -1) {
				nodes.push(gltf.addNode({ mesh: mesh, translation: [y * 512 * 64, 0, x * 512 * 64] }));
			}
		}
	}

	gltf.addScene({ nodes });
	let model = await gltf.convert({ glb: false, singlefile: true });
	return model.mainfile;
}

async function mapsquareMesh(gltf: GLTFBuilder, source: CacheFileSource, fileminor: number) {
	let mapunderlaymeta = await source.getIndexFile(cacheMajors.mapsquares);
	let selfindex = mapunderlaymeta.find(q => q.minor == fileminor)!;
	let selfarchive = (await source.getFileArchive(selfindex));
	let tileindex = selfindex.subindices.indexOf(3);
	if (tileindex == -1) { return -1; }
	let tilefile = selfarchive[tileindex].buffer;
	let configunderlaymeta = await source.getIndexFile(cacheMajors.config);


	let offset = 0;
	let levels: Tile[][] = [];
	while (offset < tilefile.length - 4096) {
		let slice: ScanBuffer = Object.assign(tilefile.slice(offset), { scan: 0 });
		levels.push(parseMapsquareTiles.read(slice));
		offset += slice.scan;
	}
	let tiles: Tile[] = parseMapsquareTiles.read(tilefile);

	//TODO yikes
	let underlays = (await source.getFileArchive(configunderlaymeta.find(q => q.major == 2 && q.minor == 1)!)).map(q => parseMapsquareUnderlays.read(q.buffer));

	let getTile = (x: number, y: number, level: number) => {
		if (x < 0 || x >= squareWidth || y < 0 || y >= squareHeight) { return undefined; }
		let tile = tiles[level * squareWidth * squareHeight + y * squareWidth + x];
		if (!tile) {
			//console.log(`tile expected at ${x} ${y}`)
			return undefined;
		}
		let underlayid = typeof tile.underlay == "number" ? tile.underlay - 1 : 0;
		let underlay = underlays[underlayid];
		return {
			height: tile.height ?? 0,
			underlay,
			color: underlay.color ?? [255, 255, 255]
		}
	}

	//worst case allocs
	//maybe move these to static scratch buffer allocs
	let posbuffer = new Float32Array(squareWidth * squareHeight * squareLevels * 4 * 3);
	let colorbuffer = new Uint8Array(squareWidth * squareHeight * squareLevels * 4 * 3);
	let indexbuffer = new Uint16Array(squareWidth * squareHeight * squareLevels * 6);

	let vertexindex = 0;
	let indexpointer = 0;
	debugger;


	for (let level = 0; level < levels.length; level++) {
		for (let y = 0; y < squareHeight; y++) {
			for (let x = 0; x < squareWidth; x++) {
				let tile00 = getTile(x, y, level);
				let tile01 = getTile(x + 1, y, level);
				let tile10 = getTile(x, y + 1, level);
				let tile11 = getTile(x + 1, y + 1, level);
				if (!tile00 || !tile01 || !tile10 || !tile11) { continue; }

				//if we actually have 4 visible corners in our tile
				const pospointer = vertexindex * 3;
				// let color00, color11, color10, color01;
				// color00 = color11 = color10 = color01 = [255, 255, 255];

				//create 4 vertices
				//TODO reuse vertices from different tiles
				posbuffer[pospointer + 0] = x * 512;
				posbuffer[pospointer + 1] = (tile00.height ?? 0) * 512 * heightScale;
				posbuffer[pospointer + 2] = y * 512;
				colorbuffer[pospointer + 0] = tile00.color[0];
				colorbuffer[pospointer + 1] = tile00.color[1]
				colorbuffer[pospointer + 2] = tile00.color[2]

				posbuffer[pospointer + 3] = (x + 1) * 512;
				posbuffer[pospointer + 4] = (tile01.height ?? 0) * 512 * heightScale
				posbuffer[pospointer + 5] = y * 512;
				colorbuffer[pospointer + 3] = tile00.color[0];
				colorbuffer[pospointer + 4] = tile00.color[1]
				colorbuffer[pospointer + 5] = tile00.color[2]

				posbuffer[pospointer + 6] = x * 512;
				posbuffer[pospointer + 7] = (tile10.height ?? 0) * 512 * heightScale;
				posbuffer[pospointer + 8] = (y + 1) * 512;
				colorbuffer[pospointer + 6] = tile00.color[0];
				colorbuffer[pospointer + 7] = tile00.color[1]
				colorbuffer[pospointer + 8] = tile00.color[2]

				posbuffer[pospointer + 9] = (x + 1) * 512;
				posbuffer[pospointer + 10] = (tile11.height ?? 0) * 512 * heightScale;
				posbuffer[pospointer + 11] = (y + 1) * 512;
				colorbuffer[pospointer + 9] = tile00.color[0];
				colorbuffer[pospointer + 10] = tile00.color[1]
				colorbuffer[pospointer + 11] = tile00.color[2]

				//draw 2 triangles on these vertices
				indexbuffer[indexpointer + 0] = vertexindex + 0;
				indexbuffer[indexpointer + 1] = vertexindex + 2;
				indexbuffer[indexpointer + 2] = vertexindex + 1;

				indexbuffer[indexpointer + 3] = vertexindex + 1;
				indexbuffer[indexpointer + 4] = vertexindex + 2;
				indexbuffer[indexpointer + 5] = vertexindex + 3;

				vertexindex += 4;
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
	return mesh;
}
