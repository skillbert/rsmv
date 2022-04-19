import * as THREE from "three";

import { augmentThreeJsFloorMaterial, ob3ModelToThreejsNode, ThreejsSceneCache, mergeModelDatas, ob3ModelToThree } from '../3d/ob3tothree';
import { ModelModifications, FlatImageData } from '../3d/utils';
import { boundMethod } from 'autobind-decorator';

import { ModelViewerState } from "./index";
import { CacheFileSource } from '../cache';
import { ModelExtras, MeshTileInfo, ClickableMesh, resolveMorphedObject, modifyMesh, MapRect, ParsemapOpts, parseMapsquare, mapsquareModels, mapsquareToThree } from '../3d/mapsquare';
import { AnimationClip, AnimationMixer, Bone, Clock, Material, Mesh, Object3D, Skeleton, SkeletonHelper, SkinnedMesh } from "three";
import { MountableAnimation, parseAnimationSequence4 } from "../3d/animationframes";
import { parseAnimgroupConfigs, parseEnvironments, parseItem, parseNpc, parseObject, parseSequences } from "../opdecoder";
import { cacheConfigPages, cacheMajors } from "../constants";
import * as React from "react";
import * as ReactDOM from "react-dom";
import classNames from "classnames";
import { WasmGameCacheLoader as GameCacheLoader } from "../cacheloaderwasm";
import { ParsedTexture } from "../3d/textures";
import { avatarStringToBytes, avatarToModel } from "../3d/avatar";
import { ThreeJsRenderer } from "./threejsrender";
import { ModelData, parseOb3Model } from "../3d/ob3togltf";
import { parseSkeletalAnimation } from "../3d/animationskeletal";


export class SceneComponent {
	renderer: ThreeJsRenderer;
	sceneCache: ThreejsSceneCache;

	threemodel: THREE.Object3D | null = null;

	constructor(cache: ThreejsSceneCache, renderer: ThreeJsRenderer) {
		this.sceneCache = cache;
		this.renderer = renderer;
	}

	cleaup() { }
}

export class SceneComponentRoot extends SceneComponent {
	children: SceneComponent[];


	set(child: SceneComponent) {
		this.clear();
		this.add(child);
	}

	add(child: SceneComponent) {
		this.children.push(child);
	}

	clear() {
		this.children.forEach(q => q.cleaup());
		this.children = [];
	}

	cleaup() {
		this.clear();
	}
}

export type SimpleModelDef = { modelid: number, mods: ModelModifications }[];
export type SimpleAnimDef = { animid: number, model: SimpleModelDef };

type DataPromise<ID, T> = { source: ID, promise: Promise<T>, active: boolean, cleanup: () => void, cleanupcalls: (() => void)[] };

function dataPromise<ID, T>(source: ID, promise: (selfref: DataPromise<ID, T>) => (Promise<T> | T)) {
	let r: DataPromise<ID, T> = {
		source,
		active: true,
		promise: null!,
		cleanupcalls: [() => r.active = false],
		cleanup: () => r.cleanupcalls.forEach(q => q())
	}
	r.promise = new Promise(res => res(r)).then(promise);
	return r;
}

export class SceneSimpleModel extends SceneComponent {
	model: DataPromise<SimpleModelDef, { modeldata: ModelData, mesh: Object3D }> | null = null;
	anim: DataPromise<SimpleAnimDef, {}> | null = null;

	cleaup() {
		this.anim?.cleanup();
		this.model?.cleanup();
	}

	private setModels(models: SimpleModelDef) {
		if (this.model?.source != models) {
			this.model?.cleanup();
			this.model = dataPromise(models, async (def) => {
				let meshdatas = await Promise.all(models.map(async modelinit => {
					let file = await this.sceneCache.getFileById(cacheMajors.models, modelinit.modelid);
					let meshdata = parseOb3Model(file);
					meshdata.meshes = meshdata.meshes.map(q => modifyMesh(q, modelinit.mods));
					return meshdata;
				}));
				let modeldata = mergeModelDatas(meshdatas);
				let mesh = await ob3ModelToThree(this.sceneCache, modeldata);
				mesh.scale.multiply(new THREE.Vector3(1, 1, -1));
				mesh.updateMatrix();

				if (def.active) {
					this.renderer.modelnode.add(mesh);
					def.cleanupcalls.push(() => {
						mesh.removeFromParent();
						this.renderer.forceFrame();
					});
				}
				this.renderer.setCameraLimits();
				this.renderer.forceFrame();
				return { modeldata, mesh };
			});
		}
		return this.model;
	}

