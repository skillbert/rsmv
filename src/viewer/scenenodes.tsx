import { ThreejsSceneCache, EngineCache, constModelsIds } from '../3d/modeltothree';
import { delay, packedHSL2HSL, HSL2RGB, RGB2HSL, HSL2packHSL, ModelModifications, stringToFileRange, stringToMapArea, checkObject } from '../utils';
import { boundMethod } from 'autobind-decorator';
import { CacheFileSource } from '../cache';
import { MapRect, TileGrid, CombinedTileGrid, getTileHeight, rs2ChunkSize, classicChunkSize, RSMapChunkData } from '../3d/mapsquare';
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { cacheMajors } from "../constants";
import * as React from "react";
import classNames from "classnames";
import { appearanceUrl, avatarStringToBytes, bytesToAvatarString, EquipCustomization, EquipSlot, slotNames, slotToKitFemale, slotToKitMale, writeAvatar } from "../3d/avatar";
import { ThreeJsRendererEvents, highlightModelGroup, ThreeJsSceneElement, ThreeJsSceneElementSource, exportThreeJsGltf, exportThreeJsStl, RenderCameraMode, ThreeJsRenderer } from "./threejsrender";
import { cacheFileJsonModes, cacheFileDecodeModes, cacheFileDecodeGroups, DecodeMode } from "../scripts/filetypes";
import { defaultTestDecodeOpts, testDecode } from "../scripts/testdecode";
import { UIScriptOutput, OutputUI, useForceUpdate, VR360View, UIScriptFiles, UIScriptFS, DomWrap, UIScriptConsole } from "./scriptsui";
import { CacheSelector, downloadBlob, openSavedCache, SavedCacheSource, UIContext, UIContextReady } from "./maincomponents";
import { tiledimensions } from "../3d/mapsquare";
import { runMapRender } from "../map";
import { diffCaches, FileEdit } from "../scripts/cachediff";
import { selectEntity, showModal } from "./jsonsearch";
import { drawTexture, findImageBounds, makeImageData } from "../imgutils";
import { avataroverrides } from "../../generated/avataroverrides";
import { InputCommitted, StringInput, JsonDisplay, IdInput, LabeledInput, TabStrip, IdInputSearch, CanvasView, PasteButton, CopyButton } from "./commoncontrols";
import { items } from "../../generated/items";
import { castModelInfo, itemToModel, locToModel, modelToModel, npcBodyToModel, npcToModel, playerDataToModel, playerToModel, RSMapChunk, RSMapChunkGroup, RSModel, SimpleModelDef, SimpleModelInfo, spotAnimToModel } from "../3d/modelnodes";
import fetch from "node-fetch";
import { mapsquare_overlays } from '../../generated/mapsquare_overlays';
import { mapsquare_underlays } from '../../generated/mapsquare_underlays';
import { FileParser } from '../opdecoder';
import { assertSchema, customModelDefSchema, maprenderConfigSchema, parseJsonOrDefault, scenarioStateSchema } from '../jsonschemas';
import { fileHistory } from '../scripts/filehistory';
import { MaterialData } from '../3d/jmat';
import { extractCacheFiles } from '../scripts/extractfiles';
import { debugProcTexture } from '../3d/proceduraltexture';
import { MapRenderDatabaseBacked, MapRenderFsBacked, examplemapconfig, parseMapConfig } from '../map/backends';
import { compareFloorDependencies, compareLocDependencies, mapdiffmesh, mapsquareFloorDependencies, mapsquareLocDependencies } from '../map/chunksummary';
import { previewAllFileTypes } from '../scripts/previewall';
import { CliApiContext, cliApi } from '../clicommands';
import * as cmdts from "cmd-ts";
import * as commentjson from "comment-json";


type LookupMode = "model" | "item" | "npc" | "object" | "material" | "map" | "avatar" | "spotanim" | "scenario" | "scripts";

type NumPair = [number, number];

function propOrDefault<T extends { [key: string]: number | string | boolean }>(v: unknown, defaults: T) {
	let r = Object.assign({}, defaults);
	if (typeof v == "object" && v) {
		for (let prop in defaults) {
			if (typeof v[prop as any] == typeof defaults[prop]) {
				r[prop] = v[prop as any];
			}
		}
	}
	return r;
}

export function ModelBrowser(p: { ctx: UIContext }) {

	type state = { search: unknown, mode: LookupMode }

	let [state, setMode] = React.useReducer((prev: any, v: LookupMode) => {
		localStorage.rsmv_lastmode = v;
		return { search: null, mode: v } as state;
	}, null, () => {
		let search: unknown = null;
		try { search = JSON.parse(localStorage.rsmv_lastsearch ?? ""); } catch (e) { }
		return { search, mode: localStorage.rsmv_lastmode } as state;
	})

	const tabs: Record<LookupMode, string> = {
		item: "Item",
		npc: "Npc",
		object: "Loc",
		avatar: "Player",
		model: "Model",
		map: "Map",
		material: "Material",
		spotanim: "Spotanim",
		scenario: "Scenario",
		scripts: "Scripts"
	}

	let ModeComp = LookupModeComponentMap[state.mode];
	return (
		<React.Fragment>
			<TabStrip value={state.mode} tabs={tabs} onChange={setMode} />
			{ModeComp && <ModeComp initialId={state.search} ctx={p.ctx.canRender() ? p.ctx : null} partial={p.ctx} />}
		</React.Fragment>
	);
}

