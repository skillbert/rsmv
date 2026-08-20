import { ThreejsSceneCache, EngineCache } from '../../3d/modeltothree';
import { stringToFileRange } from '../../utils';
import { CacheFileSource } from '../../cache';
import { cacheMajors } from "../../constants";
import * as React from "react";
import { cacheFileDecodeModes, cacheFileDecodeGroups, DecodeMode } from "../../parser/filetypes";
import { defaultTestDecodeOpts, testDecode } from "../../scripts/testdecode";
import { UIScriptOutput, OutputUI } from "../scriptsui";
import { CacheSelector, openSavedCache, SavedCacheSource, UIRootContext } from "../maincomponents";
import { runMapRender } from "../../map";
import { diffCaches, FileEdit } from "../../scripts/cachediff";
import { showModal } from "../jsonsearch";
import { InputCommitted, LabeledInput, TabStrip } from "../commoncontrols";
import { cacheFileJsonModes, FileParser } from '../../parser/jsondecoders';
import { fileHistory } from '../../scripts/filehistory';
import { extractCacheFiles } from '../../scripts/extractfiles';
import { MapRenderFsBacked, examplemapconfig, parseMapConfig } from '../../map/backends';
import { previewAllFileTypes } from '../../scripts/previewall';
import { CliApiContext, cliApi } from '../../clicommands';
import * as cmdts from "cmd-ts";
import { RSModel } from '../../3d/scene/model';
import { diffFileDependencyHash } from '../../scripts/dependencydiff';
import { depClasses } from '../../scripts/dependencies';
import { LookupModeProps } from '../scenenodes';
import { calculateReferenceGraph } from '../../scripts/jsonindexer';

function PreviewFilesScript(p: UiScriptProps) {
    let ctx = React.useContext(UIRootContext);
    let [] = p.initialArgs.split(":") as (string | undefined)[];

    let run = () => {
        if (!ctx.source) { return; }
        let output = new UIScriptOutput();
        let outdir = output.makefs("out");
        output.run(previewAllFileTypes, outdir, ctx.source);
        p.onRun(output, ``);
    }

    return (
        <React.Fragment>
            <p>Extracts a couple example files for each known extraction mode.</p>
            <input type="button" className="sub-btn" value="Run" disabled={!ctx.source} onClick={run} />
        </React.Fragment>
    )
}

function ModeDropDownOptions() {
    return (
        <React.Fragment>
            {Object.entries(cacheFileDecodeGroups).map(([k, v]) => (
                <optgroup key={k} label={k}>
                    {Object.keys(v).map(k => <option key={k} value={k}>{k}</option>)}
                </optgroup>
            ))}
        </React.Fragment>
    );
}

