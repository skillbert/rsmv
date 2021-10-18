const fs = require("fs");
const handler = require("./handler_items").handle;
// fs.readdir("items/", (err, files) => {
//     for (var i = 0; i < files.length; ++i) {
//         module.exports.Item(null, fs.readFileSync(`items/${files[i]}`));
//     }
// });

var filename = process.argv[2];
console.log(filename);
try {
    console.log(handler(null, fs.readFileSync(`items/${filename}.rsitem`)));
} catch (e) {
    console.log(filename);
    console.log(e);
}