function ScenarioActionControl(p: { action: ScenarioAction, comp: ScenarioComponent | null, onChange: (v: ScenarioAction | null) => void }) {
	const action = p.action;
	let targetname = p.comp?.name ?? "??";
	let remove = <input type="button" className="sub-btn" value="x" onClick={() => p.onChange(null)} />;
	let gridstyle = (nparts: number) => ({
		display: "grid",
		gridTemplateColumns: (nparts <= 0 ? "1fr min-content" : `${nparts}fr repeat(${nparts},1fr) min-content`),
		alignItems: "baseline"
	} as React.CSSProperties);
	let spanstyle: React.CSSProperties = { minWidth: "0", overflow: "hidden", whiteSpace: "nowrap" };

	switch (action.type) {
		case "anim": {
			return (
				<div style={gridstyle(1)}>
					<span style={spanstyle}>{p.action.type} {targetname}</span>
					<InputCommitted type="number" value={action.animid} onChange={e => p.onChange({ ...action, animid: +e.currentTarget.value })} />
					{remove}
				</div>
			);
		}
		case "animset": {
			return (
				<div style={gridstyle(1)}>
					<span style={spanstyle}>{p.action.type} {targetname}</span>
					<select value={action.animid} onChange={e => p.onChange({ ...action, animid: +e.currentTarget.value })}>
						{Object.entries(action.anims).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
					</select>
					{remove}
				</div>
			);
		}
		case "delay": {
			return (
				<div style={gridstyle(1)}>
					<span style={spanstyle}>{p.action.type} (ms)</span>
					<InputCommitted type="number" value={action.duration} onChange={e => p.onChange({ ...action, duration: +e.currentTarget.value })} />
					{remove}
				</div>
			);
		}
		case "location": {
			return (
				<React.Fragment>
					<div style={gridstyle(0)}>
						<span style={spanstyle}>{p.action.type} {targetname}</span>
						{remove}
					</div>
					<div style={{ ...gridstyle(0), gridTemplateColumns: "1em 2fr repeat(2,minmax(0,1fr))" }}>
						<span style={{ gridColumn: "2" }}>Floor+offset</span>
						<InputCommitted type="number" value={action.level} step={1} onChange={e => p.onChange({ ...action, level: +e.currentTarget.value })} />
						<InputCommitted type="number" value={action.dy} onChange={e => p.onChange({ ...action, dy: +e.currentTarget.value })} />
						<span style={{ gridColumn: "2" }}>Position x,z</span>
						<InputCommitted type="number" value={action.x} onChange={e => p.onChange({ ...action, x: +e.currentTarget.value })} />
						<InputCommitted type="number" value={action.z} onChange={e => p.onChange({ ...action, z: +e.currentTarget.value })} />
						<span style={{ gridColumn: "2" }}>Rotation</span>
						<InputCommitted type="number" style={{ gridColumn: "span 2" }} value={action.rotation} onChange={e => p.onChange({ ...action, rotation: +e.currentTarget.value })} />
					</div>
				</React.Fragment>
			);
		}
		case "scale": {
			return (
				<div style={gridstyle(3)}>
					<span style={spanstyle}>{p.action.type} {targetname}</span>
					{/* xzy, put y last as that makes more sense for users */}
					<InputCommitted type="number" value={action.scalex} onChange={e => p.onChange({ ...action, scalex: +e.currentTarget.value })} />
					<InputCommitted type="number" value={action.scalez} onChange={e => p.onChange({ ...action, scalez: +e.currentTarget.value })} />
					<InputCommitted type="number" value={action.scaley} onChange={e => p.onChange({ ...action, scaley: +e.currentTarget.value })} />
					{remove}
				</div>
			);
		}
		case "visibility": {
			return (
				<div style={gridstyle(1)}>
					<span style={spanstyle}>{p.action.type} {targetname}</span>
					<label><input type="checkbox" checked={action.visible} onChange={e => p.onChange({ ...action, visible: e.currentTarget.checked })} /></label>
					{remove}
				</div>
			);
		}
	}
}

function convertScenarioComponent(comp: ScenarioComponent<"simple">): ScenarioComponent {
	let mods: Required<ModelModifications> = { replaceColors: [], replaceMaterials: [], lodLevel: -1 };
	if (comp.simpleModel.length != 0) {
		let firstmodel = comp.simpleModel[0];
		for (let col of firstmodel.mods.replaceColors ?? []) {
			if (comp.simpleModel.every(q => q.mods.replaceColors?.some(q => q[0] == col[0] && q[1] == col[1]))) {
				mods.replaceColors!.push(col);
			}
		}
		for (let mat of firstmodel.mods.replaceMaterials ?? []) {
			if (comp.simpleModel.every(q => q.mods.replaceMaterials?.some(q => q[0] == mat[0] && q[1] == mat[1]))) {
				mods.replaceMaterials!.push(mat);
			}
		}
	}
	let models = comp.simpleModel.map(model => ({
		...model,
		mods: {
			replaceColors: model.mods.replaceColors?.filter(q => !mods.replaceColors.some(col => col[0] == q[0] && col[1] == q[1])) ?? [],
			replaceMaterials: model.mods.replaceMaterials?.filter(q => !mods.replaceMaterials.some(mat => mat[0] == q[0] && mat[1] == q[1])) ?? []
		}
	}));
	let json = customModelJson(models, mods);
	return {
		type: "custom",
		modelkey: json,
		name: comp.name + "*",
		simpleModel: models,
		globalMods: mods,
		basecomp: comp.modelkey
	};
}

function RecolorList(p: { cols: NumPair[], onChange: (v: NumPair[]) => void, showAdd: boolean }) {
	let [addid, setAddid] = React.useState(0);

	let editcolor = (icol: number, v: number | null) => {
		let newcols = p.cols.slice() ?? [];
		if (v == null) { newcols.splice(icol, 1); }
		else { newcols[icol] = [newcols[icol][0], v]; }
		p.onChange(newcols);
	}
	if (!p.showAdd && p.cols.length == 0) {
		return null;
	}
	return (
		<div className="mv-overridegroup">
			<div style={{ gridColumn: "1/-1", textAlign: "center" }}>Color overrides</div>
			{p.cols.flatMap((col, i) => {
				return [
					<div key={`${i}a`}>{col[0]}</div>,
					<InputCommitted key={`${i}b`} type="color" value={hsl2hex(col[1])} onChange={e => editcolor(i, hex2hsl(e.currentTarget.value))} />,
					<input key={`${i}c`} type="button" className="sub-btn" value="x" onClick={e => editcolor(i, null)} />
				]
			})}
			<input type="number" value={addid} onChange={e => setAddid(+e.currentTarget.value)} />
			<input type="button" value="add color" className="sub-btn" onClick={e => p.onChange(p.cols.concat([[addid, 0]]))} />
		</div>
	)
}
function RematerialList(p: { mats: NumPair[], onChange: (v: NumPair[]) => void, showAdd: boolean }) {
	let [addid, setAddid] = React.useState(0);

	let editmaterial = (icol: number, v: number | null) => {
		let newcols = p.mats.slice() ?? [];
		if (v == null) { newcols.splice(icol, 1); }
		else { newcols[icol] = [newcols[icol][0], v]; }
		p.onChange(newcols);
	}
	if (!p.showAdd && p.mats.length == 0) {
		return null;
	}
	return (
		<div className="mv-overridegroup">
			<div style={{ gridColumn: "1/-1", textAlign: "center" }}>Material overrides</div>
			{p.mats.flatMap((col, i) => {
				return [
					<div key={`${i}a`}>{col[0]}</div>,
					<InputCommitted key={`${i}b`} type="number" value={col[1]} onChange={e => editmaterial(i, +e.currentTarget.value)} />,
					<input key={`${i}c`} type="button" className="sub-btn" value="x" onClick={e => editmaterial(i, null)} />
				]
			})}
			<input type="number" value={addid} onChange={e => setAddid(+e.currentTarget.value)} />
			<input type="button" value="add material" className="sub-btn" onClick={e => p.onChange(p.mats.concat([[addid, 0]]))} />
		</div>
	)
}

function ScenarionComponentModelSettings(p: { index: number, comp: SimpleModelDef[number], onChange: (i: number, v: SimpleModelDef[number] | null) => void }) {
	let [showopts, setShowopts] = React.useState(false);

	let editcolor = (v: NumPair[]) => {
		p.onChange(p.index, { ...p.comp, mods: { ...p.comp.mods, replaceColors: v } });
	}
	let editmats = (v: NumPair[]) => {
		p.onChange(p.index, { ...p.comp, mods: { ...p.comp.mods, replaceMaterials: v } });
	}

	let totaloverrides = (p.comp.mods.replaceColors?.length ?? 0) + (p.comp.mods.replaceMaterials?.length ?? 0);

	return (
		<React.Fragment>
			<div style={{ clear: "both", overflow: "hidden" }}>
				modelid: {p.comp.modelid}
				<input type="button" className="sub-btn" value="x" onClick={e => p.onChange(p.index, null)} style={{ float: "right" }} />
				<input type="button" className="sub-btn" value={showopts ? "collapse" : `overrides (${totaloverrides})`} onClick={e => setShowopts(!showopts)} style={{ float: "right" }} />
			</div>
			{showopts && (
				<div className="mv-overridegroup__border">
					<RecolorList cols={p.comp.mods.replaceColors ?? []} onChange={editcolor} showAdd={showopts} />
					<RematerialList mats={p.comp.mods.replaceMaterials ?? []} onChange={editmats} showAdd={showopts} />
				</div>
			)}
		</React.Fragment>
	);
}

function ScenarionComponentSettings(p: { comp: ScenarioComponent<"custom">, onChange: (v: ScenarioComponent | null) => void, showOpts: boolean }) {
	let [addid, setAddid] = React.useState(0);

	let addmodel = () => {
		let m = p.comp.simpleModel.concat({ modelid: addid, mods: {} });
		p.onChange({
			...p.comp,
			modelkey: customModelJson(m, p.comp.globalMods),
			simpleModel: m
		});
	}

	let change = (i: number, def: SimpleModelDef[number] | null) => {
		let m = p.comp.simpleModel.slice();
		if (def) { m[i] = def; }
		else { m.splice(i, 1); }

		p.onChange({
			...p.comp,
			modelkey: customModelJson(m, p.comp.globalMods),
			simpleModel: m
		});
	}
	let changeColors = (v: NumPair[]) => {
		let mods = { ...p.comp.globalMods, replaceColors: v };
		p.onChange({
			...p.comp,
			modelkey: customModelJson(p.comp.simpleModel, mods),
			globalMods: mods
		});
	}
	let changeMats = (v: NumPair[]) => {
		let mods = { ...p.comp.globalMods, replaceMaterials: v };
		p.onChange({
			...p.comp,
			modelkey: customModelJson(p.comp.simpleModel, mods),
			globalMods: mods
		});
	}

	return (
		<React.Fragment>
			{p.comp.simpleModel.map((q, i) => <ScenarionComponentModelSettings index={i} key={i} comp={q} onChange={change} />)}
			<div className="mv-overridegroup">
				<input type="number" value={addid} onChange={e => setAddid(+e.currentTarget.value)} />
				<input type="button" value="add model" className="sub-btn" onClick={addmodel} />
			</div>
			{p.showOpts && (
				<div className="mv-overridegroup__border">
					<RecolorList cols={p.comp.globalMods.replaceColors ?? []} onChange={changeColors} showAdd={true} />
					<RematerialList mats={p.comp.globalMods.replaceMaterials ?? []} onChange={changeMats} showAdd={true} />
				</div>
			)}
		</React.Fragment>
	);
}

// function editScenarioComponent(comp: ScenarioComponent, onChange: (v: ScenarioComponent | null) => void) {
// 	let box = showModal({ title: "Edit Component" }, <div>{<ScenarionComponentSettings comp={comp} onChange={onChange} />}</div>);
// }

function ScenarioComponentControl(p: { ctx: UIContextReady | null, comp: ScenarioComponent, onChange: (v: ScenarioComponent | null) => void }) {
	let [showOpts, setShowOpts] = React.useState(false);
	let edit = () => {
		if (p.comp.type == "simple") {
			p.onChange(convertScenarioComponent(p.comp));
			setShowOpts(true);
		}
	}
	let revert = async () => {
		if (p.comp.type != "custom" || !p.ctx) { return; }
		let def = await modelInitToModel(p.ctx.sceneCache, p.comp.basecomp);
		p.onChange({
			type: "simple",
			modelkey: p.comp.basecomp,
			name: p.comp.name.replace(/\*$/, ""),
			simpleModel: def.models
		});
	}

	return (
		<div style={{ display: "grid", gridTemplateColumns: "1fr min-content min-content min-content", alignItems: "baseline" }}>
			<div style={{ maxWidth: "100%", overflow: "hidden" }}>{p.comp.name}</div>
			{p.comp.type == "custom" && <input type="button" className="sub-btn" value={showOpts ? "-" : "+"} onClick={e => setShowOpts(!showOpts)} />}
			{p.comp.type == "simple" && <input type="button" className="sub-btn" value="edit" onClick={edit} />}
			{p.comp.type == "custom" && <input type="button" className="sub-btn" value="revert" onClick={revert} />}
			<input type="button" className="sub-btn" value="x" onClick={e => p.onChange(null)} />
			{p.comp.type == "custom" && showOpts && (
				<div style={{ gridColumn: "1/-1" }}>
					<ScenarionComponentSettings comp={p.comp} onChange={p.onChange} showOpts={showOpts} />
				</div>
			)}
		</div>
	)
}

type ScenarioComponentType = "simple" | "map" | "custom";

type ScenarioComponent<T = ScenarioComponentType> = {
	type: T,
	modelkey: string,
	name: string,
} & ({
	type: "simple",
	simpleModel: SimpleModelDef
} | {
	type: "map",
	mapRect: MapRect
} | {
	type: "custom",
	simpleModel: SimpleModelDef,
	globalMods: Required<ModelModifications>,
	basecomp: string
});

type ScenarioAction = {
	type: "location",
	target: number,
	x: number,
	z: number,
	level: number,
	dy: number,
	rotation?: number
} | {
	type: "scale",
	target: number,
	scalex: number,
	scaley: number,
	scalez: number
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

type ScenarioState = {
	components: Record<number, ScenarioComponent>,
	actions: ScenarioAction[],
}

type ScenarioInterfaceState = ScenarioState & {
	addActionTarget: number,
	addModelType: ModelInitTypes | "map",
	addActionType: ScenarioAction["type"]
};

function customModelJson(models: SimpleModelDef, globalmods: ModelModifications) {
	return JSON.stringify({ models: models, globalMods: globalmods });
}

function modeldefJsonToModel(cache: any, json: string): SimpleModelInfo<null, string> {
	let d: unknown = JSON.parse(json);
	assertSchema(d, customModelDefSchema);
	let models: SimpleModelDef = [];

	return {
		id: json,
		info: null,
		models: models,
		anims: {},
		name: "custom"
	}
}

type SimpleModelInitTypes = "model" | "item" | "loc" | "npc" | "spotanim" | "player";
type ModelInitTypes = SimpleModelInitTypes | "custom" | "map";
async function modelInitToModel(cache: ThreejsSceneCache, init: string): Promise<SimpleModelInfo<any, any>> {
	let [key] = init.split(":", 1) as [ModelInitTypes];
	let id = init.slice(key.length + 1);
	if (key == "model") { return modelToModel(cache, +id); }
	else if (key == "item") { return itemToModel(cache, +id); }
	else if (key == "npc") { return npcBodyToModel(cache, +id); }
	else if (key == "loc") { return locToModel(cache, +id); }
	else if (key == "spotanim") { return spotAnimToModel(cache, +id); }
	else if (key == "player") { return playerToModel(cache, id); }
	else if (key == "custom") { return modeldefJsonToModel(cache, id); }
	else { throw new Error("unknown modelinit type"); }
}

export class SceneScenario extends React.Component<LookupModeProps, ScenarioInterfaceState> {
	models = new Map<ScenarioComponent, RSModel | RSMapChunk | RSMapChunkGroup>();
	idcounter = 0;
	mapoffset: { x: number, z: number } | null = null;
	mapgrid = new CombinedTileGrid([]);
	hadctx = false;

	constructor(p: LookupModeProps) {
		super(p);
		this.state = {
			actions: [],
			components: {},
			addModelType: "model",
			addActionType: "anim",
			addActionTarget: -1
		};
		this.loadFromJson(p.initialId, true);
	}

	loadFromJson(str: unknown, isinit = false) {
		let newstate = parseJsonOrDefault<ScenarioState>(str, scenarioStateSchema, () => {
			if (!isinit) { throw new Error("invalid state json"); }
			return { actions: [], components: {} };
		});
		let keys = Object.keys(newstate.components);
		this.idcounter = (keys.length == 0 ? 0 : Math.max.apply(null, keys) + 1);
		this.hadctx = false;
		if (isinit) {
			Object.assign(this.state, newstate);
		} else {
			this.setSceneState(newstate.components, newstate.actions);
		}
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
				type: "map",
				modelkey: `${this.state.addModelType}:${id}`,
				name: `map${id}`,
				mapRect: rect
			});
		} else {
			let prim = await modelInitToModel(this.props.ctx.sceneCache, `${this.state.addModelType}:${id}`);
			let compid = this.idcounter++;
			this.editComp(compid, {
				type: "simple",
				modelkey: `${this.state.addModelType}:${id}`,
				name: `${this.state.addModelType}:${id}`,
				simpleModel: prim.models
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
				action = { type: "location", target: this.state.addActionTarget, level: 0, x: 0, z: 0, dy: 0, rotation: 0 };
				break;
			case "visibility":
				action = { type: "visibility", target: this.state.addActionTarget, visible: true };
				break;
			case "scale":
				action = { type: "scale", target: this.state.addActionTarget, scalex: 1, scaley: 1, scalez: 1 };
				break;
			default:
				throw new Error("unknown action " + this.state.addActionType);
		}
		this.editAction(this.state.actions.length, action);
	}

	@boundMethod
	getSceneJson(newstate: ScenarioState = this.state) {
		return JSON.stringify({ components: newstate.components, actions: newstate.actions });
	}

	setSceneState(components: Record<number, ScenarioComponent> | null, actions: ScenarioAction[] | null) {
		this.setState(prev => {
			let scenestate: ScenarioState = {
				components: components ?? prev.components,
				actions: actions ?? prev.actions
			};
			//double json is correct in this case
			localStorage.rsmv_lastsearch = JSON.stringify(this.getSceneJson(scenestate));
			return scenestate;
		});
	}

	ensureComp(uictx: UIContextReady, newcomp: ScenarioComponent | null, oldcomp: ScenarioComponent | null) {
		let newmodel: RSModel | RSMapChunk | RSMapChunkGroup | undefined = undefined;
		if (oldcomp) {
			let oldmodel = this.models.get(oldcomp);
			if (newcomp && oldcomp.modelkey == newcomp.modelkey) {
				newmodel = oldmodel;
			} else {
				this.models.delete(oldcomp);
				oldmodel?.cleanup();
			}
		}
		if (newcomp) {
			if (!newmodel) {
				if (newcomp.type == "simple") {
					newmodel = new RSModel(uictx.sceneCache, newcomp.simpleModel, newcomp.name);
				} else if (newcomp.type == "custom") {
					let mappedmodel = newcomp.simpleModel.map<SimpleModelDef[number]>(model => ({
						...model,
						mods: {
							replaceColors: (model.mods.replaceColors ?? []).concat(newcomp.globalMods.replaceColors),
							replaceMaterials: (model.mods.replaceMaterials ?? []).concat(newcomp.globalMods.replaceMaterials)
						}
					}))
					newmodel = new RSModel(uictx.sceneCache, mappedmodel, newcomp.name);
				} else if (newcomp.type == "map") {
					newmodel = new RSMapChunkGroup(uictx.sceneCache, newcomp.mapRect, { collision: false, invisibleLayers: false, map2d: false, skybox: true });
					newmodel.on("loaded", this.updateGrids);
					let hasmap = Object.values(this.state.components).some(q => q.type == "map");
					if (!hasmap || !this.mapoffset) {
						this.mapoffset = {
							x: (newcomp.mapRect.x + newcomp.mapRect.xsize / 2) * rs2ChunkSize,
							z: (newcomp.mapRect.z + newcomp.mapRect.zsize / 2) * rs2ChunkSize
						};
					}
					newmodel.chunks.forEach(q => q.rootnode.position.set(-this.mapoffset!.x * tiledimensions, 0, -this.mapoffset!.z * tiledimensions));
				} else {
					throw new Error("invalid model init");
				}
				newmodel.addToScene(uictx.renderer);
			}
			this.models.set(newcomp, newmodel);
		}
	}

	editComp(compid: number, newcomp: ScenarioComponent | null) {
		if (!this.props.ctx) { return; }
		let components = { ...this.state.components };
		let oldcomp = this.state.components[compid];
		this.ensureComp(this.props.ctx, newcomp, oldcomp);
		if (newcomp) {
			components[compid] = newcomp;
		} else {
			delete components[compid];
			this.setSceneState(null, this.state.actions.filter(q => q.target != compid));
		}
		this.setSceneState(components, null);
		if (!components[this.state.addActionTarget]) {
			let ids = Object.keys(components)
			this.setState({ addActionTarget: (ids.length == 0 ? 0 : +ids[ids.length - 1]) });
		}
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
		this.setSceneState(null, actions);
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
			if (comp.type != "map") { continue }
			let model = this.models.get(comp);
			let chunks: RSMapChunk[] = [];
			if (model instanceof RSMapChunk) { chunks.push(model); }
			else if (model instanceof RSMapChunkGroup) { chunks.push(...model.chunks); }
			else { continue; }
			for (let chunk of chunks) {
				if (!chunk.loaded) { continue; }
				grids.push({
					src: chunk.loaded.grid,
					rect: {
						x: chunk.chunkx * rs2ChunkSize,
						z: chunk.chunkz * rs2ChunkSize,
						xsize: rs2ChunkSize,
						zsize: rs2ChunkSize
					}
				});
			}
		}
		this.mapgrid = new CombinedTileGrid(grids);
		this.restartAnims();
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
					model?.rootnode.rotation.set(0, ((action.rotation ?? 0) * Math.PI) / 4, 0);
					break;
				}
				case "scale": {
					let model = this.modelIdToModel(action.target);
					model?.rootnode.scale.set(action.scalex, action.scaley, action.scalez);
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

	@boundMethod
	advancedIdSelect() {
		if (!this.props.ctx) { return; }
		if (this.state.addModelType == "npc") {
			selectEntity(this.props.ctx, "npcs", id => this.addComp("" + id), [{ path: ["name"], search: "" }])
		} else if (this.state.addModelType == "item") {
			selectEntity(this.props.ctx, "items", id => this.addComp("" + id), [{ path: ["name"], search: "" }])
		} else if (this.state.addModelType == "loc") {
			selectEntity(this.props.ctx, "objects", id => this.addComp("" + id), [{ path: ["name"], search: "" }])
		}
	}

	render() {
		if (!this.hadctx && this.props.ctx) {
			this.hadctx = true;
			Object.entries(this.state.components).forEach(([key, comp]) => this.ensureComp(this.props.ctx!, comp, this.state.components[key]));
			this.restartAnims();
		}
		const hasmodels = Object.keys(this.state.components).length != 0;
		const hasAdvLookup = this.state.addModelType == "item" || this.state.addModelType == "loc" || this.state.addModelType == "npc";
		return (
			<React.Fragment>
				<div className="mv-sidebar-scroll">
					<h2>Models</h2>
					<div>
						<CopyButton getText={this.getSceneJson} />
						<PasteButton onPaste={v => this.loadFromJson(v, false)} />
					</div>
					<div style={{ display: "flex", flexDirection: "column" }}>
						<select value={this.state.addModelType} onChange={e => this.setState({ addModelType: e.currentTarget.value as any })}>
							<option value="model">model</option>
							<option value="npc">npc</option>
							<option value="spotanim">spotanim</option>
							<option value="loc">location</option>
							<option value="player">player</option>
							<option value="item">item</option>
							<option value="map">map</option>
						</select>
						<div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) min-content" }}>
							<StringInput onChange={this.addComp} />
							{hasAdvLookup && <input type="button" className="sub-btn" value="Lookup" onClick={this.advancedIdSelect} />}
						</div>
					</div>
					{!hasmodels && <p>Select a model type and id to add to the scene.</p>}
					{hasmodels && <br />}
					{hasmodels && (
						<div className="mv-inset">
							{Object.entries(this.state.components).map(([id, comp]) => {
								return <ScenarioComponentControl key={id} ctx={this.props.ctx} comp={comp} onChange={e => this.editComp(+id, e)} />;
							})}
						</div>
					)}
					<h2>Action sequence</h2>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr min-content" }}>
						<select value={this.state.addActionType} onChange={e => this.setState({ addActionType: e.currentTarget.value as any })}>
							<option value="location">Location</option>
							<option value="scale">Scale</option>
							<option value="anim">Anim</option>
							<option value="delay">Delay</option>
							<option value="visibility">Visibility</option>
						</select>
						<select disabled={this.state.addActionType == "delay"} value={this.state.addActionType == "delay" ? -1 : this.state.addActionTarget} onChange={e => this.setState({ addActionTarget: +e.currentTarget.value })}>
							{Object.entries(this.state.components).map(([key, c]) => <option key={key} value={key}>{c.name}</option>)}
							{this.state.addActionType == "delay" && <option value="-1"></option>}
						</select>
						<input type="button" className="sub-btn" value="add" onClick={this.addAction} />
					</div>
					<div onClick={this.restartAnims}>restart</div>
					{this.state.actions.length != 0 && <br />}
					{this.state.actions.length != 0 && (
						<div className="mv-inset">
							{this.state.actions.map((a, i) => {
								let comp = this.state.components[a.target]
								return <ScenarioActionControl key={i} comp={comp} action={a} onChange={e => this.editAction(i, e)} />
							})}
						</div>
					)}
				</div>
			</React.Fragment>
		)
	}
}

