
import { parseAnimgroupConfigs, parseEnvironments, parseItem, parseNpc, parseObject, parseSkeletalAnim } from "../opdecoder";
import { ThreeJsRenderer } from "./threejsrender";
import { cacheConfigPages, cacheMajors } from "../constants";
import * as React from "react";
import * as ReactDOM from "react-dom";
import classNames from "classnames";
import { boundMethod } from "autobind-decorator";
import { WasmGameCacheLoader } from "../cache/sqlitewasm";
import { CacheFileSource, cachingFileSourceMixin } from "../cache";

import * as datastore from "idb-keyval";
import { EngineCache, ob3ModelToThreejsNode, ThreejsSceneCache } from "../3d/ob3tothree";
import { ModelBrowser, StringInput } from "./scenenodes";
import { getDependencies } from "../scripts/dependencies";
import { hashCache } from "../scripts/cachediff";
import { runMapRender } from "../map/index";
import { Openrs2CacheSource } from "../cache/openrs2loader";

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

type SavedCacheSource = {
	type: string
} & ({
	type: "sqlitehandle",
	handle: FileSystemDirectoryHandle
} | {
	type: "sqliteblobs",
	blobs: Record<string, Blob>
} | {
	type: "openrs2",
	cachename: string
});

class CacheSelector extends React.Component<{ savedSource?: SavedCacheSource, onOpen: (c: SavedCacheSource) => void }, {}>{
	constructor(p) {
		super(p);
		this.state = {};
	}

	componentDidMount() {
		document.body.addEventListener("dragover", this.onDragOver);
		document.body.addEventListener("drop", this.onFileDrop);
	}

	componentWillUnmount() {
		document.body.removeEventListener("dragover", this.onDragOver);
		document.body.removeEventListener("drop", this.onFileDrop)
	}

	@boundMethod
	onDragOver(e: DragEvent) {
		e.preventDefault();
	}

	@boundMethod
	async clickOpen() {
		let dir = await showDirectoryPicker();
		this.props.onOpen({ type: "sqlitehandle", handle: dir });
	}

	@boundMethod
	async onFileDrop(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) {
			let files: Record<string, Blob> = {};
			let items: DataTransferItem[] = [];
			let folderhandles: FileSystemDirectoryHandle[] = [];
			let filehandles: FileSystemFileHandle[] = [];
			for (let i = 0; i < e.dataTransfer.items.length; i++) { items.push(e.dataTransfer.items[i]); }
			//needs to start synchronously as the list is cleared after the event stack
			await Promise.all(items.map(async item => {
				if (item.getAsFileSystemHandle) {
					let filehandle = (await item.getAsFileSystemHandle())!;
					if (filehandle.kind == "file") {
						let file = filehandle as FileSystemFileHandle;
						filehandles.push(file);
						files[filehandle.name] = await file.getFile();
					} else {
						let dir = filehandle as FileSystemDirectoryHandle;
						folderhandles.push(dir);
						for await (let handle of dir.values()) {
							if (handle.kind == "file") {
								files[handle.name] = await handle.getFile();
							}
						}
					}
				} else if (item.kind == "file") {
					let file = item.getAsFile()!;
					files[file.name] = file;
				}
			}));
			if (folderhandles.length == 1 && filehandles.length == 0) {
				datastore.set("cachefilehandles", folderhandles[0]);
				console.log("stored folder " + folderhandles[0].name);
				this.props.onOpen({ type: "sqlitehandle", handle: folderhandles[0] });
			} else {
				console.log(`added ${Object.keys(files).length} files`);
				this.props.onOpen({ type: "sqliteblobs", blobs: files });
			}
		}
	}

	@boundMethod
	openOpenrs2Cache(cachename: string) {
		this.props.onOpen({ type: "openrs2", cachename });
	}

	render() {
		return (
			<React.Fragment>
				<h2>NXT cache</h2>
				<p>Drag a folder containing NXT cache files here in order to keep it.</p>
				<p>Dragging a folder here is the preferred and most supported way to open a cache.</p>
				<h2>Folder picker</h2>
				<p>Due to browser limitations this will not let you open a cache at its default location (drag and drop still works)</p>
				<input type="button" className="sub-btn" onClick={this.clickOpen} value="Open cache" />
				<h2>Historical caches</h2>
				<p>Enter any valid cache id from <a target="_blank" href="https://archive.openrs2.org/">OpenRS2</a></p>
				<StringInput initialid="949" onChange={this.openOpenrs2Cache} />
			</React.Fragment>
		);
	}
}

