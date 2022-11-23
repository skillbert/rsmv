import { app, BrowserWindow } from "electron/main";


(async () => {

	await app.whenReady();

	var index = new BrowserWindow({
		width: 800, height: 600,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			devTools: true
		}
	});
	await index.loadFile("assets/headlesselectron.html");
})();