function ScenePlayer(p: LookupModeProps) {
	const [data, model, id, setId] = useAsyncModelData(p.ctx, playerDataToModel);
	const [errtext, seterrtext] = React.useState("");
	const forceUpdate = useForceUpdate();

	const player = id?.player ?? (p.initialId && typeof p.initialId == "object" && typeof (p.initialId as any).player == "string" ? (p.initialId as any).player : "");
	const head = id?.head ?? (p.initialId && typeof p.initialId == "object" && typeof (p.initialId as any).head == "boolean" ? (p.initialId as any).head : false);

	const oncheck = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (id) { setId({ player: id.player, data: id.data, head: e.currentTarget.checked }); }
	}
	const nameChange = async (v: string) => {
		if (v.length <= 20) {
			let url = appearanceUrl(v);
			let data = await fetch(url).then(q => q.text());
			if (data.indexOf("404 - Page not found") != -1) {
				seterrtext(`Player avatar not found for '${v}'.`)
				return;
			}
			let buf = avatarStringToBytes(data);
			setId({ player: v, data: buf, head });
			seterrtext("");
		} else {
			try {
				let buf = avatarStringToBytes(v);
				setId({ player: "", data: buf, head: head });
				seterrtext("");
			} catch (e) {
				seterrtext("invalid avatar base64 string");
			}
		}
	}

	const equipChanged = (index: number, type: "item" | "kit" | "none", equipid: number) => {
		let oldava = data?.info.avatar;
		if (!oldava) { console.trace("unexpected"); return; }
		let newava = { ...oldava };
		newava.slots = oldava.slots.slice() as any;
		if (type == "none") {
			newava.slots[index] = { slot: null, cust: null };
		} else {
			newava.slots[index] = { slot: { type, id: equipid } as EquipSlot, cust: null };
		}
		let avabuf = writeAvatar(newava, data?.info.gender ?? 0, null);
		setId({ player, data: avabuf, head });
	}

	const customizationChanged = (index: number, cust: EquipCustomization) => {
		let oldava = data?.info.avatar;
		if (!oldava) { console.trace("unexpected"); return; }
		let newava = { ...oldava };
		newava.slots = oldava.slots.slice() as any;
		newava.slots[index] = { ...oldava.slots[index], cust };
		let avabuf = writeAvatar(newava, data?.info.gender ?? 0, null);
		setId({ player, data: avabuf, head });
	}

	const setGender = (gender: number) => {
		if (!data?.info.avatar) { console.trace("unexpected"); return; }
		let avabuf = writeAvatar(data.info.avatar, gender, null);
		setId({ player, data: avabuf, head });
	}

	const changeColor = (colid: keyof avataroverrides, index: number) => {
		let oldava = data?.info.avatar;
		if (!oldava) { console.trace("unexpected"); return; }
		let newava = { ...oldava };
		newava[colid] = index as any;
		let avabuf = writeAvatar(newava, data?.info.gender ?? 0, null);
		setId({ player, data: avabuf, head });
	}

	const colorDropdown = (id: keyof avataroverrides, v: number, opts: Record<number, number>) => {
		return (
			<LabeledInput label={id}>
				<select value={v} onChange={e => changeColor(id, +e.currentTarget.value)} style={{ backgroundColor: hsl2hex(opts[v]) }}>
					{Object.entries(opts).map(([i, v]) => <option key={i} value={i} style={{ backgroundColor: hsl2hex(v) }}>{i}</option>)}
				</select>
			</LabeledInput>
		)
	}

	return (
		<React.Fragment>
			<StringInput onChange={nameChange} initialid={player} />
			{errtext && (<div className="mv-errortext" onClick={e => seterrtext("")}>{errtext}</div>)}
			{id == null && (
				<React.Fragment>
					<p>Type a player name to view their 3d avatar. You can then customize the avatar appearance.</p>
					<p>You can update your avatar by going to the photo booth southwest of falador in-game</p>
				</React.Fragment>
			)}
			{data && (
				<LabeledInput label="Animation">
					<select onChange={e => { model?.setAnimation(+e.currentTarget.value); forceUpdate() }} value={model?.targetAnimId ?? -1}>
						{Object.entries(data.anims).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
					</select>
				</LabeledInput>
			)}
			{data && <label><input type="checkbox" checked={head} onChange={oncheck} />Head</label>}
			<div className="mv-sidebar-scroll">
				{data && <h2>Slots</h2>}
				<div style={{ userSelect: "text" }}>
					{p.ctx && data?.info.avatar?.slots.map((q, i) => {
						return (
							<AvatarSlot key={i} index={i} slot={q.slot} cust={q.cust} ctx={p.ctx!} custChanged={customizationChanged} female={data.info.gender == 1} equipChanged={equipChanged} />
						);
					})}
				</div>
				{data && <h2>Settings</h2>}
				{data && (
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
						<input type="button" className={classNames("sub-btn", { active: data.info.gender == 0 })} onClick={e => setGender(0)} value="Male" />
						<input type="button" className={classNames("sub-btn", { active: data.info.gender == 1 })} onClick={e => setGender(1)} value="Female" />
					</div>
				)}
				{data?.info.avatar && colorDropdown("haircol0", data.info.avatar.haircol0, data.info.kitcolors.hair)}
				{data?.info.avatar && colorDropdown("haircol1", data.info.avatar.haircol1, data.info.kitcolors.hair)}
				{data?.info.avatar && colorDropdown("bodycol", data.info.avatar.bodycol, data.info.kitcolors.clothes)}
				{data?.info.avatar && colorDropdown("legscol", data.info.avatar.legscol, data.info.kitcolors.clothes)}
				{data?.info.avatar && colorDropdown("bootscol", data.info.avatar.bootscol, data.info.kitcolors.feet)}
				{data?.info.avatar && colorDropdown("skincol0", data.info.avatar.skincol0, data.info.kitcolors.skin)}
				{data?.info.avatar && colorDropdown("skincol1", data.info.avatar.skincol1, data.info.kitcolors.skin)}
				{data && (
					<React.Fragment>
						<h2>Export</h2>
						<p>Use the export button at the top of the sidebar to export the model.</p>
						<p>Use this button to copy the customized avatar for later use. You can paste it in the name field</p>
						<CopyButton text={bytesToAvatarString(data.info.buffer)} />
					</React.Fragment>
				)}
			</div>
		</React.Fragment>
	);
}

