import { packedHSL2HSL, HSL2RGB, ModelModifications } from "../utils";
import { cacheConfigPages, cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { ModelData, parseOb3Model } from '../3d/ob3togltf';
import { convertMaterial, defaultMaterial, materialCacheKey, MaterialData } from "./jmat";
import { modifyMesh } from "./mapsquare";
import * as THREE from "three";
import { BoneInit, MountableAnimation, parseAnimationSequence3, parseAnimationSequence4, ParsedAnimation } from "./animationframes";
import { parseSkeletalAnimation } from "./animationskeletal";
import { archiveToFileId, CachedObject, CacheFileSource, CacheIndex, CachingFileSource, SubFile } from "../cache";
import { Bone, BufferAttribute, BufferGeometry, Matrix4, Mesh, Object3D, Skeleton, SkinnedMesh, Texture } from "three";
import { parseFramemaps, parseMapscenes, parseMapsquareOverlays, parseMapsquareUnderlays, parseMaterials, parseSequences } from "../opdecoder";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { mapsquare_overlays } from "../../generated/mapsquare_overlays";
import { mapscenes } from "../../generated/mapscenes";
import { cacheFileJsonModes } from "../scripts/extractfiles";
import { JSONSchema6Definition } from "json-schema";
import { models } from "../../generated/models";
import { crc32, CrcBuilder } from "../libs/crc32util";

export function augmentThreeJsFloorMaterial(mat: THREE.Material) {
	mat.customProgramCacheKey = () => "floortex";
	mat.onBeforeCompile = (shader, renderer) => {
		shader.vertexShader =
			`#ifdef USE_MAP\n`
			+ `attribute vec4 _ra_floortex_uv01;\n`
			+ `attribute vec4 _ra_floortex_uv23;\n`
			+ `attribute vec4 _ra_floortex_weights;\n`
			+ `attribute vec4 _ra_floortex_usescolor;\n`
			+ `varying vec4 v_ra_floortex_01;\n`
			+ `varying vec4 v_ra_floortex_23;\n`
			+ `varying vec4 v_ra_floortex_weights;\n`
			+ `varying vec4 v_ra_floortex_usescolor;\n`
			+ `#endif\n`
			+ shader.vertexShader.replace("#include <uv_vertex>",
				`#ifdef USE_MAP\n`
				+ `v_ra_floortex_01 = _ra_floortex_uv01;\n`
				+ `v_ra_floortex_23 = _ra_floortex_uv23;\n`
				+ `v_ra_floortex_weights = _ra_floortex_weights;\n`
				+ `v_ra_floortex_usescolor = _ra_floortex_usescolor;\n`
				+ `#endif\n`
				+ "#include <uv_vertex>"
			);
		shader.fragmentShader =
			`#ifdef USE_MAP\n`
			+ `varying vec4 v_ra_floortex_01;\n`
			+ `varying vec4 v_ra_floortex_23;\n`
			+ `varying vec4 v_ra_floortex_weights;\n`
			+ `varying vec4 v_ra_floortex_usescolor;\n`
			+ `#endif\n`
			+ shader.fragmentShader
				.replace("#include <color_fragment>", "")
				.replace("#include <map_fragment>",
					`#include <color_fragment>\n`
					+ `#ifdef USE_MAP\n`
					+ `vec4 texelColor = \n`
					+ `   texture2D( map, v_ra_floortex_01.rg ) * v_ra_floortex_weights.r * mix(vec4(1.0),diffuseColor,v_ra_floortex_usescolor.r)\n`
					+ ` + texture2D( map, v_ra_floortex_01.ba ) * v_ra_floortex_weights.g * mix(vec4(1.0),diffuseColor,v_ra_floortex_usescolor.g)\n`
					+ ` + texture2D( map, v_ra_floortex_23.rg ) * v_ra_floortex_weights.b * mix(vec4(1.0),diffuseColor,v_ra_floortex_usescolor.b)\n`
					+ ` + texture2D( map, v_ra_floortex_23.ba ) * v_ra_floortex_weights.a * mix(vec4(1.0),diffuseColor,v_ra_floortex_usescolor.a);\n`
					//TODO is this needed?
					+ `texelColor = mix( diffuseColor,texelColor,dot(vec4(1.0),v_ra_floortex_weights));\n`
					+ `#endif\n`
					+ `diffuseColor = texelColor;\n`
				);
	}
}


//basically stores all the config of the game engine
export class EngineCache<T extends CacheFileSource = any> extends CachingFileSource<T> {
	ready: Promise<EngineCache<T>>;

	materialArchive = new Map<number, Buffer>();
	materialCache = new Map<number, MaterialData>();
	mapUnderlays: mapsquare_underlays[];
	mapOverlays: mapsquare_overlays[];
	mapMapscenes: mapscenes[];
	jsonSearchCache = new Map<string, { files: Promise<any[]>, schema: JSONSchema6Definition }>();

	static async create(source: CacheFileSource) {
		let ret = new EngineCache(source);
		return ret.ready;
	}

	private constructor(source: T) {
		super(source);
		this.ready = this.preload();
	}

	private async preload() {
		let matarch = await this.getArchiveById(cacheMajors.materials, 0);
		for (let file of matarch) {
			this.materialArchive.set(file.fileid, file.buffer);
		}

		this.mapUnderlays = [];
		(await this.getArchiveById(cacheMajors.config, cacheConfigPages.mapunderlays))
			.forEach(q => this.mapUnderlays[q.fileid] = parseMapsquareUnderlays.read(q.buffer));
		this.mapOverlays = [];
		(await this.getArchiveById(cacheMajors.config, cacheConfigPages.mapoverlays))
			.forEach(q => this.mapOverlays[q.fileid] = parseMapsquareOverlays.read(q.buffer));
		this.mapMapscenes = [];
		(await this.getArchiveById(cacheMajors.config, cacheConfigPages.mapscenes))
			.forEach(q => this.mapMapscenes[q.fileid] = parseMapscenes.read(q.buffer));

		return this;
	}

	getMaterialData(id: number) {
		let cached = this.materialCache.get(id);
		if (!cached) {
			if (id == -1) {
				cached = defaultMaterial();
			} else {
				let file = this.materialArchive.get(id);
				if (!file) { throw new Error("material " + id + " not found"); }
				cached = convertMaterial(file);
			}
			this.materialCache.set(id, cached);
		}
		return cached;
	}

	/**
	 * very aggressive caching, do not use for objects which take a lot of memory
	 */
	getJsonSearchData(modename: string) {
		let cached = this.jsonSearchCache.get(modename);
		if (!cached) {
			let mode = cacheFileJsonModes[modename as keyof typeof cacheFileJsonModes];
			if (!mode) { throw new Error("unknown decode mode " + modename); }
			let files = (async () => {
				let allfiles = await mode.lookup.logicalRangeToFiles(this, [0, 0], [Infinity, Infinity]);
				let lastarchive: null | { index: CacheIndex, subfiles: SubFile[] } = null;
				let files: any[] = [];
				for (let fileid of allfiles) {
					let arch: SubFile[];
					if (lastarchive && lastarchive.index == fileid.index) {
						arch = lastarchive.subfiles;
					} else {
						arch = await this.getFileArchive(fileid.index);
						lastarchive = { index: fileid.index, subfiles: arch };
					}
					let file = arch[fileid.subindex];
					let logicalid = mode.lookup.fileToLogical(fileid.index.major, fileid.index.minor, file.fileid);
					let res = mode.parser.read(file.buffer);
					res.$fileid = (logicalid.length == 1 ? logicalid[0] : logicalid);
					files.push(res);
				}

				return files;
			})();
			cached = { files, schema: mode.parser.parser.getJsonSchema() }
			this.jsonSearchCache.set(modename, cached);
		}
		return cached;
	}
}

export async function detectTextureMode(source: CacheFileSource) {
	let lastdds = -1;
	try {
		let ddsindex = await source.getIndexFile(cacheMajors.texturesDds);
		let last = ddsindex[ddsindex.length - 1];
		await source.getFile(last.major, last.minor, last.crc);
		lastdds = last.minor;
	} catch (e) { }

	let lastbmp = -1;
	try {
		let bmpindex = await source.getIndexFile(cacheMajors.texturesBmp);
		let last = bmpindex[bmpindex.length - 1];
		await source.getFile(last.major, last.minor, last.crc);
		lastbmp = last.minor;
	} catch (e) { }

	let textureMode: "bmp" | "dds" = (lastbmp > lastdds ? "bmp" : "dds");
	console.log(`detectedtexture mode. dds:${lastdds}, bmp:${lastbmp}`, textureMode);
	return textureMode;
}


export class ThreejsSceneCache {
	private modelCache = new Map<number, CachedObject<ModelData>>();
	private threejsTextureCache = new Map<number, CachedObject<ParsedTexture>>();
	private threejsMaterialCache = new Map<number, CachedObject<THREE.Material>>();
	engine: EngineCache;
	textureType: "png" | "dds" | "bmp" = "dds";//png support currently incomplete (and seemingly unused by jagex)

	static textureIndices = {
		png: cacheMajors.texturesPng,
		dds: cacheMajors.texturesDds,
		bmp: cacheMajors.texturesBmp
	}

	constructor(scenecache: EngineCache) {
		this.engine = scenecache;
	}
	getFileById(major: number, id: number) {
		return this.engine.getFileById(major, id);
	}

	getTextureFile(texid: number, stripAlpha: boolean) {
		return this.engine.fetchCachedObject(this.threejsTextureCache, texid, async () => {
			let file = await this.getFileById(ThreejsSceneCache.textureIndices[this.textureType], texid);
			let parsed = new ParsedTexture(file, stripAlpha, true);
			return parsed;
		}, obj => obj.filesize * 2);
	}

	getModelData(id: number) {
		return this.engine.fetchCachedObject(this.modelCache, id, () => {
			return this.engine.getFileById(cacheMajors.models, id).then(f => parseOb3Model(f));
		}, obj => obj.meshes.reduce((a, m) => m.indices.count, 0) * 30);
	}

	getMaterial(matid: number, hasVertexAlpha: boolean) {
		//TODO the material should have this data, not the mesh
		let matcacheid = materialCacheKey(matid, hasVertexAlpha);
		return this.engine.fetchCachedObject(this.threejsMaterialCache, matcacheid, async () => {
			let material = this.engine.getMaterialData(matid);

			// let mat = new THREE.MeshPhongMaterial();
			// mat.shininess = 0;
			let mat = new THREE.MeshStandardMaterial();
			mat.alphaTest = (material.alphamode == "cutoff" ? 0.5 : 0.1);//TODO use value from material
			mat.transparent = hasVertexAlpha || material.alphamode == "blend";
			const wraptype = THREE.RepeatWrapping;//TODO find value of this in material

			if (material.textures.diffuse) {
				let diffuse = await (await this.getTextureFile(material.textures.diffuse, material.stripDiffuseAlpha)).toImageData();
				let difftex = new THREE.DataTexture(diffuse.data, diffuse.width, diffuse.height, THREE.RGBAFormat);
				difftex.needsUpdate = true;
				difftex.wrapS = wraptype;
				difftex.wrapT = wraptype;
				difftex.encoding = THREE.sRGBEncoding;
				difftex.magFilter = THREE.LinearFilter;
				difftex.minFilter = THREE.NearestMipMapNearestFilter;
				difftex.generateMipmaps = true;

				mat.map = difftex;

				if (material.textures.normal) {
					let parsed = await this.getTextureFile(material.textures.normal, false);
					let raw = await parsed.toImageData();
					let normals = new ImageData(raw.width, raw.height);
					let emisive = new ImageData(raw.width, raw.height);
					const data = raw.data;
					for (let i = 0; i < data.length; i += 4) {
						//normals
						let dx = data[i + 1] / 127.5 - 1;
						let dy = data[i + 3] / 127.5 - 1;
						normals.data[i + 0] = data[i + 1];
						normals.data[i + 1] = data[i + 3];
						normals.data[i + 2] = (Math.sqrt(Math.max(1 - dx * dx - dy * dy, 0)) + 1) * 127.5;
						normals.data[i + 3] = 255;
						//emisive //TODO check if normals flag always implies emisive
						const emissive = data[i + 0] / 255;
						emisive.data[i + 0] = diffuse.data[i + 0] * emissive;
						emisive.data[i + 1] = diffuse.data[i + 1] * emissive;
						emisive.data[i + 2] = diffuse.data[i + 2] * emissive;
						emisive.data[i + 3] = 255;
					}
					mat.normalMap = new THREE.DataTexture(normals.data, normals.width, normals.height, THREE.RGBAFormat);
					mat.normalMap.needsUpdate = true;
					mat.normalMap.wrapS = wraptype;
					mat.normalMap.wrapT = wraptype;
					mat.normalMap.magFilter = THREE.LinearFilter;

					mat.emissiveMap = new THREE.DataTexture(emisive.data, emisive.width, emisive.height, THREE.RGBAFormat);
					mat.emissiveMap.needsUpdate = true;
					mat.emissiveMap.wrapS = wraptype;
					mat.emissiveMap.wrapT = wraptype;
					mat.emissiveMap.magFilter = THREE.LinearFilter;
					mat.emissive.setRGB(material.reflectionColor[0] / 255, material.reflectionColor[1] / 255, material.reflectionColor[2] / 255);
				}
				if (material.textures.compound) {
					let compound = await (await this.getTextureFile(material.textures.compound, false)).toImageData();
					let compoundmapped = new ImageData(compound.width, compound.height);
					//threejs expects g=metal,b=roughness, rs has r=metal,g=roughness
					for (let i = 0; i < compound.data.length; i += 4) {
						compoundmapped.data[i + 1] = compound.data[i + 1];
						compoundmapped.data[i + 2] = compound.data[i + 0];
						compoundmapped.data[i + 3] = 255;
					}
					let tex = new THREE.DataTexture(compoundmapped.data, compoundmapped.width, compoundmapped.height, THREE.RGBAFormat);
					tex.needsUpdate = true;
					tex.wrapS = wraptype;
					tex.wrapT = wraptype;
					tex.encoding = THREE.sRGBEncoding;
					tex.magFilter = THREE.LinearFilter;
					mat.metalnessMap = tex;
					mat.roughnessMap = tex;
					mat.metalness = 1;
				}
			}
			mat.vertexColors = material.vertexColors || hasVertexAlpha;

			if (!material.vertexColors && hasVertexAlpha) {
				mat.customProgramCacheKey = () => "vertexalphaonly";
				mat.onBeforeCompile = (shader, renderer) => {
					//this sucks but is nessecary since three doesn't support vertex alpha without vertex color
					//hard to rewrite the color attribute since we don't know if other meshes do use the colors
					shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "diffuseColor.a *= vColor.a;");
				}
			}
			mat.userData = material;
			if (material.uvAnim) {
				(mat.userData.gltfExtensions ??= {}).RA_materials_uvanim = [material.uvAnim.u, material.uvAnim.v];
			}
			return mat;
		}, mat => 256 * 256 * 4 * 2);
	}
}

