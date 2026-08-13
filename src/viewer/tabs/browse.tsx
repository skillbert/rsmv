import React, { useContext } from "react";
import { checkObject, stringToFileRange } from "../../utils";
import { LookupModeProps } from "../scenenodes";
import { cacheFileJsonModes } from "../../parser/jsondecoders";
import { DomWrap, TabStrip, TextureView, useAwaited, useEmitterProperty } from "../commoncontrols";
import { BrowsePageId, UIEngineContext, UIRootContext } from "../maincomponents";
import { jsonCacheSearch, JsonSearchFilter } from "../jsonsearch";
import { FileListView } from "../scriptsui";
import { JsonViewer } from "../viewers/fileviewer";
import { vartypeToDecoder } from "../viewers/configview";
import { prepareClientScript, renderClientScript } from "../../clientscript";
import { cacheMajors } from "../../constants";
import { parseSprite } from "../../3d/materials/sprite";
import { RsUIViewer } from "../viewers/rsuiviewer";
import { cacheFileDecodeModes } from "../../parser/filetypes";

export type BrowseModes = keyof typeof cacheFileJsonModes | "clientscript" | "interfaceviewer" | "sprites";

const modeOverrides: Partial<Record<BrowseModes, { jsonNameProperty?: string }>> = {
    items: { jsonNameProperty: "name" },
    npcs: { jsonNameProperty: "name" },
    locs: { jsonNameProperty: "name" },
    quests: { jsonNameProperty: "name" },
    achievements: { jsonNameProperty: "name" },
}

export function makeFileId(mode: string, index: number[]) {
    return `${mode}_${index.join("_")}`;
}

export function fileIdToIndex(fileid: string) {
    let parts = fileid.split("_");
    let mode = "";
    let index: number[] = [];
    for (let i = 0; i < parts.length; i++) {
        let intvalue = parseInt(parts[i]);
        if (isNaN(intvalue)) {
            mode += (mode.length != 0 ? "_" : "") + parts[i];
        } else {
            index.push(intvalue);
        }
    }
    if (mode in vartypeToDecoder) { mode = vartypeToDecoder[mode]; }
    if (!cacheFileDecodeModes[mode as BrowseModes]) { return null; }
    if (index.length == 0) { return null; }
    return { mode: mode as BrowseModes, index };
}


