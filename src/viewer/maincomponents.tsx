
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import { boundMethod } from "autobind-decorator";
import { WasmGameCacheLoader } from "../cache/sqlitewasm";
import { CacheFileSource, getCacheVersionFingerprint } from "../cache";
import * as datastore from "idb-keyval";
import { EngineCache, ThreejsSceneCache } from "../3d/modeltothree";
import { StringInput, TabStrip, useAwaited } from "./commoncontrols";
import { Openrs2CacheSource, validOpenrs2Caches } from "../cache/openrs2loader";
import { delay, TypedEmitter } from "../utils";
import { CacheDownloader } from "../cache/downloader";
import * as path from "path";
import { selectFsCache } from "../cache/autocache";
import { CLIScriptFS, ScriptFS } from "../scriptrunner";
import { GameCacheLoader } from "../headless/api";
import { multitabManager } from "./multitab";

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
	blobs: Record<string, File>
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

function OpenRs2IdSelector(p: { initialid: number, onSelect: (id: number) => void }) {
	let [advanced, setAdvanced] = React.useState(false);
	let [yearFilter, setYearfilter] = React.useState("");
	let [gameFilter, setGameFilter] = React.useState("runescape");
	let [envFilter, setEnvfilter] = React.useState("live");
	let [langFilter, setLangfilter] = React.useState("en");

	let relevantCaches = useAwaited(() => {
		if (!advanced) { return null; }
		return (async () => {
			let relevantcaches = await validOpenrs2Caches("", "");
			let games: string[] = [];
			let years: string[] = [];
			let langs: string[] = [];
			let envs: string[] = [];
			for (let cache of relevantcaches) {
				if (cache.timestamp) {
					let year = "" + new Date(cache.timestamp ?? 0).getUTCFullYear();
					if (years.indexOf(year) == -1) { years.push(year); }
				}
				if (games.indexOf(cache.game) == -1) { games.push(cache.game); }
				if (langs.indexOf(cache.language) == -1) { langs.push(cache.language); }
				if (envs.indexOf(cache.environment) == -1) { envs.push(cache.environment); }
			}

			years.sort((a, b) => (+b) - (+a));

			let showncaches = relevantcaches.filter(cache => {
				if (gameFilter && cache.game != gameFilter) { return false; }
				if (langFilter && cache.language != langFilter) { return false; }
				if (envFilter && cache.environment != envFilter) { return false; }
				if (yearFilter && new Date(cache.timestamp ?? 0).getUTCFullYear() != +yearFilter) { return false; }
				return true;
			});
			showncaches.sort((a, b) => +new Date(b.timestamp ?? 0) - +new Date(a.timestamp ?? 0));

			return { games, years, langs, envs, showncaches };
		})();
	}, [envFilter, langFilter, gameFilter, yearFilter, advanced], 200);

	let enterCacheId = async (idstring: string) => {
		let id = +idstring;
		// negative id means latest-x cache
		if (id <= 0) { id = (await Openrs2CacheSource.getRecentCache(-id)).id; }
		p.onSelect(id);
	}

	let dateformat = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	return (
		<React.Fragment>
			<StringInput initialid={p.initialid + ""} onChange={enterCacheId} />
			{!advanced && <input type="button" className="sub-btn" onClick={() => setAdvanced(true)} value="More options..." />}
			{relevantCaches && (
				<React.Fragment>
					<div style={{ overflowY: "auto", display: "grid", gridTemplateColumns: "max-content max-content minmax(0,1fr) minmax(0,1fr)", gap: "2px", overflowX: "hidden" }}>
						<div className="mv-gridrow">
							<div />
							{/* <td>
								<select value={gameFilter} onChange={e => setGameFilter(e.currentTarget.value)}>
									<option value="">Game</option>
									{relevantCaches.games.map(game => <option key={game} value={game}>{game}</option>)}
								</select>
							</td> */}
							<select value={yearFilter} onChange={e => setYearfilter(e.currentTarget.value)}>
								<option value="">Date</option>
								{relevantCaches.years.map(year => <option key={year} value={year}>{year}</option>)}
							</select>
							<div>
								Build
							</div>
							{/* <select value={langFilter} onChange={e => setLangfilter(e.currentTarget.value)}>
								<option value="">--</option>
								{relevantCaches.langs.map(lang => <option key={lang} value={lang}>{lang}</option>)}
							</select> */}
							<select value={envFilter} onChange={e => setEnvfilter(e.currentTarget.value)}>
								<option value="">--</option>
								{relevantCaches.envs.map(env => <option key={env} value={env}>{env}</option>)}
							</select>
						</div>

						{relevantCaches.showncaches.map(cache => (
							<div className="mv-gridrow" key={cache.language + cache.id}>
								<div><input type="button" value={cache.id} className="sub-btn" onClick={p.onSelect.bind(null, cache.id)} /></div>
								{/* <div>{cache.game}</div> */}
								<div>{cache.timestamp ? dateformat.format(new Date(cache.timestamp)) : ""}</div>
								<div>{cache.builds.map(q => q.major + (q.minor ? "." + q.minor : "")).join(",")}</div>
								{/* <div>{cache.language}</div> */}
								<div>{cache.environment}</div>
							</div>
						))}
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
			let files: Record<string, File> = {};
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
					{/* chrome started blocking runescapes cache folder as its a "system file" */}
					{/* <TabStrip value={mode} tabs={{ fsapi: "Full folder", blob: "Files" }} onChange={setmode as any} /> */}
					{/* {mode == "fsapi" && (
						<React.Fragment>
							{!canfsapi && <p className="mv-errortext">You browser does not support full folder loading!</p>}
							<p>Drop the RuneScape folder into this window.</p>
							<input type="text" onFocus={e => e.target.select()} readOnly value={"C:\\ProgramData\\Jagex"} />
							<video src={new URL("../assets/dragndrop.mp4", import.meta.url).href} autoPlay loop style={{ aspectRatio: "352/292" }} />
						</React.Fragment>
					)}
					{mode == "blob" && ( */}
						<React.Fragment>
							<p>Drop and drop the cache files into this window.</p>
							<input type="text" onFocus={e => e.target.select()} readOnly value={"C:\\ProgramData\\Jagex"} />
							<video src={new URL("../assets/dragndropblob.mp4", import.meta.url).href} autoPlay loop style={{ aspectRatio: "458/380" }} />
						</React.Fragment>
					{/* )} */}
				</div>
			)}
		</React.Fragment>
	);
}

