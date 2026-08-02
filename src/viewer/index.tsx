
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { boundMethod } from "autobind-decorator";
import * as datastore from "idb-keyval";
import { EngineCache, ThreejsSceneCache } from "../3d/modeltothree";
import { ModelBrowser, RendererControls } from "./scenenodes";

import { UIScriptFile, UIScriptFS, useEmitterProperty, useForceUpdate } from "./scriptsui";
import { UIContext, SavedCacheSource, FileViewer, CacheSelector, openSavedCache, UIOpenedFile, UIRootContext, UIEngineContext } from "./maincomponents";
import classNames from "classnames";
import { cliApi, CliApiContext } from "../clicommands";
import { CLIScriptOutput } from "../scriptrunner";
import * as cmdts from "cmd-ts";

export function unload(root: ReactDOM.Root) {
	root.unmount();
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

	globalThis.cli = async (args: string) => {
		let cliconsole = new CLIScriptOutput();
		let outputs: Record<string, any> = {};

		let clictx: CliApiContext = {
			getConsole() { return cliconsole; },
			getFs(name: string) { return outputs[name] ??= new UIScriptFS(null); },
			getDefaultCache() { return ctx.source!; }
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

	return root;
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
		ctx.on("openfile", redraw);
		window.addEventListener("resize", redraw);
		return () => {
			ctx.off("statechange", redraw);
			ctx.off("openfile", redraw);
			window.removeEventListener("resize", redraw);
		}
	}, [ctx]);

	let width = ctx.rootElement.clientWidth;
	let vertical = width < 550;

	let cachemeta = ctx.source?.getCacheMeta();
	return (
		<UIEngineContext.Provider value={ctx.renderable}>
			<div className={classNames("mv-root", "mv-style", { "mv-root--vertical": vertical })}>
				<canvas className="mv-canvas" ref={initCnv} style={{ display: ctx.openedfile ? "none" : "block" }}></canvas>
				{ctx.openedfile && <FileViewer file={ctx.openedfile} onSelectFile={ctx.openFile} />}
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