function ExtractFilesScript(p: UiScriptProps) {
    let ctx = React.useContext(UIRootContext);
    let [initmode, initbatched, initdecoder, initfilestext] = p.initialArgs.split(":") as (string | undefined)[];
    let [filestext, setFilestext] = React.useState(initfilestext ?? "");
    let [mode, setMode] = React.useState<string>(initmode || "items");
    let [batched, setbatched] = React.useState(initbatched == "true");
    let [decoderflags, setdecodersflags] = React.useState((initdecoder ? Object.fromEntries(initdecoder.split(",").map(q => [q.split("=")[0], q.split("=")[1] ?? ""])) : {}));

    let run = () => {
        if (!ctx.source) { return; }
        let output = new UIScriptOutput();
        let outdir = output.makefs("out");
        let files = stringToFileRange(filestext);
        output.run(extractCacheFiles, outdir, ctx.source, { files, mode, batched, batchlimit: -1, edit: false, skipread: false }, decoderflags);
        p.onRun(output, `${mode}:${batched}:${Object.entries(decoderflags).map(([k, v]) => `${k}=${v}`).join(",")}:${filestext}`);
    }

    let modemeta = React.useMemo<DecodeMode | undefined>(() => cacheFileDecodeModes[mode]?.({}), [mode]);
    let setFlag = (flag: string, v: boolean) => {
        let newflags = { ...decoderflags };
        if (v) { newflags[flag] = "true"; }
        else { delete newflags[flag]; }
        setdecodersflags(newflags);
    }

    return (
        <React.Fragment>
            <p>Extract files from the cache.<br />The ranges field uses logical file id's for JSON based files, {"<major>.<minor>"} notation for bin mode, or {"<x>.<z>"} for map based files.</p>
            <LabeledInput label="Mode">
                <select value={mode} onChange={e => setMode(e.currentTarget.value as any)}>
                    {/* {Object.keys(cacheFileDecodeModes).map(k => <option key={k} value={k}>{k}</option>)} */}
                    <ModeDropDownOptions />
                </select>
            </LabeledInput>
            <LabeledInput label="File ranges">
                <InputCommitted type="text" onChange={e => setFilestext(e.currentTarget.value)} value={filestext} />
            </LabeledInput>
            <div>{modemeta?.description ?? ""}</div>
            <div><label><input type="checkbox" checked={batched} onChange={e => setbatched(e.currentTarget.checked)} />Concatenate group files</label></div>
            {Object.entries(modemeta?.flagtemplate ?? {}).map(([k, v]) => (
                <div key={k}><label><input type="checkbox" checked={decoderflags[k] == "true"} onChange={e => setFlag(k, e.currentTarget.checked)} />{v.text}</label></div>
            ))}
            <input type="button" className="sub-btn" value="Run" disabled={!ctx.source} onClick={run} />
        </React.Fragment>
    )
}
function ExtractHistoricScript(p: UiScriptProps) {
    let [initmode, initfilestext, initcacheids] = p.initialArgs.split(":") as (string | undefined)[];
    let [filestext, setFilestext] = React.useState(initfilestext ?? "");
    let [buildnrs, setbuildnrs] = React.useState(initcacheids ?? "");
    let [mode, setMode] = React.useState<keyof typeof cacheFileDecodeModes>(initmode as any || "items");

    let run = () => {
        let output = new UIScriptOutput();
        let outdir = output.makefs("out");
        let builds = stringToFileRange(buildnrs);
        let files = stringToFileRange(filestext);
        output.run(fileHistory, outdir, mode, files[0].start, null, builds);
        p.onRun(output, `${mode}:${filestext}:${buildnrs}`);
    }

    return (
        <React.Fragment>
            <p>Tracks a single file's update history using openrs2 caches. Each known cache will be compared and all changes are shown. {"<major>.<minor>"} notation for bin mode, or {"<x>.<z>"} for map based files.</p>
            <LabeledInput label="Mode">
                <select value={mode} onChange={e => setMode(e.currentTarget.value as any)}>
                    {/* {Object.keys(cacheFileDecodeModes).map(k => <option key={k} value={k}>{k}</option>)} */}
                    <ModeDropDownOptions />
                </select>
            </LabeledInput>
            <LabeledInput label="File ranges">
                <InputCommitted type="text" onChange={e => setFilestext(e.currentTarget.value)} value={filestext} />
            </LabeledInput>
            <LabeledInput label="Build numbers (empty for all)">
                <input type="text" value={buildnrs} onChange={e => setbuildnrs(e.currentTarget.value)} />
            </LabeledInput>
            <input type="button" className="sub-btn" value="Run" onClick={run} />
        </React.Fragment>
    )
}

function MaprenderScript(p: UiScriptProps) {
    let ctx = React.useContext(UIRootContext);
    let [configjson, setconfigjson] = React.useState(localStorage.rsmv_script_map_lastconfig || examplemapconfig);

    let run = async () => {
        if (!ctx.source) { return; }
        localStorage.rsmv_script_map_lastconfig = (configjson == examplemapconfig ? "" : configjson);
        let output = new UIScriptOutput();
        let fs = output.makefs("render");
        let config = new MapRenderFsBacked(fs, parseMapConfig(configjson), false);
        await fs.writeFile("mapconfig.jsonc", configjson);
        output.run(runMapRender, ctx.source, config, true);
        p.onRun(output, "");
    }

    let editconfig = () => {
        let modal = showModal({ title: "Map render config" }, (
            <form style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <textarea name="parsertext" defaultValue={configjson} style={{ flex: "1000px 1 1", resize: "none", whiteSpace: "nowrap" }} />
                <input type="button" className="sub-btn" value="Confirm" disabled={!ctx.source} onClick={e => { setconfigjson(e.currentTarget.form!.parsertext.value); modal.close(); }} />
            </form>
        ))
    }

    return (
        <React.Fragment>
            <p>Render 3d world map. (there is a CLI version of this command which is much more performant)</p>
            <div>
                <input type="button" className="sub-btn" value="Edit Config" onClick={editconfig} />
                {configjson != examplemapconfig && <input type="button" className="sub-btn" value="Reset" onClick={e => setconfigjson(examplemapconfig)} />}
            </div>
            <input type="button" className="sub-btn" value="Run" onClick={run} />
        </React.Fragment>
    )
}

