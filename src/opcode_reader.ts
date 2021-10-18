type PrimitiveInt = {
	primitive: "int",
	unsigned: boolean,
	bytes: number,
	variable: boolean,
	endianness: "big" | "little"
};
type PrimitiveBool = {
	primitive: "bool"
}
type PrimitiveValue<T> = {
	primitive: "value",
	value: T
}
type PrimitiveString = {
	primitive: "string",
	encoding: "latin1",
	termination: null
}
type PrimitiveSwitch<T> = {
	primitive: "switch",
	offset: number,
	switch: { [op: number]: ChunkType<T> }
}

export type SimplePrimitive<T> = PrimitiveInt | PrimitiveBool | PrimitiveString | PrimitiveValue<T>;
export type Primitive<T> = SimplePrimitive<T> | PrimitiveSwitch<T>;
export type ChunkType<T> = Primitive<T> | string;//keyof typeof typedef;

export type ComposedChunk<T> = ChunkType<T>
	| ["array", ChunkType<T>[]]
	| ["struct", ...[string, ChunkType<T>]]
	| ["map", string, ChunkType<T>]
	| [...ChunkType<T>[]]

export type OpcodeMap = { [opcode: string]: { name: string, read: ComposedChunk<any> } };

export class Reader {
	typedef: { [name: string]: ChunkType<any> };
	opcodes: OpcodeMap;
	_read: typeof _read;
	_readPrimitive: typeof _readPrimitive;
	constructor(typedef, opcodes) {
		this.typedef = typedef;
		this.opcodes = opcodes;
		this._read = _read;
		this._readPrimitive = _readPrimitive;
	}

	/**
	 * @param {Buffer} buffer The decompressed buffer of the item
	 */
	read(bufferin: Buffer) {
		//TODO just use local var scan instead?
		let buffer = bufferin as Buffer & { scan: number };
		var output = {};
		buffer.scan = 0;
		var history: string[] = [];
		try {
			while (buffer.scan < buffer.length - 1) {
				var opcode = buffer.readUInt8(buffer.scan); buffer.scan++;
				//if (opcode == 0x0) break;
				if (!(opcode in this.opcodes)) {
					throw `Unsupported opcode '0x${opcode.toString(16)}' at 0x${(buffer.scan - 1).toString(16)}`;
				}
				//if (opcode == 0x6a) throw `Found morphs_1`;
				history.push(`0x${opcode.toString(16).padStart(2, "0")} (${this.opcodes[opcode].name}) at 0x${(buffer.scan - 1).toString(16).padStart(4, "0")}`);
				output[this.opcodes[opcode].name] = this._read(buffer, this.opcodes[opcode].read);
			}
		} catch (e) {
			console.log(output);
			console.log(history);
			throw e;
		}
		return output;
	}
}

/**
 * @param {Buffer} buffer The decompressed buffer of the item
 */
