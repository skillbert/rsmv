
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import { boundMethod } from "autobind-decorator";
import { WasmGameCacheLoader } from "../cache/sqlitewasm";
import { CacheFileSource, CallbackCacheLoader } from "../cache";
import * as datastore from "idb-keyval";
import { EngineCache, ThreejsSceneCache } from "../3d/modeltothree";
import { InputCommitted, StringInput, JsonDisplay, IdInput, LabeledInput, TabStrip, CanvasView, BlobImage, BlobAudio, CopyButton } from "./commoncontrols";
import { Openrs2CacheMeta, Openrs2CacheSource, validOpenrs2Caches } from "../cache/openrs2loader";
import { GameCacheLoader } from "../cache/sqlite";
import { DomWrap, UIScriptFile } from "./scriptsui";
import { DecodeErrorJson } from "../scripts/testdecode";
import prettyJson from "json-stringify-pretty-compact";
import { delay, TypedEmitter } from "../utils";
import { ParsedTexture } from "../3d/textures";
import { CacheDownloader } from "../cache/downloader";
import { parse } from "../opdecoder";
import * as path from "path";
import classNames from "classnames";
import { selectFsCache } from "../cache/autocache";
import { CLIScriptFS } from "../scriptrunner";
import { drawTexture } from "../imgutils";
import { RsUIViewer } from "./rsuiviewer";

