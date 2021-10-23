import * as fs from "fs";
import * as opcode_reader from "./opcode_reader";

/**
 * @param {String} opcodePath The path of the opcodes with which to decode the buffer
 * @param {Buffer} buffer The buffer to decode
 */
export function decode(opcodePath: string, buffer: Buffer) {
	//TODO i wasn't aware nodejs json allowed buffers?
	//TODO don't actually read and decode these files for every single run!
	const typedef = JSON.parse(fs.readFileSync("opcodes/typedef.json", "utf-8"));
	const _opcodes = JSON.parse(fs.readFileSync(opcodePath, "utf-8"));
	var opcodes = {}
	for (var k in _opcodes) opcodes[parseInt(k, 16)] = _opcodes[k];
	return new opcode_reader.Reader(typedef, opcodes).read(buffer);
}

export function encode(opcodePath: string, json: Object) {
	//TODO i wasn't aware nodejs json allowed buffers?
	//TODO don't actually read and decode these files for every single run!
	const typedef = JSON.parse(fs.readFileSync("opcodes/typedef.json", "utf-8"));
	const _opcodes = JSON.parse(fs.readFileSync(opcodePath, "utf-8"));
	var opcodes = {}
	for (var k in _opcodes) opcodes[parseInt(k, 16)] = _opcodes[k];
	return new opcode_reader.Reader(typedef, opcodes).write(json);
}
