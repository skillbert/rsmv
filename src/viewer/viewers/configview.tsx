import * as React from "react";
import { UIEngineContext, UIRootContext } from "../maincomponents";
import { cacheMajors, internalNameFiles, vartypes } from "../../constants";
import { parseSprite } from "../../3d/materials/sprite";
import { pixelsToDataUrl } from "../../imgutils";
import { JSONSchema6, JSONSchema6Definition } from "json-schema";
import { loadParams } from "../../clientscript/util";
import { CacheFileSource } from "../../cache";
import classNames from "classnames";
import { BlobTS, HSL2RGB, packedHSL2HSL, RGB2HSL, unpackCoordgrid } from "../../utils";
import { BlobImage, useAwaited } from "../commoncontrols";
import { parseMusic } from "../../scripts/musictrack";
import { BrowseModes, makeFileId } from "../tabs/browse";
import { styleSheetImageProps, styleSheetRGBAProps, styleSheetRGBProps } from "../../scripts/renderrsinterface";

type CustomPropTypes = "params" | "color" | "imagefile" | "rgb" | "argb" | "type" | "enumkey" | "enumvalue" | "paramvalue" | "dbvalue" | "dbrow_definition" | "varbit" | "stylevalue";
type PropTypes = keyof typeof vartypes | CustomPropTypes | "unknown" | "";

type DeepLinkElement = {
    rsmvtype: PropTypes,
    name: string,
    valuename?: string | undefined,
    primitive?: string | number | boolean | null,
    items?: DeepLinkElement[],
    array?: DeepLinkElement[]
}

class DeepLinkContext {
    source: CacheFileSource;
    objstack: any[] = [];
    constructor(source: CacheFileSource) {
        this.source = source;
    }
}

export const vartypeToDecoder: Partial<Record<keyof typeof vartypes, BrowseModes>> = {
    achievement: "achievements",
    bas: "animgroupconfigs",
    chatcat: "quickchatcats",
    chatphrase: "quickchatlines",
    cursor: "cursors",
    cutscene: "cutscenes",
    dbrow: "dbrows",
    enum: "enums",
    idkit: "identitykit",
    obj: "items",
    loc: "locs",
    model: "models",
    fontmetrics: "fontmetrics",
    npc: "npcs",
    seq: "sequences",
    spotanim: "spotanims",
    sound: "sounds",
    midi: "music",
    struct: "structs",
    quest: "quests",
    material: "materials",
    var_player: "var_player",
    stylesheet: "stylesheets",
    skybox: "skyboxes",
    graphic: "sprites",
    interface: "interfaces",
    scriptref: "clientscript",
    inv: "inventories",
    coordgrid: "coordgrid",
    maparea: "mapzones",
    // TODO fix these
    ["maplabel" as any]: "maplabels",
    ["varbit" as any]: "varbits",
    // need to confirm
    // mapsceneicon: "mapscenes",
    // mapelement: "maplabels",
    // skybox: "environments",
    // non-json
    // graphic: "sprites",
    // texture: "textures",
    // maparea: "mapareas",
    component: "interfaceviewer",//redirect this to interfaceviewer instead
    // interface: "interfaces"
}

const skillNames = [
    "ATTACK",
    "DEFENCE",
    "STRENGTH",
    "HITPOINTS",
    "RANGING",
    "PRAYER",
    "MAGIC",
    "COOKING",
    "WOODCUTTING",
    "FLETCHING",
    "FISHING",
    "FIREMAKING",
    "CRAFTING",
    "SMITHING",
    "MINING",
    "HERBLORE",
    "AGILITY",
    "THIEVING",
    "SLAYER",
    "FARMING",
    "RUNECRAFTING",
    "HUNTING",
    "CONSTRUCTION",
    "SUMMONING",
    "DUNGEONEERING",
    "DIVINATION",
    "INVENTION",
    "ARCHAEOLOGY",
    "NECROMANCY"
];