function ReferenceGraphScript(p: UiScriptProps) {
    let ctx = React.useContext(UIRootContext);

    let run = async () => {
        if (!ctx.source) { return; }
        let output = new UIScriptOutput();
        p.onRun(output, "");
        let res = output.run(calculateReferenceGraph, ctx.source);
    }

    return (
        <React.Fragment>
            <p>Indexes all references in the cache for later use.</p>
            <input type="button" className="sub-btn" value="Run" disabled={!ctx.source} onClick={run} />
        </React.Fragment>
    )
}
function CacheDiffScript(p: UiScriptProps) {
    let ctx = React.useContext(UIRootContext);
    let [cache2, setCache2] = React.useState<CacheFileSource | null>(null);
    let [result, setResult] = React.useState<FileEdit[] | null>(null);
    let [filerange, setFilerange] = React.useState("");
    let [showmodels, setshowmodels] = React.useState(false);

    let openCache = async (s: SavedCacheSource) => {
        setCache2(await openSavedCache(s, false));
    }

    React.useEffect(() => () => cache2?.close(), [cache2]);

    let run = async () => {
        if (!cache2 || !ctx.source) { return; }
        let output = new UIScriptOutput();
        let outdir = output.makefs("diff");
        let files = stringToFileRange(filerange);
        p.onRun(output, "");
        let res = output.run(diffCaches, outdir, cache2, ctx.source, files);
        res.then(setResult);
    }

    let clickOpen = () => {
        let frame = showModal({ title: "Select a cache" }, (
            <CacheSelector onOpen={v => { openCache(v); frame.close(); }} noReopen={true} />
        ));
    }

    React.useEffect(() => {
        if (result && showmodels && cache2 && ctx.sceneCache) {
            let prom = EngineCache.create(cache2).then(async engine => {
                let oldscene = await ThreejsSceneCache.create(engine);
                let models: RSModel[] = [];
                const xstep = 5 * 512;
                const zstep = 5 * 512;
                let modelcount = 0;
                for (let diff of result!) {
                    if (diff.major == cacheMajors.models) {
                        if (diff.before) {
                            let model = new RSModel(oldscene, [{ modelid: diff.minor, mods: {} }], `before ${diff.minor}`);
                            model.rootnode.position.set(modelcount * xstep, 0, zstep);
                            models.push(model);
                            model.addToScene(ctx.renderer!);
                        }
                        if (diff.after) {
                            let model = new RSModel(ctx.sceneCache!, [{ modelid: diff.minor, mods: {} }], `after ${diff.minor}`);
                            model.rootnode.position.set(modelcount * xstep, 0, 0);
                            models.push(model);
                            model.addToScene(ctx.renderer!);
                        }
                        modelcount++;
                    }
                }
                return models;
            })

            return () => {
                prom.then(models => models.forEach(q => q.cleanup()));
            }
        }
    }, [result, showmodels]);

    return (
        <React.Fragment>
            <p>Shows all changes between the current cache and a second cache.</p>
            {!cache2 && <input type="button" className="sub-btn" value="Select second cache" onClick={e => clickOpen()} />}
            {cache2 && <input type="button" className="sub-btn" value={`Close ${cache2.getCacheMeta().name}`} onClick={e => setCache2(null)} />}
            <LabeledInput label="file range">
                <input type="text" onChange={e => setFilerange(e.currentTarget.value)} value={filerange} />
            </LabeledInput>
            <input type="button" className="sub-btn" value="Run" disabled={!ctx.source || !cache2} onClick={run} />
            {result && <label><input checked={showmodels} onChange={e => setshowmodels(e.currentTarget.checked)} type="checkbox" />View changed models</label>}
        </React.Fragment>
    )
}

