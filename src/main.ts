import { app, BrowserWindow, dialog, ipcMain } from "electron/main";

//don't use browser behavoir of blocking gpu access after a opengl crash
app.disableDomainBlockingFor3DAPIs();
//don't give up after 3 crashes! keep trying!
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
app.commandLine.appendSwitch("force_high_performance_gpu");//only works for mac

//forces dedicated gpu on windows
//https://stackoverflow.com/questions/54464276/how-to-force-discrete-gpu-in-electron-js/63668188#63668188
process.env.SHIM_MCCOMPAT = '0x800000001';


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
