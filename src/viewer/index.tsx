
import { parseAnimgroupConfigs, parseEnvironments, parseItem, parseNpc, parseObject } from "../opdecoder";
import { ThreeJsRenderer } from "./threejsrender";
import { cacheConfigPages, cacheMajors } from "../constants";
import * as React from "react";
import * as ReactDOM from "react-dom";
import classNames from "classnames";
import { boundMethod } from "autobind-decorator";
import { HSL2RGB, ModelModifications, packedHSL2HSL } from "../3d/utils";
import { WasmGameCacheLoader as GameCacheLoader } from "../cacheloaderwasm";
import { CacheFileSource, cachingFileSourceMixin } from "../cache";

import { mapsquareModels, mapsquareToThree, ParsemapOpts, parseMapsquare, resolveMorphedObject } from "../3d/mapsquare";
import { ParsedTexture } from "../3d/textures";
import * as datastore from "idb-keyval";
import { EngineCache, ob3ModelToThreejsNode, ThreejsSceneCache } from "../3d/ob3tothree";
import { Object3D } from "three";
import { avatarStringToBytes, avatarToModel } from "../3d/avatar";
import { SceneComponent, SceneComponentRoot, SceneMapModel, SceneSimpleModel } from "./scenenodes";

type LookupMode = "model" | "item" | "npc" | "object" | "material" | "map" | "avatar";
type RenderMode = "three";



