import { ThreejsSceneCache, constModelsIds } from '../../3d/modeltothree';
import { RGB2HSL, HSL2packHSL, ModelModifications, checkObject } from '../../utils';
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { internalNameFiles } from "../../constants";
import * as React from "react";
import { ThreeJsSceneElementSource } from "../threejsrender";
import { RenderableContext, UIEngineContext } from "../maincomponents";
import { showModal } from "../jsonsearch";
import { JsonDisplay, IdInput, LabeledInput, IdInputSearch, RawTextDisplay, useForceUpdate, TextureView, DomWrap } from "../commoncontrols";
import { items } from "../../../generated/items";
import { castModelInfo, itemToModel, locToModel, modelToModel, npcToModel, SimpleModelDef, SimpleModelInfo, spotAnimToModel } from "../../3d/scene";
import { mapsquare_overlays } from '../../../generated/mapsquare_overlays';
import { mapsquare_underlays } from '../../../generated/mapsquare_underlays';
import { parse } from '../../parser/jsondecoders';
import { MaterialData } from '../../3d/materials/jmat';
import { debugProcTexture } from '../../3d/materials/proceduraltexture';
import { RSModel } from '../../3d/scene/model';
import { StructView } from '../viewers/configview';
import { LookupModeProps } from '../scenenodes';


type AsyncModelData<ID, T> = [
    visible: SimpleModelInfo<T, ID> | null,
    loadedModel: RSModel | null,
    loadedId: ID | null,
    setter: (id: ID) => void
];

export function useAsyncModelData<ID, T>(ctx: RenderableContext | null, getter: (cache: ThreejsSceneCache, id: ID) => Promise<SimpleModelInfo<T, ID>>) {
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
    return [
        visible,
        loadedModel,
        loadedId,
        setter
    ] satisfies AsyncModelData<ID, T>;
}

export function SceneRawModel(p: LookupModeProps) {
    let ctx = React.useContext(UIEngineContext);
    let [data, model, id, setId] = useAsyncModelData(ctx, modelToModel);
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
                    <RawTextDisplay text={data?.assetName} />
                    <JsonDisplay obj={{ ...data?.info.modeldata, meshes: undefined }} />
                    <JsonDisplay obj={data?.info.info} />
                </div>
            )}
        </React.Fragment>
    )
}

