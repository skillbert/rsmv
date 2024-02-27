import * as fs from "fs";
import * as path from "path";
import * as opcode_reader from "./opcode_reader";
import * as commentjson from "comment-json";
import { maprenderConfigSchema } from "./jsonschemas";

async function buildFileTypes() {
	let basedir = path.resolve("./src/opcodes");
	let outdir = path.resolve("./generated");

	//generate config file metas
	let files = fs.readdirSync(basedir);
	if (files.some(f => !path.basename(f).match(/\.jsonc?$/))) {
		console.error("non-json files matched, is path wrong?");
	}
	const typedef = commentjson.parse(fs.readFileSync(path.resolve(basedir, "typedef.jsonc"), "utf-8"), undefined, true);
	for (let file of files) {
		let srcfile = path.resolve(basedir, file);
		let objname = path.parse(srcfile).name;
		let jsontext = fs.readFileSync(srcfile, "utf8");
		const opcodes = commentjson.parse(jsontext, undefined, true);
		var typesfile =
			"// GENERATED DO NOT EDIT\n" +
			"// This source data is located at '" + path.relative(outdir, srcfile) + "'\n" +
			"// run `npm run filetypes` to rebuild\n\n";
		typesfile += "export type " + objname + " = ";
		try {
			typesfile += opcode_reader.buildParser(null, opcodes as any, typedef as any).getTypescriptType("") + ";\n";
		} catch (e) {
			//console.error(e);
			typesfile += "any;\n";
			typesfile += "// " + e.toString().replace(/\n/g, "\n//");
		}
		//I'm sorry, git made me do this
		typesfile = typesfile.replace(/(?<!\r)\n/g, "\r\n");
		let outfile = path.resolve(outdir, objname + ".d.ts");
		fs.writeFileSync(outfile, typesfile);
	}

	//other one off files
	fs.writeFileSync(path.resolve(outdir, "maprenderconfig.schema.json"), JSON.stringify(maprenderConfigSchema, undefined, "\t"));
}

buildFileTypes();