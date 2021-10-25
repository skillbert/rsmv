import { app, BrowserWindow, ipcMain } from "electron";
import * as fs from "fs";
import * as updater from "./updater";
import * as path from "path";

/*process.on("uncaughtException", (err) => {
	throw new Error(err);
	process.exit(1);
});*/
console.log(process.argv);

app.allowRendererProcessReuse = false;//messes up fs

app.whenReady().then(async () => {
	//skip command line arguments until we find two args that aren't flags (electron.exe and the main script)
	//we have to do this since electron also includes flags like --inspect in argv
	let args = process.argv.slice();
	for (let skip = 2; skip > 0 && args.length > 0; args.shift()) {
		if (!args[0].startsWith("-")) { skip--; }
	}
	let cachedir = path.resolve(args[0] ?? "cache");

	var splash = await createWindow("assets/splash.html", { width: 377, height: 144, frame: false, resizable: false, webPreferences: { nodeIntegration: true } });

	updater.on("update-progress", (args) => {
		splash.webContents.send("update-progress", args);
	});
	await updater.run(cachedir);
	//hide instead of close so electron doesn't shut down
	splash.hide();
	var index = await createWindow(`assets/index.html`, { width: 800, height: 600, frame: false, webPreferences: { nodeIntegration: true, additionalArguments: ["cachedir=" + cachedir] } });

	index.webContents.openDevTools({ mode: "detach" });
	splash.close();
	ipcMain.on("request-load-model", (event, modelId: number) => {
		fs.readFile(`${cachedir}/models/${modelId}.ob3`, (e, data) => {
			if (e) {
				switch (e.errno) {
					case -4058:
						console.log(`Could not locate model id ${modelId}`);
					default:
						console.log(`Something went wrong when attempting to open ${modelId}`);
				}
			} else {
				index.webContents.send("model-loaded", data);
			}
		});
	});
});

async function createWindow(page: string, options: Electron.BrowserWindowConstructorOptions) {
	const window = new BrowserWindow(options);
	await window.loadFile(page);
	return window;
}

app.on("window-all-closed", () => {
	// MacOS stuff I guess?
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	// MacOS stuff I guess?
	if (BrowserWindow.getAllWindows().length === 0) {
		//TODO this doesn't make any sense
		//@ts-ignore
		createWindow();
	}
});



// 135 795
// 135 943


// Oak 5
// Beech 5
// Hickory 5
// Yew 6
// Birch 5
// Ash 5