function AvatarSlot({ index, slot, cust, custChanged, equipChanged, ctx, female }: { ctx: UIContextReady, index: number, slot: EquipSlot | null, female: boolean, cust: EquipCustomization, equipChanged: (index: number, type: "kit" | "item" | "none", id: number) => void, custChanged: (index: number, v: EquipCustomization) => void }) {

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
		let kitid = (female ? slotToKitFemale : slotToKitMale)[index] ?? -1;
		selectEntity(ctx, "identitykit", i => equipChanged(index, "kit", i), [{ path: ["bodypart"], search: kitid + "" }]);
	}

	return (
		<div>
			{slot && (
				<div style={{ display: "grid", gridTemplateColumns: "auto repeat(10,min-content)" }}>
					<span>{slot.name}</span>
					{!cust?.color?.col2 && !cust?.color?.col4 && slot.replaceColors.length != 0 && (
						<input type="button" className="sub-btn" value="C" title="Recolor using predefined recolor slots" onClick={e => editcust(c => c.color = { col4: null, col2: slot.replaceColors.map(q => q[1]) })} />
					)}
					{!cust?.color?.col2 && !cust?.color?.col4 && (
						<input type="button" className="sub-btn" value="C4" title="Force recolor 4 colors" onClick={e => editcust(c => c.color = { col4: [[0, 0], [0, 0], [0, 0], [0, 0]], col2: null })} />
					)}
					{!cust?.material && slot.replaceMaterials.length != 0 && (
						<input type="button" className="sub-btn" value="T" title="Replace material in predefined material slots" onClick={e => editcust(c => c.material = { header: 0, materials: slot.replaceMaterials.map(q => q[1]) })} />
					)}
					{!cust?.model && (
						<input type="button" className="sub-btn" value="M" title="Replace models" onClick={e => editcust(c => c.model = slot.models.slice())} />
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
				<div style={{ display: "grid", gridTemplateColumns: `repeat(${slot.replaceColors.length},1fr) min-content` }}>
					{slot.replaceColors.map((q, i) => (
						<InputCommitted key={i} type="color" value={hsl2hex(cust.color!.col2![i])} onChange={e => editcust(c => c.color!.col2![i] = hex2hsl(e.currentTarget.value))} />
					))}
					<input type="button" className="sub-btn" value="x" onClick={e => editcust(c => c.color = null!)} />
				</div>
			)}
			{slot && cust?.color?.col4 && (
				<div style={{ display: "grid", gridTemplateColumns: `repeat(4,minmax(0,1fr)) min-content`, gridTemplateRows: "auto auto", gridAutoFlow: "column" }}>
					{cust.color.col4.map(([from, to], i) => (
						<React.Fragment key={i}>
							<InputCommitted type="number" value={from} onChange={e => editcust(c => c.color!.col4![i][0] = +e.currentTarget.value)} />
							<InputCommitted type="color" value={hsl2hex(to)} onChange={e => editcust(c => c.color!.col4![i][1] = hex2hsl(e.currentTarget.value))} />
						</React.Fragment>
					))}
					<input type="button" style={{ gridRow: "1/span 2" }} className="sub-btn" value="x" onClick={e => editcust(c => c.color = null!)} />
				</div>
			)}
			{slot && cust?.material && (
				<div style={{ display: "grid", gridTemplateColumns: `repeat(${slot.replaceMaterials.length},1fr) min-content` }}>
					{slot.replaceMaterials.map((q, i) => (
						<InputCommitted key={i} type="number" value={cust.material!.materials![i]} onChange={e => editcust(c => c.material!.materials[i] = +e.currentTarget.value)} />
					))}
					<input type="button" className="sub-btn" value="x" onClick={e => editcust(c => c.material = null!)} />
				</div>
			)}
			{slot && cust?.model && (
				<div style={{ display: "grid", gridTemplateColumns: `repeat(${slot.models.length},1fr) min-content` }}>
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


type ExportImgSize = { w: number, h: number, mode: RenderCameraMode, name: string };
const exportimgsizes: ExportImgSize[] = [
	{ w: 0, h: 0, mode: "standard", name: "View" },
	{ w: 1920, h: 1080, mode: "standard", name: "1080p" },
	{ w: 2560, h: 1440, mode: "standard", name: "1440p" },
	{ w: 3840, h: 2160, mode: "standard", name: "4K" },
	{ w: 0, h: 0, mode: "vr360", name: "View" },
	{ w: 2048, h: 1024, mode: "vr360", name: "2:1K" },
	{ w: 4096, h: 2048, mode: "vr360", name: "4:2K" },
	{ w: 0, h: 0, mode: "topdown", name: "View" },
	{ w: 512, h: 512, mode: "topdown", name: "" },
	{ w: 1024, h: 1024, mode: "topdown", name: "" },
	{ w: 2048, h: 2048, mode: "topdown", name: "" },
]

function ExportSceneMenu(p: { ctx: UIContextReady, renderopts: ThreeJsSceneElement["options"] }) {
	let [tab, settab] = React.useState<"img" | "gltf" | "stl" | "none">("none");
	let [img, setimg] = React.useState<{ cnv: HTMLCanvasElement, data: ImageData } | null>(null);
	let [imgsize, setimgsize] = React.useState<ExportImgSize>(exportimgsizes.find(q => q.mode == p.renderopts!.camMode) ?? exportimgsizes[0]);
	let [cropimg, setcropimg] = React.useState(true);

	let changeImg = async (instCrop = cropimg, instSize = imgsize) => {
		if (p.renderopts!.camMode == "vr360") { instCrop = false; }

		let newpixels = await p.ctx.renderer.takeScenePicture(instSize.w || undefined, instSize.h || undefined);
		let newimg = makeImageData(newpixels.data, newpixels.width, newpixels.height);
		let cnv = document.createElement("canvas");
		let ctx = cnv.getContext("2d")!;
		if (instCrop) {
			let bounds = findImageBounds(newimg);
			cnv.width = bounds.width;
			cnv.height = bounds.height;
			ctx.putImageData(newimg, -bounds.x, -bounds.y);
		} else {
			cnv.width = newimg.width;
			cnv.height = newimg.height;
			ctx.putImageData(newimg, 0, 0)
		}
		settab("img");
		setcropimg(instCrop);
		setimgsize(instSize);
		setimg({ cnv, data: newimg });
	}
	if (tab == "img" && p.renderopts!.camMode == "vr360" && cropimg) {
		changeImg();
	}


	let saveimg = async () => {
		if (!img) { return; }
		let blob = await new Promise<Blob | null>(d => img!.cnv.toBlob(d));
		if (!blob) { return; }
		downloadBlob("runeapps_image_export.png", blob);
	}

	let copyimg = async () => {
		//@ts-ignore
		navigator.clipboard.write([
			//@ts-ignore
			new ClipboardItem({ 'image/png': await new Promise<Blob | null>(d => img!.cnv.toBlob(d)) })
		]);
	}

	let saveGltf = async () => {
		let file = await exportThreeJsGltf(p.ctx.renderer.getModelNode());
		downloadBlob("model.glb", new Blob([file]));
	}

	let saveStl = async () => {
		let file = await exportThreeJsStl(p.ctx.renderer.getModelNode());
		downloadBlob("model.stl", new Blob([file]));
	}

	let clicktab = (v: typeof tab) => {
		settab(v);
		if (v == "img") { changeImg(cropimg); }
	}

	let show360modal = () => {
		const src = img!.cnv;
		showModal({ title: "360 preview of render" }, (
			<React.Fragment>
				<VR360View img={src} />
			</React.Fragment>
		));
	}

	return (
		<div className="mv-inset">
			<TabStrip value={tab} tabs={{ gltf: "GLTF", stl: "STL", img: "image" }} onChange={clicktab as any} />
			{tab == "img" && (
				<React.Fragment>
					<div style={{ display: "grid", gridTemplateColumns: "1fr minmax(0,1fr)" }}>
						Export image size
						<select value={exportimgsizes.indexOf(imgsize)} onChange={e => changeImg(undefined, exportimgsizes[e.currentTarget.value])}>
							{exportimgsizes.map((q, i) => (
								q.mode == p.renderopts!.camMode && <option key={i} value={i}>{q.name}{q.w != 0 ? ` ${q.w}x${q.h}` : ""}</option>
							))}
						</select>
					</div>
					{p.renderopts!.camMode != "vr360" && <label><input type="checkbox" checked={cropimg} onChange={e => changeImg(e.currentTarget.checked)} />Crop image</label>}
					{p.renderopts!.camMode == "vr360" && <input type="button" className="sub-btn" onClick={show360modal} value="Preview 360" />}
					{img && <CanvasView canvas={img.cnv} />}
					<div style={{ display: "grid", grid: "'a b' / 1fr 1fr" }}>
						<input type="button" className="sub-btn" value="Save" onClick={saveimg} />
						<input type="button" className="sub-btn" value="Clipboard" onClick={copyimg} />
					</div>
				</React.Fragment>
			)}
			{tab == "gltf" && (
				<React.Fragment>
					<p>GLTF is a lightweight 3d format designed for modern but simple model exports. Colors, textures and animations will be included, but advanced lighting effects are lost.</p>
					<input style={{ width: "100%" }} type="button" className="sub-btn" value="Save" onClick={saveGltf} />
				</React.Fragment>
			)}
			{tab == "stl" && (
				<React.Fragment>
					<p>STL is used mostly for 3d printing, this file format only exports the shape of the model. Colors, textures animations will be lost.</p>
					<input style={{ width: "100%" }} type="button" className="sub-btn" value="Save" onClick={saveStl} />
				</React.Fragment>
			)}
			{tab == "none" && (
				<p>Select an export type</p>
			)}
		</div>
	)
}

export function RendererControls(p: { ctx: UIContext }) {
	const elconfig = React.useRef<ThreeJsSceneElement>({ options: {} });
	const sceneEl = React.useRef<ThreeJsSceneElementSource>({ getSceneElements() { return elconfig.current } });

	let [showsettings, setshowsettings] = React.useState(localStorage.rsmv_showsettings == "true");
	let [showexport, setshowexport] = React.useState(false);
	let [hideFog, sethidefog] = React.useState(true);
	let [hideFloor, sethidefloor] = React.useState(false);
	let [camMode, setcammode] = React.useState<"standard" | "vr360" | "topdown">("standard");
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
	}, [render]);

	const toggleSettings = React.useCallback(() => {
		localStorage.rsmv_showsettings = "" + !showsettings;
		setshowsettings(!showsettings);
	}, [showsettings]);

	return (
		<React.Fragment>
			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
				<input type="button" className={classNames("sub-btn", { "active": showexport })} onClick={e => setshowexport(!showexport)} value="Export" />
				<input type="button" className={classNames("sub-btn", { "active": showsettings })} onClick={toggleSettings} value="Settings" />
			</div>
			{showsettings && (
				<div className="mv-inset" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
					<label><input type="checkbox" checked={hideFog} onChange={e => sethidefog(e.currentTarget.checked)} />Hide fog</label>
					<label><input type="checkbox" checked={hideFloor} onChange={e => sethidefloor(e.currentTarget.checked)} />Hide floor</label>
					<label><input type="checkbox" checked={camControls == "world"} onChange={e => setcamcontrols(e.currentTarget.checked ? "world" : "free")} />Flat panning</label>
					<label>
						<select value={camMode} onChange={e => setcammode(e.currentTarget.value as any)}>
							<option value="standard">Standard camera</option>
							<option value="topdown">Orthogonal camera</option>
							<option value="vr360">360 Camera</option>
						</select>
					</label>
				</div>
			)}
			{showexport && p.ctx.canRender() && <ExportSceneMenu ctx={p.ctx} renderopts={newopts} />}
		</React.Fragment>
	)
}

function ImageDataView(p: { img: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap | ImageData }) {
	let ref = React.useCallback((cnv: HTMLCanvasElement | null) => {
		if (cnv) {
			let ctx = cnv.getContext("2d")!;
			drawTexture(ctx, p.img);
		}
	}, [p.img]);

	return (
		<canvas ref={ref} className="mv-image-preview-canvas" />
	)
}

function useAsyncModelData<ID, T>(ctx: UIContextReady | null, getter: (cache: ThreejsSceneCache, id: ID) => Promise<SimpleModelInfo<T, ID>>) {
	let pendingId = React.useRef<ID | null>(null);
	let [loadedModel, setLoadedModel] = React.useState<RSModel | null>(null);
	let [visible, setVisible] = React.useState<SimpleModelInfo<T, ID> | null>(null);
	let [loadedId, setLoadedId] = React.useState<ID | null>(null);
	let setter = React.useCallback(async (id: ID) => {
		if (!ctx) { return; }
		pendingId.current = id;
		try {
			let res = await getter(ctx.sceneCache, id);
			if (pendingId.current == id) {
				localStorage.rsmv_lastsearch = JSON.stringify(id);
				setVisible(res);
				setLoadedId(id);
			}
		} catch (err) {
			if (pendingId.current == id) {
				localStorage.rsmv_lastsearch = JSON.stringify(id);
				setVisible(null);
				setLoadedId(id);
				console.error(err);//TODO make ui
			}
		}
	}, [ctx]);
	React.useLayoutEffect(() => {
		if (visible && ctx) {
			let model = new RSModel(ctx.sceneCache, visible.models, visible.name);
			if (visible.anims.default) {
				model.setAnimation(visible.anims.default);
			}
			model.addToScene(ctx.renderer);
			model.model.then(m => {
				if (visible && pendingId.current == visible.id) {
					setLoadedModel(model);
				}
			});
			return () => {
				model.cleanup();
			}
		}
	}, [visible, ctx]);
	return [visible, loadedModel, loadedId, setter] as [state: SimpleModelInfo<T> | null, model: RSModel | null, id: ID | null, setter: (id: ID) => void];
}

type MaterialIshId = { mode: "material" | "underlay" | "overlay" | "texture", id: number };
async function materialIshToModel(sceneCache: ThreejsSceneCache, reqid: MaterialIshId) {
	let matid = -1;
	let color = [255, 0, 255];
	let json: any = null;
	let texs: Record<string, { texid: number, filesize: number, img0: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap }> = {};
	let models: SimpleModelDef = [];
	let addtex = async (type: keyof MaterialData["textures"], name: string, texid: number, stripalpha: boolean) => {
		let tex = await sceneCache.getTextureFile(type, texid, stripalpha);
		let drawable = await tex.toWebgl();

		texs[name] = { texid, filesize: tex.filesize, img0: drawable };
	}

	let overlay: mapsquare_overlays | null = null;
	let underlay: mapsquare_underlays | null = null;
	if (reqid.mode == "overlay") {
		overlay = sceneCache.engine.mapOverlays[reqid.id];
		if (overlay.material) { matid = overlay.material; }
		if (overlay.color) { color = overlay.color; }
	} else if (reqid.mode == "underlay") {
		underlay = sceneCache.engine.mapUnderlays[reqid.id];
		if (underlay.material) { matid = underlay.material; }
		if (underlay.color) { color = underlay.color; }
	} else if (reqid.mode == "material") {
		matid = reqid.id;
	} else if (reqid.mode == "texture") {
		await addtex("diffuse", "original", reqid.id, false);
		await addtex("diffuse", "opaque", reqid.id, true);
	} else {
		throw new Error("invalid materialish mode");
	}

	let assetid = constModelsIds.materialCube;
	let mods: ModelModifications = {
		replaceMaterials: [[0, matid]],
		replaceColors: [[
			HSL2packHSL(...RGB2HSL(255, 255, 255)),
			HSL2packHSL(...RGB2HSL(...color as [number, number, number]))
		]]
	};
	let mat = sceneCache.engine.getMaterialData(matid);
	for (let tex in mat.textures) {
		if (mat.textures[tex] != 0) {
			await addtex(tex as any, tex, mat.textures[tex], mat.stripDiffuseAlpha && tex == "diffuse");
		}
	}
	json = mat;
	models.push({ modelid: assetid, mods });

	return castModelInfo({
		models: models,
		anims: {},
		info: { overlay, underlay, texs, obj: json },
		id: reqid,
		name: `${reqid.mode}:${reqid.id}`
	});
}

function SceneMaterialIsh(p: LookupModeProps) {
	let [data, model, id, setId] = useAsyncModelData(p.ctx, materialIshToModel);

	let initid = id ?? checkObject(p.initialId, { mode: "string", id: "number" }) as MaterialIshId ?? { mode: "material", id: 0 };
	let modechange = (v: React.FormEvent<HTMLInputElement>) => setId({ mode: v.currentTarget.value as any, id: initid.id });
	let isproc = p.ctx?.sceneCache.textureType == "fullproc";
	return (
		<React.Fragment>
			<IdInput onChange={v => setId({ ...initid, id: v })} initialid={initid.id} />
			<div >
				<label><input type="radio" name="mattype" value="material" checked={initid.mode == "material"} onChange={modechange} />Material</label>
				<label><input type="radio" name="mattype" value="underlay" checked={initid.mode == "underlay"} onChange={modechange} />Underlay</label>
				<label><input type="radio" name="mattype" value="overlay" checked={initid.mode == "overlay"} onChange={modechange} />Overlay</label>
				<label><input type="radio" name="mattype" value="texture" checked={initid.mode == "texture"} onChange={modechange} />Texture</label>
			</div>
			{id == null && (
				<React.Fragment>
					<p>Enter a material id.</p>
					<p>Materials define how a piece of geometry looks, besides the color texture they also define how the model interacts with light to create highlights and reflections.</p>
				</React.Fragment>
			)}
			<div className="mv-sidebar-scroll">
				{data && Object.entries(data.info.texs).map(([name, img]) => (
					<div key={name}>
						{isproc && data && p.ctx && (
							<input type="button" className="sub-btn" value="Debug proc" onClick={async () => {
								let el = await debugProcTexture(p.ctx!.sceneCache.engine, img.texid);
								el.style.position = "initial";
								showModal({ title: "proc texture " + img.texid, maxWidth: "unset" }, <DomWrap el={el} />);
							}} />
						)}
						<div>{name} - {img.texid} - {img.filesize > 10000 ? `${img.filesize / 1024 | 0}kb` : `${img.filesize} bytes`} - {img.img0.width}x{img.img0.height}</div>
						<ImageDataView img={img.img0} />
					</div>
				))}
				{data?.info.overlay && <JsonDisplay obj={data?.info.overlay} />}
				{data?.info.underlay && <JsonDisplay obj={data?.info.underlay} />}
				<JsonDisplay obj={data?.info.obj} />
			</div>
		</React.Fragment>
	)
}

function SceneRawModel(p: LookupModeProps) {
	let [data, model, id, setId] = useAsyncModelData(p.ctx, modelToModel);
	let initid = (typeof p.initialId == "number" ? p.initialId : 0);
	return (
		<React.Fragment>
			<IdInput onChange={setId} initialid={id ?? initid} />
			{id == null && (
				<React.Fragment>
					<p>Enter a model id.</p>
					<p>This lookup shows raw models on their own.</p>
				</React.Fragment>
			)}
			{data && (
				<div className="mv-sidebar-scroll">
					<JsonDisplay obj={{ ...data?.info.modeldata, meshes: undefined }} />
					<JsonDisplay obj={data?.info.info} />
				</div>
			)}
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
			{p.ctx && <IdInputSearch cache={p.ctx.sceneCache.engine} mode="objects" onChange={setId} initialid={initid} />}
			{id == null && (
				<React.Fragment>
					<p>Enter a location id or search by name.</p>
					<p>Locations make up just about everything in the world that isn't a player or NPC.</p>
				</React.Fragment>
			)}
			{anim != -1 && <label><input type="checkbox" checked={!model || model.targetAnimId == anim} onChange={e => { model?.setAnimation(e.currentTarget.checked ? anim : -1); forceUpdate(); }} />Animate</label>}
			<div className="mv-sidebar-scroll">
				<JsonDisplay obj={data?.info} />
			</div>
		</React.Fragment>
	)
}

export function updateItemCamera(cam: PerspectiveCamera, imgwidth: number, imgheight: number, centery: number, params: UiCameraParams) {
	const defaultcamdist = 16;//found through testing

	//fov such that the value 32 ends up in the projection matrix.yy
	//not sure if coincidence that this is equal to height
	cam.fov = Math.atan(1 / 32) / (Math.PI / 180) * 2;
	cam.aspect = imgwidth / imgheight;
	cam.updateProjectionMatrix();

	let rot = new Quaternion().setFromEuler(new Euler(
		-params.rotx / 2048 * 2 * Math.PI,
		params.roty / 2048 * 2 * Math.PI,
		-params.rotz / 2048 * 2 * Math.PI,
		"ZYX"
	));
	let pos = new Vector3(
		6,//no clue where the 6 comes from
		0,
		4 * -params.zoom
	);
	let quatx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), params.rotx / 2048 * 2 * Math.PI);
	let quaty = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -params.roty / 2048 * 2 * Math.PI);
	let quatz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -params.rotz / 2048 * 2 * Math.PI)
	pos.applyQuaternion(quatx);
	pos.add(new Vector3(
		-params.translatex * 4,
		params.translatey * 4,
		-params.translatey * 4//yep this is y not z, i don't fucking know
	));
	pos.applyQuaternion(quaty);
	pos.applyQuaternion(quatz);
	pos.y += centery;
	pos.divideScalar(512);
	pos.z = -pos.z;

	cam.position.copy(pos);
	cam.quaternion.copy(rot);
	cam.updateProjectionMatrix();
	cam.updateMatrixWorld(true);
	return cam;
}

