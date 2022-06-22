
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { boundMethod } from "autobind-decorator";
import * as datastore from "idb-keyval";
import { detectTextureMode, EngineCache, ThreejsSceneCache } from "../3d/ob3tothree";
import { ModelBrowser, RendererControls } from "./scenenodes";

import { UIScriptFile } from "./scriptsui";
import { UIContext, SavedCacheSource, FileViewer, CacheSelector, openSavedCache } from "./maincomponents";

if (module.hot) {
	module.hot.accept(["../3d/ob3togltf", "../3d/ob3tothree"]);
}

export function unload(root: ReactDOM.Root) {
	root.unmount();
}

export function start(rootelement: HTMLElement) {
	window.addEventListener("keydown", e => {
		if (e.key == "F5") { document.location.reload(); }
		// if (e.key == "F12") { electron.remote.getCurrentWebContents().toggleDevTools(); }
	});

	let ctx = new UIContext();
	let root = ReactDOM.createRoot(rootelement);
	root.render(<App ctx={ctx} />);

	//this service worker holds a reference to the cache fs handle which will keep the handles valid 
	//across tab reloads
	navigator.serviceWorker.register(new URL('../assets/contextholder.js', import.meta.url).href, { scope: './', });

	return root;
}

class App extends React.Component<{ ctx: UIContext }, { openedFile: UIScriptFile | null }> {
	constructor(p) {
		super(p);
		this.state = {
			openedFile: null
		};
		datastore.get<SavedCacheSource>("openedcache").then(c => c && this.openCache(c));
	}

	@boundMethod
	async openCache(source: SavedCacheSource) {
		let cache = await openSavedCache(source, true);
		if (cache) {
			globalThis.source = cache;
			this.props.ctx.setCacheSource(cache);

			try {
				let engine = await EngineCache.create(cache);
				console.log("engine loaded");
				let scene = new ThreejsSceneCache(engine);
				if (source.type == "sqliteblobs" || source.type == "sqlitehandle" || source.type == "sqlitenodejs") {
					scene.textureType = await detectTextureMode(cache);
				}
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
		navigator.serviceWorker.ready.then(q => q.active?.postMessage({ type: "sethandle", handle: null }));
		this.props.ctx.source?.close();
		this.props.ctx.setCacheSource(null);
		this.props.ctx.setSceneCache(null);
	}

	@boundMethod
	stateChanged() {
		this.forceUpdate();
	}

	componentDidMount() {
		this.props.ctx.on("openfile", this.openFile);
		this.props.ctx.on("statechange", this.stateChanged);
	}

	componentWillUnmount() {
		this.props.ctx.off("openfile", this.openFile);
		this.props.ctx.off("statechange", this.stateChanged);
	}

	@boundMethod
	openFile(file: UIScriptFile | null) {
		this.setState({ openedFile: file });
	}

	render() {
		return (
			<div className="mv-root mv-style">
				<canvas className="mv-canvas" ref={this.initCnv} style={{ display: this.state.openedFile ? "none" : "block" }}></canvas>
				{ this.state.openedFile && <FileViewer file={this.state.openedFile} onSelectFile={this.props.ctx.openFile} />}
				<div className="mv-sidebar">
					{!this.props.ctx.source && (<CacheSelector onOpen={this.openCache} />)}
					{this.props.ctx.source && <input type="button" className="sub-btn" onClick={this.closeCache} value={`Close ${this.props.ctx.source.getCacheName()}`} />}
					<RendererControls visible={!!this.props.ctx.source} ctx={this.props.ctx} />
					{this.props.ctx.source && <ModelBrowser ctx={this.props.ctx} />}
				</div>
			</div >
		);
	}
}