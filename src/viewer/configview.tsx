import * as React from "react";
import { UIEngineContext } from "./maincomponents";
import { cacheMajors, internalNameFiles } from "../constants";
import { parseSprite } from "../3d/materials/sprite";
import { pixelsToDataUrl } from "../imgutils";
import { JSONSchema6, JSONSchema6Definition } from "json-schema";
import { useAwaited } from "./scriptsui";
import { loadParams } from "../clientscript/util";
import { CacheFileSource } from "../cache";
import { subtypes } from "../clientscript/definitions";


function getRSType(meta: JSONSchema6 | null) {
    return meta?.["x-rsmv-type"] ?? "unknown";
}

function StringView(p: { value: string, meta: JSONSchema6 | null }) {
    return <span>{p.value} ({getRSType(p.meta)})</span>;
}

function NumberView(p: { value: number, meta: JSONSchema6 | null }) {
    return <span>{p.value} ({getRSType(p.meta)})</span>;
}

function BooleanView(p: { value: boolean, meta: JSONSchema6 | null }) {
    return <span>{p.value ? "true" : "false"} ({getRSType(p.meta)})</span>;
}

async function paramsToJson(params: { prop: number, intvalue: number | null, stringvalue: string | null }[], source: CacheFileSource) {

}


function ParamView(p: { value: { prop: number, intvalue: number | null, stringvalue: string | null }[], meta: JSONSchema6 | null }) {
    let ctx = React.useContext(UIEngineContext);
    let paramtable = useAwaited(async () => {
        if (!ctx) { return; }
        let paramData = await loadParams(ctx.source);
        let paramNames = await ctx.source.getInternalNameList(internalNameFiles.param);
        return p.value.map(q => {
            let paramname = paramNames.get(q.prop) ?? `param_${q.prop}`;
            let paramdata = paramData.get(q.prop);
            let typeid = paramdata?.type?.vartype ?? -1;
            return {
                name: paramname,
                type: typeid,
                typename: Object.entries(subtypes).find(([k, v]) => v == typeid)?.[0] ?? "unknown",
                value: q.intvalue ?? q.stringvalue
            }
        });
    }, [ctx, p.value]);

    return (
        <table>
            <tbody>
                {paramtable?.map((q, i) => <tr key={i}>
                    <td><strong>{q.name}</strong></td>
                    <td><StructView data={q.value} meta={{ "x-rsmv-type": q.typename } as any} /></td>
                </tr>)}
            </tbody>
        </table>
    );
}

export function StructView(p: { data: any, meta: JSONSchema6Definition | null }) {
    let data = p.data;
    let meta = p.meta;

    if (typeof meta == "boolean") { meta = null; }
    let rsmvtype = getRSType(meta);
    // strip nullable type from schema
    if (meta?.oneOf) {
        meta = meta.oneOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
    }

    if (typeof data == "string") {
        return <StringView value={data} meta={meta} />;
    }
    if (typeof data == "number") {
        return <NumberView value={data} meta={meta} />;
    }
    if (typeof data == "boolean") {
        return <BooleanView value={data} meta={meta} />;
    }
    if (typeof data == "undefined" || data == null) {
        return <span>null</span>;
    }
    if (Array.isArray(data)) {
        if (rsmvtype == "params") {
            return <ParamView value={data} meta={meta} />;
        }
        let subs: JSX.Element[] = [];
        for (let i = 0; i < data.length; i++) {
            let itemmeta: JSONSchema6Definition | null = null;
            if (meta && meta.items) {
                if (Array.isArray(meta.items)) {
                    itemmeta = meta.items[i];
                } else {
                    itemmeta = meta.items;
                }
            }
            subs.push(<StructView key={i} data={data[i]} meta={itemmeta} />);
        }
        return <span>{subs}</span>;
    }
    if (typeof data == "object") {
        let subs: JSX.Element[] = [];
        for (let key in data) {
            let itemmeta: JSONSchema6Definition | null = null;
            if (meta && meta.properties && meta.properties[key]) {
                itemmeta = meta.properties[key];
            }
            subs.push(
                <tr key={key}>
                    <td><strong>{key}</strong></td>
                    <td><StructView data={data[key]} meta={itemmeta} /></td>
                </tr>
            );
        }
        return <table>
            <tbody>
                {subs}
            </tbody>
        </table>;
    }
}

export function SpriteView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);
    let imgurl = useAwaited(async () => {
        if (!enginectx) { return; }
        let file = await enginectx.sceneCache.engine.getFileById(cacheMajors.sprites, p.id);
        let img = parseSprite(file);
        return pixelsToDataUrl(img[0].img);
    }, [p.id]);

    return <img src={imgurl ?? undefined} />;
}