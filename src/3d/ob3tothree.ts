import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "../utils";
import { cacheConfigPages, cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { ModelData, parseOb3Model } from '../3d/ob3togltf';
import { convertMaterial, defaultMaterial, materialCacheKey, MaterialData } from "./jmat";
import { modifyMesh } from "./mapsquare";
import * as THREE from "three";
import { BoneInit, MountableAnimation, parseAnimationSequence3, parseAnimationSequence4, ParsedAnimation } from "./animationframes";
import { parseSkeletalAnimation } from "./animationskeletal";
import { archiveToFileId, CacheFileSource, SubFile } from "../cache";
import { Bone, BufferAttribute, BufferGeometry, Matrix4, Mesh, Object3D, Skeleton, SkinnedMesh } from "three";
import { parseFramemaps, parseMapscenes, parseMapsquareOverlays, parseMapsquareUnderlays, parseMaterials, parseSequences } from "../opdecoder";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { mapsquare_overlays } from "../../generated/mapsquare_overlays";
import { mapscenes } from "../../generated/mapscenes";

globalThis.packedhsl = function (hsl: number) {
	return HSL2RGB(packedHSL2HSL(hsl));
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
					+ `texelColor = mapTexelToLinear( mix( diffuseColor,texelColor,dot(vec4(1.0),v_ra_floortex_weights)) );\n`
					+ `#endif\n`
					+ `diffuseColor = texelColor;\n`
				);
	}
}


//basically stores all the config of the game engine
export class EngineCache {
	framemapCache = new Map<number, ReturnType<typeof parseFramemaps["read"]>>();
	materialCache = new Map<number, MaterialData>();
	ready: Promise<EngineCache>;
	source: CacheFileSource;

	materialArchive = new Map<number, Buffer>();
	mapUnderlays: mapsquare_underlays[];
	mapOverlays: mapsquare_overlays[];
	mapMapscenes: mapscenes[];

	static async create(source: CacheFileSource) {
		let ret = new EngineCache(source);
		return ret.ready;
	}

	private constructor(source: CacheFileSource) {
		this.source = source;
		this.ready = this.preload();
	}

	private async preload() {
		let matarch = await this.source.getArchiveById(cacheMajors.materials, 0);
		for (let file of matarch) {
			this.materialArchive.set(file.fileid, file.buffer);
		}

		this.mapUnderlays = (await this.source.getArchiveById(cacheMajors.config, cacheConfigPages.mapunderlays))
			.map(q => parseMapsquareUnderlays.read(q.buffer));
		this.mapOverlays = (await this.source.getArchiveById(cacheMajors.config, cacheConfigPages.mapoverlays))
			.map(q => parseMapsquareOverlays.read(q.buffer));
		this.mapMapscenes = (await this.source.getArchiveById(cacheMajors.config, cacheConfigPages.mapscenes))
			.map(q => parseMapscenes.read(q.buffer));

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
}

export class ThreejsSceneCache {
	textureCache = new Map<number, Promise<THREE.Texture>>();
	gltfMaterialCache = new Map<number, Promise<THREE.Material>>();
	source: CacheFileSource;
	cache: EngineCache;
	textureType: "png" | "dds" | "bmp" = "dds";//only dds is currently fully implemented

	static textureIndices = {
		png: cacheMajors.texturesPng,
		dds: cacheMajors.texturesDds,
		bmp: cacheMajors.texturesBmp
	}

	constructor(scenecache: EngineCache) {
		this.cache = scenecache;
		this.source = scenecache.source;
	}

	getFileById(major: number, id: number) {
		return this.source.getFileById(major, id);
	}
	getArchiveById(major: number, minor: number) {
		return this.source.getArchiveById(major, minor);
	}

	getTextureFile(texid: number, allowAlpha: boolean) {
		let texprom = this.textureCache.get(texid);
		if (!texprom) {
			texprom = (async () => {
				let file = await this.getFileById(ThreejsSceneCache.textureIndices[this.textureType], texid);
				let parsed = new ParsedTexture(file, allowAlpha);
				let texture = new THREE.CanvasTexture(await parsed.toWebgl());
				return texture;
			})();

			this.textureCache.set(texid, texprom);
		}
		return texprom;
	}


	async getMaterial(matid: number, hasVertexAlpha: boolean) {
		//TODO the material should have this data, not the mesh
		let matcacheid = materialCacheKey(matid, hasVertexAlpha);
		let cached = this.gltfMaterialCache.get(matcacheid);
		if (!cached) {
			cached = (async () => {
				let material = this.cache.getMaterialData(matid);

				let mat = new THREE.MeshPhongMaterial();
				mat.transparent = hasVertexAlpha || material.alphamode != "opaque";
				mat.alphaTest = (material.alphamode == "cutoff" ? 0.5 : 0.1);//TODO use value from material
				if (material.textures.diffuse) {
					mat.map = await this.getTextureFile(material.textures.diffuse, material.alphamode != "opaque");
					mat.map.wrapS = THREE.RepeatWrapping;
					mat.map.wrapT = THREE.RepeatWrapping;
					mat.map.encoding = THREE.sRGBEncoding;
				}
				if (material.textures.normal) {
					mat.normalMap = await this.getTextureFile(material.textures.normal, false);
					mat.normalMap.wrapS = THREE.RepeatWrapping;
					mat.normalMap.wrapT = THREE.RepeatWrapping;
				}
				mat.vertexColors = material.vertexColors || hasVertexAlpha;
				mat.color.setRGB(material.materialColor[0] / 255, material.materialColor[1] / 255, material.materialColor[2] / 255);
				//TODO re-enable
				// mat.vertexColors = true;
				// mat.map = null;

				if (!material.vertexColors && hasVertexAlpha) {
					mat.customProgramCacheKey = () => "vertexalphaonly";
					mat.onBeforeCompile = (shader, renderer) => {
						//this sucks but is nessecary since three doesn't support vertex alpha without vertex color
						//hard to rewrite the color attribute since we don't know if other meshes do use the colors
						shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "diffuseColor.a *= vColor.a;");
					}
				}
				mat.shininess = 0;
				mat.userData = material;
				return mat;
			})();
			this.gltfMaterialCache.set(matcacheid, cached);
		}
		return cached;
	}
}


export async function ob3ModelToThreejsNode(scene: ThreejsSceneCache, modelfiles: Buffer[]) {
	let meshdatas = modelfiles.map(file => {
		let meshdata = parseOb3Model(file);
		// meshdata.meshes = meshdata.meshes.map(q => modifyMesh(q));
		return meshdata;
	});

	let mesh = await ob3ModelToThree(scene, mergeModelDatas(meshdatas));
	return mesh;
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
		rootnode = skinnedroot;
		let nullbones: Object3D[] = [];
		for (let i = 0; i < model.bonecount; i++) { nullbones.push(skinnedroot); }
		nullskeleton = new Skeleton(nullbones as any);
		skinnedroot.bind(nullskeleton);
		//This is so dumb, the root object has to be a skinnedmesh in order for the skeleton to bind correctly
		//however, you cannot have a skinnedmesh without geometry when exporting to GLTF
		//This hack seems to work, but will probably explode some time in the future
		//sorry future self 
		//@ts-ignore
		skinnedroot.isSkinnedMesh = false;
	} else {
		rootnode = new Mesh();
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
