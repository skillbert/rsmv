import * as THREE from "three";

import { augmentThreeJsFloorMaterial, ThreejsSceneCache, mergeModelDatas, ob3ModelToThree, EngineCache } from '../3d/ob3tothree';
import { ModelModifications, constrainedMap, delay, packedHSL2HSL, HSL2RGB, RGB2HSL, HSL2packHSL } from '../utils';
import { boundMethod } from 'autobind-decorator';

import { CacheFileSource } from '../cache';
import { ModelExtras, MeshTileInfo, ClickableMesh, resolveMorphedObject, modifyMesh, MapRect, ParsemapOpts, parseMapsquare, mapsquareModels, mapsquareToThree, mapsquareToThreeSingle, ChunkData, TileGrid, mapsquareSkybox, squareSize, CombinedTileGrid, getTileHeight } from '../3d/mapsquare';
import { AnimationClip, AnimationMixer, Bone, Clock, Material, Matrix4, Mesh, Object3D, Skeleton, SkeletonHelper, SkinnedMesh, Vector3 } from "three";
import { MountableAnimation, mountBakedSkeleton, parseAnimationSequence4 } from "../3d/animationframes";
import { parseAnimgroupConfigs, parseEnvironments, parseItem, parseModels, parseNpc, parseObject, parseSequences, parseSpotAnims } from "../opdecoder";
import { cacheConfigPages, cacheMajors } from "../constants";
import * as React from "react";
import classNames from "classnames";
import { ParsedTexture } from "../3d/textures";
import { appearanceUrl, avatarStringToBytes, avatarToModel, EquipCustomization, EquipSlot, slotNames, writeAvatar } from "../3d/avatar";
import { ThreeJsRenderer, ThreeJsRendererEvents, highlightModelGroup, saveGltf, ThreeJsSceneElement, ThreeJsSceneElementSource, exportThreeJsGltf } from "./threejsrender";
import { ModelData } from "../3d/ob3togltf";
import { mountSkeletalSkeleton, parseSkeletalAnimation } from "../3d/animationskeletal";
import { TypedEmitter } from "../utils";
import prettyJson from "json-stringify-pretty-compact";
import { svgfloor } from "../map/svgrender";
import { stringToMapArea } from "../cliparser";
import { cacheFileDecodeModes, extractCacheFiles } from "../scripts/extractfiles";
import { defaultTestDecodeOpts, testDecode, DecodeEntry } from "../scripts/testdecode";
import { UIScriptOutput, UIScriptConsole, OutputUI, ScriptOutput, UIScriptFile, useForceUpdate } from "./scriptsui";
import { CacheSelector, downloadStream, openSavedCache, SavedCacheSource, UIContext, UIContextReady } from "./maincomponents";
import { tiledimensions } from "../3d/mapsquare";
import { animgroupconfigs } from "../../generated/animgroupconfigs";
import { runMapRender } from "../map";
import { diffCaches } from "../scripts/cachediff";
import { JsonSearch, selectEntity, showModal } from "./jsonsearch";
import { extractAvatars, scrapePlayerAvatars } from "../scripts/scrapeavatars";
import { findImageBounds } from "../imgutils";

type LookupMode = "model" | "item" | "npc" | "object" | "material" | "map" | "avatar" | "spotanim" | "scenario" | "scripts";



export class ModelBrowser extends React.Component<{ ctx: UIContext }, { search: any, mode: LookupMode }> {
	constructor(p) {
		super(p);
		let search: unknown = null;
		try { search = JSON.parse(localStorage.rsmv_lastsearch ?? ""); } catch (e) { }
		this.state = {
			mode: localStorage.rsmv_lastmode ?? "model",
			search
		};
	}

	setMode(mode: LookupMode) {
		localStorage.rsmv_lastmode = mode;
		this.setState({ mode, search: null });
	}

	render() {
		let ModeComp = LookupModeComponentMap[this.state.mode];
		return (
			<React.Fragment>
				<div className="sidebar-browser-tab-strip">
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "item" })} onClick={() => this.setMode("item")}>Items</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "npc" })} onClick={() => this.setMode("npc")}>NPCs</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "object" })} onClick={() => this.setMode("object")}>Locs</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "avatar" })} onClick={() => this.setMode("avatar")}>Avatar</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "model" })} onClick={() => this.setMode("model")}>Model</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "map" })} onClick={() => this.setMode("map")}>Map</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "material" })} onClick={() => this.setMode("material")}>Materials</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "spotanim" })} onClick={() => this.setMode("spotanim")}>Spotanims</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "scenario" })} onClick={() => this.setMode("scenario")}>Scenario</div>
					<div className={classNames("rsmv-icon-button", { active: this.state.mode == "scripts" })} onClick={() => this.setMode("scripts")}>Scripts</div>
				</div>
				{ModeComp && <ModeComp initialId={this.state.search} ctx={this.props.ctx.canRender() ? this.props.ctx : null} partial={this.props.ctx} />}
			</React.Fragment>
		);
	}
}

export function IdInput({ initialid, onChange }: { initialid?: number, onChange: (id: number) => void }) {
	let [idstate, setId] = React.useState(initialid ?? 0);
	let stale = React.useRef(false);

	let id = (stale.current || typeof initialid == "undefined" ? idstate : initialid);

	let incr = () => { setId(id + 1); onChange(id + 1); stale.current = false; };
	let decr = () => { setId(id - 1); onChange(id - 1); stale.current = false; };
	let submit = (e: React.FormEvent) => { onChange(id); e.preventDefault(); stale.current = false; };
	return (
		<form className="sidebar-browser-search-bar" onSubmit={submit}>
			<input type="button" style={{ width: "25px", height: "25px" }} onClick={decr} value="" className="sub-btn sub-btn-minus" />
			<input type="button" style={{ width: "25px", height: "25px" }} onClick={incr} value="" className="sub-btn sub-btn-plus" />
			<input type="text" className="sidebar-browser-search-bar-input" value={id} onChange={e => { setId(+e.currentTarget.value); stale.current = true; }} />
			<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn sub-btn-search" />
		</form>
	)
}
export function StringInput({ initialid, onChange }: { initialid?: string, onChange: (id: string) => void }) {
	let [idstate, setId] = React.useState(initialid ?? "");
	let stale = React.useRef(false);

	let id = (stale.current || typeof initialid == "undefined" ? idstate : initialid);

	let submit = (e: React.FormEvent) => { onChange(id); e.preventDefault(); stale.current = false; };
	return (
		<form className="sidebar-browser-search-bar" onSubmit={submit}>
			<input type="text" className="sidebar-browser-search-bar-input" value={id} onChange={e => { setId(e.currentTarget.value); stale.current = true; }} />
			<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn sub-btn-search" />
		</form>
	)
}

export type SimpleModelDef = { modelid: number, mods: ModelModifications }[];

