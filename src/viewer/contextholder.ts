

import * as datastore from "idb-keyval";
import "./fsapi";

if (module.hot) {
	//never reload this page
	module.hot.accept(() => { });
}

datastore.get("cachefilehandles").then(oldhandle => {
	if (typeof FileSystemHandle != "undefined" && oldhandle instanceof FileSystemHandle && oldhandle.kind == "directory") {
		oldhandle.requestPermission();
	}
});