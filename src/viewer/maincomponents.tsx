
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import { boundMethod } from "autobind-decorator";
import { WasmGameCacheLoader } from "../cache/sqlitewasm";
import { CacheFileSource } from "../cache";
import * as datastore from "idb-keyval";
import { ThreejsSceneCache } from "../3d/modeltothree";
import { StringInput, TabStrip } from "./commoncontrols";
import { Openrs2CacheMeta, Openrs2CacheSource, validOpenrs2Caches } from "../cache/openrs2loader";
import { delay, TypedEmitter } from "../utils";
import { CacheDownloader } from "../cache/downloader";
import * as path from "path";
import { selectFsCache } from "../cache/autocache";
import { CLIScriptFS, ScriptFS } from "../scriptrunner";

//see if we have access to a valid electron import
let electron: typeof import("electron/renderer") | null = (() => {
	try {
		let electron = require("electron/renderer");
		//some enviroments polyfill an empty mock object, this also catches when electron is imported from a main process and exports only a string
		if (electron?.ipcRenderer) {
			return electron;
		}
	} catch (e) { }
	return null;
})();

export type SavedCacheSource = {
	type: string
} & ({
	type: "autohandle",
	handle: FileSystemDirectoryHandle
} | {
	type: "sqliteblobs",
	blobs: Record<string, Blob>
} | {
	type: "openrs2",
	cachename: string
} | {
	type: "autofs",
	location: string,
	writable?: boolean
} | {
	type: "live"
});

export async function downloadBlob(name: string, blob: Blob) {
	let a = document.createElement("a");
	let url = URL.createObjectURL(blob);
	a.download = name;
	a.href = url;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1);
}

/**@deprecated requires a service worker and is pretty sketchy, also no actual streaming output file sources atm */
export async function downloadStream(name: string, stream: ReadableStream) {
	if (!electron && navigator.serviceWorker) {
		let url = new URL(`download_${Math.random() * 10000 | 0}_${name}`, document.location.href).href;
		let sw = await navigator.serviceWorker.ready;
		if (!sw.active) { throw new Error("no service worker"); }
		sw.active.postMessage({ type: "servedata", url, stream }, [stream as any]);
		await delay(100);
		let fr = document.createElement("iframe");
		fr.src = url;
		fr.hidden = true;
		document.body.appendChild(fr);
	} else {
		//TODO
		console.log("TODO");
	}
}

