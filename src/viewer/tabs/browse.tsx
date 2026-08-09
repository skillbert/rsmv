import React, { useContext } from "react";
import { checkObject, stringToFileRange } from "../../utils";
import { LookupModeProps } from "../scenenodes";
import { cacheFileJsonModes } from "../../parser/jsondecoders";
import { TabStrip, useAwaited, useEmitterProperty } from "../commoncontrols";
import { BrowseModes, BrowsePageId, UIEngineContext, UIRootContext } from "../maincomponents";
import { jsonCacheSearch, JsonSearchFilter } from "../jsonsearch";
import { FileListView } from "../scriptsui";
import { JsonViewer } from "../viewers/fileviewer";
import { vartypeToDecoder } from "../viewers/configview";

const modeOverrides: Partial<Record<keyof typeof cacheFileJsonModes, { jsonNameProperty?: string }>> = {
    items: { jsonNameProperty: "name" },
    npcs: { jsonNameProperty: "name" },
    locs: { jsonNameProperty: "name" },
    quests: { jsonNameProperty: "name" },
}

const modeNames: Partial<Record<BrowseModes, string>> = {
    ...Object.fromEntries(Object.keys(cacheFileJsonModes).map(k => [k, k]))
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
    if (!cacheFileJsonModes[mode as BrowseModes]) { return null; }
    if (index.length == 0) { return null; }
    return { mode: mode as BrowseModes, index };
}

const searchModes = {
    id: "ID",
    internalname: "Internal Name",
    objectname: "Object Name",
}

function AdvancedIdInputSearch(p: { modename: BrowseModes, initialValue: string, onSearch: (search: string) => void, onFileSelect: (id: string) => void }) {
    let mode = cacheFileJsonModes[p.modename] ?? null;
    let overrides = modeOverrides[p.modename] ?? {};
    let ctx = useContext(UIRootContext);
    let engine = useContext(UIEngineContext)?.sceneCache.engine;

    let activetab = useEmitterProperty(ctx, "showTab", e => e.openedTabs[e.activeTabIndex]);
    let selectedfile = (activetab?.type == "browse" ? activetab.id : null);

    let [searchtext, setSearchText] = React.useState(p.initialValue);
    let [searchmode, setSearchmode] = React.useState<keyof typeof searchModes>("id");

    let canjsonsearch = overrides.jsonNameProperty != undefined;
    let caninternalnamesearch = mode.lookup.internalNamefile != undefined;
    if (!canjsonsearch && searchmode == "objectname") { setSearchmode("id"); }
    if (!caninternalnamesearch && searchmode == "internalname") { setSearchmode("id"); }

    let searcher = useAwaited(async () => {
        if (searchmode == "id") {
            if (!engine) { return null; }
            return async (searchtext: string) => {
                let ranges = stringToFileRange(searchtext);
                let allfiles = (await Promise.all(ranges.map(q => mode.lookup.logicalRangeToFiles(engine, q.start, q.end))))
                    .flat()
                    .sort((a, b) => a.index.major != b.index.major ? a.index.major - b.index.major : a.index.minor != b.index.minor ? a.index.minor - b.index.minor : a.subindex - b.subindex);

                let matches = new Map<string, string>();
                for (let file of allfiles) {
                    let filename = makeFileId(p.modename, mode.lookup.fileToLogical(engine, file.index.major, file.index.minor, file.subindex));
                    matches.set(filename, filename);
                }
                return matches;
            }
        }
        if (searchmode == "internalname") {
            if (!engine || mode.lookup.internalNamefile == null) { return null; }
            let internalnames = await engine.getInternalNameList(mode.lookup.internalNamefile);
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
            let jsonsearch = await jsonCacheSearch(engine, p.modename);
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
            <form className="mv-searchbar" >
                <input type="text" className="mv-searchbar-input" spellCheck="false" value={searchtext} onChange={e => setSearchText(e.currentTarget.value)} />
                <input type="button" style={{ width: "25px", height: "25px" }} value="" className="sub-btn sub-btn-search" />
            </form>
            <TabStrip tabs={searchModes} value={searchmode} onChange={setSearchmode} />

            <div className="mv-sidebar-scroll">
                {searchmode == "id" && !searchresult && <div>Loading ids...</div>}
                {searchmode == "internalname" && !searchresult && <div>Loading internal names...</div>}
                {searchmode == "objectname" && !searchresult && <div>Loading object names...</div>}
                {searchresult && <FileListView files={searchresult} selected={selectedfile} onSelect={p.onFileSelect} />}
            </div>
        </React.Fragment>
    );
}

export function BrowseUI(p: LookupModeProps) {
    let [id, setId] = React.useState<{ mode: string, search: string } | null>(checkObject(p.initialId, { mode: "string", search: "string" }) ?? null);
    let ctx = useContext(UIRootContext);

    let onFileSelect = React.useCallback((fileid: string) => {
        ctx.openFile({ type: "browse", id: fileid });
    }, [ctx]);

    let onSearch = (search: string) => {
        setId({ mode: id?.mode ?? "", search });
    };

    return <>
        {!id?.mode && <TabStrip tabs={modeNames} value={id?.mode ?? null as any} onChange={mode => setId({ mode, search: "" })} />}
        {id?.mode && <div style={{ marginTop: "0.5em" }}>Searching in {id.mode} <input type="button" className="sub-btn" onClick={() => setId(null)} value="Back" /></div>}
        {id?.mode && <AdvancedIdInputSearch key={id.mode} modename={id.mode as any} initialValue={id.search} onSearch={onSearch} onFileSelect={onFileSelect} />}
    </>
}

export function BrowseDisplay(p: { browse: BrowsePageId }) {
    let ctx = useContext(UIRootContext);
    let engine = useContext(UIEngineContext)?.sceneCache.engine;
    let index = fileIdToIndex(p.browse.id);


    let data = useAwaited(() => {
        let overrides = index && modeOverrides[index.mode];
        let modefn = index && cacheFileJsonModes[index.mode];
        if (!engine || !modefn || !index) { return null; }
        return engine.getObject(index.mode, index.index);
    }, [index?.mode, index?.index.join("_"), engine]);

    return <JsonViewer json={data} jsonmode={index?.mode ?? ""} />
}