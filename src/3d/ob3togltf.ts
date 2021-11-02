import { JMat, JMatInternal } from "./jmat";
import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { GLTFBuilder } from "./gltf";
import { GlTf, MeshPrimitive, Material } from "./gltftype";
import { cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { glTypeIds, ModelAttribute, streamChunk, vartypeEnum, buildAttributeBuffer, AttributeSoure } from "./gltfutil";

type Mesh = {
	groupFlags: number;
	unk6: number;
	faceCount: number;
	materialId: number;

	colourBuffer: Uint8Array;//per face
	alphaBuffer: Uint8Array;//per face
	flag4Buffer: Uint16Array;//per face, could be a float16 actually but we don't care atm
	indexBuffers: Uint16Array[];//different index buffers for different levels of detail
	positionBuffer: Int16Array;//int16
	normalBuffer: Int8Array;
	tangentBuffer: Int8Array;//normals as well as tangents?
	uvBuffer: Float32Array;
	boneidBuffer: Uint16Array;

	indexBufferCount: number;
	vertexCount: number;

	material: JMatInternal;
	textures: { [key: string]: number | Texture };
	specular: number;
	metalness: number;
	colour: number;
}

type Texture = HTMLImageElement & {
	isReady: boolean;
	parent: OB3;
	id: string;//TODO actually sets id of HtmlElement and possibly messes up document.getElementById
};


//TODO just move this to a function
export class OB3 {
	getFile: (major: number, minor: number) => Promise<Buffer>

	format = 2;
	version = 0;
	meshCount = 0;
	materialGroups: Mesh[] = [];
	unk1 = 0;
	unkCount0 = 0;
	unkCount1 = 0;
	unkCount2 = 0;
	particlePoolCount;
	unk2;
	model: Stream | null = null;
	gltf = new GLTFBuilder();
	onfinishedloading: (() => void) | (() => void)[] = [];
	modifications: ModelModifications = {};
	constructor(getFile: (major: number, minor: number) => Promise<Buffer>) {
		this.getFile = (m, id) => {
			console.log(`gltf getting ${m} ${id}`);
			return getFile(m, id);
		}
	}

	setData(data: Buffer, modifications: ModelModifications) {
		this.model = new Stream(data);
		this.modifications = modifications;
		return this.parse();
	}

	getVersion() {
		return this.version;
	}

	getPretty() {
		return {
			"___format": this.format,
			"___unk1": this.unk1,
			"___version": this.version,
			"__meshCount": this.meshCount,
			"__unkCount1": this.unk2,
			"_particlePoolCount": this.particlePoolCount
		};
	}


	//need this cache to dedupe the images in the resulting model file
	textureCache: { [id: number]: number } = {};

	async getTextureFile(texid: number) {
		if (typeof this.textureCache[texid] == "undefined") {
			let file = await this.getFile(cacheMajors.texturesPng, texid);
			let parsed = new ParsedTexture(file);
			this.textureCache[texid] = this.gltf.addImage(await parsed.convertFile("png"));
		}
		return this.textureCache[texid];
	}

	//this one is narly, i have touched it as little as possible, needs a complete refactor together with JMat
	async parseMaterial(matid: number) {
		for (let repl of this.modifications.replaceMaterials ?? []) {
			if (matid == repl[0]) {
				matid = repl[1];
				break;
			}
		}

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
		let environment = 5522;
		if (matid != -1) {
			var materialfile = await this.getFile(cacheMajors.materials, matid);

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

		return { textures, environment, originalMaterial, factors };
	}

	async parse() {
		if (!this.model) { throw new Error("model not set"); }
		this.format = this.model.readByte();              // Format number
		this.unk1 = this.model.readByte();                // Unknown, always 03?
		this.version = this.model.readByte();             // Version
		this.meshCount = this.model.readUByte();          // Material group count
		this.unkCount0 = this.model.readUByte();          // Unknown
		this.unkCount1 = this.model.readUByte();          // Unknown
		this.unkCount2 = this.model.readUShort();         // Unknown
		var model = this.model;


		let gltf = this.gltf;
		let prims: MeshPrimitive[] = [];

		for (var n = 0; n < this.meshCount; ++n) {
			var group: Mesh = {} as any;
			group.groupFlags = this.model.readUInt();        // Group flags, determines what buffers to read             // Flag 0x10 is currently used, but doesn't appear to change the structure or data in any way

			group.unk6 = this.model.readUByte();             // Unknown, probably pertains to materials
			group.materialId = this.model.readUShort();      // Material id
			group.faceCount = this.model.readUShort();       // Face count

			group.textures = {};


			let hasVertices = (group.groupFlags & 0x01) != 0;
			let hasVertexAlpha = (group.groupFlags & 0x02) != 0;
			let hasFlag4 = (group.groupFlags & 0x04) != 0;
			let hasBoneids = (group.groupFlags & 0x08) != 0;

			if (hasVertices) {
				let replaces = this.modifications.replaceColors ?? [];
				replaces.push([39834, 43220]);//TODO what is this? found it hard coded in before
				group.colourBuffer = new Uint8Array(group.faceCount * 3);
				for (var i = 0; i < group.faceCount; ++i) {
					var faceColour = model.readUShort();
					for (let repl of replaces) {
						if (faceColour == repl[0]) {
							faceColour = repl[1];
							break;
						}
					}
					var colour = HSL2RGB(packedHSL2HSL(faceColour));
					group.colourBuffer[i * 3 + 0] = colour[0];
					group.colourBuffer[i * 3 + 1] = colour[1];
					group.colourBuffer[i * 3 + 2] = colour[2];
				}
			}
			if (hasVertexAlpha) {
				group.alphaBuffer = streamChunk(Uint8Array, model, group.faceCount);
			}

			//(Unknown, flag 0x04)
			if (hasFlag4) {
				//apparently these are actually encoded as float16, but we aren't using them anyway
				group.flag4Buffer = streamChunk(Uint16Array, model, group.faceCount);
			}

			group.indexBufferCount = model.readUByte();
			group.indexBuffers = [];
			for (var i = 0; i < group.indexBufferCount; ++i) {
				var indexCount = model.readUShort();
				group.indexBuffers.push(streamChunk(Uint16Array, model, indexCount));
			}

			//not sure what happens without these flags
			if (hasVertices || hasBoneids) {
				group.vertexCount = model.readUShort();
				if (hasVertices) {
					//TODO flip sign of z since we are in the [wrong]-handed coordinate system
					group.positionBuffer = streamChunk(Int16Array, model, group.vertexCount * 3);
					//TODO flip sign of z since we are in the [wrong]-handed coordinate system
					group.normalBuffer = streamChunk(Int8Array, model, group.vertexCount * 3);
					//not currently used
					group.tangentBuffer = streamChunk(Int8Array, model, group.vertexCount * 4);
					group.uvBuffer = new Float32Array(group.vertexCount * 2);
					for (let i = 0; i < group.vertexCount * 2; i++) {
						group.uvBuffer[i] = model.readHalf();
					}
					//group.uvBuffer = streamChunk(Uint16Array, model, group.vertexCount * 2);
				}
				if (hasBoneids) {
					group.boneidBuffer = streamChunk(Uint16Array, model, group.vertexCount);
				}
			}

			this.materialGroups.push(group);

			let attrsources:Record<string, AttributeSoure> = {};

			let normalsrepacked = new Float32Array(group.normalBuffer.length);
			for (let i = 0; i < group.normalBuffer.length; i += 3) {
				let x = group.normalBuffer[i + 0];
				let y = group.normalBuffer[i + 1];
				let z = group.normalBuffer[i + 2];
				//recalc instead of taking 255 because apparently its not normalized properly
				let len = Math.hypot(x, y, z);
				normalsrepacked[i + 0] = x / len;
				normalsrepacked[i + 1] = y / len;
				normalsrepacked[i + 2] = -z / len;//flip z
			}
			for (let i = 0; i < group.positionBuffer.length; i += 3) {
				//TODO this changes the original file
				group.positionBuffer[i + 2] = -group.positionBuffer[i + 2];//flip z
			}

			attrsources.pos = { newtype: "f32", vecsize: 3, source: group.positionBuffer };
			attrsources.normals = { newtype: "f32", vecsize: 3, source: normalsrepacked };
			attrsources.texuvs = { newtype: "f32", vecsize: 2, source: group.uvBuffer };

			//highest level of detail
			let indexbuf = group.indexBuffers[0];

			//since we flipped one of our axis, we also need to flip the polygon winding order
			for (let i = 0; i < indexbuf.length; i += 3) {
				let tmp = indexbuf[i];
				//TODO this changes the original file
				indexbuf[i] = indexbuf[i + 1];
				indexbuf[i + 1] = tmp;
			}


			//convert per-face attributes to per-vertex
			if (group.colourBuffer) {
				let vertexcolor = new Uint8Array(group.vertexCount * 4);
				attrsources.color = { newtype: "u8", vecsize: 4, source: vertexcolor };
				//copy this face color to all vertices on the face
				for (let i = 0; i < group.faceCount; i++) {
					//iterate triangle vertices
					for (let j = 0; j < 3; j++) {
						let index = indexbuf[i * 3 + j] * 4;
						vertexcolor[index + 0] = group.colourBuffer[i * 3 + 0];
						vertexcolor[index + 1] = group.colourBuffer[i * 3 + 1];
						vertexcolor[index + 2] = group.colourBuffer[i * 3 + 2];
						if (group.alphaBuffer) {
							vertexcolor[index + 3] = group.alphaBuffer[i];
						} else {
							vertexcolor[index + 3] = 255;
						}
					}
				}
			}

			////////////////////// build the gltf file //////////////////
			let { buffer, attributes, bytestride, vertexcount } = buildAttributeBuffer(attrsources);

			let attrs: MeshPrimitive["attributes"] = {};

			let view = gltf.addBufferWithView(buffer, bytestride, false);
			attrs.POSITION = gltf.addAttributeAccessor(attributes.pos, view, vertexcount);
			attrs.NORMAL = gltf.addAttributeAccessor(attributes.normals, view, vertexcount);
			attrs.TEXCOORD_0 = gltf.addAttributeAccessor(attributes.texuvs, view, vertexcount);
			if (attributes.color) {
				attributes.color.normalize = true;
				attrs.COLOR_0 = gltf.addAttributeAccessor(attributes.color, view, vertexcount);
			}

			let primitive = indexbuf;
			let viewIndex = gltf.addBufferWithView(primitive, undefined, true);

			let indices = gltf.addAccessor({
				componentType: glTypeIds.u16.gltype,
				count: primitive.length,
				type: "SCALAR",
				bufferView: viewIndex
			});

			let { textures, originalMaterial, factors } = await this.parseMaterial(group.materialId - 1);

			let materialdef: Material = {
				//TODO check if diffuse has alpha as well
				alphaMode: hasVertexAlpha ? "BLEND" : "OPAQUE"
			}

			let sampler = gltf.addSampler({});//TODO wrapS wrapT from material flags

			if (textures.diffuse) {
				materialdef.pbrMetallicRoughness = {};
				//TODO animated texture UV's (fire cape)
				materialdef.pbrMetallicRoughness.baseColorTexture = {
					index: gltf.addTexture({ sampler, source: await this.getTextureFile(textures.diffuse) }),
				};
				//materialdef.pbrMetallicRoughness.baseColorFactor = [factors.color, factors.color, factors.color, 1];
				if (typeof textures.metalness != "undefined") {
					if (textures.metalness) {
						materialdef.pbrMetallicRoughness.metallicRoughnessTexture = {
							index: gltf.addTexture({ sampler, source: await this.getTextureFile(textures.metalness) })
						}
					}
					//materialdef.pbrMetallicRoughness.metallicFactor = factors.metalness;
				}
			}
			if (textures.normal) {
				materialdef.normalTexture = {
					index: gltf.addTexture({ sampler, source: await this.getTextureFile(textures.normal) })
				}
			}
			if (textures.specular) {
				//TODO not directly supported in gltf
			}

			prims.push({
				attributes: attrs,
				indices: indices,
				material: gltf.addMaterial(materialdef)
			});
		}

		let mesh = gltf.addMesh({
			primitives: prims,
		});
		let node = gltf.addNode({ mesh: mesh });
		gltf.addScene({ nodes: [node] });
		//enables use of normalized ints for a couple of attribute types
		//gltf.addExtension("KHR_mesh_quantization", true);
	}
}