export class RSModel extends TypedEmitter<{ loaded: undefined, animchanged: number }> implements ThreeJsSceneElementSource {
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
		this.renderscene?.removeSceneElement(this);
		this.renderscene = null;
	}

	getSceneElements() {
		return {
			modelnode: this.rootnode,
			animationMixer: this.mixer
		}
	}

	addToScene(scene: ThreeJsRenderer) {
		this.renderscene = scene;
		scene.addSceneElement(this);
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
				let meshdata = await cache.getModelData(modelinit.modelid);
				let modified = {
					...meshdata,
					meshes: meshdata.meshes.map(q => modifyMesh(q, modelinit.mods))
				};
				return modified;
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
		this.skeletonHelper?.removeFromParent();
		this.skeletonHelper = new SkeletonHelper(mesh);
		this.rootnode.add(this.skeletonHelper);
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


export class RSMapChunk extends TypedEmitter<{ loaded: undefined }> implements ThreeJsSceneElementSource {
	model: Promise<{ grid: TileGrid, chunks: ChunkData[], chunkmodels: Object3D[], groups: Set<string> }>;
	loaded: { grid: TileGrid, chunks: ChunkData[], chunkmodels: Object3D[], groups: Set<string>, sky: { skybox: Object3D, fogColor: number[] } | null } | null = null;
	cache: ThreejsSceneCache;
	rootnode = new THREE.Group();
	mixer = new AnimationMixer(this.rootnode);
	renderscene: ThreeJsRenderer | null = null;
	toggles: Record<string, boolean> = {};
	rect: MapRect;

	cleanup() {
		this.listeners = {};

		//only clear vertex memory for now, materials might be reused and are up to the scenecache
		this.model.then(q => q.chunkmodels.forEach(node => {
			node.traverse(obj => {
				if (obj instanceof Mesh) { obj.geometry.dispose(); }
			});
		}))
		this.renderscene?.removeSceneElement(this);
		this.renderscene = null;
	}

	async renderSvg(level = 0, wallsonly = false, pxpersquare = 1) {
		let { chunks, grid } = await this.model;
		let rect: MapRect = { x: this.rect.x * 64, z: this.rect.z * 64, xsize: this.rect.xsize * 64, zsize: this.rect.zsize * 64 };
		return svgfloor(this.cache.cache, grid, chunks.flatMap(q => q.locs), rect, level, pxpersquare, wallsonly);
	}

	getSceneElements() {
		return {
			modelnode: this.rootnode,
			animationMixer: this.mixer,
			sky: this.loaded?.sky,
			options: { hideFloor: true }
		};
	}

	addToScene(scene: ThreeJsRenderer) {
		this.renderscene = scene;
		scene.addSceneElement(this);
	}

	onModelLoaded() {
		this.setToggles(this.toggles);
		this.emit("loaded", undefined);
		this.renderscene?.sceneElementsChanged();
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
			let opts: ParsemapOpts = { invisibleLayers: true, collision: true, map2d: true, padfloor: true, skybox: false, ...extraopts };
			let { grid, chunks } = await parseMapsquare(cache.cache, rect, opts);
			let modeldata = await mapsquareModels(cache, grid, chunks, opts);
			let chunkmodels = await Promise.all(modeldata.map(q => mapsquareToThreeSingle(this.cache, grid, q)));
			let sky = (extraopts?.skybox ? await mapsquareSkybox(cache, chunks[0]) : null);

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

			this.loaded = { grid, chunks, chunkmodels, groups, sky };
			this.onModelLoaded();
			return this.loaded;
		})();
	}
}

function LabeledInput(p: { label: string, children: React.ReactNode }) {
	return <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr" }}>
		<div>{p.label}</div>
		{p.children}
	</div>
}

export class InputCommitted extends React.Component<React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>>{
	el: HTMLInputElement | null = null;
	stale = false;

	@boundMethod
	onInput() {
		this.stale = true;
	}

	@boundMethod
	onChange(e: Event) {
		this.props.onChange?.(e as any);
		this.stale = false;
	}

	@boundMethod
	ref(el: HTMLInputElement | null) {
		if (this.el) {
			this.el.removeEventListener("change", this.onChange);
			this.el.removeEventListener("input", this.onInput);
		}
		if (el) {
			el.addEventListener("change", this.onChange);
			el.addEventListener("input", this.onInput);
			this.el = el;
		}
	}

	render() {
		if (!this.stale && this.el && this.props.value) {
			this.el.value = this.props.value as string;
		}
		let newp = { ...this.props, onChange: undefined, value: undefined, defaultValue: this.props.value };
		return <input ref={this.ref} {...newp} />;
	}
}