async function deepLinkParamtable(ctx: DeepLinkContext, value: any[]) {
    let paramData = await loadParams(ctx.source);
    let paramNames = await ctx.source.getInternalNameList(internalNameFiles.param);
    return Promise.all(value.map<Promise<DeepLinkElement>>(q => {
        let paramname = paramNames.get(q.prop) ?? `param_${q.prop}`;
        let paramdata = paramData.get(q.prop);
        let typeid = paramdata?.type?.vartype ?? -1;
        let typename = Object.entries(vartypes).find(([k, v]) => v == typeid)?.[0] ?? "unknown"
        return deepLinkJson(ctx, paramname, q.intvalue ?? q.stringvalue, { "x-rsmv-type": typename } as any);
    }));
}


async function deepLinkJson(ctx: DeepLinkContext, nameorindex: string | number, data: any, meta: JSONSchema6Definition | null | undefined): Promise<DeepLinkElement> {
    let name = typeof nameorindex == "number" ? "" : nameorindex;
    ctx.objstack.push(data);
    try {
        if (typeof meta == "boolean") { meta = null; }

        // === find expected type ===
        let rsmvtype = getRSType(meta);
        if (rsmvtype == "enumkey") {
            let keyint = ctx.objstack.at(0)?.key_type1 ?? ctx.objstack.at(0)?.key_type2;
            rsmvtype = Object.entries(vartypes).find(([k, v]) => v == keyint)?.[0] as any ?? "unknown";
        }
        if (rsmvtype == "enumvalue") {
            let valueint = ctx.objstack.at(0)?.value_type1 ?? ctx.objstack.at(0)?.value_type2;
            rsmvtype = Object.entries(vartypes).find(([k, v]) => v == valueint)?.[0] as any ?? "unknown";
        }
        if (rsmvtype == "paramvalue") {
            let paramint = ctx.objstack.at(0)?.type?.vartype;
            rsmvtype = Object.entries(vartypes).find(([k, v]) => v == paramint)?.[0] as any ?? "unknown";
        }
        if (rsmvtype == "dbvalue") {
            let fieldtype = ctx.objstack.at(-1)?.type ?? ctx.objstack.at(-4)?.subtypes?.[nameorindex];
            rsmvtype = Object.entries(vartypes).find(([k, v]) => v == fieldtype)?.[0] as any ?? "unknown";
        }
        if (typeof data == "number" && rsmvtype == "stylevalue") {
            let proptype = ctx.objstack.at(-2)?.prop;
            if (proptype != null) {
                if (styleSheetImageProps.includes(proptype)) {
                    rsmvtype = "graphic";
                } else if (styleSheetRGBProps.includes(proptype)) {
                    rsmvtype = "rgb";
                    data = [(data >> 16) & 0xff, (data >> 8) & 0xff, data & 0xff];
                } else if (styleSheetRGBAProps.includes(proptype)) {
                    rsmvtype = "argb";
                    data = [(data >> 0) & 0xff, (data >> 24) & 0xff, (data >> 16) & 0xff, (data >> 8) & 0xff];
                } else {
                    rsmvtype = "unknown";
                }
            }
        }
        // collapse multitypes
        if (typeof data == "number" && rsmvtype == "var_reference") {
            let domainid = (data >> 24) & 0xff;
            data = data & 0xffff;
            if (domainid == 0) { rsmvtype = "var_player"; }
            else if (domainid == 1) { rsmvtype = "varbit"; }
            else { console.log("unknown var_reference domainid: " + domainid); }
        }
        if (typeof data == "number" && rsmvtype == "achievement_or_varbit") {
            let domainid = (data >> 24) & 0xff;
            data = data & 0xffff;
            if (domainid == 0) { rsmvtype = "achievement"; }
            else if (domainid == 1) { rsmvtype = "varbit"; }
            else { console.log("unknown achievement_or_varbit domainid: " + domainid); }
        }

        // === fix schema location ===
        // strip nullable type from schema
        if (meta?.oneOf) {
            meta = meta.oneOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
        }
        if (meta?.anyOf) {
            meta = meta.anyOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
        }

        // === handle data type ===
        if (ArrayBuffer.isView(data)) {
            // we were handed a typed array, which is only possible if our object hasn't been serialized to JSON yet
            // force it into a string to simulate json roundtrip
            data = "" + data;
        }

        // === render data ===
        if (typeof data == "number") {
            let valuename: string | undefined = undefined;

            if (rsmvtype == "type") {
                valuename = Object.entries(vartypes).find(([k, v]) => v == data)?.[0];
            } else if (rsmvtype == "stat") {
                valuename = skillNames[data];
            }
            let namegroup = internalNameFiles[rsmvtype];
            valuename ??= (namegroup != undefined ? await ctx.source.getInternalName(namegroup, data) : undefined);

            return { name, rsmvtype, valuename, primitive: data };
        } else if (typeof data == "string" || typeof data == "boolean" || data == null) {
            return { name, rsmvtype, primitive: data };
        } else if (Array.isArray(data)) {
            if (rsmvtype == "params") {
                return { name, rsmvtype: "params", items: await deepLinkParamtable(ctx, data) };
            }
            let subs: DeepLinkElement[] = [];
            for (let i = 0; i < data.length; i++) {
                let itemmeta: JSONSchema6Definition | null = null;
                if (meta && meta.items) {
                    if (Array.isArray(meta.items)) {
                        itemmeta = meta.items[i];
                    } else {
                        itemmeta = meta.items;
                    }
                }
                subs.push(await deepLinkJson(ctx, i, data[i], itemmeta));
            }
            return { name, rsmvtype, array: subs };
        } else if (typeof data == "object") {
            let subs: DeepLinkElement[] = [];
            for (let key in data) {
                if (key.startsWith("$")) { continue; } // skip internal properties
                let itemmeta: JSONSchema6Definition | null = null;
                if (meta && meta.properties && meta.properties[key]) {
                    itemmeta = meta.properties[key];
                }
                subs.push(await deepLinkJson(ctx, key, data[key], itemmeta));
            }
            return { name, rsmvtype, items: subs };
        } else {
            throw new Error(`Unsupported data type: ${typeof data}`);
        }
    } finally {
        ctx.objstack.pop();
    }
}


