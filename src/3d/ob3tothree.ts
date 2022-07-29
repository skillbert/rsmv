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
