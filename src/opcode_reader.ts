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
type PrimitiveSwitch = {
	primitive: "switch",
	offset: number,
	switch: { [op: number]: string }
}

export type SimplePrimitive<T> = PrimitiveInt | PrimitiveBool | PrimitiveString | PrimitiveValue<T>;
export type Primitive<T> = SimplePrimitive<T> | PrimitiveSwitch;
export type ChunkType<T> = Primitive<T> | string;//keyof typeof typedef;

export type SimpleComposedChunk = string
	| ["array", ComposedChunk[]]
	| ["map", string, ComposedChunk]
	| [...ComposedChunk[]]
//typescript complains about circular refence otherwise if these aren't split up
export type ComposedChunk = SimpleComposedChunk
	| ["struct", ...([string, SimpleComposedChunk])[]]


export type OpcodeMap = { [opcode: string]: { name: string, read: ComposedChunk } };

type TypeDef = { [name: string]: ChunkType<any> };

export class Reader {
	typedef: TypeDef;
	opcodes: OpcodeMap;
	//TODO this is kinda dumb
	_read = _read;
	_readPrimitive = _readPrimitive;
	_write = _write;
	_writePrimitive = _writePrimitive;
	constructor(typedef: TypeDef, opcodes: OpcodeMap) {
		this.typedef = typedef;
		this.opcodes = opcodes;
	}

