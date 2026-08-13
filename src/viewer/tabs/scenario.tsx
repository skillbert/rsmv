import { ThreejsSceneCache } from '../../3d/modeltothree';
import { delay, hex2hsl, hsl2hex, ModelModifications, stringToMapArea } from '../../utils';
import * as React from "react";
import { RenderableContext, UIContext, UIEngineContext, UIRootContext } from "../maincomponents";
import { selectEntity } from "../jsonsearch";
import { CopyButton, InputCommitted, PasteButton, StringInput } from "../commoncontrols";
import { RSModel } from '../../3d/scene/model';
import { LookupModeProps } from '../scenenodes';
import { itemToModel, npcBodyToModel, locToModel, spotAnimToModel, playerToModel, SimpleModelInfo, SimpleModelDef, modelToModel } from '../../3d/scene';
import { RSMapChunk, RSMapChunkGroup } from '../../3d/scene/mapchunk';
import { CombinedTileGrid, getTileHeight, MapRect, rs2ChunkSize, tiledimensions, TileGrid } from '../../3d/mapsquare';
import { assertSchema, customModelDefSchema, parseJsonOrDefault, scenarioStateSchema } from '../../parser/jsonschemas';
import { boundMethod } from 'autobind-decorator';

// function editScenarioComponent(comp: ScenarioComponent, onChange: (v: ScenarioComponent | null) => void) {
// 	let box = showModal({ title: "Edit Component" }, <div>{<ScenarionComponentSettings comp={comp} onChange={onChange} />}</div>);
// }

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


function ScenarioComponentControl(p: { comp: ScenarioComponent, onChange: (v: ScenarioComponent | null) => void }) {
    let ctx = React.useContext(UIEngineContext);
    let [showOpts, setShowOpts] = React.useState(false);
    let edit = () => {
        if (p.comp.type == "simple") {
            p.onChange(convertScenarioComponent(p.comp));
            setShowOpts(true);
        }
    }
    let revert = async () => {
        if (p.comp.type != "custom" || !ctx) { return; }
        let def = await modelInitToModel(ctx.sceneCache, p.comp.basecomp);
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
        assetName: undefined,
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


export function SceneScenario(p: LookupModeProps) {
    let ctx = React.useContext(UIRootContext);
    let render = React.useContext(UIEngineContext);
    return <SceneScenarioInner {...p} ctx={render} partial={ctx} />;
}


class SceneScenarioInner extends React.Component<LookupModeProps & { ctx: RenderableContext | null, partial: UIContext }, ScenarioInterfaceState> {
    models = new Map<ScenarioComponent, RSModel | RSMapChunk | RSMapChunkGroup>();
    idcounter = 0;
    mapoffset: { x: number, z: number } | null = null;
    mapgrid = new CombinedTileGrid([]);
    hadctx = false;

    constructor(p: LookupModeProps & { ctx: RenderableContext | null, partial: UIContext }) {
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
        let keys = Object.keys(newstate.components).map(q => +q);
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

    ensureComp(uictx: RenderableContext, newcomp: ScenarioComponent | null, oldcomp: ScenarioComponent | null) {
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
            selectEntity(this.props.ctx.sceneCache.engine, "npcs", id => this.addComp("" + id), [{ path: ["name"], search: "" }])
        } else if (this.state.addModelType == "item") {
            selectEntity(this.props.ctx.sceneCache.engine, "items", id => this.addComp("" + id), [{ path: ["name"], search: "" }])
        } else if (this.state.addModelType == "loc") {
            selectEntity(this.props.ctx.sceneCache.engine, "locs", id => this.addComp("" + id), [{ path: ["name"], search: "" }])
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
                                return <ScenarioComponentControl key={id} comp={comp} onChange={e => this.editComp(+id, e)} />;
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