function getRSType(meta: JSONSchema6Definition | null | undefined): PropTypes {
    return meta?.["x-rsmv-type"] ?? "unknown";
}

function SpriteView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);
    let imgurl = useAwaited(async () => {
        if (!enginectx) { return; }
        let file = await enginectx.source.getFileById(cacheMajors.sprites, p.id);
        let img = parseSprite(file);
        return pixelsToDataUrl(img[0].img);
    }, [p.id]);

    return <img src={imgurl ?? undefined} />;
}

function TextureView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);
    let imgurl = useAwaited(async () => {
        if (!enginectx) { return; }
        let file = await enginectx.sceneCache.getTextureFile("diffuse", p.id, false);
        return pixelsToDataUrl(await file.toImageData());
    }, [p.id]);

    return <img src={imgurl ?? undefined} />;
}

function CursorView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);
    let spriteid = useAwaited(async () => {
        if (!enginectx) { return; }
        let parsed = await enginectx.source.getObject("cursors", p.id);
        return parsed.cursor;
    }, [p.id, enginectx]);
    return <SpriteView id={spriteid ?? 0} />;
}

function SoundView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);

    let soundblob = useAwaited(async () => {
        if (!enginectx) { return; }
        let sound = await parseMusic(enginectx.source, cacheMajors.sounds, p.id, null, true);
        return URL.createObjectURL(new BlobTS([sound], { type: "audio/ogg" }));
    }, [p.id, enginectx]);

    // cleanup
    React.useEffect(() => () => {
        if (soundblob) { URL.revokeObjectURL(soundblob); }
    }, [soundblob]);

    return <audio src={soundblob ?? undefined} controls />;
}

function JsonImgFileView(p: { file: Uint8Array | string }) {
    let filedata = React.useMemo(() => typeof p.file == "string" ? Buffer.from(p.file, "hex") : p.file, [p.file]);
    return <BlobImage file={filedata} ext="png" />;
}

function ColorView(p: { hsl?: number, rgb?: number[] }) {
    let alpha = 255;
    let hasalpha = false;
    let color = [0, 0, 0];
    let hsl = [0, 0, 0];
    let colorstring = "";
    if (p.hsl !== undefined) {
        let hsl = packedHSL2HSL(p.hsl);
        color = HSL2RGB(hsl);
        colorstring = "" + p.hsl;
    }
    if (p.rgb !== undefined) {
        if (p.rgb.length == 4) {
            alpha = p.rgb[0];
            hasalpha = true;
            color = p.rgb.slice(1, 4);
        } else {
            color = p.rgb.slice(0, 3);
        }
        hsl = RGB2HSL(color[0], color[1], color[2]);
        colorstring = color.join(" ");
    }
    let title = `RS HSL: ${hsl[0] * 63}, ${hsl[1] * 7}, ${hsl[2] * 127}\nRGB: ${color[0]}, ${color[1]}, ${color[2]}`;
    return (
        <span title={title}>
            <span className="mv-proplist__color" style={{ background: `rgb(${color[0]}, ${color[1]}, ${color[2]})` }} />
            color: {colorstring}{hasalpha ? `, alpha: ${alpha}` : ""}
        </span>
    );
}

