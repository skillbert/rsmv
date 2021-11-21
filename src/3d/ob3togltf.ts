import { JMat, JMatInternal } from "./jmat";
import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { GLTFBuilder } from "./gltf";
import { GlTf, MeshPrimitive, Material } from "./gltftype";
import { cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { glTypeIds, ModelAttribute, streamChunk, vartypeEnum, buildAttributeBuffer, AttributeSoure } from "./gltfutil";

//can't use module import syntax because es6 wants to be more es6 than es6
const THREE = require("three/build/three.js") as typeof import("three");

export type FileGetter = (major: number, minor: number) => Promise<Buffer>;



//a wrapper around gltfbuilder that ensures that resouces are correctly shared
export class GLTFSceneCache {
	getFileById: FileGetter;
	textureCache = new Map<number, number>();
	gltfMaterialCache = new Map<number, Promise<number>>();
	gltf = new GLTFBuilder();

	constructor(getfilebyid: FileGetter) {
		this.getFileById = getfilebyid;
	}

	async getTextureFile(texid: number, allowAlpha) {
		let cached = this.textureCache.get(texid);
		if (cached) { return cached; }

		let file = await this.getFileById(cacheMajors.texturesDds, texid);
		let parsed = new ParsedTexture(file, allowAlpha);
		let texnode = this.gltf.addImage(await parsed.convertFile("png"));
		this.textureCache.set(texid, texnode);
		return texnode;
	}

	async getGlTfMaterial(matid: number, hasVertexAlpha: boolean) {
		//create a seperate material if we have alpha
		//TODO the material should have this data, not the mesh
		let matcacheid = matid | (hasVertexAlpha ? 0x800000 : 0);
		let cached = this.gltfMaterialCache.get(matcacheid);
		if (!cached) {
			cached = (async () => {
				let { textures, alphamode } = await getMaterialData(this.getFileById, matid);

				let materialdef: Material = {
					//TODO check if diffuse has alpha as well
					alphaMode: hasVertexAlpha ? "BLEND" : "OPAQUE"
				}

				let sampler = this.gltf.addSampler({});//TODO wrapS wrapT from material flags

				if (textures.diffuse) {
					materialdef.pbrMetallicRoughness = {};
					//TODO animated texture UV's (fire cape)
					materialdef.pbrMetallicRoughness.baseColorTexture = {
						index: this.gltf.addTexture({ sampler, source: await this.getTextureFile(textures.diffuse, alphamode != "opaque") }),
					};
					//materialdef.pbrMetallicRoughness.baseColorFactor = [factors.color, factors.color, factors.color, 1];
					if (typeof textures.metalness != "undefined") {
						if (textures.metalness) {
							materialdef.pbrMetallicRoughness.metallicRoughnessTexture = {
								index: this.gltf.addTexture({ sampler, source: await this.getTextureFile(textures.metalness, false) })
							}
						}
						//materialdef.pbrMetallicRoughness.metallicFactor = factors.metalness;
					}
				}
				if (textures.normal) {
					materialdef.normalTexture = {
						index: this.gltf.addTexture({ sampler, source: await this.getTextureFile(textures.normal, false) })
					}
				}
				if (textures.specular) {
					//TODO not directly supported in gltf
				}
				return this.gltf.addMaterial(materialdef);
			})();
			this.gltfMaterialCache.set(matcacheid, cached);
		}
		return cached;
	}
}

export type MaterialData = {
	textures: {
		diffuse?: number,
		specular?: number,
		metalness?: number,
		color?: number,
		normal?: number,
		compound?: number
	},
	alphamode: "opaque" | "cutoff" | "blend"
	raw: any
}
//this one is narly, i have touched it as little as possible, needs a complete refactor together with JMat
export async function getMaterialData(getFile: FileGetter, matid: number) {
	let material: MaterialData = {
		textures: {},
		alphamode: "opaque",
		raw: undefined
	};
	//TODO unused atm
	let factors = {
		metalness: 1,
		specular: 1,
		color: 1
	}
	let originalMaterial: JMatInternal | null = null;
	if (matid != -1) {
		var materialfile = await getFile(cacheMajors.materials, matid);

		if (materialfile[0] == 0x00) {
			var mat = new JMat(materialfile).get();
			material.raw = mat;
			originalMaterial = mat;
			material.textures.diffuse = mat.maps["diffuseId"];
			material.textures.metalness = 0;
			material.textures.specular = 0;
			factors.specular = mat.specular / 255;
			factors.metalness = mat.metalness / 255;
			factors.color = mat.colour / 255;
			material.alphamode = mat.alphaMode == 0 ? "opaque" : mat.alphaMode == 1 ? "cutoff" : "blend";
		}
		else if (materialfile[0] == 0x01) {
			var mat = new JMat(materialfile).get();
			material.raw = mat;
			originalMaterial = mat;
			if (mat.flags.hasDiffuse)
				material.textures.diffuse = mat.maps["diffuseId"];
			if (mat.flags.hasNormal)
				material.textures.normal = mat.maps["normalId"];
			if (mat.flags.hasCompound)
				material.textures.compound = mat.maps["compoundId"];
		}
	}
	return material;
}

//TODO remove or rewrite
export async function ob3ModelToGltfFile(getFile: FileGetter, model: Buffer, mods: ModelModifications) {
	// let scene = new GLTFSceneCache(getFile);
	// let stream = new Stream(model);
	// let mesh = await addOb3Model(scene, parseOb3Model(stream, mods));
	// //flip z to go from right-handed to left handed
	// let rootnode = scene.gltf.addNode({ mesh: mesh, scale: [1, 1, -1] });
	// scene.gltf.addScene({ nodes: [rootnode] });
	// let result = await scene.gltf.convert({ singlefile: true, glb: false });
	// console.log("gltf", scene.gltf.json);
	// return result.mainfile;
}

export type ModelData = {
	maxy: number,
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
		texuvs?: THREE.BufferAttribute
	}
}

