import React from "react";
import { UIRootContext } from "../maincomponents";
import { GraphIndexStateView } from "./browse";
import { TabStrip, useAwaited, useEmitterProperty } from "../commoncontrols";
import { IndexGraphLoader } from "../../scripts/jsonindexer";
import { FileListView } from "../scriptsui";

export function GraphSearchView(p: {}) {
    let [search, setSearch] = React.useState("");
    let [searchmode, setSearchMode] = React.useState<keyof typeof searchmodes>("substring");
    let [searchresult, setSearchResult] = React.useState<Map<string, string> | null>(null);
    let ctx = React.useContext(UIRootContext);
    let graph = useAwaited(() => ctx.source && IndexGraphLoader.forCache(ctx.source).load(ctx.source), [ctx.source]);

    let beginsearch = React.useMemo(() => {
        let processing: Promise<unknown> | null = null;
        let queued = "";
        let lastsearch = "";
        let runsearch = async (search: string) => {
            if (!graph || !search) { return null; }
            let sqlsearch = searchmode == "full" ? search : searchmode == "prefix" ? `${search}%` : `%${search}%`;
            let res = await graph.findStrings(sqlsearch);
            return new Map(res.map(q => [q.srcobject, `${q.srcobject} - ${q.value}`]));
        }
        let process = async (search: string) => {
            processing = runsearch(search).then(async res => {
                processing = null;
                if (queued) {
                    let q = queued;
                    queued = "";
                    process(q);
                }
                setSearchResult(res);
            });
        }
        let settext = (t: string) => {
            if(t == lastsearch) { return; }
            lastsearch = t;
            if (processing) {
                queued = t;
            } else {
                process(t);
            }
        }
        return settext;
    }, [graph, searchmode]);
    beginsearch(search);

    let searchmodes = {
        substring: "Substring",
        full: "Full",
        prefix: "Prefix",
    };

    let onSearch = (objid: string) => {
        ctx.openFile({ type: "browse", id: objid });
    };

    let activetab = useEmitterProperty(ctx, "showTab", e => e.openedTabs[e.activeTabIndex]);
    let selectedfile = (activetab?.type == "browse" ? activetab.id : null);

    return <>
        <h2>Graph Search View</h2>
        <GraphIndexStateView />
        <TabStrip tabs={searchmodes} value={searchmode} onChange={setSearchMode} compact />
        <input className="mv-searchbar-search" type="text" value={search} onChange={e => setSearch(e.currentTarget.value)} />
        <div className="mv-sidebar-scroll">
            {searchresult && <FileListView files={searchresult} selected={selectedfile} onSelect={onSearch} />}
        </div>
    </>;
}