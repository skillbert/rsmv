
export { handle as Item } from "./handler_items";
export { handle as NPC } from "./handler_npcs";
export { handle as Object } from "./handler_objects";

/*const fs = require("fs");
// fs.readdir("items/", (err, files) => {
//     for (var i = 0; i < files.length; ++i) {
//         module.exports.Item(null, fs.readFileSync(`items/${files[i]}`));
//     }
// });

[   //{ folder: "items/", handler: module.exports.Item },
	//{ folder: "npcs/", handler: module.exports.NPC },
	{ folder: "objects/", handler: module.exports.Object }
].forEach((iter) => {
	fs.readdir(iter.folder, (err, files) => {
		for (var i = 0; i < files.length; ++i) {
			try {
				console.log(iter.handler(null, fs.readFileSync(`${iter.folder}${files[i]}`)));
			} catch (e) {
				console.log(files[i]);
				console.log(e);
				break;
			}
			if (i > 10) break;
		}
	});
});*/