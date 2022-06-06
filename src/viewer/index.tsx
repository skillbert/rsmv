
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { boundMethod } from "autobind-decorator";
import * as datastore from "idb-keyval";
import { EngineCache, ob3ModelToThreejsNode, ThreejsSceneCache } from "../3d/ob3tothree";
import { ModelBrowser, StringInput } from "./scenenodes";

import { UIScriptFile } from "./scriptsui";
import { UIContext, SavedCacheSource, FileViewer, CacheSelector, openSavedCache } from "./maincomponents";

if (module.hot) {
	module.hot.accept(["../3d/ob3togltf", "../3d/ob3tothree"]);
}

function start() {
	window.addEventListener("keydown", e => {
		if (e.key == "F5") { document.location.reload(); }
		// if (e.key == "F12") { electron.remote.getCurrentWebContents().toggleDevTools(); }
	});

	ReactDOM.render(<App />, document.getElementById("app"));

	//this service worker holds a reference to the cache fs handle which will keep the handles valid 
	//across tab reloads
	navigator.serviceWorker.register('./contextholder.js', { scope: './', });
}

class App extends React.Component<{}, { renderer: ThreeJsRenderer | null, cache: ThreejsSceneCache | null, openedFile: UIScriptFile | null }> {
	appctx: UIContext | null = null;

	constructor(p) {
		super(p);
		this.state = {
			cache: null,
			renderer: null,
			openedFile: null
		};
		datastore.get<SavedCacheSource>("openedcache").then(c => c && this.openCache(c));
	}

	@boundMethod
	async openCache(source: SavedCacheSource) {
		let cache = await openSavedCache(source, true);
		if (cache) { this.setState({ cache }) };
	}

	@boundMethod
	initCnv(cnv: HTMLCanvasElement | null) {
		if (cnv) {
			let renderer = new ThreeJsRenderer(cnv);
			renderer.automaticFrames = true;
			console.warn("forcing auto-frames!!");
			this.setState({ renderer });
		}
	}

	@boundMethod
	closeCache() {
		datastore.del("openedcache");
		navigator.serviceWorker.ready.then(q => q.active?.postMessage({ type: "sethandle", handle: null }));
		this.state.cache?.source.close();
		this.setState({ cache: null });
	}

	componentWillUnmount() {
		this.fixAppctx(true)
	}

	@boundMethod
	openFile(file: UIScriptFile | null) {
		this.setState({ openedFile: file });
	}

	fixAppctx(dispose = false) {
		if (!dispose && this.state.renderer && this.state.cache) {
			if (!this.appctx) {
				this.appctx = new UIContext(this.state.cache, this.state.renderer);
				this.appctx.on("openfile", this.openFile);
			}
		} else {
			if (this.appctx) {
				this.appctx.off("openfile", this.openFile);
				this.appctx = null;
			}
		}
		return this.appctx;
	}

	render() {
		let appctx = this.fixAppctx();
		return (
			<div id="content">
				<canvas id="viewer" ref={this.initCnv} style={{ display: this.state.openedFile ? "none" : "block" }}></canvas>
				{appctx && this.state.openedFile && <FileViewer file={this.state.openedFile} onSelectFile={appctx.openFile} />}
				<div id="sidebar">
					{!this.state.cache && (<CacheSelector onOpen={this.openCache} />)}
					{appctx && <input type="button" className="sub-btn" onClick={this.closeCache} value={`Close ${appctx.source.getCacheName()}`} />}
					{appctx && <ModelBrowser ctx={appctx} />}
				</div>
			</div >
		);
	}
}
start();