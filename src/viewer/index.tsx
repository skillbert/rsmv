
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import * as ReactDOM from "react-dom";
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
import { GameCacheLoader } from "../cache/sqlite";

import type { OpenDialogReturnValue } from "electron/renderer";

const electron = (typeof __non_webpack_require__ != "undefined" ? (__non_webpack_require__("electron/renderer") as typeof import("electron/renderer")) : null);

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
} | {
	type: "sqlitenodejs",
	location: string
});

class CacheSelector extends React.Component<{ savedSource?: SavedCacheSource, onOpen: (c: SavedCacheSource) => void }, { lastFolderOpen: FileSystemDirectoryHandle | null }>{
	constructor(p) {
		super(p);
		this.state = {
			lastFolderOpen: null
		};

		datastore.get<FileSystemDirectoryHandle>("lastfolderopen").then(f => {
			if (f) { this.setState({ lastFolderOpen: f }); }
		});
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
	async clickOpenNative() {
		if (!electron) { return; }
		let dir: OpenDialogReturnValue = await electron.ipcRenderer.invoke("openfolder", "%programdata%/jagex/runescape/");
		if (!dir.canceled) {
			this.props.onOpen({ type: "sqlitenodejs", location: dir.filePaths[0] });
		}
	}

	@boundMethod
	async clickReopen() {
		if (!this.state.lastFolderOpen) { return; }
		if (await this.state.lastFolderOpen.requestPermission() == "granted") {
			this.props.onOpen({ type: "sqlitehandle", handle: this.state.lastFolderOpen });
		}
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
				console.log("stored folder " + folderhandles[0].name);
				datastore.set("lastfolderopen", folderhandles[0]);
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
				{this.state.lastFolderOpen && <input type="button" className="sub-btn" onClick={this.clickReopen} value={`Reopen ${this.state.lastFolderOpen.name}`} />}
				<h2>Folder picker</h2>
				<p>Due to browser limitations this will not let you open a cache at its default location (drag and drop still works)</p>
				<input type="button" className="sub-btn" onClick={this.clickOpen} value="Select folder" />
				<h2>Historical caches</h2>
				<p>Enter any valid cache id from <a target="_blank" href="https://archive.openrs2.org/">OpenRS2</a></p>
				<StringInput initialid="949" onChange={this.openOpenrs2Cache} />
				{electron && (
					<React.Fragment>
						<h2>Native NXT cache</h2>
						<p>Only works when running in electron</p>
						<input type="button" className="sub-btn" onClick={this.clickOpenNative} value="Open native cace" />
					</React.Fragment>
				)}
			</React.Fragment>
		);
	}
}

class App extends React.Component<{}, { renderer: ThreeJsRenderer | null, cache: ThreejsSceneCache | null }> {
	constructor(p) {
		super(p);
		this.state = {
			cache: null,
			renderer: null
		};
		(async () => {
			let source = await datastore.get<SavedCacheSource>("openedcache");
			if (source) {
				if (source.type == "sqlitehandle" && await source.handle.queryPermission() == "prompt") {
					//do nothing
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
		if (electron && source.type == "sqlitenodejs") {
			cache = new GameCacheLoader(source.location);
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
				cache: new ThreejsSceneCache(engine)
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
		this.state.cache?.close();
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
					{!this.state.cache && (<CacheSelector onOpen={this.openCache} />)}
					{this.state.cache && this.state.renderer && <ModelBrowser cache={this.state.cache} render={this.state.renderer} />}
				</div>
			</div >
		);
	}
}

start();