	/**
	 * @param {Buffer} buffer The decompressed buffer of the item
	 */
	read(bufferin: Buffer) {
		let buffer = bufferin as Buffer & { scan: number };
		var output = {};
		buffer.scan = 0;
		var history: string[] = [];
		try {
			//TODO why is last terminating byte skipped?
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
	write(obj: Object) {
		let buffer = Buffer.alloc(10 * 1024) as Buffer & { scan: number };
		buffer.scan = 0;
		for (let prop in obj) {
			//TODO move this logic to a reverse lookup map
			let op: ComposedChunk | null = null;
			let opcodeid = 0;
			for (let opcode in this.opcodes) {
				if (this.opcodes[opcode].name == prop) {
					op = this.opcodes[opcode].read;
					opcodeid = +opcode;
				}
			}
			if (!op) {
				throw new Error(`no opcode found for prop ${prop}`);
			}
			buffer.writeUInt8(opcodeid, buffer.scan++);
			this._write(buffer, op, obj[prop]);
		}
		buffer.writeUInt8(0x00, buffer.scan++);
		
		return buffer.slice(0, buffer.scan);
	}
}

/**
 * @param {Buffer} buffer The decompressed buffer of the item
 */
function _readPrimitive(this: Reader, buffer: Buffer & { scan: number }, primitive: Primitive<any>) {
	if (!("primitive" in primitive)) throw `Invalid primitive definition '${JSON.stringify(primitive)}', needs to specify its datatype (e.g. "primitive": "int")`;
	switch (primitive.primitive) {
		case "bool":
			let boolint = buffer.readUInt8(buffer.scan++);
			if (boolint != 1 && boolint != 0) throw `value parsed as bool was not 0x00 or 0x01`
			return boolint != 0;
		case "int":
			validateIntType(primitive);
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
			validateStringType(primitive);
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

			return this._read(buffer, primitive.switch[firstByte]);
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
function _read(this: Reader, buffer: Buffer & { scan: number }, readAs: ComposedChunk) {
	const typedef = this.typedef;
	switch (typeof readAs) {
		case "string":
			return this._readPrimitive(buffer, resolveAlias(readAs, typedef));
		case "object":
			if (!Array.isArray(readAs)) throw `Objects are unsupported as 'read' variables due to inconsistencies in variable order across different languages: ${JSON.stringify(readAs)}`;
			if (readAs.length == 0) throw `'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(readAs)}`;
			switch (readAs[0]) {
				case "array":
					if (readAs.length == 1) throw `'read' variables interpretted as an array must contain items: ${JSON.stringify(readAs)}`;
					var output: any[] = [];
					var count = this._readPrimitive(buffer, resolveAlias("variable unsigned short", typedef));//buffer.readUInt8(buffer.scan); buffer.scan++;
					for (var i = 0; i < count; ++i) output.push(this._read(buffer, readAs[1]));
					return output;
				case "map":
					if (readAs.length == 1) throw `'read' variables interpretted as a map must contain items: ${JSON.stringify(readAs)}`;
					var outputobj: Object = {}
					var keycount = buffer.readUInt8(buffer.scan); buffer.scan++;
					for (var i = 0; i < keycount; ++i) outputobj["$"+this._read(buffer, readAs[1])] = this._read(buffer, readAs[2]);
					return outputobj;
				case "struct":
					if (readAs.length == 1) throw `'read' variables interpretted as a struct must contain items: ${JSON.stringify(readAs)}`;
					var outputobj: Object = {};
					for (var i = 1; i < readAs.length; ++i) {
						let [name, type] = readAs[i] as [string, ComposedChunk];
						outputobj[name] = this._read(buffer, type);
					}
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

function resolveAlias(typename: string, typedef: TypeDef) {
	let newtype: Primitive<any> | string = typename;
	for (let redirects = 0; redirects < 1024; redirects++) {
		if (!Object.prototype.hasOwnProperty.call(typedef, newtype)) {
			throw `Type '${typename}' not found in typedef.json`;
		}
		newtype = typedef[newtype];
		if (typeof newtype != "string") {
			return newtype;
		}
	}
	throw `Couldn't resolve alias stack for '${typename}', perhaps due to an infinite loop - last known alias was '${newtype!}'`;
}
function _write(this: Reader, buffer: Buffer & { scan: number }, writeAs: ComposedChunk, value: unknown) {
	const typedef = this.typedef;
	switch (typeof writeAs) {
		case "string":
			return this._writePrimitive(buffer, resolveAlias(writeAs, typedef), value);
		case "object":
			if (!Array.isArray(writeAs)) throw `Objects are unsupported as 'read' variables due to inconsistencies in variable order across different languages: ${JSON.stringify(writeAs)}`;
			if (writeAs.length == 0) throw `'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(writeAs)}`;
			switch (writeAs[0]) {
				case "array":
					if (writeAs.length == 1) throw `'read' variables interpretted as an array must contain items: ${JSON.stringify(writeAs)}`;
					if (!Array.isArray(value)) throw `array expected`;
					this._writePrimitive(buffer, resolveAlias("variable unsigned short", typedef), value.length);
					for (let val of value) {
						this._write(buffer, writeAs[1], val);
					}
					break;
				case "map":
					if (writeAs.length == 1) throw `'read' variables interpretted as a map must contain items: ${JSON.stringify(writeAs)}`;
					if (typeof value != "object" || !value) throw `object expected`;

					buffer.writeUInt8(Object.keys(value).length, buffer.scan++);
					for (let key of Object.keys(value)) {
						this._write(buffer, writeAs[1], +key.slice(1));
						this._write(buffer, writeAs[2], value[key]);
					}
					break;
				case "struct":
					if (writeAs.length == 1) throw `'read' variables interpretted as a struct must contain items: ${JSON.stringify(writeAs)}`;
					if (typeof value != "object" || !value) throw `object expected`;
					for (var i = 1; i < writeAs.length; ++i) {
						let [name, type] = writeAs[i] as [string, ComposedChunk];
						this._write(buffer, type, value[name]);
					}
					break;
				default: // Tuple
					if (!Array.isArray(value)) throw `array expected`;
					if (value.length != writeAs.length) throw `wrong number of values in tuple, ${value.length} received, ${writeAs.length} expected`;
					for (var i = 0; i < writeAs.length; ++i) {
						this._write(buffer, writeAs[i], value[i]);
					}
					break;
			}
			break;
		default:
			throw `'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(writeAs)}`;
	}
}

//TODO validate these at startup instead of during decode/encode?
function validateIntType(primitive: PrimitiveInt) {
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

function validateStringType(primitive: PrimitiveString) {
	var hasEncoding = "encoding" in primitive;
	if (!hasEncoding) throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'string' variables need to specify 'encoding'`;
	if (typeof primitive.encoding !== "string") throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'encoding' must be a string`;
	if (!(primitive.termination === null || typeof primitive.termination === "number")) throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'termination' must be null or the string's length in bytes`;
}

function _writePrimitive(this: Reader, buffer: Buffer & { scan: number }, primitive: Primitive<any>, value: unknown) {
	if (!("primitive" in primitive)) throw `Invalid primitive definition '${JSON.stringify(primitive)}', needs to specify its datatype (e.g. "primitive": "int")`;
	switch (primitive.primitive) {
		case "bool":
			if (typeof value != "boolean") throw `boolean expected`;
			buffer.writeUInt8(value ? 1 : 0, buffer.scan++);
			break;
		case "int":
			if (typeof value != "number" || value % 1 != 0) throw `integer expected`;
			validateIntType(primitive);
			var unsigned = primitive.unsigned;
			var bytes = primitive.bytes;
			var variable = primitive.variable;
			var endianness = primitive.endianness;
			let output = 0;
			if (variable) {
				if (endianness != "big") throw `variable length int only accepts big endian`;
				let fitshalf = true;
				if (unsigned) {
					if (value >= 1 << (bytes * 4 - 1)) { fitshalf = false; }
				} else {
					if (value >= 1 << (bytes * 4 - 2)) { fitshalf = false; }
					if (value < -1 << (bytes * 4 - 2)) { fitshalf = false; }
				}

				if (fitshalf) bytes >>= 1; // Floored division by two when we don't have a continuation bit

				let mask = ~(~0 << (bytes * 8 - 1));
				let int = (value & mask) | ((fitshalf ? 0 : 1) << (bytes * 8 - 1));
				//always write as signed since bitwise operations in js cast to int32
				buffer[`writeIntBE`](int, buffer.scan, bytes);
				buffer.scan += bytes;
			} else {
				output = buffer[`write${unsigned ? "U" : ""}Int${endianness.charAt(0).toUpperCase()}E`](value, buffer.scan, bytes);
				buffer.scan += bytes;
			}
			break;
		case "string":
			if (typeof value != "string") throw `string expected`;
			validateStringType(primitive);
			var encoding = primitive.encoding;
			var termination = primitive.termination;
			let strbuf = Buffer.from(value, encoding);
			//either pad with 0's to fixed length and truncate and longer strings, or add a single 0 at the end
			let strbinbuf = Buffer.alloc(termination == null ? strbuf.byteLength + 1 : termination, 0);
			strbuf.copy(strbinbuf, 0, 0, Math.max(strbuf.byteLength, strbinbuf.byteLength));
			strbinbuf.copy(buffer, buffer.scan);
			buffer.scan += strbinbuf.byteLength;
			break;
		case "switch":
			if (!("offset" in primitive)) throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'switch' variables need to specify an 'offset' to the switch`;
			if (!("switch" in primitive)) throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'switch' variables need to specify a 'switch' table`;

			let switchbyte = "";
			let switchprim: Primitive<any> | null = null;
			for (let optbyte in primitive.switch) {
				let opttypename = primitive.switch[optbyte];
				let opttype = resolveAlias(opttypename, this.typedef);
				//check if this switch opt is applicable (good enough hopefully)
				if (typeof value == "number" && opttype.primitive != "int") { continue; }
				if (typeof value == "boolean" && opttype.primitive != "bool") { continue; }
				if (typeof value == "string" && opttype.primitive != "string") { continue; }

				if (switchprim) { throw `multiple possible switch options while writing switch type`; }
				switchprim = opttype;
				switchbyte = optbyte;
			}
			if (!switchprim) throw `no compatible switch option found for value ${value}`;

			//only currently used in [items|npcs|objects].extra which is a map with int32 keys, the first byte of that key is the switch
			//it is the responsibility of that key to have the right flag currently
			var firstByte = buffer.readUInt8(buffer.scan + primitive.offset);
			if (firstByte != +switchbyte) throw `previously written switch byte did not match expected switch type while writing the value`;
			this._writePrimitive(buffer, switchprim, value);
			break;
		case "value":
			if (!("value" in primitive)) throw `Invalid primitive definition '${JSON.stringify(primitive)}', 'value' variables need to specify a 'value'`;
			if (primitive.value != value) throw `expected constant ${primitive.value} was not present during write`;
			break;
		default:
			//@ts-ignore
			throw `Unsupported primitive '${primitive.primitive}' in typedef.json`;
	}
}
