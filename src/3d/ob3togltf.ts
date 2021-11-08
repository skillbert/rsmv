import { JMat, JMatInternal } from "./jmat";
import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { GLTFBuilder } from "./gltf";
import { GlTf, MeshPrimitive, Material } from "./gltftype";
import { cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { glTypeIds, ModelAttribute, streamChunk, vartypeEnum, buildAttributeBuffer, AttributeSoure } from "./gltfutil";

type FileGetter = (major: number, minor: number) => Promise<Buffer>;

//a wrapper around gltfbuilder that ensures that resouces are correctly shared
export class GLTFSceneCache {
	getFileById: FileGetter;
	textureCache = new Map<number, number>();
	materialCache = new Map<number, number>();
	gltf = new GLTFBuilder();

	constructor(getfilebyid: FileGetter) {
		this.getFileById = getfilebyid;
	}

	async getTextureFile(texid: number) {
		let cached = this.textureCache.get(texid);
		if (cached) { return cached; }

		let file = await this.getFileById(cacheMajors.texturesDds, texid);
		let parsed = new ParsedTexture(file);
		let texnode = this.gltf.addImage(await parsed.convertFile("png"));
		this.textureCache.set(texid, texnode);
		return texnode;
	}
	//this one is narly, i have touched it as little as possible, needs a complete refactor together with JMat
	async getMaterial(matid: number, hasVertexAlpha: boolean) {
		//create a seperate material if we have alpha
		//TODO the material should have this data, not the mesh
		let matcacheid = matid | (hasVertexAlpha ? 0x800000 : 0);
		let cached = this.materialCache.get(matcacheid);
		if (cached) { return cached; }

		let textures: {
			diffuse?: number,
			specular?: number,
			metalness?: number,
			color?: number,
			normal?: number,
			compound?: number
		} = {};
		let factors = {
			metalness: 1,
			specular: 1,
			color: 1
		}
		let originalMaterial: JMatInternal | null = null;
		if (matid != -1) {
			var materialfile = await this.getFileById(cacheMajors.materials, matid);

			if (materialfile[0] == 0x00) {
				var mat = new JMat(materialfile).get();
				originalMaterial = mat;
				textures.diffuse = mat.maps["diffuseId"];
				textures.metalness = 0;
				textures.specular = 0;
				factors.specular = mat.specular / 255;
				factors.metalness = mat.metalness / 255;
				factors.color = mat.colour / 255;
			}
			else if (materialfile[0] == 0x01) {
				var mat = new JMat(materialfile).get();
				originalMaterial = mat;
				if (mat.flags.hasDiffuse)
					textures.diffuse = mat.maps["diffuseId"];
				if (mat.flags.hasNormal)
					textures.normal = mat.maps["normalId"];
				if (mat.flags.hasCompound)
					textures.compound = mat.maps["compoundId"];
			}
		}

		//===== do the gltf stuff =====

		let materialdef: Material = {
			//TODO check if diffuse has alpha as well
			alphaMode: hasVertexAlpha ? "BLEND" : "OPAQUE"
		}

		let sampler = this.gltf.addSampler({});//TODO wrapS wrapT from material flags

		if (textures.diffuse) {
			materialdef.pbrMetallicRoughness = {};
			//TODO animated texture UV's (fire cape)
			materialdef.pbrMetallicRoughness.baseColorTexture = {
				index: this.gltf.addTexture({ sampler, source: await this.getTextureFile(textures.diffuse) }),
			};
			//materialdef.pbrMetallicRoughness.baseColorFactor = [factors.color, factors.color, factors.color, 1];
			if (typeof textures.metalness != "undefined") {
				if (textures.metalness) {
					materialdef.pbrMetallicRoughness.metallicRoughnessTexture = {
						index: this.gltf.addTexture({ sampler, source: await this.getTextureFile(textures.metalness) })
					}
				}
				//materialdef.pbrMetallicRoughness.metallicFactor = factors.metalness;
			}
		}
		if (textures.normal) {
			materialdef.normalTexture = {
				index: this.gltf.addTexture({ sampler, source: await this.getTextureFile(textures.normal) })
			}
		}
		if (textures.specular) {
			//TODO not directly supported in gltf
		}
		let materialnode = this.gltf.addMaterial(materialdef);
		this.materialCache.set(matcacheid, materialnode);
		return materialnode;
	}
}

export async function ob3ModelToGltfFile(getFile: FileGetter, model: Buffer, mods: ModelModifications) {
	let scene = new GLTFSceneCache(getFile);
	let stream = new Stream(model);
	let mesh = await addOb3Model(scene, parseOb3Model(stream, mods));
	//flip z to go from right-handed to left handed
	let rootnode = scene.gltf.addNode({ mesh: mesh.mesh, scale: [1, 1, -1] });
	scene.gltf.addScene({ nodes: [rootnode] });
	let result = await scene.gltf.convert({ singlefile: true, glb: false });
	console.log("gltf", scene.gltf.json);
	return result.mainfile;
}

export type ModelMeshData = {
	indices: Uint16Array,
	materialId: number,
	hasVertexAlpha: boolean,
	attributes: {
		pos: AttributeSoure,
		normals?: AttributeSoure,
		color?: AttributeSoure,
		texuvs?: AttributeSoure
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

		//highest level of detail only
		let indexbuf = indexBuffers[0];



		let meshdata: ModelMeshData = {
			indices: indexbuf,
			materialId,
			hasVertexAlpha,
			attributes: {
				pos: { newtype: "f32", vecsize: 3, source: positionBuffer }
			}
		};
		meshes.push(meshdata);

		if (uvBuffer) {
			meshdata.attributes.texuvs = { newtype: "f32", vecsize: 2, source: uvBuffer };
		}

		if (normalBuffer) {
			let normalsrepacked = new Float32Array(normalBuffer.length);
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
			meshdata.attributes.normals = { newtype: "f32", vecsize: 3, source: normalsrepacked };
		}

		//convert per-face attributes to per-vertex
		if (colourBuffer) {
			let vertexcolor = new Uint8Array(vertexCount * 4);
			meshdata.attributes.color = { newtype: "u8", vecsize: 4, source: vertexcolor };
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
	return meshes;
}


export async function addOb3Model(scenecache: GLTFSceneCache, meshes: ModelMeshData[]) {
	let gltf = scenecache.gltf;
	let maxy = 0;
	let primitives: MeshPrimitive[] = [];

	for (let meshdata of meshes) {
		let { buffer, attributes, bytestride, vertexcount } = buildAttributeBuffer(meshdata.attributes);

		let attrs: MeshPrimitive["attributes"] = {};

		let view = gltf.addBufferWithView(buffer, bytestride, false);
		attrs.POSITION = gltf.addAttributeAccessor(attributes.pos, view, vertexcount);
		if (attributes.normals) {
			attrs.NORMAL = gltf.addAttributeAccessor(attributes.normals, view, vertexcount);
		}
		if (attributes.texuvs) {
			attrs.TEXCOORD_0 = gltf.addAttributeAccessor(attributes.texuvs, view, vertexcount);
		}
		if (attributes.color) {
			attributes.color.normalize = true;
			attrs.COLOR_0 = gltf.addAttributeAccessor(attributes.color, view, vertexcount);
		}

		let viewIndex = gltf.addBufferWithView(meshdata.indices, undefined, true);

		let indices = gltf.addAccessor({
			componentType: glTypeIds.u16.gltype,
			count: meshdata.indices.length,
			type: "SCALAR",
			bufferView: viewIndex
		});

		let materialNode: number | undefined = undefined;
		if (meshdata.materialId != -1) {
			materialNode = await scenecache.getMaterial(meshdata.materialId, meshdata.hasVertexAlpha);
		}

		primitives.push({
			attributes: attrs,
			indices: indices,
			material: materialNode
		});
		maxy = Math.max(maxy, attributes.pos.max[1]);
	}
	let mesh = gltf.addMesh({ primitives });
	//enables use of normalized ints for a couple of attribute types
	//gltf.addExtension("KHR_mesh_quantization", true);
	return { mesh, maxy };//gltf.addNode({ mesh });
}