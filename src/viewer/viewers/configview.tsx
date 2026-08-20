import * as React from "react";
import { UIEngineContext, UIRootContext } from "../maincomponents";
import { cacheMajors, internalNameFiles, vartypeReverseMap } from "../../constants";
import { parseSprite } from "../../3d/materials/sprite";
import { pixelsToDataUrl } from "../../imgutils";
import { JSONSchema6Definition } from "json-schema";
import { loadParams } from "../../clientscript/util";
import classNames from "classnames";
import { BlobTS, HSL2RGB, packedHSL2HSL, RGB2HSL, taskTrickler, unpackComponent, unpackCoordgrid } from "../../utils";
import { BlobImage, useAwaited } from "../commoncontrols";
import { parseMusic } from "../../scripts/musictrack";
import { makeFileId } from "../tabs/browse";
import { dbrows } from "../../../generated/dbrows";
import { BrowsableType, IndexGraphLoader, iterateTypedJson, vartypeToDecoder } from "../../scripts/jsonindexer";
import { CacheFileSource } from "../../cache";
import { cacheFileJsonModes } from "../../parser/jsondecoders";
import { cacheFileDecodeModes } from "../../parser/filetypes";

type DeepLinkElement = {
    rsmvtype: BrowsableType,
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

async function deepLinkParamtable(ctx: DeepLinkContext, value: any[]) {
    let paramData = await loadParams(ctx.source);
    let paramNames = await ctx.source.getInternalNameList(internalNameFiles.param);
    return Promise.all(value.map<Promise<DeepLinkElement>>(q => {
        let paramname = paramNames.get(q.prop) ?? `param_${q.prop}`;
        let paramdata = paramData.get(q.prop);
        let typeid = paramdata?.type?.vartype ?? -1;
        let typename = vartypeReverseMap.get(typeid) ?? "unknown"
        return deepLinkJson(ctx, paramname, q.intvalue ?? q.stringvalue, { "x-rsmv-type": typename } as any);
    }));
}


async function deepLinkJson(ctx: DeepLinkContext, nameorindex: string | number, data: any, meta: JSONSchema6Definition | null | undefined): Promise<DeepLinkElement> {
    let name = typeof nameorindex == "number" ? "" : nameorindex;
    ctx.objstack.push(data);
    try {
        // === find expected type ===
        let rsmvtype: BrowsableType;
        ({ rsmvtype, data, meta } = iterateTypedJson(ctx.objstack, meta, data, nameorindex));

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
                valuename = vartypeReverseMap.get(data);
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
            if (rsmvtype == "dbtable_definition") {
                // give dbtables access to its own id so it can fetch matching dbrows
                subs.push({ name: "dbid", rsmvtype: "", primitive: data.$fileid })
            }
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

// prevent sending out 1000+ async requests at once
let resourceloadlimit = taskTrickler(20);

function SpriteView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);
    let imgurl = useAwaited(abort => {
        if (!enginectx) { return; }
        return resourceloadlimit(async () => {
            if (abort.aborted) { return; }
            let file = await enginectx.source.getFileById(cacheMajors.sprites, p.id);
            let img = parseSprite(file);
            return pixelsToDataUrl(img[0].img);
        });
    }, [p.id], 200);

    return <img src={imgurl ?? undefined} />;
}

function TextureView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);
    let imgurl = useAwaited(abort => {
        if (!enginectx) { return; }
        return resourceloadlimit(async () => {
            if (abort.aborted) { return; }
            let file = await enginectx.sceneCache.getTextureFile("diffuse", p.id, false);
            return pixelsToDataUrl(await file.toImageData());
        })
    }, [p.id], 200);

    return <img src={imgurl ?? undefined} />;
}

function CursorView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);
    let spriteid = useAwaited(abort => {
        if (!enginectx) { return; }
        return resourceloadlimit(async () => {
            if (abort.aborted) { return; }
            let parsed = await enginectx.source.getObject("cursors", p.id);
            return parsed.cursor;
        });
    }, [p.id, enginectx], 200);
    return <SpriteView id={spriteid ?? 0} />;
}

