import { app, BrowserWindow, ipcMain } from "electron";
import * as fs from "fs";
import * as updater from "./updater";
import * as path from "path";

/*process.on("uncaughtException", (err) => {
	throw new Error(err);
	process.exit(1);
});*/


app.allowRendererProcessReuse = true;

app.whenReady().then(async () => {
	let cachedir = path.resolve("cache");
	//TODO not sure why we have try/catch here, it's a crash anyway
	try {
		var splash = await createWindow("assets/splash.html", { width: 377, height: 144, frame: false, resizable: false, webPreferences: { nodeIntegration: true } });
	} catch (reason) {
		console.log(reason);
		return;
	}
	updater.on("update-progress", (args) => {
		splash.webContents.send("update-progress", args);
	});
	await updater.run(cachedir);
	//hide instead of close so electron doesn't shut down
	splash.hide();
	try {
		var index = await createWindow(`assets/index.html`, { width: 800, height: 600, frame: false, webPreferences: { nodeIntegration: true, additionalArguments: ["cachedir=" + cachedir] } });
	} catch (reason) {
		console.log(reason);
		return;
	}
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