//work around typescript being weird when compiling for browser
const electron = require("electron/renderer");
const hasElectrion = !!electron.ipcRenderer;

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
	if (!hasElectrion) {
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
		if (id > 0) {
			p.onSelect(id);
		} else {
			let relevantcaches = await validOpenrs2Caches();
			p.onSelect(relevantcaches[-id].id);
		}
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

export class CacheSelector extends React.Component<{ onOpen: (c: SavedCacheSource) => void, noReopen?: boolean }, { lastFolderOpen: FileSystemDirectoryHandle | null }>{
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
		if (!hasElectrion) { return; }
		let dir = await electron.ipcRenderer.invoke("openfolder", path.resolve(process.env.ProgramData!, "jagex/runescape"));
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
				{hasElectrion && (
					<React.Fragment>
						<h2>Native local RS3 cache</h2>
						<p>Only works when running in electron</p>
						<input type="button" className="sub-btn" onClick={this.clickOpenNative} value="Open native cache" />
					</React.Fragment>
				)}
				{hasElectrion && (
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

export type UIContextReady = UIContext & { source: CacheFileSource, sceneCache: ThreejsSceneCache, renderer: ThreeJsRenderer };

//i should figure out this redux thing...
export class UIContext extends TypedEmitter<{ openfile: UIScriptFile | null, statechange: undefined }>{
	source: CacheFileSource | null = null;
	sceneCache: ThreejsSceneCache | null = null;
	renderer: ThreeJsRenderer | null = null;
	openedfile: UIScriptFile | null = null;
	rootElement: HTMLElement;
	useServiceWorker: boolean;

	constructor(rootelement: HTMLElement, useServiceWorker: boolean) {
		super();
		this.rootElement = rootelement;
		this.useServiceWorker = useServiceWorker;

		if (useServiceWorker) {
			//this service worker holds a reference to the cache fs handle which will keep the handles valid 
			//across tab reloads
			navigator.serviceWorker.register(new URL('../assets/contextholder.js', import.meta.url).href, { scope: './', });
		}
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
		this.openedfile = file;
		this.emit("openfile", file);
	}
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
				navigator.serviceWorker.ready.then(q => q.active?.postMessage({ type: "sethandle", handle: source.handle }));
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
	if (hasElectrion && source.type == "autofs") {
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

function annotatedHexDom(data: Buffer, chunks: DecodeErrorJson["chunks"]) {
	let resulthex = "";
	let resultchrs = "";

	let linesize = 16;
	let groupsize = 8;

	let hexels = document.createDocumentFragment();
	let textels = document.createDocumentFragment();
	let labelel = document.createElement("span");
	let currentchunk: DecodeErrorJson["chunks"][number] | undefined = { offset: 0, len: 0, label: "start" };

	let mappedchunks: { chunk: DecodeErrorJson["chunks"][number], hexel: HTMLElement, textel: HTMLElement }[] = [];

	let hoverenter = (e: MouseEvent) => {
		let index = +(e.currentTarget as HTMLElement).dataset.index!;
		if (isNaN(index)) { return; }
		let chunk = mappedchunks[index];
		chunk.hexel.classList.add("mv-hex--select");
		chunk.textel.classList.add("mv-hex--select");
		labelel.innerText = `0x${chunk.chunk.offset.toString(16)} - ${chunk.chunk.len} ${index}\n${chunk.chunk.label}`;
	}
	let hoverleave = (e: MouseEvent) => {
		let index = +(e.currentTarget as HTMLElement).dataset.index!;
		if (isNaN(index)) { return; }
		let chunk = mappedchunks[index];
		chunk.hexel.classList.remove("mv-hex--select");
		chunk.textel.classList.remove("mv-hex--select");
		labelel.innerText = "";
	}

	let endchunk = () => {
		if (resulthex != "" && resultchrs != "") {
			let hexnode = document.createTextNode(resulthex);
			let textnode = document.createTextNode(resultchrs);
			if (currentchunk) {
				let index = mappedchunks.length;
				let hexspan = document.createElement("span");
				let textspan = document.createElement("span");
				hexspan.dataset.index = "" + index;
				textspan.dataset.index = "" + index;
				hexspan.onmouseenter = hoverenter;
				hexspan.onmouseleave = hoverleave;
				textspan.onmouseenter = hoverenter;
				textspan.onmouseleave = hoverleave;
				hexspan.appendChild(hexnode);
				textspan.appendChild(textnode);
				hexels.appendChild(hexspan);
				textels.appendChild(textspan);
				mappedchunks.push({ chunk: currentchunk, hexel: hexspan, textel: textspan });
			} else {
				hexels.appendChild(hexnode);
				textels.appendChild(textnode);
			}
		}
		currentchunk = undefined;
		resulthex = "";
		resultchrs = "";
	}

	for (let i = 0; i < data.length; i++) {
		let hexsep = (i == 0 ? "" : i % linesize == 0 ? "\n" : i % groupsize == 0 ? "  " : " ");
		let textsep = (i == 0 ? "" : i % linesize == 0 ? "\n" : i % groupsize == 0 ? " " : "");

		if (currentchunk && (i < currentchunk.offset || i >= currentchunk.offset + currentchunk.len)) {
			endchunk();
			//TODO yikes n^2, worst case currently is maptiles ~20k chunks
			currentchunk = chunks.find(q => q.offset <= i && q.offset + q.len > i);
		} else if (!currentchunk) {
			let newchunk = chunks.find(q => q.offset <= i && q.offset + q.len > i);
			if (newchunk) { endchunk() }
			currentchunk = newchunk;
		}

		let byte = data[i];
		resulthex += hexsep + byte.toString(16).padStart(2, "0");
		resultchrs += textsep + (byte < 0x20 ? "." : String.fromCharCode(byte));
	}
	endchunk();

	return { hexels, textels, labelel };
}

function TrivialHexViewer(p: { data: Buffer }) {
	let { resulthex, resultchrs } = bufToHexView(p.data);

	return (
		<table>
			<tbody>
				<tr>
					<td className="mv-hexrow">{resulthex}</td>
					<td className="mv-hexrow">{resultchrs}</td>
				</tr>
			</tbody>
		</table>
	)
}

function AnnotatedHexViewer(p: { data: Buffer, chunks: DecodeErrorJson["chunks"] }) {
	let { hexels, textels, labelel } = React.useMemo(() => annotatedHexDom(p.data, p.chunks), [p.data, p.chunks]);

	return (
		<table>
			<tbody>
				<tr>
					<DomWrap tagName="td" el={hexels} className="mv-hexrow" />
					<DomWrap tagName="td" el={textels} className="mv-hexrow" />
					<td>
						<DomWrap el={labelel} className="mv-hexlabel" />
					</td>
				</tr>
			</tbody>
		</table>
	)
}

function FileDecodeErrorViewer(p: { file: string }) {
	let [mode, setmode] = React.useState("split" as "split" | "full");
	let [err, buffer] = React.useMemo(() => {
		let err: DecodeErrorJson = JSON.parse(p.file);
		let buffer = Buffer.from(err.originalFile, "hex");
		return [err, buffer];
	}, [p.file]);
	return (
		<div className="mv-hexrow">
			<div>
				<input type="button" className={classNames("sub-btn", { "active": mode == "split" })} onClick={e => setmode("split")} value="split" />
				<input type="button" className={classNames("sub-btn", { "active": mode == "full" })} onClick={e => setmode("full")} value="full" />
				<input type="button" className="sub-btn" onClick={e => downloadBlob("file.bin", new Blob([buffer], { type: "application/octet-stream" }))} value="download original" />
				<CopyButton getText={() => bufToHexView(buffer).resulthex} />
			</div>
			{err.error}
			{mode == "full" && (
				<AnnotatedHexViewer data={buffer} chunks={err.chunks} />
			)}
			{mode == "split" && (
				<React.Fragment>
					<div>Chunks</div>
					<table>
						<tbody>
							{err.chunks.map((q, i) => {
								let hexview = bufToHexView(buffer.slice(q.offset, q.offset + q.len));
								return (
									<tr key={q.offset + "-" + i}>
										<td>{hexview.resulthex}</td>
										<td>{hexview.resultchrs}</td>
										<td>{q.label}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</React.Fragment>
			)}
			<div>State</div>
			{prettyJson(err.state)}
		</div>
	);
}

function SimpleTextViewer(p: { file: string }) {
	return (
		<div className="mv-hexrow">
			{p.file}
		</div>
	);
}

export function FileDisplay(p: { file: UIScriptFile }) {
	let el: React.ReactNode = null;
	let filedata = p.file.data;
	let cnvref = React.useRef<HTMLCanvasElement | null>(null);
	let ext = (p.file.name.match(/\.([\w\.]+)$/i)?.[1] ?? "").toLowerCase();
	if (typeof filedata == "string") {
		if (ext == "hexerr.json") {
			el = <FileDecodeErrorViewer file={filedata} />;
		} else if (ext == "ui.json") {
			el = <RsUIViewer data={filedata} />
		} else if (ext == "html") {
			el = <iframe srcDoc={filedata} sandbox="allow-scripts" style={{ width: "95%", height: "95%" }} />;
		} else {
			//TODO make this not depend on wether file is Buffer or string
			//string types so far: js, txt, json, batch.json
			el = <SimpleTextViewer file={filedata} />;
		}
	} else {
		if (ext == "rstex") {
			let tex = new ParsedTexture(filedata, false, false);
			cnvref.current ??= document.createElement("canvas");
			const cnv = cnvref.current;
			tex.toWebgl().then(img => drawTexture(cnv.getContext("2d")!, img));
			el = <CanvasView canvas={cnvref.current} fillHeight={true} />;
		} else if (["png", "jpg", "jpeg", "webp", "cnv"].includes(ext)) {
			el = <BlobImage file={filedata} ext={ext} fillHeight={true} />
		} else if (ext == "jaga" || ext == "ogg") {
			let header = filedata.readUint32BE(0);
			if (header == 0x4a414741) {//"JAGA"
				let parts = parse.audio.read(filedata, new CallbackCacheLoader(() => { throw new Error("dummy cache") }, false));
				el = (
					<React.Fragment>
						{parts.chunks.map((q, i) => (q.data ? <BlobAudio key={i} file={q.data} autoplay={i == 0} /> : <div key={i}>{q.fileid}</div>))}
					</React.Fragment>
				)
			} else if (header == 0x4f676753) {//"OggS"
				el = <BlobAudio file={filedata} autoplay={true} />
			} else {
				console.log("unexpected header", header, header.toString(16));
			}
		} else {
			el = <TrivialHexViewer data={filedata} />
		}
	}
	return el;
}

export function FileViewer(p: { file: UIScriptFile, onSelectFile: (f: UIScriptFile | null) => void }) {
	return (
		<div style={{ display: "grid", gridTemplateRows: "auto 1fr" }}>
			<div className="mv-modal-head">
				<span>{p.file.name}</span>
				<span style={{ float: "right", marginLeft: "10px" }} onClick={e => downloadBlob(p.file.name, new Blob([p.file.data]))}>download</span>
				<span style={{ float: "right", marginLeft: "10px" }} onClick={e => p.onSelectFile(null)}>x</span>
			</div>
			<div style={{ overflow: "auto", flex: "1", position: "relative" }}>
				<FileDisplay file={p.file} />
			</div>
		</div>
	);
}