function DependencyDiffScript(p: UiScriptProps) {
    let ctx = React.useContext(UIRootContext);
    let [engine2, setEngine2] = React.useState<EngineCache | null>(null);
    let [objclass, setObjclass] = React.useState("map");
    let [fileid, setFileid] = React.useState("50.50");

    let openCache = async (s: SavedCacheSource) => {
        let cache = await openSavedCache(s, false);
        if (cache) {
            let engine = await EngineCache.create(cache);
            setEngine2(engine);
        }
    }

    React.useEffect(() => () => engine2?.close(), [engine2]);

    let run = async () => {
        if (!ctx.sceneCache || !engine2) { return; }
        let output = new UIScriptOutput();
        let outdir = output.makefs("diff");
        p.onRun(output, "");
        let res = output.run(diffFileDependencyHash, outdir, ctx.sceneCache!.engine, engine2, objclass, fileid);
    }

    let clickOpen = () => {
        let frame = showModal({ title: "Select a cache" }, (
            <CacheSelector onOpen={v => { openCache(v); frame.close(); }} noReopen={true} />
        ));
    }

    return (
        <React.Fragment>
            <p>Builds a dependency tree and then shows which files depend on changed files</p>
            {!engine2 && <input type="button" className="sub-btn" value="Select second cache" onClick={e => clickOpen()} />}
            {engine2 && <input type="button" className="sub-btn" value={`Close ${engine2.getCacheMeta().name}`} onClick={e => setEngine2(null)} />}
            <LabeledInput label="object class">
                <select value={objclass} onChange={e => setObjclass(e.currentTarget.value)}>
                    <option value="map">map</option>
                    {depClasses.flatMap(group => <option key={group}>{group}</option>)}
                </select>
            </LabeledInput>
            <LabeledInput label="file id">
                <input type="text" onChange={e => setFileid(e.currentTarget.value)} value={fileid} />
            </LabeledInput>
            <input type="button" className="sub-btn" value="Run" disabled={!ctx.source || !engine2} onClick={run} />
        </React.Fragment>
    )
}

