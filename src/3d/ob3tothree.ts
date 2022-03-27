import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { GLTFBuilder } from "./gltf";
import { GlTf, MeshPrimitive, Material } from "./gltftype";
import { cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { glTypeIds, ModelAttribute, streamChunk, vartypeEnum, buildAttributeBuffer, AttributeSoure } from "./gltfutil";
import { GLTFSceneCache, ModelData, ModelMeshData, FileGetter, parseOb3Model, getMaterialData } from '../3d/ob3togltf';
import { boundMethod } from 'autobind-decorator';
import { materialCacheKey } from "./jmat";
import { modifyMesh } from "./mapsquare";
import * as THREE from "three";
import { parseAnimationSequence2, ParsedAnimation } from "./animation";
import { CacheFileSource } from "../cache";
import { Bone, Matrix4, Object3D, Skeleton, SkeletonHelper, SkinnedMesh } from "three";

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


export class ThreejsSceneCache {
	getFileById: FileGetter;
	textureCache = new Map<number, THREE.Texture>();
	gltfMaterialCache = new Map<number, Promise<THREE.Material>>();

	constructor(getfilebyid: FileGetter) {
		this.getFileById = getfilebyid;
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
				let material = await getMaterialData(this.getFileById, matid);

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



export async function ob3ModelToThreejsNode(getFile: CacheFileSource, modelfile: Buffer, mods: ModelModifications, animids: number[]) {
	let scene = new ThreejsSceneCache(getFile.getFileById.bind(getFile));
	let meshdata = parseOb3Model(modelfile);
	meshdata.meshes = meshdata.meshes.map(q => modifyMesh(q, mods));


	let anims = await Promise.all(animids.map(q => parseAnimationSequence2(getFile, q)));
	let mesh = await ob3ModelToThree(scene, meshdata, anims);
	mesh.scale.multiply(new THREE.Vector3(1, 1, -1));
	mesh.updateMatrix();
	(window as any).mesh = mesh;
	return mesh;
}


function mountAnimation(model: ModelData, anim: ParsedAnimation) {
	let nbones = model.bonecount + 1;//TODO find out why this number is wrong

	let bonecenters: { xsum: number, ysum: number, zsum: number, weightsum: number }[] = [];
	for (let i = 0; i < nbones; i++) {
		bonecenters.push({ xsum: 0, ysum: 0, zsum: 0, weightsum: 0 });
	}

	for (let mesh of model.meshes) {
		let ids = mesh.attributes.skinids;
		let weights = mesh.attributes.skinweights;
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


	anim.rootbones.forEach(bone => bone.traverse(bone => {
		let boneids: number[] | null = bone.userData.boneposids;
		if (boneids) {
			let x = 0, y = 0, z = 0;
			let sum = 0;
			for (let id of boneids) {
				let b = bonecenters[id];
				if (b) {
					x += b.xsum; y += b.ysum; z += b.zsum;
					sum += b.weightsum;
				}
			}
			if (sum != 0) { bone.position.set(x / sum, y / sum, z / sum); }
			else { bone.position.set(0, 0, 0); }
		}
	}));
	function traverseSweep(obj: Object3D, precall: (obj: Object3D) => void, aftercall: (obj: Object3D) => void) {
		precall(obj);
		for (let c of obj.children) { traverseSweep(c, precall, aftercall); }
		aftercall(obj);
	}
	anim.rootbones.forEach(root => {
		traverseSweep(root, bone => {
			let boneids: number[] = bone.userData.boneposids;
			if (boneids) {
				bone.position.set(0, 0, 0);
				let x = 0, y = 0, z = 0;
				let sum = 0;
				for (let id of boneids) {
					let b = bonecenters[id];
					if (b) {
						x += b.xsum; y += b.ysum; z += b.zsum;
						sum += b.weightsum
					}
				}
				if (sum != 0) { bone.position.set(x / sum, y / sum, z / sum); }
				else { bone.position.set(0, 0, 0); }
			} else if (bone.parent) {
				bone.position.copy(bone.parent.position);
			}
		}, bone => {
			if (bone.parent && bone != root) {
				bone.position.sub(bone.parent.position);
			}
			bone.updateMatrix();
			bone.updateMatrixWorld();
		})
	});
	// anim.rootbone.traverse(b => {
	// 	console.log(b.name, b.position);
	// })
}

export async function ob3ModelToThree(scene: ThreejsSceneCache, model: ModelData, anims: ParsedAnimation[]) {
	let rootnode = (anims.length == 0 ? new Object3D() : new SkinnedMesh());


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
		if (anims.length != 0) {
			mesh = new THREE.SkinnedMesh(geo, mat);
		} else {
			mesh = new THREE.Mesh(geo, mat);
		}
		rootnode.add(mesh);
	}
	if (anims.length != 0) {
		let anim = anims[0];
		mountAnimation(model, anim);
		if (anim.rootbones) { rootnode.add(...anim.rootbones); }
		rootnode.traverse(node => {
			if (node instanceof SkinnedMesh) {
				node.bind(anim!.skeleton);
			}
		});
		rootnode.animations = [anim.clip];
	}
	return rootnode;
}
