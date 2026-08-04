import * as React from "react";
import { UIEngineContext } from "./maincomponents";
import { cacheConfigPages, cacheMajors, internalNameFiles, vartypes } from "../constants";
import { parseSprite } from "../3d/materials/sprite";
import { pixelsToDataUrl } from "../imgutils";
import { JSONSchema6, JSONSchema6Definition } from "json-schema";
import { useAwaited } from "./scriptsui";
import { loadParams } from "../clientscript/util";
import { CacheFileSource } from "../cache";
import classNames from "classnames";
import { HSL2RGB, packedHSL2HSL, RGB2HSL } from "../utils";
import { BlobImage } from "./commoncontrols";
import { parseMusic } from "../scripts/musictrack";
import { variableSources } from "../clientscript/definitions";
import { cacheFileJsonModes, JsonBasedFile } from "../parser/jsondecoders";

type CustomPropTypes = "params" | "color" | "imagefile" | "rgb" | "argb" | "type" | "enumkey" | "enumvalue" | "paramvalue" | "dbvalue" | "varbit";
type PropTypes = keyof typeof vartypes | CustomPropTypes | "unknown";

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


export async function getFileJson<T extends keyof typeof cacheFileJsonModes>(source: CacheFileSource, mode: T, id: number | number[])
    : Promise<typeof cacheFileJsonModes[T] extends JsonBasedFile<infer Q> ? Q : never> {

    let modefn = cacheFileJsonModes[mode];
    let logicalid = Array.isArray(id) ? id : [id];
    let fileid = modefn.lookup.logicalToFile(source, logicalid);
    let file: Buffer | undefined = undefined;
    if (modefn.lookup.usesArchieves) {
        let arch = await source.getArchiveById(fileid.major, fileid.minor);
        let entry = arch.find(q => q.fileid == fileid.subid);
        if (!entry) { throw new Error(`Logical file ${mode}_${logicalid.join(".")} not found at ${fileid.major}.${fileid.minor}.${fileid.subid}`); }
        file = entry?.buffer;
    } else {
        file = await source.getFileById(fileid[0], fileid[1]);
    }
    let json = modefn.parser.read(file, source);
    json.$fileid = logicalid.length == 1 ? logicalid[0] : logicalid;
    json.$decoder = mode;
    return json;
}


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
            } else if (rsmvtype == "varbit") {
                if (data != 0xffff) {
                    let meta = await getFileJson(ctx.source, "varbits", data);
                    let varint = meta.varid ?? 0;
                    let domain = (varint >> 16) & 0xff;
                    let varid = varint & 0xffff;
                    let group = Object.entries(variableSources).find(([k, v]) => v.key == domain);
                    if (group && group[1].namefile != -1) {
                        let varname = await ctx.source.getInternalName(group[1].namefile, varid);
                        valuename = `varbit_${group[0]}_${varid}${varname ? `_${varname}` : ""}`;
                    }
                }
            } else if (rsmvtype == "var_reference") {
                let domain = (data >> 16) & 0xff;
                let varid = data & 0xffff;
                let group = Object.entries(variableSources).find(([k, v]) => v.key == domain);
                if (group && group[1].namefile != -1) {
                    let varname = await ctx.source.getInternalName(group[1].namefile, varid);
                    valuename = `ref_var_${group[0]}_${varid}${varname ? `_${varname}` : ""}`;
                }
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
        let parsed = await getFileJson(enginectx.source, "cursors", p.id);
        return parsed.cursor;
    }, [p.id, enginectx]);
    return <SpriteView id={spriteid ?? 0} />;
}

function SoundView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);

    let soundblob = useAwaited(async () => {
        if (!enginectx) { return; }
        let sound = await parseMusic(enginectx.source, cacheMajors.sounds, p.id, null, true);
        return URL.createObjectURL(new Blob([sound], { type: "audio/ogg" }));
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
            alpha = p.rgb[3];
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
            <span className="mv-proptable__color" style={{ background: `rgb(${color[0]}, ${color[1]}, ${color[2]})` }} />
            color: {colorstring}
        </span>
    );
}

function CoordGridView(p: { value: number }) {
    let plane = (p.value >> 28) & 0x3;
    let x = (p.value >> 14) & 0x3FFF;
    let z = p.value & 0x3FFF;
    return <span>coord: {plane}_{x}_{z}</span>;
}

export function StructView(p: { data: any, meta: JSONSchema6Definition | null | undefined }) {
    let [maxarraylen, setmaxarraylen] = React.useState(1000);
    let source = React.useContext(UIEngineContext)?.source;
    let data = useAwaited(async () => source && deepLinkJson({ source, objstack: [] }, "root", p.data, p.meta), [p.data, p.meta, source]);

    let handlenode = (prop: DeepLinkElement, isroot = false): { isbig: boolean, el: JSX.Element } => {
        if (typeof prop.primitive == "number") {
            let rawtext = `${prop.primitive} (${prop.rsmvtype})`;
            if (prop.valuename) { rawtext = `${prop.valuename} (${prop.rsmvtype}_${prop.primitive})`; }

            if (prop.rsmvtype == "color") {
                return { isbig: false, el: <ColorView hsl={prop.primitive} /> };
            }
            if (prop.rsmvtype == "coordgrid") {
                return { isbig: false, el: <CoordGridView value={prop.primitive} /> };
            }
            if (prop.rsmvtype == "graphic") {
                return { isbig: false, el: <><div>{rawtext}</div><SpriteView id={prop.primitive} /></> };
            }
            if (prop.rsmvtype == "texture") {
                return { isbig: false, el: <><div>{rawtext}</div><TextureView id={prop.primitive} /></> };
            }
            if (prop.rsmvtype == "cursor") {
                return { isbig: false, el: <><div>{rawtext}</div><CursorView id={prop.primitive} /></> };
            }
            if (prop.rsmvtype == "sound") {
                return { isbig: false, el: <><div>{rawtext}</div><SoundView id={prop.primitive} /></> };
            }
            return { isbig: false, el: <span>{rawtext}</span> };
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
            let isbig = false;
            let lencount = 0;
            let children: JSX.Element[] = [];
            for (let i = 0; i < prop.array.length; i++) {
                let q = prop.array[i];
                if (lencount >= maxarraylen) {
                    children.push(<div key="truncated" className="mv-proptable__entry">
                        <input type="button" className="sub-btn" onClick={e => setmaxarraylen(maxarraylen * 2)} value={`Show more(${i} / ${prop.array.length})`} />
                    </div>);
                    break;
                }
                let child = handlenode(q);
                isbig ||= child.isbig;
                lencount += (child.isbig ? 10 : 1);
                children.push(<div key={i} className="mv-proptable__entry">{child.el}</div>);
            }
            let el = <div className="mv-proptable mv-proptable--array">{children}</div>;
            return { isbig, el };
        }
        if (prop.items) {
            let el = <div className={classNames({ "mv-proptable": true, "mv-proptable--nested": !isroot })}>
                {prop.items.map((q, i) => {
                    let child = handlenode(q);
                    if (child.isbig) {
                        return (
                            <div key={i} className="mv-proptable__entry">
                                <div className="mv-proptable__name">{q.name}</div>
                                {child.el}
                            </div>
                        );
                    } else {
                        return (
                            <React.Fragment key={i}>
                                <div className="mv-proptable__name">{q.name}</div>
                                <div className="mv-proptable__value">{child.el}</div>
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
        <div>
            <h3>{decoder}_{fileidstring} - {filename}</h3>
            {data ? handlenode(data, true).el : <span>Loading...</span>}
        </div>
    );
}