function DBRowsView(p: { data: DeepLinkElement }) {
    let data = p.data;

    let rowsroot = data.items?.find(q => q.name == "rows");
    let tableid = data.items?.find(q => q.name == "table");

    let tablesprop = rowsroot?.items?.find(q => q.name == "columndata");
    if (!tablesprop || !tablesprop.array) {
        return <span>no tables</span>;
    }

    let restables: JSX.Element[] = [];
    for (let tableindex = 0; tableindex < tablesprop.array.length; tableindex++) {
        let subtable = tablesprop.array[tableindex];
        let subtableid = subtable.items?.find(q => q.name == "columnid");
        let subtypesprop = subtable.items?.find(q => q.name == "subtypes");
        let rowsprop = subtable.items?.find(q => q.name == "rows");
        if (!subtypesprop || !rowsprop || !subtypesprop.array || !rowsprop.array) {
            restables.push(<div key={tableindex}>invalid table</div>);
            continue;
        }

        let rows: JSX.Element[] = [];
        rows.push(
            <tr key="header" className="mv-proptable__head">
                {subtypesprop.array.map((q, i) => <td key={i}>{renderPrimitive(q)?.el}</td>)}
            </tr>
        );

        for (let rowindex = 0; rowindex < rowsprop.array.length; rowindex++) {
            let rowprop = rowsprop.array[rowindex];
            rows.push(
                <tr key={rowindex} className="mv-proptable__row">
                    {rowprop.array?.map((q, i) => <td key={i}>{renderPrimitive(q)?.el ?? "?"}</td>)}
                </tr>
            );
        }

        restables.push(
            <table key={tableindex} className="mv-proptable">
                <tbody>
                    <tr className="mv-proptable__head"><th colSpan={subtypesprop.array.length}>Table {subtableid?.primitive ?? "?"}</th></tr>
                    {rows}
                </tbody>
            </table>
        );
    }
    return <div>
        {tableid && <>Table: {renderPrimitive(tableid)?.el ?? "?"}</>}
        {restables}
    </div>;
}

function ObjectLink(p: { prop: DeepLinkElement }) {
    let ctx = React.useContext(UIRootContext);
    let match = vartypeToDecoder[p.prop.rsmvtype];
    if (typeof p.prop.primitive != "number") { throw new Error("Objectlink primitive type number expected"); }

    let index = [p.prop.primitive];
    if (p.prop.rsmvtype == "component") {
        let main = (p.prop.primitive >> 16) & 0xffff;
        let sub = (p.prop.primitive) & 0xffff;
        index = [main, sub];
    }
    if (p.prop.rsmvtype == "coordgrid") {
        let { level, x, z } = unpackCoordgrid(p.prop.primitive);
        index = [level, x, z];
    }

    let fileid = makeFileId(p.prop.rsmvtype, index);

    let onclick = (e: React.MouseEvent) => {
        e.preventDefault();
        ctx.openFile({ type: "browse", id: fileid });
    }

    return <>
        <span className={match && "mv-filelink"} onClick={match && onclick}>{fileid}</span>
        {p.prop.valuename ? ` (${p.prop.valuename})` : null}
    </>
}