/**
 * When merging player npc models the client incorrectly merge vertices which
 * have the same position+color+material, but with different bone ids. The second
 * vertex will be merged and its bone id is lost. This bug is so entrenched in
 * the game that player models will have detached arms and waist if not replicated
 */
export function mergeNaiveBoneids(model: ModelData) {
	let mergecount = 0;
	for (let meshid1 = 0; meshid1 < model.meshes.length; meshid1++) {
		let mesh1 = model.meshes[meshid1];
		if (!mesh1.attributes.color || !mesh1.attributes.skinids || !mesh1.attributes.skinweights) { continue; }
		for (let i1 = 0; i1 < mesh1.attributes.pos.count; i1++) {
			let x = mesh1.attributes.pos.getX(i1); let y = mesh1.attributes.pos.getY(i1); let z = mesh1.attributes.pos.getZ(i1);
			let r = mesh1.attributes.color.getX(i1); let g = mesh1.attributes.color.getY(i1); let b = mesh1.attributes.color.getZ(i1);
			for (let meshidb = 0; meshidb <= meshid1; meshidb++) {
				let mesh2 = model.meshes[meshidb];
				if (!mesh2.attributes.color || !mesh2.attributes.skinids || !mesh2.attributes.skinweights) { continue; }
				// if (mesh2.materialId != mesh1.materialId) { continue; }

				let i2end = (meshidb == meshid1 ? i1 - 1 : mesh2.attributes.pos.count);
				for (let i2 = 0; i2 < i2end; i2++) {
					let posmatch = x == mesh2.attributes.pos.getX(i2) && y == mesh2.attributes.pos.getY(i2) && z == mesh2.attributes.pos.getZ(i2);
					let colmatch = r == mesh2.attributes.color.getX(i2) && g == mesh2.attributes.color.getY(i2) && b == mesh2.attributes.color.getZ(i2);
					if (posmatch && colmatch) {
						if (mesh1.attributes.skinids.getX(i1) != mesh2.attributes.skinids.getX(i2)) {
							mergecount++;
						}
						mesh1.attributes.skinids.copyAt(i1, mesh2.attributes.skinids, i2);
						mesh1.attributes.skinweights.copyAt(i1, mesh2.attributes.skinweights, i2);
					}
				}
			}
		}
	}
	console.log("merged", mergecount);
}

