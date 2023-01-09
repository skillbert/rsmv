import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications, HSL2RGBfloat } from "../utils";
import * as THREE from "three";
import { alignedRefOrCopy, ArrayBufferConstructor } from "./gltfutil";
import { parse } from "../opdecoder";
import type { CacheFileSource } from "../cache";
import { BufferAttribute, Matrix3, Vector3 } from "three";

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
	let skincount = 0;
	let meshes: ModelMeshData[] = [];

	// let colmap: Record<number, number> = {};//TODO remove
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
		if (groupFlags & ~0x3f) {
			console.log("unknown model flags", groupFlags & ~0x3f);
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
				// colmap[faceColour] = (colmap[faceColour] ?? 0) + 1;//TODO remove
				// if (faceColour == globalThis.mutecolor) { faceColour = 0; }//TODO remove
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
					skinIdBuffer[i * 4 + j] = (boneid == 65535 ? 0 : boneid);//TODO this should be boneid+1since we're shifting in -1 to 0?
					skinWeightBuffer[i * 4 + j] = actualweight;
					if (boneid >= skincount) {
						skincount = boneid + 2;//we are adding a root bone at 0, and count is max+1
					}
					if (weight == 0) { break; }
				}
			}
			if (dataindex != count * 2 || weightindex != count * 3) {
				console.log("model skin decode failed");
				debugger;
			}
		}

		if (isHidden) {
			// console.log("skipped mesh with 0x10 flag");
			continue;
		}

		if (!positionBuffer) {
			console.log("skipped mesh without position buffer")
			continue;
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

	// console.log(colmap);//TODO remove

	for (let n = 0; n < unkCount1; n++) {
		// console.log("unk1", unkCount1);
		model.skip(39);
	}
	for (let n = 0; n < unkCount2; n++) {
		// console.log("unk2", unkCount2);
		model.skip(50);
	}
	for (let n = 0; n < unkCount3; n++) {
		// console.log("unk3", unkCount3);
		model.skip(18);
	}


	let r: ModelData = { maxy, miny, meshes, bonecount: bonecount, skincount: skincount };

	if (model.scanloc() != model.getData().length) {
		console.log("extra model bytes", model.getData().length - model.scanloc(), "format", format, "unk1", unk1, "version", version, "unkcounts", unkCount0, unkCount1, unkCount2, unkCount3);
		// fs.writeFileSync(`cache/particles/${Date.now()}.bin`, model.getData().slice(model.scanloc()));
	}
	return r;
}

type OldTextureMapping = {
	ux: number,
	uy: number,
	uz: number,
	vx: number,
	vy: number,
	vz: number,
	scalex: number,
	scaley: number,
	scalez: number
}

type WorkingSubmesh = {
	pos: BufferAttribute,
	texuvs: BufferAttribute,
	color: BufferAttribute,
	normals: BufferAttribute,
	index: Uint16Array,
	currentface: number,
	matid: number
}