export function renderPrimitive(prop: DeepLinkElement) {
    if (typeof prop.primitive == "number") {
        if (prop.rsmvtype == "" || prop.rsmvtype == "unknown" || prop.rsmvtype == 'int') {
            return { isbig: false, el: <span>{prop.primitive}</span> };
        }

        if (prop.rsmvtype == "color") {
            return { isbig: false, el: <ColorView hsl={prop.primitive} /> };
        }
        if (prop.rsmvtype == "graphic") {
            return { isbig: false, el: <><div><ObjectLink prop={prop} /></div><SpriteView id={prop.primitive} /></> };
        }
        if (prop.rsmvtype == "texture") {
            return { isbig: false, el: <><div><ObjectLink prop={prop} /></div><TextureView id={prop.primitive} /></> };
        }
        if (prop.rsmvtype == "cursor") {
            return { isbig: false, el: <><div><ObjectLink prop={prop} /></div><CursorView id={prop.primitive} /></> };
        }
        if (prop.rsmvtype == "sound") {
            return { isbig: false, el: <><div><ObjectLink prop={prop} /></div><SoundView id={prop.primitive} /></> };
        }
        if (prop.rsmvtype == "boolean") {
            return { isbig: false, el: <span>{prop.primitive ? true : false}</span> };
        }
        return { isbig: false, el: <span><ObjectLink prop={prop} /></span> };
    }
    if (typeof prop.primitive == "string") {
        if (prop.rsmvtype == "imagefile") {
            return { isbig: false, el: <JsonImgFileView file={prop.primitive} /> };
        } else {
            return { isbig: false, el: <span>{prop.primitive}</span> };
        }
    }
    if (typeof prop.primitive == "boolean") {
        return { isbig: false, el: <span>{prop.primitive + ""}</span> };
    }
    if (prop.array) {
        if (prop.rsmvtype == "rgb" || prop.rsmvtype == "argb") {
            return { isbig: false, el: <ColorView rgb={prop.array.map(q => q.primitive as number)} /> };
        }
    }
    if (prop.items) {
        if (prop.rsmvtype == "dbrow_definition") {
            return { isbig: true, el: <DBRowsView data={prop} /> };
        }
    }
    return null;
}

export function StructView(p: { data: any, meta: JSONSchema6Definition | null | undefined }) {
    let [maxarraylen, setmaxarraylen] = React.useState(1000);
    let source = React.useContext(UIEngineContext)?.source;
    let data = useAwaited(async () => source && deepLinkJson({ source, objstack: [] }, "root", p.data, p.meta), [p.data, p.meta, source]);

    let handlenode = (prop: DeepLinkElement, isroot = false): { isbig: boolean, el: JSX.Element } => {
        let primitive = renderPrimitive(prop);
        if (primitive) { return primitive; }

        if (prop.array) {
            let isbig = false;
            let lencount = 0;
            let children: JSX.Element[] = [];
            for (let i = 0; i < prop.array.length; i++) {
                let q = prop.array[i];
                if (lencount >= maxarraylen) {
                    children.push(<div key="truncated" className="mv-proplist__entry">
                        <input type="button" className="sub-btn" onClick={e => setmaxarraylen(maxarraylen * 2)} value={`Show more(${i} / ${prop.array.length})`} />
                    </div>);
                    break;
                }
                let child = handlenode(q);
                isbig ||= child.isbig;
                lencount += (child.isbig ? 10 : 1);
                children.push(<div key={i} className="mv-proplist__entry">{child.el}</div>);
            }
            let el = <div className="mv-proplist mv-proplist--array">{children}</div>;
            return { isbig, el };
        }
        if (prop.items) {
            let el = <div className={classNames({ "mv-proplist": true, "mv-proplist--nested": !isroot })}>
                {prop.items.map((q, i) => {
                    let child = handlenode(q);
                    if (child.isbig) {
                        return (
                            <div key={i} className="mv-proplist__entry">
                                <div className="mv-proplist__name">{q.name}</div>
                                {child.el}
                            </div>
                        );
                    } else {
                        return (
                            <React.Fragment key={i}>
                                <div className="mv-proplist__name">{q.name}</div>
                                <div className="mv-proplist__value">{child.el}</div>
                            </React.Fragment>
                        );
                    }
                })}
            </div>
            return { isbig: true, el };
        }
        return { isbig: false, el: <span>NULL</span> };
    }

    let decoder = p.data?.$decoder ?? "unknown";
    let fileidstring = (p.data?.$fileid ? (Array.isArray(p.data.$fileid) ? p.data.$fileid.join(".") : p.data.$fileid) : "");
    let filename = p.data?.$filename ?? "";

    return (
        <div style={{ userSelect: "text" }}>
            <h3>{decoder}_{fileidstring} - {filename}</h3>
            {data ? handlenode(data, true).el : <span>Loading...</span>}
        </div>
    );
}