function SoundView(p: { id: number }) {
    let enginectx = React.useContext(UIEngineContext);

    let soundblob = useAwaited(abort => {
        if (!enginectx) { return; }
        return resourceloadlimit(async () => {
            if (abort.aborted) { return; }
            let sound = await parseMusic(enginectx.source, cacheMajors.sounds, p.id, null, true);
            return URL.createObjectURL(new BlobTS([sound], { type: "audio/ogg" }));
        });
    }, [p.id, enginectx], 200);

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

function getDBTableStructure(data: DeepLinkElement) {

    type DBTableSub = {
        tableid: number,
        columnstart: number,
        columncount: number,
        cols: {
            default: any,
            type: DeepLinkElement
        }[]
    }

    let tableid = data.items?.find(q => q.name == "dbid")?.primitive;
    let subtables = data.items?.find(q => q.name == "columndata");
    if (!subtables?.array || typeof tableid != "number") { return null; }

    let outtables: DBTableSub[] = [];
    let columncounter = 0;
    for (let subtable of subtables.array) {
        let id = subtable.items?.find(q => q.name == "id");
        let flags = subtable.items?.find(q => q.name == "flags");
        let unkbyte = subtable.items?.find(q => q.name == "unkbyte");
        let columns = subtable.items?.find(q => q.name == "columns");
        let columncount = columns?.array?.length;
        if (typeof id?.primitive != "number" || columncount == undefined) {
            continue;
        }
        let outtable: DBTableSub = {
            cols: [],
            tableid: id.primitive,
            columnstart: columncounter,
            columncount: columncount
        }
        outtables.push(outtable);
        for (let column of columns?.array ?? []) {
            let type = column.items?.find(q => q.name == "type");
            let defaultvalue = column.items?.find(q => q.name == "type");

            outtable.cols.push({
                default: defaultvalue?.primitive,
                type: type!
            })
        }
        columncounter += columncount;
    }
    return {
        tableid,
        outtables
    }
}

function DBTablesView(p: { data: DeepLinkElement }) {
    let data = p.data;
    let [maxdbrows, setmaxdbrows] = React.useState(100);
    let ctx = React.useContext(UIEngineContext);

    let structure = React.useMemo(() => getDBTableStructure(data), [data]);

    let dbrows = useAwaited(async () => {
        if (maxdbrows == 0 || !ctx || !structure) { return []; }
        let rowcache: dbrows[] = await ctx.sceneCache.engine.getJsonSearchData("dbrows").files;
        return Promise.all(rowcache.filter(q => q.table == structure.tableid).map(async q => {
            let res: DeepLinkElement[][][] = [];
            let linkctx = new DeepLinkContext(ctx.sceneCache.engine);
            for (let subtable of structure.outtables) {
                let tabledata: DeepLinkElement[][] = [];
                let subtabledata = q.rows?.columndata.find(q => q.columnid == subtable?.tableid);
                for (let row of subtabledata?.rows ?? []) {
                    if (row.length != subtable.cols.length) {
                        console.log("skipped row because of subcolumn count mismatch", row, subtable.cols);
                        continue;
                    }
                    let rowdata: DeepLinkElement[] = [];
                    for (let i = 0; i < row.length; i++) {
                        let rsmvtype = vartypeReverseMap.get(subtable.cols[i].type.primitive as number);
                        rowdata.push(await deepLinkJson(linkctx, i, row[i], { ["x-rsmv-type" as any]: rsmvtype }))
                    }
                    tabledata.push(rowdata);
                }
                res.push(tabledata);
            }
            return res;
        }));
    }, [maxdbrows, ctx, structure])


    if (!structure) {
        return <span>Empty</span>;
    }


    let titlehead: JSX.Element[] = [];
    let head: JSX.Element[] = [];

    for (let [itable, table] of structure.outtables.entries()) {
        let gridColumn = `${table.columnstart + 1} / span ${table.columncount}`;
        titlehead.push(<div key={itable} className="mv-dbtitle" style={{ gridColumn }}>{itable}</div>);
        let subhead: JSX.Element[] = [];
        for (let [icolumn, column] of table.cols.entries()) {
            subhead.push(<div key={icolumn}>{renderPrimitive(column.type)?.el}</div>);
        }
        head.push(<div key={itable} className="mv-dbsubgrid" style={{ gridColumn }}>{subhead}</div>);
    }

    let rowdata: JSX.Element[] = [];
    if (dbrows) {
        let visiblerows = dbrows.slice(0, maxdbrows);
        for (let [dbrowindex, dbrow] of visiblerows.entries()) {
            for (let [itable, table] of structure.outtables.entries()) {
                let gridColumn = `${table.columnstart + 1} / span ${table.columncount}`;
                let subrows = dbrow[itable];
                let rowjsx: JSX.Element[] = [];
                for (let [irow, row] of subrows.entries()) {
                    for (let [icolumn, column] of table.cols.entries()) {
                        rowjsx.push(<React.Fragment key={`${irow}-${icolumn}`}>
                            {renderPrimitive(row[icolumn])?.el!}
                        </React.Fragment>);
                    }
                }
                rowdata.push(<div key={`${dbrowindex}-${itable}`} className="mv-dbsubgrid" style={{ gridColumn }}> {rowjsx}</div >);
            }
        }
    }

    return <>
        <div>
            <div className="mv-dbgrid">
                {titlehead}
                {head}
                {rowdata}
            </div>
        </div>
        {!dbrows && <span>Loading...</span>}
        {maxdbrows == 0 && <button className="sub-btn" onClick={e => setmaxdbrows(100)}>Load row data</button>}
        {maxdbrows != 0 && dbrows && dbrows.length >= maxdbrows && <button className="sub-btn" onClick={e => setmaxdbrows(maxdbrows * 2)}  >Show more ({maxdbrows}/{dbrows.length})</button>}
    </>
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
        let { intf, sub } = unpackComponent(p.prop.primitive);
        index = [intf, sub];
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
            return { isbig: false, el: <div><ObjectLink prop={prop} /><br /><SpriteView id={prop.primitive} /></div> };
        }
        if (prop.rsmvtype == "texture") {
            return { isbig: false, el: <div><ObjectLink prop={prop} /><br /><TextureView id={prop.primitive} /></div> };
        }
        if (prop.rsmvtype == "cursor") {
            return { isbig: false, el: <div><ObjectLink prop={prop} /><br /><CursorView id={prop.primitive} /></div> };
        }
        if (prop.rsmvtype == "sound") {
            return { isbig: false, el: <div><ObjectLink prop={prop} /><br /><SoundView id={prop.primitive} /></div> };
        }
        if (prop.rsmvtype == "boolean") {
            return { isbig: false, el: <span>{prop.primitive ? "true" : "false"}</span> };
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
        if (prop.rsmvtype == "dbtable_definition") {
            return { isbig: true, el: <DBTablesView data={prop} /> };
        }
    }
    return null;
}

