
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { boundMethod } from "autobind-decorator";
import { WasmGameCacheLoader } from "../cache/sqlitewasm";
import { CacheFileSource, cachingFileSourceMixin } from "../cache";
import * as datastore from "idb-keyval";
import { EngineCache, ob3ModelToThreejsNode, ThreejsSceneCache } from "../3d/ob3tothree";
import { ModelBrowser, StringInput } from "./scenenodes";
import { Openrs2CacheMeta, Openrs2CacheSource } from "../cache/openrs2loader";
import { GameCacheLoader } from "../cache/sqlite";

import type { OpenDialogReturnValue } from "electron/renderer";
import { UIScriptFile } from "./scriptsui";
import { DecodeErrorJson } from "../scripts/testdecode";
import prettyJson from "json-stringify-pretty-compact";
import { TypedEmitter } from "../utils";

const electron = (() => {
	try {
		if (typeof __non_webpack_require__ != "undefined") {
			return __non_webpack_require__("electron/renderer") as typeof import("electron/renderer");
		}
	} catch (e) { }
	return null;
})();

export type SavedCacheSource = {
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


function OpenRs2IdSelector(p: { initialid: number, onSelect: (id: number) => void }) {
	let [caches, setCaches] = React.useState<Openrs2CacheMeta[] | null>(null);
	let [loading, setLoading] = React.useState(false);
	let [gameFilter, setGameFilter] = React.useState("runescape");
	let [yearFilter, setYearfilter] = React.useState("");
	let [langFilter, setLangfilter] = React.useState("en");

	let loadcaches = React.useCallback(() => {
		setLoading(true);
		Openrs2CacheSource.getCacheIds().then(setCaches);
	}, []);


	let games: string[] = [];
	let years: string[] = [];
	let langs: string[] = [];
	for (let cache of caches ?? []) {
		if (cache.timestamp) {
			let year = "" + new Date(cache.timestamp ?? 0).getUTCFullYear();
			if (years.indexOf(year) == -1) { years.push(year); }
		}
		if (games.indexOf(cache.game) == -1) { games.push(cache.game); }
		if (langs.indexOf(cache.language) == -1) { langs.push(cache.language); }
	}

	years.sort((a, b) => (+a) - (+b));

	let showncaches = (caches ?? []).filter(cache => {
		if (gameFilter && cache.game != gameFilter) { return false; }
		if (langFilter && cache.language != langFilter) { return false; }
		if (yearFilter && new Date(cache.timestamp ?? 0).getUTCFullYear() != +yearFilter) { return false; }
		return true;
	});
	showncaches.sort((a, b) => +new Date(a.timestamp ?? 0) - +new Date(b.timestamp ?? 0));
	return (
		<React.Fragment>
			<StringInput initialid={p.initialid + ""} onChange={v => p.onSelect(+v)} />
			{!loading && !caches && <input type="button" className="sub-btn" onClick={loadcaches} value="More options..." />}
			{caches && (
				<React.Fragment>
					<div style={{ overflowY: "auto" }}>
						<table>
							<thead>
								<tr>
									<td></td>
									<td>
										<select value={gameFilter} onChange={e => setGameFilter(e.currentTarget.value)}>
											<option value="">Game</option>
											{games.map(game => <option key={game} value={game}>{game}</option>)}
										</select>
									</td>
									<td>
										<select value={langFilter} onChange={e => setLangfilter(e.currentTarget.value)}>
											<option value="">--</option>
											{langs.map(lang => <option key={lang} value={lang}>{lang}</option>)}
										</select>
									</td>
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
										<td><input type="button" value="-" className="sub-btn" onClick={p.onSelect.bind(null, cache.id)} /></td>
										<td>{cache.game}</td>
										<td>{cache.language}</td>
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

export class CacheSelector extends React.Component<{ savedSource?: SavedCacheSource, onOpen: (c: SavedCacheSource) => void }, { lastFolderOpen: FileSystemDirectoryHandle | null }>{
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
	openOpenrs2Cache(cachename: number) {
		this.props.onOpen({ type: "openrs2", cachename: cachename + "" });
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
				<OpenRs2IdSelector initialid={949} onSelect={this.openOpenrs2Cache} />
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

export type UIContextReady = UIContext & { source: CacheFileSource, sceneCache: ThreejsSceneCache, renderer: ThreeJsRenderer };

//i should figure out this redux thing...
export class UIContext extends TypedEmitter<{ openfile: UIScriptFile | null, statechange: undefined }>{
	source: CacheFileSource | null;
	sceneCache: ThreejsSceneCache | null;
	renderer: ThreeJsRenderer | null;

	constructor() {
		super();
	}

	setCacheSource(source: CacheFileSource | null) {
		this.source = source;
		this.emit("statechange", undefined)
	}

	setSceneCache(sceneCache: ThreejsSceneCache | null) {
		this.sceneCache = sceneCache;
		this.emit("statechange", undefined)
	}

	setRenderer(renderer: ThreeJsRenderer | null) {
		this.renderer = renderer;
		this.emit("statechange", undefined);
	}

	canRender(): this is UIContextReady {
		return !!this.source && !!this.sceneCache && !!this.renderer;
	}


	@boundMethod
	openFile(file: UIScriptFile | null) {
		this.emit("openfile", file);
	}
}


export async function openSavedCache(source: SavedCacheSource, remember: boolean) {
	let handle: FileSystemDirectoryHandle | null = null;
	let cache: CacheFileSource | null = null;
	if (source.type == "sqliteblobs" || source.type == "sqlitehandle") {
		let files: Record<string, Blob> = {};
		if (source.type == "sqlitehandle") {
			handle = source.handle;
			if (await source.handle.queryPermission() != "granted") {
				console.log("tried to open cache without permission");
				return null;
			}
			// await source.handle.requestPermission();
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
	if (remember) {
		datastore.set("openedcache", source);
		navigator.serviceWorker.ready.then(q => q.active?.postMessage({ type: "sethandle", handle }));
	}
	return cache;
}


function bufToHexView(buf: Buffer) {
	let resulthex = "";
	let resultchrs = "";

	let linesize = 16;
	let groupsize = 8;

	outer: for (let lineindex = 0; ; lineindex += linesize) {
		if (lineindex != 0) {
			resulthex += "\n";
			resultchrs += "\n";
		}
		for (let groupindex = 0; groupindex < linesize; groupindex += groupsize) {
			if (groupindex != 0) {
				resulthex += "  ";
				resultchrs += " ";
			}
			for (let chrindex = 0; chrindex < groupsize; chrindex++) {
				let i = lineindex + groupindex + chrindex;
				if (i >= buf.length) { break outer; }
				let byte = buf[i];

				if (chrindex != 0) { resulthex += " "; }
				resulthex += byte.toString(16).padStart(2, "0");
				resultchrs += (byte < 0x20 ? "." : String.fromCharCode(byte));
			}
		}
	}
	return { resulthex, resultchrs };
}

function TrivialHexViewer(p: { data: Buffer }) {
	let { resulthex, resultchrs } = bufToHexView(p.data);
	return (
		<table>
			<tbody>
				<tr>
					<td style={{ whiteSpace: "pre", userSelect: "initial", fontFamily: "monospace" }}>{resulthex}</td>
					<td style={{ whiteSpace: "pre", userSelect: "initial", fontFamily: "monospace" }}>{resultchrs}</td>
				</tr>
			</tbody>
		</table>
	)
}

function FileDecodeErrorViewer(p: { file: string }) {
	let err: DecodeErrorJson = JSON.parse(p.file);
	let remainder = Buffer.from(err.remainder, "hex");
	let remainderhex = bufToHexView(remainder);
	return (
		<div style={{ whiteSpace: "pre", userSelect: "initial", fontFamily: "monospace" }}>
			{err.error}
			<div>Chunks</div>
			<table>
				<tbody>
					{err.chunks.map((q, i) => {
						let hexview = bufToHexView(Buffer.from(q.bytes, "hex"));
						return (
							<tr key={q.offset + "-" + i}>
								<td>{hexview.resulthex}</td>
								<td>{hexview.resultchrs}</td>
								<td>{q.text}</td>
							</tr>
						);
					})}
					<tr>
						<td>{remainderhex.resulthex}</td>
						<td>{remainderhex.resultchrs}</td>
						<td>remainder: {remainder.byteLength}</td>
					</tr>
				</tbody>
			</table>
			<div>State</div>
			{prettyJson(err.state)}
		</div>
	);
}

function SimpleTextViewer(p: { file: string }) {
	return (
		<div style={{ whiteSpace: "pre", userSelect: "initial", fontFamily: "monospace" }}>
			{p.file}
		</div>
	);
}

export function FileViewer(p: { file: UIScriptFile, onSelectFile: (f: UIScriptFile | null) => void }) {
	let el: React.ReactNode = null;
	let filedata = p.file.data;
	if (typeof filedata == "string") {
		if (p.file.type == "filedecodeerror") {
			el = <FileDecodeErrorViewer file={filedata} />;
		} else {
			el = <SimpleTextViewer file={filedata} />;
		}
	} else {
		el = <TrivialHexViewer data={filedata} />
	}

	return (
		<div style={{ overflow: "auto" }}>
			<div>{p.file.name} - {p.file.type ?? "no type"} <span onClick={e => p.onSelectFile(null)}>x</span></div>
			{el}
		</div>
	);
}