export function parseOb3Model(model: Stream, modifications: ModelModifications) {

	let format = model.readByte();
	let unk1 = model.readByte(); //always 03?
	let version = model.readByte();
	let meshCount = model.readUByte();
	let unkCount0 = model.readUByte();
	let unkCount1 = model.readUByte();
	let unkCount2 = model.readUShort();
	//console.log(unkCount0,unkCount1,unkCount2,unk1)

	let maxy = 0;
	let meshes: ModelMeshData[] = [];

	for (var n = 0; n < meshCount; ++n) {
		// Flag 0x10 is currently used, but doesn't appear to change the structure or data in any way
		let groupFlags = model.readUInt();

		// Unknown, probably pertains to materials transparency maybe?
		let unk6 = model.readUByte();
		let materialArgument = model.readUShort();
		let faceCount = model.readUShort();

		let hasVertices = (groupFlags & 0x01) != 0;
		let hasVertexAlpha = (groupFlags & 0x02) != 0;
		let hasFlag4 = (groupFlags & 0x04) != 0;
		let hasBoneids = (groupFlags & 0x08) != 0;

		let colourBuffer: Uint8Array | null = null;
		let alphaBuffer: Uint8Array | null = null;
		let positionBuffer: Int16Array | null = null;
		let normalBuffer: Int8Array | null = null;
		let uvBuffer: Float32Array | null = null;
		let boneidBuffer: Uint16Array | null = null;

		if (hasVertices) {
			let replaces = modifications.replaceColors ?? [];
			replaces.push([39834, 43220]);//TODO what is this? found it hard coded in before
			colourBuffer = new Uint8Array(faceCount * 3);
			for (var i = 0; i < faceCount; ++i) {
				var faceColour = model.readUShort();
				for (let repl of replaces) {
					if (faceColour == repl[0]) {
						faceColour = repl[1];
						break;
					}
				}
				var colour = HSL2RGB(packedHSL2HSL(faceColour));
				colourBuffer[i * 3 + 0] = colour[0];
				colourBuffer[i * 3 + 1] = colour[1];
				colourBuffer[i * 3 + 2] = colour[2];
			}
		}
		if (hasVertexAlpha) {
			alphaBuffer = streamChunk(Uint8Array, model, faceCount);
		}

		//(Unknown, flag 0x04)
		if (hasFlag4) {
			//apparently these are actually encoded as float16, but we aren't using them anyway
			let flag4Buffer = streamChunk(Uint16Array, model, faceCount);
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
				//group.uvBuffer = streamChunk(Uint16Array, model, group.vertexCount * 2);
			}
			if (hasBoneids) {
				//TODO there can't be more than ~50 bones in the engine, what happens to the extra byte?
				boneidBuffer = streamChunk(Uint16Array, model, vertexCount);
			}
		}

		if (!positionBuffer) {
			console.log("skipped mesh without position buffer")
			continue;
		}


		//TODO somehow this doesn't always work
		let materialId = materialArgument - 1
		if (materialId != -1) {
			let replacedmaterial = modifications.replaceMaterials?.find(q => q[0] == materialId)?.[1];
			if (typeof replacedmaterial != "undefined") {
				materialId = replacedmaterial;
			}
		}
		//TODO let threejs do this while making the bounding box
		for (let i = 0; i < positionBuffer.length; i += 3) {
			if (positionBuffer[i + 1] > maxy) {
				maxy = positionBuffer[i + 1];
			}
		}
		// let positionfloatbuffer = new Float32Array(positionBuffer);


		//highest level of detail only
		let indexbuf = indexBuffers[0];

		let meshdata: ModelMeshData = {
			indices: new THREE.BufferAttribute(indexbuf, 1),
			materialId,
			hasVertexAlpha,
			attributes: {
				pos: new THREE.BufferAttribute(positionBuffer, 3)
			}
		};
		meshes.push(meshdata);

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
			//TODO might be able to let three do this for us
			meshdata.attributes.color = new THREE.BufferAttribute(vertexcolor, 4, true);
			//copy this face color to all vertices on the face
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
		//TODO proper toggle for this or remove
		//visualize bone ids
		// materialArgument = 0;
		// let vertexcolor = new Uint8Array(vertexCount * 4);
		// attrsources.color = { newtype: "u8", vecsize: 4, source: vertexcolor };
		// for (let i = 0; i < vertexCount; i++) {
		// 	let index = i * 4;
		// 	let boneid = boneidBuffer ? boneidBuffer[i] : 0;
		// 	vertexcolor[index + 0] = (73 + boneid * 9323) % 256;
		// 	vertexcolor[index + 1] = (171 + boneid * 1071) % 256;
		// 	vertexcolor[index + 2] = (23 + boneid * 98537) % 256;
		// 	vertexcolor[index + 3] = 255;
		// }
	}
	let r: ModelData = { maxy, meshes };
	return r;
}