function _readPrimitive(buffer: Buffer & { scan: number }, primitive: Primitive<any>) {
	if (!("primitive" in primitive)) throw `Invalid primitive definition '${JSON.stringify(primitive)}', needs to specify its datatype (e.g. "primitive": "int")`;
	switch (primitive.primitive) {
		case "bool":
			return buffer.readUInt8(buffer.scan++) == 0x1;
		case "int":
			{
				var hasUnsigned = "unsigned" in primitive;
				var hasBytes = "bytes" in primitive;
				var hasVariable = "variable" in primitive;
				var hasEndianness = "endianness" in primitive;
				if (!(hasUnsigned && hasBytes && hasVariable && hasEndianness)) throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'int' variables need to specify 'unsigned', 'bytes', 'variable', and 'endianness'`;
				if (typeof primitive.unsigned !== "boolean") throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'unsigned' must be a boolean`;
				if (typeof primitive.bytes !== "number") throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'bytes' must be an integer`;
				if (typeof primitive.variable !== "boolean") throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'variable' must be a boolean`;
				if (primitive.endianness !== "big" && primitive.endianness !== "little") throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'endianness' must be "big" or "little"`;
			}
			var unsigned = primitive.unsigned;
			var bytes = primitive.bytes;
			var variable = primitive.variable;
			var endianness = primitive.endianness;
			let output = 0;
			if (variable) {
				var firstByte = buffer.readUInt8(buffer.scan);

				var mask = 0xFF;
				if ((firstByte & 0x80) != 0x80) bytes >>= 1; // Floored division by two when we don't have a continuation bit
				else mask = 0x7F;

				buffer[buffer.scan] &= mask;
				if (!unsigned && (firstByte & 0x40) == 0x40) buffer[buffer.scan] |= 0x80; // If the number is signed and second-most-significant bit is 1, set the most-significant bit to 1 since it's no longer a continuation bit
				output = buffer[`read${unsigned ? "U" : ""}Int${endianness.charAt(0).toUpperCase()}E`](buffer.scan, bytes); buffer.scan += bytes;
				buffer[buffer.scan - bytes] = firstByte; // Set it back to what it was originally
			} else {
				output = buffer[`read${unsigned ? "U" : ""}Int${endianness.charAt(0).toUpperCase()}E`](buffer.scan, bytes); buffer.scan += bytes;
			}
			return output;
		case "string":
			{
				var hasEncoding = "encoding" in primitive;
				if (!hasEncoding) throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'string' variables need to specify 'encoding'`;
				if (typeof primitive.encoding !== "string") throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'encoding' must be a string`;
				if (!(primitive.termination === null || typeof primitive.termination === "number")) throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'termination' must be null or the string's length in bytes`;
			}
			var encoding = primitive.encoding;
			var termination = primitive.termination;
			var end = buffer.scan;
			for (; end < buffer.length; ++end) if ((termination === null && buffer.readUInt8(end) == 0x0) || (end - buffer.scan) == termination) break;
			let outputstr = buffer.toString(encoding, buffer.scan, end);
			buffer.scan = end + 1;
			return outputstr;
		case "switch":
			if (!("offset" in primitive)) throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'switch' variables need to specify an 'offset' to the switch`;
			if (!("switch" in primitive)) throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'switch' variables need to specify a 'switch' table`;
			var firstByte = buffer.readUInt8(buffer.scan + primitive.offset);
			if (!(firstByte.toString() in primitive.switch)) throw `Unexpected byte '${firstByte}' in a value typed as a switch`;
			//TODO
			//@ts-ignore
			if (typeof primitive.switch[firstByte] === "string") return this._readPrimitive(buffer, this.typedef[primitive.switch[firstByte]]);
			return this._readPrimitive(buffer, primitive.switch[firstByte]);
		case "value":
			if (!("value" in primitive)) throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'value' variables need to specify a 'value'`;
			return primitive.value;
		default:
			//@ts-ignore
			throw `Unsupported primitive '${primitive.primitive}' in typedef.json`;
	}
}

/**
 * @param {Buffer} buffer The decompressed buffer of the item
 */
function _read(buffer: Buffer & { scan: number }, readAs: ComposedChunk<any>) {
	const typedef = this.typedef;
	switch (typeof readAs) {
		case "string":
			if (!(readAs in typedef)) throw `Type '${readAs}' not found in typedef.json`;
			var _readAs = readAs;
			for (var aliasStack = 0; typeof readAs == "string" && typeof typedef[readAs] === "string" && aliasStack < 1024; ++aliasStack) readAs = typedef[readAs]; // Aliasing
			//@ts-ignore
			if (typeof typedef[readAs] === "string") throw `Couldn't resolve alias stack for '${_readAs}', perhaps due to an infinite loop - last known alias was '${readAs}'`;
			//@ts-ignore
			return this._readPrimitive(buffer, typedef[readAs]);
		case "object":
			if (!("length" in readAs)) throw `Objects are unsupported as 'read' variables due to inconsistencies in variable order across different languages: ${JSON.stringify(readAs)}`;
			//@ts-ignore
			if (readAs.length == 0) throw `'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(readAs)}`;
			switch (readAs[0]) {
				case "array":
					//@ts-ignore
					if (readAs.length == 1) throw `'read' variables interpretted as an array must contain items: ${JSON.stringify(readAs)}`;
					var output: any[] = [];
					var count = _readPrimitive(buffer, typedef["variable unsigned short"]);//buffer.readUInt8(buffer.scan); buffer.scan++;
					for (var i = 0; i < count; ++i) output.push(this._read(buffer, readAs[1]));
					return output;
				case "map":
					//@ts-ignore
					if (readAs.length == 1) throw `'read' variables interpretted as a map must contain items: ${JSON.stringify(readAs)}`;
					var outputobj: Object = {}
					var keycount = buffer.readUInt8(buffer.scan); buffer.scan++;
					for (var i = 0; i < keycount; ++i) outputobj[this._read(buffer, readAs[1])] = this._read(buffer, readAs[2]);
					return outputobj;
				case "struct":
					//@ts-ignore
					if (readAs.length == 1) throw `'read' variables interpretted as a struct must contain items: ${JSON.stringify(readAs)}`;
					var outputobj: Object = {};
					for (var i = 1; i < readAs.length; ++i) outputobj[readAs[i][0]] = this._read(buffer, readAs[i][1]);
					return outputobj;
				default: // Tuple
					var output: any[] = [];
					for (var i = 0; i < readAs.length; ++i) output.push(this._read(buffer, readAs[i]));
					return output;
			}
		default:
			throw `'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(readAs)}`;
	}
}