export function StructView(p: { data: any, meta: JSONSchema6Definition | null | undefined }) {
    let [maxarraylen, setmaxarraylen] = React.useState(1000);
    let source = React.useContext(UIEngineContext)?.source;
    let data = useAwaited(async () => {
        return source && deepLinkJson(new DeepLinkContext(source), "root", p.data, p.meta);
    }, [p.data, p.meta, source], 200);

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
    let fileidstring = (p.data?.$fileid != undefined ? (Array.isArray(p.data.$fileid) ? p.data.$fileid.join(".") : p.data.$fileid) : "");
    let filename = p.data?.$filename ?? "";

    return (
        <div style={{ userSelect: "text" }}>
            <h3>{decoder}_{fileidstring} - {filename}</h3>
            {data ? handlenode(data, true).el : <span>Loading...</span>}
            <h3>Referenced By</h3>
            <ReferencesView jsonmode={p.data?.$decoder ?? "unknown"} id={p.data?.$fileid} />
        </div>
    );
}

export function ReferencesView(p: { jsonmode: string, id: unknown }) {
    let ctx = React.useContext(UIRootContext);

    let refs = useAwaited(async () => {
        if (!ctx.source) { return null; }
        let id = p.id;
        if (typeof id == "number") { id = [id]; }
        if (!Array.isArray(id)) { return null; }
        let graph = await IndexGraphLoader.forCache(ctx.source).load(ctx.source);
        let res = await graph.findReferences(p.jsonmode as keyof typeof cacheFileJsonModes, id);
        return Promise.all(res.map(async q => {
            let decoder = cacheFileDecodeModes[q.srcmode as keyof typeof cacheFileDecodeModes];
            let namefile = decoder?.({}).internalNamefile;
            let name = (namefile == undefined ? "" : await ctx.source!.getInternalName(namefile, q.srclogical[0]));
            return {
                srcobject: q.srcobject,
                propname: q.propname,
                name: name ?? ""
            }
        }));
    }, [ctx.source, p.jsonmode, p.id]);

    let onclick = (e: React.MouseEvent<HTMLSpanElement>) => {
        e.preventDefault();
        ctx.openFile({ type: "browse", id: e.currentTarget.dataset.fileid! });
    }

    return <div className="mv-proplist">
        {refs && refs.map(q => <React.Fragment key={q.srcobject}>
            <div className="mv-proplist__value">
                <span className="mv-filelink" data-fileid={q.srcobject} onClick={onclick}>{q.srcobject}</span>
                {q.name && ` (${q.name})`}
            </div>
            <div className="mv-proplist__name">{q.propname}</div>
        </React.Fragment>)}
        {!refs && <span>Loading...</span>}
    </div>
}