if (module.hot) {
	module.hot.accept(["../3d/ob3togltf", "../3d/ob3tothree"]);
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

let engineCache: Promise<EngineCache> | null = null;

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

function appearanceUrl(name: string) {
	if (document.location.protocol.startsWith("http")) {
		//proxy through runeapps if we are running in a browser
		return `http://localhost/data/getplayeravatar.php?player=${encodeURIComponent(name)}`;
	} else {
		return `https://secure.runescape.com/m=avatar-rs/${encodeURIComponent(name)}/appearance.dat`;
	}
}

async function ensureCachePermission() {
	if (!engineCache) {
		engineCache = (async () => {
			if (!cacheDirectoryHandle) {
				cacheDirectoryHandle = await showDirectoryPicker();
				if (!cacheDirectoryHandle) { throw new Error("permission denied"); }
			}
			await cacheDirectoryHandle.requestPermission();

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
			let cache = await EngineCache.create(hackyCacheFileSource);
			console.log("engine loaded");
			return cache;
		})();
		engineCache.catch(() => engineCache = null);
	}
	return engineCache;
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
	renderer: ThreeJsRenderer;
	rootnode: SceneComponent | null = null;
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
		localStorage.rsmv_lastsearch = value;
		localStorage.rsmv_lastmode = this.state.mode;
		if (!this.state.hist.includes(value)) {
			this.setState({ hist: [...this.state.hist.slice(-4), value] });
		}
		this.requestLoadModel(value, this.state.mode, this.renderer!);
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
		let modelexprt = await this.renderer.export("gltf");
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
			this.renderer = new ThreeJsRenderer(cnv, {}, this.viewerStateChanged, hackyCacheFileSource);
			(this.renderer as any).automaticFrames = true;
			console.warn("forcing auto-frames!!");
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
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "item" })} onClick={() => this.setState({ mode: "item" })}>Items IDs</div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "npc" })} onClick={() => this.setState({ mode: "npc" })}>NPCs IDs</div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "object" })} onClick={() => this.setState({ mode: "object" })}>Obj/Locs IDs</div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "avatar" })} onClick={() => this.setState({ mode: "avatar" })}>Avatar</div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "model" })} onClick={() => this.setState({ mode: "model" })}>Model IDs</div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "map" })} onClick={() => this.setState({ mode: "map" })}>Map</div>
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "material" })} onClick={() => this.setState({ mode: "material" })}>Material IDs</div>
							<div className={classNames("rsmv-icon-button", { active: this.state.rendermode == "three" })} onClick={() => this.setRenderer("three")}>Three</div>
							<div className={classNames("rsmv-icon-button", { active: false })} onClick={this.exportModel}>Export</div>
						</div>
						<div>
							<form className="sidebar-browser-search-bar" onSubmit={this.submitSearch}>
								<input type="button" style={{ width: "25px", height: "25px" }} onClick={this.submitSearchminus} value="" className="sub-btn-minus" />
								<input type="button" style={{ width: "25px", height: "25px" }} onClick={this.submitSearchplus} value="" className="sub-btn-plus" />
								<input type="text" className="sidebar-browser-search-bar-input" value={this.state.search} onChange={e => this.setState({ search: e.currentTarget.value })} />
								<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn" />
							</form>
							<div id="sidebar-browser-tab-data">
								<div id="sidebar-browser-tab-data-container" className="ids">
									{this.state.hist.map((name, i) => <div key={i} onClick={e => this.submitSearchIds(name)}><span>{name}</span></div>)}
								</div>
							</div>
						</div>
						<div id="sidebar-browser-tab">
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
								return null;
								// return (
								// 	<div key={base}>
								// 		<label><input type="checkbox" checked={all} onChange={e => subs.forEach(s => this.renderer.setValue!(base + s, e.currentTarget.checked))} ref={v => v && (v.indeterminate = !all && !none)} />{base}</label>
								// 		{subs.map(sub => {
								// 			let name = base + sub;
								// 			let value = this.state.viewerState.toggles[name];
								// 			return (
								// 				<label key={sub}>
								// 					<input type="checkbox" checked={value} onChange={e => this.renderer.setValue!(name, e.currentTarget.checked)} />
								// 					{sub}
								// 				</label>
								// 			);
								// 		})}
								// 	</div>
								// )
							})}
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


	async requestLoadModel(searchid: string, mode: LookupMode, renderer: ThreeJsRenderer) {
		let engineCache = await ensureCachePermission();
		let scenecache = new ThreejsSceneCache(engineCache);
		let metatext = "";
		this.rootnode?.cleaup();
		let node: SceneSimpleModel | SceneMapModel = new SceneSimpleModel(scenecache, this.renderer);
		switch (mode) {
			case "model": {
				node.setAnimation({ animid: -1, model: [{ modelid: +searchid, mods: {} }] });
				break;
			}
			case "item": {
				let item = parseItem.read(await hackyCacheFileSource.getFileById(cacheMajors.items, +searchid));
				console.log(item);
				metatext = JSON.stringify(item, undefined, 2);
				if (!item.baseModel && item.noteTemplate) {
					item = parseItem.read(await hackyCacheFileSource.getFileById(cacheMajors.items, item.noteTemplate));
				}
				let mods: ModelModifications = {};
				if (item.color_replacements) { mods.replaceColors = item.color_replacements; }
				if (item.material_replacements) { mods.replaceMaterials = item.material_replacements; }
				node.setAnimation({ animid: -1, model: (item.baseModel ? [{ modelid: item.baseModel, mods }] : []) });
				break;
			}
			case "npc": {
				let npc = parseNpc.read(await hackyCacheFileSource.getFileById(cacheMajors.npcs, +searchid));
				metatext = JSON.stringify(npc, undefined, 2);
				let anims: number[] = [];
				let modelids = npc.models ?? [];
				if (npc.animation_group) {
					let arch = await hackyCacheFileSource.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
					let animgroup = parseAnimgroupConfigs.read(arch[npc.animation_group].buffer);
					console.log(animgroup);
					let forcedanim = globalThis.forcedanim;
					anims.push(forcedanim ?? animgroup.idleVariations?.[0]?.animid ?? animgroup.baseAnims?.idle);
					metatext += "\n\n" + JSON.stringify(animgroup, undefined, "\t");
				}
				console.log(npc);
				let mods: ModelModifications = {};
				if (npc.color_replacements) { mods.replaceColors = npc.color_replacements; }
				if (npc.material_replacements) { mods.replaceMaterials = npc.material_replacements; }
				node.setAnimation({ model: modelids.map(q => ({ modelid: q, mods })), animid: anims[0] ?? -1 });
				break;
			}
			case "object": {
				let obj = await resolveMorphedObject(hackyCacheFileSource, +searchid);
				console.log(obj);
				metatext = JSON.stringify(obj, undefined, 2);
				let mods: ModelModifications = {};
				let animid = -1;
				let modelids: number[] = [];
				if (obj) {
					if (obj.color_replacements) { mods.replaceColors = obj.color_replacements; }
					if (obj.material_replacements) { mods.replaceMaterials = obj.material_replacements; }
					modelids = obj.models?.flatMap(m => m.values) ?? [];
				}
				if (obj?.probably_animation) {
					animid = obj.probably_animation;
				}
				node.setAnimation({ model: modelids.map(q => ({ modelid: q, mods })), animid });
				break;
			}
			case "material": {
				let modelid = 93776;//"RuneTek_Asset" jagex test model
				let mods: ModelModifications = {
					replaceMaterials: [[4314, +searchid]]
				};
				// modelids = [67768];//is a cube but has transparent vertices
				// mods.replaceMaterials = [
				// 	[8868, +searchid]
				// ];
				let mat = engineCache.getMaterialData(+searchid);
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
				node.setAnimation({ model: [{ modelid, mods }], animid: -1 });
				break;
			}
			case "map": {
				let [x, z, xsize, zsize] = searchid.split(/[,\.\/:;]/).map(n => +n);
				xsize = xsize ?? 1;
				zsize = zsize ?? xsize;
				node = new SceneMapModel(scenecache, renderer);
				node.setArea({ x, z, xsize, zsize });
				break;
			}
			case "avatar": {
				let url = appearanceUrl(searchid);
				let data = await fetch(url).then(q => q.text());
				if (data.indexOf("404 - Page not found") != -1) { throw new Error("player avatar not found"); }
				let avainfo = await avatarToModel(scenecache, avatarStringToBytes(data));
				node.setAnimation({
					model: avainfo.models,
					animid: avainfo.animids[0] ?? -1
				});
				break;
			}
			default:
				throw new Error("unknown mode");
		}
		this.rootnode = node;
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
export type ModelViewerState = {
	meta: string,
	toggles: Record<string, boolean>
}

start();