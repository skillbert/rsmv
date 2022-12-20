import { ThreejsSceneCache, EngineCache } from '../3d/ob3tothree';
import { delay, packedHSL2HSL, HSL2RGB, RGB2HSL, HSL2packHSL, drawTexture, ModelModifications, stringToFileRange, stringToMapArea } from '../utils';
import { boundMethod } from 'autobind-decorator';
import { CacheFileSource } from '../cache';
import { MapRect, TileGrid, squareSize, CombinedTileGrid, getTileHeight } from '../3d/mapsquare';
import { Euler, Quaternion, Vector3 } from "three";
import { cacheMajors } from "../constants";
import * as React from "react";
import classNames from "classnames";
import { appearanceUrl, avatarStringToBytes, EquipCustomization, EquipSlot, slotNames, slotToKitFemale, slotToKitMale, writeAvatar } from "../3d/avatar";
import { ThreeJsRendererEvents, highlightModelGroup, ThreeJsSceneElement, ThreeJsSceneElementSource, exportThreeJsGltf, exportThreeJsStl, RenderCameraMode } from "./threejsrender";
import { cacheFileJsonModes, extractCacheFiles, cacheFileDecodeModes } from "../scripts/extractfiles";
import { defaultTestDecodeOpts, testDecode } from "../scripts/testdecode";
import { UIScriptOutput, OutputUI, useForceUpdate, VR360View } from "./scriptsui";
import { CacheSelector, downloadBlob, openSavedCache, SavedCacheSource, UIContext, UIContextReady } from "./maincomponents";
import { tiledimensions } from "../3d/mapsquare";
import { runMapRender } from "../map";
import { diffCaches, FileEdit } from "../scripts/cachediff";
import { selectEntity, showModal } from "./jsonsearch";
import { findImageBounds, makeImageData } from "../imgutils";
import { avataroverrides } from "../../generated/avataroverrides";
import { InputCommitted, StringInput, JsonDisplay, IdInput, LabeledInput, TabStrip, IdInputSearch, CanvasView } from "./commoncontrols";
import { items } from "../../generated/items";
import { itemToModel, locToModel, materialToModel, modelToModel, npcToModel, playerDataToModel, playerToModel, primitiveModelInits, RSMapChunk, RSMapChunkData, RSModel, SimpleModelDef, SimpleModelInfo, spotAnimToModel } from "../3d/modelnodes";
import fetch from "node-fetch";
import { mapsquare_overlays } from '../../generated/mapsquare_overlays';
import { mapsquare_underlays } from '../../generated/mapsquare_underlays';
import { FileParser } from '../opdecoder';

type LookupMode = "model" | "item" | "npc" | "object" | "material" | "map" | "avatar" | "spotanim" | "scenario" | "scripts";

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
	let targetname = p.comp?.modelkey ?? "??";
	let remove = <input type="button" className="sub-btn" value="x" onClick={() => p.onChange(null)} />;
	let gridstyle = (nparts: number) => ({
		display: "grid",
		gridTemplateColumns: (nparts <= 0 ? "1fr min-content" : `${nparts}fr repeat(${nparts},1fr) min-content`),
		alignItems: "baseline"
	} as React.CSSProperties);

	switch (action.type) {
		case "anim": {
			return (
				<div style={gridstyle(1)}>
					<span>{p.action.type} {targetname}</span>
					<InputCommitted type="number" value={action.animid} onChange={e => p.onChange({ ...action, animid: +e.currentTarget.value })} />
					{remove}
				</div>
			);
		}
		case "animset": {
			return (
				<div style={gridstyle(1)}>
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
				<div style={gridstyle(1)}>
					<span >{p.action.type} (ms)</span>
					<InputCommitted type="number" value={action.duration} onChange={e => p.onChange({ ...action, duration: +e.currentTarget.value })} />
					{remove}
				</div>
			);
		}
		case "location": {
			return (
				<React.Fragment>
					<div style={gridstyle(0)}>
						<span>{p.action.type} {targetname}</span>
						{remove}
					</div>
					<div style={{ ...gridstyle(0), gridTemplateColumns: "1fr 2fr repeat(3,minmax(0,1fr))" }}>
						<span style={{ gridColumn: "2" }}>Floor</span>
						<InputCommitted type="number" value={action.level} step={1} style={{ gridColumn: "span 3" }} onChange={e => p.onChange({ ...action, level: +e.currentTarget.value })} />
						<span style={{ gridColumn: "2" }}>Position x,y,z</span>
						<InputCommitted type="number" value={action.x} onChange={e => p.onChange({ ...action, x: +e.currentTarget.value })} />
						<InputCommitted type="number" value={action.z} onChange={e => p.onChange({ ...action, z: +e.currentTarget.value })} />
						<InputCommitted type="number" value={action.dy} onChange={e => p.onChange({ ...action, dy: +e.currentTarget.value })} />
					</div>
				</React.Fragment>
			);
		}
		case "visibility": {
			return (
				<div style={gridstyle(1)}>
					<span>{p.action.type} {targetname}</span>
					<label><input type="checkbox" checked={action.visible} onChange={e => p.onChange({ ...action, visible: e.currentTarget.checked })} /></label>
					{remove}
				</div>
			);
		}
	}
}

