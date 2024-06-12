import { Stream, packedHSL2HSL, HSL2RGB, ushortToHalf } from "../utils";
import * as THREE from "three";
import { alignedRefOrCopy, ArrayBufferConstructor } from "./gltfutil";
import { CacheFileSource } from "../cache";
import { parse } from "../opdecoder";
import { models } from "../../generated/models";

export type BoneCenter = {
	xsum: number,
	ysum: number,
	zsum: number,
	weightsum: number
};

export type ModelData = {
	maxy: number,
	miny: number,
	skincount: number,
	bonecount: number,
	meshes: ModelMeshData[],
	debugmeshes?: THREE.Mesh[]
}

export type ModelMeshData = {
	indices: THREE.BufferAttribute,
	vertexstart: number,//used when merging partial meshes
	vertexend: number,//used when merging partial meshes
	indexLODs: THREE.BufferAttribute[],
	materialId: number,
	hasVertexAlpha: boolean,
	needsNormalBlending: boolean,
	attributes: {
		pos: THREE.BufferAttribute,
		normals?: THREE.BufferAttribute,
		color?: THREE.BufferAttribute,
		texuvs?: THREE.BufferAttribute,
		//new skeletal animations
		skinids?: THREE.BufferAttribute,
		skinweights?: THREE.BufferAttribute,
		//old transform based animations
		boneids?: THREE.BufferAttribute,
		boneweights?: THREE.BufferAttribute
	}
}

function streamChunk<T>(constr: ArrayBufferConstructor<T>, stream: Stream, length: number) {
	let buf = alignedRefOrCopy(constr, stream.getData(), stream.scanloc(), length);
	stream.skip(length * constr.BYTES_PER_ELEMENT);
	return buf;
}

export function getBoneCenters(model: ModelData) {
	let bonecenters: BoneCenter[] = [];
	for (let i = 0; i < model.bonecount; i++) {
		bonecenters.push({ xsum: 0, ysum: 0, zsum: 0, weightsum: 0 });
	}

	for (let mesh of model.meshes) {
		let ids = mesh.attributes.boneids;
		let weights = mesh.attributes.boneweights;
		let pos = mesh.attributes.pos;
		let indices = mesh.indices;
		if (!ids || !weights) { continue; }
		for (let i = 0; i < indices.count; i++) {
			let vert = indices.array[i];
			for (let skin = 0; skin < ids.itemSize; skin++) {
				let skinid = ids.array[vert * ids.itemSize + skin];
				let skinweight = weights.array[vert * weights.itemSize + skin];
				let center = bonecenters[skinid];
				center.xsum += pos.array[pos.itemSize * vert + 0] * skinweight;
				center.ysum += pos.array[pos.itemSize * vert + 1] * skinweight;
				center.zsum += pos.array[pos.itemSize * vert + 2] * skinweight;
				center.weightsum += skinweight;
			}
		}
	}
	return bonecenters;
}

export function getModelCenter(model: ModelData) {
	let center: BoneCenter = {
		xsum: 0,
		ysum: 0,
		zsum: 0,
		weightsum: 0
	}
	for (let mesh of model.meshes) {
		let indices = mesh.indices;
		let pos = mesh.attributes.pos;
		for (let i = 0; i < indices.count; i++) {
			let vert = indices.array[i];
			center.xsum += pos.array[pos.itemSize * vert + 0];
			center.ysum += pos.array[pos.itemSize * vert + 1];
			center.zsum += pos.array[pos.itemSize * vert + 2];
			center.weightsum += 1;
		}
	}
	return center;
}

function parsePosData(arr: Int16Array) {
	return new THREE.BufferAttribute(new Float32Array(arr), 3);
}

function addBoneIdBuffer(attributes: ModelMeshData["attributes"], boneidBuffer: Uint16Array) {
	let quadboneids = new Uint8Array(boneidBuffer.length * 4);
	let quadboneweights = new Uint8Array(boneidBuffer.length * 4);
	const maxshort = (1 << 16) - 1;
	for (let i = 0; i < boneidBuffer.length; i++) {
		let id = boneidBuffer[i]
		id = (id == maxshort ? 0 : id + 1);
		quadboneids[i * 4] = id;
		quadboneweights[i * 4] = 255;
	}
	attributes.boneids = new THREE.BufferAttribute(quadboneids, 4);
	attributes.boneweights = new THREE.BufferAttribute(quadboneweights, 4, true);
}

function addUvBuffer(attributes: ModelMeshData["attributes"], vertexCount: number, uvBuffer: Uint16Array | Float32Array) {
	if (uvBuffer instanceof Uint16Array) {
		//unpack from float 16
		let uvBufferCopy = new Float32Array(vertexCount * 2);
		for (let i = 0; i < vertexCount * 2; i++) {
			uvBufferCopy[i] = ushortToHalf(uvBuffer[i]);
		}
		attributes.texuvs = new THREE.BufferAttribute(uvBufferCopy, 2);
	} else {
		attributes.texuvs = new THREE.BufferAttribute(uvBuffer, 2);
	}
}

