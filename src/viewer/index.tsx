import * as electron from "electron";
import { handle as decodeItem } from "../handler_items";
import { handle as decodeNpc } from "../handler_npcs";
import { handle as decodeObject } from "../handler_objects";
import * as fs from "fs";
import * as path from "path";
import { OB3 } from "../3d/ob3";
import { OB3 as OB3GLTF } from "../3d/ob3togltf";
import * as ob3Renderer from "./ob3render";
import * as gltfRenderer from "./gltfrender";
import { cacheMajors } from "../constants";
import * as React from "react";
import { useState, useRef, useEffect } from "react";
import * as ReactDOM from "react-dom";
import classNames from "classnames";
import { boundMethod } from "autobind-decorator";
import { ModelModifications } from "3d/utils";

type CacheGetter = (m: number, id: number) => Promise<Buffer>;
type LookupMode = "model" | "item" | "npc" | "object";
type RenderMode = "gltf" | "ob3";

const vertexShader = fs.readFileSync(__dirname + "/../assets/shader_vertex.glsl", "utf-8");
const fragmentShader = fs.readFileSync(__dirname + "/../assets/shader_fragment.glsl", "utf-8");
const ipc = electron.ipcRenderer;
var cachedir: string;

function start() {
	window.addEventListener("keydown", e => {
		if (e.key == "F5") { document.location.reload(); }
		if (e.key == "F12") { electron.remote.getCurrentWebContents().toggleDevTools(); }
	});

	var cachearg = process.argv.find(a => a.match(/^cachedir=/));
	if (!cachearg) { throw new Error("url arguemnt 'cachedir' not set"); }
	cachedir = cachearg.split("=")[1];

	ReactDOM.render(<App />, document.getElementById("app"));
}

(window as any).getFile = getFile;

async function getFile(major: number, minor: number) {
	let buffarray: Uint8Array = await ipc.invoke("load-cache-file", major, minor);
	return Buffer.from(buffarray.buffer, buffarray.byteOffset, buffarray.byteLength);
}

//function submitSearchtest() {
//   var value = document.getElementById("sidebar-browser-search-bar-input").value;
//   document.getElementById("sidebar-browser-search-bar-input").value = "66" + 1;
//  submitSearchIds(value);


class App extends React.Component<{}, { search: string, hist: string[], mode: LookupMode, cnvRefresh: number, rendermode: "gltf" | "ob3" }> {
	renderer: ModelSink;
	constructor(p) {
		super(p);
		this.state = {
			hist: [],
			mode: "model",
			search: "0",
			cnvRefresh: 0,
			rendermode: "gltf"
		};
	}

	@boundMethod
	submitSearchIds(value: string) {
		this.setState({ hist: [...this.state.hist.slice(-19), value] });
		requestLoadModel(value, this.state.mode, this.renderer!);
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
	initCnv(cnv: HTMLCanvasElement | null) {
		if (cnv) {
			if (this.state.rendermode == "gltf") {
				this.renderer = new GltfRenderer(cnv);
			}
			if (this.state.rendermode == "ob3") {
				this.renderer = new Ob3Renderer(cnv);
			}
		}
	}

	@boundMethod
	setRenderer(mode: "gltf" | "ob3") {
		this.setState({ cnvRefresh: this.state.cnvRefresh + 1, rendermode: mode });
	}

	render() {
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
							<div className={classNames("rsmv-icon-button", { active: this.state.mode == "model" })} onClick={() => this.setState({ mode: "model" })}><span>Model IDs</span></div>
							<div></div>
						</div>
						<div className="sidebar-browser-tab-strip">
							<div></div>
							<div className={classNames("rsmv-icon-button", { active: this.state.rendermode == "gltf" })} onClick={() => this.setRenderer("gltf")}><span>GLTF</span></div>
							<div></div>
							<div className={classNames("rsmv-icon-button", { active: this.state.rendermode == "ob3" })} onClick={() => this.setRenderer("ob3")}><span>OB3</span></div>
							<div></div>
						</div>
						<div id="sidebar-browser-tab">
							<form className="sidebar-browser-search-bar" onSubmit={this.submitSearch}>
								<div></div>
								<input type="text" id="sidebar-browser-search-bar-input" value={this.state.search} onChange={e => this.setState({ search: e.currentTarget.value })} />
								<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn" />
								<div></div>
							</form>
							<div className="result-text">
								<p>List of found IDs</p>
							</div>
							<div id="sidebar-browser-tab-data">
								<style>
								</style>
								<div id="sidebar-browser-tab-data-container" className="ids">
									{this.state.hist.map((name, i) => <div key={i} onClick={e => this.submitSearchIds(name)}><span>{name}</span></div>)}
									{
										//	<div><img src="https://runescape.wiki/images/7/7c/Rune_platebody.png?7147a"><span>Rune platebody +4</span></div>
										//	...
									}
								</div>
							</div>
						</div>
					</div>
					<div className="credits">
						<p>
							Interface modified by the RuneScape <br />Preservation Unit.
						Original tool author unknown.
					</p>
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
					</div>
				</div>
			</div >
		);
	}
}

