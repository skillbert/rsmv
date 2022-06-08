
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { boundMethod } from "autobind-decorator";
import * as datastore from "idb-keyval";
import { EngineCache, ob3ModelToThreejsNode, ThreejsSceneCache } from "../3d/ob3tothree";
import { ModelBrowser, StringInput } from "./scenenodes";

import { UIScriptFile } from "./scriptsui";
import { UIContext, SavedCacheSource, FileViewer, CacheSelector, openSavedCache } from "./maincomponents";

export function unload() {
	ReactDOM.unmountComponentAtNode(document.getElementById("rsmv_app")!);
}

export function start() {
	let parent = document.getElementById("rsmv_app")!;
	let ctx = new UIContext();
	ReactDOM.render(<RSMVApp ctx={ctx} />, parent);
}

class RSMVApp extends React.Component<{ ctx: UIContext }, { openedFile: UIScriptFile | null }> {
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
			this.props.ctx.setCacheSource(cache);

			try {
				let engine = await EngineCache.create(cache);
				console.log("engine loaded");
				this.props.ctx.setSceneCache(new ThreejsSceneCache(engine));
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

	componentDidMount() {
		this.props.ctx.on("openfile", this.openFile);
	}

	componentWillUnmount() {
		this.props.ctx.off("openfile", this.openFile);
	}

	@boundMethod
	openFile(file: UIScriptFile | null) {
		this.setState({ openedFile: file });
	}

	render() {
		return (
			<div id="content">
				<canvas id="viewer" ref={this.initCnv} style={{ display: this.state.openedFile ? "none" : "block" }}></canvas>
				{ this.state.openedFile && <FileViewer file={this.state.openedFile} onSelectFile={this.props.ctx.openFile} />}
				<div id="sidebar">
					{!this.props.ctx.source && (<CacheSelector onOpen={this.openCache} />)}
					{this.props.ctx.source && <input type="button" className="sub-btn" onClick={this.closeCache} value={`Close ${this.props.ctx.source.getCacheName()}`} />}
					{this.props.ctx.source && <ModelBrowser ctx={this.props.ctx} />}
				</div>
			</div >
		);
	}
}