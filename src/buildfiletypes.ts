import * as fs from "fs";
import * as path from "path";
import * as opcode_reader from "./parser/opcode_reader";
import * as commentjson from "comment-json";
import { maprenderConfigSchema } from "./parser/jsonschemas";

async function buildFileTypes() {

	function compilefolder(subdir: string) {
		//generate config file metas
		let files = fs.readdirSync(path.resolve(basedir, subdir), { withFileTypes: true });
		if (files.some(f => f.isFile() && !path.basename(f.name).match(/\.jsonc?$/))) {
			console.error("non-json files matched, is path wrong?");
		}
		let outsubdir = path.resolve(outdir, subdir);
		fs.mkdirSync(outsubdir, { recursive: true });

		const typedef = commentjson.parse(fs.readFileSync(path.resolve(basedir, "typedef.jsonc"), "utf-8"), undefined, true);
		for (let file of files) {
			if (file.isDirectory()) {
				compilefolder(path.join(subdir, file.name));
				continue;
			}
			if (file.isFile()) {
				let srcfile = path.resolve(basedir, subdir, file.name);
				let objname = path.parse(srcfile).name;
				let jsontext = fs.readFileSync(srcfile, "utf8");
				const opcodes = commentjson.parse(jsontext, undefined, true);
				var typesfile =
					"// GENERATED DO NOT EDIT\n" +
					"// This source data is located at '" + path.relative(outsubdir, srcfile) + "'\n" +
					"// run `npm run filetypes` to rebuild\n\n";
				typesfile += "export type " + objname + " = ";
				try {
					typesfile += opcode_reader.buildParser(null, opcodes as any, typedef as any).getTypescriptType("") + ";\n";
				} catch (e: any) {
					//console.error(e);
					typesfile += "any;\n";
					typesfile += "// " + e.toString().replace(/\n/g, "\n//");
				}
				//I'm sorry, git made me do this
				// typesfile = typesfile.replace(/(?<!\r)\n/g, "\r\n");
				let outfile = path.resolve(outsubdir, objname + ".d.ts");
				fs.writeFileSync(outfile, typesfile);
				// console.log("would write ", outfile);
			}
		}
	}

	let basedir = path.resolve("./src/opcodes");
	let outdir = path.resolve("./generated");
	compilefolder("");

	//other one off files
	fs.writeFileSync(path.resolve(outdir, "maprenderconfig.schema.json"), JSON.stringify(maprenderConfigSchema, undefined, "\t"));
}

buildFileTypes();