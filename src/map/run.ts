
import { app, BrowserWindow, powerSaveBlocker, ipcMain } from "electron";
import { runCliApplication, mapareasource } from "../cliparser";

//don't use browser behavoir of blocking gpu access after an opengl crash
app.disableDomainBlockingFor3DAPIs();
//don't give up after 3 crashes! keep trying!
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
//prevent electron from nerfing performance when the window isn't visible
//TODO should probably toggle only when rendering the map
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
//actually want our embedded graphics since it has more video memory (all of our RAM)
// app.commandLine.appendSwitch("force_high_performance_gpu");//only works for mac

//forces dedicated gpu on windows
//https://stackoverflow.com/questions/54464276/how-to-force-discrete-gpu-in-electron-js/63668188#63668188
// process.env.SHIM_MCCOMPAT = '0x800000001';

//prevents computer from sleeping
const id = powerSaveBlocker.start("prevent-app-suspension");
//powerSaveBlocker.stop(id)

function btoa(str: string) {
	return Buffer.from(str).toString("base64");
}

(async () => {
	await app.whenReady();
	
	ipcMain.handle("getargv", () => ({ argv: process.argv, cwd: process.cwd() }));
	ipcMain.on("toggledevtools", () => index.webContents.toggleDevTools());

	var index = new BrowserWindow({
		width: 800, height: 600,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	});
	await index.loadFile("assets/maprenderer.html");
	index.webContents.openDevTools();

	app.on("render-process-gone", (e, target, data) => {
		console.log("render-process-gone", data);
		// index.reload();
	});
})();