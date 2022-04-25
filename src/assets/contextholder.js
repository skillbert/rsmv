//Very simple service worker whose only purpose is to hold on to a reference
//of the cache fs handle while the main window reloads. Without holding
//this reference the fs handle will become invalid and require user permission
//again immediately upon reloading the main page, however service workers stay
//around for several seconds after closing a tab and therefore bridge the gap.


let filehandle = null;

setInterval(() => {
	filehandle?.requestPermission();
}, 1000 * 60);

onmessage = (e) => {
	if (typeof e.data == "object") {
		if (e.data.type == "sethandle") {
			filehandle = e.data.handle;
			globalThis.filehandle = filehandle;
		}
	}
}