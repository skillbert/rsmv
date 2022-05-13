import { app, BrowserWindow, dialog, ipcMain } from "electron/main";

//don't use browser behavoir of blocking gpu access after a opengl crash
app.disableDomainBlockingFor3DAPIs();
//don't give up after 3 crashes! keep trying!
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
app.commandLine.appendSwitch("force_high_performance_gpu");//only works for mac

//forces dedicated gpu on windows
//https://stackoverflow.com/questions/54464276/how-to-force-discrete-gpu-in-electron-js/63668188#63668188
process.env.SHIM_MCCOMPAT = '0x800000001';

//TODO just get rid of the whole download everything before use thing
//show a nice loading window while updating our local cache
// let loadingwnd: BrowserWindow | null = null;
// argparser.setLoadingIndicator({
// 	interval: 20,
// 	start: async () => {
// 		let wnd = new BrowserWindow({
// 			width: 377, height: 144, frame: false, resizable: false,
// 			webPreferences: {
// 				nodeIntegration: true,
// 				//TODO also make this depend on if we are rendering the map or not
// 				backgroundThrottling: false
// 			},
// 		});
// 		await wnd.loadFile("assets/splash.html");
// 		loadingwnd = wnd;
// 		//TODO add a way to stop the updating process by closing the window
// 		//can currently only be stopped by canceling from the command line
// 	},
// 	progress: args => {
// 		loadingwnd!.webContents.send("update-progress", args);
// 	},
// 	done: async () => {
// 		loadingwnd!.close();
// 		loadingwnd = null;
// 	}
// });



app.whenReady().then(async () => {
	var index = new BrowserWindow({
		width: 800, height: 600,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
		}
	});
	index.webContents.openDevTools();
	await index.loadFile(`assets/index.html`);

	ipcMain.handle("openfolder", async (e, startfolder?: string) => {
		return dialog.showOpenDialog(index, { properties: ["openDirectory"], defaultPath: startfolder });
	});
});

app.on("window-all-closed", () => {
	//prevent shutdown until all scripts are done
	//TODO allow some way to exit updater?
	// return;
	// MacOS stuff I guess?
	if (process.platform !== "darwin") {
		app.quit();
	}
});
