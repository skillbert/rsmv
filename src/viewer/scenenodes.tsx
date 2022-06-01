import * as THREE from "three";

import { augmentThreeJsFloorMaterial, ob3ModelToThreejsNode, ThreejsSceneCache, mergeModelDatas, ob3ModelToThree } from '../3d/ob3tothree';
import { ModelModifications, FlatImageData } from '../3d/utils';
import { boundMethod } from 'autobind-decorator';

import { CacheFileSource } from '../cache';
import { ModelExtras, MeshTileInfo, ClickableMesh, resolveMorphedObject, modifyMesh, MapRect, ParsemapOpts, parseMapsquare, mapsquareModels, mapsquareToThree, mapsquareToThreeSingle, ChunkData, TileGrid } from '../3d/mapsquare';
import { AnimationClip, AnimationMixer, Bone, Clock, Material, Matrix4, Mesh, Object3D, Skeleton, SkeletonHelper, SkinnedMesh, Vector3 } from "three";
import { MountableAnimation, mountBakedSkeleton, parseAnimationSequence4 } from "../3d/animationframes";
import { parseAnimgroupConfigs, parseEnvironments, parseItem, parseNpc, parseObject, parseSequences, parseSpotAnims } from "../opdecoder";
import { cacheConfigPages, cacheMajors } from "../constants";
import * as React from "react";
import * as ReactDOM from "react-dom";
import classNames from "classnames";
import { ParsedTexture } from "../3d/textures";
import { appearanceUrl, avatarStringToBytes, avatarToModel } from "../3d/avatar";
import { ThreeJsRenderer, ThreeJsRendererEvents, highlightModelGroup } from "./threejsrender";
import { ModelData, parseOb3Model } from "../3d/ob3togltf";
import { mountSkeletalSkeleton, parseSkeletalAnimation } from "../3d/animationskeletal";
import { TypedEmitter } from "../3d/utils";
import { objects } from "../../generated/objects";
import { items } from "../../generated/items";
import { materials } from "../../generated/materials";
import { npcs } from "../../generated/npcs";
import { spotanims } from "../../generated/spotanims";
import { animgroupconfigs } from "../../generated/animgroupconfigs";
import prettyJson from "json-stringify-pretty-compact";
import { svgfloor } from "../map/svgrender";
import { stringToMapArea } from "../cliparser";

type LookupMode = "model" | "item" | "npc" | "object" | "material" | "map" | "avatar" | "spotanim" | "scenario";



export class ModelBrowser extends React.Component<{ render: ThreeJsRenderer, cache: ThreejsSceneCache }, { search: string, hist: string[], mode: LookupMode }> {
	constructor(p) {
		super(p);
		this.state = {
			hist: [],
			mode: localStorage.rsmv_lastmode ?? "model",
			search: localStorage.rsmv_lastsearch ?? "0"
		};
	}

	// @boundMethod
	// async exportModel() {
	// 	let savehandle = await showSaveFilePicker({
	// 		id: "savegltf",
	// 		startIn: "downloads",
	// 		suggestedName: "model.glb",
	// 		types: [
	// 			{ description: 'GLTF model', accept: { 'application/gltfl': ['.glb', '.gltf'] } },
	// 		]
	// 	});
	// 	let modelexprt = await this.props.render.export("gltf");
	// 	let str = await savehandle.createWritable();
	// 	await str.write(modelexprt);
	// 	await str.close();
	// 	// let dir = await showDirectoryPicker({
	// 	// 	id: "savegltf",
	// 	// 	startIn: "downloads",
	// 	// 	suggestedName: "model.gltf",
	// 	// 	types: [
	// 	// 		{ description: 'GLTF model', accept: { 'application/gltfl': ['.glb', '.gltf'] } },
	// 	// 	]
	// 	// });
	// 	// let modelfiles = await (this.renderer as any).export();
	// 	// console.log(modelfiles);
	// 	// let mainfile = await dir.getFileHandle("model.dae", { create: true });
	// 	// let str = await mainfile.createWritable();
	// 	// await str.write(modelfiles.data).then(() => str.close());

	// 	// await Promise.all(modelfiles.textures.map(async tex => {
	// 	// 	let file = await dir.getFileHandle(tex.name + "." + tex.ext, { create: true });
	// 	// 	let str = await file.createWritable();
	// 	// 	await str.write(tex.data);
	// 	// 	await str.close();
	// 	// }));
	// }

	setMode(mode: LookupMode) {
		localStorage.rsmv_lastmode = mode;
		this.setState({ mode, search: "" });
	}

	render() {
		let ModeComp = LookupModeComponentMap[this.state.mode];
		return (
			<React.Fragment>
				<div className="sidebar-browser-tab-strip">
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "item" })} onClick={() => this.setMode("item")}>Items IDs</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "npc" })} onClick={() => this.setMode("npc")}>NPCs IDs</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "object" })} onClick={() => this.setMode("object")}>Obj/Locs IDs</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "avatar" })} onClick={() => this.setMode("avatar")}>Avatar</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "model" })} onClick={() => this.setMode("model")}>Model IDs</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "map" })} onClick={() => this.setMode("map")}>Map</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "material" })} onClick={() => this.setMode("material")}>Material IDs</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "spotanim" })} onClick={() => this.setMode("spotanim")}>Spotanims</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "scenario" })} onClick={() => this.setMode("scenario")}>Scenario</div>
				</div>
				<ModeComp cache={this.props.cache} scene={this.props.render} initialId={this.state.search} />
			</React.Fragment>
		);
	}
}

