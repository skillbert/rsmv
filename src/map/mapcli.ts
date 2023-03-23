
import { cliArguments, filesource } from "../cliparser";
import * as cmdts from "cmd-ts";
import { CLIScriptOutput } from "../viewer/scriptsui";
import { runMapRender } from ".";

let cmd = cmdts.command({
	name: "download",
	args: {
		...filesource,
		endpoint: cmdts.option({ long: "endpoint", short: "e" }),
		auth: cmdts.option({ long: "auth", short: "p" }),
		mapid: cmdts.option({ long: "mapid", type: cmdts.number })
	},
	handler: async (args) => {
		let output = new CLIScriptOutput();
		await runMapRender(output, await args.source(), args.endpoint, args.auth, args.mapid, false);
	}
});

(async () => {
	let res = await cmdts.runSafely(cmd, cliArguments());
	if (res._tag == "error") {
		console.error(res.error.config.message);
	} else {
		console.log("cmd completed", res.value);
	}
})();