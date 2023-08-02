import { Stream, packedHSL2HSL, HSL2RGB, ushortToHalf } from "../utils";
import * as THREE from "three";
import { alignedRefOrCopy, ArrayBufferConstructor } from "./gltfutil";
import { CacheFileSource } from "../cache";
import { parse } from "../opdecoder";

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

export function parseOb3Model(modelfile: Buffer, source: CacheFileSource) {
	let parsed = parse.models.read(modelfile, source);

	let maxy = 0;
	let miny = 0;
	let bonecount = 0;
	let skincount = 0;
	let meshes: ModelMeshData[] = [];

	for (let mesh of parsed.meshes) {
		if (mesh.isHidden) {
			//probably something particle related
			continue;
		}

		//highest level of detail only
		let indexBuffers = mesh.indexBuffers;
		let positionBuffer = mesh.positionBuffer;
		let boneidBuffer = mesh.boneidBuffer;
		let normalBuffer = mesh.normalBuffer;

		if (!positionBuffer) { continue; }

		//TODO let threejs do this while making the bounding box
		for (let i = 0; i < positionBuffer.length; i += 3) {
			if (positionBuffer[i + 1] > maxy) {
				maxy = positionBuffer[i + 1];
			}
			if (positionBuffer[i + 1] < miny) {
				miny = positionBuffer[i + 1];
			}
		}
		let indexlods = indexBuffers.map(q => new THREE.BufferAttribute(q, 1));

		let indexbuf = indexBuffers[0];

		let meshdata: ModelMeshData = {
			indices: indexlods[0],
			indexLODs: indexlods,
			materialId: mesh.materialArgument - 1,
			hasVertexAlpha: !!mesh.alphaBuffer,
			needsNormalBlending: false,
			attributes: {
				pos: new THREE.BufferAttribute(new Float32Array(mesh.positionBuffer!), 3)
			}
		};

		//every modern animation system uses 4 skinned bones per vertex instead of one
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
					if (boneid >= skincount) {
						skincount = boneid + 2;//we are adding a root bone at 0, and count is max+1
					}
					if (weight == 0) { break; }
				}
			}
			if (idindex != mesh.skin.skinWeightCount || weightindex != mesh.skin.skinWeightCount) {
				console.log("model skin decode failed");
				debugger;
			}
			meshdata.attributes.skinids = new THREE.BufferAttribute(skinIdBuffer, 4);
			meshdata.attributes.skinweights = new THREE.BufferAttribute(skinWeightBuffer, 4, true);
		}
		if (boneidBuffer) {
			let quadboneids = new Uint8Array(boneidBuffer.length * 4);
			let quadboneweights = new Uint8Array(boneidBuffer.length * 4);
			const maxshort = (1 << 16) - 1;
			for (let i = 0; i < boneidBuffer.length; i++) {
				let id = boneidBuffer[i]
				id = (id == maxshort ? 0 : id + 1);
				quadboneids[i * 4] = id;
				quadboneweights[i * 4] = 255;
				if (id >= bonecount) {
					bonecount = id + 2;//we are adding a root bone at 0, and count is max+1
				}
			}
			meshdata.attributes.boneids = new THREE.BufferAttribute(quadboneids, 4);
			meshdata.attributes.boneweights = new THREE.BufferAttribute(quadboneweights, 4, true);
		}


		if (mesh.uvBuffer) {
			if (mesh.uvBuffer instanceof Uint16Array) {
				//unpack from float 16
				let uvBuffer = new Float32Array(mesh.vertexCount * 2);
				for (let i = 0; i < mesh.vertexCount * 2; i++) {
					uvBuffer[i] = ushortToHalf(mesh.uvBuffer[i]);
				}
				meshdata.attributes.texuvs = new THREE.BufferAttribute(uvBuffer, 2);
			} else {
				meshdata.attributes.texuvs = new THREE.BufferAttribute(mesh.uvBuffer, 2);
			}
		}


		if (normalBuffer) {
			let normalsrepacked = new Float32Array(normalBuffer.length);
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
				normalsrepacked[i + 0] = x / len;
				normalsrepacked[i + 1] = y / len;
				normalsrepacked[i + 2] = z / len;
			}
			meshdata.attributes.normals = new THREE.BufferAttribute(normalsrepacked, 3);// { newtype: "f32", vecsize: 3, source: normalsrepacked };
		}

		//convert per-face attributes to per-vertex
		if (mesh.colourBuffer) {
			let vertexcolor = new Uint8Array(mesh.vertexCount * 4);
			let alphaBuffer = mesh.alphaBuffer;
			meshdata.attributes.color = new THREE.BufferAttribute(vertexcolor, 4, true);
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
		}

		meshes.push(meshdata);
	}

	let r: ModelData = { maxy, miny, meshes, bonecount: bonecount, skincount: skincount };
	return r;
}