export type UiCameraParams = {
	rotx: number,
	roty: number,
	rotz: number,
	translatex: number,
	translatey: number,
	zoom: number
}

function ItemCameraMode({ ctx, meta, centery }: { ctx: UIContextReady, meta?: items, centery: number }) {
	let [translatex, settranslatex] = React.useState(meta?.modelTranslate_0 ?? 0);
	let [translatey, settranslatey] = React.useState(meta?.modelTranslate_1 ?? 0);
	let [rotx, setrotx] = React.useState(meta?.rotation_0 ?? 0);
	let [roty, setroty] = React.useState(meta?.rotation_1 ?? 0);
	let [rotz, setrotz] = React.useState(meta?.rotation_2 ?? 0);
	let [zoom, setzoom] = React.useState(meta?.model_zoom ?? 2048);
	let [lastmeta, setlastmeta] = React.useState(meta);
	const imgheight = 32;
	const imgwidth = 36;
	let params: UiCameraParams = { rotx, roty, rotz, translatex, translatey, zoom };

	let reset = () => {
		settranslatex(meta?.modelTranslate_0 ?? 0);
		settranslatey(meta?.modelTranslate_1 ?? 0);
		setrotx(meta?.rotation_0 ?? 0);
		setroty(meta?.rotation_1 ?? 0);
		setrotz(meta?.rotation_2 ?? 0);
		setzoom(meta?.model_zoom ?? 2048);
		setlastmeta(meta);
	}
	if (meta != lastmeta) {
		reset();
	}

	let cam = updateItemCamera(ctx.renderer.getItemCamera(), imgwidth, imgheight, centery, params);

	React.useEffect(() => {
		let el: ThreeJsSceneElementSource = {
			getSceneElements() {
				return {
					options: {
						camMode: "item",
						// aspect: imgwidth / imgheight
					}
				};
			},
		}
		ctx.renderer.addSceneElement(el);
		return () => ctx.renderer.removeSceneElement(el);
	}, [cam]);

	ctx.renderer.forceFrame();

	return (
		<React.Fragment>
			<input type="button" className="sub-btn" value="reset" onClick={reset} />
			<div><label><input type="range" value={rotx} onChange={e => setrotx(+e.currentTarget.value)} min={0} max={2048} step={1} />Rotate x: {rotx}</label></div>
			<div><label><input type="range" value={roty} onChange={e => setroty(+e.currentTarget.value)} min={0} max={2048} step={1} />Rotate y: {roty}</label></div>
			<div><label><input type="range" value={rotz} onChange={e => setrotz(+e.currentTarget.value)} min={0} max={2048} step={1} />Rotate z: {rotz}</label></div>
			<div><label><input type="range" value={zoom} onChange={e => setzoom(+e.currentTarget.value)} min={10} max={10000} step={1} />Zoom: {zoom}</label></div>
			<div><label><input type="range" value={translatex} onChange={e => settranslatex(+e.currentTarget.value)} min={-200} max={208} step={1} />Translate x: {translatex}</label></div>
			<div><label><input type="range" value={translatey} onChange={e => settranslatey(+e.currentTarget.value)} min={-200} max={200} step={1} />Translate y: {translatey}</label></div>
		</React.Fragment>
	)
}

function SceneItem(p: LookupModeProps) {
	let [data, model, id, setId] = useAsyncModelData(p.ctx, itemToModel);
	let initid = id ?? (typeof p.initialId == "number" ? p.initialId : 0);
	let [enablecam, setenablecam] = React.useState(false);
	// let [histfs, sethistfs] = React.useState<UIScriptFS | null>(null);

	let centery = (model?.loaded ? (model.loaded.modeldata.maxy + model.loaded.modeldata.miny) / 2 : 0);

	// let gethistory = async () => {
	// 	if (id == null || !p.ctx) { return; }
	// 	let output = new UIScriptOutput();
	// 	let fs = new UIScriptFS(output);
	// 	sethistfs(fs);
	// 	await output.run(fileHistory, fs, "items", [id], p.ctx.source);
	// }

	return (
		<React.Fragment>
			{p.ctx && <IdInputSearch cache={p.ctx.sceneCache.engine} mode="items" onChange={setId} initialid={initid} />}
			{id == null && (
				<p>Enter an item id or search by name.</p>
			)}
			<div className="mv-sidebar-scroll">
				<input type="button" className="sub-btn" value={enablecam ? "exit" : "Icon Camera"} onClick={e => setenablecam(!enablecam)} />
				{enablecam && p.ctx && <ItemCameraMode ctx={p.ctx} meta={data?.info} centery={centery} />}
				<JsonDisplay obj={data?.info} />
			</div>
			{/* <input type="button" className="sub-btn" value="history" onClick={gethistory} />
			{histfs && p.ctx && <UIScriptFiles fs={histfs} ctx={p.ctx} />} */}
		</React.Fragment>
	)
}