function ScenarioComponentControl(p: { comp: ScenarioComponent, onChange: (v: ScenarioComponent | null) => void }) {
	return (
		<div style={{ display: "grid", gridTemplateColumns: "1fr min-content", alignItems: "baseline" }}>
			<div>{p.comp.modelkey}</div>
			<input type="button" className="sub-btn" value="x" onClick={e => p.onChange(null)} />
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
		if (newcomp) {
			components[compid] = newcomp;
		} else {
			delete components[compid];
			this.setState({ actions: this.state.actions.filter(q => q.target != compid) });
		}
		this.setState({ components });
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
		const hasmodels = Object.keys(this.state.components).length != 0;
		const hasAdvLookup = this.state.addModelType == "item" || this.state.addModelType == "loc" || this.state.addModelType == "npc";
		return (
			<React.Fragment>
				<div className="mv-sidebar-scroll">
					<h2>Models</h2>
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
								return <ScenarioComponentControl key={id} comp={comp} onChange={e => this.editComp(+id, e)} />;
							})}
						</div>
					)}
					<h2>Action sequence</h2>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr min-content" }}>
						<select value={this.state.addActionType} onChange={e => this.setState({ addActionType: e.currentTarget.value as any })}>
							<option value="location">Location</option>
							<option value="anim">Anim</option>
							<option value="delay">Delay</option>
							<option value="visibility">Visibility</option>
						</select>
						<select disabled={this.state.addActionType == "delay"} value={this.state.addActionType == "delay" ? -1 : this.state.addActionTarget} onChange={e => this.setState({ addActionTarget: +e.currentTarget.value })}>
							{Object.entries(this.state.components).map(([key, c]) => <option key={key} value={key}>{c.modelkey}</option>)}
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
		let url = appearanceUrl(v);
		let data = await fetch(url).then(q => q.text());
		if (data.indexOf("404 - Page not found") != -1) {
			seterrtext(`Player avatar not found for '${v}'.`)
			return;
		}
		let buf = avatarStringToBytes(data);
		setId({ player: v, data: buf, head });
		seterrtext("");
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
		data?.info.kitcolors.clothes
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
]

