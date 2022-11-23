
import { ThreeJsRenderer } from "../viewer/threejsrender";
import { filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CacheFileSource } from "../cache";
import { EngineCache, ThreejsSceneCache } from "../3d/ob3tothree";
import { CLIScriptOutput, ScriptOutput } from "../viewer/scriptsui";
import { npcToModel, RSMapChunk, RSModel } from "../3d/modelnodes";
import sharp from "sharp";
import { delay } from "../utils";
import { mapsquareSkybox, parseMapsquare } from "../3d/mapsquare";
import { GameCacheLoader } from "../cache/sqlite";
import { WebGLRendererParameters } from "three";



import * as gl from "gl";

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


// cmdts.run(cmd, process.argv.slice(2));


globalThis.requestAnimationFrame = (cb: Function) => setTimeout(cb, 50, Date.now() + 50);
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

async function run(filesource: CacheFileSource, npcid: number) {
	let engine = await EngineCache.create(filesource);
	let scene = new ThreejsSceneCache(engine);

	let width = 500;
	let height = 500;

	let opts: WebGLRendererParameters = { antialias: true, alpha: false };

	let cnv: HTMLCanvasElement;
	let ctx: WebGLRenderingContext | undefined = undefined;
	if (typeof document != "undefined") {
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


	let render = new ThreeJsRenderer(cnv, {
		context: ctx,
		...opts
	});

	globalThis.render = render;

	let maprect = { x: 52, z: 47, xsize: 1, zsize: 1 };
	let { grid, chunks } = await parseMapsquare(engine, maprect, {});
	let sky = await mapsquareSkybox(scene, chunks[0]);
	render.addSceneElement({
		getSceneElements() {
			return { sky }
		},
	});
	// let map = new RSMapChunk(maprect, scene);
	// render.addSceneElement(map);

	let npc = await npcToModel(scene, { id: npcid, head: false });
	render.addSceneElement(new RSModel(npc.models, scene));

	await delay(5000);
	while (true) {
		await delay(500);
		render.render();
		dumpimage(render);
	}
}


async function dumpimage(render: ThreeJsRenderer) {
	let img = await render.takeCanvasPicture(500, 500);
	let file = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
		.toFile("test.png");
	console.log(file);
}

globalThis.dumpimage = dumpimage;

run(new GameCacheLoader(), 0); 