function SceneNpc(p: LookupModeProps) {
	const [data, model, id, setId] = useAsyncModelData(p.ctx, npcToModel);
	const forceUpdate = useForceUpdate();
	const initid = id ?? checkObject(p.initialId, { id: "number", head: "boolean" }) ?? { id: 0, head: false };

	return (
		<React.Fragment>
			{p.ctx && <IdInputSearch cache={p.ctx.sceneCache.engine} mode="npcs" onChange={v => setId({ id: v, head: initid.head })} initialid={initid.id} />}
			{id == null && (
				<p>Enter an NPC id or search by name.</p>
			)}
			{model && data && (<label><input type="checkbox" checked={initid.head} onChange={e => setId({ id: initid.id, head: e.currentTarget.checked })} />Head</label>)}
			{model && data && (
				<LabeledInput label="Animation">
					<select onChange={e => { model.setAnimation(+e.currentTarget.value); forceUpdate() }} value={model.targetAnimId}>
						{Object.entries(data.anims).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
					</select>
				</LabeledInput>
			)}
			<div className="mv-sidebar-scroll">
				<JsonDisplay obj={data?.info} />
			</div>
		</React.Fragment>
	)
}

function SceneSpotAnim(p: LookupModeProps) {
	let [data, model, id, setId] = useAsyncModelData(p.ctx, spotAnimToModel);
	let initid = id ?? (typeof p.initialId == "number" ? p.initialId : 0);
	return (
		<React.Fragment>
			<IdInput onChange={setId} initialid={initid} />
			{id == null && (
				<React.Fragment>
					<p>Enter a spotanim id.</p>
					<p>Spotanims are visual effects that are usually temporary and require an extra model that is not part of any loc, npc or player.</p>
				</React.Fragment>
			)}
			<div className="mv-sidebar-scroll">
				<JsonDisplay obj={data?.info} />
			</div>
		</React.Fragment>
	)
}
type DiffMesh = {
	a: ThreejsSceneCache,
	b: ThreejsSceneCache,
	info: any,
	floora: number,
	floorb: number,
	visible: boolean,
	floormesh: ThreeJsSceneElementSource,
	locsmesh: ThreeJsSceneElementSource,
	remove: () => void
}

type SceneMapState = {
	chunkgroups: { chunkx: number, chunkz: number, models: Map<ThreejsSceneCache, RSMapChunk>, diffs: DiffMesh[] }[],
	center: { x: number, z: number },
	toggles: Record<string, boolean>,
	selectionData: any,
	versions: { cache: ThreejsSceneCache, visible: boolean }[],
	extramodels: boolean
};
export class SceneMapModel extends React.Component<LookupModeProps, SceneMapState> {
	selectCleanup: (() => void)[] = [];
	constructor(p) {
		super(p);
		this.state = {
			chunkgroups: [],
			center: { x: 0, z: 0 },
			toggles: Object.create(null),
			selectionData: undefined,
			versions: [],
			extramodels: false
		}
	}

	@boundMethod
	clear() {
		this.selectCleanup.forEach(q => q());
		this.state.chunkgroups.forEach(q => q.models.forEach(q => q.cleanup()));
		this.setState({ chunkgroups: [], toggles: Object.create(null) });
	}

	@boundMethod
	viewmap() {
		showModal({ title: "Map view" }, <Map2dView chunks={this.state.chunkgroups.map(q => q.models.get(this.props.ctx!.sceneCache)!).filter(q => q)} gridsize={512} mapscenes={true} />);
	}

	async diffCaches(floora = 3, floorb = 3) {
		let group = this.state.chunkgroups[0];
		if (!this.props.ctx || !group) {
			return;
		}
		let arr = [...group.models.entries()];
		if (arr.length != 1 && arr.length != 2) {
			console.log("//TODO can currenly only diff with 1 or 2 caches loaded");
			return;
		}
		let [entrya, entryb] = (arr.length == 1 ? [arr[0], arr[0]] : arr);
		let chunka = await entrya[1].chunkdata;
		let chunkb = await entryb[1].chunkdata;
		let cachea = entrya[0];
		let cacheb = entryb[0];

		if (!chunka.chunk || !chunkb.chunk) { throw new Error("unexpected"); }
		let depsa = await cachea.engine.getDependencyGraph();
		depsa.insertMapChunk(chunka.chunk);
		let depsb = await cacheb.engine.getDependencyGraph();
		depsb.insertMapChunk(chunkb.chunk);

		let floordepsa = mapsquareFloorDependencies(chunka.grid, depsa, chunka.chunk);
		let locdepsa = mapsquareLocDependencies(chunka.grid, depsa, chunka.modeldata, chunka.chunk.mapsquarex, chunka.chunk.mapsquarez);
		let floordepsb = mapsquareFloorDependencies(chunkb.grid, depsb, chunkb.chunk);
		let locdepsb = mapsquareLocDependencies(chunkb.grid, depsb, chunkb.modeldata, chunkb.chunk.mapsquarex, chunkb.chunk.mapsquarez);

		let floordifs = compareFloorDependencies(floordepsa, floordepsb, floora, floorb);
		let locdifs = compareLocDependencies(locdepsa, locdepsb, floora, floorb);

		let floordifmesh = await mapdiffmesh(globalThis.sceneCache, floordifs, [255, 0, 0]);
		let locdifmesh = await mapdiffmesh(globalThis.sceneCache, locdifs, [0, 255, 0]);

		let diffgroup: DiffMesh = {
			a: cachea,
			b: cacheb,
			info: {
				floordepsa,
				floordepsb,
				locdepsa,
				locdepsb
			},
			floora,
			floorb,
			visible: true,
			floormesh: {
				getSceneElements() { return { modelnode: (!diffgroup.visible ? undefined : floordifmesh) } }
			},
			locsmesh: {
				getSceneElements() { return { modelnode: (!diffgroup.visible ? undefined : locdifmesh) } }
			},
			remove: () => {
				group.diffs = group.diffs.filter(q => q != diffgroup);
				this.props.ctx?.renderer.removeSceneElement(diffgroup.floormesh);
				this.props.ctx?.renderer.removeSceneElement(diffgroup.locsmesh);
				this.forceUpdate();
			}
		};

		this.props.ctx.renderer.addSceneElement(diffgroup.floormesh);
		this.props.ctx.renderer.addSceneElement(diffgroup.locsmesh);

		group.diffs.push(diffgroup);
		this.forceUpdate();
	}

	@boundMethod
	async meshSelected(e: ThreeJsRendererEvents["select"]) {
		this.selectCleanup.forEach(q => q());
		let selectionData: any = undefined;
		if (e) {
			this.selectCleanup = highlightModelGroup(e.vertexgroups);

			//show data about what we clicked
			// console.log(Array.isArray(e.obj.material) ? e.obj.material : e.obj.material.userData);
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
					tile: { ...typedmatch.tile, next01: undefined, next10: undefined, next11: undefined },
					tilenxt: typedmatch.tilenxt,
					originalcolor: typedmatch.underlaycolor
				};
			}
		};
		this.setState({ selectionData });
		this.props.ctx?.renderer.forceFrame();
	}

	componentDidMount() {
		//TODO this is a leak if ctx changes while mounted
		this.props.partial.renderer?.on("select", this.meshSelected);
	}

	componentWillUnmount() {
		this.clear();
		//TODO this is a leak if ctx changes while mounted
		this.props.partial.renderer?.off("select", this.meshSelected);
	}

	@boundMethod
	async addChunk(chunkx: number, chunkz: number) {
		for (let version of this.state.versions) {
			this.loadChunk(chunkx, chunkz, version.cache);
		}
		this.fixVisibility();
	}

	loadChunk(chunkx: number, chunkz: number, sceneCache: ThreejsSceneCache | undefined) {
		this.setState(prevstate => {
			const renderer = this.props.ctx?.renderer;
			if (!sceneCache || !renderer) { return; }

			let chunk = RSMapChunk.create(sceneCache, chunkx, chunkz, { skybox: true, map2d: this.state.extramodels, hashboxes: this.state.extramodels, minimap: this.state.extramodels });
			chunk.on("changed", () => {
				let toggles = this.state.toggles;
				let changed = false;
				let groups = new Set<string>();
				chunk.rootnode.traverse(node => {
					if (node.userData.modelgroup) {
						groups.add(node.userData.modelgroup);
					}
				});
				[...groups].sort((a, b) => a.localeCompare(b)).forEach(q => {
					if (typeof toggles[q] != "boolean") {
						toggles[q] = !!q.match(/^(floor|objects)\d+/);
						// toggles[q] = !!q.match(/^mini_(floor|objects)0/);
						// toggles[q] = !!q.match(/^mini_(objects)0/);
						// toggles[q] = !!q.match(/^mini_(floor)0/);
						changed = true;
					}
				});
				let match = this.state.versions.find(q => q.cache == sceneCache);
				chunk.setToggles(toggles, match && !match.visible);
				if (changed) {
					this.setState({ toggles });
					this.fixVisibility(toggles);
				}
			})
			let center = prevstate.center;
			if (prevstate.chunkgroups.length == 0) {
				let chunksize = (sceneCache.engine.classicData ? classicChunkSize : rs2ChunkSize);
				center = {
					x: (chunkx + 0.5) * chunksize * 512,
					z: (chunkz + 0.5) * chunksize * 512,
				}
			}
			let combined = chunk.rootnode;
			combined.position.add(new Vector3(-center.x, 0, -center.z));
			chunk.addToScene(renderer);

			let group = prevstate.chunkgroups.find(q => q.chunkx == chunkx && q.chunkz == chunkz);
			let newstate: Partial<SceneMapState> = {};
			newstate.center = center;
			if (!group) {
				group = { chunkx, chunkz, models: new Map(), diffs: [] };
				newstate.chunkgroups = [...prevstate.chunkgroups, group];
			}
			group.models.set(sceneCache, chunk);
			return newstate as any;//react typings fail?
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
		for (let z = rect.z; z < rect.z + rect.zsize; z++) {
			for (let x = rect.x; x < rect.x + rect.xsize; x++) {
				this.addChunk(x, z);
			}
		}
	}

	fixVisibility(newtoggles = this.state.toggles) {
		this.state.chunkgroups.forEach(group => group.models.forEach((q, key) => {
			let match = this.state.versions.find(q => q.cache == key);
			q.setToggles(newtoggles, match && !match.visible);
		}));
	}

	setToggle(toggle: string, value: boolean) {
		this.setState(old => {
			let newtoggles = Object.create(null);
			for (let key in old.toggles) {
				newtoggles[key] = (key == toggle ? value : old.toggles[key]);
			}
			this.fixVisibility(newtoggles);
			return { toggles: newtoggles };
		})
	}

	@boundMethod
	selectSecondCache() {
		let onselect = async (source: SavedCacheSource) => {
			frame.close();
			let cache = await openSavedCache(source, false);
			if (!cache) { return; }
			let engine = await EngineCache.create(cache);
			let scene = await ThreejsSceneCache.create(engine);
			for (let area of this.state.chunkgroups) {
				this.loadChunk(area.chunkx, area.chunkz, scene);
			}
			this.setState({ versions: [...this.state.versions, { cache: scene, visible: true }] });
		}

		let frame = showModal({ title: "Select a cache" }, (
			<CacheSelector onOpen={onselect} noReopen={true} />
		));
	}

	removeCache(cache: ThreejsSceneCache) {
		for (let group of this.state.chunkgroups) {
			let model = group.models.get(cache);
			if (!model) { continue; }
			this.props.ctx?.renderer.removeSceneElement(model);
		}
		this.setState({ versions: this.state.versions.filter(q => q.cache != cache) });
	}

	@boundMethod
	toggleCache() {
		let currentindex = this.state.versions.findIndex(q => q.visible);
		let newindex = (currentindex + 1) % this.state.versions.length;
		this.state.versions.forEach((q, i) => this.toggleVisible(q.cache, i == newindex));
	}

	toggleVisible(cache: ThreejsSceneCache, visible: boolean) {
		let entry = this.state.versions.find(q => q.cache == cache);
		if (!entry) { return; }
		entry.visible = visible;
		this.forceUpdate();
		this.fixVisibility();
	}

	static getDerivedStateFromProps(props: LookupModeProps, state: SceneMapState): Partial<SceneMapState> | null {
		if (props.ctx && !state.versions.find(q => q.cache == props.ctx?.sceneCache)) {
			return { versions: [{ cache: props.ctx.sceneCache, visible: true }, ...state.versions] };
		}
		return null;
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
			xmin = Math.min(xmin, chunk.chunkx); xmax = Math.max(xmax, chunk.chunkx + 1);
			zmin = Math.min(zmin, chunk.chunkz); zmax = Math.max(zmax, chunk.chunkz + 1);
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
				addgrid.push(<div key={`${x}-${z}`} onClick={() => this.addChunk(x, z)} style={style}></div>);
			}
		}

		let initid = (typeof this.props.initialId == "string" ? this.props.initialId : "50,50,1,1");

		//find the last skybox
		let skysettings = this.state.chunkgroups.reduceRight((a, q) => a ?? q.models.get(this.props.ctx!.sceneCache)?.loaded?.sky, undefined as undefined | RSMapChunkData["sky"]);

		return (
			<React.Fragment>
				{this.state.chunkgroups.length == 0 && (
					<React.Fragment>
						<StringInput onChange={this.onSubmit} initialid={initid} />
						<label><input type="checkbox" checked={this.state.extramodels} onChange={e => this.setState({ extramodels: e.currentTarget.checked })} />Load extra modes</label>
						<p>Input format: x,z[,xsize=1,[zsize=xsize]]</p>
						<p>Coordinates are in so-called mapsquare coordinates, each mapsquare is 64x64 tiles in size. The entire RuneScape map is laid out in one plane and is 100x200 mapsquares in size.</p>
					</React.Fragment>
				)}
				{this.state.chunkgroups.length != 0 && (
					<div className="mv-sidebar-scroll">
						<Map2dView chunks={this.state.chunkgroups.map(q => q.models.get(this.props.ctx!.sceneCache)!).filter(q => q)} addArea={this.addChunk} gridsize={40} mapscenes={false} />

						<input type="button" className="sub-btn" onClick={this.clear} value="Clear" />
						<input type="button" className="sub-btn" onClick={this.viewmap} value="View Map" />
						<input type="button" className="sub-btn" value="Add other version" onClick={this.selectSecondCache} />
						{skysettings && (<div>
							Skybox model: <span className="mv-copy-text">{skysettings.skyboxModelid}</span>,
							fog: <span className="mv-copy-text">{skysettings.fogColor[0]},{skysettings.fogColor[1]},{skysettings.fogColor[2]}</span>
						</div>)}
						<div style={{ display: "grid", gridTemplateColumns: "repeat(5,max-content)" }}>
							{Object.entries(toggles).map(([base, subs]) => {
								let all = true;
								let none = true;
								subs.forEach(s => {
									let v = this.state.toggles[base + s];
									all &&= v;
									none &&= !v;
								})
								return (
									<React.Fragment key={base}>
										<label style={{ gridColumn: 1 }}><input type="checkbox" checked={all} onChange={e => subs.forEach(s => this.setToggle(base + s, e.currentTarget.checked))} ref={v => v && (v.indeterminate = !all && !none)} />{base}</label>
										{subs.map((sub, i) => {
											let name = base + sub;
											let value = this.state.toggles[name];
											return (
												<label key={sub} style={{ gridColumn: 2 + i }}>
													<input type="checkbox" checked={value} onChange={e => this.setToggle(name, e.currentTarget.checked)} />
													{sub}
												</label>
											);
										})}
									</React.Fragment>
								)
							})}
						</div>
						{(this.state.versions.length > 1 || !this.state.versions[0].visible) && "Versions"}
						{(this.state.versions.length > 1 || !this.state.versions[0].visible) && this.state.versions.map((q, i) => (
							<div key={i} style={{ clear: "both" }}>
								<label title={q.cache.engine.getCacheMeta().descr}>
									<input type="checkbox" checked={q.visible} onChange={e => this.toggleVisible(q.cache, e.currentTarget.checked)} />
									{q.cache.engine.getCacheMeta().name}
								</label>
								<input type="button" className="sub-btn" value="x" style={{ float: "right" }} onClick={e => this.removeCache(q.cache)} />
							</div>
						))}
						{this.state.versions.length > 1 && <input type="button" className="sub-btn" value="Toggle" onClick={this.toggleCache} />}
						{this.state.chunkgroups.flatMap((group, groupi) => group.diffs.map((diff, i) => {
							let metaa = diff.a.engine.getCacheMeta();
							let metab = diff.a == diff.b ? metaa : diff.b.engine.getCacheMeta();
							return (
								<div key={groupi + "-" + i} style={{ clear: "both" }}>
									<label title={diff.a == diff.b ? metaa.descr : `cache a:${metaa.descr}\n\n${metab.descr}`}>
										<input type="checkbox" checked={diff.visible} onChange={e => { diff.visible = e.currentTarget.checked; this.props.ctx?.renderer.sceneElementsChanged(); this.forceUpdate(); }} />
										{diff.a.engine.getBuildNr()}, floor: {diff.floora}
										-
										{diff.b.engine.getBuildNr()}, floor: {diff.floorb}
									</label>
									<input type="button" className="sub-btn" onClick={diff.remove} style={{ float: "right" }} value="x" />
								</div>
							)
						}))}
						<JsonDisplay obj={this.state.selectionData} />
					</div>
				)}
			</React.Fragment>
		)
	}
}

