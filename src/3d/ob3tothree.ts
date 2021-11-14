import { JMat, JMatInternal } from "./jmat";
import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { GLTFBuilder } from "./gltf";
import { GlTf, MeshPrimitive, Material } from "./gltftype";
import { cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { glTypeIds, ModelAttribute, streamChunk, vartypeEnum, buildAttributeBuffer, AttributeSoure } from "./gltfutil";

//yay, three is now using modules so i can no longer use modules myself.....
//requirejs cant load modules since all modules are now promises (in case they want
//to use top level await).
const THREE = require("three/build/three.js") as typeof import("three");
//i have to also put it in the global scope for the other libs...
global.THREE = THREE;

import { GLTFSceneCache, ModelData, ModelMeshData, FileGetter, parseOb3Model, getMaterialData } from '../3d/ob3togltf';
import { boundMethod } from 'autobind-decorator';
import * as fs from "fs";

export function augmentThreeJsFloorMaterial(mat: THREE.Material) {
	mat.customProgramCacheKey = () => "floortex";
	mat.onBeforeCompile = (shader, renderer) => {
		shader.vertexShader =
			`#ifdef USE_MAP\n`
			+ `attribute vec4 _ra_floortex_uv01;\n`
			+ `attribute vec4 _ra_floortex_uv23;\n`
			+ `attribute vec4 _ra_floortex_weights;\n`
			+ `varying vec4 v_ra_floortex_01;\n`
			+ `varying vec4 v_ra_floortex_23;\n`
			+ `varying vec4 v_ra_floortex_weights;\n`
			+ `#endif\n`
			+ shader.vertexShader.replace("#include <uv_vertex>",
				`#ifdef USE_MAP\n`
				+ `v_ra_floortex_01 = _ra_floortex_uv01;\n`
				+ `v_ra_floortex_23 = _ra_floortex_uv23;\n`
				+ `v_ra_floortex_weights = _ra_floortex_weights;\n`
				+ `#endif\n`
				+ "#include <uv_vertex>"
			);
		shader.fragmentShader =
			`#ifdef USE_MAP\n`
			+ `varying vec4 v_ra_floortex_01;\n`
			+ `varying vec4 v_ra_floortex_23;\n`
			+ `varying vec4 v_ra_floortex_weights;\n`
			+ `#endif\n`
			+ shader.fragmentShader.replace("#include <map_fragment>",
				`#ifdef USE_MAP\n`
				+ `vec4 texelColor = \n`
				+ `   texture2D( map, v_ra_floortex_01.rg ) * v_ra_floortex_weights.r\n`
				+ ` + texture2D( map, v_ra_floortex_01.ba ) * v_ra_floortex_weights.g\n`
				+ ` + texture2D( map, v_ra_floortex_23.rg ) * v_ra_floortex_weights.b\n`
				+ ` + texture2D( map, v_ra_floortex_23.ba ) * v_ra_floortex_weights.a;\n`
				//TODO is this needed?
				+ `texelColor = mapTexelToLinear( mix(vec4(1.0),texelColor,dot(vec4(1),v_ra_floortex_weights)) );\n`
				+ `#endif\n`
				+ `diffuseColor *= texelColor;\n`
			);
	}
}


export class ThreejsSceneCache {
	getFileById: FileGetter;
	textureCache = new Map<number, THREE.Texture>();
	gltfMaterialCache = new Map<number, Promise<THREE.Material>>();

	constructor(getfilebyid: FileGetter) {
		this.getFileById = getfilebyid;
	}

	async getTextureFile(texid: number) {
		let cached = this.textureCache.get(texid);
		if (cached) { return cached; }

		let file = await this.getFileById(cacheMajors.texturesDds, texid);
		let parsed = new ParsedTexture(file);
		//TODO can also directly load dxt texture here!
		let texture = new THREE.CanvasTexture(await parsed.toWebgl());
		this.textureCache.set(texid, texture);
		return texture;
	}

	async getMaterial(matid: number, hasVertexAlpha: boolean) {
		//TODO the material should have this data, not the mesh
		let matcacheid = matid | (hasVertexAlpha ? 0x800000 : 0);
		let cached = this.gltfMaterialCache.get(matcacheid);
		if (!cached) {
			cached = (async () => {
				let { textures } = await getMaterialData(this.getFileById, matid);

				let mat = new THREE.MeshPhongMaterial();
				mat.transparent = hasVertexAlpha;

				if (textures.diffuse) {
					mat.map = await this.getTextureFile(textures.diffuse);
				}
				if (textures.normal) {
					mat.normalMap = await this.getTextureFile(textures.normal);
				}
				mat.vertexColors = true;
				mat.shininess = 0;
				return mat;
			})();
			this.gltfMaterialCache.set(matcacheid, cached);
		}
		return cached;
	}
}



export async function ob3ModelToThreejsNode(getFile: FileGetter, model: Buffer, mods: ModelModifications) {
	let scene = new ThreejsSceneCache(getFile);
	let stream = new Stream(model);
	let mesh = await addOb3Model(scene, parseOb3Model(stream, mods));
	mesh.scale.multiply(new THREE.Vector3(1, 1, -1));
	mesh.updateMatrix();
	return mesh;
}


export async function addOb3Model(scene: ThreejsSceneCache, model: ModelData) {
	let rootnode = new THREE.Object3D();
	for (let meshdata of model.meshes) {
		let attrs = meshdata.attributes;
		let geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(attrs.pos.source, attrs.pos.vecsize, false));
		if (attrs.color) { geo.setAttribute("color", new THREE.BufferAttribute(attrs.color.source, attrs.color.vecsize, true)); }
		if (attrs.normals) { geo.setAttribute("normal", new THREE.BufferAttribute(attrs.normals.source, attrs.normals.vecsize, false)); }
		if (attrs.texuvs) { geo.setAttribute("uv", new THREE.BufferAttribute(attrs.texuvs.source, attrs.texuvs.vecsize, false)); }

		geo.index = new THREE.BufferAttribute(meshdata.indices, 1, false);

		let mat = await scene.getMaterial(meshdata.materialId, meshdata.hasVertexAlpha);

		let mesh = new THREE.Mesh(geo, mat);

		rootnode.add(mesh);
	}
	return rootnode;
}