function ScenarioActionControl(p: { action: ScenarioAction, comp: ScenarioComponent | null, onChange: (v: ScenarioAction | null) => void }) {
	const action = p.action;
	let targetname = p.comp?.modelkey ?? "??";
	let remove = <span onClick={() => p.onChange(null)}>delete</span>;
	let inputstyle: React.CSSProperties = { width: "50px" };
	switch (action.type) {
		case "anim": {
			return (
				<div style={{ display: "grid", gridTemplateColumns: "30% 1fr min-content" }}>
					<span>{p.action.type} {targetname}</span>
					<InputCommitted type="number" style={inputstyle} value={action.animid} onChange={e => p.onChange({ ...action, animid: +e.currentTarget.value })} />
					{remove}
				</div>
			);
		}
		case "animset": {
			return (
				<div style={{ display: "grid", gridTemplateColumns: "30% 1fr min-content" }}>
					<span>{p.action.type} {targetname}</span>
					<select value={action.animid} onChange={e => p.onChange({ ...action, animid: +e.currentTarget.value })}>
						{Object.entries(action.anims).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
					</select>
					{remove}
				</div>
			);
		}
		case "delay": {
			return (
				<div style={{ display: "grid", gridTemplateColumns: "30% 1fr min-content" }}>
					<span >{p.action.type}</span>
					<InputCommitted type="number" style={inputstyle} value={action.duration} onChange={e => p.onChange({ ...action, duration: +e.currentTarget.value })} />
					{remove}
				</div>
			);
		}
		case "location": {
			return (
				<div style={{ display: "grid", gridTemplateColumns: "30% 1fr 1fr 1fr min-content" }}>
					<span>{p.action.type} {targetname}</span>
					<InputCommitted type="number" style={inputstyle} value={action.level} step={1} onChange={e => p.onChange({ ...action, level: +e.currentTarget.value })} />
					<InputCommitted type="number" style={inputstyle} value={action.x} onChange={e => p.onChange({ ...action, x: +e.currentTarget.value })} />
					<InputCommitted type="number" style={inputstyle} value={action.z} onChange={e => p.onChange({ ...action, z: +e.currentTarget.value })} />
					<InputCommitted type="number" style={inputstyle} value={action.dy} onChange={e => p.onChange({ ...action, dy: +e.currentTarget.value })} />
					{remove}
				</div>
			);
		}
		case "visibility": {
			return (
				<div style={{ display: "grid", gridTemplateColumns: "30% 1fr min-content" }}>
					<span>{p.action.type} {targetname}</span>
					<label><input type="checkbox" checked={action.visible} onClick={e => p.onChange({ ...action, visible: e.currentTarget.checked })} /></label>
					{remove}
				</div>
			);
		}
	}
}

function ScenarioComponentControl(p: { comp: ScenarioComponent, onChange: (v: ScenarioComponent | null) => void }) {
	return (
		<div>
			<div>{p.comp.modelkey}</div>
			<div onClick={e => p.onChange(null)}>delete</div>
		</div>
	)
}

type ScenarioComponent = {
	modelkey: string,
	simpleModel: SimpleModelDef | null,
	mapRect: MapRect | null
}

type ScenarioAction = {
	type: "location",
	target: number,
	x: number,
	z: number,
	level: number,
	dy: number,
} | {
	type: "anim",
	target: number,
	animid: number
} | {
	type: "animset",
	target: number,
	animid: number,
	anims: Record<string, number>
} | {
	type: "delay",
	target: -1,
	duration: number
} | {
	type: "visibility",
	target: number,
	visible: boolean
}

export class SceneScenario extends React.Component<LookupModeProps, { components: Record<number, ScenarioComponent>, actions: ScenarioAction[], addActionTarget: number, addModelType: keyof typeof primitiveModelInits | "map", addActionType: ScenarioAction["type"] }>{
	models = new Map<ScenarioComponent, RSModel | RSMapChunk>();
	idcounter = 0;
	mapoffset: { x: number, z: number } | null = null;
	mapgrid = new CombinedTileGrid([]);

	constructor(p) {
		super(p);
		this.state = {
			components: {},
			actions: [],
			addModelType: "model",
			addActionType: "anim",
			addActionTarget: -1
		};
	}

	componentWillUnmount() {
		for (let model of this.models.values()) { model.cleanup(); }
	}

	@boundMethod
	async addComp(id: string) {
		if (!this.props.ctx) { return; }
		if (this.state.addModelType == "map") {
			let rect = stringToMapArea(id);
			if (!rect) { throw new Error("invalid map rect"); }
			let compid = this.idcounter++;
			this.editComp(compid, {
				modelkey: `${this.state.addModelType}:${id}`,
				simpleModel: null,
				mapRect: rect
			});
		} else {
			let prim: SimpleModelInfo;
			if (this.state.addModelType == "player") {
				prim = await playerToModel(this.props.ctx.sceneCache, id);
			} else {
				let conv = primitiveModelInits[this.state.addModelType];
				prim = await conv(this.props.ctx.sceneCache, +id);
			}
			let compid = this.idcounter++;
			this.editComp(compid, {
				modelkey: `${this.state.addModelType}:${id}`,
				simpleModel: prim.models,
				mapRect: null
			});
			if (Object.keys(prim.anims).length != 0) {
				this.editAction(this.state.actions.length, {
					type: "animset",
					target: compid,
					animid: prim.anims.default ?? Object.keys(prim.anims)[0],
					anims: prim.anims
				});
			}
		}
	}
	@boundMethod
	addAction() {
		let action: ScenarioAction;
		switch (this.state.addActionType) {
			case "anim":
				action = { type: "anim", target: this.state.addActionTarget, animid: 0 };
				break;
			case "delay":
				action = { type: "delay", target: -1, duration: 0 };
				break;
			case "location":
				action = { type: "location", target: this.state.addActionTarget, level: 0, x: 0, z: 0, dy: 0 }
				break;
			case "visibility":
				action = { type: "visibility", target: this.state.addActionTarget, visible: true };
				break;
			default:
				throw new Error("unknown action " + this.state.addActionType);
		}
		this.editAction(this.state.actions.length, action);
	}

	editComp(compid: number, newcomp: ScenarioComponent | null) {
		if (!this.props.ctx) { return; }
		let components = { ...this.state.components };
		let oldcomp = this.state.components[compid];
		let model = this.models.get(oldcomp);
		if (!newcomp || oldcomp?.modelkey != newcomp.modelkey) {
			if (model) {
				model.cleanup();
				model = undefined;
			}
			if (newcomp) {
				if (newcomp.simpleModel) {
					model = new RSModel(newcomp.simpleModel, this.props.ctx.sceneCache);
				} else if (newcomp.mapRect) {
					model = new RSMapChunk(newcomp.mapRect, this.props.ctx.sceneCache, { collision: false, invisibleLayers: false, map2d: false, skybox: true });
					model.on("loaded", this.updateGrids);
					let hasmap = Object.values(this.state.components).some(q => q.mapRect);
					if (!hasmap || !this.mapoffset) {
						this.mapoffset = {
							x: (newcomp.mapRect.x + newcomp.mapRect.xsize / 2) * squareSize,
							z: (newcomp.mapRect.z + newcomp.mapRect.zsize / 2) * squareSize
						};
					}
					model.rootnode.position.set(-this.mapoffset.x * tiledimensions, 0, -this.mapoffset.z * tiledimensions);
				} else {
					throw new Error("invalid model init");
				}
				model.addToScene(this.props.ctx.renderer);
			}
		}
		this.models.delete(oldcomp);
		if (model && newcomp) {
			this.models.set(newcomp, model);
		}
		if (newcomp) { components[compid] = newcomp; }
		else { delete components[compid]; }
		this.setState({ components });
		this.restartAnims();
	}

	editAction(index: number, newaction: ScenarioAction | null) {
		let actions = this.state.actions.slice();

		if (newaction?.type == "anim" || newaction?.type == "animset") {
			let model = this.modelIdToModel(newaction.target);
			if (model instanceof RSModel) {
				model.loadAnimation(newaction.animid);
			}
		}

		if (newaction) { actions[index] = newaction; }
		else { actions.splice(index, 1); }
		this.setState({ actions });
		this.restartAnims();
	}

	modelIdToModel(id: number) {
		let modelinfo = this.state.components[id];
		return this.models.get(modelinfo);
	}

	@boundMethod
	updateGrids() {
		let grids: { src: TileGrid, rect: MapRect }[] = [];
		for (let comp of Object.values(this.state.components)) {
			if (!comp.mapRect) { continue };
			let model = this.models.get(comp) as RSMapChunk | undefined;
			if (!model?.loaded) { continue; }
			grids.push({
				src: model.loaded.grid,
				rect: {
					x: model.rect.x * squareSize,
					z: model.rect.z * squareSize,
					xsize: model.rect.xsize * squareSize,
					zsize: model.rect.zsize * squareSize
				}
			});
		}
		this.mapgrid = new CombinedTileGrid(grids);
	}

	@boundMethod
	async restartAnims() {
		//TODO ensure this function loops and only one instance is looping
		//otherwise we might be using old data from before setstate
		await delay(1);
		let totalduration = 0;
		for (let model of this.models.values()) {
			model.mixer.setTime(0);
		}
		for (const action of this.state.actions) {
			switch (action.type) {
				case "animset":
				case "anim": {
					let model = this.modelIdToModel(action.target);
					if (model instanceof RSModel) {
						model.setAnimation(action.animid);
					}
					break;
				}
				case "location": {
					let model = this.modelIdToModel(action.target);
					let groundy = getTileHeight(this.mapgrid, action.x + (this.mapoffset?.x ?? 0), action.z + (this.mapoffset?.z ?? 0), action.level);
					model?.rootnode.position.set(action.x * tiledimensions, groundy + action.dy * tiledimensions, action.z * tiledimensions);
					break;
				}
				case "delay": {
					totalduration += action.duration;
					await delay(action.duration);
					break;
				}
				case "visibility": {
					let model = this.modelIdToModel(action.target);
					if (model) { model.rootnode.visible = action.visible; }
					break;
				}
			}
		}
	}

	render() {
		return (
			<React.Fragment>
				<h2>Models</h2>
				{Object.entries(this.state.components).map(([id, comp]) => {
					return <ScenarioComponentControl key={id} comp={comp} onChange={e => this.editComp(+id, e)} />;
				})}
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
					<select value={this.state.addModelType} onChange={e => this.setState({ addModelType: e.currentTarget.value as any })}>
						<option value="model">model</option>
						<option value="npc">npc</option>
						<option value="spotanim">spotanim</option>
						<option value="loc">location</option>
						<option value="player">player</option>
						<option value="item">item</option>
						<option value="map">map</option>
					</select>
					<StringInput onChange={this.addComp} />
				</div>
				<h2>Action sequence</h2>
				{this.state.actions.map((a, i) => {
					let comp = this.state.components[a.target]
					return <ScenarioActionControl key={i} comp={comp} action={a} onChange={e => this.editAction(i, e)} />
				})}
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr" }}>
					<select value={this.state.addActionType} onChange={e => this.setState({ addActionType: e.currentTarget.value as any })}>
						<option value="location">Location</option>
						<option value="anim">Anim</option>
						<option value="delay">Delay</option>
						<option value="visibility">Visibility</option>
					</select>
					<select value={this.state.addActionTarget} onChange={e => this.setState({ addActionTarget: +e.currentTarget.value })}>
						{Object.entries(this.state.components).map(([key, c]) => <option key={key} value={key}>{key} - {c.modelkey}</option>)}
					</select>
					<input type="button" className="sub-btn" value={`add ${this.state.addActionType}`} onClick={this.addAction} />
				</div>
				<div onClick={this.restartAnims}>restart</div>
			</React.Fragment>
		)
	}
}

const primitiveModelInits = constrainedMap<(cache: ThreejsSceneCache, id: number | string) => Promise<SimpleModelInfo<any, any>>>()({
	npc: npcBodyToModel,
	player: playerToModel,
	spotanim: spotAnimToModel,
	model: modelToModel,
	loc: locToModel,
	item: itemToModel
});

async function modelToModel(cache: ThreejsSceneCache, id: number) {
	let modeldata = cache.getModelData(id);
	//getting the same file a 2nd time to get the full json
	let modelfile = await cache.source.getFileById(cacheMajors.models, id);
	let info = parseModels.read(modelfile);
	return { models: [{ modelid: id, mods: {} }], anims: {}, info: { modeldata, info }, id };
}

async function playerDataToModel(cache: ThreejsSceneCache, modeldata: { player: string, head: boolean, data: Buffer }) {
	let avainfo = await avatarToModel(null, cache, modeldata.data, "", modeldata.head);
	return { ...avainfo, id: modeldata };
}

async function playerToModel(cache: ThreejsSceneCache, name: string) {
	let url = appearanceUrl(name);
	let data = await fetch(url).then(q => q.text());
	if (data.indexOf("404 - Page not found") != -1) { throw new Error("player avatar not found"); }
	let avainfo = await avatarToModel(null, cache, avatarStringToBytes(data), "", false);
	return { ...avainfo, id: name };
}

export function serializeAnimset(group: animgroupconfigs) {
	let anims: Record<string, number> = {};
	let addanim = (name: string, id: number) => {
		if (Object.values(anims).indexOf(id) == -1) {
			anims[name] = id;
		}
	}
	anims.none = -1;
	if (group.baseAnims) {
		addanim("default", group.baseAnims.idle);
		addanim("walk", group.baseAnims.walk);
	}
	if (group.run) {
		addanim("run", group.run);
	}
	if (group.idleVariations) {
		let totalchance = group.idleVariations.reduce((a, v) => a + v.probably_chance, 0);
		for (let [i, variation] of group.idleVariations.entries()) {
			addanim(`idle${i}_${variation.probably_chance}/${totalchance}`, variation.animid);
		}
	}
	//TODO yikes, this object is not a map
	for (let [key, val] of Object.entries(group)) {
		if (typeof val == "number") {
			addanim(key, group[key]);
		}
	}

	return anims;
}

async function npcBodyToModel(cache: ThreejsSceneCache, id: number) {
	return npcToModel(cache, { id, head: false });
}

async function npcToModel(cache: ThreejsSceneCache, id: { id: number, head: boolean }) {
	let npc = parseNpc.read(await cache.getFileById(cacheMajors.npcs, id.id));
	let anims: Record<string, number> = {};
	let modelids = (id.head ? npc.headModels : npc.models) ?? [];
	if (!id.head && npc.animation_group) {
		let arch = await cache.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
		let animgroup = parseAnimgroupConfigs.read(arch[npc.animation_group].buffer);
		anims = serializeAnimset(animgroup);
	}
	let mods: ModelModifications = {};
	if (npc.color_replacements) { mods.replaceColors = npc.color_replacements; }
	if (npc.material_replacements) { mods.replaceMaterials = npc.material_replacements; }
	let models = modelids.map(q => ({ modelid: q, mods }));
	return {
		info: npc,
		models,
		anims,
		id
	};
}

async function spotAnimToModel(cache: ThreejsSceneCache, id: number) {
	let animdata = parseSpotAnims.read(await cache.getFileById(cacheMajors.spotanims, id));
	let mods: ModelModifications = {};
	if (animdata.replace_colors) { mods.replaceColors = animdata.replace_colors; }
	if (animdata.replace_materials) { mods.replaceMaterials = animdata.replace_materials; }
	let models = (animdata.model ? [{ modelid: animdata.model, mods }] : []);
	let anims: Record<string, number> = {};
	if (animdata.sequence) { anims.default = animdata.sequence; }
	return { models, anims, info: animdata, id };
}

async function locToModel(cache: ThreejsSceneCache, id: number) {
	let obj = await resolveMorphedObject(cache.source, id);
	let mods: ModelModifications = {};
	let anims: Record<string, number> = {};
	let models: SimpleModelDef = [];
	if (obj) {
		if (obj.color_replacements) { mods.replaceColors = obj.color_replacements; }
		if (obj.material_replacements) { mods.replaceMaterials = obj.material_replacements; }
		models = obj.models?.flatMap(m => m.values).map(q => ({ modelid: q, mods })) ?? [];
	}
	if (obj?.probably_animation) {
		anims.default = obj.probably_animation;
	}
	return { models, anims, info: obj, id };
}
async function itemToModel(cache: ThreejsSceneCache, id: number) {
	let item = parseItem.read(await cache.getFileById(cacheMajors.items, id));
	if (!item.baseModel && item.noteTemplate) {
		item = parseItem.read(await cache.getFileById(cacheMajors.items, item.noteTemplate));
	}
	let mods: ModelModifications = {};
	if (item.color_replacements) { mods.replaceColors = item.color_replacements; }
	if (item.material_replacements) { mods.replaceMaterials = item.material_replacements; }
	let models = (item.baseModel ? [{ modelid: item.baseModel, mods }] : [])

	return { models, anims: {}, info: item, id };
}

async function materialToModel(sceneCache: ThreejsSceneCache, modelid: number) {
	let assetid = 93776;//"RuneTek_Asset" jagex test model
	let mods: ModelModifications = {
		replaceMaterials: [[4314, modelid]]
	};
	// modelids = [67768];//is a cube but has transparent vertices
	// mods.replaceMaterials = [
	// 	[8868, +searchid]
	// ];
	let mat = sceneCache.cache.getMaterialData(modelid);
	let texs: Record<string, { texid: number, filesize: number, img0: ImageData }> = {};
	let addtex = async (name: string, texid: number) => {
		let file = await sceneCache.source.getFile(cacheMajors.texturesDds, texid);
		let parsed = new ParsedTexture(file, true);
		//bit of a waste to get decode the whole thing just to get meta data, but w/e
		let img0 = await parsed.toImageData(0);
		texs[name] = { texid, filesize: file.length, img0 };
	}
	for (let tex in mat.textures) {
		if (mat.textures[tex] != 0) {
			await addtex(tex, mat.textures[tex]);
		}
	}
	return {
		models: [{ modelid: assetid, mods }],
		anims: {},
		info: { texs, obj: mat },
		id: modelid
	};
}

function ScenePlayer(p: LookupModeProps) {
	const [data, model, id, setId] = useAsyncModelData(p.ctx, playerDataToModel);
	const [head, setHead] = React.useState(false);
	const modelBuf = React.useRef<Buffer | null>(null);
	const forceUpdate = useForceUpdate();
	const oncheck = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (modelBuf.current) { setId({ player: id?.player ?? "", data: modelBuf.current, head: e.currentTarget.checked }); }
		setHead(e.currentTarget.checked);
	}
	const nameChange = async (v: string) => {
		let url = appearanceUrl(v);
		let data = await fetch(url).then(q => q.text());
		if (data.indexOf("404 - Page not found") != -1) { throw new Error("player avatar not found"); }
		modelBuf.current = avatarStringToBytes(data);
		setId({ player: v, data: modelBuf.current, head });
	}

	const equipChanged = (index: number, type: "item" | "kit" | "none", id: number) => {
		let oldava = data?.info.avatar;
		if (!oldava) { console.trace("unexpected"); return; }
		let newava = { ...oldava };
		newava.slots = oldava.slots.slice() as any;
		if (type == "none") {
			newava.slots[index] = { slot: null, cust: null };
		} else {
			newava.slots[index] = { slot: { type, id } as EquipSlot, cust: null };
		}
		modelBuf.current = writeAvatar(newava, data?.info.gender ?? 0, null);
		setId({ player: "", data: modelBuf.current, head });
	}

	const customizationChanged = (index: number, cust: EquipCustomization) => {
		let oldava = data?.info.avatar
		if (!oldava) { console.trace("unexpected"); return; }
		let newava = { ...oldava };
		newava.slots = oldava.slots.slice() as any;
		newava.slots[index] = { ...oldava.slots[index], cust };
		modelBuf.current = writeAvatar(newava, data?.info.gender ?? 0, null);
		setId({ player: "", data: modelBuf.current, head });
	}

	let initname = (p.initialId && typeof p.initialId == "object" && (typeof p.initialId as any).player == "string" ? (p.initialId as any).player : "");

	return (
		<React.Fragment>
			<StringInput onChange={nameChange} initialid={initname} />
			<label><input type="checkbox" checked={head} onChange={oncheck} />Head</label>
			{model && data && (
				<LabeledInput label="Animation">
					<select onChange={e => { model.setAnimation(+e.currentTarget.value); forceUpdate() }} value={model.targetAnimId}>
						{Object.entries(data.anims).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
					</select>
				</LabeledInput>
			)}
			<div style={{ userSelect: "text" }}>
				{p.ctx && data?.info.avatar?.slots.map((q, i) => {
					return (
						<AvatarSlot key={i} index={i} slot={q.slot} cust={q.cust} ctx={p.ctx!} custChanged={customizationChanged} equipChanged={equipChanged} />
					);
				})}
			</div>
		</React.Fragment>
	)
}

function AvatarSlot({ index, slot, cust, custChanged, equipChanged, ctx }: { ctx: UIContextReady, index: number, slot: EquipSlot | null, cust: EquipCustomization, equipChanged: (index: number, type: "kit" | "item" | "none", id: number) => void, custChanged: (index: number, v: EquipCustomization) => void }) {

	let editcust = (ch?: (cust: NonNullable<EquipCustomization>) => {}) => {
		if (!ch) { custChanged(index, null); }
		else {
			let newcust = { color: null, flag2: null, material: null, model: null, ...cust };
			ch(newcust);
			if (!newcust.color && !newcust.flag2 && !newcust.material && !newcust.model) { custChanged(index, null); }
			else { custChanged(index, newcust); }
		}
	}

	let searchItem = () => {
		selectEntity(ctx, "items", i => equipChanged(index, "item", i), [{ path: ["equipSlotId"], search: index + "" }, { path: ["name"], search: "" }]);
	}
	let searchKit = () => {
		selectEntity(ctx, "identitykit", i => equipChanged(index, "kit", i), []);
	}

	return (
		<div>
			{slot && (
				<div style={{ display: "grid", gridTemplateColumns: "auto repeat(10,min-content)" }}>
					<span>{slot.name}</span>
					{!cust?.color?.col2 && !cust?.color?.col4 && slot.replaceColors.length != 0 && (
						<input type="button" className="sub-btn" value="C" onClick={e => editcust(c => c.color = { col4: null, col2: slot.replaceColors.map(q => q[1]) })} />
					)}
					{!cust?.color?.col2 && !cust?.color?.col4 && (
						<input type="button" className="sub-btn" value="C4" onClick={e => editcust(c => c.color = { col4: [[0, 0], [0, 0], [0, 0], [0, 0]], col2: null })} />
					)}
					{!cust?.material && slot.replaceMaterials.length != 0 && (
						<input type="button" className="sub-btn" value="T" onClick={e => editcust(c => c.material = { header: 0, materials: slot.replaceMaterials.map(q => q[1]) })} />
					)}
					{!cust?.model && (
						<input type="button" className="sub-btn" value="M" onClick={e => editcust(c => c.model = slot.models.slice())} />
					)}
					<input type="button" className="sub-btn" value="x" onClick={e => equipChanged(index, "none", 0)} />
				</div>
			)}
			{!slot && (
				<div style={{ display: "grid", gridTemplateColumns: "auto repeat(10,min-content)" }}>
					{slotNames[index]}
					<input type="button" className="sub-btn" value="Item" onClick={searchItem} />
					<input type="button" className="sub-btn" value="Kit" onClick={searchKit} />
				</div>
			)}


			{slot && cust?.color?.col2 && (
				<div>
					{slot.replaceColors.map((q, i) => (
						<InputCommitted key={i} type="color" value={hsl2hex(cust.color!.col2![i])} onChange={e => editcust(c => c.color!.col2![i] = hex2hsl(e.currentTarget.value))} />
					))}
					<input type="button" className="sub-btn" value="x" onClick={e => editcust(c => c.color = null!)} />
				</div>
			)}
			{slot && cust?.color?.col4 && (
				<div>
					{cust.color.col4.map(([from, to], i) => (
						<span key={i}>
							<InputCommitted type="number" value={from} onChange={e => editcust(c => c.color!.col4![i][0] = +e.currentTarget.value)} />
							<InputCommitted type="color" value={hsl2hex(to)} onChange={e => editcust(c => c.color!.col4![i][1] = hex2hsl(e.currentTarget.value))} />
						</span>
					))}
					<input type="button" className="sub-btn" value="x" onClick={e => editcust(c => c.color = null!)} />
				</div>
			)}
			{slot && cust?.material && (
				<div>
					{slot.replaceMaterials.map((q, i) => (
						<InputCommitted key={i} type="number" value={cust.material!.materials![i]} onChange={e => editcust(c => c.material!.materials[i] = +e.currentTarget.value)} />
					))}
					<input type="button" className="sub-btn" value="x" onClick={e => editcust(c => c.material = null!)} />
				</div>
			)}
			{slot && cust?.model && (
				<div>
					{slot.models.map((modelid, i) => (
						<InputCommitted key={i} type="number" value={modelid} onChange={e => editcust(c => c.model![i] = +e.currentTarget.value)} />
					))}
					<input type="button" className="sub-btn" value="x" onClick={e => editcust(c => c.model = null!)} />
				</div>
			)}
		</div>
	)
}

function hsl2hex(hsl: number) {
	let rgb = HSL2RGB(packedHSL2HSL(hsl));
	return `#${((rgb[0] << 16) | (rgb[1] << 8) | (rgb[2] << 0)).toString(16).padStart(6, "0")}`;
}

function hex2hsl(hex: string) {
	let n = parseInt(hex.replace(/^#/, ""), 16);
	return HSL2packHSL(...RGB2HSL((n >> 16) & 0xff, (n >> 8) & 0xff, (n >> 0) & 0xff));
}

function ExportSceneMenu(p: { ctx: UIContextReady }) {
	let [tab, settab] = React.useState<"img" | "gltf" | "none">("none");
	let [img, setimg] = React.useState<{ cnv: HTMLCanvasElement, ctx: CanvasRenderingContext2D } | null>(null);
	let [cropimg, setcropimg] = React.useState(true);

	let changeImg = async (crop: boolean) => {
		let newimg = await p.ctx.renderer.takeCanvasPicture();
		if (crop) {
			let imgdata = newimg.ctx.getImageData(0, 0, newimg.cnv.width, newimg.cnv.height);
			let bounds = findImageBounds(imgdata);
			newimg.cnv.width = bounds.width;
			newimg.cnv.height = bounds.height;
			newimg.ctx.putImageData(imgdata, -bounds.x, -bounds.y);
		}
		settab("img");
		setcropimg(crop);
		setimg(newimg);
	}

	let saveimg = async () => {
		if (!img) { return; }
		let blob = await new Promise<Blob | null>(d => img!.cnv.toBlob(d));
		if (!blob) { return; }
		let url = URL.createObjectURL(blob)
		let a = document.createElement("a");
		a.href = url;
		a.download = "runeapps_image_export.png";
		a.click();
		//TODO revoke object url to prevent mem leak after download is complete (when?)
	}

	let copyimg = async () => {
		//@ts-ignore
		navigator.clipboard.write([
			//@ts-ignore
			new ClipboardItem({ 'image/png': await new Promise<Blob | null>(d => img!.cnv.toBlob(d)) })
		]);
	}

	let saveModel = async () => {
		let a = 0;
		let str = new ReadableStream({
			async pull(c) {
				let file = await exportThreeJsGltf(p.ctx.renderer.getModelNode());
				c.enqueue(new Uint8Array(file));
				c.close();
			}
		});
		downloadStream("model.glb", str);
	}

	return (
		<div style={{ display: "grid", gridTemplateColumns: "2fr 3fr" }}>
			<div>
				<input type="button" className="sub-btn" onClick={e => changeImg(cropimg)} value="picture" />
				<input type="button" className="sub-btn" onClick={e => settab("gltf")} value="gltf/glb" />
			</div>
			<div>
				{tab == "img" && img && (
					<React.Fragment>
						<label><input type="checkbox" checked={cropimg} onChange={e => changeImg(e.currentTarget.checked)} />Crop image</label>
						<input type="button" className="sub-btn" value="Save" onClick={saveimg} />
						<input type="button" className="sub-btn" value="Clipboard" onClick={copyimg} />
						<CanvasView canvas={img.cnv} />
					</React.Fragment>
				)}
				{tab == "gltf" && (
					<React.Fragment>
						<input type="button" className="sub-btn" value="Save" onClick={saveModel} />
					</React.Fragment>
				)}
			</div>
		</div>
	)
}

function CanvasView(p: { canvas: HTMLCanvasElement }) {
	let ref = React.useCallback((el: HTMLDivElement | null) => {
		p.canvas.classList.add("mv-image-preview-canvas");
		if (el) { el.appendChild(p.canvas); }
		else { p.canvas.remove(); }
	}, [p.canvas]);

	return (
		<div ref={ref} className="mv-image-preview" />
	)
}

function showExportSceneMeta(ctx: UIContextReady) {
	showModal({ title: "Export" }, <ExportSceneMenu ctx={ctx} />)
}

export function RendererControls(p: { ctx: UIContext, visible: boolean }) {
	const elconfig = React.useRef<ThreeJsSceneElement>({ options: {} });
	const sceneEl = React.useRef<ThreeJsSceneElementSource>({ getSceneElements() { return elconfig.current } });

	let [hideFog, sethidefog] = React.useState(false);
	let [hideFloor, sethidefloor] = React.useState(false);
	let [camMode, setcammode] = React.useState<"standard" | "vr360">("standard");
	let [camControls, setcamcontrols] = React.useState<"free" | "world">("free");

	const render = p.ctx?.renderer;

	let newopts: ThreeJsSceneElement["options"] = { hideFog, hideFloor, camMode, camControls };
	let oldopts = elconfig.current.options;
	elconfig.current.options = newopts;

	//I wont tell anyone if you dont tell anyone
	//TODO actually fix this tho
	if (JSON.stringify(oldopts) != JSON.stringify(newopts)) {
		render?.sceneElementsChanged();
	}

	React.useEffect(() => {
		if (render) {
			render.addSceneElement(sceneEl.current);
			return () => { render.removeSceneElement(sceneEl.current); }
		}
	}, [render])

	return (p.visible || null) && (
		<React.Fragment>
			<label><input type="checkbox" checked={hideFog} onChange={e => sethidefog(e.currentTarget.checked)} />Hide fog</label>
			<label><input type="checkbox" checked={hideFloor} onChange={e => sethidefloor(e.currentTarget.checked)} />Hide floor</label>
			<label><input type="checkbox" checked={camControls == "world"} onChange={e => setcamcontrols(e.currentTarget.checked ? "world" : "free")} />World space controls</label>
			<label><input type="checkbox" checked={camMode == "vr360"} onChange={e => setcammode(e.currentTarget.checked ? "vr360" : "standard")} />360 camera</label>
			<input type="button" className="sub-btn" onClick={e => p.ctx.canRender() && showExportSceneMeta(p.ctx)} value="Export" />
		</React.Fragment>
	)
}

export function JsonDisplay(p: { obj: any }) {
	return (<pre className="json-block">{prettyJson(p.obj)}</pre>);
}

type SimpleModelInfo<T = object, ID = string> = {
	models: SimpleModelDef,
	anims: Record<string, number>,
	info: T,
	id: ID
}

function ImageDataView(p: { img: ImageData }) {
	let ref = React.useCallback((cnv: HTMLCanvasElement | null) => {
		if (cnv) {
			cnv.width = p.img.width;
			cnv.height = p.img.height;
			let ctx = cnv.getContext("2d")!;
			ctx.putImageData(p.img, 0, 0);
		}
	}, [p.img]);

	return (
		<canvas ref={ref} style={{ maxWidth: "100%" }} />
	)
}

function useAsyncModelData<ID, T>(ctx: UIContextReady | null, getter: (cache: ThreejsSceneCache, id: ID) => Promise<SimpleModelInfo<T, ID>>) {
	let idref = React.useRef<ID | null>(null);
	let [loadedModel, setLoadedModel] = React.useState<RSModel | null>(null);
	let [visible, setVisible] = React.useState<SimpleModelInfo<T, ID> | null>(null);
	let ctxref = React.useRef(ctx);
	ctxref.current = ctx;
	let setter = React.useCallback((id: ID) => {
		if (!ctxref.current) { return; }
		idref.current = id;
		let prom = getter(ctxref.current.sceneCache, id);
		prom.then(res => {
			if (idref.current == id) {
				localStorage.rsmv_lastsearch = JSON.stringify(id);
				setVisible(res);
			}
		})
	}, []);
	React.useLayoutEffect(() => {
		if (visible && ctx) {
			let model = new RSModel(visible.models, ctx.sceneCache);
			if (visible.anims.default) {
				model.setAnimation(visible.anims.default);
			}
			model.addToScene(ctx.renderer);
			model.model.then(m => {
				if (visible && idref.current == visible.id) {
					setLoadedModel(model);
				}
			});
			return () => {
				model.cleanup();
			}
		}
	}, [visible, ctx]);
	return [visible, loadedModel, idref.current, setter] as [state: SimpleModelInfo<T> | null, model: RSModel | null, id: ID | null, setter: (id: ID) => void];
}

function SceneMaterial(p: LookupModeProps) {
	let [data, model, id, setId] = useAsyncModelData(p.ctx, materialToModel);

	let initid = id ?? (typeof p.initialId == "number" ? p.initialId : 0);
	return (
		<React.Fragment>
			<IdInput onChange={setId} initialid={initid} />
			<input type="button" className="sub-btn" value="advanced" onClick={e => selectEntity(p.ctx!, "materials", setId)} />
			<div style={{ overflowY: "auto" }}>
				{data && Object.entries(data.info.texs).map(([name, img]) => (
					<div key={name}>
						<div>{name} - {img.texid} - {img.filesize / 1024 | 0}kb - {img.img0.width}x{img.img0.height}</div>
						<ImageDataView img={img.img0} />
					</div>
				))}
				<JsonDisplay obj={data?.info.obj} />
			</div>
		</React.Fragment>
	)
}

function SceneRawModel(p: LookupModeProps) {
	let [data, model, id, setId] = useAsyncModelData(p.ctx, modelToModel);
	let initid = id ?? (typeof p.initialId == "number" ? p.initialId : 0);
	return (
		<React.Fragment>
			<IdInput onChange={setId} initialid={initid} />
			<JsonDisplay obj={{ ...data?.info.modeldata, meshes: undefined }} />
			<JsonDisplay obj={data?.info.info} />
		</React.Fragment>
	)
}

function SceneLocation(p: LookupModeProps) {
	const [data, model, id, setId] = useAsyncModelData(p.ctx, locToModel);
	const forceUpdate = useForceUpdate();
	const anim = data?.anims.default ?? -1;
	let initid = id ?? (typeof p.initialId == "number" ? p.initialId : 0);
	return (
		<React.Fragment>
			<IdInput onChange={setId} initialid={initid} />
			<input type="button" className="sub-btn" value="advanced" onClick={e => selectEntity(p.ctx!, "objects", setId)} />
			{anim != -1 && <label><input type="checkbox" checked={!model || model.targetAnimId == anim} onChange={e => { model?.setAnimation(e.currentTarget.checked ? anim : -1); forceUpdate(); }} />Animate</label>}
			<JsonDisplay obj={data?.info} />
		</React.Fragment>
	)
}

function SceneItem(p: LookupModeProps) {
	let [data, model, id, setId] = useAsyncModelData(p.ctx, itemToModel);
	let initid = id ?? (typeof p.initialId == "number" ? p.initialId : 0);
	return (
		<React.Fragment>
			<IdInput onChange={setId} initialid={initid} />
			<input type="button" className="sub-btn" value="advanced" onClick={e => selectEntity(p.ctx!, "items", setId)} />
			<JsonDisplay obj={data?.info} />
		</React.Fragment>
	)
}

function SceneNpc(p: LookupModeProps) {
	const [data, model, id, setId] = useAsyncModelData(p.ctx, npcToModel);
	const forceUpdate = useForceUpdate();
	let initid = id?.id ?? (p.initialId && typeof p.initialId == "object" && (typeof p.initialId as any).id == "number" ? (p.initialId as any).id : 0);

	return (
		<React.Fragment>
			<IdInput onChange={v => setId({ id: v, head: id?.head ?? false })} initialid={initid} />
			<input type="button" className="sub-btn" value="advanced" onClick={e => selectEntity(p.ctx!, "npcs", v => setId({ id: v, head: id?.head ?? false }))} />
			<label><input type="checkbox" checked={id?.head ?? false} onClick={e => setId({ id: id?.id ?? 0, head: e.currentTarget.checked })} />Head</label>
			{model && data && (
				<LabeledInput label="Animation">
					<select onChange={e => { model.setAnimation(+e.currentTarget.value); forceUpdate() }} value={model.targetAnimId}>
						{Object.entries(data.anims).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
					</select>
				</LabeledInput>
			)}
			<JsonDisplay obj={data?.info} />
		</React.Fragment>
	)
}

function SceneSpotAnim(p: LookupModeProps) {
	let [data, model, id, setId] = useAsyncModelData(p.ctx, spotAnimToModel);
	let initid = id ?? (typeof p.initialId == "number" ? p.initialId : 0);
	return (
		<React.Fragment>
			<IdInput onChange={setId} initialid={initid} />
			<JsonDisplay obj={data?.info} />
		</React.Fragment>
	)
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
export class SceneMapModel extends React.Component<LookupModeProps, SceneMapState> {
	selectCleanup: (() => void)[] = [];
	constructor(p) {
		super(p);
		this.state = {
			chunkgroups: [],
			center: { x: 0, z: 0 },
			toggles: Object.create(null),
			selectionData: undefined
		}
	}

	@boundMethod
	clear() {
		this.selectCleanup.forEach(q => q());
		this.state.chunkgroups.forEach(q => q.chunk.cleanup());
		this.setState({ chunkgroups: [], toggles: Object.create(null) });
	}

	@boundMethod
	async meshSelected(e: ThreeJsRendererEvents["select"]) {
		this.selectCleanup.forEach(q => q());
		let selectionData: any = undefined;
		if (e) {
			this.selectCleanup = highlightModelGroup(e.vertexgroups);

			//show data about what we clicked
			console.log(Array.isArray(e.obj.material) ? e.obj.material : e.obj.material.userData);
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
		this.props.ctx?.renderer.forceFrame();
	}

	componentDidMount() {
		//TODO this is a leak if ctx changes while mounted
		this.props.ctx?.renderer.on("select", this.meshSelected);
	}

	componentWillUnmount() {
		this.clear();
		//TODO this is a leak if ctx changes while mounted
		this.props.ctx?.renderer.off("select", this.meshSelected);
	}

	async addArea(rect: MapRect) {
		const sceneCache = this.props.ctx?.sceneCache;
		const renderer = this.props.ctx?.renderer;
		if (!sceneCache || !renderer) { return; }

		let chunk = new RSMapChunk(rect, sceneCache, { skybox: true });
		chunk.once("loaded", async () => {
			let combined = chunk.rootnode;

			let toggles = this.state.toggles;
			[...chunk.loaded!.groups].sort((a, b) => a.localeCompare(b)).forEach(q => {
				if (typeof toggles[q] != "boolean") {
					toggles[q] = !q.match(/(floorhidden|collision|walls|map|mapscenes)/);
				}
			});

			let center = this.state.center;
			combined.position.add(new Vector3(-center.x, 0, -center.z));
			chunk.addToScene(renderer);
			chunk.setToggles(toggles);

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
		localStorage.rsmv_lastsearch = JSON.stringify(searchtext);
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
		this.props.ctx?.renderer.forceFrame();
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

		let initid = (typeof this.props.initialId == "string" ? this.props.initialId : "50,50,1,1");

		return (
			<React.Fragment>
				<StringInput onChange={this.onSubmit} initialid={initid} />
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

function ExtractFilesScript(p: { onRun: (output: UIScriptOutput) => void, source: CacheFileSource }) {
	let [files, setFiles] = React.useState("");
	let [mode, setMode] = React.useState(Object.keys(cacheFileDecodeModes)[0]);

	let run = () => {
		let output = new UIScriptOutput();
		output.run(extractCacheFiles, p.source, { files, mode, batched: true, batchlimit: 512 });
		p.onRun(output);
	}

	return (
		<React.Fragment>
			<LabeledInput label="Mode">
				<select value={mode} onChange={e => setMode(e.currentTarget.value)}>
					{Object.keys(cacheFileDecodeModes).map(k => <option key={k} value={k}>{k}</option>)}
				</select>
			</LabeledInput>
			<LabeledInput label="File ranges">
				<InputCommitted type="text" onChange={e => setFiles(e.currentTarget.value)} value={files} />
			</LabeledInput>
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}
function ExtractAvatarsScript(p: { onRun: (output: UIScriptOutput) => void, source: CacheFileSource }) {
	let [files, setFiles] = React.useState<FileList | null>(null);

	let run = () => {
		if (!files) { return; }
		let output = new UIScriptOutput();
		let iter = (async function* () {
			for (let i = 0; i < files!.length; i++) {
				yield {
					name: files![i].name,
					buf: Buffer.from(await files![i].arrayBuffer())
				}
			}
		})();
		output.run(extractAvatars, p.source, iter);
		p.onRun(output);
	}

	return (
		<React.Fragment>
			<input type="file" multiple={true} onChange={e => setFiles(e.currentTarget.files)} />
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}
function MaprenderScript(p: { onRun: (output: UIScriptOutput) => void, source: CacheFileSource }) {
	let [endpoint, setEndpoint] = React.useState("");
	let [auth, setAuth] = React.useState("");

	let run = () => {
		let output = new UIScriptOutput();
		output.run(runMapRender, p.source, "main", endpoint, auth);
		p.onRun(output);
	}

	return (
		<React.Fragment>
			<LabeledInput label="Endpoint">
				<InputCommitted type="text" onChange={e => setEndpoint(e.currentTarget.value)} value={endpoint} />
			</LabeledInput>
			<LabeledInput label="Auth">
				<InputCommitted type="text" onChange={e => setAuth(e.currentTarget.value)} value={auth} />
			</LabeledInput>
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}
function CacheDiffScript(p: { onRun: (output: UIScriptOutput) => void, source: CacheFileSource }) {
	let [cache2, setCache2] = React.useState<CacheFileSource | null>(null);
	let openCache = async (s: SavedCacheSource) => {
		setCache2(await openSavedCache(s, false));
	}

	React.useEffect(() => () => cache2?.close(), [cache2]);

	let run = async () => {
		let output = new UIScriptOutput();
		let source2 = await cache2;
		if (!source2) { return; }
		output.run(diffCaches, p.source, source2);
		p.onRun(output);
	}

	return (
		<React.Fragment>
			{!cache2 && <CacheSelector onOpen={openCache} />}
			{cache2 && <input type="button" className="sub-btn" value={`Close ${cache2.getCacheName()}`} onClick={e => setCache2(null)} />}
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}

function TestFilesScript(p: { onRun: (output: UIScriptOutput) => void, source: CacheFileSource }) {
	let [mode, setMode] = React.useState("");

	let run = () => {
		let modefactory = cacheFileDecodeModes[mode];
		if (!modefactory) { return; }
		let output = new UIScriptOutput();
		let opts = defaultTestDecodeOpts();
		output.run(testDecode, p.source, modefactory({}), opts);
		p.onRun(output);
	}

	return (
		<React.Fragment>
			<LabeledInput label="Mode">
				<select value={mode} onChange={e => setMode(e.currentTarget.value)}>
					{Object.keys(cacheFileDecodeModes).map(k => <option key={k} value={k}>{k}</option>)}
				</select>
			</LabeledInput>
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}


const uiScripts = {
	test: TestFilesScript,
	extract: ExtractFilesScript,
	maprender: MaprenderScript,
	diff: CacheDiffScript
}

class ScriptsUI extends React.Component<LookupModeProps, { script: keyof typeof uiScripts, running: UIScriptOutput | null }>{
	constructor(p) {
		super(p);
		this.state = {
			script: this.props.initialId as any,
			running: null
		}
	}

	@boundMethod
	async onRun(output: UIScriptOutput) {
		localStorage.rsmv_lastsearch = JSON.stringify(this.state.script);
		this.setState({ running: output });
	}

	render() {
		const source = this.props.partial.source;
		if (!source) { throw new Error("trying to render modelbrowser wouth source loaded"); }
		const SelectedScript = uiScripts[this.state.script];
		return (
			<React.Fragment>
				<h2>Script runner</h2>
				<div className="sidebar-browser-tab-strip">
					{Object.keys(uiScripts).map((q, i) => (
						<div key={q} className={classNames("rsmv-icon-button", { active: this.state.script == q })} onClick={() => this.setState({ script: q as any })}>{q}</div>
					))}
				</div>
				{SelectedScript && <SelectedScript source={source} onRun={this.onRun} />}
				<h2>Script output</h2>
				<OutputUI output={this.state.running} ctx={this.props.partial} />
			</React.Fragment>
		);
	}
}

type LookupModeProps = { initialId: unknown, ctx: UIContextReady | null, partial: UIContext }

const LookupModeComponentMap: Record<LookupMode, React.ComponentType<LookupModeProps>> = {
	model: SceneRawModel,
	item: SceneItem,
	avatar: ScenePlayer,
	material: SceneMaterial,
	npc: SceneNpc,
	object: SceneLocation,
	spotanim: SceneSpotAnim,
	map: SceneMapModel,
	scenario: SceneScenario,
	scripts: ScriptsUI
}
