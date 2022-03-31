import { Stream, packedHSL2HSL, HSL2RGB, ModelModifications } from "./utils";
import { cacheMajors } from "../constants";
import { ParsedTexture } from "./textures";
import { GLTFSceneCache, ModelData, ModelMeshData, FileGetter, parseOb3Model, getMaterialData } from '../3d/ob3togltf';
import { boundMethod } from 'autobind-decorator';
import { materialCacheKey } from "./jmat";
import { modifyMesh } from "./mapsquare";
import * as THREE from "three";
import { BoneInit, MountableAnimation, parseAnimationSequence3, ParsedAnimation, parseSkeletalAnimation } from "./animation";
import { CacheFileSource } from "../cache";
import { AnimationClip, Bone, Group, KeyframeTrack, Matrix4, Object3D, Quaternion, QuaternionKeyframeTrack, Skeleton, SkeletonHelper, SkinnedMesh, Vector3, VectorKeyframeTrack } from "three";
import { parseSequences } from "../opdecoder";

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
	textureCache = new Map<number, THREE.Texture>();
	gltfMaterialCache = new Map<number, Promise<THREE.Material>>();
	source: CacheFileSource;

	constructor(source: CacheFileSource) {
		this.source = source;
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
				let material = await getMaterialData(this.source, matid);

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
				mat.vertexColors = true;
				mat.map = null;

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



export async function ob3ModelToThreejsNode(source: CacheFileSource, modelfiles: Buffer[], mods: ModelModifications, animids: number[]) {
	let scene = new ThreejsSceneCache(source);
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

function mountAnimation(model: ModelData, anim: ParsedAnimation): MountableAnimation {
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


	let nframes = anim.keyframetimes.length;
	let keyframetracks: KeyframeTrack[] = [];
	let extrabonecounter = 0;
	let indexedbones: Bone[] = [];
	let missingpivots = 0;
	function iter(init: BoneInit, quaternionstack: Float32Array[]) {
		let nextquaternionstack = quaternionstack;

		let bone = new Bone();
		if (init.boneid != -1) {
			indexedbones[init.boneid] = bone;
			bone.name = "bone_" + init.boneid;
		} else {
			bone.name = "extra_" + (extrabonecounter++);
		}
		for (let tr of init.translateconst) {
			let totalweight = 0;
			let xsum = 0, ysum = 0, zsum = 0;
			for (let boneid of tr.data) {
				let center = bonecenters[boneid];
				if (!center) {
					continue;
				}
				let factor = (tr.inverse ? -1 : 1);
				xsum += center.xsum * factor;
				ysum += center.ysum * factor;
				zsum += center.zsum * factor;
				totalweight += center.weightsum;
			}
			if (totalweight != 0) {
				bone.position.set(
					bone.position.x + xsum / totalweight,
					bone.position.y + ysum / totalweight,
					bone.position.z + zsum / totalweight
				)
			} else {
				missingpivots++;
			}
		}

		if (init.translate.length != 0) {
			let track = new Float32Array(nframes * 3);
			let sum = new Vector3();
			let tmp = new Vector3();
			let quatsum = new Quaternion();
			let quattmp = new Quaternion();
			for (let i = 0; i < nframes; i++) {
				sum.set(0, 0, 0);
				quatsum.identity();
				//add all translations of this bone in the global frame
				for (let track of init.translate) {
					tmp.fromArray(track.data, i * 3);
					if (track.inverse) { sum.sub(tmp); }
					else { sum.add(tmp); }
				}
				//add all rotations on this bone
				for (let rot of quaternionstack) {
					quattmp.fromArray(rot, i * 4);
					quatsum.multiply(quattmp);
				}

				//apply inverse of rotations on this bone
				quatsum.invert();
				sum.applyQuaternion(quatsum);

				//add the translations of the bone in bone frame
				sum.add(bone.position);

				//save the baked translation
				sum.toArray(track, i * 3);
			}

			keyframetracks.push(new VectorKeyframeTrack(`${bone.name}.position`, anim.keyframetimes as any, track as any));
		}

		if (init.rotate.length != 0) {
			let track = new Float32Array(nframes * 4);
			let sum = new Quaternion();
			let tmp = new Quaternion();
			for (let i = 0; i < nframes; i++) {
				sum.identity();
				for (let track of init.rotate) {
					tmp.fromArray(track.data, i * 4);
					if (track.inverse) { tmp.invert(); }
					sum.multiply(tmp);
				}
				sum.toArray(track, i * 4);
			}

			keyframetracks.push(new QuaternionKeyframeTrack(`${bone.name}.quaternion`, anim.keyframetimes as any, track as any));

			//new quaternionstack for child bones
			nextquaternionstack = quaternionstack.concat([track]);
		}

		if (init.scale.length != 0) {
			let track = new Float32Array(nframes * 3);
			let sum = new Vector3();
			let tmp = new Vector3();
			for (let i = 0; i < nframes; i++) {
				sum.set(1, 1, 1);
				for (let track of init.scale) {
					tmp.fromArray(track.data, i * 3);
					sum.multiply(tmp);
				}
				sum.toArray(track, i * 3);
			}

			keyframetracks.push(new VectorKeyframeTrack(`${bone.name}.scale`, anim.keyframetimes as any, track as any));
		}

		if (init.children.length != 0) {
			bone.add(...init.children.map(q => iter(q, nextquaternionstack)));
		}

		return bone;
	}

	let rootangle = []
	let rootbones = anim.rootboneinits.map(b => iter(b, rootangle));

	let skeleton = new Skeleton(indexedbones);
	let clip = new AnimationClip(`sequence_${Math.random() * 1000 | 0}`, undefined, keyframetracks);

	if (missingpivots != 0) {
		console.log("missing pivots during mountanimation", missingpivots);
	}

	return { skeleton, clip, rootbones };
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
			let frameanim = await parseAnimationSequence3(scene, seq.frames);
			mountanim = () => mountAnimation(model, frameanim);
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
		if (mount.rootbones) { rootnode.add(...mount.rootbones); }
		rootnode.traverse(node => {
			if (node instanceof SkinnedMesh) {
				// node.bindMode = "detached";
				node.bind(mount.skeleton, new Matrix4());
			}
		});
		// (rootnode as SkinnedMesh).bind(mount.skeleton);
		rootnode.animations = [mount.clip];
	}
	return rootnode;
}