export function SceneLocation(p: LookupModeProps) {
    const ctx = React.useContext(UIEngineContext);
    const [data, model, id, setId] = useAsyncModelData(ctx, locToModel);
    const forceUpdate = useForceUpdate();
    let initid = id ?? (typeof p.initialId == "number" ? p.initialId : 0);
    return (
        <React.Fragment>
            <IdInputSearch cache={ctx?.sceneCache.engine} mode="locs" onChange={setId} initialid={initid} />
            {id == null && (
                <React.Fragment>
                    <p>Enter a location id or search by name.</p>
                    <p>Locations make up just about everything in the world that isn't a player or NPC.</p>
                </React.Fragment>
            )}
            {model && data?.anims && (
                <LabeledInput label="Animation">
                    <select onChange={e => { model.setAnimation(+e.currentTarget.value); forceUpdate() }} value={model.targetAnimId}>
                        {Object.entries(data.anims).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
                    </select>
                </LabeledInput>
            )}
            <div className="mv-sidebar-scroll">
                <RawTextDisplay text={data?.assetName} />
                <StructView data={data?.info} meta={parse.loc.parser.getJsonSchema()} />
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

function ItemCameraMode({ meta, centery }: { meta?: items, centery: number }) {
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

    let ctx = React.useContext(UIEngineContext);
    let cam = ctx && updateItemCamera(ctx.renderer.getItemCamera(), imgwidth, imgheight, centery, params);

    React.useEffect(() => {
        if (!ctx) { return; }
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
        return () => ctx.renderer!.removeSceneElement(el);
    }, [cam, ctx]);

    ctx?.renderer.forceFrame();

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

export function SceneItem(p: LookupModeProps) {
    let ctx = React.useContext(UIEngineContext);
    let [data, model, id, setId] = useAsyncModelData(ctx, itemToModel);
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

    data?.info

    return (
        <React.Fragment>
            <IdInputSearch cache={ctx?.sceneCache.engine} mode="items" onChange={setId} initialid={initid} />
            {id == null && (
                <p>Enter an item id or search by name.</p>
            )}
            <div className="mv-sidebar-scroll">
                <input type="button" className="sub-btn" value={enablecam ? "exit" : "Icon Camera"} onClick={e => setenablecam(!enablecam)} />
                {enablecam && <ItemCameraMode meta={data?.info.modelitem} centery={centery} />}
                <RawTextDisplay text={data?.assetName} />
                <StructView data={data?.info.item} meta={parse.item.parser.getJsonSchema()} />
            </div>
            {/* <input type="button" className="sub-btn" value="history" onClick={gethistory} />
            {histfs && p.ctx && <UIScriptFiles fs={histfs} ctx={p.ctx} />} */}
        </React.Fragment>
    )
}

export function SceneNpc(p: LookupModeProps) {
    const ctx = React.useContext(UIEngineContext);
    const [data, model, id, setId] = useAsyncModelData(ctx, npcToModel);
    const forceUpdate = useForceUpdate();
    const initid = id ?? checkObject(p.initialId, { id: "number", head: "boolean" }) ?? { id: 0, head: false };

    return (
        <React.Fragment>
            <IdInputSearch cache={ctx?.sceneCache.engine} mode="npcs" onChange={v => setId({ id: v, head: initid.head })} initialid={initid.id} />
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
                <RawTextDisplay text={data?.assetName} />
                <StructView data={data?.info} meta={parse.npc.parser.getJsonSchema()} />
            </div>
        </React.Fragment>
    )
}

export function SceneSpotAnim(p: LookupModeProps) {
    let ctx = React.useContext(UIEngineContext);
    let [data, model, id, setId] = useAsyncModelData(ctx, spotAnimToModel);
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
                <RawTextDisplay text={data?.assetName} />
                <StructView data={data?.info} meta={parse.spotAnims.parser.getJsonSchema()} />
            </div>
        </React.Fragment>
    )
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
    let materialname = await sceneCache.engine.rawsource.getInternalName(internalNameFiles.material, matid);

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
        info: { overlay, underlay, texs, obj: json, materialname },
        id: reqid,
        assetName: undefined,
        name: `${reqid.mode}:${reqid.id}`
    });
}

export function SceneMaterialIsh(p: LookupModeProps) {
    let ctx = React.useContext(UIEngineContext);
    let [data, model, id, setId] = useAsyncModelData(ctx, materialIshToModel);

    let initid = id ?? checkObject(p.initialId, { mode: "string", id: "number" }) as MaterialIshId ?? { mode: "material", id: 0 };
    let modechange = (v: React.FormEvent<HTMLInputElement>) => setId({ mode: v.currentTarget.value as any, id: initid.id });
    let isproc = ctx && ctx.sceneCache.textureType == "fullproc";
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
                        {isproc && data && ctx && (
                            <input type="button" className="sub-btn" value="Debug proc" onClick={async () => {
                                let el = await debugProcTexture(ctx.sceneCache.engine, img.texid);
                                el.style.position = "initial";
                                showModal({ title: "proc texture " + img.texid, maxWidth: "unset" }, <DomWrap el={el} />);
                            }} />
                        )}
                        <div>{name} - {img.texid} - {img.filesize > 10000 ? `${img.filesize / 1024 | 0}kb` : `${img.filesize} bytes`} - {img.img0.width}x{img.img0.height}</div>
                        <TextureView img={img.img0} />
                    </div>
                ))}
                {data?.info.overlay && <JsonDisplay obj={data?.info.overlay} />}
                {data?.info.underlay && <JsonDisplay obj={data?.info.underlay} />}
                {data?.info.materialname && <RawTextDisplay text={data?.info.materialname} />}
                <JsonDisplay obj={data?.info.obj} />
            </div>
        </React.Fragment>
    )
}
