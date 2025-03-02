
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { boundMethod } from "autobind-decorator";
import * as datastore from "idb-keyval";
import { EngineCache, ThreejsSceneCache } from "../3d/modeltothree";
import { ModelBrowser, RendererControls } from "./scenenodes";

import { UIScriptFile, UIScriptFS } from "./scriptsui";
import { UIContext, SavedCacheSource, FileViewer, CacheSelector, openSavedCache, UIOpenedFile } from "./maincomponents";
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
	root.render(<App ctx={ctx} />);

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

class App extends React.Component<{ ctx: UIContext }, { openedFile: UIOpenedFile | null }> {
	constructor(p) {
		super(p);
		this.state = {
			openedFile: this.props.ctx.openedfile
		};
		(async () => {
			try {
				let c = await Promise.race([
					datastore.get<SavedCacheSource>("openedcache"),
					new Promise<never>((d, f) => setTimeout(f, 1000))
				]);
				if (c) { this.openCache(c); }
			} catch (e) {
				console.log("failed to open indexedDB openedcache, fallback to localStorage (without webfs support)");
				try {
					let cache = JSON.parse(localStorage.rsmv_openedcache!);
					this.openCache(cache);
				} catch (e) { }
			};
		})();
	}

	@boundMethod
	async openCache(source: SavedCacheSource) {
		let cache = await openSavedCache(source, true);
		if (cache) {
			globalThis.source = cache;
			this.props.ctx.setCacheSource(cache);

			try {
				let engine = await EngineCache.create(cache);
				console.log("engine loaded", cache.getBuildNr());
				let scene = await ThreejsSceneCache.create(engine);
				this.props.ctx.setSceneCache(scene);

				globalThis.sceneCache = scene;
				globalThis.engine = engine;
			} catch (e) {
				console.log("failed to create scenecache");
				console.error(e);
			}
		};
	}

	@boundMethod
	initCnv(cnv: HTMLCanvasElement | null) {
		this.props.ctx.setRenderer(cnv ? new ThreeJsRenderer(cnv) : null);
	}

	@boundMethod
	closeCache() {
		datastore.del("openedcache");
		localStorage.rsmv_openedcache = "";
		navigator.serviceWorker?.ready.then(q => q.active?.postMessage({ type: "sethandle", handle: null }));
		this.props.ctx.source?.close();
		this.props.ctx.setCacheSource(null);
		this.props.ctx.setSceneCache(null);
	}

	@boundMethod
	stateChanged() {
		this.forceUpdate();
	}

	@boundMethod
	resized() {
		this.forceUpdate();
	}

	componentDidMount() {
		this.props.ctx.on("openfile", this.openFile);
		this.props.ctx.on("statechange", this.stateChanged);
		window.addEventListener("resize", this.resized);
	}

	componentWillUnmount() {
		this.props.ctx.off("openfile", this.openFile);
		this.props.ctx.off("statechange", this.stateChanged);
		window.removeEventListener("resize", this.resized);
		this.closeCache();
	}

	@boundMethod
	openFile(file: UIOpenedFile | null) {
		this.setState({ openedFile: file });
	}

	render() {
		let width = this.props.ctx.rootElement.clientWidth;
		let vertical = width < 550;

		let cachemeta = this.props.ctx.source?.getCacheMeta();
		return (
			<div className={classNames("mv-root", "mv-style", { "mv-root--vertical": vertical })}>
				<canvas className="mv-canvas" ref={this.initCnv} style={{ display: this.state.openedFile ? "none" : "block" }}></canvas>
				{this.state.openedFile && <FileViewer file={this.state.openedFile} onSelectFile={this.props.ctx.openFile} />}
				<div className="mv-sidebar">
					{!this.props.ctx.source && (
						<React.Fragment>
							<CacheSelector onOpen={this.openCache} />
							<div style={{ flex: "1" }} />
							<div style={{ textAlign: "center" }}>
								Go to <a href="https://runeapps.org/modelviewer_about">RuneApps</a> for more info. Source code hosted at <a href="https://github.com/skillbert/rsmv" target="_blank">github.com/skillbert/rsmv</a>
							</div>
						</React.Fragment>
					)}
					{cachemeta && (
						<React.Fragment>
							<input type="button" className="sub-btn" onClick={this.closeCache} value={`Close ${cachemeta.name}`} title={cachemeta.descr} />
							<RendererControls ctx={this.props.ctx} />
							<ModelBrowser ctx={this.props.ctx} />
						</React.Fragment>
					)}
				</div>
			</div >
		);
	}
}