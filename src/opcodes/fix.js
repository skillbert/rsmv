const fs = require("fs");

function fix(filename) {
    var old = JSON.parse(fs.readFileSync(`${filename}_old.json`));
    var toFix = JSON.parse(fs.readFileSync(`${filename}.json`));
    var replace = {};
    for (var i = 0; i < old.length; ++i) {
        var opcode = old[i].opcode;
        if (filename === "objects") opcode = `0x${parseInt(opcode).toString(16).toUpperCase().padStart(2, "0")}`;
        if (old[i].readType === "returnTrue") replace[opcode] = "true";
        else if (old[i].readType === "returnFalse") replace[opcode] = "false";
    }
    for (var k in toFix) {
        if (k in replace) {
            toFix[k].read = replace[k];
        }
    }
    fs.writeFileSync(`${filename}.json`, JSON.stringify(toFix));
}

fix("items");
fix("npcs");
fix("objects");
require("./format");