function AdvancedIdInputSearch(p: { modename: BrowseModes, initialValue: string, initialMode: string, onSearch: (search: string, searchmode: string) => void, onFileSelect: (id: string) => void }) {
    let mode = cacheFileDecodeModes[p.modename]?.({}) ?? null;
    let overrides = modeOverrides[p.modename] ?? {};
    let ctx = useContext(UIRootContext);
    let engine = useContext(UIEngineContext)?.sceneCache.engine;

    let activetab = useEmitterProperty(ctx, "showTab", e => e.openedTabs[e.activeTabIndex]);
    let selectedfile = (activetab?.type == "browse" ? activetab.id : null);

    let [searchtext, setSearchText] = React.useState(p.initialValue);
    let [searchmode, setSearchmode] = React.useState(p.initialMode);

    let canjsonsearch = overrides.jsonNameProperty != undefined;
    let caninternalnamesearch = mode.internalNamefile != undefined;
    const searchModes: Record<string, string> = { id: "ID" };
    if (canjsonsearch) { searchModes.objectname = "Object Name"; }
    if (caninternalnamesearch) { searchModes.internalname = "Internal Name"; }
    if (!searchModes[searchmode]) { searchmode = "id"; }

    let searcher = useAwaited(async () => {
        if (searchmode == "id") {
            if (!engine) { return null; }
            return async (searchtext: string) => {
                let ranges = stringToFileRange(searchtext);
                let allfiles = (await Promise.all(ranges.map(q => mode.logicalRangeToFiles(engine, q.start, q.end))))
                    .flat()
                    .sort((a, b) => a.index.major != b.index.major ? a.index.major - b.index.major : a.index.minor != b.index.minor ? a.index.minor - b.index.minor : a.subindex - b.subindex);

                let matches = new Map<string, string>();
                for (let file of allfiles) {
                    let subid = file.index.subindices[file.subindex];
                    let filename = makeFileId(p.modename, mode.fileToLogical(engine, file.index.major, file.index.minor, subid));
                    matches.set(filename, filename);
                }
                return matches;
            }
        }
        if (searchmode == "internalname") {
            if (!engine || mode.internalNamefile == null) { return null; }
            let internalnames = await engine.getInternalNameList(mode.internalNamefile);
            return (searchtext: string) => {
                let matches = new Map<string, string>();
                let searchterm = searchtext.toLowerCase().replace(/ /g, "_");
                for (let [id, name] of internalnames) {
                    if (name.toLowerCase().includes(searchterm)) {
                        let filename = makeFileId(p.modename, [id])
                        matches.set(filename, name || filename);
                    }
                }
                return matches;
            }
        }
        if (searchmode == "objectname") {
            if (!engine || !overrides.jsonNameProperty) { return null; }
            if (!(p.modename in cacheFileJsonModes)) { return null; }
            let jsonsearch = await jsonCacheSearch(engine, p.modename as any);
            return (searchtext: string) => {
                let jsonsearchfilter: JsonSearchFilter[] = [{ path: [overrides.jsonNameProperty!], search: searchtext }];
                let matches = new Map<string, string>();
                let searchresult = jsonsearch.run(jsonsearchfilter);
                for (let result of searchresult) {
                    matches.set(makeFileId(p.modename, [result.$fileid]), result[overrides.jsonNameProperty!]);
                }
                return matches;
            }
        }
        return null;
    }, [searchmode, engine]);


    let searchresult = useAwaited(() => searcher?.(searchtext), [searchtext, searcher]);

    return (
        <React.Fragment>
            <form className="mv-searchbar" onSubmit={e => { e.preventDefault(); p.onSearch(searchtext, searchmode); }} >
                <input type="text" className="mv-searchbar-input" spellCheck="false" value={searchtext} onChange={e => setSearchText(e.currentTarget.value)} />
                <input type="button" style={{ width: "25px", height: "25px" }} value="" className="sub-btn sub-btn-search" />
            </form>
            <TabStrip tabs={searchModes} value={searchmode} onChange={setSearchmode} />

            <div className="mv-sidebar-scroll">
                {searchmode == "id" && !searchresult && <div>Loading ids...</div>}
                {searchmode == "internalname" && !searchresult && <div>Loading internal names...</div>}
                {searchmode == "objectname" && !searchresult && <div>Loading object names...</div>}
                {searchresult && <FileListView files={searchresult} selected={selectedfile} onSelect={v => { p.onFileSelect(v); p.onSearch(searchtext, searchmode); }} />}
            </div>
        </React.Fragment>
    );
}

function BrowseModeSelect(p: { mode?: string, onSelect: (mode: BrowseModes) => void }) {

    let visited: string[] = [];

    let subgroup = (groupname: string, tabids: BrowseModes[]) => {
        let tabs: Record<string, string> = {};
        for (let tabid of tabids) {
            if (visited.includes(tabid)) { continue; }
            visited.push(tabid);
            tabs[tabid] = tabid;
        }
        return <>
            <div className="mv-tab-strip-header">{groupname}</div>
            <TabStrip key={groupname} tabs={tabs} value={p.mode as any} columns={3} compact onChange={mode => p.onSelect(mode as BrowseModes)} />
        </>
    }

    return <div className="mv-sidebar-scroll">
        {subgroup("Game", ["items", "npcs", "locs", "spotanims", "inventories"])}
        {subgroup("Data", ["clientscript", "dbrows", "dbtables", "enums", "structs", "params", "achievements", "quests"])}
        {subgroup("UI", ["interfaceviewer", "sprites", "cursors", "fontmetrics", "stylesheets", "quickchatcats", "quickchatlines"])}
        {subgroup("Map", ["mapscenes", "maplabels", "mapzones", "mappastes", "maplabellocations"])}
        {subgroup("Rendering", ["underlays", "overlays", "skyboxes", "identitykit", "animgroupconfigs"])}
        {subgroup("Other", Object.keys(cacheFileJsonModes) as any)}
    </div>
}

