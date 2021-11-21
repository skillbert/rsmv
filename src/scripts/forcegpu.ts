
import { spawn } from "child_process";

//apparently it gives the path if you import it from nodejs
let electronexe = require("electron");

if (typeof electronexe != "string") {
	console.log("this script needs to be run in nodejs");
	process.exit(1);
}

(async function () {
	//https://stackoverflow.com/questions/54464276/how-to-force-discrete-gpu-in-electron-js/63668188#63668188
	// Restart with force using the dedicated GPU
	let newenv = {
		...process.env,
		SHIM_MCCOMPAT: '0x800000001' // this forces windows to use the dedicated GPU for the process
	}
	let child = spawn(electronexe, process.argv.slice(2), { env: newenv });
	await new Promise(d => child.once("exit", d));

	process.exit(0);
})();