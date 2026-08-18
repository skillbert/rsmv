import { CacheFileSource } from "./cache";
import { unpackCoordgrid } from "./utils";
import { cliApi, CliApiContext } from "./clicommands";
import * as cmdts from "cmd-ts";
import { cacheConfigPages, internalNameFiles, cacheMajors, vartypes } from "./constants";
import { dumpTexture } from "./imgutils";
import { CLIScriptOutput } from "./scriptrunner";
import { cacheFilenameHash, HSL2RGB, packedHSL2HSL } from "./utils";
import prettyJson from "json-stringify-pretty-compact";
import { UIScriptFS } from "./viewer/scriptsui";
import { EngineCache } from "./3d/modeltothree";
import { cacheFileDecodeModes } from "./parser/filetypes";
import { UIContext } from "./viewer/maincomponents";
import * as datastore from "idb-keyval";

// exposes various tools into the global scope to use in the console for debugging and testing
export function exposeDebugToolsInGlobal() {
    globalThis.cacheMajors = cacheMajors;
    globalThis.cacheConfigPages = cacheConfigPages;
    globalThis.internalNameFiles = internalNameFiles;
    globalThis.vartypes = vartypes;
    globalThis.dumpjson = dumpjson;
    globalThis.bin = bin;
    globalThis.datastore = datastore;
    globalThis.binarr = binarr;
    globalThis.findnames = findnames;
    globalThis.allnames = allnames;
    globalThis.dumptex = dumpTexture;
    globalThis.cacheFilenameHash = cacheFilenameHash;
    globalThis.hsl = (v: number) => HSL2RGB(packedHSL2HSL(v));
    globalThis.coordgrid = coordgrid;
    globalThis.prettyjson = prettyJson;
    globalThis.cli = cli;
    globalThis.getFileCounts = getFileCounts;
    globalThis.getKnownCounts = getKnownCounts;
    globalThis.getNameCounts = getNameCounts;
    globalThis.getConfigCounts = getConfigCounts;
    globalThis.getlasttimestamp = getlasttimestamp;
    globalThis.browse = browse;
}

function coordgrid(coord: number) {
    let { level, x, z } = unpackCoordgrid(coord);
    return `${level}_${x}_${z}`;
}

async function cli(args: string) {
    let source = globalThis.source as CacheFileSource;
    let cliconsole = new CLIScriptOutput();
    let outputs: Record<string, any> = {};

    let clictx: CliApiContext = {
        getConsole() { return cliconsole; },
        getFs(name: string) { return outputs[name] ??= new UIScriptFS(null); },
        getDefaultCache() { return source; }
    }
    let api = cliApi(clictx);
    let res = await cmdts.runSafely(api.subcommands, args.split(/\s+/g));
    if (cliconsole.state == "running") {
        cliconsole.setState(res._tag == "error" ? "error" : "done");
    }
    if (res._tag == "error") {
        console.error(res.error.config.message);
        outputs.code = res.error.config.exitCode;
    } else {
        outputs.code = 0;
        // console.log("cmd completed", res.value);
    }
    return outputs;
}

async function getKnownCounts() {
    let source = globalThis.source as CacheFileSource;
    let res: Record<string, any> = {};
    for (let modename in cacheFileDecodeModes) {
        let modefactory = cacheFileDecodeModes[modename as keyof typeof cacheFileDecodeModes];
        try {
            let mode = modefactory({});
            let fileids = await mode.logicalRangeToFiles(source, [0, 0], [Infinity, Infinity]);

            let lastfile = fileids.at(-1);
            if (lastfile) {
                let lastindex = mode.fileToLogical(source, lastfile.index.major, lastfile.index.minor, lastfile.subindex);
                res[modename] = (Array.isArray(lastindex) && lastindex.length == 1 ? lastindex[0] : lastindex);
            }
        } catch (e) {
            res[modename] = e;
        }
    }
    return res;
}

async function getNameCounts() {
    let source = globalThis.source as CacheFileSource;
    let w = await source.getCacheIndex(2)
    return Promise.all(w.map(async q => {
        let names = await source.getInternalNameList(q.minor);
        let max = 0;
        for (let k of names.keys()) {
            if (k > max) { max = k; }
        }
        return {
            id: q.minor,
            count: names.size,
            max: max,
            name: Object.entries(internalNameFiles).find(w => w[1] == q.minor)?.[0],
            names,
        };
    }));
}

async function getFileCounts() {
    let source = globalThis.source as CacheFileSource;
    let w = await source.getCacheIndex(255);
    let res: any[] = [];
    for (let q of w) {
        if (!q) { continue; }
        let files = await source.getCacheIndex(q.minor);
        res[q.minor] = {
            id: q.minor,
            count: files.filter(q => !!q).length,
            max: files.at(-1)?.minor,
            total: files.reduce((a, b) => a + (b?.subindexcount ?? 0), 0),
            name: Object.entries(cacheMajors).find(w => w[1] == q.minor)?.[0]
        }
    }
    return res;
}

async function getConfigCounts() {
    let source = globalThis.source as CacheFileSource;
    let w = await source.getCacheIndex(2)
    return w.map(q => (
        {
            id: q.minor,
            count: q.subindexcount,
            max: q.subindices.at(-1),
            name: Object.entries(cacheConfigPages).find(w => w[1] == q.minor)?.[0]
        }
    ));
}

async function dumpjson(mode: string) {
    let engine = globalThis.engine as EngineCache;
    let res = await engine.getJsonSearchData(mode as any).files;
    let remapped: any[] = [];
    for (let f of res) {
        remapped[f.$fileid] = f;
    }
    return remapped;
}

function bin(arr: any[]) {
    let bins = {};
    for (let i = 0; i < arr.length; i++) {
        let key = arr[i];
        if (!bins[key]) { bins[key] = []; }
        bins[key].push(i);
    }
    return bins;
}

function binarr(arr: any[][]) {
    let bins = {};
    for (let i = 0; i < arr.length; i++) {
        let sub = arr[i];
        if (sub) {
            for (let j = 0; j < sub.length; j++) {
                let key = sub[j];
                if (!bins[key]) { bins[key] = []; }
                bins[key].push(i);
            }
        }
    }
    return bins;
}

async function findnames(id: number) {
    let source = globalThis.source as CacheFileSource;
    let names: Record<string, string | undefined> = {};
    for (let group in internalNameFiles) {
        names[group] = await source.getInternalName(internalNameFiles[group], id);
    }
    return names;
}

async function allnames() {
    let source = globalThis.source as CacheFileSource;
    let res: Record<number, any> = {};
    let index = await source.getCacheIndex(cacheMajors.filenames);
    for (let entry of index) {
        if (!entry) { continue; }
        res[entry.minor] = await source.getInternalNameList(entry.minor);
    }
    return res;
}

function browse(filename: string) {
    let ctx = globalThis.uicontext as UIContext;
    ctx.openFile({ type: "browse", id: filename });
}

async function getlasttimestamp() {
    let source = globalThis.source as CacheFileSource;
    let rootindex = await source.getCacheIndex(cacheMajors.index);
    let maxids: Record<number, number> = {};
    for (let major of rootindex) {
        if (!major) { continue; }
        try {
            let index = await source.getCacheIndex(major.minor);
            let max = 0;
            let maxid = 0;
            for (let entry of index) {
                if (!entry) { continue; }
                if (entry.version > max) {
                    max = entry.version;
                    maxid = entry.minor;
                }
            }
            maxids[major.minor] = maxid;
        } catch (e) {
            console.error("failed to get index for major", major.minor, e);
        }
    }
    return maxids;
}