export function IdInput({ initialid, onChange }: { initialid?: number, onChange: (id: number) => void }) {
	let [id, setId] = React.useState(initialid ?? 0);

	let incr = () => { setId(id + 1); onChange(id + 1); };
	let decr = () => { setId(id - 1); onChange(id - 1); };
	let submit = (e: React.FormEvent) => { onChange(id); e.preventDefault(); };
	return (
		<form className="sidebar-browser-search-bar" onSubmit={submit}>
			<input type="button" style={{ width: "25px", height: "25px" }} onClick={decr} value="" className="sub-btn sub-btn-minus" />
			<input type="button" style={{ width: "25px", height: "25px" }} onClick={incr} value="" className="sub-btn sub-btn-plus" />
			<input type="text" className="sidebar-browser-search-bar-input" value={id} onChange={e => setId(+e.currentTarget.value)} />
			<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn sub-btn-search" />
		</form>
	)
}
export function StringInput({ initialid, onChange }: { initialid?: string, onChange: (id: string) => void }) {
	let [id, setId] = React.useState(initialid ?? "");

	let submit = (e: React.FormEvent) => { onChange(id); e.preventDefault(); };
	return (
		<form className="sidebar-browser-search-bar" onSubmit={submit}>
			<input type="text" className="sidebar-browser-search-bar-input" value={id} onChange={e => setId(e.currentTarget.value)} />
			<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn sub-btn-search" />
		</form>
	)
}

export type SimpleModelDef = { modelid: number, mods: ModelModifications }[];

export class RSModel extends TypedEmitter<{ loaded: undefined }>{
	model: Promise<{ modeldata: ModelData, mesh: Object3D, nullAnim: AnimationClip }>;
	loaded: { modeldata: ModelData, mesh: Object3D, nullAnim: AnimationClip } | null = null;
	cache: ThreejsSceneCache;
	rootnode = new THREE.Group();
	nullAnimLoaded: (clip: AnimationClip) => void;
	anims: Record<number, { clip: AnimationClip | null, prom: Promise<AnimationClip> }> = {
		"-1": { clip: null, prom: new Promise(d => this.nullAnimLoaded = d) }
	};
	mountedanim: AnimationClip | null = null;
	mixer = new AnimationMixer(this.rootnode);
	renderscene: ThreeJsRenderer | null = null;
	targetAnimId = -1;
	skeletontype: "none" | "baked" | "full" = "none";
	skeletonHelper: SkeletonHelper | null = null;


	cleanup() {
		this.listeners = {};
		this.rootnode.removeFromParent();
		this.skeletonHelper?.removeFromParent();
		if (this.renderscene) {
			this.renderscene.animationMixers.delete(this.mixer);
		}
		this.renderscene = null;
	}

	addToScene(scene: ThreeJsRenderer, node = scene.modelnode) {
		this.renderscene = scene;
		scene.animationMixers.add(this.mixer);
		node.add(this.rootnode);
		if (this.skeletonHelper) { node.add(this.skeletonHelper); }
		scene.forceFrame();
	}

	onModelLoaded() {
		this.emit("loaded", undefined);
		this.renderscene?.forceFrame();
		this.renderscene?.setCameraLimits();
	}

	constructor(models: SimpleModelDef, cache: ThreejsSceneCache) {
		super();
		this.cache = cache;
		this.model = (async () => {
			let meshdatas = await Promise.all(models.map(async modelinit => {
				let file = await this.cache.getFileById(cacheMajors.models, modelinit.modelid);
				let meshdata = parseOb3Model(file);
				meshdata.meshes = meshdata.meshes.map(q => modifyMesh(q, modelinit.mods));
				return meshdata;
			}));
			let modeldata = mergeModelDatas(meshdatas);
			let mesh = await ob3ModelToThree(this.cache, modeldata);

			let nullbones: Object3D[] = [];
			for (let i = 0; i < modeldata.bonecount; i++) { nullbones.push(mesh); }
			let nullskel = new Skeleton(nullbones as any)
			mesh.traverse(node => {
				if (node instanceof SkinnedMesh) {
					node.bind(nullskel);
				}
			});
			let nullAnim = new AnimationClip(undefined, undefined, []);
			this.nullAnimLoaded(nullAnim);
			this.anims[-1].clip = nullAnim;

			this.rootnode.add(mesh);
			this.loaded = { mesh, modeldata, nullAnim };
			if (this.targetAnimId == -1) { this.setAnimation(-1); }
			this.onModelLoaded();
			return this.loaded;
		})();
	}

	private mountAnim(clip: AnimationClip) {
		if (!this.loaded) { throw new Error("attempting to mount anim before model is loaded"); }
		if (this.mountedanim == clip) { return; }
		if (this.loaded.modeldata.bonecount == 0) { return; }
		let mesh = this.loaded.mesh;
		if (mesh.animations.indexOf(clip) == -1) { mesh.animations.push(clip); }
		this.mixer.stopAllAction();
		let action = this.mixer.clipAction(clip, mesh);
		action.play();
		this.skeletonHelper = new SkeletonHelper(mesh);
		this.renderscene?.scene.add(this.skeletonHelper);
		this.mountedanim = clip;
	}