	setAnimation(animdef: SimpleAnimDef) {
		let modelreq = this.setModels(animdef.model);
		if (this.anim?.source != animdef) {
			this.anim?.cleanup();
			this.anim = dataPromise(animdef, async (def) => {
				let { modeldata, mesh } = await modelreq.promise;
				let mount: MountableAnimation;
				if (def.source.animid == -1) {
					let nullbones: Bone[] = [];
					for (let i = 0; i < modeldata.bonecount; i++) { nullbones.push(new Bone()); }
					mount = {
						clip: new AnimationClip(undefined, undefined, []),
						rootbones: nullbones,
						skeleton: new Skeleton(nullbones)
					};
				} else {
					let seqfile = await this.sceneCache.getFileById(cacheMajors.sequences, animdef.animid);

					let seq = parseSequences.read(seqfile);

					if (seq.skeletal_animation) {
						mount = await parseSkeletalAnimation(this.sceneCache, seq.skeletal_animation);
					} else if (seq.frames) {
						let frameanim = await parseAnimationSequence4(this.sceneCache, seq.frames);
						mount = frameanim(modeldata);
					} else {
						throw new Error("animation has no frames");
					}
				}
				if (def.active) {
					//set bone 0 as the root node instead of an identity bone (this is needed for gltf export)
					mount.skeleton.bones[0] = mesh as any;
					globalThis.mount = mount;
					if (mount.rootbones && mount.rootbones.length != 0) { mesh.add(...mount.rootbones); }
					mesh.traverse(node => {
						if (node instanceof SkinnedMesh) {
							// node.bindMode = "detached";
							node.bind(mount.skeleton);
						}
					});
					mesh.animations = [mount.clip];
					let action = this.renderer.animationMixer.clipAction(mount.clip, mesh);
					action.play();
					let skelhelper = new SkeletonHelper(mesh);
					this.renderer.modelnode.add(skelhelper);
					def.cleanupcalls.push(() => {
						mesh.animations = [];
						globalThis.mount = null;
						skelhelper.removeFromParent()
						this.renderer.animationMixer.uncacheClip(mount.clip);
						action.stop();
						this.renderer.forceFrame();
					});
					this.renderer.forceFrame();
				}
				return {}
			});
		}
	}
}

export class SceneMapModel extends SceneComponent {

	async setArea(rect: MapRect) {
		//TODO enable centered again
		let opts: ParsemapOpts = { centered: true, invisibleLayers: true, collision: true, padfloor: false };
		let { grid, chunks } = await parseMapsquare(this.sceneCache.cache, rect, opts);
		let modeldata = await mapsquareModels(this.sceneCache.cache, grid, chunks, opts);
		let mainchunk = chunks[0];
		let skybox: Object3D | undefined = undefined;
		let fogColor = [0, 0, 0, 0];
		if (mainchunk?.extra.unk00?.unk20) {
			fogColor = mainchunk.extra.unk00.unk20.slice(1);
			// fogColor = [...HSL2RGB(packedHSL2HSL(mainchunk.extra.unk00.unk01[1])), 255];
		}
		if (mainchunk?.extra.unk80) {
			let envarch = await this.sceneCache.source.getArchiveById(cacheMajors.config, cacheConfigPages.environments);
			let envfile = envarch.find(q => q.fileid == mainchunk.extra!.unk80!.environment)!;
			let env = parseEnvironments.read(envfile.buffer);
			if (typeof env.model == "number") {
				skybox = await ob3ModelToThreejsNode(this.sceneCache, [await this.sceneCache.getFileById(cacheMajors.models, env.model)]);
			}
		}

		let combined = await mapsquareToThree(this.sceneCache, grid, modeldata);

		let groups = new Set<string>();

		combined.traverse(node => {
			if (node.userData.modelgroup) {
				groups.add(node.userData.modelgroup);
			}
			if (node instanceof THREE.Mesh) {
				let parent: THREE.Object3D | null = node;
				let iswireframe = false;
				//TODO this data should be on the mesh it concerns instead of a parent
				while (parent) {
					if (parent.userData.modeltype == "floorhidden") {
						iswireframe = true;
					}
					parent = parent.parent;
				}
				if (iswireframe && node.material instanceof THREE.MeshPhongMaterial) {
					node.material.wireframe = true;
				}
			}
		});

		let uistate = { meta: "", toggles: Object.create(null) };
		[...groups].sort((a, b) => a.localeCompare(b)).forEach(q => {
			uistate.toggles[q] = !q.match(/(floorhidden|collision|walls|map|mapscenes)/);
		});
		combined.traverse(node => {
			if (node.userData.modelgroup) {
				let newvis = uistate.toggles[node.userData.modelgroup] ?? true;
				node.traverse(child => {
					if (child instanceof THREE.Mesh) { child.visible = newvis; }
				})
			}
		});

		this.renderer.setSkybox(skybox, fogColor);
		this.renderer.modelnode.add(combined);
		this.renderer.forceFrame();
	}
}