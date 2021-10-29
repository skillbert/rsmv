
import * as electron from "electron";
import * as fs from "fs";
import * as path from "path";
import { OB3 } from "../3d/ob3";
import { OB3 as OB3GLTF } from "../3d/ob3togltf";
import * as gl from "./gl";
import { cacheMajors } from "../constants";

type CacheGetter = (m: number, id: number) => Promise<Buffer>;

const vertexShader = fs.readFileSync(__dirname + "/../assets/shader_vertex.glsl", "utf-8");
const fragmentShader = fs.readFileSync(__dirname + "/../assets/shader_fragment.glsl", "utf-8");
const container = document.getElementById("sidebar-browser-tab-data-container")!;
const searchinput = document.getElementById("sidebar-browser-search-bar-input") as HTMLInputElement;
const ipc = electron.ipcRenderer;

window.addEventListener("keydown", e => {
	if (e.key == "F5") { document.location.reload(); }
	if (e.key == "F12") { electron.remote.getCurrentWebContents().toggleDevTools(); }
});

var cachearg = process.argv.find(a => a.match(/^cachedir=/));
if (!cachearg) { throw new Error("url arguemnt 'cachedir' not set"); }
var cachedir = cachearg.split("=")[1];
 

(window as any).getFile = getFile;

async function getFile(major: number, minor: number) {
	let buffarray: Uint8Array = await ipc.invoke("load-cache-file", major, minor);
	return Buffer.from(buffarray.buffer, buffarray.byteOffset, buffarray.byteLength);
}

function submitSearchIds(value: string | number) {
	value = parseInt(value as any);
	if (true) {
		requestLoadModel(value);
		const _i = value;
		var div = document.createElement("div");
		var span = document.createElement("span");
		span.innerText = "" + _i;
		div.appendChild(span);
		div.addEventListener("click", function () {
			requestLoadModel(_i);
		});
		container.appendChild(div);
	}
}

export function submitSearch() {
	var value = searchinput.value;
	submitSearchIds(value);
}
export function submitSearchminus() {
	let newvalue = parseInt(searchinput.value) - 1;
	searchinput.value = "" + newvalue
	submitSearchIds(newvalue);
}
export function submitSearchplus() {
	let newvalue = parseInt(searchinput.value) + 1;
	searchinput.value = "" + newvalue
	submitSearchIds(newvalue);
}
//function submitSearchtest() {
//   var value = document.getElementById("sidebar-browser-search-bar-input").value;
//   document.getElementById("sidebar-browser-search-bar-input").value = "66" + 1;
//  submitSearchIds(value);


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

export async function requestLoadModel(modelId: number | string) {
	let cache = new MiniCache(getFile);

	let modelfile = await cache.get(cacheMajors.models, +modelId);

	var model = new OB3(cache.get);
	model.setData(modelfile);
	gl.init(document.getElementById("viewer") as any, model, vertexShader, fragmentShader);

	// let gltfmodel = new OB3GLTF(cache.get);
	// gltfmodel.setData(modelfile).then(async () => {
	// 	let gltf = await gltfmodel.gltf.convert({ singlefile: true, glb: false, baseurl: "" });
	// 	await fs.promises.mkdir(`${cachedir}/gltfs`, { recursive: true });
	// 	await fs.promises.writeFile(`${cachedir}/gltfs/${Date.now()}.gltf`, gltf.mainfile);
	// })
}