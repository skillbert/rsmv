const fs = require("fs");

function format(name) {
    var file = JSON.parse(fs.readFileSync(`${name}.json`));
    var output = "{\n";
    var delimiter = "";
    Object.keys(file).sort().forEach((opcode) => {
        var obj = file[opcode];
        if (!obj.name || obj.name.match(/^unk(?:nown)?.*$/)) obj.name = `unknown_${opcode.slice(2)}`;

        // Opcode + Name
        var line = `${delimiter}${`\t"${opcode}":`.padEnd(9)}${`{ "name":${`"${obj.name.replace(/\s/g, "")}", `.padStart(40)}`}`;

        // Type
        if ((typeof obj.read) === "string")
            line += `"read": "${obj.read}"${"typeSpec" in obj ? "," : ""}`.padEnd("typeSpec" in obj ? 17 : 0);
        else if ((typeof obj.read) === "object" && "length" in obj.read) {
            line += `"read": [`;
            for (var i = 0; i < obj.read.length; ++i)
                line += `${i == 0 ? " " : `, `}${JSON.stringify(obj.read[i]).replace(/,/g, ", ")}`;
            line += " ]";
        }
        else
            line += "tripabitchup"; // TODO: Unimplemented

        line += " }";
        output += line;
        delimiter = ",\n";
    });
    output += "\n}";

    fs.writeFileSync(`${name}.json`, output);
}

format("items");
format("npcs");
format("objects");