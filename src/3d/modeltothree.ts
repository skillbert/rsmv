import { cacheConfigPages, cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { ModelData, parseOb3Model } from '../3d/rt7model';
import { parseRT5Model } from "../3d/rt5model";
import { convertMaterial, defaultMaterial, materialCacheKey, MaterialData } from "./jmat";
import * as THREE from "three";
import { archiveToFileId, CachedObject, CacheFileSource, CacheIndex, CachingFileSource, SubFile } from "../cache";
import { Bone, BufferAttribute, BufferGeometry, Matrix4, Mesh, Object3D, Skeleton, SkinnedMesh, Texture } from "three";
import { parse } from "../opdecoder";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { mapsquare_overlays } from "../../generated/mapsquare_overlays";
import { mapscenes } from "../../generated/mapscenes";
import { cacheFileJsonModes } from "../scripts/extractfiles";
import { JSONSchema6Definition } from "json-schema";
import { models } from "../../generated/models";
import { crc32, CrcBuilder } from "../libs/crc32util";
import { makeImageData } from "../imgutils";

export type ParsedMaterial = {
	//TODO rename
	mat: THREE.Material,
	matmeta: MaterialData
}

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
export class EngineCache extends CachingFileSource {
	ready: Promise<EngineCache>;
	hasOldModels: boolean;
	hasNewModels: boolean;

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

	private constructor(source: CacheFileSource) {
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
			.forEach(q => this.mapUnderlays[q.fileid] = parse.mapsquareUnderlays.read(q.buffer, this.rawsource));
		this.mapOverlays = [];
		(await this.getArchiveById(cacheMajors.config, cacheConfigPages.mapoverlays))
			.forEach(q => this.mapOverlays[q.fileid] = parse.mapsquareOverlays.read(q.buffer, this.rawsource));
		this.mapMapscenes = [];
		(await this.getArchiveById(cacheMajors.config, cacheConfigPages.mapscenes))
			.forEach(q => this.mapMapscenes[q.fileid] = parse.mapscenes.read(q.buffer, this.rawsource));

		try {
			await this.getCacheIndex(cacheMajors.oldmodels);
			this.hasOldModels = true;
		} catch {
			this.hasOldModels = false;
		}
		try {
			await this.getCacheIndex(cacheMajors.models);
			this.hasNewModels = true;
		} catch {
			this.hasNewModels = false;
		}

		return this;
	}

	getMaterialData(id: number) {
		if (this.getBuildNr() < 759) {
			let mat = defaultMaterial();
			if (id != -1) {
				mat.textures.diffuse = id;
			}
			//TODO other material props
			return mat;
		} else {
			let cached = this.materialCache.get(id);
			if (!cached) {
				if (id == -1) {
					cached = defaultMaterial();
				} else {
					let file = this.materialArchive.get(id);
					if (!file) { throw new Error("material " + id + " not found"); }
					cached = convertMaterial(file, id, this.rawsource);
				}
				this.materialCache.set(id, cached);
			}
			return cached;
		}
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
					let res = mode.parser.read(file.buffer, this.rawsource);
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
	let detectmajor = async (major: number) => {
		let lastfile = -1;
		try {
			let indexfile = await source.getCacheIndex(major);
			let last = indexfile[indexfile.length - 1];
			await source.getFile(last.major, last.minor, last.crc);
			lastfile = last.minor;
		} catch (e) { }
		return lastfile;
	}

	let textureMode: TextureModes = "dds";
	let numbmp = await detectmajor(cacheMajors.texturesBmp);
	let numdds = await detectmajor(cacheMajors.texturesDds);
	if (numbmp > 0 || numdds > 0) {
		textureMode = (numbmp > numdds ? "bmp" : "dds");
	} else {
		let numpng2014 = await detectmajor(cacheMajors.textures2015Png);
		let numdds2014 = await detectmajor(cacheMajors.textures2015Dds);
		if (numpng2014 > 0 || numdds2014 >= 0) {
			textureMode = (numdds2014 > numpng2014 ? "dds2014" : "png2014");
		} else if (await detectmajor(cacheMajors.texturesOldPng) > 0) {
			textureMode = "oldpng";
		}
	}
	console.log(`detectedtexture mode. ${textureMode}`);

	return textureMode;
}

async function convertMaterialToThree(source: ThreejsSceneCache, material: MaterialData, hasVertexAlpha: boolean) {
	// let mat = new THREE.MeshPhongMaterial();
	// mat.shininess = 0;
	let mat = new THREE.MeshStandardMaterial();
	mat.alphaTest = (material.alphamode == "cutoff" ? 0.5 : 0.1);//TODO use value from material
	mat.transparent = hasVertexAlpha || material.alphamode == "blend";
	const wraptypes = material.texmodes == "clamp" ? THREE.ClampToEdgeWrapping : material.texmodes == "repeat" ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;
	const wraptypet = material.texmodet == "clamp" ? THREE.ClampToEdgeWrapping : material.texmodet == "repeat" ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;

	if (material.textures.diffuse) {
		let diffuse = await (await source.getTextureFile("diffuse", material.textures.diffuse, material.stripDiffuseAlpha)).toImageData();
		let difftex = new THREE.DataTexture(diffuse.data, diffuse.width, diffuse.height, THREE.RGBAFormat);
		difftex.needsUpdate = true;
		difftex.wrapS = wraptypes;
		difftex.wrapT = wraptypet;
		difftex.encoding = THREE.sRGBEncoding;
		difftex.magFilter = THREE.LinearFilter;
		difftex.minFilter = THREE.NearestMipMapNearestFilter;
		difftex.generateMipmaps = true;

		mat.map = difftex;

		if (material.textures.normal) {
			let parsed = await source.getTextureFile("normal", material.textures.normal, false);
			let raw = await parsed.toImageData();
			let normals = makeImageData(null, raw.width, raw.height);
			let emisive = makeImageData(null, raw.width, raw.height);
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
			mat.normalMap.wrapS = wraptypes;
			mat.normalMap.wrapT = wraptypet;
			mat.normalMap.magFilter = THREE.LinearFilter;

			mat.emissiveMap = new THREE.DataTexture(emisive.data, emisive.width, emisive.height, THREE.RGBAFormat);
			mat.emissiveMap.needsUpdate = true;
			mat.emissiveMap.wrapS = wraptypes;
			mat.emissiveMap.wrapT = wraptypet;
			mat.emissiveMap.magFilter = THREE.LinearFilter;
			mat.emissive.setRGB(material.reflectionColor[0], material.reflectionColor[1], material.reflectionColor[2]);
		}
		if (material.textures.compound) {
			let compound = await (await source.getTextureFile("compound", material.textures.compound, false)).toImageData();
			let compoundmapped = makeImageData(null, compound.width, compound.height);
			//threejs expects g=metal,b=roughness, rs has r=metal,g=roughness
			for (let i = 0; i < compound.data.length; i += 4) {
				compoundmapped.data[i + 1] = compound.data[i + 1];
				compoundmapped.data[i + 2] = compound.data[i + 0];
				compoundmapped.data[i + 3] = 255;
			}
			let tex = new THREE.DataTexture(compoundmapped.data, compoundmapped.width, compoundmapped.height, THREE.RGBAFormat);
			tex.needsUpdate = true;
			tex.wrapS = wraptypes;
			tex.wrapT = wraptypet;
			tex.encoding = THREE.sRGBEncoding;
			tex.magFilter = THREE.LinearFilter;
			mat.metalnessMap = tex;
			mat.roughnessMap = tex;
			mat.metalness = 1;
		}
	}
	mat.vertexColors = material.vertexColorWhitening != 1 || hasVertexAlpha;

	mat.userData = material;
	if (material.uvAnim) {
		(mat.userData.gltfExtensions ??= {}).RA_materials_uvanim = {
			uvAnim: [material.uvAnim.u, material.uvAnim.v]
		};
	}

	return { mat, matmeta: material };
}

type TextureModes = "png" | "dds" | "bmp" | "ktx" | "oldpng" | "png2014" | "dds2014";
type TextureTypes = keyof MaterialData["textures"];

export class ThreejsSceneCache {
	private modelCache = new Map<number, CachedObject<ModelData>>();
	private oldModelCache = new Map<number, CachedObject<ModelData>>();
	private threejsTextureCache = new Map<number, CachedObject<ParsedTexture>>();
	private threejsMaterialCache = new Map<number, CachedObject<ParsedMaterial>>();
	engine: EngineCache;
	textureType: TextureModes = "dds";
	useOldModels: boolean;

	static textureIndices: Record<TextureTypes, Record<TextureModes, number>> = {
		diffuse: {
			png: cacheMajors.texturesPng,
			dds: cacheMajors.texturesDds,
			bmp: cacheMajors.texturesBmp,
			ktx: cacheMajors.texturesKtx,
			png2014: cacheMajors.textures2015Png,
			dds2014: cacheMajors.textures2015Dds,
			oldpng: cacheMajors.texturesOldPng
		},
		normal: {
			png: cacheMajors.texturesPng,
			dds: cacheMajors.texturesDds,
			bmp: cacheMajors.texturesBmp,
			ktx: cacheMajors.texturesKtx,
			//TODO are these normals or compounds?
			png2014: cacheMajors.textures2015CompoundPng,
			dds2014: cacheMajors.textures2015CompoundDds,
			oldpng: cacheMajors.texturesOldCompoundPng
		},
		compound: {
			png: cacheMajors.texturesPng,
			dds: cacheMajors.texturesDds,
			bmp: cacheMajors.texturesBmp,
			ktx: cacheMajors.texturesKtx,
			//TODO are these normals or compounds?
			png2014: cacheMajors.textures2015CompoundPng,
			dds2014: cacheMajors.textures2015CompoundDds,
			oldpng: cacheMajors.texturesOldCompoundPng
		}
	}

	private constructor(scenecache: EngineCache) {
		this.engine = scenecache;
		this.useOldModels = scenecache.hasOldModels && !scenecache.hasNewModels;
	}
	static async create(engine: EngineCache, texturemode: TextureModes | "auto" = "auto") {
		let scene = new ThreejsSceneCache(engine);
		scene.textureType = (texturemode == "auto" ? await detectTextureMode(engine.rawsource) : texturemode);
		return scene;
	}

	getFileById(major: number, id: number) {
		return this.engine.getFileById(major, id);
	}

	getTextureFile(type: TextureTypes, texid: number, stripAlpha: boolean) {
		let cacheindex = ThreejsSceneCache.textureIndices[type][this.textureType];
		let cachekey = ((cacheindex | 0xff) << 23) | texid;

		return this.engine.fetchCachedObject(this.threejsTextureCache, cachekey, async () => {
			let file = await this.getFileById(cacheindex, texid);
			let parsed = new ParsedTexture(file, stripAlpha, true);
			return parsed;
		}, obj => obj.filesize * 2);
	}

	getModelData(id: number, type: "auto" | "old" | "new" = "auto") {
		if (type == "old" || (type == "auto" && this.useOldModels)) {
			return this.engine.fetchCachedObject(this.oldModelCache, id, () => {
				return this.engine.getFileById(cacheMajors.oldmodels, id)
					.then(f => parseRT5Model(f, this.engine.rawsource));
			}, obj => obj.meshes.reduce((a, m) => m.indices.count, 0) * 30);
		} else {
			return this.engine.fetchCachedObject(this.modelCache, id, () => {
				return this.engine.getFileById(cacheMajors.models, id)
					.then(f => parseOb3Model(f, this.engine));
			}, obj => obj.meshes.reduce((a, m) => m.indices.count, 0) * 30);
		}
	}

	getMaterial(matid: number, hasVertexAlpha: boolean) {
		//TODO the material should have this data, not the mesh
		let matcacheid = materialCacheKey(matid, hasVertexAlpha);
		return this.engine.fetchCachedObject(this.threejsMaterialCache, matcacheid, async () => {
			let material = this.engine.getMaterialData(matid);
			return convertMaterialToThree(this, material, hasVertexAlpha);
		}, mat => 256 * 256 * 4 * 2);
	}
}


export function applyMaterial(mesh: Mesh, parsedmat: ParsedMaterial) {
	let oldcol = mesh.geometry.getAttribute("color");
	let hasVertexAlpha = !!oldcol && oldcol.itemSize == 4;
	mesh.material = parsedmat.mat;
	let needsvertexcolors = parsedmat.matmeta.vertexColorWhitening != 1 || hasVertexAlpha;
	if (needsvertexcolors) {
		if (parsedmat.matmeta.vertexColorWhitening != 0) {
			let vertcount = mesh.geometry.getAttribute("position").count;
			let oldcol = mesh.geometry.getAttribute("color");
			let oldfrac = 1 - parsedmat.matmeta.vertexColorWhitening;
			// let newrcomp = parsedmat.matmeta.vertexColorWhitening * parsedmat.matmeta.reflectionColor[0];
			// let newgcomp = parsedmat.matmeta.vertexColorWhitening * parsedmat.matmeta.reflectionColor[1];
			// let newbcomp = parsedmat.matmeta.vertexColorWhitening * parsedmat.matmeta.reflectionColor[2];
			let newrcomp = 1;//This should be blended using like code above i think, but still missing something
			let newgcomp = 1;//most models use white anyway, but there are some ~2011 models that use other colors
			let newbcomp = 1;
			let stride = hasVertexAlpha ? 4 : 3;
			let buf = new Uint8Array(stride * vertcount);
			if (hasVertexAlpha && !oldcol) {
				throw new Error("material has vertex alpha, but mesh doesn't have vertex colors");
			}
			for (let i = 0; i < vertcount; i++) {
				let oldr = (oldcol ? oldcol.getX(i) : 1);
				let oldg = (oldcol ? oldcol.getY(i) : 1);
				let oldb = (oldcol ? oldcol.getZ(i) : 1);
				buf[i * stride + 0] = (oldr * oldfrac + newrcomp) * 255;
				buf[i * stride + 1] = (oldg * oldfrac + newgcomp) * 255;
				buf[i * stride + 2] = (oldb * oldfrac + newbcomp) * 255;
				if (hasVertexAlpha) {
					buf[i * stride + 3] = oldcol.getW(i) * 255;
				}
			}
			mesh.geometry.setAttribute("color", new BufferAttribute(buf, stride, true));
		}
	} else if (mesh.geometry.getAttribute("color")) {
		mesh.geometry.deleteAttribute("color");
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
		//TODO figure out what the engine does here on skeletal animations when they finally get added to the player
		if (!mesh1.attributes.color || !mesh1.needsNormalBlending && (!mesh1.attributes.boneids || !mesh1.attributes.boneweights)) { continue; }
		for (let i1 = 0; i1 < mesh1.attributes.pos.count; i1++) {
			let x = mesh1.attributes.pos.getX(i1); let y = mesh1.attributes.pos.getY(i1); let z = mesh1.attributes.pos.getZ(i1);
			// let r = mesh1.attributes.color.getX(i1); let g = mesh1.attributes.color.getY(i1); let b = mesh1.attributes.color.getZ(i1);
			for (let meshidb = 0; meshidb <= meshid1; meshidb++) {
				let mesh2 = model.meshes[meshidb];
				let blendnormals = mesh1.needsNormalBlending && mesh2.needsNormalBlending;
				if (!mesh2.attributes.color || !blendnormals && (!mesh2.attributes.boneids || !mesh2.attributes.boneweights)) { continue; }
				// if (mesh2.materialId != mesh1.materialId) { continue; }

				let i2end = (meshidb == meshid1 ? i1 - 1 : mesh2.attributes.pos.count);
				for (let i2 = 0; i2 < i2end; i2++) {
					let posmatch = x == mesh2.attributes.pos.getX(i2) && y == mesh2.attributes.pos.getY(i2) && z == mesh2.attributes.pos.getZ(i2);
					// let colmatch = r == mesh2.attributes.color.getX(i2) && g == mesh2.attributes.color.getY(i2) && b == mesh2.attributes.color.getZ(i2);
					if (posmatch) {
						if (mesh1.attributes.boneids && mesh1.attributes.boneweights && mesh2.attributes.boneids && mesh2.attributes.boneweights) {
							if (mesh1.attributes.boneids.getX(i1) != mesh2.attributes.boneids.getX(i2)) {
								mergecount++;
							}
							mesh1.attributes.boneids.copyAt(i1, mesh2.attributes.boneids, i2);
							mesh1.attributes.boneweights.copyAt(i1, mesh2.attributes.boneweights, i2);
						}

						//blend the two normals
						if (blendnormals && mesh1.attributes.normals && mesh2.attributes.normals) {
							let x = mesh1.attributes.normals.getX(i1) + mesh2.attributes.normals.getX(i2);
							let y = mesh1.attributes.normals.getY(i1) + mesh2.attributes.normals.getY(i2);
							let z = mesh1.attributes.normals.getZ(i1) + mesh2.attributes.normals.getZ(i2);
							//ignore faces with oposite normals
							if (Math.hypot(x, y, z) > 0.01) {
								//just sum, doing normalization later
								mesh1.attributes.normals.setXYZ(i1, x, y, z);
								mesh2.attributes.normals.setXYZ(i2, x, y, z);
							}
						}
					}
				}
			}
		}
	}

	//normalize normals again
	for (let mesh of model.meshes) {
		if (mesh.needsNormalBlending && mesh.attributes.normals) {
			let normals = mesh.attributes.normals;
			for (let i = 0; i < normals.count; i++) {
				let x = normals.getX(i);
				let y = normals.getY(i);
				let z = normals.getZ(i);
				let len = Math.hypot(x, y, z);
				if (len > 0) {
					let scale = 1 / len;
					normals.setXYZ(i, x * scale, y * scale, z * scale);
				}
			}
		}
	}

	console.log("merged", mergecount);
}

export function mergeModelDatas(models: ModelData[]) {
	let r: ModelData = {
		bonecount: Math.max(...models.map(q => q.bonecount)),
		skincount: Math.max(...models.map(q => q.skincount)),
		maxy: Math.max(...models.map(q => q.maxy)),
		miny: Math.max(...models.map(q => q.miny)),
		meshes: models.flatMap(q => q.meshes),
		debugmeshes: models.flatMap(q => q.debugmeshes ?? [])
	}
	return r;
}

export async function ob3ModelToThree(scene: ThreejsSceneCache, model: ModelData) {
	//has to be of type skinnedmesh in order to support a skeleton somehow
	let rootnode: Mesh;
	let nullskeleton: Skeleton = null!;
	if (model.bonecount != 0 || model.skincount != 0) {
		let skinnedroot = new SkinnedMesh();
		let nullbones: Object3D[] = [];
		let maxbones = Math.max(model.bonecount, model.skincount);
		//TODO just need 2 skeletons here?
		for (let i = 0; i < maxbones; i++) { nullbones.push(skinnedroot); }
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
		if (attrs.skinids) { geo.setAttribute("RA_skinIndex_skin", attrs.skinids); }
		if (attrs.skinweights) { geo.setAttribute("RA_skinWeight_skin", attrs.skinweights); }
		if (attrs.boneids) { geo.setAttribute("RA_skinIndex_bone", attrs.boneids); }
		if (attrs.boneweights) { geo.setAttribute("RA_skinWeight_bone", attrs.boneweights); }
		geo.index = meshdata.indices;
		//@ts-ignore
		// mat.wireframe = true;
		let mesh: THREE.Mesh | THREE.SkinnedMesh;
		if (attrs.skinids || attrs.boneids) {
			mesh = new THREE.SkinnedMesh(geo);
			// (mesh as SkinnedMesh).bind(nullskeleton);
		} else {
			mesh = new THREE.Mesh(geo);
		}
		applyMaterial(mesh, await scene.getMaterial(meshdata.materialId, meshdata.hasVertexAlpha));
		rootnode.add(mesh);
	}
	if (model.debugmeshes && model.debugmeshes.length != 0) {
		rootnode.add(...model.debugmeshes);
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