	loadAnimation(animid: number) {
		if (this.anims[animid]) { return this.anims[animid]; }
		this.anims[animid] = {
			clip: null,
			prom: (async () => {
				let seqfile = await this.cache.getFileById(cacheMajors.sequences, animid);

				let seq = parseSequences.read(seqfile);

				let clip: AnimationClip;
				if (seq.skeletal_animation) {
					let anim = await parseSkeletalAnimation(this.cache, seq.skeletal_animation);
					clip = anim.clip;
					let loaded = this.loaded ?? await this.model;
					if (this.skeletontype != "full") {
						if (this.skeletontype != "none") { throw new Error("wrong skeleton type already mounted to model"); }
						await mountSkeletalSkeleton(loaded.mesh, this.cache, anim.framebaseid);
						this.skeletontype = "full";
					}
				} else if (seq.frames) {
					let frameanim = await parseAnimationSequence4(this.cache, seq.frames);
					let loaded = this.loaded ?? await this.model;
					if (this.skeletontype != "baked") {
						if (this.skeletontype != "none") { throw new Error("wrong skeleton type already mounted to model"); }
						mountBakedSkeleton(loaded.mesh, loaded.modeldata);
						this.skeletontype = "baked";
					}
					clip = frameanim(loaded.modeldata);
				} else {
					throw new Error("animation has no frames");
				}
				this.anims[animid] = { clip, prom: Promise.resolve(clip) };

				if (!this.loaded?.modeldata) { await this.model; }
				this.anims[animid].clip = clip;
				return clip;
			})()
		}
		return this.anims[animid];
	}

	async setAnimation(animid: number) {
		this.targetAnimId = animid;
		const mount = this.loadAnimation(animid);
		return this.mountAnim(mount.clip ?? await mount.prom);
	}
}


export class RSMapChunk extends TypedEmitter<{ loaded: undefined }>{
	model: Promise<{ grid: TileGrid, chunks: ChunkData[], chunkmodels: Object3D[], groups: Set<string> }>;
	loaded: { grid: TileGrid, chunks: ChunkData[], chunkmodels: Object3D[], groups: Set<string> } | null = null;
	cache: ThreejsSceneCache;
	rootnode = new THREE.Group();
	mixer = new AnimationMixer(this.rootnode);
	renderscene: ThreeJsRenderer | null = null;
	toggles: Record<string, boolean> = {};
	rect: MapRect;

	cleanup() {
		this.listeners = {};
		this.rootnode.removeFromParent();
		if (this.renderscene) {
			this.renderscene.animationMixers.delete(this.mixer);
		}

		//only clear vertex memory for now, materials might be reused and are up to the scenecache
		this.model.then(q => q.chunkmodels.forEach(node => {
			node.traverse(obj => {
				if (obj instanceof Mesh) { obj.geometry.dispose(); }
			});
		}))
		this.renderscene = null;
	}

	async renderSvg(level = 0, wallsonly = false, pxpersquare = 1) {
		let { chunks, grid } = await this.model;
		let rect: MapRect = { x: this.rect.x * 64, z: this.rect.z * 64, xsize: this.rect.xsize * 64, zsize: this.rect.zsize * 64 };
		return svgfloor(this.cache.cache, grid, chunks.flatMap(q => q.locs), rect, level, pxpersquare, wallsonly);
	}

	addToScene(scene: ThreeJsRenderer, node = scene.modelnode) {
		this.renderscene = scene;
		scene.animationMixers.add(this.mixer);
		node.add(this.rootnode);
		scene.forceFrame();
	}

	onModelLoaded() {
		this.setToggles(this.toggles);
		this.emit("loaded", undefined);
		this.renderscene?.forceFrame();
		this.renderscene?.setCameraLimits();
	}

	setToggles(toggles: Record<string, boolean>) {
		this.toggles = toggles;
		this.rootnode.traverse(node => {
			if (node.userData.modelgroup) {
				let newvis = toggles[node.userData.modelgroup] ?? true;
				node.traverse(child => {
					if (child instanceof THREE.Mesh) { child.visible = newvis; }
				});
			}
		});
	}

