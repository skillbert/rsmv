
import * as electron from "electron";
import * as fs from "fs";
import * as path from "path";
import { OB3 } from "./ob3";
import { OB3 as OB3GLTF } from "../3d/ob3togltf";
import * as gl from "./gl";
import { cacheMajors } from "../constants";

type CacheGetter = (m: number, id: number) => Promise<Buffer>;

const vertexShader = fs.readFileSync(__dirname + "/../assets/shader_vertex.glsl", "utf-8");
const fragmentShader = fs.readFileSync(__dirname + "/../assets/shader_fragment.glsl", "utf-8");
const ipc = electron.ipcRenderer;

window.addEventListener("keydown", e => {
	if (e.key == "F5") { document.location.reload(); }
	if (e.key == "F12") { electron.remote.getCurrentWebContents().toggleDevTools(); }
})

var cachearg = process.argv.find(a => a.match(/^cachedir=/));
if (!cachearg) { throw new Error("url arguemnt 'cachedir' not set"); }
var cachedir = cachearg.split("=")[1];
async function getFile(major: number, minor: number) {
	let buffarray: Uint8Array = await ipc.invoke("load-cache-file", major, minor);
	return Buffer.from(buffarray.buffer, buffarray.byteOffset, buffarray.byteLength);
}

(window as any).getFile = getFile;

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

	let gltfmodel = new OB3GLTF(cache.get);
	gltfmodel.setData(modelfile).then(async () => {
		let gltf = await gltfmodel.gltf.convert({ singlefile: true, glb: false, baseurl: "" });
		fs.writeFile(`${cachedir}/gltfs/${Date.now()}.gltf`, gltf.mainfile, () => { });
	})
}