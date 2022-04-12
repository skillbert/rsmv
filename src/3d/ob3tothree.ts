import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { cacheConfigPages, cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { ModelData, parseOb3Model } from '../3d/ob3togltf';
import { convertMaterial, defaultMaterial, materialCacheKey, MaterialData } from "./jmat";
import { modifyMesh } from "./mapsquare";
import * as THREE from "three";
import { BoneInit, MountableAnimation, parseAnimationSequence3, parseAnimationSequence4, ParsedAnimation } from "./animationframes";
import { parseSkeletalAnimation } from "./animationskeletal";
import { archiveToFileId, CacheFileSource } from "../cache";
import { Matrix4, Object3D, SkinnedMesh } from "three";
import { parseFramemaps, parseMapscenes, parseMapsquareOverlays, parseMapsquareUnderlays, parseMaterials, parseSequences } from "../opdecoder";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { mapsquare_overlays } from "../../generated/mapsquare_overlays";
import { mapscenes } from "../../generated/mapscenes";

(globalThis as any).packedhsl = function (hsl: number) {
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

	async preload() {
		// let framemapindices = await this.source.getIndexFile(cacheMajors.framemaps);
		// for (let index of framemapindices) {
		// 	let arch = await this.source.getFileArchive(index);
		// 	for (let file of arch) {
		// 		this.framemapCache.set(achiveToFileId(index.major, index.minor, file.fileid), parseFramemaps.read(file.buffer));
		// 	}
		// }
		let materialindices = await this.source.getIndexFile(cacheMajors.materials);
		this.materialCache.set(-1, defaultMaterial());
		for (let index of materialindices) {
			let arch = await this.source.getFileArchive(index);
			for (let file of arch) {
				this.materialCache.set(archiveToFileId(index.major, index.minor, file.fileid), convertMaterial(file.buffer));
			}
		}

		this.mapUnderlays = (await this.source.getArchiveById(cacheMajors.config, cacheConfigPages.mapunderlays))
			.map(q => parseMapsquareUnderlays.read(q.buffer));
		this.mapOverlays = (await this.source.getArchiveById(cacheMajors.config, cacheConfigPages.mapoverlays))
			.map(q => parseMapsquareOverlays.read(q.buffer));
		this.mapMapscenes = (await this.source.getArchiveById(cacheMajors.config, cacheConfigPages.mapscenes))
			.map(q => parseMapscenes.read(q.buffer));

		return this;
	}

	// getFramemap(id: number) {
	// 	return this.framemapCache.get(id)!;
	// }
	getMaterialData(id: number) {
		return this.materialCache.get(id)!;
	}
}

export class ThreejsSceneCache {
	textureCache = new Map<number, THREE.Texture>();
	gltfMaterialCache = new Map<number, Promise<THREE.Material>>();
	source: CacheFileSource;
	cache: EngineCache;

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

	async getTextureFile(texid: number, allowAlpha: boolean) {
		let cached = this.textureCache.get(texid);
		if (cached) { return cached; }
		let file = await this.getFileById(cacheMajors.texturesDds, texid);
		let parsed = new ParsedTexture(file, allowAlpha);
		//TODO can also directly load dxt texture here!
		let texture = new THREE.CanvasTexture(await parsed.toWebgl());
		// let data = await parsed.toImageData();
		// let texture = new THREE.DataTexture(data.data, data.width, data.height);
		this.textureCache.set(texid, texture);
		return texture;
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


export async function ob3ModelToThreejsNode(scene: ThreejsSceneCache, modelfiles: Buffer[], mods: ModelModifications, animids: number[]) {
	let meshdatas = modelfiles.map(file => {
		let meshdata = parseOb3Model(file);
		meshdata.meshes = meshdata.meshes.map(q => modifyMesh(q, mods));
		return meshdata;
	});

	let mesh = await ob3ModelToThree(scene, mergeModelDatas(meshdatas), animids);
	mesh.scale.multiply(new THREE.Vector3(1, 1, -1));
	mesh.updateMatrix();
	(window as any).mesh = mesh;
	return mesh;
}


function mergeModelDatas(models: ModelData[]) {
	let r: ModelData = {
		bonecount: Math.max(...models.map(q => q.bonecount)),
		maxy: Math.max(...models.map(q => q.maxy)),
		miny: Math.max(...models.map(q => q.miny)),
		meshes: models.flatMap(q => q.meshes)
	}
	return r;
}

export async function ob3ModelToThree(scene: ThreejsSceneCache, model: ModelData, animids: number[]) {

	let mountanim: (() => MountableAnimation) | null = null;

	//bit weird since animations are not guaranteed to have compatible bones
	for (let animid of animids) {
		let seqfile = await scene.getFileById(cacheMajors.sequences, animid);

		let seq = parseSequences.read(seqfile);

		if (seq.skeletal_animation) {
			let anim = await parseSkeletalAnimation(scene, seq.skeletal_animation);
			mountanim = () => anim;
			break;
		} else if (seq.frames) {
			let frameanim = await parseAnimationSequence4(scene, seq.frames);
			mountanim = () => frameanim(model);
			break;
		}
	}

	let rootnode = (mountanim ? new SkinnedMesh() : new Object3D());

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
		if (mountanim && geo.attributes.skinIndex) { mesh = new THREE.SkinnedMesh(geo, mat); }
		else { mesh = new THREE.Mesh(geo, mat); }
		rootnode.add(mesh);
	}
	if (mountanim) {
		let mount = mountanim();
		globalThis.mount=mount;
		if (mount.rootbones && mount.rootbones.length != 0) { rootnode.add(...mount.rootbones); }
		rootnode.traverse(node => {
			if (node instanceof SkinnedMesh) {
				// node.bindMode = "detached";
				node.bind(mount.skeleton, new Matrix4());
			}
		});
		(rootnode as SkinnedMesh).bind(mount.skeleton);
		rootnode.animations = [mount.clip];
	}
	return rootnode;
}
