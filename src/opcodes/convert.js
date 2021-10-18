const fs = require("fs");

function convertType(old) {
    switch (old.type) {
        case "Array":
            return { read: [ "array", convertReadType(old.element_type.readType).read ] };
        case "KVArray":
            return { read: [ "map", convertReadType(old.key_type.readType).read, convertReadType(old.element_type.readType).read ] };
        case "Structure":
            var struct = [ "struct" ];
            for (var i = 0; i < old.fields.length; ++i) struct.push([ old.fields[i].name, convertReadType(old.fields[i].readType).read ]);
            return { read: struct };
        default:
            throw `bugger me jim we have a stray: ${type}`;
            return null;
    }
}

function convertReadType(type) {
    switch (type) {
        case "readString":
            return { read: "string" };
        case "readUSmart":
            return { read: "variable unsigned short" };
        case "readUSmart32":
            return { read: "variable unsigned int" };
        case "readSmart":
            return { read: "variable short" };
        case "readAmbientSound": // Just a guess, need to check this
        case "readSmart32":
            return { read: "variable int" };
        case "readUInt":
            return { read: "unsigned int" };
        case "readInt":
            return { read: "int" };
        case "readUShort":
            return { read: "unsigned short" };
        case "readShort":
            return { read: "short" };
        case "readMaskedIndex":
        case "readBitMaskedData":
        case "readUByte":
            return { read: "unsigned byte" };
        case "readByte":
            return { read: "byte" };
        case "readMorphTable": // Just a guess
        case "readExtendedMorphTable": // Just a guess
        case "readObjectMorphTable": // Just a guess
        case "readObjectExtendedMorphTable": // Just a guess
        case "readUBUSReplacementArray":
            return { read: [ "map", "unsigned byte", "unsigned short" ] };
        case "readUBBArray":
            return { read: [ "array", [ "unsigned byte", "byte" ] ] };
        case "readUBUSArray":
            return { read: [ "array", [ "unsigned byte", "unsigned short" ] ] };
        case "readUSUS":
            return { read: [ "unsigned short", "unsigned short" ] };
        case "readUBUS":
            return { read: [ "unsigned byte", "unsigned short" ] };
        case "read3UByte":
            return { read: [ "unsigned byte", "unsigned byte", "unsigned byte" ] };
        case "read4UByte":
            return { read: [ "unsigned byte", "unsigned byte", "unsigned byte", "unsigned byte" ] };
        case "readTable":
            return { read: "int" }; // TODO
        case "returnTrue":
        case "returnFalse":
            return { read: "bool" };
        default:
            throw `bugger me jim we have a stray: ${type}`;
            return null;
    }
}

function convert(name) {
    var old_file = JSON.parse(fs.readFileSync(`${name}_old.json`));
    var output = {};
    for (var i = 0; i < old_file.length; ++i) {
        var old = old_file[i];
        var opcode = {};
        opcode.name = old.name;
        if ("index" in old) opcode.name += `_${old.index}`;
        var hasReadType = "readType" in old;
        var hasType = "type" in old;
        if (hasReadType || hasType) {
            var type = hasReadType ? convertReadType(old.readType) : convertType(old);
            if (type == null) continue;
            for (var k in type) opcode[k] = type[k];
        }
        output[old.opcode] = opcode;
    }

    /*var s_output = JSON.stringify(output, null, "\t");

    // Format the file in a more condensed fashion
    s_output = s_output.replace(/(.)(?:[\n|\r|\r\n|\n\r]\t\t+)(.)/g, (_, a, b) => { return `${a}${((a == "{" || b == "}") ? "" : " ")}${b}`; }); // Each entry has its own line
    s_output = s_output.replace(/(?:[\n|\r|\r\n|\n\r]\t+)\}\,/g, (_) => { return `},`; }); // Each entry has its own line continued
    s_output = s_output.replace(/(\t*\"\d+\":) (\{\"name\"\: \".+\"\,) \"type\"/g, (_, a, b) => { return `${a.padEnd(8)}${b.padEnd(36)}"type"`; }); // Tab formatting*/

    var unknownCount = 0;
    var s_output = "{\n";
    var delimiter = "";
    for (var opcode in output) {
        var obj = output[opcode];
        if (!obj.name) obj.name = `unknown_${unknownCount++}`;

        // Opcode + Name
        var line = `${delimiter}${`\t"${opcode}":`.padEnd(9)}${`{ "name": "${obj.name}",`.padEnd(37)}`;

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
        s_output += line;
        delimiter = ",\n";
    }
    s_output += "\n}";

    fs.writeFileSync(`${name}.json`, s_output);
}

convert("items");
convert("npcs");
//convert("objects");