function TestFilesScript(p: UiScriptProps) {
    let ctx = React.useContext(UIRootContext);
    let [initmode, initrange, initdumpall, initordersize] = p.initialArgs.split(":") as (string | undefined)[];
    let [mode, setMode] = React.useState(initmode || "");
    let [range, setRange] = React.useState(initrange || "");
    let [dumpall, setDumpall] = React.useState(initdumpall != "false");
    let [ordersize, setOrdersize] = React.useState(initordersize == "true");
    let [customparser, setCustomparser] = React.useState("");

    let run = () => {
        let modeobj = cacheFileJsonModes[mode as keyof typeof cacheFileJsonModes];
        if (!modeobj || !ctx.source) { return; }
        let output = new UIScriptOutput();
        let outdir = output.makefs("output")
        let opts = defaultTestDecodeOpts();
        opts.maxerrs = 50000;
        opts.orderBySize = ordersize;
        opts.dumpall = dumpall;
        if (customparser) {
            modeobj = { ...modeobj };
            modeobj.parser = FileParser.fromJson(customparser);
        }
        output.run(testDecode, outdir, ctx.source, modeobj, stringToFileRange(range), opts);
        p.onRun(output, `${mode}:${range}:${dumpall}:${ordersize}`);
    }

    let customparserUi = React.useCallback(() => {
        let srctext = customparser || cacheFileJsonModes[mode as keyof typeof cacheFileJsonModes].parser.originalSource;
        let modal = showModal({ title: "Edit parser" }, (
            <form style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <textarea name="parsertext" defaultValue={srctext} style={{ flex: "1000px 1 1", resize: "none", whiteSpace: "nowrap" }} />
                <input type="button" className="sub-btn" value="Confirm" onClick={e => { setCustomparser(e.currentTarget.form!.parsertext.value); modal.close(); }} />
            </form>
        ))
        // txtarea.style.cssText = "position:absolute;top:0px;left:0px;right:0px;bottom:20px;";
    }, [customparser, mode]);

    return (
        <React.Fragment>
            <p>Run this script to test if the current cache parser is compatible with the loaded cache. Generates readable errors if not.</p>
            <LabeledInput label="Mode">
                <select value={mode} onChange={e => setMode(e.currentTarget.value)}>
                    {Object.keys(cacheFileJsonModes).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
            </LabeledInput>
            <LabeledInput label="file range">
                <input type="text" onChange={e => setRange(e.currentTarget.value)} value={range} />
            </LabeledInput>
            <div><label><input type="checkbox" checked={ordersize} onChange={e => setOrdersize(e.currentTarget.checked)} />Order by size (puts everything in mem)</label></div>
            <div><label><input type="checkbox" checked={dumpall} onChange={e => setDumpall(e.currentTarget.checked)} />Output successes as well</label></div>
            <br />
            <input type="button" className="sub-btn" value="Edit parser" onClick={customparserUi} />
            {customparser && <input type="button" className="sub-btn" value="Reset" onClick={() => setCustomparser("")} />}
            <br />
            <input type="button" className="sub-btn" value="Run" disabled={!ctx.source} onClick={run} />
        </React.Fragment>
    )
}

function RawCliScript(p: UiScriptProps) {
    let ctx = React.useContext(UIRootContext);
    let [text, setText] = React.useState(p.initialArgs);

    let run = async () => {
        if (!ctx.source) { return; }
        let output = new UIScriptOutput();
        let apictx: CliApiContext = {
            getConsole() { return output; },
            getFs(name: string) { return output.makefs(name); },
            getDefaultCache() { return ctx.source!; }
        };

        p.onRun(output, text);
        let api = cliApi(apictx);

        let res = await cmdts.runSafely(api.subcommands, text.split(/\s+/g));
        if (output.state == "running") {
            output.setState(res._tag == "error" ? "error" : "done");
        }
        if (res._tag == "error") {
            output.log(res.error.config.message);
        } else {
            output.log("script done");
        }
    }

    return (
        <React.Fragment>
            <p>Run CLI code</p>
            <input type="text" value={text} onInput={e => setText(e.currentTarget.value)} />
            <input type="button" className="sub-btn" value="Run" disabled={!ctx.source} onClick={run} />
        </React.Fragment>
    )
}

type UiScriptProps = { onRun: (output: UIScriptOutput, args: string) => void, initialArgs: string };
const uiScripts: Record<string, React.ComponentType<UiScriptProps>> = {
    test: TestFilesScript,
    extract: ExtractFilesScript,
    preview: PreviewFilesScript,
    historic: ExtractHistoricScript,
    maprender: MaprenderScript,
    diff: CacheDiffScript,
    refgraph: ReferenceGraphScript,
    deps: DependencyDiffScript,
    cli: RawCliScript
}

export function ScriptsUI(p: LookupModeProps) {
    let ctx = React.useContext(UIRootContext);
    let initialscript = "test";
    let initialargs = "";
    if (typeof p.initialId == "string") {
        [initialscript, initialargs] = p.initialId.split(/(?<=^[^:]*):/);
    }
    let [script, setScript] = React.useState<string>(initialscript);
    let [running, setRunning] = React.useState<UIScriptOutput | null>(null);

    let onRun = React.useCallback((output: UIScriptOutput, savedargs: string) => {
        localStorage.rsmv_lastsearch = JSON.stringify(script + ":" + savedargs);
        setRunning(output);
    }, [script]);

    const source = ctx.source;
    if (!source) { throw new Error("trying to render modelbrowser without source loaded"); }
    const SelectedScript = uiScripts[script as keyof typeof uiScripts];
    return (
        <React.Fragment>
            <div className="mv-sidebar-scroll">
                <h2>Script runner</h2>
                <TabStrip value={script} tabs={Object.fromEntries(Object.keys(uiScripts).map(k => [k, k])) as any} onChange={v => setScript(v)} />
                {!SelectedScript && (
                    <React.Fragment>
                        <p>Select a script</p>
                        <p>The script runner allows you to run some of the CLI scripts directly from the browser.</p>
                    </React.Fragment>
                )}
                {SelectedScript && <SelectedScript onRun={onRun} initialArgs={initialscript == script ? (initialargs ?? "") : ""} />}
                <h2>Script output</h2>
                <OutputUI output={running} />
            </div>
        </React.Fragment>
    );
}