export function mergeModelDatas(models: ModelData[]) {
	let r: ModelData = {
		bonecount: Math.max(...models.map(q => q.bonecount)),
		maxy: Math.max(...models.map(q => q.maxy)),
		miny: Math.max(...models.map(q => q.miny)),
		meshes: models.flatMap(q => q.meshes)
	}
	return r;
}

export async function ob3ModelToThree(scene: ThreejsSceneCache, model: ModelData) {
	//has to be of type skinnedmesh in order to support a skeleton somehow
	let rootnode: Mesh;
	let nullskeleton: Skeleton = null!;
	if (model.bonecount != 0) {
		let skinnedroot = new SkinnedMesh();
		let nullbones: Object3D[] = [];
		for (let i = 0; i < model.bonecount; i++) { nullbones.push(skinnedroot); }
		nullskeleton = new Skeleton(nullbones as any);
		skinnedroot.bind(nullskeleton);
		//This is so dumb, the root object has to be a skinnedmesh in order for the skeleton to bind correctly
		//however, you cannot have a skinnedmesh without geometry when exporting to GLTF
		//This hack seems to work, but will probably explode some time in the future
		//sorry future self 
		//TODO could this be solved with AnimationObjectGroup?
		//@ts-ignore
		skinnedroot.isSkinnedMesh = false;
		//@ts-ignore
		skinnedroot.isMesh = false;
		rootnode = skinnedroot;
	} else {
		rootnode = new Mesh();
		//@ts-ignore
		rootnode.isMesh = false;
	}

	for (let meshdata of model.meshes) {
		let attrs = meshdata.attributes;
		let geo = new THREE.BufferGeometry();
		geo.setAttribute("position", attrs.pos);
		if (attrs.color) { geo.setAttribute("color", attrs.color); }
		if (attrs.normals) { geo.setAttribute("normal", attrs.normals); }
		if (attrs.texuvs) { geo.setAttribute("uv", attrs.texuvs); }
		if (attrs.skinids) { geo.setAttribute("skinIndex", attrs.skinids); }
		if (attrs.skinweights) { geo.setAttribute("skinWeight", attrs.skinweights); }
		geo.index = meshdata.indices;
		let mat = await scene.getMaterial(meshdata.materialId, meshdata.hasVertexAlpha);
		//@ts-ignore
		// mat.wireframe = true;
		let mesh: THREE.Mesh | THREE.SkinnedMesh;
		if (geo.attributes.skinIndex) {
			mesh = new THREE.SkinnedMesh(geo, mat);
			// (mesh as SkinnedMesh).bind(nullskeleton);
		} else {
			mesh = new THREE.Mesh(geo, mat);
		}
		rootnode.add(mesh);
	}
	return rootnode;
}

