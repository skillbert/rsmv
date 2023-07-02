import { app, BrowserWindow, powerSaveBlocker, ipcMain } from "electron";
import * as path from "path";

//don't use browser behavoir of blocking gpu access after an opengl crash
app.disableDomainBlockingFor3DAPIs();
//don't give up after 3 crashes! keep trying!
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
//prevent electron from nerfing performance when the window isn't visible
//TODO should probably toggle only when rendering the map
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("js-flags", "--expose-gc");
//these flags only make it worse right now since it prevents a full crash when buffer allocs start failing
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=16384");
app.commandLine.appendSwitch("js-flags", "--max-heap-size=16384");
//needed to read map imagedata from runeapps
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

//for some reason it very crashes very often if using embedded GPU
//so force dedicated GPU if available
// app.commandLine.appendSwitch("force_high_performance_gpu");//only works for mac
//forces dedicated gpu on windows
//https://stackoverflow.com/questions/54464276/how-to-force-discrete-gpu-in-electron-js/63668188#63668188
// process.env.SHIM_MCCOMPAT = '0x800000001';

//prevents computer from sleeping
const id = powerSaveBlocker.start("prevent-app-suspension");
//powerSaveBlocker.stop(id)

let hidden = false;
let exitonend = false;


let args: string[] = [];
let procargs: string[] = [];
let entry = "";
for (let i = 0; i < process.argv.length; i++) {
	let arg = process.argv[i];
	if (procargs.length < 2) {
		//arguments for electron, script args start after 2 non-flag args, electron.exe and script.js
		if (!arg.startsWith("-")) {
			procargs.push(arg);
		}
	} else if (!entry) {
		//our own bootstrap flags, keep reading until get find the entry script
		if (arg.startsWith("-")) {
			if (arg == "--hidden") { hidden = true; }
			if (arg == "--exit") { exitonend = true; }
		} else {
			entry = arg;
		}
	} else {
		//finally the arguments to pass on to the script
		args.push(arg);
	}
}

let argv = ["electron.exe", entry, ...args];

const js = `
document.body.style.background="white";
window.addEventListener("keydown", e => {
	if (e.key == "F5") { document.location.reload(); }
	if (e.key == "F12") { require("electron/renderer").ipcRenderer.send("toggledevtools"); }
});

process.chdir(${JSON.stringify(process.cwd())});
var originalcmd={
	argv:(${JSON.stringify(argv)}),
	cwd:(${JSON.stringify(process.cwd())})
};

let originallog=console.log.bind(console);
let originalwarn=console.warn.bind(console);
let originalerror=console.error.bind(console);

console.log=function(...args){
	require("electron/renderer").ipcRenderer.send("console","log",args.map(q=>q+""));
	originallog(...args);
}
console.warn=function(...args){
	require("electron/renderer").ipcRenderer.send("console","warn",args.map(q=>q+""));
	originalwarn(...args);
}
console.error=function(...args){
	require("electron/renderer").ipcRenderer.send("console","error",args.map(q=>q+""));
	originalerror(...args);
}
window.onerror=e=>console.error(e);
window.onunhandledrejection=e=>console.error(e);
window.onCliCompleted=(code)=>{
	require("electron/renderer").ipcRenderer.send("exit",code);
}

require(${JSON.stringify(path.resolve(process.cwd(), entry))});
`;

console.log(path.resolve(process.cwd(), entry));

(async () => {
	await app.whenReady();

	ipcMain.on("toggledevtools", () => index.webContents.toggleDevTools());
	ipcMain.on("console", (e, type: string, args: any[]) => {
		if (type == "error") { console.error("[renderer]", ...args); }
		else if (type == "warn") { console.warn("[renderer]", ...args); }
		else { console.log("[renderer]", ...args); }
	});
	ipcMain.on("exit", (e, exitcode) => {
		if (exitonend) {
			process.exit(exitcode);
		}
	});

	var index = new BrowserWindow({
		width: 800, height: 600,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			//needed to disable CORS
			webSecurity: false
		},
		show: !hidden
	});
	index.webContents.openDevTools();
	index.loadFile(`assets/headless.html`);
	// index.webContents.openDevTools();
	index.webContents.on("did-finish-load", () => {
		index.webContents.executeJavaScript(js);
	});

	app.on("render-process-gone", (e, target, data) => {
		console.log("render-process-gone", data);
		index.reload();
	});
})();