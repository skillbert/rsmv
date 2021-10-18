import * as fs from "fs";
import * as opcode_reader from "./opcode_reader";

/**
 * @param {String} opcodePath The path of the opcodes with which to decode the buffer
 * @param {Buffer} buffer The buffer to decode
 */
export function decode(opcodePath: string, buffer: Buffer) {
	//TODO i wasn't aware nodejs json allowed buffers?
	//@ts-ignore
	const typedef = JSON.parse(fs.readFileSync("opcodes/typedef.json"));
	//@ts-ignore
	const _opcodes = JSON.parse(fs.readFileSync(opcodePath));
	var opcodes = {}
	for (var k in _opcodes) opcodes[parseInt(k, 16)] = _opcodes[k];
	return new opcode_reader.Reader(typedef, opcodes).read(buffer);
}
