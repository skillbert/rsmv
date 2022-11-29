
import { exportThreeJsGltf, ThreeJsRenderer } from "../viewer/threejsrender";
import { filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CacheFileSource } from "../cache";
import { EngineCache, ThreejsSceneCache } from "../3d/ob3tothree";
import { CLIScriptOutput, ScriptOutput } from "../viewer/scriptsui";
import { npcToModel, playerToModel, RSMapChunk, RSModel } from "../3d/modelnodes";
import sharp from "sharp";
import { delay } from "../utils";
import { mapsquareSkybox, parseMapsquare } from "../3d/mapsquare";
import { GameCacheLoader } from "../cache/sqlite";
import { Mesh, Vector3, WebGLRendererParameters } from "three";
import { promises as fs } from "fs";
import { Downloader } from "../cache/downloader";
import { polyfillNode } from "./nodegltfplugin";
import { Openrs2CacheSource } from "../cache/openrs2loader";

polyfillNode();
// let cmd = cmdts.command({
// 	name: "render",
// 	args: {
// 		...filesource,
// 	},
// 	handler: async (args) => {
// 		let output = new CLIScriptOutput();
// 		let src = await args.source();
// 		await run(output, src, 0);
// 	}
// });

if (require.main?.id == module.id) {
	// run(new GameCacheLoader(), 0);
	// cmdts.run(cmd, process.argv.slice(2));

	(async () => {
		let ava = await renderAvatar("skillbert");
		fs.writeFile("model.png", ava.imgfile);
		fs.writeFile("model.glb", ava.modelfile);
	})()
}

export function getRenderer(width: number, height: number, extraopts?: WebGLRendererParameters) {
	let opts = Object.assign({ antialias: true, alpha: true } as WebGLRendererParameters, extraopts);

	let cnv: HTMLCanvasElement;
	let ctx: WebGLRenderingContext | undefined = undefined;
	if (typeof HTMLCanvasElement != "undefined") {
		cnv = document.createElement("canvas");
		cnv.width = width;
		cnv.height = height;
		document.body.appendChild(cnv);
	} else {
		cnv = {
			width, height,
			clientWidth: width, clientHeight: height,
			addEventListener: event => { },
			removeEventListener: event => { },
			style: {}
		} as any;
		ctx = require("gl")(width, height, opts);
	}

	let render = new ThreeJsRenderer(cnv, { context: ctx, ...opts });
	return render;
}

export async function renderAvatar(playername: string) {
	let engine = await EngineCache.create(new Openrs2CacheSource("1152"));
	let scene = new ThreejsSceneCache(engine);

	let width = 500;
	let height = 700;
	let render = getRenderer(width, height);
	render.addSceneElement({
		getSceneElements() {
			return { options: { autoFrames: false, hideFloor: true } };
		}
	})

	let player = await playerToModel(scene, playername);
	let model = new RSModel(player.models, scene);
	model.setAnimation(player.anims.default);
	render.addSceneElement(model);

	await model.model;
	await delay(1);
	render.setCameraPosition(new Vector3(0, 0.8, 2.5));
	render.setCameraLimits(new Vector3(0, 0.8, 0));

	let modelfile = await exportThreeJsGltf(model.loaded!.mesh);
	let img = await render.takeCanvasPicture();
	let imgfile = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
		.png().toBuffer();

	return { imgfile, modelfile };
}


async function run(filesource: CacheFileSource, npcid: number) {
	let engine = await EngineCache.create(filesource);
	let scene = new ThreejsSceneCache(engine);

	let width = 1024;
	let height = 2048;

	let opts: WebGLRendererParameters = { antialias: true, alpha: true };

	let render = getRenderer(width, height, opts);
	render.addSceneElement({
		getSceneElements() {
			return { options: { autoFrames: false, hideFloor: true } };
		}
	})

	globalThis.render = render;



	let maprect = { x: 52, z: 47, xsize: 1, zsize: 1 };
	// let { chunks } = await parseMapsquare(engine, maprect, {});
	// let sky = await mapsquareSkybox(scene, chunks[0]);
	// render.addSceneElement({
	// 	getSceneElements() {
	// 		return { sky }
	// 	},
	// });
	// let map = new RSMapChunk(maprect, scene);
	// render.addSceneElement(map);
	// await map.model;

	let player = await playerToModel(scene, "skillbert");
	// let npc = await npcToModel(scene, { id: npcid, head: false });
	let model = new RSModel(player.models, scene);
	// model.setAnimation(player.anims.default);
	render.addSceneElement(model);

	await model.model;
	await delay(1);
	render.setCameraPosition(new Vector3(0, 0.8, 2.5));
	// // render.setCameraPosition(3328, 10, 3008);
	render.setCameraLimits(new Vector3(0, 0.8, 0));
	await dumpimage(render);

	let file = await exportThreeJsGltf(model.loaded!.mesh);
	fs.writeFile("model.glb", Buffer.from(file));

	// await delay(40000);
	filesource.close();
}


async function dumpimage(render: ThreeJsRenderer) {
	let img = await render.takeCanvasPicture(1024, 2048);
	let file = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
		.toFile("test.png");
	console.log(file);
}