type Map2dState = {
	cache: Map<RSMapChunk, { render: Promise<string>, src: string | null }>,
};
export class Map2dView extends React.Component<{ addArea?: (x: number, z: number) => void, chunks: RSMapChunk[], gridsize: number, mapscenes: boolean }, Map2dState> {
	constructor(p) {
		super(p);

		this.state = {
			cache: new Map()
		}
	}

	render() {
		let xmin = Infinity, xmax = -Infinity;
		let zmin = Infinity, zmax = -Infinity;
		for (let chunk of this.props.chunks) {
			xmin = Math.min(xmin, chunk.chunkx); xmax = Math.max(xmax, chunk.chunkx + 1);
			zmin = Math.min(zmin, chunk.chunkz); zmax = Math.max(zmax, chunk.chunkz + 1);
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
				addgrid.push(<div key={`${x}-${z}`} onClick={() => this.props.addArea?.(x, z)} style={style}></div>);
			}
		}


		let gridsize = this.props.gridsize;
		let pad = 20;
		return (
			<div className="map-grid-container">
				<div className="map-grid-root" style={{ gridTemplateColumns: `${pad}px repeat(${xsize - 2},${gridsize}px) ${pad}px`, gridTemplateRows: `${pad}px repeat(${zsize - 2},${gridsize}px) ${pad}px` }}>
					{this.props.chunks.flatMap((chunk, i) => {
						let style: React.CSSProperties = {
							gridColumn: `${chunk.chunkx - xmin + 1}/span ${1}`,
							gridRow: `${zsize - (chunk.chunkz - zmin)}/span ${1}`
						}
						let cached = this.state.cache.get(chunk);
						if (cached?.src) {
							style.backgroundImage = cached.src;
						} else if (!cached) {
							let prom = chunk.renderSvg(0, false);
							cached = { render: prom, src: null as null | string };
							this.state.cache.set(chunk, cached);
							prom.then(svg => {
								cached!.src = `url("data:image/svg+xml;base64,${btoa(svg)}")`;
								this.forceUpdate();
							});
						}
						addgrid[(chunk.chunkx - xmin) * zsize + (chunk.chunkz - zmin)] = null;
						return (
							<div key={i} className={classNames("map-grid-area", { "map-grid-area-loading": !cached?.src })} style={style}>
								{chunk.chunkx},{chunk.chunkz}
							</div>
						);
					})}
					{addgrid}
				</div>
			</div>
		);
	}
}

