//Very simple service worker with two hacky purposes

//1. To hold on to a reference of the cache fs handle while the main window reloads.
// Without holding this reference the fs handle will become invalid and require user
// permission again immediately upon reloading the main page, however service workers
// stay around for several seconds after closing a tab and therefore bridge the gap.

//2. To serve download `ReadableStream`s as if they are downloaded from a server,
// this turns out to be the only way to download a stream without loading the full
// contents in memory first.

/**@type {ServiceWorkerGlobalScope} */
let sw = self;
sw.skipWaiting();

/** @type {FileSystemDirectoryHandle|null} */
let filehandle = null;

/**@type {Map<string,ReadableStream>} */
let downloads = new Map();

setInterval(() => {
	filehandle?.queryPermission();
}, 1000 * 60);

sw.onmessage = (e) => {
	if (typeof e.data == "object") {
		if (e.data.type == "sethandle") {
			filehandle = e.data.handle;
			globalThis.filehandle = filehandle;
		}
		if (e.data.type == "servedata") {
			downloads.set(e.data.url, e.data.stream);
		}
	}
}

sw.onfetch = async (e) => {
	let download = downloads.get(e.request.url);
	if (download) {
		let res = new Response(download, {
			headers: {
				"Content-Type": "application/octet-stream; charset=utf-8",
				"Content-Disposition": "attachment"
			}
		});
		e.respondWith(res);
		downloads.delete(e.request.url);
	}
}