//TODO remove or rebuild
export async function addOb3Model(scenecache: GLTFSceneCache, model: ModelData) {
	// let gltf = scenecache.gltf;
	// let primitives: MeshPrimitive[] = [];

	// for (let meshdata of model.meshes) {
	// 	let { buffer, attributes, bytestride, vertexcount } = buildAttributeBuffer(meshdata.attributes);

	// 	let attrs: MeshPrimitive["attributes"] = {};

	// 	let view = gltf.addBufferWithView(buffer, bytestride, false);
	// 	attrs.POSITION = gltf.addAttributeAccessor(attributes.pos, view, vertexcount);
	// 	if (attributes.normals) {
	// 		attrs.NORMAL = gltf.addAttributeAccessor(attributes.normals, view, vertexcount);
	// 	}
	// 	if (attributes.texuvs) {
	// 		attrs.TEXCOORD_0 = gltf.addAttributeAccessor(attributes.texuvs, view, vertexcount);
	// 	}
	// 	if (attributes.color) {
	// 		attributes.color.normalize = true;
	// 		attrs.COLOR_0 = gltf.addAttributeAccessor(attributes.color, view, vertexcount);
	// 	}

	// 	let viewIndex = gltf.addBufferWithView(meshdata.indices, undefined, true);

	// 	let indices = gltf.addAccessor({
	// 		componentType: glTypeIds.u16.gltype,
	// 		count: meshdata.indices.length,
	// 		type: "SCALAR",
	// 		bufferView: viewIndex
	// 	});

	// 	let materialNode: number | undefined = undefined;
	// 	if (meshdata.materialId != -1) {
	// 		materialNode = await scenecache.getGlTfMaterial(meshdata.materialId, meshdata.hasVertexAlpha);
	// 	}

	// 	primitives.push({
	// 		attributes: attrs,
	// 		indices: indices,
	// 		material: materialNode
	// 	});
	// }
	// let mesh = gltf.addMesh({ primitives });
	// //enables use of normalized ints for a couple of attribute types
	// //gltf.addExtension("KHR_mesh_quantization", true);
	// return mesh;//gltf.addNode({ mesh });
}