function addNormalsBuffer(attributes: ModelMeshData["attributes"], normalBuffer: Int8Array | Int16Array) {
	let normalsrepacked = new Int8Array(normalBuffer.length);
	//TODO threejs can probly do this for us
	for (let i = 0; i < normalBuffer.length; i += 3) {
		let x = normalBuffer[i + 0];
		let y = normalBuffer[i + 1];
		let z = normalBuffer[i + 2];
		//recalc instead of taking 127 or 32k because apparently its not normalized properly
		let len = Math.hypot(x, y, z);
		if (len == 0) {
			//TODO what does the rs engine do with missing normals?
			len = 1;
		}
		let scale = 127 / len;
		normalsrepacked[i + 0] = Math.round(x * scale);
		normalsrepacked[i + 1] = Math.round(y * scale);
		normalsrepacked[i + 2] = Math.round(z * scale);
	}
	attributes.normals = new THREE.BufferAttribute(normalsrepacked, 3, true);
}

export function parseOb3Model(modelfile: Buffer, source: CacheFileSource) {
	let parsed = parse.models.read(modelfile, source);
	let meshes: ModelMeshData[] = [];

	if (parsed.meshes) {
		for (let mesh of parsed.meshes) {
			if (mesh.isHidden) { continue; }
			let indexBuffers = mesh.indexBuffers;
			let indexlods = indexBuffers.map(q => new THREE.BufferAttribute(q, 1));
			let indexbuf = indexBuffers[0];

			let attributes: ModelMeshData["attributes"] = {
				pos: parsePosData(mesh.positionBuffer!)
			}

			if (mesh.skin) {
				let skinIdBuffer = new Uint16Array(mesh.vertexCount * 4);
				let skinWeightBuffer = new Uint8Array(mesh.vertexCount * 4);
				let weightin = mesh.skin.skinWeightBuffer;
				let idin = mesh.skin.skinBoneBuffer;
				let idindex = 0;
				let weightindex = 0;
				for (let i = 0; i < mesh.vertexCount; i++) {
					let remainder = 255;
					for (let j = 0; j < 4; j++) {
						let weight = weightin[weightindex++];
						let boneid = idin[idindex++];
						let actualweight = (weight != 0 ? weight : remainder);
						remainder -= weight;
						skinIdBuffer[i * 4 + j] = (boneid == 65535 ? 0 : boneid);//TODO this should be boneid+1since we're shifting in -1 to 0?
						skinWeightBuffer[i * 4 + j] = actualweight;
						if (weight == 0) { break; }
					}
				}
				if (idindex != mesh.skin.skinWeightCount || weightindex != mesh.skin.skinWeightCount) {
					console.log("model skin decode failed");
					debugger;
				}
				attributes.skinids = new THREE.BufferAttribute(skinIdBuffer, 4);
				attributes.skinweights = new THREE.BufferAttribute(skinWeightBuffer, 4, true);
			}

			if (mesh.colourBuffer) {
				if (!indexbuf) { throw new Error("need index buf in order to read per-face colors"); }
				let vertexcolor = new Uint8Array(mesh.vertexCount * 4);
				let alphaBuffer = mesh.alphaBuffer;
				for (let i = 0; i < mesh.faceCount; i++) {
					let [r, g, b] = HSL2RGB(packedHSL2HSL(mesh.colourBuffer[i]));
					//iterate triangle vertices
					for (let j = 0; j < 3; j++) {
						let index = indexbuf[i * 3 + j] * 4;
						vertexcolor[index + 0] = r;
						vertexcolor[index + 1] = g;
						vertexcolor[index + 2] = b;
						if (alphaBuffer) {
							vertexcolor[index + 3] = alphaBuffer[i];
						} else {
							vertexcolor[index + 3] = 255;
						}
					}
				}
				attributes.color = new THREE.BufferAttribute(vertexcolor, 4, true);
			}

			if (mesh.boneidBuffer) { addBoneIdBuffer(attributes, mesh.boneidBuffer); }
			if (mesh.uvBuffer) { addUvBuffer(attributes, mesh.vertexCount, mesh.uvBuffer); }
			if (mesh.normalBuffer) { addNormalsBuffer(attributes, mesh.normalBuffer); }

			meshes.push({
				indices: indexlods[0],
				vertexstart: 0,
				vertexend: attributes.pos.count,
				indexLODs: indexlods,
				materialId: mesh.materialArgument - 1,
				hasVertexAlpha: !!mesh.alphaBuffer,
				needsNormalBlending: false,
				attributes: attributes
			});
		}
	} else if (parsed.meshdata) {
		let mesh = parsed.meshdata
		let attributes: ModelMeshData["attributes"] = {
			pos: parsePosData(mesh.positionBuffer!)
		}

		if (mesh.vertexColours) {
			let vertexcolor = new Uint8Array(mesh.vertexCount * 4);
			let alphaBuffer = mesh.vertexAlpha;
			for (let i = 0; i < mesh.vertexColours.length; i++) {
				let [r, g, b] = HSL2RGB(packedHSL2HSL(mesh.vertexColours[i]));
				let alpha = (alphaBuffer ? alphaBuffer[i] : 255);
				let index = i * 4;
				vertexcolor[index + 0] = r;
				vertexcolor[index + 1] = g;
				vertexcolor[index + 2] = b;
				vertexcolor[index + 3] = alpha;
			}
			attributes.color = new THREE.BufferAttribute(vertexcolor, 4, true);
		}

		if (mesh.skin) {
			let skinIdBuffer = new Uint16Array(mesh.vertexCount * 4);
			let skinWeightBuffer = new Uint8Array(mesh.vertexCount * 4);
			for (let i = 0; i < mesh.skin.length; i++) {
				let entry = mesh.skin[i];
				let remainder = 255;
				if (entry.ids.length != entry.weights.length) { throw new Error("unexpected length difference in skin weights/ids"); }
				for (let j = 0; j < entry.ids.length; j++) {
					let weight = entry.weights[j];
					let boneid = entry.ids[j];
					let actualweight = (weight != 0 ? weight : remainder);
					remainder -= weight;
					skinIdBuffer[i * 4 + j] = (boneid == 65535 ? 0 : boneid);//TODO this should be boneid+1since we're shifting in -1 to 0?
					skinWeightBuffer[i * 4 + j] = actualweight;
					if (weight == 0) { break; }
				}
			}
			attributes.skinids = new THREE.BufferAttribute(skinIdBuffer, 4);
			attributes.skinweights = new THREE.BufferAttribute(skinWeightBuffer, 4, true);
		}
		if (mesh.boneidBuffer) { addBoneIdBuffer(attributes, mesh.boneidBuffer); }
		if (mesh.uvBuffer) { addUvBuffer(attributes, mesh.vertexCount, mesh.uvBuffer); }
		if (mesh.normalBuffer) { addNormalsBuffer(attributes, mesh.normalBuffer); }

		for (let render of mesh.renders) {
			if (render.isHidden) { continue; }
			if (render.buf.length == 0) { continue; }
			let buf = render.buf;
			if (buf.BYTES_PER_ELEMENT == 4) {
				//flip endianness, only u32 variant of the index buffer is BE...
				//need to copy because the original file is still cached
				let newbuf = new Uint32Array(buf.length);
				for (let i = 0; i < buf.length; i++) {
					let v = buf[i];
					newbuf[i] = ((v >> 24) & 0xff) | ((v >> 8) & 0xff00) | ((v << 8) & 0xff0000) | ((v << 24) & 0xff000000);
				}
				buf = newbuf;
			}
			let minindex = buf[0];
			let maxindex = buf[0];
			for (let i = 0; i < buf.length; i++) {
				let v = buf[i];
				if (v < minindex) { minindex = v; }
				if (v > maxindex) { maxindex = v; }
			}
			let index = new THREE.BufferAttribute(buf, 1);
			meshes.push({
				indices: index,
				vertexstart: minindex,
				vertexend: maxindex + 1,
				indexLODs: [index],
				materialId: render.materialArgument - 1,
				hasVertexAlpha: !!render.hasVertexAlpha,
				needsNormalBlending: false,
				attributes: attributes
			})
		}
	}

	return makeModelData(meshes);
}

