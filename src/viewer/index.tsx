
import { parseAnimgroupConfigs, parseItem, parseNpc, parseObject } from "../opdecoder";
import { ThreeJsRenderer } from "./threejsrender";
import { cacheConfigPages, cacheMajors } from "../constants";
import * as React from "react";
import * as ReactDOM from "react-dom";
import classNames from "classnames";
import { boundMethod } from "autobind-decorator";
import { ModelModifications } from "../3d/utils";
import { WasmGameCacheLoader as GameCacheLoader } from "../cacheloaderwasm";
import { CacheFileSource, cachingFileSourceMixin } from "../cache";

import { mapsquareModels, mapsquareToThree, ParsemapOpts, parseMapsquare, resolveMorphedObject } from "../3d/mapsquare";
import { getMaterialData } from "../3d/ob3togltf";
import { ParsedTexture } from "../3d/textures";

import * as datastore from "idb-keyval";

type LookupMode = "model" | "item" | "npc" | "object" | "material" | "map";
type RenderMode = "gltf" | "three";


if (module.hot) {
	module.hot.accept("../3d/ob3togltf");
}

function start() {
	window.addEventListener("keydown", e => {
		if (e.key == "F5") { document.location.reload(); }
		// if (e.key == "F12") { electron.remote.getCurrentWebContents().toggleDevTools(); }
	});

	ReactDOM.render(<App />, document.getElementById("app"));
}


//TODO rename this, it's no longer a hack
let CachedHacky = cachingFileSourceMixin(GameCacheLoader);
const hackyCacheFileSource = new CachedHacky();

declare var FileSystemHandle: {
	prototype: WebkitFsHandle;
	new(): WebkitFsHandle;
};

declare function showSaveFilePicker(options?: any): Promise<WebkitFileHandle>;
declare function showDirectoryPicker(options?: any): Promise<WebkitDirectoryHandle>;

type WebkitFsHandleBase = {
	kind: string,
	name: string,

	requestPermission(): Promise<any>;
	queryPermission(): Promise<any>;
}
type WebkitFsWritable = {
	write(data: any): Promise<void>,
	close(): Promise<void>
}
type WebkitFsHandle = WebkitDirectoryHandle | WebkitFileHandle;
type WebkitFileHandle = WebkitFsHandleBase & {
	kind: "file",
	createWritable(): Promise<WebkitFsWritable>,
	getFile(): Promise<File>
}
type WebkitDirectoryHandle = WebkitFsHandleBase & {
	kind: "directory",
	getFileHandle(name: string, opt?: { create: boolean }): Promise<WebkitFileHandle>,
	values(): AsyncIterable<WebkitFsHandle>
}

var cacheDirectoryHandle: WebkitDirectoryHandle | null = null;
var cacheDirectoryLoaded = false;

if (module.hot) {
	module.hot.accept("../3d/ob3tothree.ts", () => {
		console.log("notified");
	})
}

async function ensureCachePermission() {
	if (cacheDirectoryLoaded) { return }
	if (!cacheDirectoryHandle) {
		cacheDirectoryHandle = await showDirectoryPicker();
	}
	if (cacheDirectoryHandle) {
		await cacheDirectoryHandle.requestPermission();
		cacheDirectoryLoaded = true;

		let files: Record<string, Blob> = {};
		console.log(await cacheDirectoryHandle.queryPermission());
		await cacheDirectoryHandle.requestPermission();
		for await (let handle of cacheDirectoryHandle.values()) {
			if (handle.kind == "file") {
				files[handle.name] = await handle.getFile();
			}
		}
		hackyCacheFileSource.giveBlobs(files);
		datastore.set("cachefilehandles", cacheDirectoryHandle);
	}
}