export function BrowseUI(p: LookupModeProps) {
    let [id, setId] = React.useState<{ mode: string, search: string, searchmode: string } | null>(checkObject(p.initialId, { mode: "string", search: "string", searchmode: "string" }) ?? null);
    let ctx = useContext(UIRootContext);

    let onFileSelect = React.useCallback((fileid: string) => {
        ctx.openFile({ type: "browse", id: fileid });
    }, [ctx]);

    let onSearch = (search: string, searchmode: string) => {
        let newid = { mode: id?.mode ?? "", search, searchmode: searchmode };
        setId(newid);
        localStorage.rsmv_lastsearch = JSON.stringify(newid);
    };

    return <>
        {!id?.mode && <BrowseModeSelect mode={id?.mode} onSelect={mode => setId({ mode, search: "", searchmode: "id" })} />}
        {id?.mode && <div style={{ marginTop: "0.5em" }}>Searching in {id.mode} <input type="button" className="sub-btn" onClick={() => setId(null)} value="Back" /></div>}
        {id?.mode && <AdvancedIdInputSearch key={id.mode} modename={id.mode as any} initialValue={id.search} initialMode={id.searchmode} onSearch={onSearch} onFileSelect={onFileSelect} />}
    </>
}

export function BrowseDisplay(p: { browse: BrowsePageId }) {
    let ctx = useContext(UIRootContext);
    let engine = useContext(UIEngineContext)?.sceneCache.engine;
    let index = fileIdToIndex(p.browse.id);


    let data = useAwaited(() => {
        if (!engine || !index) { return null; }
        let overrides = index && modeOverrides[index.mode];

        return (async () => {
            if (index.mode == "clientscript") {
                let buf = await engine.getFileById(cacheMajors.clientscript, index.index[0]);
                let { writer, rootfunc } = await renderClientScript(engine, buf, index.index[0], false, false, false);
                let clicker = (objectid: string) => ctx.openFile({ type: "browse", id: objectid });
                let dom = writer.getCodeDom(rootfunc, clicker);
                globalThis.cs2 = rootfunc;
                return { viewer: "dom", mode: index.mode, dom } as const;
            }
            if (index.mode == "sprites") {
                let file = await engine.getFileById(cacheMajors.sprites, index.index[0]);
                let sprite = parseSprite(file);
                return { viewer: "sprite", mode: index.mode, sprite } as const;
            }
            if (index.mode == "interfaceviewer") {
                return { viewer: "interfaces", mode: index.mode, interfaceid: index.index[0] } as const;
            }

            let jsonfn = cacheFileJsonModes[index.mode];
            if (!jsonfn) { return null; }
            let obj = await engine.getObject(index.mode, index.index);
            return {
                viewer: "json",
                mode: index.mode,
                file: JSON.stringify(obj),
            } as const;
        })()
    }, [index?.mode, index?.index.join("_"), engine]);

    if (!data) { return <div>Loading...</div>; }
    if (data.viewer == "json") {
        return <JsonViewer data={data?.file} jsonmode={data?.mode ?? ""} />
    } else if (data.viewer == "dom") {
        return <DomWrap el={data.dom} />
    } else if (data.viewer == "sprite") {
        return <TextureView img={data.sprite[0].img} fillHeight />
    } else if (data.viewer == "interfaces") {
        return <RsUIViewer interfaceid={data.interfaceid} />
    }
}