function OpenRs2IdSelector(p: { initialid: number, onSelect: (id: number) => void }) {
	let [relevantcaches, setrelevantcaches] = React.useState<Openrs2CacheMeta[] | null>(null);
	let [loading, setLoading] = React.useState(false);
	let [relevantonly, setrelevantonly] = React.useState(true);
	let [gameFilter, setGameFilter] = React.useState("runescape");
	let [yearFilter, setYearfilter] = React.useState("");
	let [langFilter, setLangfilter] = React.useState("en");

	let openselector = React.useCallback(async () => {
		setLoading(true);
		setrelevantcaches(await validOpenrs2Caches());
	}, []);

	let games: string[] = [];
	let years: string[] = [];
	let langs: string[] = [];
	for (let cache of relevantcaches ?? []) {
		if (cache.timestamp) {
			let year = "" + new Date(cache.timestamp ?? 0).getUTCFullYear();
			if (years.indexOf(year) == -1) { years.push(year); }
		}
		if (games.indexOf(cache.game) == -1) { games.push(cache.game); }
		if (langs.indexOf(cache.language) == -1) { langs.push(cache.language); }
	}

	years.sort((a, b) => (+b) - (+a));

	let showncaches = (relevantcaches ?? []).filter(cache => {
		if (gameFilter && cache.game != gameFilter) { return false; }
		if (langFilter && cache.language != langFilter) { return false; }
		if (yearFilter && new Date(cache.timestamp ?? 0).getUTCFullYear() != +yearFilter) { return false; }
		return true;
	});
	showncaches.sort((a, b) => +new Date(b.timestamp ?? 0) - +new Date(a.timestamp ?? 0));

	let enterCacheId = async (idstring: string) => {
		let id = +idstring;
		// negative id means latest-x cache
		if (id <= 0) { id = (await Openrs2CacheSource.getRecentCache(-id)).id; }
		p.onSelect(id);
	}

	return (
		<React.Fragment>
			<StringInput initialid={p.initialid + ""} onChange={enterCacheId} />
			{!loading && !relevantcaches && <input type="button" className="sub-btn" onClick={openselector} value="More options..." />}
			{relevantcaches && (
				<React.Fragment>
					<div style={{ overflowY: "auto" }}>
						<table>
							<thead>
								<tr>
									<td></td>
									{/* <td>
										<select value={gameFilter} onChange={e => setGameFilter(e.currentTarget.value)}>
											<option value="">Game</option>
											{games.map(game => <option key={game} value={game}>{game}</option>)}
										</select>
									</td> */}
									{/* <td>
										<select value={langFilter} onChange={e => setLangfilter(e.currentTarget.value)}>
											<option value="">--</option>
											{langs.map(lang => <option key={lang} value={lang}>{lang}</option>)}
										</select>
									</td> */}
									<td>
										<select value={yearFilter} onChange={e => setYearfilter(e.currentTarget.value)}>
											<option value="">Date</option>
											{years.map(year => <option key={year} value={year}>{year}</option>)}
										</select>
									</td>
									<td>
										Build
									</td>
								</tr>
							</thead>
							<tbody>
								{showncaches.map(cache => (
									<tr key={cache.language + cache.id}>
										<td><input type="button" value={cache.id} className="sub-btn" onClick={p.onSelect.bind(null, cache.id)} /></td>
										{/* <td>{cache.game}</td> */}
										{/* <td>{cache.language}</td> */}
										<td>{cache.timestamp ? new Date(cache.timestamp).toDateString() : ""}</td>
										<td>{cache.builds.map(q => q.major + (q.minor ? "." + q.minor : "")).join(",")}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</React.Fragment>
			)}
		</React.Fragment>
	)
}

export class CacheSelector extends React.Component<{ onOpen: (c: SavedCacheSource) => void, noReopen?: boolean }, { lastFolderOpen: FileSystemDirectoryHandle | null }> {
	constructor(p) {
		super(p);
		this.state = {
			lastFolderOpen: null
		};

		if (!this.props.noReopen) {
			datastore.get<FileSystemDirectoryHandle>("lastfolderopen").then(f => {
				if (f) { this.setState({ lastFolderOpen: f }); }
			});
		}
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
		this.props.onOpen({ type: "autohandle", handle: dir });
	}

	@boundMethod
	async clickOpenNative() {
		if (!electron) { return; }
		let dir: import("electron").OpenDialogReturnValue = await electron.ipcRenderer.invoke("openfolder", path.resolve(process.env.ProgramData!, "jagex/runescape"));
		if (!dir.canceled) {
			this.props.onOpen({ type: "autofs", location: dir.filePaths[0], writable: !!globalThis.writecache });//TODO propper ui for this
		}
	}

	@boundMethod
	async clickOpenLive() {
		this.props.onOpen({ type: "live" });
	}

	@boundMethod
	async clickReopen() {
		if (!this.state.lastFolderOpen) { return; }
		if (await this.state.lastFolderOpen.requestPermission() == "granted") {
			this.props.onOpen({ type: "autohandle", handle: this.state.lastFolderOpen });
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
				this.props.onOpen({ type: "autohandle", handle: folderhandles[0] });
			} else {
				console.log(`added ${Object.keys(files).length} files`);
				this.props.onOpen({ type: "sqliteblobs", blobs: files });
			}
		}
	}

	@boundMethod
	openOpenrs2Cache(cachename: number) {
		this.props.onOpen({ type: "openrs2", cachename: cachename + "" });
	}

	render() {
		return (
			<React.Fragment>
				{electron && (
					<React.Fragment>
						<h2>Native local RS3 cache</h2>
						<p>Only works when running in electron</p>
						<input type="button" className="sub-btn" onClick={this.clickOpenNative} value="Open native cache" />
					</React.Fragment>
				)}
				{electron && (
					<React.Fragment>
						<h2>Jagex Servers</h2>
						<p>Download directly from content servers. Only works when running in electron</p>
						<input type="button" className="sub-btn" onClick={this.clickOpenLive} value="Stream from Jagex" />
					</React.Fragment>
				)}
				<h2>Local Cache</h2>
				<CacheDragNDropHelp />
				{!this.props.noReopen && this.state.lastFolderOpen && <input type="button" className="sub-btn" onClick={this.clickReopen} value={`Reopen ${this.state.lastFolderOpen.name}`} />}
				<h2>Historical caches</h2>
				<p>Enter any valid cache id from <a target="_blank" href="https://archive.openrs2.org/">OpenRS2</a>. Entering 0 will load the latest RS3 cache, negative values will load previous caches.</p>
				<OpenRs2IdSelector initialid={0} onSelect={this.openOpenrs2Cache} />
			</React.Fragment>
		);
	}
}

function CacheDragNDropHelp() {
	const canfsapi = typeof FileSystemHandle != "undefined"
	let [open, setOpen] = React.useState(false);
	let [mode, setmode] = React.useState<"fsapi" | "blob">(canfsapi ? "fsapi" : "blob");

	return (
		<React.Fragment>
			<p>
				{canfsapi && "Drag a folder containing the RS3 cache files here in order to view it."}
				{!canfsapi && "Drag the RS3 cache files you wish to view"}
				<a style={{ float: "right" }} onClick={e => setOpen(!open)}>{!open ? "More info" : "Close"}</a>
			</p>
			{open && (
				<div style={{ display: "flex", flexDirection: "column" }}>
					<TabStrip value={mode} tabs={{ fsapi: "Full folder", blob: "Files" }} onChange={setmode as any} />
					{mode == "fsapi" && (
						<React.Fragment>
							{!canfsapi && <p className="mv-errortext">You browser does not support full folder loading!</p>}
							<p>Drop the RuneScape folder into this window.</p>
							<input type="text" onFocus={e => e.target.select()} readOnly value={"C:\\ProgramData\\Jagex"} />
							<video src={new URL("../assets/dragndrop.mp4", import.meta.url).href} autoPlay loop style={{ aspectRatio: "352/292" }} />
						</React.Fragment>
					)}
					{mode == "blob" && (
						<React.Fragment>
							<p>Drop and drop the cache files into this window.</p>
							<input type="text" onFocus={e => e.target.select()} readOnly value={"C:\\ProgramData\\Jagex"} />
							<video src={new URL("../assets/dragndropblob.mp4", import.meta.url).href} autoPlay loop style={{ aspectRatio: "458/380" }} />
						</React.Fragment>
					)}
				</div>
			)}
		</React.Fragment>
	);
}

export type UIOpenedFile = { fs: ScriptFS, name: string, data: string | Buffer };
export type RenderableContext = { source: CacheFileSource, sceneCache: ThreejsSceneCache, renderer: ThreeJsRenderer };

export class UIContext extends TypedEmitter<{ openfile: UIOpenedFile | null, statechange: undefined }> {
	source: CacheFileSource | null = null;
	sceneCache: ThreejsSceneCache | null = null;
	renderer: ThreeJsRenderer | null = null;
	openedfile: UIOpenedFile | null = null;
	renderable: RenderableContext | null = null;
	rootElement: HTMLElement;
	useServiceWorker: boolean;

	constructor(rootelement: HTMLElement, useServiceWorker: boolean) {
		super();
		this.rootElement = rootelement;
		this.useServiceWorker = useServiceWorker;

		if (useServiceWorker) {
			//this service worker holds a reference to the cache fs handle which will keep the handles valid 
			//across tab reloads
			navigator.serviceWorker?.register(new URL('../assets/contextholder.js', import.meta.url).href, { scope: './', });
		}
	}

	fixRenderable() {
		let canrender = this.canRender();
		if (canrender && (!this.renderable || this.renderable.source !== this.source || this.renderable.sceneCache !== this.sceneCache || this.renderable.renderer !== this.renderer)) {
			this.renderable = {
				source: this.source!,
				sceneCache: this.sceneCache!,
				renderer: this.renderer!
			};
			this.emit("statechange", undefined);
		} else if (!canrender && this.renderable) {
			this.renderable = null;
			this.emit("statechange", undefined);
		}
	}

	setCacheSource(source: CacheFileSource | null) {
		this.source = source;
		this.emit("statechange", undefined);
		this.fixRenderable();
	}

	setSceneCache(sceneCache: ThreejsSceneCache | null) {
		this.sceneCache = sceneCache;
		this.emit("statechange", undefined);
		this.fixRenderable();
	}

	setRenderer(renderer: ThreeJsRenderer | null) {
		this.renderer = renderer;
		this.emit("statechange", undefined);
		this.fixRenderable();
	}

	canRender(): boolean {
		return !!this.source && !!this.sceneCache && !!this.renderer;
	}

	@boundMethod
	openFile(file: UIOpenedFile | null) {
		this.openedfile = file;
		this.emit("openfile", file);
	}
}

export const UIRootContext = React.createContext<UIContext>(null!);
export const UIEngineContext = React.createContext<RenderableContext | null>(null);

export async function openSavedCache(source: SavedCacheSource, remember: boolean) {
	let cache: CacheFileSource | null = null;
	if (source.type == "sqliteblobs" || source.type == "autohandle") {
		if (source.type == "autohandle") {
			let perm = await source.handle.queryPermission({ mode: "read" });
			if (perm == "granted") {
				let wasmcache = new WasmGameCacheLoader();
				// let fs = new UIScriptFS(null);
				// await fs.setSaveDirHandle(source.handle);
				// cache = await selectFsCache(fs);
				await wasmcache.giveFsDirectory(source.handle);
				navigator.serviceWorker?.ready.then(q => q.active?.postMessage({ type: "sethandle", handle: source.handle }));
				cache = wasmcache;
			}
		} else {
			let wasmcache = new WasmGameCacheLoader();
			wasmcache.giveBlobs(source.blobs);
			cache = wasmcache;
		}
	}
	if (source.type == "openrs2") {
		cache = await Openrs2CacheSource.fromId(+source.cachename);
	}
	if (electron && source.type == "autofs") {
		let fs = new CLIScriptFS(source.location);
		cache = await selectFsCache(fs, { writable: source.writable });
	}
	if (source.type == "live") {
		cache = new CacheDownloader();
	}
	if (remember) {
		datastore.set("openedcache", source);
		localStorage.rsmv_openedcache = JSON.stringify(source);
	}
	return cache;
}