if (typeof window != "undefined") {
	datastore.get("cachefilehandles").then(oldhandle => {
		if (typeof FileSystemHandle != "undefined" && oldhandle instanceof FileSystemHandle && oldhandle.kind == "directory") {
			cacheDirectoryHandle = oldhandle;
		}
	});
	document.body.ondragover = e => e.preventDefault();
	document.body.ondrop = async e => {
		e.preventDefault();
		if (e.dataTransfer) {
			let files: Record<string, Blob> = {};
			let items: DataTransferItem[] = [];
			let folderhandles: WebkitDirectoryHandle[] = [];
			let filehandles: WebkitFsHandle[] = [];
			for (let i = 0; i < e.dataTransfer.items.length; i++) { items.push(e.dataTransfer.items[i]); }
			//needs to start synchronously as the list is cleared after the event
			await Promise.all(items.map(async item => {
				//@ts-ignore
				if (item.getAsFileSystemHandle) {
					//@ts-ignore
					let filehandle: WebkitFsHandle = await item.getAsFileSystemHandle();
					if (filehandle.kind == "file") {
						filehandles.push(filehandle);
						files[filehandle.name] = await filehandle.getFile();
					} else {
						folderhandles.push(filehandle);
						for await (let handle of filehandle.values()) {
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
				cacheDirectoryHandle = folderhandles[0];
			}
			console.log(`added ${Object.keys(files).length} files`);
			hackyCacheFileSource.giveBlobs(files);
		}
	}
}

// const hackyCacheFileSource = new CachedHacky(path.resolve(process.env.ProgramData!, "jagex/runescape"));
// let CachedHacky = cachingFileSourceMixin(Downloader);
// const hackyCacheFileSource = new CachedHacky();

class App extends React.Component<{}, { search: string, hist: string[], mode: LookupMode, cnvRefresh: number, rendermode: RenderMode, viewerState: ModelViewerState }> {
	renderer: ModelSink;
	constructor(p) {
		super(p);
		this.state = {
			hist: [],
			mode: localStorage.rsmv_lastmode ?? "model",
			search: localStorage.rsmv_lastsearch ?? "0",
			cnvRefresh: 0,
			rendermode: "three",
			viewerState: { meta: "", toggles: {} }
		};
	}

	@boundMethod
	async submitSearchIds(value: string) {
		await ensureCachePermission();
		localStorage.rsmv_lastsearch = value;
		localStorage.rsmv_lastmode = this.state.mode;
		if (!this.state.hist.includes(value)) {
			this.setState({ hist: [...this.state.hist.slice(-4), value] });
		}
		requestLoadModel(value, this.state.mode, this.renderer!);
	}

	@boundMethod
	viewerStateChanged(state: ModelViewerState) {
		this.setState({ viewerState: state });
	}

	@boundMethod
	submitSearch(e: React.FormEvent) {
		this.submitSearchIds(this.state.search);
		e.preventDefault();
	}
	@boundMethod
	submitSearchminus(e: React.FormEvent) {
		let newvalue = parseInt(this.state.search) - 1;
		this.setState({ search: newvalue + "" });
		this.submitSearchIds(newvalue + "");
		e.preventDefault();
	}
	@boundMethod
	submitSearchplus(e: React.FormEvent) {
		let newvalue = parseInt(this.state.search) + 1;
		this.setState({ search: newvalue + "" });
		this.submitSearchIds(newvalue + "");
		e.preventDefault();
	}
	@boundMethod
	async exportModel() {
		let savehandle = await showSaveFilePicker({
			id: "savegltf",
			startIn: "downloads",
			suggestedName: "model.glb",
			types: [
				{ description: 'GLTF model', accept: { 'application/gltfl': ['.glb', '.gltf'] } },
			]
		});
		let modelexprt = await (this.renderer as any).export();
		let str = await savehandle.createWritable();
		await str.write(modelexprt);
		await str.close();
		// let dir = await showDirectoryPicker({
		// 	id: "savegltf",
		// 	startIn: "downloads",
		// 	suggestedName: "model.gltf",
		// 	types: [
		// 		{ description: 'GLTF model', accept: { 'application/gltfl': ['.glb', '.gltf'] } },
		// 	]
		// });
		// let modelfiles = await (this.renderer as any).export();
		// console.log(modelfiles);
		// let mainfile = await dir.getFileHandle("model.dae", { create: true });
		// let str = await mainfile.createWritable();
		// await str.write(modelfiles.data).then(() => str.close());

		// await Promise.all(modelfiles.textures.map(async tex => {
		// 	let file = await dir.getFileHandle(tex.name + "." + tex.ext, { create: true });
		// 	let str = await file.createWritable();
		// 	await str.write(tex.data);
		// 	await str.close();
		// }));
	}

	@boundMethod
	initCnv(cnv: HTMLCanvasElement | null) {
		if (cnv) {
			if (this.state.rendermode == "gltf") {
				this.renderer = new ThreeJsRenderer(cnv, {}, this.viewerStateChanged, hackyCacheFileSource, true);
			}
			if (this.state.rendermode == "three") {
				this.renderer = new ThreeJsRenderer(cnv, {}, this.viewerStateChanged, hackyCacheFileSource);
				(this.renderer as any).automaticFrames = true;
				console.warn("forcing auto-frames!!");
			}
		}
	}

	@boundMethod
	setRenderer(mode: RenderMode) {
		this.setState({ cnvRefresh: this.state.cnvRefresh + 1, rendermode: mode });
	}

	render() {
		let toggles: Record<string, string[]> = {};
		for (let toggle of Object.keys(this.state.viewerState.toggles)) {
			let m = toggle.match(/^(\D+?)(\d.*)?$/);
			if (!m) { throw new Error("???"); }
			toggles[m[1]] = toggles[m[1]] ?? [];
			toggles[m[1]].push(m[2] ?? "");
		}

		return (
			<div id="content">
				<div className="canvas-container">
					<canvas id="viewer" key={this.state.cnvRefresh} ref={this.initCnv}></canvas>
				</div>
				<div id="sidebar">
					<div id="sidebar-browser">
						<div className="sidebar-browser-tab-strip">
							<div></div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "item" })} onClick={() => this.setState({ mode: "item" })}><span>Items IDs</span></div>
							<div></div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "npc" })} onClick={() => this.setState({ mode: "npc" })}><span>NPCs IDs</span></div>
							<div></div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "object" })} onClick={() => this.setState({ mode: "object" })}><span>Obj/Locs IDs</span></div>
							<div></div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "material" })} onClick={() => this.setState({ mode: "material" })}><span>Material IDs</span></div>
							<div></div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "model" })} onClick={() => this.setState({ mode: "model" })}><span>Model IDs</span></div>
							<div></div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "map" })} onClick={() => this.setState({ mode: "map" })}><span>Map</span></div>
							<div></div>
						</div>
						<div className="sidebar-browser-tab-strip">
							<div></div>
							<div className={classNames("rsmv-icon-button", { active: this.state.rendermode == "three" })} onClick={() => this.setRenderer("three")}><span>Three</span></div>
							<div></div>
							<div className={classNames("rsmv-icon-button", { active: this.state.rendermode == "gltf" })} onClick={() => this.setRenderer("gltf")}><span>GLTF</span></div>
							<div></div>
							<div className={classNames("rsmv-icon-button", { active: false })} onClick={this.exportModel}><span>Export</span></div>
							<div></div>
						</div>
						<div id="sidebar-browser-tab">
							<form className="sidebar-browser-search-bar" onSubmit={this.submitSearch}>
								<div></div>
								<input type="text" id="sidebar-browser-search-bar-input" value={this.state.search} onChange={e => this.setState({ search: e.currentTarget.value })} />
								<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn" />
								<div></div>
							</form>
							<div className="nav-jail">
								<form className="sidebar-browser-search-bar" onSubmit={this.submitSearchminus} >
									<div></div>
									<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn-minus" />
									<div></div>
								</form>
								<form className="sidebar-browser-search-bar" onSubmit={this.submitSearchplus} >
									<div></div>
									<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn-plus" />
									<div></div>
								</form>
							</div>
							<div style={{ overflowY: "auto" }}>
								<pre style={{ textAlign: "left", userSelect: "text" }}>
									{this.state.viewerState.meta}
								</pre>
							</div>
							{Object.entries(toggles).map(([base, subs]) => {
								let all = true;
								let none = true;
								subs.forEach(s => {
									let v = this.state.viewerState.toggles[base + s];
									all &&= v;
									none &&= !v;
								})
								return (
									<div key={base}>
										<label><input type="checkbox" checked={all} onChange={e => subs.forEach(s => this.renderer.setValue!(base + s, e.currentTarget.checked))} ref={v => v && (v.indeterminate = !all && !none)} />{base}</label>
										{subs.map(sub => {
											let name = base + sub;
											let value = this.state.viewerState.toggles[name];
											return (
												<label key={sub}>
													<input type="checkbox" checked={value} onChange={e => this.renderer.setValue!(name, e.currentTarget.checked)} />
													{sub}
												</label>
											);
										})}
									</div>
								)
							})}
							<div id="sidebar-browser-tab-data">
								<style>
								</style>
								<div id="sidebar-browser-tab-data-container" className="ids">
									{this.state.hist.map((name, i) => <div key={i} onClick={e => this.submitSearchIds(name)}><span>{name}</span></div>)}
								</div>
							</div>
							<div className="result-text">
								<p>List of found IDs</p>
							</div>
						</div>
					</div>
					<div className="credits">
						<p>
							Interface modified by the RuneScape <br />Preservation Unit.
							Original tool author unknown.
						</p>
					</div>
				</div>
			</div >
		);
	}
}

