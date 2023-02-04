import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications, HSL2RGBfloat } from "../utils";
import * as THREE from "three";
import { alignedRefOrCopy, ArrayBufferConstructor } from "./gltfutil";
import { parse } from "../opdecoder";
import type { CacheFileSource } from "../cache";
import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Euler, Matrix3, Matrix4, Mesh, PlaneGeometry, Quaternion, SphereGeometry, Vector3 } from "three";
import { oldmodels } from "../../generated/oldmodels";

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
	// mode: "flat" | "cylinder" | "cube" | "sphere",
	//projects 3d coords into texmap unit space
	//flat -> xy=uv
	//cylinder -> cylinder along y lon[-pi,pi]->[0,1] u, y=v, 
	//cube -> 1x1x1 cube centered at 0,0,0, each face is covered by a texture
	//sphere -> lonlat [-pi,pi]->[0,1] uv
	texspace: Matrix4,
	//determine center of painted vertices
	vertexsum: Vector3,
	vertexcount: number,
	args: oldmodels["texflags"][number]
}

type WorkingSubmesh = {
	pos: BufferAttribute,
	texuvs: BufferAttribute,
	color: BufferAttribute,
	normals: BufferAttribute,
	index: Uint16Array,
	originalface: Uint16Array,
	currentface: number,
	matid: number
}