export function parseOldModel(modelfile: Buffer, source: CacheFileSource) {
	let modeldata = parse.oldmodels.read(modelfile, source);

	let maxy = 0;
	let miny = 0;
	let bonecount = 0;
	let skincount = 0;

	//position attribute
	let decodedx = new Int16Array(modeldata.vertcount);
	let decodedy = new Int16Array(modeldata.vertcount);
	let decodedz = new Int16Array(modeldata.vertcount);
	let xvalue = 0;
	let yvalue = 0;
	let zvalue = 0;
	let xstream = new Stream(modeldata.posx);
	let ystream = new Stream(modeldata.posy);
	let zstream = new Stream(modeldata.posz);
	for (let i = 0; i < modeldata.vertcount; i++) {
		let flag = modeldata.vertflags[i];
		if (flag & 0x1) { xvalue += xstream.readShortSmartBias(); }
		//no clue why y is inverted everywhere
		if (flag & 0x2) { yvalue += -ystream.readShortSmartBias(); }
		if (flag & 0x4) { zvalue += zstream.readShortSmartBias(); }
		decodedx[i] = xvalue;
		decodedy[i] = yvalue;
		decodedz[i] = zvalue;
		if (yvalue > maxy) { maxy = yvalue; }
		if (yvalue < miny) { miny = yvalue; }
	}


	//texture mappings
	let textureMappings: OldTextureMapping[] = [];
	if (modeldata.texflags) {
		let m = new Matrix3();
		let v0 = new Vector3();
		let v1 = new Vector3();
		let v2 = new Vector3();
		for (let texmap of modeldata.texflags) {
			if (texmap.type == 0) {
				let [i0, i1, i2] = modeldata.texmap_verts[texmap.vertindex];

				v0.set(decodedx[i0], decodedy[i0], decodedz[i0]);
				v1.set(decodedx[i1], decodedy[i1], decodedz[i1]);
				v2.set(decodedx[i2], decodedy[i2], decodedz[i2]);

				v1.sub(v0);
				v2.sub(v0);
				v0.copy(v1).cross(v2);//null space
				m.set(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v0.x, v0.y, v0.z);
				m.invert();
			} else if (texmap.type >= 1) {
				let scales = modeldata.texmap_scales[texmap.scale];
				//texture normal, null space
				v2.set(...modeldata.texmap_normals[texmap.normal]);
				//u vector, perpendicular to vertical and normal
				v0.set(0, 1, 0).cross(v2);
				//v vector, perpendicular to u and normal
				v1.copy(v0).cross(v1);
				v0.normalize()//.multiplyScalar(scales[0]);
				v1.normalize()//.multiplyScalar(scales[1]);
				v2.normalize()//.multiplyScalar(scales[2]);
				m.set(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v0.x, v0.y, v0.z);
				m.invert();
				//TODO rotation, uvanim
				if (texmap.type == 2) {
					//TODO uv offset
				}
			}
			let mapping: OldTextureMapping = {
				ux: m.elements[0],
				uy: m.elements[1],
				uz: m.elements[2],
				vx: m.elements[3],
				vy: m.elements[4],
				vz: m.elements[5],
				scalex: 1,
				scaley: 1,
				scalez: 1
			}
			textureMappings.push(mapping);
		}
	}

	// modeldata.material.forEach((q, i, arr) => arr[i] = 0);
	let matusecount = new Map<number, number>();
	for (let matid of modeldata.material) {
		matusecount.set(matid, (matusecount.get(matid) ?? 0) + 1);
	}
	let matmesh = new Map<number, WorkingSubmesh>();
	for (let matid of modeldata.material) {
		let mesh = matmesh.get(matid);
		if (!mesh) {
			let facecount = matusecount.get(matid)!;
			let finalvertcount = facecount * 3;
			let colstride = (modeldata.colors ? modeldata.alpha ? 4 : 3 : 0);
			mesh = {
				pos: new BufferAttribute(new Float32Array(finalvertcount * 3), 3),
				normals: new BufferAttribute(new Float32Array(finalvertcount * 3), 3),
				color: new BufferAttribute(new Uint8Array(finalvertcount * colstride), colstride, true),
				texuvs: new BufferAttribute(new Float32Array(finalvertcount * 2), 2),
				index: new Uint16Array(facecount * 3),
				currentface: 0,
				matid: ((matid & 0xff) << 8 | (matid & 0xff00) >> 8) - 1//TODO fix endianness elsewhere
			};
			matmesh.set(matid, mesh);
		}
	}
	let srcindex0 = 0, srcindex1 = 0, srcindex2 = 0, srcindexlast = 0;
	//TODO can probably get rid of ths completely if merged vertices result in problems with colors
	// let dstindex0 = 0, dstindex1 = 0, dstindex2 = 0, dstnextindex = 0, dstwriteindex = 0;
	let stream = new Stream(modeldata.indexbuffer);
	let uvstream = new Stream(modeldata.uvs);
	for (let i = 0; i < modeldata.facecount; i++) {
		let typedata = modeldata.tritype[i];
		let type = typedata & 0x7;
		if (type == 1) {
			srcindex0 = srcindexlast + stream.readShortSmartBias();
			srcindex1 = srcindex0 + stream.readShortSmartBias();
			srcindex2 = srcindex1 + stream.readShortSmartBias();
			srcindexlast = srcindex2;
		} else if (type == 2) {
			srcindex1 = srcindex2;
			srcindex2 = srcindexlast + stream.readShortSmartBias();
			srcindexlast = srcindex2;
		} else if (type == 3) {
			srcindex0 = srcindex2;
			srcindex2 = srcindexlast + stream.readShortSmartBias();
			srcindexlast = srcindex2;
		} else if (type == 4) {
			let srctmp = srcindex0;
			srcindex0 = srcindex1;
			srcindex1 = srctmp;
			srcindex2 = srcindexlast + stream.readShortSmartBias();
			srcindexlast = srcindex2;
		} else {
			throw new Error("unkown face type");
		}
		let x0 = decodedx[srcindex0], y0 = decodedy[srcindex0], z0 = decodedz[srcindex0];
		let x1 = decodedx[srcindex1], y1 = decodedy[srcindex1], z1 = decodedz[srcindex1];
		let x2 = decodedx[srcindex2], y2 = decodedy[srcindex2], z2 = decodedz[srcindex2];

		let nx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0);
		let ny = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0);
		let nz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
		if (Math.hypot(nx, ny, nz) == 0 || isNaN(Math.hypot(nx, ny, nz))) {
			console.warn("degenerate triangle");
		}
		let nscale = 1 / Math.hypot(nx, ny, nz);
		nx *= nscale; ny *= nscale; nz *= nscale;

		let matargument = modeldata.material[i];
		let submesh = matmesh.get(matargument)!;
		let dstfaceindex = submesh.currentface++;
		let vertbase = dstfaceindex * 3;
		let posattr = submesh.pos;
		let normalattr = submesh.normals;
		let uvattr = submesh.texuvs;
		let indexbuf = submesh.index;
		if (isNaN(nx) || isNaN(ny) || isNaN(nz)) { debugger; }
		posattr.setXYZ(vertbase + 0, x0, y0, z0);
		posattr.setXYZ(vertbase + 1, x1, y1, z1);
		posattr.setXYZ(vertbase + 2, x2, y2, z2);
		normalattr.setXYZ(vertbase + 0, nx, ny, nz);
		normalattr.setXYZ(vertbase + 1, nx, ny, nz);
		normalattr.setXYZ(vertbase + 2, nx, ny, nz);

		if (matargument != 0) {
			let uvbase = uvstream.readUByte();
			if (uvbase == 0) {
				//default topdown mapping? idk
				uvattr.setXY(vertbase + 0, x0 / 512, y0 / 512);
				uvattr.setXY(vertbase + 1, x1 / 512, y1 / 512);
				uvattr.setXY(vertbase + 2, x2 / 512, y2 / 512);
			} else if (uvbase == 255) {
				//uv from other buffer
			} else {
				let mapping = textureMappings[uvbase - 1];
				// let ux=mapping.
				// mapping.
				uvattr.setXY(vertbase + 0, x0 * mapping.ux + y0 * mapping.uy + z0 * mapping.uz, x0 * mapping.vx + y0 * mapping.vy + z0 * mapping.vz);
				uvattr.setXY(vertbase + 1, x1 * mapping.ux + y1 * mapping.uy + z1 * mapping.uz, x1 * mapping.vx + y1 * mapping.vy + z1 * mapping.vz);
				uvattr.setXY(vertbase + 2, x2 * mapping.ux + y2 * mapping.uy + z2 * mapping.uz, x2 * mapping.vx + y2 * mapping.vy + z2 * mapping.vz);

				if (!isFinite(uvattr.getX(vertbase + 0))) {
					debugger;
				}
			}
		}

		if (modeldata.colors) {
			let colorattr = submesh.color;
			//TODO force new triangle vertices of last color wasn't equal
			let colint = modeldata.colors[i];
			//TODO fix endianness elsewhere
			let [r, g, b] = HSL2RGBfloat(packedHSL2HSL(((colint & 0xff) << 8) | ((colint & 0xff00) >> 8)));
			if (!modeldata.alpha) {
				colorattr.setXYZ(vertbase + 0, r, g, b);
				colorattr.setXYZ(vertbase + 1, r, g, b);
				colorattr.setXYZ(vertbase + 2, r, g, b);
			} else {
				let alpha = (255 - modeldata.alpha[i]) / 255;
				colorattr.setXYZW(vertbase + 0, r, g, b, alpha);
				colorattr.setXYZW(vertbase + 1, r, g, b, alpha);
				colorattr.setXYZW(vertbase + 2, r, g, b, alpha);
			}
		}


		//could use non-indexed in this case but it doesn't really matter
		indexbuf[dstfaceindex * 3 + 0] = vertbase + 0;
		indexbuf[dstfaceindex * 3 + 1] = vertbase + 2;//flip 1 and 2, opengl uses oposite notation
		indexbuf[dstfaceindex * 3 + 2] = vertbase + 1;
	}

	let meshes = [...matmesh.values()].map<ModelMeshData>(m => ({
		attributes: {
			pos: m.pos,
			color: m.color,
			texuvs: m.texuvs,
			normals: m.normals
		},
		hasVertexAlpha: !!modeldata.alpha,
		indices: new BufferAttribute(m.index, 1),
		materialId: m.matid
	}));
	let r: ModelData = { maxy, miny, meshes, bonecount: bonecount, skincount: skincount };

	return r;
}
