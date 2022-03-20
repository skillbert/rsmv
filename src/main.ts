import { app, BrowserWindow, ipcMain, powerSaveBlocker } from "electron/main";
import * as updater from "./updater";
import * as downloader from "./downloader";
import * as gamecache from "./cache";
import { GameCacheLoader } from "./cacheloader";
import * as argparser from "./cliparser";
import { command } from "cmd-ts";

//having reused renderen processes breaks the node fs module
//this still hasn't been fixed in electron
// app.allowRendererProcessReuse = false;

//don't use browser behavoir of blocking gpu access after a opengl crash
app.disableDomainBlockingFor3DAPIs();
//don't give up after 3 crashes! keep trying!
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
app.commandLine.appendSwitch("force_high_performance_gpu");//only works for mac

//forces dedicated gpu on windows
//https://stackoverflow.com/questions/54464276/how-to-force-discrete-gpu-in-electron-js/63668188#63668188
process.env.SHIM_MCCOMPAT = '0x800000001';

//show a nice loading window while updating our local cache
let loadingwnd: BrowserWindow | null = null;
argparser.setLoadingIndicator({
	interval: 20,
	start: async () => {
		loadingwnd = await createWindow("assets/splash.html", {
			width: 377, height: 144, frame: false, resizable: false,
			webPreferences: {
				nodeIntegration: true,
				//TODO also make this depend on if we are rendering the map or not
				backgroundThrottling: false
			},
		});
		//TODO add a way to stop the updating process by closing the window
		//can currently only be stopped by canceling from the command line
	},
	progress: args => {
		loadingwnd!.webContents.send("update-progress", args);
	},
	done: async () => {
		loadingwnd!.close();
		loadingwnd = null;
	}
});


app.whenReady().then(() => argparser.runCliApplication(cmd));

let cmd = command({
	name: "run",
	args: {
		...argparser.filesource
	},
	handler: async (args) => {
		let viewerFileSource = await args.source();
		//expose to global for debugging
		(global as any).loader = viewerFileSource;

		//don't remove this await (not sure why typescript want to get rid of it)

		ipcMain.handle("load-cache-file", async (e, major: number, fileid: number) => {
			if (viewerFileSource instanceof downloader.Downloader) {
				if (viewerFileSource.closed) {
					viewerFileSource = new downloader.Downloader();
					(global as any).loader = viewerFileSource;
				}
			}
			if (viewerFileSource instanceof GameCacheLoader) {
				//redirect png textures to dds textures
				if (major == 53) { major = 52; }
			}
			let file = await viewerFileSource.getFileById(major, fileid);
			return file;
		});

		var index = await createWindow(`assets/index.html`, {
			width: 800, height: 600,// frame: false,
			webPreferences: {
				// enableRemoteModule: true,
				nodeIntegration: true,
				contextIsolation: false,
			}
		});
	}
});

async function createWindow(page: string, options: Electron.BrowserWindowConstructorOptions) {
	const window = new BrowserWindow(options);
	window.webContents.openDevTools();
	await window.loadFile(page);
	return window;
}

app.on("window-all-closed", () => {
	//prevent shutdown until all scripts are done
	//TODO allow some way to exit updater?
	// return;
	// MacOS stuff I guess?
	if (process.platform !== "darwin") {
		app.quit();
	}
});