export function makeModelData(meshes: ModelData["meshes"]) {
	let maxy = 0;
	let miny = 0;
	let bonecount = 0;
	let skincount = 0;
	for (let mesh of meshes) {
		//TODO let threejs do this while making the bounding box
		let pos = mesh.attributes.pos;
		for (let i = 0; i < pos.count; i++) {
			let y = pos.getY(i);
			if (y > maxy) { maxy = y }
			if (y < miny) { miny = y }
		}
		let boneids = mesh.attributes.boneids;
		if (boneids) {
			for (let i = 0; i < boneids.count; i++) {
				bonecount = Math.max(bonecount, boneids.getX(i), boneids.getY(i), boneids.getZ(i), boneids.getW(i))
			}
			bonecount += 2;//+1 for max->count, +1 since we add a root bone with id 0
		}
		let skinids = mesh.attributes.skinids;
		if (skinids) {
			for (let i = 0; i < skinids.count; i++) {
				skincount = Math.max(skincount, skinids.getX(i), skinids.getY(i), skinids.getZ(i), skinids.getW(i))
			}
			skincount += 2;//+1 for max->count, +1 since we add a root bone with id 0
		}
	}
	let r: ModelData = { maxy, miny, meshes, bonecount: bonecount, skincount: skincount };
	return r;
}