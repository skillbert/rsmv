
import { exportThreeJsGltf, ThreeJsRenderer } from "../viewer/threejsrender";
import { cliArguments, filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CacheFileSource } from "../cache";
import { EngineCache, ThreejsSceneCache } from "../3d/ob3tothree";
import { CLIScriptOutput, ScriptOutput } from "../viewer/scriptsui";
import { itemToModel, npcToModel, playerToModel, RSMapChunk, RSModel } from "../3d/modelnodes";
import sharp from "sharp";
import { delay } from "../utils";
import { mapsquareSkybox, parseMapsquare } from "../3d/mapsquare";
import { GameCacheLoader } from "../cache/sqlite";
import { Mesh, Vector3, WebGLRendererParameters } from "three";
import { promises as fs } from "fs";
import { Downloader } from "../cache/downloader";
import { polyfillNode } from "./nodegltfplugin";
import { Openrs2CacheSource } from "../cache/openrs2loader";

// polyfillNode();


let cmd = cmdts.command({
	name: "render",
	args: {
		...filesource,
		avatar: cmdts.option({ long: "avatar", type: cmdts.string })
	},
	handler: async (args) => {
		let output = new CLIScriptOutput();
		let src = await args.source();
		if (args.avatar) {
			let ava = await renderAvatar(src, args.avatar);
			fs.writeFile("model.png", ava.imgfile);
			fs.writeFile("model.glb", Buffer.from(ava.modelfile));
		}
	}
});

if (true || __non_webpack_require__.main?.id == module.id) {
	// run(new GameCacheLoader(), 0);
	// cmdts.run(cmd, process.argv.slice(2));
	(async () => {
		try {
			await cmdts.run(cmd, cliArguments());
		} finally {
			window.close();
		}
		// let src = new Openrs2CacheSource("1152");
		// let ava = await renderAvatar(src, "skillbert");
		// fs.writeFile("model.png", ava.imgfile);
		// fs.writeFile("model.glb", Buffer.from(ava.modelfile));
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

export async function renderAvatar(source: CacheFileSource, playername: string) {
	let engine = await EngineCache.create(source);
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
	// let player = await itemToModel(scene, 0);
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