//cache the file loads a little bit as the model loader tend to request the same texture a bunch of times
class MiniCache {
	sectors = new Map<number, Map<number, Promise<Buffer>>>();
	getRaw: CacheGetter;
	get: CacheGetter;
	constructor(getRaw: CacheGetter) {
		this.getRaw = getRaw;

		//use assignment instead of class method so the "this" argument is bound
		this.get = async (major: number, fileid: number) => {
			let sector = this.sectors.get(major);
			if (!sector) {
				sector = new Map();
				this.sectors.set(major, sector);
			}
			let file = sector.get(fileid);
			if (!file) {
				file = this.getRaw(major, fileid);
				sector.set(fileid, file)
			}
			return file;
		}
	}
}

export async function requestLoadModel(searchid: string, mode: LookupMode, renderer: ModelSink) {
	let cache = new MiniCache(getFile);
	let modelids: number[] = [];
	let mods: ModelModifications = {};
	let obj:object;
	switch (mode) {
		case "model":
			modelids = [+searchid];
			break;
		case "item":
			let item = decodeItem(null as any, await cache.get(cacheMajors.items, +searchid));
			console.log(item);
			if (!item.baseModel && item.noteTemplate) {
				item = decodeItem(null as any, await cache.get(cacheMajors.items, item.noteTemplate));
			}
			if (item.color_replacements) { mods.replaceColors = item.color_replacements; }
			if (item.material_replacements) { mods.replaceMaterials = item.material_replacements; }
			modelids = [item.baseModel];
			break;
		case "npc":
			let npc = decodeNpc(null as any, await cache.get(cacheMajors.npcs, +searchid));
			console.log(npc);
			if (npc.color_replacements) { mods.replaceColors = npc.color_replacements; }
			if (npc.material_replacements) { mods.replaceMaterials = npc.material_replacements; }
			modelids = npc.models;
			console.log(npc);
			break;
		case "object":
			let obj = decodeObject(null as any, await cache.get(cacheMajors.objects, +searchid));
			console.log(obj);
			if (obj.color_replacements) { mods.replaceColors = obj.color_replacements; }
			if (obj.material_replacements) { mods.replaceMaterials = obj.material_replacements; }
			modelids = obj.models.flatMap(m => m.values);
			break;
		default:
			throw new Error("unknown mode");
	}

	let models = await Promise.all(modelids.map(id => cache.get(cacheMajors.models, id)));
	renderer.setModels(models, cache, mods);
}

interface ModelSink {
	setModels: (models: Buffer[], cache: MiniCache, mods: ModelModifications) => void
};
class Ob3Renderer implements ModelSink {
	cnv: any;
	constructor(cnv: HTMLCanvasElement) {
		this.cnv = cnv;
	}
	setModels(modelfiles: Buffer[], cache: MiniCache) {
		let models = modelfiles.map(file => {
			let m = new OB3(cache.get);
			m.setData(file);
			return m;
		});
		ob3Renderer.init(this.cnv, models, vertexShader, fragmentShader);
	}
}

class GltfRenderer implements ModelSink {
	renderModels: (gltfs: ArrayBuffer[]) => void
	constructor(cnv: HTMLCanvasElement) {
		let renderer = gltfRenderer.init(cnv);
		this.renderModels = renderer.setModels.bind(renderer);
	}
	async setModels(modelfiles: Buffer[], cache: MiniCache, mods: ModelModifications) {
		let models = await Promise.all(modelfiles.map(async file => {
			let m = new OB3GLTF(cache.get);
			await m.setData(file, mods);
			return m.gltf.convert({ singlefile: true }).then(m => m.mainfile.buffer);
		}));
		this.renderModels(models);
		//fs.writeFileSync(`${cachedir}/gltfs/model${Date.now()}.glb`, Buffer.from(models[0]));
	}
}

start();