export function parseOldModel(modelfile: Buffer, source: CacheFileSource) {
	let modeldata = parse.oldmodels.read(modelfile, source);

	let maxy = 0;
	let miny = 0;
	let bonecount = 0;
	let skincount = 0;

	let debugmeshes: THREE.Mesh[] = [];
	let debugmat = new THREE.MeshBasicMaterial();
	debugmat.wireframe = true;

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
	for (let i = 0; i < modeldata.texmapcount; i++) {
		let flag = modeldata.texflags[i];
		textureMappings.push({
			// mode: texttypemap[flag.type],
			texspace: new Matrix4(),
			vertexsum: new Vector3(),
			vertexcount: 0,
			args: flag
		});
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
				originalface: new Uint16Array(facecount),
				currentface: 0,
				matid: ((matid & 0xff) << 8 | (matid & 0xff00) >> 8) - 1//TODO fix endianness elsewhere
			};
			matmesh.set(matid, mesh);
		}
	}

	let uvids: number[] = [];
	let uvstream = new Stream(modeldata.uvs);
	while (!uvstream.eof()) {
		uvids.push(uvstream.readUShortSmart());
		if (uvids[uvids.length - 1] < 0) { debugger; }
	}


	let vertexindex = new Uint16Array(modeldata.facecount * 3);

	let srcindex0 = 0, srcindex1 = 0, srcindex2 = 0, srcindexlast = 0;
	//TODO can probably get rid of ths completely if merged vertices result in problems with colors
	// let dstindex0 = 0, dstindex1 = 0, dstindex2 = 0, dstnextindex = 0, dstwriteindex = 0;
	let stream = new Stream(modeldata.indexbuffer);
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
		vertexindex[i * 3 + 0] = srcindex0;
		vertexindex[i * 3 + 1] = srcindex1;
		vertexindex[i * 3 + 2] = srcindex2;
	}

	//calculate centers of material maps
	let texindex = 0;
	for (let i = 0; i < modeldata.facecount; i++) {
		let matarg = modeldata.material[i];
		if (matarg == 0) { continue; }
		let mapid = uvids[texindex++];
		if (mapid != 0 && mapid != 0x7fff) {
			let mapping = textureMappings[mapid - 1];
			srcindex0 = vertexindex[i * 3 + 0];
			srcindex1 = vertexindex[i * 3 + 1];
			srcindex2 = vertexindex[i * 3 + 2];
			mapping.vertexsum.x += decodedx[srcindex0] + decodedx[srcindex1] + decodedx[srcindex2];
			mapping.vertexsum.y += decodedy[srcindex0] + decodedy[srcindex1] + decodedy[srcindex2];
			mapping.vertexsum.z += decodedz[srcindex0] + decodedz[srcindex1] + decodedz[srcindex2];
			mapping.vertexcount += 3;
		}
	}

	//build material maps
	if (modeldata.texflags) {
		let mtmp = new Matrix4();
		let v0 = new Vector3();
		let v1 = new Vector3();
		let v2 = new Vector3();
		let vtmp = new Vector3();
		let texscale = new Vector3(512, 512, 512);
		//parse texmaps
		for (let i = 0; i < modeldata.texflags.length; i++) {
			let mapping = textureMappings[i];
			if (mapping.args.type == 0) {
				let [i0, i1, i2] = modeldata.texmap_verts[mapping.args.vertindex];

				v0.set(decodedx[i0], decodedy[i0], decodedz[i0]);
				v1.set(decodedx[i1], decodedy[i1], decodedz[i1]);
				v2.set(decodedx[i2], decodedy[i2], decodedz[i2]);

				v1.sub(v0);
				v2.sub(v0);
				vtmp.copy(v1).cross(v2);//null space

				mapping.texspace.set(
					v1.x, v2.x, vtmp.x, v0.x,
					v1.y, v2.y, vtmp.y, v0.y,
					v1.z, v2.z, vtmp.z, v0.z,
					0, 0, 0, 1
				);
				mapping.texspace.invert();
			} else if (mapping.args.type >= 1) {
				let proj = modeldata.texmap_projections[mapping.args.projection];
				v1.set(...proj.normal).normalize();
				if (v1.x == 0 && v1.z == 0) {
					v0.set(1, 0, 0);
				} else {
					v0.set(0, 1, 0).cross(v1).normalize();
				}
				v2.copy(v1).cross(v0).normalize();

				mapping.texspace.set(
					v0.x, v1.x, v2.x, mapping.vertexsum.x / mapping.vertexcount,
					v0.y, v1.y, v2.y, mapping.vertexsum.y / mapping.vertexcount,
					v0.z, v1.z, v2.z, mapping.vertexsum.z / mapping.vertexcount,
					0, 0, 0, 1
				).scale(texscale);

				mtmp.makeRotationY(proj.rotation / 255 * Math.PI * 2);
				mapping.texspace.multiply(mtmp);

				mapping.texspace.invert();
			}

			let geo: BufferGeometry;
			if (mapping.args.type == 0) {
				geo = new PlaneGeometry(1, 1);
			} else if (mapping.args.type == 1) {
				geo = new CylinderGeometry(0.5, 0.5, 1, 32);
			} else if (mapping.args.type == 2) {
				geo = new BoxGeometry(1, 1, 1);
			} else if (mapping.args.type == 3) {
				geo = new SphereGeometry(1);
			}
			let mesh = new Mesh(geo!, debugmat);
			mesh.matrixAutoUpdate = false;
			mesh.matrix.copy(mapping.texspace).invert();
			if (globalThis.testmat >= 0 && globalThis.testmat == i) {
				debugmeshes.push(mesh);
			}
		}
	}

	let texmapindex = 0;
	let v0 = new Vector3();
	let v1 = new Vector3();
	let v2 = new Vector3();
	let vnormal = new Vector3();
	let vtmp0 = new Vector3();
	let vtmp1 = new Vector3();
	let vtmp2 = new Vector3();
	let m3tmp = new Matrix3();
	for (let i = 0; i < modeldata.facecount; i++) {
		srcindex0 = vertexindex[i * 3 + 0];
		srcindex1 = vertexindex[i * 3 + 1];
		srcindex2 = vertexindex[i * 3 + 2];
		v0.set(decodedx[srcindex0], decodedy[srcindex0], decodedz[srcindex0]);
		v1.set(decodedx[srcindex1], decodedy[srcindex1], decodedz[srcindex1]);
		v2.set(decodedx[srcindex2], decodedy[srcindex2], decodedz[srcindex2]);

		vtmp0.copy(v1).sub(v0);
		vnormal.copy(v2).sub(v0).cross(vtmp0).normalize();

		let matargument = modeldata.material[i];
		let submesh = matmesh.get(matargument)!;
		let dstfaceindex = submesh.currentface++;
		let vertbase = dstfaceindex * 3;
		let posattr = submesh.pos;
		let uvattr = submesh.texuvs;
		let normalattr = submesh.normals;
		let indexbuf = submesh.index;
		if (isNaN(vnormal.x) || isNaN(vnormal.y) || isNaN(vnormal.x)) {
			debugger;
		}
		posattr.setXYZ(vertbase + 0, v0.x, v0.y, v0.z);
		posattr.setXYZ(vertbase + 1, v1.x, v1.y, v1.z);
		posattr.setXYZ(vertbase + 2, v2.x, v2.y, v2.z);
		normalattr.setXYZ(vertbase + 0, vnormal.x, vnormal.y, vnormal.x);
		normalattr.setXYZ(vertbase + 1, vnormal.x, vnormal.y, vnormal.x);
		normalattr.setXYZ(vertbase + 2, vnormal.x, vnormal.y, vnormal.x);

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

		if (matargument) {
			//calculate the center of each mapping
			let mapid = uvids[texmapindex++];
			if (mapid == 0) {
				//TODO just default [0,1] uvs?
			} else if (mapid == 0x7fff) {
				//TODO direct uv value chunk
			} else {
				let mapping = textureMappings[mapid - 1];
				v0.applyMatrix4(mapping.texspace);
				v1.applyMatrix4(mapping.texspace);
				v2.applyMatrix4(mapping.texspace);
				if (mapping.args.type == 0) {
					uvattr.setXY(vertbase + 0, v0.x, v0.y);
					uvattr.setXY(vertbase + 1, v1.x, v1.y);
					uvattr.setXY(vertbase + 2, v2.x, v2.y);
				} else if (mapping.args.type == 1) {
					let u0 = Math.atan2(v0.z, v0.x) / Math.PI / 2 * 3;
					let u1 = Math.atan2(v1.z, v1.x) / Math.PI / 2 * 3;
					let u2 = Math.atan2(v2.z, v2.x) / Math.PI / 2 * 3;
					//TODO fix wrapping
					uvattr.setXY(vertbase + 0, u0, v0.y);
					uvattr.setXY(vertbase + 1, u1, v1.y);
					uvattr.setXY(vertbase + 2, u2, v2.y);
				} else if (mapping.args.type == 2) {

					vtmp0.copy(v1).sub(v0);
					//face normal
					vtmp1.copy(v2).sub(v0).cross(vtmp0);
					m3tmp.setFromMatrix4(mapping.texspace);
					//face normal in texture space
					vtmp1.applyMatrix3(m3tmp);
					let max = Math.max(vtmp1.x, -vtmp1.x, vtmp1.y, -vtmp1.y, vtmp1.z, -vtmp1.z);
					//find texture cube face most close to face normal
					//and project from texture space into face space
					if (vtmp1.x == max) {
						m3tmp.set(0, 0, -1, 0, 1, 0, 0, 0, 0);
					} else if (vtmp1.x == -max) {
						m3tmp.set(0, 0, 1, 0, 1, 0, 0, 0, 0);
					} else if (vtmp1.z == max) {
						m3tmp.set(-1, 0, 0, 0, 1, 0, 0, 0, 0);
					} else if (vtmp1.z == -max) {
						m3tmp.set(1, 0, 0, 0, 1, 0, 0, 0, 0);
					} else if (vtmp1.y == max) {
						m3tmp.set(1, 0, 0, 0, 0, 1, 0, 0, 0);
					} else if (vtmp1.y == -max) {
						m3tmp.set(1, 0, 0, 0, 0, 1, 0, 0, 0);
					} else {
						throw new Error("unexpected");
					}

					vtmp0.copy(v0).applyMatrix3(m3tmp);
					vtmp1.copy(v1).applyMatrix3(m3tmp);
					vtmp2.copy(v2).applyMatrix3(m3tmp);
					uvattr.setXY(vertbase + 0, vtmp0.x, vtmp0.y);
					uvattr.setXY(vertbase + 1, vtmp1.x, vtmp1.y);
					uvattr.setXY(vertbase + 2, vtmp2.x, vtmp2.y);
				} else if (mapping.args.type == 3) {
					let u0 = Math.atan2(v0.z, v0.x) / Math.PI / 2;
					let u1 = Math.atan2(v1.z, v1.x) / Math.PI / 2;
					let u2 = Math.atan2(v2.z, v2.x) / Math.PI / 2;
					let vv0 = Math.atan2(v0.y, Math.sqrt(v0.x * v0.x + v0.z * v0.z)) / Math.PI / 2;
					let vv1 = Math.atan2(v1.y, Math.sqrt(v1.x * v1.x + v1.z * v1.z)) / Math.PI / 2;
					let vv2 = Math.atan2(v2.y, Math.sqrt(v2.x * v2.x + v2.z * v2.z)) / Math.PI / 2;
					//TODO fix wrapping
					uvattr.setXY(vertbase + 0, u0, vv0);
					uvattr.setXY(vertbase + 1, u1, vv1);
					uvattr.setXY(vertbase + 2, u2, vv2);
				}
			}
			if (globalThis.testmat >= 0 && globalThis.testmat != mapid - 1) {
				uvattr.setXY(vertbase + 0, 0, 0);
				uvattr.setXY(vertbase + 1, 0, 0);
				uvattr.setXY(vertbase + 2, 0, 0);
				let colorattr = submesh.color;
				colorattr.setXYZ(vertbase + 0, 0, 0, 0);
				colorattr.setXYZ(vertbase + 1, 0, 0, 0);
				colorattr.setXYZ(vertbase + 2, 0, 0, 0);
			}
		}

		//could use non-indexed in this case but it doesn't really matter
		indexbuf[dstfaceindex * 3 + 0] = vertbase + 0;
		indexbuf[dstfaceindex * 3 + 1] = vertbase + 2;//flip 1 and 2, opengl uses oposite notation
		indexbuf[dstfaceindex * 3 + 2] = vertbase + 1;
		submesh[dstfaceindex] = i;
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
	let r: ModelData = { maxy, miny, meshes, bonecount: bonecount, skincount: skincount, debugmeshes };

	return r;
}