class App extends React.Component<{}, { renderer: ThreeJsRenderer | null, cache: ThreejsSceneCache | null, needsUserActivation: SavedCacheSource | null }> {
	constructor(p) {
		super(p);
		this.state = {
			cache: null,
			renderer: null,
			needsUserActivation: null
		};
		(async () => {
			let source = await datastore.get<SavedCacheSource>("openedcache");
			if (source) {
				if (source.type == "sqlitehandle" && await source.handle.queryPermission() == "prompt") {
					this.setState({ needsUserActivation: source });
				} else {
					this.openCache(source);
				}
			}
		})();
	}

	@boundMethod
	async openCache(source: SavedCacheSource) {
		let handle: FileSystemDirectoryHandle | null = null;
		let cache: CacheFileSource | null = null;
		if (source.type == "sqliteblobs" || source.type == "sqlitehandle") {
			let files: Record<string, Blob> = {};
			if (source.type == "sqlitehandle") {
				handle = source.handle;
				await source.handle.requestPermission();
				for await (let handle of source.handle.values()) {
					if (handle.kind == "file") {
						files[handle.name] = await handle.getFile();
					}
				}
			} else {
				files = source.blobs;
			}

			cache = new WasmGameCacheLoader();
			(cache as WasmGameCacheLoader).giveBlobs(files);
		}
		if (source.type == "openrs2") {
			cache = new Openrs2CacheSource(source.cachename);
		}
		datastore.set("openedcache", source);
		navigator.serviceWorker.ready.then(q => q.active?.postMessage({ type: "sethandle", handle }));

		if (cache) {
			let engine = await EngineCache.create(cache);
			console.log("engine loaded");

			globalThis.calculateDependencies = () => getDependencies(cache!);
			globalThis.hashCache = () => hashCache(cache!);
			globalThis.runMapRender = () => runMapRender(cache!, "50,50");
			// //TODO remove
			// let source = engine.source;
			// globalThis.loadSkeletons = async function run() {

			// 	let skelindex = await source.getIndexFile(cacheMajors.skeletalAnims);

			// 	let files: Buffer[] = [];
			// 	for (let index of skelindex) {
			// 		if (!index) { continue; }
			// 		if (files.length % 50 == 0) { console.log(files.length); }
			// 		files.push(await source.getFile(index.major, index.minor, index.crc));
			// 	}

			// 	return function* () {
			// 		for (let file of files) {
			// 			yield parseSkeletalAnim.read(file);
			// 		}
			// 	}
			// };

			this.setState({
				cache: new ThreejsSceneCache(engine),
				needsUserActivation: null
			});
		}
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
		this.setState({ cache: null });
	}

	render() {
		return (
			<div id="content">
				<div className="canvas-container">
					<canvas id="viewer" ref={this.initCnv}></canvas>
				</div>
				<div id="sidebar">
					{this.state.cache && <input type="button" className="sub-btn" onClick={this.closeCache} value={`Close ${this.state.cache.source.getCacheName()}`} />}
					{this.state.needsUserActivation && <input type="button" className="sub-btn" onClick={() => this.openCache(this.state.needsUserActivation!)} value="Open last" />}
					{!this.state.cache && (<CacheSelector onOpen={this.openCache} />)}
					{this.state.cache && this.state.renderer && <ModelBrowser cache={this.state.cache} render={this.state.renderer} />}
				</div>
			</div >
		);
	}
}

start();