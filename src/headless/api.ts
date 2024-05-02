
import { exportThreeJsGltf, ThreeJsRenderer } from "../viewer/threejsrender";
import { CacheFileSource } from "../cache";
import { EngineCache, ThreejsSceneCache } from "../3d/modeltothree";
import { itemToModel, npcToModel, RSModel, SimpleModelInfo } from "../3d/modelnodes";
import { delay } from "../utils";
import { Vector3, WebGLRendererParameters } from "three";
import { appearanceUrl, avatarStringToBytes, avatarToModel } from "../3d/avatar";
import { pixelsToImageFile } from "../imgutils";

//TODO remove bypass cors, since we are in a browser context and the runeapps server isn't cooperating atm
globalThis.fetch = require("node-fetch").default;

export { CacheDownloader } from "../cache/downloader";
export { GameCacheLoader } from "../cache/sqlite";
export { CallbackCacheLoader } from "../cache";
export * as map from "../map/index";
export { ScriptOutput, CLIScriptOutput } from "../scriptrunner";
//export buffer since we're polyfilling it in browsers
export const BufferPoly = Buffer;

export async function runServer(source: CacheFileSource, endpoint: string, auth: string) {
	let backoff = 1;
	while (true) {
		let res = false;
		try {
			res = await runConnection(source, endpoint, auth);
		} catch { }
		if (!res) {
			await delay(backoff * 1000);
			backoff = Math.min(5 * 60, backoff * 2);
		} else {
			await delay(1000);
			backoff = 1;
		}
	}
}


function runConnection(source: CacheFileSource, endpoint: string, auth: string) {
	return new Promise<boolean>(async (done, err) => {
		let engine = await EngineCache.create(source);
		let ws = new WebSocket(endpoint);
		let didopen = false;
		ws.onopen = () => { ws.send(auth); didopen = true; };
		ws.onclose = () => done(didopen);
		ws.onerror = () => done(didopen);
		ws.onmessage = async (msg) => {
			let packet = JSON.parse(msg.data);
			try {
				let scene = await ThreejsSceneCache.create(engine);
				if (packet.type == "player") {
					let ava = await renderAppearance(scene, "player", packet.data);
					ws.send(JSON.stringify({
						reqid: packet.reqid,
						type: "modelbase64",
						data: {
							model: ava.modelfile.toString("base64"),
							image: ava.imgfile.toString("base64")
						}
					}));
				} else if (packet.type == "appearance") {
					let ava = await renderAppearance(scene, "appearance", packet.data);
					ws.send(JSON.stringify({
						reqid: packet.reqid,
						type: "modelbase64",
						data: {
							model: ava.modelfile.toString("base64"),
							image: ava.imgfile.toString("base64")
						}
					}));
				} else {
					throw new Error("unknown packet type " + packet.type);
				}
			}
			catch (e) {
				ws.send(JSON.stringify({
					reqid: packet.reqid,
					type: "err",
					data: e + ""
				}));
			}
		}
	});
}

export function getRenderer(width: number, height: number, extraopts?: WebGLRendererParameters) {
	let opts = Object.assign({ antialias: true, alpha: true } as WebGLRendererParameters, extraopts);

	let cnv: HTMLCanvasElement;
	let ctx: WebGLRenderingContext | undefined = undefined;
	if (typeof HTMLCanvasElement != "undefined") {
		//browser/electron/puppeteer
		cnv = document.createElement("canvas");
		cnv.width = width;
		cnv.height = height;
	} else {
		//nodejs "gl" implementation, currently not maintained
		cnv = {
			width, height,
			clientWidth: width, clientHeight: height,
			addEventListener: event => { },
			removeEventListener: event => { },
			style: {}
		} as any;
		ctx = __non_webpack_require__("gl")(width, height, opts);
	}

	let render = new ThreeJsRenderer(cnv, { context: ctx, ...opts });
	return render;
}

export async function renderAppearance(scene: ThreejsSceneCache, mode: "player" | "appearance" | "item" | "npc", argument: string, headmodel = false) {
	let width = 500;
	let height = 700;
	let render = getRenderer(width, height);
	render.addSceneElement({
		getSceneElements() {
			return { options: { autoFrames: "never", hideFloor: true } };
		}
	});

	let meshdata: SimpleModelInfo<any, any>;
	if (mode == "player" || mode == "appearance") {
		let appearance = argument;
		if (mode == "player") {
			let url = appearanceUrl(argument);
			appearance = await fetch(url).then(q => q.text());
			if (appearance.indexOf("404 - Page not found") != -1) { throw new Error("player avatar not found"); }
		}
		console.log(appearance);
		let ava = await avatarToModel(scene.engine, avatarStringToBytes(appearance), headmodel);
		meshdata = { ...ava, id: argument };
	} else if (mode == "item") {
		if (isNaN(+argument)) { throw new Error("number expected"); }
		meshdata = await itemToModel(scene, +argument);
	} else if (mode == "npc") {
		if (isNaN(+argument)) { throw new Error("number expected"); }
		meshdata = await npcToModel(scene, { id: +argument, head: headmodel });
	} else {
		throw new Error("unknown mode " + mode);
	}
	// let player = await itemToModel(scene, 0);
	let model = new RSModel(scene, meshdata.models, meshdata.name);
	model.setAnimation(meshdata.anims.default);
	render.addSceneElement(model);

	await model.model;
	await delay(1);
	render.setCameraPosition(new Vector3(0, 0.85, 2.75));
	render.setCameraLimits(new Vector3(0, 0.85, 0));

	let modelfile = Buffer.from(await exportThreeJsGltf(render.getModelNode()));
	let img = await render.takeScenePicture();
	let imgfile = await pixelsToImageFile(img, "png", 1);

	render.dispose();

	return { imgfile, modelfile };
}