function PreviewFilesScript(p: UiScriptProps) {
	let [] = p.initialArgs.split(":") as (string | undefined)[];

	let run = () => {
		let output = new UIScriptOutput();
		let outdir = output.makefs("out");
		output.run(previewAllFileTypes, outdir, p.source);
		p.onRun(output, ``);
	}

	return (
		<React.Fragment>
			<p>Extracts a couple example files for each known extraction mode.</p>
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}

function ModeDropDownOptions() {
	return (
		<React.Fragment>
			{Object.entries(cacheFileDecodeGroups).map(([k, v]) => (
				<optgroup key={k} label={k}>
					{Object.keys(v).map(k => <option key={k} value={k}>{k}</option>)}
				</optgroup>
			))}
		</React.Fragment>
	);
}

function ExtractFilesScript(p: UiScriptProps) {
	let [initmode, initbatched, initdecoder, initfilestext] = p.initialArgs.split(":") as (string | undefined)[];
	let [filestext, setFilestext] = React.useState(initfilestext ?? "");
	let [mode, setMode] = React.useState<string>(initmode || "items");
	let [batched, setbatched] = React.useState(initbatched == "true");
	let [decoderflags, setdecodersflags] = React.useState((initdecoder ? Object.fromEntries(initdecoder.split(",").map(q => [q.split("=")[0], q.split("=")[1] ?? ""])) : {}));

	let run = () => {
		let output = new UIScriptOutput();
		let outdir = output.makefs("out");
		let files = stringToFileRange(filestext);
		output.run(extractCacheFiles, outdir, p.source, { files, mode, batched, batchlimit: -1, edit: false, skipread: false }, decoderflags);
		p.onRun(output, `${mode}:${batched}:${Object.entries(decoderflags).map(([k, v]) => `${k}=${v}`).join(",")}:${filestext}`);
	}

	let modemeta = React.useMemo<DecodeMode | undefined>(() => cacheFileDecodeModes[mode]?.({}), [mode]);
	let setFlag = (flag: string, v: boolean) => {
		let newflags = { ...decoderflags };
		if (v) { newflags[flag] = "true"; }
		else { delete newflags[flag]; }
		setdecodersflags(newflags);
	}

	return (
		<React.Fragment>
			<p>Extract files from the cache.<br />The ranges field uses logical file id's for JSON based files, {"<major>.<minor>"} notation for bin mode, or {"<x>.<z>"} for map based files.</p>
			<LabeledInput label="Mode">
				<select value={mode} onChange={e => setMode(e.currentTarget.value as any)}>
					{/* {Object.keys(cacheFileDecodeModes).map(k => <option key={k} value={k}>{k}</option>)} */}
					<ModeDropDownOptions />
				</select>
			</LabeledInput>
			<LabeledInput label="File ranges">
				<InputCommitted type="text" onChange={e => setFilestext(e.currentTarget.value)} value={filestext} />
			</LabeledInput>
			<div>{modemeta?.description ?? ""}</div>
			<div><label><input type="checkbox" checked={batched} onChange={e => setbatched(e.currentTarget.checked)} />Concatenate group files</label></div>
			{Object.entries(modemeta?.flagtemplate ?? {}).map(([k, v]) => (
				<div key={k}><label><input type="checkbox" checked={decoderflags[k] == "true"} onChange={e => setFlag(k, e.currentTarget.checked)} />{v.text}</label></div>
			))}
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}
function ExtractHistoricScript(p: UiScriptProps) {
	let [initmode, initfilestext, initcacheids] = p.initialArgs.split(":") as (string | undefined)[];
	let [filestext, setFilestext] = React.useState(initfilestext ?? "");
	let [buildnrs, setbuildnrs] = React.useState(initcacheids ?? "");
	let [mode, setMode] = React.useState<keyof typeof cacheFileDecodeModes>(initmode as any || "items");

	let run = () => {
		let output = new UIScriptOutput();
		let outdir = output.makefs("out");
		let builds = stringToFileRange(buildnrs);
		let files = stringToFileRange(filestext);
		output.run(fileHistory, outdir, mode, files[0].start, null, builds);
		p.onRun(output, `${mode}:${filestext}:${buildnrs}`);
	}

	return (
		<React.Fragment>
			<p>Tracks a single file's update history using openrs2 caches. Each known cache will be compared and all changes are shown. {"<major>.<minor>"} notation for bin mode, or {"<x>.<z>"} for map based files.</p>
			<LabeledInput label="Mode">
				<select value={mode} onChange={e => setMode(e.currentTarget.value as any)}>
					{/* {Object.keys(cacheFileDecodeModes).map(k => <option key={k} value={k}>{k}</option>)} */}
					<ModeDropDownOptions />
				</select>
			</LabeledInput>
			<LabeledInput label="File ranges">
				<InputCommitted type="text" onChange={e => setFilestext(e.currentTarget.value)} value={filestext} />
			</LabeledInput>
			<LabeledInput label="Build numbers (empty for all)">
				<input type="text" value={buildnrs} onChange={e => setbuildnrs(e.currentTarget.value)} />
			</LabeledInput>
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}

//not currently exposed, needs some fixing or just delete
function MapRemoteRenderScript(p: UiScriptProps) {
	let [endpoint, setEndpoint] = React.useState(localStorage.rsmv_script_map_endpoint ?? "");
	let [auth, setAuth] = React.useState("");
	let [mapid, setMapId] = React.useState(0);

	let run = async () => {
		let output = new UIScriptOutput();
		let config = await MapRenderDatabaseBacked.create(endpoint, auth, mapid, false, new Date(0));
		localStorage.rsmv_script_map_endpoint = endpoint;
		output.run(runMapRender, p.source, config, true);
		p.onRun(output, "");
	}

	return (
		<React.Fragment>
			<p>Update a map database, requires compatible server endpoint.</p>
			<LabeledInput label="Endpoint">
				<InputCommitted type="text" onChange={e => setEndpoint(e.currentTarget.value)} value={endpoint} />
			</LabeledInput>
			<LabeledInput label="Auth">
				<InputCommitted type="text" onChange={e => setAuth(e.currentTarget.value)} value={auth} />
			</LabeledInput>
			<LabeledInput label="mapid">
				<InputCommitted type="number" onChange={e => setMapId(+e.currentTarget.value)} value={mapid} />
			</LabeledInput>
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}

function MaprenderScript(p: UiScriptProps) {
	let [configjson, setconfigjson] = React.useState(localStorage.rsmv_script_map_lastconfig || examplemapconfig);

	let run = async () => {
		localStorage.rsmv_script_map_lastconfig = (configjson == examplemapconfig ? "" : configjson);
		let output = new UIScriptOutput();
		let fs = output.makefs("render");
		let config = new MapRenderFsBacked(fs, parseMapConfig(configjson));
		await fs.writeFile("mapconfig.jsonc", configjson);
		output.run(runMapRender, p.source, config, true);
		p.onRun(output, "");
	}

	let editconfig = () => {
		let modal = showModal({ title: "Map render config" }, (
			<form style={{ display: "flex", flexDirection: "column", height: "100%" }}>
				<textarea name="parsertext" defaultValue={configjson} style={{ flex: "1000px 1 1", resize: "none", whiteSpace: "nowrap" }} />
				<input type="button" className="sub-btn" value="Confirm" onClick={e => { setconfigjson(e.currentTarget.form!.parsertext.value); modal.close(); }} />
			</form>
		))
	}

	return (
		<React.Fragment>
			<p>Render 3d world map. (there is a CLI version of this command which is much more performant)</p>
			<div>
				<input type="button" className="sub-btn" value="Edit Config" onClick={editconfig} />
				{configjson != examplemapconfig && <input type="button" className="sub-btn" value="Reset" onClick={e => setconfigjson(examplemapconfig)} />}
			</div>
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}
function CacheDiffScript(p: UiScriptProps) {
	let [cache2, setCache2] = React.useState<CacheFileSource | null>(null);
	let [selectopen, setSelectopen] = React.useState(false);
	let [result, setResult] = React.useState<FileEdit[] | null>(null);
	let [filerange, setFilerange] = React.useState("");
	let [showmodels, setshowmodels] = React.useState(false);

	let openCache = async (s: SavedCacheSource) => {
		setSelectopen(false);
		setCache2(await openSavedCache(s, false));
	}

	React.useEffect(() => () => cache2?.close(), [cache2]);

	let run = async () => {
		if (!cache2) { return; }
		let output = new UIScriptOutput();
		let outdir = output.makefs("diff");
		let files = stringToFileRange(filerange);
		p.onRun(output, "");
		let res = output.run(diffCaches, outdir, cache2, p.source, files);
		res.then(setResult);
	}

	let clickOpen = () => {
		let frame = showModal({ title: "Select a cache" }, (
			<CacheSelector onOpen={v => { openCache(v); frame.close(); }} noReopen={true} />
		));
	}

	React.useEffect(() => {
		if (result && showmodels && cache2 && p.ctx.sceneCache) {
			let prom = EngineCache.create(cache2).then(async engine => {
				let oldscene = await ThreejsSceneCache.create(engine);
				let models: RSModel[] = [];
				const xstep = 5 * 512;
				const zstep = 5 * 512;
				let modelcount = 0;
				for (let diff of result!) {
					if (diff.major == cacheMajors.models) {
						if (diff.before) {
							let model = new RSModel(oldscene, [{ modelid: diff.minor, mods: {} }], `before ${diff.minor}`);
							model.rootnode.position.set(modelcount * xstep, 0, zstep);
							models.push(model);
							model.addToScene(p.ctx.renderer!);
						}
						if (diff.after) {
							let model = new RSModel(p.ctx.sceneCache!, [{ modelid: diff.minor, mods: {} }], `after ${diff.minor}`);
							model.rootnode.position.set(modelcount * xstep, 0, 0);
							models.push(model);
							model.addToScene(p.ctx.renderer!);
						}
						modelcount++;
					}
				}
				return models;
			})

			return () => {
				prom.then(models => models.forEach(q => q.cleanup()));
			}
		}
	}, [result, showmodels]);

	return (
		<React.Fragment>
			<p>Shows all changes between the current cache and a second cache.</p>
			{!cache2 && !selectopen && <input type="button" className="sub-btn" value="Select second cache" onClick={e => clickOpen()} />}
			{!cache2 && selectopen && (
				<div style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
					<input type="button" className="sub-btn" value="Cancel select cache" onClick={e => setSelectopen(false)} />
					<CacheSelector onOpen={openCache} />
				</div>
			)}
			{cache2 && <input type="button" className="sub-btn" value={`Close ${cache2.getCacheMeta().name}`} onClick={e => setCache2(null)} />}
			<LabeledInput label="file range">
				<input type="text" onChange={e => setFilerange(e.currentTarget.value)} value={filerange} />
			</LabeledInput>
			<input type="button" className="sub-btn" value="Run" onClick={run} />
			{result && <label><input checked={showmodels} onChange={e => setshowmodels(e.currentTarget.checked)} type="checkbox" />View changed models</label>}
		</React.Fragment>
	)
}

function TestFilesScript(p: UiScriptProps) {
	let [initmode, initrange, initdumpall, initordersize] = p.initialArgs.split(":") as (string | undefined)[];
	let [mode, setMode] = React.useState(initmode || "");
	let [range, setRange] = React.useState(initrange || "");
	let [dumpall, setDumpall] = React.useState(initdumpall != "false");
	let [ordersize, setOrdersize] = React.useState(initordersize == "true");
	let [customparser, setCustomparser] = React.useState("");

	let run = () => {
		let modeobj = cacheFileJsonModes[mode as keyof typeof cacheFileJsonModes];
		if (!modeobj) { return; }
		let output = new UIScriptOutput();
		let outdir = output.makefs("output")
		let opts = defaultTestDecodeOpts();
		opts.maxerrs = 50000;
		opts.orderBySize = ordersize;
		opts.dumpall = dumpall;
		if (customparser) {
			modeobj = { ...modeobj };
			modeobj.parser = FileParser.fromJson(customparser);
		}
		output.run(testDecode, outdir, p.source, modeobj, stringToFileRange(range), opts);
		p.onRun(output, `${mode}:${range}:${dumpall}:${ordersize}`);
	}

	let customparserUi = React.useCallback(() => {
		let srctext = customparser || cacheFileJsonModes[mode as keyof typeof cacheFileJsonModes].parser.originalSource;
		let modal = showModal({ title: "Edit parser" }, (
			<form style={{ display: "flex", flexDirection: "column", height: "100%" }}>
				<textarea name="parsertext" defaultValue={srctext} style={{ flex: "1000px 1 1", resize: "none", whiteSpace: "nowrap" }} />
				<input type="button" className="sub-btn" value="Confirm" onClick={e => { setCustomparser(e.currentTarget.form!.parsertext.value); modal.close(); }} />
			</form>
		))
		// txtarea.style.cssText = "position:absolute;top:0px;left:0px;right:0px;bottom:20px;";
	}, [customparser, mode]);

	return (
		<React.Fragment>
			<p>Run this script to test if the current cache parser is compatible with the loaded cache. Generates readable errors if not.</p>
			<LabeledInput label="Mode">
				<select value={mode} onChange={e => setMode(e.currentTarget.value)}>
					{Object.keys(cacheFileJsonModes).map(k => <option key={k} value={k}>{k}</option>)}
				</select>
			</LabeledInput>
			<LabeledInput label="file range">
				<input type="text" onChange={e => setRange(e.currentTarget.value)} value={range} />
			</LabeledInput>
			<div><label><input type="checkbox" checked={ordersize} onChange={e => setOrdersize(e.currentTarget.checked)} />Order by size (puts everything in mem)</label></div>
			<div><label><input type="checkbox" checked={dumpall} onChange={e => setDumpall(e.currentTarget.checked)} />Output successes as well</label></div>
			<br />
			<input type="button" className="sub-btn" value="Edit parser" onClick={customparserUi} />
			{customparser && <input type="button" className="sub-btn" value="Reset" onClick={() => setCustomparser("")} />}
			<br />
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}

function RawCliScript(p: UiScriptProps) {
	let [text, setText] = React.useState(p.initialArgs);

	let run = async () => {
		let output = new UIScriptOutput();
		let ctx: CliApiContext = {
			getConsole() { return output; },
			getFs(name: string) { return output.makefs(name); },
			getDefaultCache() { return p.source; }
		};

		p.onRun(output, text);
		let api = cliApi(ctx);

		let res = await cmdts.runSafely(api.subcommands, text.split(/\s+/g));
		if (output.state == "running") {
			output.setState(res._tag == "error" ? "error" : "done");
		}
		if (res._tag == "error") {
			output.log(res.error.config.message);
		} else {
			output.log("script done");
		}
	}

	return (
		<React.Fragment>
			<p>Run CLI code</p>
			<input type="text" value={text} onInput={e => setText(e.currentTarget.value)} />
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}

type UiScriptProps = { onRun: (output: UIScriptOutput, args: string) => void, initialArgs: string, source: CacheFileSource, ctx: UIContext };
const uiScripts: Record<string, React.ComponentType<UiScriptProps>> = {
	test: TestFilesScript,
	extract: ExtractFilesScript,
	preview: PreviewFilesScript,
	historic: ExtractHistoricScript,
	maprender: MaprenderScript,
	diff: CacheDiffScript,
	cli: RawCliScript
}

function ScriptsUI(p: LookupModeProps) {
	let initialscript = "test";
	let initialargs = "";
	if (typeof p.initialId == "string") {
		[initialscript, initialargs] = p.initialId.split(/(?<=^[^:]*):/);
	}
	let [script, setScript] = React.useState<string>(initialscript);
	let [running, setRunning] = React.useState<UIScriptOutput | null>(null);

	let onRun = React.useCallback((output: UIScriptOutput, savedargs: string) => {
		localStorage.rsmv_lastsearch = JSON.stringify(script + ":" + savedargs);
		setRunning(output);
	}, [script]);

	const source = p.partial.source;
	if (!source) { throw new Error("trying to render modelbrowser without source loaded"); }
	const SelectedScript = uiScripts[script as keyof typeof uiScripts];
	return (
		<React.Fragment>
			<div className="mv-sidebar-scroll">
				<h2>Script runner</h2>
				<TabStrip value={script} tabs={Object.fromEntries(Object.keys(uiScripts).map(k => [k, k])) as any} onChange={v => setScript(v)} />
				{!SelectedScript && (
					<React.Fragment>
						<p>Select a script</p>
						<p>The script runner allows you to run some of the CLI scripts directly from the browser.</p>
					</React.Fragment>
				)}
				{SelectedScript && <SelectedScript source={source} onRun={onRun} initialArgs={initialscript == script ? (initialargs ?? "") : ""} ctx={p.partial} />}
				<h2>Script output</h2>
				<OutputUI output={running} ctx={p.partial} />
			</div>
		</React.Fragment>
	);
}

type LookupModeProps = { initialId: unknown, ctx: UIContextReady | null, partial: UIContext }

const LookupModeComponentMap: Record<LookupMode, React.ComponentType<LookupModeProps>> = {
	model: SceneRawModel,
	item: SceneItem,
	avatar: ScenePlayer,
	material: SceneMaterialIsh,
	npc: SceneNpc,
	object: SceneLocation,
	spotanim: SceneSpotAnim,
	map: SceneMapModel,
	scenario: SceneScenario,
	scripts: ScriptsUI
}
