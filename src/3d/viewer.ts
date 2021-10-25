
import * as electron from "electron";
import * as fs from "fs";
import * as path from "path";
import { OB3 } from "./ob3";
import { OB3 as OB3GLTF } from "../3d/ob3togltf";
import * as gl from "./gl";
const vertexShader = fs.readFileSync(__dirname + "/../assets/shader_vertex.glsl", "utf-8");
const fragmentShader = fs.readFileSync(__dirname + "/../assets/shader_fragment.glsl", "utf-8");
const ipc = electron.ipcRenderer;


var cachearg = process.argv.find(a => a.match(/^cachedir=/));
if (!cachearg) { throw new Error("url arguemnt 'cachedir' not set"); }
var cachedir = cachearg.split("=")[1];

ipc.on("model-loaded", async (event, data) => {
	var model = new OB3(cachedir);
	model.setData(data);
	gl.init(document.getElementById("viewer") as any, model, vertexShader, fragmentShader);

	let gltfmodel = new OB3GLTF(cachedir);
	gltfmodel.setData(data);
	let modelfile = await gltfmodel.gltf.convert({ singlefile: true, glb: false, baseurl: "" });
	fs.writeFile(`${cachedir}/gltfs/${Date.now()}.gltf`, modelfile.mainfile, () => { });
});

export function requestLoadModel(modelId) {
	ipc.send("request-load-model", modelId);
}