export type UIOpenedFile = {
	type: "file",
	fs: ScriptFS,
	name: string,
	data: string | Buffer
};

export type BrowsePageId = {
	type: "browse",
	id: string
}

export type Toplevel3DView = {
	type: "view3d",
	id: string
}

export type UIOpenedTab = Toplevel3DView | BrowsePageId | UIOpenedFile;

export type RenderableContext = { source: CacheFileSource, sceneCache: ThreejsSceneCache, renderer: ThreeJsRenderer };

export class UIContext extends TypedEmitter<{ showTab: UIOpenedTab | null, statechange: undefined }> {
	source: CacheFileSource | null = null;
	sourceIdentifier: string | null = null;
	sceneCache: ThreejsSceneCache | null = null;
	renderer: ThreeJsRenderer | null = null;
	openedTabs: UIOpenedTab[] = [];
	activeTabIndex = -1;
	renderable: RenderableContext | null = null;
	rootElement: HTMLElement;
	useServiceWorker: boolean;

	multitab = multitabManager(this);

	constructor(rootelement: HTMLElement, useServiceWorker: boolean) {
		super();
		this.rootElement = rootelement;
		this.useServiceWorker = useServiceWorker;

		if (useServiceWorker) {
			//this service worker holds a reference to the cache fs handle which will keep the handles valid
			//across tab reloads
			// this functionality is broken since chrome no longer allows fs access on rs cache files since they are in a "system folder" (AppData)
			// don't use webpack to bundle the service worker, it will place it in the wrong folder and its plain js anyway
			// navigator.serviceWorker?.register("contextholder.js", { scope: './', });
		}

		navigation.addEventListener("navigate", this.onNavigate);
		this.setStateFromUrl(new URL(document.location.href));
	}