export function getModelHashes(model: models, id: number) {
	let meshhashes: {
		id: number,
		sub: number,
		uvshead: number,
		uvsfull: number,
		normalshead: number,
		normalsfull: number,
		poshead: number,
		posfull: number,
		verts: number,
		indexpos: {
			id: number,
			head: number,
			full: number,
			count: number
		}[]
	}[] = [];
	const matchvertices = 20;
	const maxfullvertices = 1000;
	const bufsize = matchvertices * 2 * 2;
	const normalssize = matchvertices * 3;
	const possize = matchvertices * 3 * 2;
	for (let [sub, mesh] of model.meshes.entries()) {
		let uvshead = 0;
		let uvsfull = 0;
		let normalshead = 0;
		let normalsfull = 0;
		let poshead = 0;
		let posfull = 0;
		if (mesh.uvBuffer && mesh.uvBuffer.length >= bufsize) {
			let hasnonnull = false;
			for (let i = 0; i < bufsize; i++) {
				if (mesh.uvBuffer[i] != 0) {
					hasnonnull = true;
					break;
				}
			}
			if (hasnonnull) {
				uvshead = crc32(Buffer.from(mesh.uvBuffer.buffer, mesh.uvBuffer.byteOffset, bufsize));
				uvsfull = crc32(Buffer.from(mesh.uvBuffer.buffer, mesh.uvBuffer.byteOffset, Math.min(maxfullvertices * 2 * 2, mesh.uvBuffer.byteLength)));
			}
		}
		if (mesh.normalBuffer && mesh.normalBuffer.length >= normalssize) {
			normalshead = crc32(Buffer.from(mesh.normalBuffer.buffer, mesh.normalBuffer.byteOffset, normalssize));
			normalsfull = crc32(Buffer.from(mesh.normalBuffer.buffer, mesh.normalBuffer.byteOffset, Math.min(maxfullvertices * 3, mesh.normalBuffer.byteLength)));
		}
		if (mesh.positionBuffer && mesh.positionBuffer.length >= possize) {
			poshead = crc32(Buffer.from(mesh.positionBuffer.buffer, mesh.positionBuffer.byteOffset, possize));
			posfull = crc32(Buffer.from(mesh.positionBuffer.buffer, mesh.positionBuffer.byteOffset, Math.min(maxfullvertices * 3 * 2, mesh.positionBuffer.byteLength)));
		}
		let indexedposcrcs: { id: number, head: number, full: number, count: number }[] = [];
		if (mesh.positionBuffer) {
			for (let indices of mesh.indexBuffers) {
				let primcount = indices.length / 3 | 0;
				if (primcount >= matchvertices) {
					let crc = new CrcBuilder();
					let head = 0;
					for (let i = 0; i < primcount; i++) {
						for (let j = 0; j < 3; j++) {
							let index = indices[i * 3 + j];
							crc.addUint16(mesh.positionBuffer[index * 3 + 0]);
							crc.addUint16(mesh.positionBuffer[index * 3 + 1]);
							crc.addUint16(mesh.positionBuffer[index * 3 + 2]);
						}
						if (i == matchvertices - 1) {
							head = crc.get();
						}
					}
					indexedposcrcs.push({
						id,
						head,
						full: crc.get(),
						count: primcount
					});
				}
			}
		}
		if (uvshead || poshead || normalshead || indexedposcrcs.length != 0) {
			meshhashes.push({
				id,
				sub,
				uvshead, uvsfull,
				normalshead, normalsfull,
				poshead, posfull,
				verts: mesh.vertexCount!,
				indexpos: indexedposcrcs
			});
		}
	}
}