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
import { parseAnimationSequence2 } from "./animation";
import { CacheFileSource } from "../cache";
import { Bone, Matrix4, Skeleton, SkeletonHelper, SkinnedMesh } from "three";

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



export async function ob3ModelToThreejsNode(getFile: CacheFileSource, modelfile: Buffer, mods: ModelModifications, anims: number[]) {
	let scene = new ThreejsSceneCache(getFile.getFileById.bind(getFile));
	let meshdata = parseOb3Model(modelfile);
	meshdata.meshes = meshdata.meshes.map(q => modifyMesh(q, mods));
	let mesh = await ob3ModelToThree(scene, meshdata);
	mesh.scale.multiply(new THREE.Vector3(1, 1, -1));
	mesh.updateMatrix();

	// mesh.animations = await Promise.all(anims.map(anim => parseAnimationSequence2(getFile, anim))) as any;
	mesh.animations = await Promise.all(anims.map(async animid => {
		let anim = await parseAnimationSequence2(getFile, animid)!;
		//remove extra tracks to suppress errors later on
		let newtracks = anim!.tracks.filter(t => {
			let m = t.name.match(/.bones\[(\d+)\]/)!;
			return +m[1] < mesh.skeleton.bones.length;
		});
		if (newtracks.length != anim!.tracks.length) {
			console.log("removed tracks from anim as there aren't enough bones:", anim!.tracks.length - newtracks.length);
		}
		anim!.tracks = newtracks;
		return anim;
	})) as any;
	return mesh;
}


function buildSkeleton(model: ModelData) {
	let nbones = model.bonecount + 1;//TODO find out why this number is wrong

	let bonecenters: { xsum: number, ysum: number, zsum: number, weightsum: number, bone: Bone, inverseBind: Matrix4 }[] = [];
	for (let i = 0; i < nbones; i++) {
		let bone = new Bone();
		bone.name = "bone_" + i;
		bonecenters.push({ xsum: 0, ysum: 0, zsum: 0, weightsum: 0, bone, inverseBind: new Matrix4() });
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

	let rootbones: Bone[] = [];
	let allbones: Bone[] = [];
	bonecenters.forEach(b => {
		let parentbone = new Bone();
		if (b.weightsum > 0) {
			parentbone.position.set(b.xsum / b.weightsum, b.ysum / b.weightsum, b.zsum / b.weightsum);
		}
		parentbone.updateMatrix();
		parentbone.updateMatrixWorld();
		parentbone.add(b.bone);
		b.bone.updateMatrixWorld();
		allbones.push(b.bone);
		rootbones.push(parentbone);
	});

	return { rootbones, skeleton: new Skeleton(allbones) };
}

export async function ob3ModelToThree(scene: ThreejsSceneCache, model: ModelData) {
	let rootnode = new SkinnedMesh();
	// let skeleton: ReturnType<typeof buildSkeleton> | null = null as any;
	let skeleton = buildSkeleton(model);
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
		mat.wireframe = true;
		let mesh: THREE.Mesh | THREE.SkinnedMesh;
		if (skeleton && meshdata.attributes.skinids) {
			mesh = new THREE.SkinnedMesh(geo, mat);
			(mesh as SkinnedMesh).bind(skeleton.skeleton);
			// rootnode.add(new SkeletonHelper(rootnode));
		} else {
			mesh = new THREE.Mesh(geo, mat);
		}
		rootnode.add(mesh);
	}
	if (skeleton && skeleton.rootbones.length != 0) {
		rootnode.add(...skeleton.rootbones);
	}
	rootnode.bind(skeleton.skeleton);
	return rootnode;
}