	close() {
		this.source?.close();
		this.multitab.close();
		navigation.removeEventListener("navigate", this.onNavigate);
	}

	@boundMethod
	async openCache(source: SavedCacheSource) {
		let cache = await openSavedCache(source, true);
		if (cache) {
			globalThis.source = cache;
			this.source = cache;
			this.sourceIdentifier = await getCacheIdentifier(cache);

			try {
				let engine = await EngineCache.create(cache);
				console.log("engine loaded", cache.getBuildNr());
				let scene = await ThreejsSceneCache.create(engine);
				this.sceneCache = scene;

				globalThis.sceneCache = scene;
				globalThis.engine = engine;
				globalThis.reloadCache = () => this.openCache(source);
			} catch (e) {
				console.log("failed to create scenecache");
				console.error(e);
			}
			this.fixRenderable();
			this.emit("statechange", undefined);
			this.fixUrl();
		}
	}

	@boundMethod
	closeCache() {
		datastore.del("openedcache");
		localStorage.rsmv_openedcache = "";
		navigator.serviceWorker?.ready.then(q => q.active?.postMessage({ type: "sethandle", handle: null }));
		this.source?.close();
		this.sceneCache = null;
		this.source = null;
		this.sourceIdentifier = null;
		this.fixRenderable();
		this.emit("statechange", undefined);
		this.fixUrl();
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

	setRenderer(renderer: ThreeJsRenderer | null) {
		this.renderer = renderer;
		this.emit("statechange", undefined);
		this.fixRenderable();
	}

	canRender(): boolean {
		return !!this.source && !!this.sceneCache && !!this.renderer;
	}

	setStateFromUrl(url: URL) {
		let target: UIOpenedTab | null = null;

		if (url.searchParams.has("cache")) {
			let cacheidentifier = url.searchParams.get("cache")!;
			if (this.sourceIdentifier != cacheidentifier) {
				let parsed = parseCacheIdentifier(cacheidentifier);
				if (parsed) {
					if (parsed.type == "live") {
						this.openCache({ type: "live" });
					} else if (parsed.type == "openrs2") {
						this.openCache({ type: "openrs2", cachename: parsed.id + "" });
					} else if (parsed.type == "fs") {
						this.openCache({ type: "autofs", location: parsed.location });
					} else if (parsed.type == "blobs") {
						this.multitab.findblobs(cacheidentifier).then(blobs => {
							if (blobs) {
								this.openCache({ type: "sqliteblobs", blobs: blobs });
							}
						});
					}
				}
			}
		}

		if (url.searchParams.has("browse")) {
			target = { type: "browse", id: url.searchParams.get("browse")! };
		} else if (url.searchParams.has("view3d")) {
			target = { type: "view3d", id: url.searchParams.get("view3d")! };
		} else if (url.searchParams.has("file")) {
			// return { type: "file", name: params.get("file")!, fs: null! };//data and fs will be filled in later
		}
		console.log(`history triggered to ${target?.type} ${(target as any)?.id}`);
		this.openFile(target, false, true);
		return target;
	}

	@boundMethod
	onNavigate(e: NavigateEvent) {
		if (!e.canIntercept) { return; }

		if (this.isNavigating) {
			e.intercept({ focusReset: "manual" });
		} else {
			// preven't reuse of our new url if the navigation was manual
			this.lastPushTime = 0;
			this.setStateFromUrl(new URL(e.destination.url));
		}
	}

	lastPushTime = 0;
	isNavigating = false;
	fixUrl() {
		let tab = (this.activeTabIndex != -1 ? this.openedTabs[this.activeTabIndex] : null);
		let now = Date.now();
		let navigatable = true;
		let url = new URL(document.location.href);

		// cache
		if (this.source && this.sourceIdentifier) {
			url.searchParams.set("cache", this.sourceIdentifier);
		} else {
			url.searchParams.delete("cache");
		}

		// visible tab
		if (!tab) {
			url.searchParams.delete("browse");
		} else if (tab.type == "browse") {
			url.searchParams.set("browse", tab.id);
		} else if (tab.type == "view3d") {
			url.searchParams.set("view3d", tab.id);
		} else if (tab.type == "file") {
			navigatable = false;
			// url = `?file=${encodeURIComponent(tab.name)}`;
		}

		if (navigatable && url.href != document.location.href) {
			this.isNavigating = true;
			// only push to history if the last page was shown more than 1 second
			let dopush = now - this.lastPushTime > 1000;
			this.lastPushTime = now;
			try {
				navigation.navigate(url, { history: (dopush ? "push" : "replace"), state: { target: tab } });
			} finally {
				this.isNavigating = false;
			}
		}
	}

	@boundMethod
	openFile(tab: UIOpenedTab | null, newtab = false, isHistoryNavigation = false) {
		let tabindex = this.activeTabIndex;
		if (tabindex == -1) {
			tabindex = 0;
			newtab = true;
		}
		if (tab) {
			this.openedTabs.splice(tabindex, (newtab ? 0 : 1), tab);
		} else {
			this.openedTabs.splice(tabindex, 1);
		}
		this.activeTabIndex = tabindex;
		this.emit("showTab", tab);
		if (!isHistoryNavigation) {
			this.fixUrl();
		}
	}
}

export const UIRootContext = React.createContext<UIContext>(null!);
export const UIEngineContext = React.createContext<RenderableContext | null>(null);

export function parseCacheIdentifier(cacheidentifier: string) {
	let parts = cacheidentifier.split("-");
	let type = parts.shift()!;
	if (type == "upload") {
		let args = parts.join("-");
		if (args.match(/^\d+$/)) {
			return { type: "blobs", version: +args } as const;
		} else {
			let date = new Date(args.replace(/-/g, " "));
			if (!isNaN(+date)) {
				return { type: "blobs", version: +date / 1000 } as const;
			}
		}
		return null;
	}
	if (type == "openrs2") {
		let id = parts.shift();
		if (id && id.match(/^\d+$/)) {
			return { type: "openrs2", id: +id } as const;
		}
		return null;
	}
	if (type == "fs") {
		return { type: "fs", location: parts.join("-") } as const;
	}
	if (type == "live") {
		return { type: "live" } as const;
	}
	return null;
}

export async function getCacheIdentifier(cache: CacheFileSource) {
	if (cache instanceof WasmGameCacheLoader) {
		let version = await getCacheVersionFingerprint(cache);
		if (version > +new Date(2000, 0) / 1000) {
			let cachedate = new Date(version * 1000);
			let datetext = cachedate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");
			return `upload-${datetext}`;
		} else {
			return `upload-${version}`;
		}
	}
	if (cache instanceof Openrs2CacheSource) {
		return `openrs2-${cache.meta.id}`;
	}
	if (cache instanceof CacheDownloader) {
		return `live`;
	}
	if (cache instanceof GameCacheLoader) {
		return `fs-${cache.cachedir}`;
	}
	return null;
}

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
				// navigator.serviceWorker?.ready.then(q => q.active?.postMessage({ type: "sethandle", handle: source.handle }));
				cache = wasmcache;
			}
		} else {
			// Files don't survive json round-trip, but i believe they might have survived indexeddb round-trip
			if (Object.values(source.blobs).every(q => q instanceof File)) {
				let wasmcache = new WasmGameCacheLoader();
				wasmcache.giveBlobs(source.blobs);
				cache = wasmcache;
			}
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
		// globalThis.cachewrite = datastore.set("openedcache", source);
		localStorage.rsmv_openedcache = JSON.stringify(source);
	}
	return cache;
}