//cache the file loads a little bit as the model loader tend to request the same texture a bunch of times
//TODO is now obsolete?
// export class MiniCache {
// 	sectors = new Map<number, Map<number, Promise<Buffer>>>();
// 	getRaw: CacheGetter;
// 	get: CacheGetter;
// 	constructor(getRaw: CacheGetter) {
// 		this.getRaw = getRaw;

// 		//use assignment instead of class method so the "this" argument is bound
// 		this.get = async (major: number, fileid: number) => {
// 			let sector = this.sectors.get(major);
// 			if (!sector) {
// 				sector = new Map();
// 				this.sectors.set(major, sector);
// 			}
// 			let file = sector.get(fileid);
// 			if (!file) {
// 				file = this.getRaw(major, fileid);
// 				sector.set(fileid, file)
// 			}
// 			return file;
// 		}
// 	}
// }

export async function requestLoadModel(searchid: string, mode: LookupMode, renderer: ModelSink) {
	// let cache = new MiniCache(getFile);
	let modelids: number[] = [];
	let mods: ModelModifications = {};
	let models: Buffer[] = [];
	let anims: number[] = [];
	let metatext = "";
	switch (mode) {
		case "model":
			modelids = [+searchid];
			break;
		case "item":
			let item = parseItem.read(await hackyCacheFileSource.getFileById(cacheMajors.items, +searchid));
			console.log(item);
			metatext = JSON.stringify(item, undefined, 2);
			if (!item.baseModel && item.noteTemplate) {
				item = parseItem.read(await hackyCacheFileSource.getFileById(cacheMajors.items, item.noteTemplate));
			}
			if (item.color_replacements) { mods.replaceColors = item.color_replacements; }
			if (item.material_replacements) { mods.replaceMaterials = item.material_replacements; }
			modelids = item.baseModel ? [item.baseModel] : [];
			break;
		case "npc":
			let npc = parseNpc.read(await hackyCacheFileSource.getFileById(cacheMajors.npcs, +searchid));
			metatext = JSON.stringify(npc, undefined, 2)
			if (npc.animation_group) {
				let arch = await hackyCacheFileSource.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
				let animgroup = parseAnimgroupConfigs.read(arch[npc.animation_group].buffer);
				console.log(animgroup);
				let forcedanim = (window as any).forcedanim;
				anims.push(forcedanim ?? animgroup.unknown_26 ?? animgroup.unknown_01?.[1]);
				metatext += "\n\n" + JSON.stringify(animgroup, undefined, "\t");
			}
			console.log(npc);
			if (npc.color_replacements) { mods.replaceColors = npc.color_replacements; }
			if (npc.material_replacements) { mods.replaceMaterials = npc.material_replacements; }
			modelids = npc.models ?? [];
			break;
		case "object":
			let obj = await resolveMorphedObject(hackyCacheFileSource, +searchid);
			console.log(obj);
			metatext = JSON.stringify(obj, undefined, 2);
			if (obj) {
				if (obj.color_replacements) { mods.replaceColors = obj.color_replacements; }
				if (obj.material_replacements) { mods.replaceMaterials = obj.material_replacements; }
				modelids = obj.models?.flatMap(m => m.values) ?? [];
			}
			if (obj?.probably_animation) {
				anims.push(obj.probably_animation);
			}
			break;
		case "material":
			modelids = [93776];//"RuneTek_Asset" jagex test model
			mods.replaceMaterials = [
				[4314, +searchid]
			];
			// modelids = [67768];//is a cube but has transparent vertices
			// mods.replaceMaterials = [
			// 	[8868, +searchid]
			// ];
			let mat = await getMaterialData(hackyCacheFileSource, +searchid);
			let info: any = { mat };
			let addtex = async (name: string, texid: number) => {
				let file = await hackyCacheFileSource.getFile(cacheMajors.texturesDds, texid);
				let parsed = new ParsedTexture(file, false);
				//bit of a waste to get decode the whole thing just to get meta data, but w/e
				let img0 = await parsed.toImageData(0);
				info[name] = { texid, filesize: file.length, width: img0.width, height: img0.height };
			}
			for (let tex in mat.textures) {
				if (mat.textures[tex] != 0) {
					await addtex(tex, mat.textures[tex]);
				}
			}

			metatext = JSON.stringify(info, undefined, "\t");
			break;
		case "map":
			let [x, z, xsize, zsize] = searchid.split(/[,\.\/:;]/).map(n => +n);
			xsize = xsize ?? 1;
			zsize = zsize ?? xsize;
			//TODO enable centered again
			let opts: ParsemapOpts = { centered: true, invisibleLayers: true, collision: true, padfloor: false };
			let { grid, chunks } = await parseMapsquare(hackyCacheFileSource, { x, z, xsize, zsize }, opts);
			let modeldata = await mapsquareModels(hackyCacheFileSource, grid, chunks, opts);

			let scene = await mapsquareToThree(hackyCacheFileSource, grid, modeldata);
			renderer.setModels?.([scene], "");
			// TODO currently parsing this twice
			// let locs = (await Promise.all(chunks.map(ch => mapsquareObjects(hackyCacheFileSource, ch, grid, false)))).flat();
			// let svg = await svgfloor(hackyCacheFileSource, grid, locs, { x: x * 64, z: z * 64, xsize: xsize * 64, zsize: zsize * 64 }, 0, 8, false);
			// fs.writeFileSync("map.svg", svg);
			break;
		default:
			throw new Error("unknown mode");
	}

	if (modelids.length != 0) {
		models.push(...await Promise.all(modelids.map(id => hackyCacheFileSource.getFileById(cacheMajors.models, id))));
		console.log("loading models", ...modelids);
		renderer.setOb3Models(models, hackyCacheFileSource, mods, metatext, anims);
	}
}

export type ModelViewerState = {
	meta: string,
	toggles: Record<string, boolean>
}

export interface ModelSink {
	setOb3Models: (models: Buffer[], cache: CacheFileSource, mods: ModelModifications, meta: string, anims: number[]) => void
	setGltfModels?: (models: Buffer[]) => void,
	setModels?: (models: THREE.Object3D[], metastr?: string) => void,
	setValue?: (key: string, value: boolean) => void
};

start();