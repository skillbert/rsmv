
import { cliArguments, filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { renderAppearance, runServer } from ".";
import { EngineCache, ThreejsSceneCache } from "3d/ob3tothree";
import { promises as fs } from "fs";

let cmd = cmdts.command({
	name: "render",
	args: {
		...filesource,
		model: cmdts.option({ long: "model", short: "m", defaultValue: () => "" }),
		head: cmdts.flag({ long: "head" }),
		endpoint: cmdts.option({ long: "endpoint", short: "e", defaultValue: () => "" }),
		auth: cmdts.option({ long: "auth", short: "p", defaultValue: () => "" })
	},
	handler: async (args) => {
		let src = await args.source();
		if (args.endpoint) {
			await runServer(src, args.endpoint, args.auth);
		} else {
			let engine = await EngineCache.create(src);
			let scene = new ThreejsSceneCache(engine);

			let modelparts = args.model.split(":");

			let ava = await renderAppearance(scene, modelparts[0] as any, modelparts[1], args.head);
			await fs.writeFile("model.png", ava.imgfile);
			await fs.writeFile("model.glb", Buffer.from(ava.modelfile));
		}
	}
});

if (true || __non_webpack_require__.main?.id == module.id) {
	(async () => {
		try {
			await cmdts.runSafely(cmd, cliArguments());
		} finally {
			// window.close();
		}
	})()
}