
import { app, BrowserWindow, powerSaveBlocker } from "electron";
import { runCliApplication, mapareasource } from "../cliparser";

app.allowRendererProcessReuse = false;

//don't use browser behavoir of blocking gpu access after a opengl crash
app.disableDomainBlockingFor3DAPIs();
//don't give up after 3 crashes! keep trying!
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
//prevent electron from nerfing performance when the window isn't visible
//TODO should probably toggle only when rendering the map
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("force_high_performance_gpu");//only works for mac

//forces dedicated gpu on windows
//https://stackoverflow.com/questions/54464276/how-to-force-discrete-gpu-in-electron-js/63668188#63668188
process.env.SHIM_MCCOMPAT = '0x800000001';

//prevents computer from sleeping
const id = powerSaveBlocker.start("prevent-app-suspension");
//powerSaveBlocker.stop(id)

function btoa(str: string) {
	return Buffer.from(str).toString("base64");
}

(async () => {
	await app.whenReady();
	var index = new BrowserWindow({
		width: 800, height: 600,
		webPreferences: {
			enableRemoteModule: true,
			nodeIntegration: true,
			contextIsolation: false
		}
	});
	await index.loadFile("../assets/maprenderer.html", {
		search: `?argv=${btoa(JSON.stringify(process.argv))}&cwd=${btoa(process.cwd())}`
	});
	index.webContents.openDevTools();
})();