function ExportSceneMenu(p: { ctx: UIContextReady, renderopts: ThreeJsSceneElement["options"] }) {
	let [tab, settab] = React.useState<"img" | "gltf" | "stl" | "none">("none");
	let [img, setimg] = React.useState<{ cnv: HTMLCanvasElement, data: ImageData } | null>(null);
	let [imgsize, setimgsize] = React.useState<ExportImgSize>(exportimgsizes.find(q => q.mode == p.renderopts!.camMode) ?? exportimgsizes[0]);
	let [cropimg, setcropimg] = React.useState(true);

	let changeImg = async (instCrop = cropimg, instSize = imgsize) => {
		if (p.renderopts!.camMode == "vr360") { instCrop = false; }

		let newpixels = await p.ctx.renderer.takeCanvasPicture(instSize.w || undefined, instSize.h || undefined);
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
					<label><input type="checkbox" checked={camMode == "vr360"} onChange={e => setcammode(e.currentTarget.checked ? "vr360" : "standard")} />360 camera</label>
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

async function materialIshToModel(sceneCache: ThreejsSceneCache, reqid: { mode: "mat" | "underlay" | "overlay", id: number }) {

	let matid = -1;
	let color = [255, 0, 255];
	let overlay: mapsquare_overlays | null = null;
	let underlay: mapsquare_underlays | null = null;
	if (reqid.mode == "overlay") {
		overlay = sceneCache.engine.mapOverlays[reqid.id];
		if (overlay.material) { matid = overlay.material; }
		if (overlay.primary_colour) { color = overlay.primary_colour; }
	} else if (reqid.mode == "underlay") {
		underlay = sceneCache.engine.mapUnderlays[reqid.id];
		if (underlay.material) { matid = underlay.material; }
		if (underlay.color) { color = underlay.color; }
	} else if (reqid.mode == "mat") {
		matid = reqid.id;
	} else {
		throw new Error("invalid materialish mode");
	}


	let assetid = 93808;//"RuneTek_Asset" jagex test model
	let mods: ModelModifications = {
		replaceMaterials: [[4311, matid]],
		replaceColors: [[20287, HSL2packHSL(...RGB2HSL(...color as [number, number, number]))]]
	};
	let mat = sceneCache.engine.getMaterialData(matid);
	let texs: Record<string, { texid: number, filesize: number, img0: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap }> = {};
	let addtex = async (name: string, texid: number) => {
		let tex = await sceneCache.getTextureFile(texid, mat.stripDiffuseAlpha && name == "diffuse");
		let drawable = await tex.toWebgl();

		texs[name] = { texid, filesize: tex.filesize, img0: drawable };
	}
	for (let tex in mat.textures) {
		if (mat.textures[tex] != 0) {
			await addtex(tex, mat.textures[tex]);
		}
	}
	return {
		models: [{ modelid: assetid, mods }],
		anims: {},
		info: { overlay, underlay, texs, obj: mat },
		id: reqid
	};
}

function SceneMaterialIsh(p: LookupModeProps) {
	let [data, model, id, setId] = useAsyncModelData(p.ctx, materialIshToModel);

	let initid = id ?? { mode: "mat", id: 0 };
	return (
		<React.Fragment>
			<IdInput onChange={v => setId({ ...initid, id: v })} initialid={initid.id} />
			<div onChange={v => setId({ mode: (v.target as any).value, id: initid.id })}>
				<label><input type="radio" name="mattype" value="mat" checked={initid.mode == "mat"} />Material</label>
				<label><input type="radio" name="mattype" value="underlay" checked={initid.mode == "underlay"} />Underlay</label>
				<label><input type="radio" name="mattype" value="overlay" checked={initid.mode == "overlay"} />Overlay</label>
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
						<div>{name} - {img.texid} - {img.filesize / 1024 | 0}kb - {img.img0.width}x{img.img0.height}</div>
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

function SceneMaterial(p: LookupModeProps) {
	let [data, model, id, setId] = useAsyncModelData(p.ctx, materialToModel);

	let initid = id ?? (typeof p.initialId == "number" ? p.initialId : 0);
	return (
		<React.Fragment>
			<IdInput onChange={setId} initialid={initid} />
			{id == null && (
				<React.Fragment>
					<p>Enter a material id.</p>
					<p>Materials define how a piece of geometry looks, besides the color texture they also define how the model interacts with light to create highlights and reflections.</p>
				</React.Fragment>
			)}
			<div className="mv-sidebar-scroll">
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

function ItemCameraMode({ ctx, meta, centery }: { ctx: UIContextReady, meta?: items, centery: number }) {
	let [translatex, settranslatex] = React.useState(meta?.modelTranslate_0 ?? 0);
	let [translatey, settranslatey] = React.useState(meta?.modelTranslate_1 ?? 0);
	let [rotx, setrotx] = React.useState(meta?.rotation_0 ?? 0);
	let [roty, setroty] = React.useState(meta?.rotation_1 ?? 0);
	let [rotz, setrotz] = React.useState(meta?.rotation_2 ?? 0);
	let [zoom, setzoom] = React.useState(meta?.model_zoom ?? 2048);
	let [lastmeta, setlastmeta] = React.useState(meta);

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

	const defaultcamdist = 16;//found through testing
	const imgheight = 32;
	const imgwidth = 36;

	let cam = ctx.renderer.getItemCamera();

	//fov such that the value 32 ends up in the projection matrix.yy
	//not sure if coincidence that this is equal to height
	cam.fov = Math.atan(1 / 32) / (Math.PI / 180) * 2;
	cam.aspect = imgwidth / imgheight;
	cam.updateProjectionMatrix();

	let rot = new Quaternion().setFromEuler(new Euler(
		-rotx / 2048 * 2 * Math.PI,
		roty / 2048 * 2 * Math.PI,
		-rotz / 2048 * 2 * Math.PI,
		"ZYX"
	));
	let pos = new Vector3(
		6,//no clue where the 6 comes from
		0,
		4 * -zoom
	);
	let quatx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rotx / 2048 * 2 * Math.PI);
	let quaty = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -roty / 2048 * 2 * Math.PI);
	let quatz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -rotz / 2048 * 2 * Math.PI)
	pos.applyQuaternion(quatx);
	pos.add(new Vector3(
		-translatex * 4,
		translatey * 4,
		-translatey * 4//yep this is y not z, i don't fucking know
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

	let centery = (model?.loaded ? (model.loaded.modeldata.maxy + model.loaded.modeldata.miny) / 2 : 0);

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
		</React.Fragment>
	)
}

function SceneNpc(p: LookupModeProps) {
	const [data, model, id, setId] = useAsyncModelData(p.ctx, npcToModel);
	const forceUpdate = useForceUpdate();
	const initid = id?.id ?? (p.initialId && typeof p.initialId == "object" && (typeof p.initialId as any).id == "number" ? (p.initialId as any).id : 0);
	const head = id?.head ?? false;

	return (
		<React.Fragment>
			{p.ctx && <IdInputSearch cache={p.ctx.sceneCache.engine} mode="npcs" onChange={v => setId({ id: v, head })} initialid={initid} />}
			{id == null && (
				<p>Enter an NPC id or search by name.</p>
			)}
			{model && data && (<label><input type="checkbox" checked={head} onChange={e => setId({ id: initid, head: e.currentTarget.checked })} />Head</label>)}
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
					tile: { ...typedmatch.tile, next01: undefined, next10: undefined, next11: undefined }
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

		//find the last skybox
		let skysettings: RSMapChunkData["sky"] | null = null;
		for (let group of this.state.chunkgroups) {
			if (group.chunk.loaded?.sky) {
				skysettings = group.chunk.loaded.sky;
			}
		}

		return (
			<React.Fragment>
				{this.state.chunkgroups.length == 0 && (
					<React.Fragment>
						<StringInput onChange={this.onSubmit} initialid={initid} />
						<p>Input format: x,z[,xsize=1,[zsize=xsize]]</p>
						<p>Coordinates are in so-called mapsquare coordinates, each mapsquare is 64x64 tiles in size. The entire RuneScape map is laid out in one plane and is 100x200 mapsquares in size.</p>
					</React.Fragment>
				)}
				{this.state.chunkgroups.length != 0 && (
					<div className="mv-sidebar-scroll">
						<div className="map-grid-container">
							<div className="map-grid-root" style={{ gridTemplateColumns: `20px repeat(${xsize - 2},40px) 20px`, gridTemplateRows: `20px repeat(${zsize - 2},40px) 20px` }}>
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
						<input type="button" className="sub-btn" onClick={this.clear} value="Clear" />
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
						<JsonDisplay obj={this.state.selectionData} />
					</div>
				)}
			</React.Fragment>
		)
	}
}

function ExtractFilesScript(p: UiScriptProps) {
	let [filestext, setFilestext] = React.useState("");
	let [mode, setMode] = React.useState<keyof typeof cacheFileDecodeModes>("items");
	let [batched, setbatched] = React.useState(true);
	let [keepbuffers, setkepbuffers] = React.useState(false);

	let run = () => {
		let output = new UIScriptOutput();
		let outdir = output.makefs("out");
		let files = stringToFileRange(filestext);
		output.run(extractCacheFiles, outdir, p.source, { files, mode, batched, batchlimit: -1, edit: false, keepbuffers });
		p.onRun(output);
	}

	return (
		<React.Fragment>
			<p>Extract files from the cache.<br />The ranges field uses logical file id's for JSON based files, {"<major>.<minor>"} notation for bin mode, or {"<x>.<z>"} for map based files.</p>
			<LabeledInput label="Mode">
				<select value={mode} onChange={e => setMode(e.currentTarget.value as any)}>
					{Object.keys(cacheFileDecodeModes).map(k => <option key={k} value={k}>{k}</option>)}
				</select>
			</LabeledInput>
			<LabeledInput label="File ranges">
				<InputCommitted type="text" onChange={e => setFilestext(e.currentTarget.value)} value={filestext} />
			</LabeledInput>
			<div><label><input type="checkbox" checked={batched} onChange={e => setbatched(e.currentTarget.checked)} />Concatenate group files</label></div>
			<div><label><input type="checkbox" checked={keepbuffers} onChange={e => setkepbuffers(e.currentTarget.checked)} />Keep binary buffers (can be very large)</label></div>
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}

function MaprenderScript(p: UiScriptProps) {
	let [endpoint, setEndpoint] = React.useState(localStorage.rsmv_script_map_endpoint ?? "");
	let [auth, setAuth] = React.useState("");
	let [mapid, setMapId] = React.useState(0);

	let run = () => {
		let output = new UIScriptOutput();
		localStorage.rsmv_script_map_endpoint = endpoint;
		output.run(runMapRender, p.source, "main", endpoint, auth, mapid, false);
		p.onRun(output);
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
function CacheDiffScript(p: UiScriptProps) {
	let [cache2, setCache2] = React.useState<CacheFileSource | null>(null);
	let [selectopen, setSelectopen] = React.useState(false);
	let [result, setResult] = React.useState<FileEdit[] | null>(null);
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
		p.onRun(output);
		let res = output.run(diffCaches, outdir, cache2, p.source);
		res.then(setResult);
	}

	let clickOpen = () => {
		let frame = showModal({ title: "Select a cache" }, (
			<CacheSelector onOpen={v => { openCache(v); frame.close(); }} noReopen={true} />
		));
	}

	React.useEffect(() => {
		if (result && showmodels && cache2 && p.ctx.sceneCache) {
			let prom = EngineCache.create(cache2).then(engine => {
				let oldscene = new ThreejsSceneCache(engine);
				let models: RSModel[] = [];
				const xstep = 5 * 512;
				const zstep = 5 * 512;
				let modelcount = 0;
				for (let diff of result!) {
					if (diff.major == cacheMajors.models) {
						if (diff.before) {
							let model = new RSModel([{ modelid: diff.minor, mods: {} }], oldscene);
							model.rootnode.position.set(modelcount * xstep, 0, zstep);
							models.push(model);
							model.addToScene(p.ctx.renderer!);
						}
						if (diff.after) {
							let model = new RSModel([{ modelid: diff.minor, mods: {} }], p.ctx.sceneCache!);
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
			{cache2 && <input type="button" className="sub-btn" value={`Close ${cache2.getCacheName()}`} onClick={e => setCache2(null)} />}
			<input type="button" className="sub-btn" value="Run" onClick={run} />
			{result && <label><input checked={showmodels} onChange={e => setshowmodels(e.currentTarget.checked)} type="checkbox" />View changed models</label>}
		</React.Fragment>
	)
}

function TestFilesScript(p: UiScriptProps) {
	let [mode, setMode] = React.useState("");
	let [range, setRange] = React.useState("");

	let run = () => {
		let modeobj = cacheFileJsonModes[mode as keyof typeof cacheFileJsonModes];
		if (!modeobj) { return; }
		let output = new UIScriptOutput();
		let outdir = output.makefs("output")
		let opts = defaultTestDecodeOpts();
		//TODO remove or make ui
		if (globalThis.fileparser) {
			modeobj = { ...modeobj };
			modeobj.parser = new FileParser(globalThis.fileparser);
		}
		output.run(testDecode, outdir, p.source, modeobj, stringToFileRange(range), opts);
		p.onRun(output);
	}

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
			<input type="button" className="sub-btn" value="Run" onClick={run} />
		</React.Fragment>
	)
}
type UiScriptProps = { onRun: (output: UIScriptOutput) => void, source: CacheFileSource, ctx: UIContext };
const uiScripts: Record<string, React.ComponentType<UiScriptProps>> = {
	test: TestFilesScript,
	extract: ExtractFilesScript,
	maprender: MaprenderScript,
	diff: CacheDiffScript
}

function ScriptsUI(p: LookupModeProps) {
	let [script, setScript] = React.useState<string>(p.initialId as any);
	let [running, setRunning] = React.useState<UIScriptOutput | null>(null);

	let onRun = React.useCallback((output: UIScriptOutput) => {
		localStorage.rsmv_lastsearch = JSON.stringify(script);
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
				{SelectedScript && <SelectedScript source={source} onRun={onRun} ctx={p.partial} />}
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