	constructor(rect: MapRect, cache: ThreejsSceneCache, extraopts?: ParsemapOpts) {
		super();
		this.rect = rect;
		this.cache = cache;
		this.model = (async () => {
			//TODO enable centered again
			let opts: ParsemapOpts = { centered: true, invisibleLayers: true, collision: true, padfloor: true, ...extraopts };
			let { grid, chunks } = await parseMapsquare(cache.cache, rect, opts);
			let modeldata = await mapsquareModels(cache.cache, grid, chunks, opts);

			let chunkmodels = await Promise.all(modeldata.map(q => mapsquareToThreeSingle(this.cache, grid, q)));

			if (chunkmodels.length != 0) {
				this.rootnode.add(...chunkmodels);
			}

			let groups = new Set<string>();
			this.rootnode.traverse(node => {
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

			this.loaded = { grid, chunks, chunkmodels, groups };
			this.onModelLoaded();
			return this.loaded;
		})();
	}
}

type ScenarioComponent = {
	modelkey: string,//`${"model" | "spotanim" | "npc" | "player"}:${string}`;
	modelinit: SimpleModelDef,
	anims: { startTime: number, animid: number }[]
}


class InputCommitted extends React.Component<React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>>{
	el: HTMLInputElement | null = null;
	@boundMethod
	onChange(e: Event) {
		this.props.onChange?.(e as any);
	}

	@boundMethod
	ref(el: HTMLInputElement | null) {
		if (this.el) {
			this.el.removeEventListener("change", this.onChange);
		}
		if (el) {
			el.addEventListener("change", this.onChange);
			this.el = el;
		}
	}

	render() {
		let newp = { ...this.props, onChange: undefined, value: undefined, defaultValue: this.props.value };
		return <input ref={this.ref} {...newp} />;
	}
}

function ScenarioAnimControl(p: { anim: ScenarioComponent["anims"][number], onChange: (v: ScenarioComponent["anims"][number] | null) => void }) {
	return (
		<form>
			<InputCommitted type="number" value={p.anim.animid} onChange={e => p.onChange({ ...p.anim, animid: +e.currentTarget.value })} />
			<InputCommitted type="number" value={p.anim.startTime} onChange={e => p.onChange({ ...p.anim, startTime: +e.currentTarget.value })} />
			<div onClick={() => p.onChange(null)}>delete</div>
		</form>
	);
}

function ScenarioControl(p: { comp: ScenarioComponent, onChange: (v: ScenarioComponent | null) => void }) {
	return (
		<div>
			<div>{p.comp.modelkey}</div>
			{p.comp.anims.map((anim, i) => {
				let onchange = (v: ScenarioComponent["anims"][number] | null) => {
					let newanims = p.comp.anims.slice();
					if (v) { newanims[i] = v; }
					else { newanims.splice(i, 1); }
					p.onChange({ ...p.comp, anims: newanims });
				};
				return <ScenarioAnimControl key={i} anim={anim} onChange={onchange} />
			})}
			<div onClick={e => p.onChange({ ...p.comp, anims: [...p.comp.anims, { animid: -1, startTime: 0 }] })}>add anim</div>
			<div onClick={e => p.onChange(null)}>delete</div>
		</div>
	)
}

export class SceneScenario extends React.Component<{ scene: ThreeJsRenderer, cache: ThreejsSceneCache, initialId: string }, { components: ScenarioComponent[], addType: keyof typeof primitiveModelInits }>{

	models = new Map<ScenarioComponent, RSModel>();

	constructor(p) {
		super(p);
		this.state = {
			components: [],
			addType: "model"
		};
	}

	componentWillUnmount() {
		for (let model of this.models.values()) { model.cleanup(); }
	}

	@boundMethod
	async addComp(id: string) {
		let prim: { models: SimpleModelDef, animids: number[] };
		if (this.state.addType == "player") {
			prim = await playerToModel(this.props.cache, id);
		} else {
			let conv = primitiveModelInits[this.state.addType];
			prim = await conv(this.props.cache, +id);
		}
		this.editComp(this.state.components.length, {
			modelkey: `${this.state.addType}:${id}`,
			modelinit: prim.models,
			anims: prim.animids.map(q => ({ startTime: 0, animid: q }))
		});
	}

	editComp(index: number, newcomp: ScenarioComponent | null) {
		let components = this.state.components.slice();
		let oldcomp = components[index];
		let model = this.models.get(oldcomp);
		if (oldcomp?.modelkey != newcomp?.modelkey) {
			if (model) {
				model.cleanup();
				model = undefined;
			}
			if (newcomp) {
				model = new RSModel(newcomp?.modelinit, this.props.cache);
				model.addToScene(this.props.scene);
				for (let anim of newcomp.anims) {
					model.loadAnimation(anim.animid);
				}
			}
		}
		this.models.delete(oldcomp);
		if (model && newcomp) {
			this.models.set(newcomp, model);
			if (newcomp.anims.length != 0) { model.setAnimation(newcomp.anims[0].animid); }
		}
		if (newcomp) { components[index] = newcomp; }
		else { components.splice(index, 1); }
		this.setState({ components });
		this.restartAnims();
	}

	@boundMethod
	restartAnims() {
		for (let model of this.models.values()) {
			model.mixer.setTime(0);
		}
	}

	render() {
		return (
			<React.Fragment>
				<div>
					<select value={this.state.addType} onChange={e => this.setState({ addType: e.currentTarget.value as any })}>
						<option value="model">model</option>
						<option value="npc">npc</option>
						<option value="spotanim">spotanim</option>
						<option value="loc">location</option>
						<option value="player">player</option>
					</select>
					<StringInput onChange={this.addComp} />
				</div>
				{this.state.components.map((comp, i) => {
					return <ScenarioControl key={i} comp={comp} onChange={e => this.editComp(i, e)} />;
				})}
				<div onClick={this.restartAnims}>restart</div>
			</React.Fragment>
		)
	}
}

const primitiveModelInits = {
	npc: npcToModel,
	player: playerToModel,
	spotanim: spotAnimToModel,
	model: modelToModel,
	loc: locToModel
}

async function modelToModel(cache: ThreejsSceneCache, id: number) {
	return { models: [{ modelid: id, mods: {} }], animids: [] };
}

async function playerToModel(cache: ThreejsSceneCache, name: string) {
	let url = appearanceUrl(name);
	let data = await fetch(url).then(q => q.text());
	if (data.indexOf("404 - Page not found") != -1) { throw new Error("player avatar not found"); }
	let avainfo = await avatarToModel(cache, avatarStringToBytes(data));
	return avainfo;
}

async function npcToModel(cache: ThreejsSceneCache, id: number) {
	let npc = parseNpc.read(await cache.getFileById(cacheMajors.npcs, id));
	let anims: number[] = [];
	let modelids = npc.models ?? [];
	if (npc.animation_group) {
		let arch = await cache.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
		let animgroup = parseAnimgroupConfigs.read(arch[npc.animation_group].buffer);
		let forcedanim = globalThis.forcedanim;
		anims.push(forcedanim ?? animgroup.idleVariations?.[0]?.animid ?? animgroup.baseAnims?.idle);
	}
	let mods: ModelModifications = {};
	if (npc.color_replacements) { mods.replaceColors = npc.color_replacements; }
	if (npc.material_replacements) { mods.replaceMaterials = npc.material_replacements; }
	let models = modelids.map(q => ({ modelid: q, mods }));
	return { npc, models, animids: anims };
}

async function spotAnimToModel(cache: ThreejsSceneCache, id: number) {
	let animdata = parseSpotAnims.read(await cache.getFileById(cacheMajors.spotanims, id));
	let mods: ModelModifications = {};
	if (animdata.replace_colors) { mods.replaceColors = animdata.replace_colors; }
	if (animdata.replace_materials) { mods.replaceMaterials = animdata.replace_materials; }
	let models = (animdata.model ? [{ modelid: animdata.model, mods }] : []);
	return { models, animids: (animdata.sequence ? [animdata.sequence] : []), animdata };
}

async function locToModel(cache: ThreejsSceneCache, id: number) {
	let obj = await resolveMorphedObject(cache.source, id);
	let mods: ModelModifications = {};
	let animids: number[] = [];
	let models: SimpleModelDef = [];
	if (obj) {
		if (obj.color_replacements) { mods.replaceColors = obj.color_replacements; }
		if (obj.material_replacements) { mods.replaceMaterials = obj.material_replacements; }
		models = obj.models?.flatMap(m => m.values).map(q => ({ modelid: q, mods })) ?? [];
	}
	if (obj?.probably_animation) {
		animids = [obj.probably_animation];
	}
	return { models, animids, loc: obj };
}

export class ScenePlayer extends React.Component<{ scene: ThreeJsRenderer, cache: ThreejsSceneCache, initialId: string }, { avaitems: items[] | null, animset: animgroupconfigs | null }> {
	model: RSModel | null = null;
	modelid = "";

	constructor(p) {
		super(p);
		this.state = {
			avaitems: null,
			animset: null
		};
	}

	componentWillUnmount() {
		this.setModel("");
	}

	@boundMethod
	async setModel(modelid: string) {
		localStorage.rsmv_lastsearch = modelid;
		if (this.model && this.modelid != modelid) {
			this.model.cleanup();
		}
		if (this.modelid != modelid) {
			let items: items[] = [];
			let animset: animgroupconfigs | null = null;
			if (modelid != "") {
				let avainfo = await playerToModel(this.props.cache, modelid);
				items = avainfo.items;
				animset = avainfo.animset;
				this.model = new RSModel(avainfo.models, this.props.cache);
				this.model.setAnimation(avainfo.animids[0] ?? -1);
				this.model.addToScene(this.props.scene);
			}
			this.modelid = modelid;
			this.setState({ avaitems: items, animset });
		}
	}

	render() {
		return (
			<React.Fragment>
				<StringInput onChange={this.setModel} initialid={this.props.initialId} />
				{this.state.avaitems?.map((item, index) => {
					return <div key={index}>{item.name ?? "no name"}</div>
				})}
				<JsonDisplay obj={this.state.animset} />
			</React.Fragment>
		)
	}
}

function JsonDisplay(p: { obj: any }) {
	return (<pre className="json-block">{prettyJson(p.obj)}</pre>);
}

export class SceneRawModel extends React.Component<{ scene: ThreeJsRenderer, cache: ThreejsSceneCache, initialId: string }> {
	model: RSModel | null = null;
	modelid: number = -1;

	componentWillUnmount() {
		this.setModel(-1);
	}

	@boundMethod
	setModel(modelid: number) {
		localStorage.rsmv_lastsearch = modelid;
		if (this.model && this.modelid != modelid) {
			this.model.cleanup();
		}
		if (this.modelid != modelid) {
			if (modelid != -1) {
				this.model = new RSModel([{ modelid: modelid, mods: {} }], this.props.cache);
				this.model.addToScene(this.props.scene);
			}
			this.modelid = modelid;
		}
	}

	render() {
		return (
			<React.Fragment>
				<IdInput onChange={this.setModel} initialid={+this.props.initialId} />
			</React.Fragment>
		)
	}
}

export class SceneMaterial extends React.Component<{ scene: ThreeJsRenderer, cache: ThreejsSceneCache, initialId: string }, { matdata: materials | null }> {
	model: RSModel | null = null;
	modelid: number = -1;

	constructor(p) {
		super(p);
		this.state = {
			matdata: null
		};
	}

	componentWillUnmount() {
		this.setModel(-1);
	}

	@boundMethod
	async setModel(modelid: number) {
		localStorage.rsmv_lastsearch = modelid;
		if (this.model && this.modelid != modelid) {
			this.model.cleanup();
		}
		if (this.modelid != modelid) {
			let matdata: materials | null = null;
			if (modelid != -1) {
				let assetid = 93776;//"RuneTek_Asset" jagex test model
				let mods: ModelModifications = {
					replaceMaterials: [[4314, modelid]]
				};
				// modelids = [67768];//is a cube but has transparent vertices
				// mods.replaceMaterials = [
				// 	[8868, +searchid]
				// ];
				let mat = this.props.cache.cache.getMaterialData(modelid);
				let info: any = { mat };
				let addtex = async (name: string, texid: number) => {
					let file = await this.props.cache.source.getFile(cacheMajors.texturesDds, texid);
					let parsed = new ParsedTexture(file, false);
					//bit of a waste to get decode the whole thing just to get meta data, but w/e
					let img0 = await parsed.toImageData(0);
					info[name] = { texid, filesize: file.length, width: img0.width, height: img0.height };
				}
				for (let tex in mat.textures) {
					if (mat.textures[tex] != 0) {
						await addtex(tex, mat.textures[tex]);
					}
				}
				this.model = new RSModel([{ modelid: assetid, mods }], this.props.cache);
				this.model.addToScene(this.props.scene);
			}
			this.setState({ matdata });
			this.modelid = modelid;
		}
	}

	render() {
		return (
			<React.Fragment>
				<IdInput onChange={this.setModel} initialid={+this.props.initialId} />
				<JsonDisplay obj={this.state.matdata} />
			</React.Fragment>
		)
	}
}

export class SceneLocation extends React.Component<{ scene: ThreeJsRenderer, cache: ThreejsSceneCache, initialId: string }, { locdata: objects | null }> {
	model: RSModel | null = null;
	modelid: number = -1;

	constructor(p) {
		super(p);
		this.state = {
			locdata: null
		};
	}

	componentWillUnmount() {
		this.setModel(-1);
	}

	@boundMethod
	async setModel(modelid: number) {
		localStorage.rsmv_lastsearch = modelid;
		if (this.model && this.modelid != modelid) {
			this.model.cleanup();
		}
		if (this.modelid != modelid) {
			let obj: objects | null = null;
			if (modelid != -1) {
				let data = await locToModel(this.props.cache, modelid);
				obj = data.loc;
				this.model = new RSModel(data.models, this.props.cache);
				this.model.setAnimation(data.animids[0] ?? -1);
				this.model.addToScene(this.props.scene);
			}
			this.modelid = modelid;
			this.setState({ locdata: obj });
		}
	}

	render() {
		return (
			<React.Fragment>
				<IdInput onChange={this.setModel} initialid={+this.props.initialId} />
				<JsonDisplay obj={this.state.locdata} />
			</React.Fragment>
		)
	}
}

export class SceneItem extends React.Component<{ scene: ThreeJsRenderer, cache: ThreejsSceneCache, initialId: string }, { itemdata: items | null }> {
	model: RSModel | null = null;
	modelid: number = -1;

	constructor(p) {
		super(p);
		this.state = {
			itemdata: null
		};
	}

	componentWillUnmount() {
		this.setModel(-1);
	}

	@boundMethod
	async setModel(modelid: number) {
		localStorage.rsmv_lastsearch = modelid;
		if (this.model && this.modelid != modelid) {
			this.model.cleanup();
		}
		if (this.modelid != modelid) {
			let item: items | null = null;
			if (modelid != -1) {
				item = parseItem.read(await this.props.cache.getFileById(cacheMajors.items, modelid));
				console.log(item);
				if (!item.baseModel && item.noteTemplate) {
					item = parseItem.read(await this.props.cache.getFileById(cacheMajors.items, item.noteTemplate));
				}
				let mods: ModelModifications = {};
				if (item.color_replacements) { mods.replaceColors = item.color_replacements; }
				if (item.material_replacements) { mods.replaceMaterials = item.material_replacements; }
				this.model = new RSModel((item.baseModel ? [{ modelid: item.baseModel, mods }] : []), this.props.cache);
				this.model.addToScene(this.props.scene);
			}
			this.modelid = modelid;
			this.setState({ itemdata: item });
		}
	}

	render() {
		return (
			<React.Fragment>
				<IdInput onChange={this.setModel} initialid={+this.props.initialId} />
				<JsonDisplay obj={this.state.itemdata} />
			</React.Fragment>
		)
	}
}
export class SceneNpc extends React.Component<{ scene: ThreeJsRenderer, cache: ThreejsSceneCache, initialId: string }, { npcdata: npcs | null }> {
	model: RSModel | null = null;
	modelid: number = -1;

	constructor(p) {
		super(p);
		this.state = {
			npcdata: null
		}
	}

	componentWillUnmount() {
		this.setModel(-1);
	}

	@boundMethod
	async setModel(modelid: number) {
		localStorage.rsmv_lastsearch = modelid;
		if (this.model && this.modelid != modelid) {
			this.model.cleanup();
		}
		if (this.modelid != modelid) {
			let npc: npcs | null = null;
			if (modelid != -1) {
				let npcdata = await npcToModel(this.props.cache, modelid);
				npc = npcdata.npc;
				this.model = new RSModel(npcdata.models, this.props.cache);
				this.model.setAnimation(npcdata.animids[0] ?? -1);
				this.model.addToScene(this.props.scene);
			}
			this.modelid = modelid;
			this.setState({ npcdata: npc });
		}
	}

	render() {
		return (
			<React.Fragment>
				<IdInput onChange={this.setModel} initialid={+this.props.initialId} />
				<JsonDisplay obj={this.state.npcdata} />
			</React.Fragment>
		)
	}
}

export class SceneSpotAnim extends React.Component<{ scene: ThreeJsRenderer, cache: ThreejsSceneCache, initialId: string }, { animdata: spotanims | null }> {
	model: RSModel | null = null;
	modelid: number = -1;

	constructor(p) {
		super(p);
		this.state = {
			animdata: null
		}
	}

	componentWillUnmount() {
		this.setModel(-1);
	}

	@boundMethod
	async setModel(modelid: number) {
		localStorage.rsmv_lastsearch = modelid;
		if (this.model && this.modelid != modelid) {
			this.model.cleanup();
		}
		if (this.modelid != modelid) {
			let animdata: spotanims | null = null;
			if (modelid != -1) {
				let data = await spotAnimToModel(this.props.cache, modelid);
				animdata = data.animdata;
				this.model = new RSModel(data.models, this.props.cache);
				this.model.setAnimation(data.animids[0] ?? -1);
				this.model.addToScene(this.props.scene);
			}
			this.modelid = modelid;
			this.setState({ animdata });
		}
	}

	render() {
		return (
			<React.Fragment>
				<IdInput onChange={this.setModel} initialid={+this.props.initialId} />
				<JsonDisplay obj={this.state.animdata} />
			</React.Fragment>
		)
	}
}
type SceneMapState = {
	chunkgroups: {
		rect: MapRect,
		chunk: RSMapChunk,
		background: string
	}[],
	center: { x: number, z: number },
	toggles: Record<string, boolean>,
	selectionData: any
};
export class SceneMapModel extends React.Component<{ scene: ThreeJsRenderer, cache: ThreejsSceneCache, initialId: string }, SceneMapState> {
	oldautoframe: boolean;
	selectCleanup: (() => void)[] = [];
	constructor(p) {
		super(p);
		this.state = {
			chunkgroups: [],
			center: { x: 0, z: 0 },
			toggles: Object.create(null),
			selectionData: undefined
		}
		this.oldautoframe = this.props.scene.automaticFrames;
		this.props.scene.automaticFrames = false;
	}

	@boundMethod
	clear() {
		this.selectCleanup.forEach(q => q());
		this.props.scene.setSkybox();
		this.state.chunkgroups.forEach(q => q.chunk.cleanup());
		this.props.scene.forceFrame();
		this.setState({ chunkgroups: [], toggles: Object.create(null) });
	}

	@boundMethod
	async meshSelected(e: ThreeJsRendererEvents["select"]) {
		this.selectCleanup.forEach(q => q());
		let selectionData: any = undefined;
		if (e) {
			this.selectCleanup = highlightModelGroup(e.vertexgroups);

			//show data about what we clicked
			console.log(Array.isArray(e.obj.material) ? e.obj.material : e.obj.userData);
			let meshdata = e.meshdata;
			if (meshdata.modeltype == "locationgroup") {
				let typedmatch = e.match as typeof meshdata.subobjects[number];
				if (typedmatch.modeltype == "location") {
					selectionData = typedmatch;
				}
			}
			if (meshdata.modeltype == "floor") {
				let typedmatch = e.match as typeof meshdata.subobjects[number];
				selectionData = {
					...e.meshdata,
					x: typedmatch.x,
					z: typedmatch.z,
					subobjects: undefined,//remove (near) circular ref from json
					subranges: undefined,
					tile: { ...typedmatch.tile, next01: undefined, next10: undefined, next11: undefined }
				};
			}
		};
		this.setState({ selectionData });
		this.props.scene.forceFrame();
	}

	componentDidMount() {
		this.props.scene.on("select", this.meshSelected);
	}

	componentWillUnmount() {
		this.clear();
		this.props.scene.automaticFrames = this.oldautoframe;
		this.props.scene.off("select", this.meshSelected);
	}

	async addArea(rect: MapRect) {
		let chunk = new RSMapChunk(rect, this.props.cache);
		chunk.once("loaded", async () => {
			let mainchunk = chunk.loaded!.chunks[0];
			let skybox: Object3D | undefined = undefined;
			let fogColor = [0, 0, 0, 0];
			if (mainchunk?.extra.unk00?.unk20) {
				fogColor = mainchunk.extra.unk00.unk20.slice(1);
			}
			if (mainchunk?.extra.unk80) {
				let envarch = await this.props.cache.source.getArchiveById(cacheMajors.config, cacheConfigPages.environments);
				let envfile = envarch.find(q => q.fileid == mainchunk.extra!.unk80!.environment)!;
				let env = parseEnvironments.read(envfile.buffer);
				if (typeof env.model == "number") {
					skybox = await ob3ModelToThreejsNode(this.props.cache, [await this.props.cache.getFileById(cacheMajors.models, env.model)]);
				}
			}

			let combined = chunk.rootnode;

			let toggles = this.state.toggles;
			[...chunk.loaded!.groups].sort((a, b) => a.localeCompare(b)).forEach(q => {
				if (typeof toggles[q] != "boolean") {
					toggles[q] = !q.match(/(floorhidden|collision|walls|map|mapscenes)/);
				}
			});

			let center = this.state.center;
			combined.position.add(new Vector3(-center.x, 0, -center.z));
			chunk.addToScene(this.props.scene);
			chunk.setToggles(toggles);

			this.props.scene.setSkybox(skybox, fogColor);
			this.setState({ toggles });
		});

		let center = this.state.center;
		if (this.state.chunkgroups.length == 0) {
			center = {
				x: (rect.x + rect.xsize / 2) * 64 * 512,
				z: (rect.z + rect.zsize / 2) * 64 * 512,
			}
		}
		let chunkentry = { rect, chunk, background: "" };
		chunk.renderSvg().then(svg => {
			chunkentry.background = `url("data:image/svg+xml;base64,${btoa(svg)}")`;
			this.forceUpdate();
		});
		this.setState({
			chunkgroups: [...this.state.chunkgroups, chunkentry],
			center: center
		});
	}

	@boundMethod
	onSubmit(searchtext: string) {
		localStorage.rsmv_lastsearch = searchtext;
		let rect = stringToMapArea(searchtext);
		if (!rect) {
			//TODO some sort of warning?
			return;
		}
		this.addArea(rect);
	}

	setToggle(toggle: string, value: boolean) {
		this.setState(old => {
			let newtoggles = Object.create(null);
			for (let key in old.toggles) {
				newtoggles[key] = (key == toggle ? value : old.toggles[key]);
			}
			this.state.chunkgroups.forEach(q => q.chunk.setToggles(newtoggles));
			return { toggles: newtoggles };
		})
	}

	render() {
		this.props.scene.forceFrame();
		let toggles: Record<string, string[]> = {};
		for (let toggle of Object.keys(this.state.toggles)) {
			let m = toggle.match(/^(\D+?)(\d.*)?$/);
			if (!m) { throw new Error("???"); }
			toggles[m[1]] = toggles[m[1]] ?? [];
			toggles[m[1]].push(m[2] ?? "");
		}

		let xmin = Infinity, xmax = -Infinity;
		let zmin = Infinity, zmax = -Infinity;
		for (let chunk of this.state.chunkgroups) {
			xmin = Math.min(xmin, chunk.rect.x); xmax = Math.max(xmax, chunk.rect.x + chunk.rect.xsize);
			zmin = Math.min(zmin, chunk.rect.z); zmax = Math.max(zmax, chunk.rect.z + chunk.rect.zsize);
		}
		let xsize = xmax - xmin + 2;
		let zsize = zmax - zmin + 2;
		xmin--;
		zmin--;

		let addgrid: (JSX.Element | null)[] = [];
		for (let x = xmin; x < xmin + xsize; x++) {
			for (let z = zmin; z < zmin + zsize; z++) {
				let style: React.CSSProperties = {
					gridColumn: "" + (x - xmin + 1),
					gridRow: "" + (zmin + zsize - z),
					border: "1px solid rgba(255,255,255,0.2)"
				}
				addgrid.push(<div key={`${x}-${z}`} onClick={() => this.addArea({ x, z, xsize: 1, zsize: 1 })} style={style}></div>);
			}
		}

		return (
			<React.Fragment>
				<StringInput onChange={this.onSubmit} initialid={this.props.initialId} />
				<div className="map-grid-container">
					<div className="map-grid-root" style={{ gridTemplateColumns: `repeat(${xsize},40px)`, gridTemplateRows: `repeat(${zsize},40px)` }}>
						{this.state.chunkgroups.flatMap((chunk, i) => {
							let style: React.CSSProperties = {
								gridColumn: `${chunk.rect.x - xmin + 1}/span ${chunk.rect.xsize}`,
								gridRow: `${zsize - (chunk.rect.z - zmin) - chunk.rect.zsize + 1}/span ${chunk.rect.zsize}`
							}
							if (chunk.background) {
								style.backgroundImage = chunk.background;
							}
							for (let x = chunk.rect.x; x < chunk.rect.x + chunk.rect.xsize; x++) {
								for (let z = chunk.rect.z; z < chunk.rect.z + chunk.rect.zsize; z++) {
									addgrid[(x - xmin) * zsize + (z - zmin)] = null;
								}
							}
							return (
								<div key={i} className={classNames("map-grid-area", { "map-grid-area-loading": !chunk.chunk.loaded })} style={style}>
									{chunk.rect.xsize == 1 && chunk.rect.zsize == 1 ? "" : <React.Fragment>{chunk.rect.xsize}x{chunk.rect.zsize}<br /></React.Fragment>}
									{chunk.rect.x},{chunk.rect.z}
								</div>
							);
						})}
						{addgrid}
					</div>
				</div>
				{this.state.chunkgroups.length == 0 && (<p>Input format: x,z[,xsize=1,[zsize=xsize]]</p>)}
				{Object.entries(toggles).map(([base, subs]) => {
					let all = true;
					let none = true;
					subs.forEach(s => {
						let v = this.state.toggles[base + s];
						all &&= v;
						none &&= !v;
					})
					return (
						<div key={base}>
							<label><input type="checkbox" checked={all} onChange={e => subs.forEach(s => this.setToggle(base + s, e.currentTarget.checked))} ref={v => v && (v.indeterminate = !all && !none)} />{base}</label>
							{subs.map(sub => {
								let name = base + sub;
								let value = this.state.toggles[name];
								return (
									<label key={sub}>
										<input type="checkbox" checked={value} onChange={e => this.setToggle(name, e.currentTarget.checked)} />
										{sub}
									</label>
								);
							})}
						</div>
					)
				})}
				<input type="button" className="sub-btn" onClick={this.clear} value="Clear" />
				<JsonDisplay obj={this.state.selectionData} />
			</React.Fragment>
		)
	}
}


const LookupModeComponentMap: Record<LookupMode, { new(p: any): React.Component<{ scene: ThreeJsRenderer, cache: ThreejsSceneCache, initialId: string }, any> }> = {
	model: SceneRawModel,
	item: SceneItem,
	avatar: ScenePlayer,
	map: SceneMapModel,
	material: SceneMaterial,
	npc: SceneNpc,
	object: SceneLocation,
	spotanim: SceneSpotAnim,
	scenario: SceneScenario
}
