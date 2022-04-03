import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { glTypeIds, ModelAttribute, streamChunk, vartypeEnum, AttributeSoure } from "./gltfutil";
import * as THREE from "three";

export type ModelData = {
	maxy: number,
	miny: number,
	bonecount: number,
	meshes: ModelMeshData[]
}

export type ModelMeshData = {
	indices: THREE.BufferAttribute,
	materialId: number,
	hasVertexAlpha: boolean,
	attributes: {
		pos: THREE.BufferAttribute,
		normals?: THREE.BufferAttribute,
		color?: THREE.BufferAttribute,
		texuvs?: THREE.BufferAttribute,
		skinids?: THREE.BufferAttribute,
		skinweights?: THREE.BufferAttribute
	}
}

export function parseOb3Model(modelfile: Buffer) {
	let model: Stream = new Stream(modelfile);
	let format = model.readByte();
	let unk1 = model.readByte(); //always 03?
	let version = model.readByte();
	let meshCount = model.readUByte();
	let unkCount0 = model.readUByte();
	let unkCount1 = model.readUByte();
	let unkCount2 = model.readUByte();
	let unkCount3 = model.readUByte();
	// console.log("model unks", unk1, unkCount0, unkCount1, unkCount2, unkCount3);

	let maxy = 0;
	let miny = 0;
	let bonecount = 0;
	let meshes: ModelMeshData[] = [];

	for (var n = 0; n < meshCount; ++n) {
		// Flag 0x10 is currently used, but doesn't appear to change the structure or data in any way
		let groupFlags = model.readUInt();

		// Unknown, probably pertains to materials transparency maybe?
		let unk6 = model.readUByte();
		let materialArgument = model.readUShort();
		let faceCount = model.readUShort();

		let materialId = materialArgument - 1;

		let hasVertices = (groupFlags & 0x01) != 0;
		let hasVertexAlpha = (groupFlags & 0x02) != 0;
		let hasFaceBones = (groupFlags & 0x04) != 0;
		let hasBoneids = (groupFlags & 0x08) != 0;
		let isHidden = (groupFlags & 0x10) != 0;
		let hasSkin = (groupFlags & 0x20) != 0;
		// console.log(n, "mat", materialId, "faceCount", faceCount, "hasFaceBones:", hasFaceBones, "ishidden:", isHidden, "hasflag20:", hasFlag20, "unk6:", unk6);
		if (groupFlags & ~0x2f) {
			console.log("unknown model flags", groupFlags & ~0x2f);
		}

		let colourBuffer: Uint8Array | null = null;
		let alphaBuffer: Uint8Array | null = null;
		let positionBuffer: ArrayLike<number> | null = null;
		let normalBuffer: ArrayLike<number> | null = null;
		let uvBuffer: Float32Array | null = null;
		let boneidBuffer: Uint16Array | null = null;
		let skinIdBuffer: Uint16Array | null = null;
		let skinWeightBuffer: Uint8Array | null = null;
		let faceboneidBuffer: Uint16Array | null = null;

		if (hasVertices) {
			colourBuffer = new Uint8Array(faceCount * 3);
			for (var i = 0; i < faceCount; ++i) {
				var faceColour = model.readUShort();
				var colour = HSL2RGB(packedHSL2HSL(faceColour));
				colourBuffer[i * 3 + 0] = colour[0];
				colourBuffer[i * 3 + 1] = colour[1];
				colourBuffer[i * 3 + 2] = colour[2];
			}
		}
		if (hasVertexAlpha) {
			alphaBuffer = streamChunk(Uint8Array, model, faceCount);
		}

		//bone ids per face, face/vertex color related?
		if (hasFaceBones) {
			faceboneidBuffer = streamChunk(Uint16Array, model, faceCount);
		}

		let indexBufferCount = model.readUByte();
		let indexBuffers: Uint16Array[] = [];
		for (var i = 0; i < indexBufferCount; ++i) {
			var indexCount = model.readUShort();
			indexBuffers.push(streamChunk(Uint16Array, model, indexCount));
		}

		//not sure what happens without these flags
		let vertexCount = 0;
		if (hasVertices || hasBoneids) {
			vertexCount = model.readUShort();
			if (hasVertices) {
				positionBuffer = streamChunk(Int16Array, model, vertexCount * 3);
				normalBuffer = streamChunk(Int8Array, model, vertexCount * 3);
				//not currently used
				let tangentBuffer = streamChunk(Int8Array, model, vertexCount * 4);
				uvBuffer = new Float32Array(vertexCount * 2);
				for (let i = 0; i < vertexCount * 2; i++) {
					uvBuffer[i] = model.readHalf();
				}
			}
			if (hasBoneids) {
				//TODO there can't be more than ~50 bones in the engine, what happens to the extra byte?
				boneidBuffer = streamChunk(Uint16Array, model, vertexCount);
			}
		}
		if (hasSkin) {
			let count = model.readUInt();

			let rawbuf = streamChunk(Uint8Array, model, count * 3);
			let dataindex = 0;
			let weightindex = count * 2;

			skinIdBuffer = new Uint16Array(vertexCount * 4);
			skinWeightBuffer = new Uint8Array(vertexCount * 4);
			for (let i = 0; i < vertexCount; i++) {
				let remainder = 255;
				for (let j = 0; j < 4; j++) {
					let weight = rawbuf[weightindex++];
					let boneid = rawbuf[dataindex++] | (rawbuf[dataindex++] << 8);//manual 16bit building since it might not be alligned
					let actualweight = (weight != 0 ? weight : remainder);
					remainder -= weight;
					skinIdBuffer[i * 4 + j] = (boneid==65535?0:boneid);
					skinWeightBuffer[i * 4 + j] = actualweight;
					if (weight == 0) { break; }
				}
			}
			if (dataindex != count * 2 || weightindex != count * 3) {
				console.log("model skin decode failed");
				debugger;
			}
		}

		if (isHidden) {
			console.log("skipped mesh with 0x10 flag");
			continue;
		}

		if (!positionBuffer) {
			console.log("skipped mesh without position buffer")
			continue;
		}

		//TODO somehow this doesn't always work
		if (materialId != -1) {
			// let replacedmaterial = modifications.replaceMaterials?.find(q => q[0] == materialId)?.[1];
			// if (typeof replacedmaterial != "undefined") {
			// 	materialId = replacedmaterial;
			// }
		}
		//TODO let threejs do this while making the bounding box
		for (let i = 0; i < positionBuffer.length; i += 3) {
			if (positionBuffer[i + 1] > maxy) {
				maxy = positionBuffer[i + 1];
			}
			if (positionBuffer[i + 1] < miny) {
				miny = positionBuffer[i + 1];
			}
		}

		//highest level of detail only
		let indexbuf = indexBuffers[0];

		let meshdata: ModelMeshData = {
			indices: new THREE.BufferAttribute(indexbuf, 1),
			materialId,
			hasVertexAlpha,
			attributes: {
				pos: new THREE.BufferAttribute(new Float32Array(positionBuffer), 3)
			}
		};
		meshes.push(meshdata);

		//every modern animation system uses 4 skinned bones per vertex instead of one
		if (skinIdBuffer && skinWeightBuffer) {
			meshdata.attributes.skinids = new THREE.BufferAttribute(skinIdBuffer, 4);
			meshdata.attributes.skinweights = new THREE.BufferAttribute(skinWeightBuffer, 4, true);
		} else if (boneidBuffer) {
			let quadboneids = new Uint8Array(boneidBuffer.length * 4);
			let quadboneweights = new Uint8Array(boneidBuffer.length * 4);
			const maxshort = (1 << 16) - 1;
			for (let i = 0; i < boneidBuffer.length; i++) {
				let id = boneidBuffer[i]
				id = (id == maxshort ? 0 : id + 1);
				quadboneids[i * 4] = id;
				quadboneweights[i * 4] = 255;
				if (id >= bonecount) {
					bonecount = id + 1;
				}
			}
			meshdata.attributes.skinids = new THREE.BufferAttribute(quadboneids, 4);
			meshdata.attributes.skinweights = new THREE.BufferAttribute(quadboneweights, 4, true);
		}


		if (uvBuffer) {
			meshdata.attributes.texuvs = new THREE.BufferAttribute(uvBuffer, 2);
		}


		if (normalBuffer) {
			let normalsrepacked = new Float32Array(normalBuffer.length);
			//TODO threejs can probly do this for us
			for (let i = 0; i < normalBuffer.length; i += 3) {
				let x = normalBuffer[i + 0];
				let y = normalBuffer[i + 1];
				let z = normalBuffer[i + 2];
				//recalc instead of taking 255 because apparently its not normalized properly
				let len = Math.hypot(x, y, z);
				normalsrepacked[i + 0] = x / len;
				normalsrepacked[i + 1] = y / len;
				normalsrepacked[i + 2] = z / len;
			}
			meshdata.attributes.normals = new THREE.BufferAttribute(normalsrepacked, 3);// { newtype: "f32", vecsize: 3, source: normalsrepacked };
		}

		//convert per-face attributes to per-vertex
		if (colourBuffer) {
			let vertexcolor = new Uint8Array(vertexCount * 4);
			meshdata.attributes.color = new THREE.BufferAttribute(vertexcolor, 4, true);
			for (let i = 0; i < faceCount; i++) {
				//iterate triangle vertices
				for (let j = 0; j < 3; j++) {
					let index = indexbuf[i * 3 + j] * 4;
					vertexcolor[index + 0] = colourBuffer[i * 3 + 0];
					vertexcolor[index + 1] = colourBuffer[i * 3 + 1];
					vertexcolor[index + 2] = colourBuffer[i * 3 + 2];
					if (alphaBuffer) {
						vertexcolor[index + 3] = alphaBuffer[i];
					} else {
						vertexcolor[index + 3] = 255;
					}
				}
			}
		}

		// TODO proper toggle for this or remove
		// visualize bone ids
		// materialArgument = 0;
		// let vertexcolor = new Uint8Array(vertexCount * 4);
		// meshdata.attributes.color = new THREE.BufferAttribute(vertexcolor, 4, true);
		// const bonecols = [
		// 	// [255, 255, 255],//0 white no bone
		// 	[255, 0, 0],//1 red
		// 	[0, 255, 0],//2 green
		// 	[0, 0, 255],//3 blue
		// 	[15, 0, 0],//4 red--
		// 	[0, 15, 0],//5 green--
		// 	[0, 0, 15],//6 blue--
		// 	[255, 255, 0],//7 yellow
		// 	[0, 255, 255],//8 cyan
		// 	[255, 0, 255],//9 purple
		// ];
		// let bonecomponent = (i: number, skinindex: number) => {
		// 	let boneid = meshdata.attributes.skinids?.array[i + skinindex] ?? 0;
		// 	let weight = meshdata.attributes.skinweights?.array[i + skinindex] ?? (skinindex == 0 ? 255 : 0);
		// 	// let weight = 255;
		// 	vertexcolor[i + 0] += (boneid < bonecols.length ? bonecols[boneid][0] : (73 + boneid * 9323) % 256) * weight / 255;
		// 	vertexcolor[i + 1] += (boneid < bonecols.length ? bonecols[boneid][1] : (73 + boneid * 9323) % 256) * weight / 255;
		// 	vertexcolor[i + 2] += (boneid < bonecols.length ? bonecols[boneid][2] : (171 + boneid * 1071) % 256) * weight / 255;
		// }
		// for (let i = 0; i < vertexCount; i++) {
		// 	let index = i * 4;
		// 	vertexcolor[index + 0] = 0;
		// 	vertexcolor[index + 1] = 0;
		// 	vertexcolor[index + 2] = 0;
		// 	vertexcolor[index + 3] = 255;
		// 	bonecomponent(index, 0);
		// 	bonecomponent(index, 1);
		// 	bonecomponent(index, 2);
		// 	bonecomponent(index, 3);
		// }
	}
	for (let n = 0; n < unkCount1; n++) {
		console.log("unk1", unkCount1);
		model.skip(37);
	}
	for (let n = 0; n < unkCount2; n++) {
		console.log("unk2", unkCount2);
		model.skip(2);//material id?
		for (let i = 0; i < 3; i++) {
			model.skip(2); model.skip(2);//u16 flags mostly 0x0000,0x0040,0x0080, f16 position? mostly -5.0<x<5.0
			model.skip(2); model.skip(2);//u16 flags, f16?
			model.skip(2); model.skip(2);//u16 flags, f16?
			model.skip(2);//i16, mostly -1, otherwise <400
		}
	}
	for (let n = 0; n < unkCount3; n++) {
		console.log("unk3", unkCount3);
		model.skip(16);
	}


	let r: ModelData = { maxy, miny, meshes, bonecount };

	if (model.scanloc() != model.getData().length) {
		console.log("extra model bytes", model.getData().length - model.scanloc(), "format", format, "unk1", unk1, "version", version, "unkcounts", unkCount0, unkCount1, unkCount2, unkCount3);
		// fs.writeFileSync(`cache/particles/${Date.now()}.bin`, model.getData().slice(model.scanloc()));
	}
	return r;
}
