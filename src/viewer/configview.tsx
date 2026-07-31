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

type PropTypes = keyof typeof subtypes | "unknown" | "params";

type DeepLinkElement = {
    rsmvtype: PropTypes,
    name: string,
    valuename?: string | undefined,
    primitive?: string | number | boolean | null,
    children?: DeepLinkElement[]
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

async function deepLinkJson(name: string, data: any, meta: JSONSchema6Definition | null, source: CacheFileSource): Promise<DeepLinkElement> {
    if (typeof meta == "boolean") { meta = null; }
    let rsmvtype = getRSType(meta);
    // strip nullable type from schema
    if (meta?.oneOf) {
        meta = meta.oneOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
    }

    if (typeof data == "number") {
        let namegroup = internalNameFiles[rsmvtype];
        let valuename = (namegroup != undefined ? await source.getInternalName(namegroup, data) : undefined);
        return { name, rsmvtype, valuename, primitive: data };
    } else if (typeof data == "string" || typeof data == "boolean" || data == null) {
        return { name, rsmvtype, primitive: data };
    } else if (Array.isArray(data)) {
        if (rsmvtype == "params") {
            return { name, rsmvtype: "params", children: await deepLinkParamtable(data, source) };
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
        return { name, rsmvtype, children: subs };
    } else if (typeof data == "object") {
        let subs: DeepLinkElement[] = [];
        for (let key in data) {
            let itemmeta: JSONSchema6Definition | null = null;
            if (meta && meta.properties && meta.properties[key]) {
                itemmeta = meta.properties[key];
            }
            let subtype = getRSType(itemmeta);
            if (subtype == "params") {
                subs.push(...await deepLinkParamtable(data[key], source));
                continue;
            }

            subs.push(await deepLinkJson(key, data[key], itemmeta, source));
        }
        return { name, rsmvtype, children: subs };
    } else {
        throw new Error(`Unsupported data type: ${typeof data}`);
    }
}


function getRSType(meta: JSONSchema6Definition | null): PropTypes {
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

export function StructView(p: { data: any, meta: JSONSchema6Definition | null }) {
    let source = React.useContext(UIEngineContext)?.source;
    let data = useAwaited(async () => source && deepLinkJson("root", p.data, p.meta, source), [p.data, p.meta, source]);

    let handlenode = (prop: DeepLinkElement) => {
        if (prop.primitive !== undefined) {
            if (prop.valuename) {
                return <span>{prop.valuename} ({prop.rsmvtype}_{prop.primitive})</span>;
            } else {
                return <span>{prop.primitive} ({prop.rsmvtype})</span>;
            }
        }
        if (prop.children) {
            return <div className="mv-proptable">
                {prop.children.map((q, i) => {
                    if (q.name == "") {
                        return <div key={i} className="mv-proptable__entry">{handlenode(q)}</div>;
                    } else {
                        return (
                            <React.Fragment key={i}>
                                <div className="mv-proptable__name">{q.name}</div>
                                <div className="mv-proptable__value">{handlenode(q)}</div>
                            </React.Fragment>
                        );
                    }
                })}
            </div>;
        }
        return null;
    }

    return (
        <div>
            {data ? handlenode(data) : <span>Loading...</span>}
        </div>
    );
}
