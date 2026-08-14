
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import * as datastore from "idb-keyval";
import { EngineCache, ThreejsSceneCache } from "../3d/modeltothree";
import { ModelBrowser, RendererControls } from "./scenenodes";
import { UIContext, SavedCacheSource, CacheSelector, openSavedCache, UIOpenedFile, UIRootContext, UIEngineContext, downloadBlob, BrowsePageId } from "./maincomponents";
import classNames from "classnames";
import { exposeDebugToolsInGlobal } from "../consoletools";
import { useForceUpdate } from "./commoncontrols";
import { FileDisplay } from "./viewers/fileviewer";
import { BrowseDisplay } from "./tabs/browse";
import { BlobTS } from "../utils";


exposeDebugToolsInGlobal();

export function unload(obj: { root: ReactDOM.Root, ctx: UIContext }) {
	obj.root.unmount();
	obj.ctx.close();
	globalThis.uicontext = null;
}

export function start(rootelement: HTMLElement, serviceworker?: boolean) {
	window.addEventListener("keydown", e => {
		if (e.key == "F5") { document.location.reload(); }
		// if (e.key == "F12") { electron.remote.getCurrentWebContents().toggleDevTools(); }
	});

	let ctx = new UIContext(rootelement, serviceworker ?? false);
	let root = ReactDOM.createRoot(rootelement);
	root.render(
		<UIRootContext.Provider value={ctx}>
			<App />
		</UIRootContext.Provider>
	);
	
	globalThis.uicontext = ctx;
	return { root, ctx };
}


function App(p: {}) {
	let ctx = React.useContext(UIRootContext);

	let initCnv = React.useCallback((cnv: HTMLCanvasElement | null) => {
		ctx.setRenderer(cnv ? new ThreeJsRenderer(cnv) : null);
	}, []);

	let openCache = React.useCallback(async (source: SavedCacheSource) => {
		let cache = await openSavedCache(source, true);
		if (cache) {
			globalThis.source = cache;
			ctx.setCacheSource(cache);

			try {
				let engine = await EngineCache.create(cache);
				console.log("engine loaded", cache.getBuildNr());
				let scene = await ThreejsSceneCache.create(engine);
				ctx.setSceneCache(scene);

				globalThis.sceneCache = scene;
				globalThis.engine = engine;
				globalThis.reloadCache = () => openCache(source);
			} catch (e) {
				console.log("failed to create scenecache");
				console.error(e);
			}
		};
	}, [ctx]);

	let closeCache = React.useCallback(() => {
		datastore.del("openedcache");
		localStorage.rsmv_openedcache = "";
		navigator.serviceWorker?.ready.then(q => q.active?.postMessage({ type: "sethandle", handle: null }));
		ctx.source?.close();
		ctx.setCacheSource(null);
		ctx.setSceneCache(null);
	}, [ctx]);

	React.useEffect(() => {
		(async () => {
			try {
				let c = await Promise.race([
					datastore.get<SavedCacheSource>("openedcache"),
					new Promise<never>((d, f) => setTimeout(f, 1000))
				]);
				if (c) { openCache(c); }
			} catch (e) {
				console.log("failed to open indexedDB openedcache, fallback to localStorage (without webfs support)");
				try {
					let cache = JSON.parse(localStorage.rsmv_openedcache!);
					openCache(cache);
				} catch (e) { }
			};
		})()
	}, []);

	let redraw = useForceUpdate();
	React.useEffect(() => {
		ctx.on("statechange", redraw);
		ctx.on("showTab", redraw);
		window.addEventListener("resize", redraw);
		return () => {
			ctx.off("statechange", redraw);
			ctx.off("showTab", redraw);
			window.removeEventListener("resize", redraw);
		}
	}, [ctx]);

	let width = ctx.rootElement.clientWidth;
	let vertical = width < 550;

	let visibletab = (ctx.activeTabIndex != -1 ? ctx.openedTabs[ctx.activeTabIndex] : null);

	let cachemeta = ctx.source?.getCacheMeta();
	return (
		<UIEngineContext.Provider value={ctx.renderable}>
			<div className={classNames("mv-root", "mv-style", { "mv-root--vertical": vertical })}>
				<canvas className="mv-canvas" ref={initCnv} style={{ display: visibletab ? "none" : "block" }}></canvas>
				{visibletab?.type == "file" && <FileViewer file={visibletab} onSelectFile={ctx.openFile} />}
				{visibletab?.type == "browse" && <BrowseViewer browse={visibletab} onSelectFile={ctx.openFile} />}
				<div className="mv-sidebar">
					{!ctx.source && (
						<React.Fragment>
							<CacheSelector onOpen={openCache} />
							<div style={{ flex: "1" }} />
							<div style={{ textAlign: "center" }}>
								Go to <a href="https://runeapps.org/modelviewer_about">RuneApps</a> for more info. Source code hosted at <a href="https://github.com/skillbert/rsmv" target="_blank">github.com/skillbert/rsmv</a>
							</div>
						</React.Fragment>
					)}
					{cachemeta && (
						<React.Fragment>
							<input type="button" className="sub-btn" onClick={closeCache} value={`Close ${cachemeta.name}`} title={cachemeta.descr} />
							<RendererControls />
							<ModelBrowser />
						</React.Fragment>
					)}
				</div>
			</div >
		</UIEngineContext.Provider>
	);
}


export function FileViewer(p: { file: UIOpenedFile, onSelectFile: (f: UIOpenedFile | null) => void }) {
	return (
		<div style={{ display: "grid", gridTemplateRows: "auto 1fr" }}>
			<div className="mv-modal-head">
				<span>{p.file.name}</span>
				<span style={{ float: "right", marginLeft: "10px" }} onClick={e => downloadBlob(p.file.name, new BlobTS([p.file.data]))}>download</span>
				<span style={{ float: "right", marginLeft: "10px" }} onClick={e => p.onSelectFile(null)}>x</span>
			</div>
			<div style={{ overflow: "auto", flex: "1", position: "relative" }}>
				<FileDisplay file={p.file} />
			</div>
		</div>
	);
}


export function BrowseViewer(p: { browse: BrowsePageId, onSelectFile: (f: UIOpenedFile | null) => void }) {
	return (
		<div style={{ display: "grid", gridTemplateRows: "auto 1fr" }}>
			<div className="mv-modal-head">
				<span>{p.browse.id}</span>
				<span style={{ float: "right", marginLeft: "10px" }} onClick={e => p.onSelectFile(null)}>x</span>
			</div>
			<div style={{ overflow: "auto", flex: "1", position: "relative" }}>
				<BrowseDisplay browse={p.browse} />
			</div>
		</div>
	);
}

