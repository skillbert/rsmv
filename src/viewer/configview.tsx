import * as React from "react";
import { UIEngineContext } from "./maincomponents";
import { cacheConfigPages, cacheMajors, internalNameFiles } from "../constants";
import { parseSprite } from "../3d/materials/sprite";
import { pixelsToDataUrl } from "../imgutils";
import { JSONSchema6, JSONSchema6Definition } from "json-schema";
import { useAwaited } from "./scriptsui";
import { loadParams } from "../clientscript/util";
import { CacheFileSource } from "../cache";
import { subtypes } from "../clientscript/definitions";
import classNames from "classnames";
import { HSL2RGB, packedHSL2HSL, RGB2HSL } from "../utils";
import { BlobImage } from "./commoncontrols";
import { parseMusic } from "../scripts/musictrack";
import { parse } from "../opdecoder";

type PropTypes = keyof typeof subtypes | "unknown" | "params" | "color" | "imagefile" | "rgb" | "argb" | "type";

type DeepLinkElement = {
    rsmvtype: PropTypes,
    name: string,
    valuename?: string | undefined,
    primitive?: string | number | boolean | null,
    items?: DeepLinkElement[],
    array?: DeepLinkElement[]
}

async function deepLinkParamtable(value: any[], source: CacheFileSource) {
    let paramData = await loadParams(source);
    let paramNames = await source.getInternalNameList(internalNameFiles.param);
    return Promise.all(value.map<Promise<DeepLinkElement>>(q => {
        let paramname = paramNames.get(q.prop) ?? `param_${q.prop}`;
        let paramdata = paramData.get(q.prop);
        let typeid = paramdata?.type?.vartype ?? -1;
        let typename = Object.entries(subtypes).find(([k, v]) => v == typeid)?.[0] ?? "unknown"
        return deepLinkJson(paramname, q.intvalue ?? q.stringvalue, { "x-rsmv-type": typename } as any, source);
    }));
}

async function deepLinkJson(name: string, data: any, meta: JSONSchema6Definition | null | undefined, source: CacheFileSource): Promise<DeepLinkElement> {
    if (typeof meta == "boolean") { meta = null; }
    let rsmvtype = getRSType(meta);
    // strip nullable type from schema
    if (meta?.oneOf) {
        meta = meta.oneOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
    }
    if (meta?.anyOf) {
        meta = meta.anyOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
    }

    if (ArrayBuffer.isView(data)) {
        // we were handed a typed array, which is only possible if our object hasn't been serialized to JSON yet
        // force it into a string to simulate json roundtrip
        data = "" + data;
    }

    if (typeof data == "number") {
        let namegroup = internalNameFiles[rsmvtype];
        let valuename = (namegroup != undefined ? await source.getInternalName(namegroup, data) : undefined);
        return { name, rsmvtype, valuename, primitive: data };
    } else if (typeof data == "string" || typeof data == "boolean" || data == null) {
        return { name, rsmvtype, primitive: data };
    } else if (Array.isArray(data)) {
        if (rsmvtype == "params") {
            return { name, rsmvtype: "params", items: await deepLinkParamtable(data, source) };
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
            subs.push(await deepLinkJson("", data[i], itemmeta, source));
        }
        return { name, rsmvtype, array: subs };
    } else if (typeof data == "object") {
        let subs: DeepLinkElement[] = [];
        for (let key in data) {
            let itemmeta: JSONSchema6Definition | null = null;
            if (meta && meta.properties && meta.properties[key]) {
                itemmeta = meta.properties[key];
            }
            subs.push(await deepLinkJson(key, data[key], itemmeta, source));
        }
        return { name, rsmvtype, items: subs };
    } else {
        throw new Error(`Unsupported data type: ${typeof data}`);
    }
}


function getRSType(meta: JSONSchema6Definition | null | undefined): PropTypes {
    return meta?.["x-rsmv-type"] ?? "unknown";
}

function SpriteView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);
    let imgurl = useAwaited(async () => {
        if (!enginectx) { return; }
        let file = await enginectx.sceneCache.engine.getFileById(cacheMajors.sprites, p.id);
        let img = parseSprite(file);
        return pixelsToDataUrl(img[0].img);
    }, [p.id]);

    return <img src={imgurl ?? undefined} />;
}

function CursorView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);
    let spriteid = useAwaited(async () => {
        if (!enginectx) { return; }
        let arch = await enginectx.source.getArchiveById(cacheMajors.config, cacheConfigPages.cursors);
        let file = arch.find(q => q.fileid == p.id);
        if (!file) { return; }
        let parsed = parse.cursors.read(file.buffer, enginectx.source);
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
    let data = useAwaited(async () => source && deepLinkJson("root", p.data, p.meta, source), [p.data, p.meta, source]);

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

    return (
        <div>
            {data ? handlenode(data, true).el : <span>Loading...</span>}
        </div>
    );
}
