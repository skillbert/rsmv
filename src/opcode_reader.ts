
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
	termination: null,
	prebytes: number[]
}
type ScanBuffer = Buffer & { scan: number };

export type Primitive<T> = PrimitiveInt | PrimitiveBool | PrimitiveString | PrimitiveValue<T>;
export type ChunkType<T> = Primitive<T> | string;

export type ComposedChunk = string
	| ["array", ComposedChunk]
	| ["array", string, ComposedChunk]
	//	| ["map", string, ComposedChunk]
	| ["opt", (number | string | [string, string | number]), ComposedChunk]
	| { $opcode: string } & Record<string, { name: string, read: ComposedChunk }>
	| ["struct", ...any]
//dont add tupple here since it messes up all typings as it has overlap with the first string prop


type TypeDef = { [name: string]: ChunkType<any> | ComposedChunk };

type ParserContext = Record<string, number>;

export type ChunkParser<T> = {
	read(buf: ScanBuffer, ctx: ParserContext): T,
	write(buf: ScanBuffer, v: unknown): void,
	condName?: string,
	condValue?: number
}

function resolveAlias(typename: string, typedef: TypeDef) {
	let newtype: Primitive<any> | ComposedChunk | string = typename;
	for (let redirects = 0; redirects < 1024; redirects++) {
		if (!Object.prototype.hasOwnProperty.call(typedef, newtype)) {
			throw new Error(`Type '${typename}' not found in typedef.json`);
		}
		newtype = typedef[newtype];
		if (typeof newtype != "string") {
			if ("primitive" in newtype) {
				//TODO this break when aliased types have a key "primitive"
				return primitiveParser(newtype as any);
			} else {
				//TODO this recursion is unchecked
				return buildParser(newtype, typedef);
			}
		}
	}
	throw new Error(`Couldn't resolve alias stack for '${typename}', perhaps due to an infinite loop - last known alias was '${newtype!}'`);
}

export function buildParser(chunkdef: ComposedChunk, typedef: TypeDef): ChunkParser<any> {
	switch (typeof chunkdef) {
		case "string":
			return resolveAlias(chunkdef, typedef);
		case "object":
			if (!Array.isArray(chunkdef)) {
				let mappedobj: Record<string, ChunkParser<any>> = {};
				for (let key in chunkdef) {
					if (key.startsWith("$")) { continue; }
					let op = chunkdef[key];
					mappedobj[op.name] = optParser(buildParser(op.read, typedef), "opcode", parseInt(key));
				}
				return opcodesParser(buildParser(chunkdef.$opcode ?? "unsigned byte", typedef), mappedobj);
			} else {
				if (chunkdef.length < 1) throw new Error(`'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(chunkdef)}`);
				switch (chunkdef[0]) {
					case "opt": {
						if (chunkdef.length < 3) throw new Error(`3 arguments exptected for proprety with type opt`);
						let cond: string;
						let valuearg = chunkdef[1];
						if (Array.isArray(valuearg)) {
							cond = valuearg[0];
							valuearg = valuearg[1];
						} else {
							cond = "opcode";
							valuearg = chunkdef[1] as number | string;
						}
						if (typeof valuearg == "string") { valuearg = parseInt(valuearg) }
						return optParser(buildParser(chunkdef[2], typedef), cond, valuearg);
					}
					case "array": {
						if (chunkdef.length < 2) throw new Error(`'read' variables interpretted as an array must contain items: ${JSON.stringify(chunkdef)}`);
						let sizetype = (chunkdef.length == 3 ? chunkdef[1] : "variable unsigned short");
						let valuetype = (chunkdef.length == 3 ? chunkdef[2] : chunkdef[1]);
						return arrayParser(resolveAlias(sizetype, typedef) as any, buildParser(valuetype, typedef));
					}
					case "struct": {
						if (chunkdef.length < 2) throw new Error(`'read' variables interpretted as a struct must contain items: ${JSON.stringify(chunkdef)}`);
						let props = {};
						for (let prop of chunkdef.slice(1) as [string, ComposedChunk][]) {
							props[prop[0]] = buildParser(prop[1], typedef);
						}
						return structParser(props, false);
					}
					// Tuple
					default: {
						//@ts-ignore
						if (chunkdef.length < 2) throw new Error(`'read' variables interpretted as a struct must contain items: ${JSON.stringify(chunkdef)}`);
						let props: ChunkParser<any>[] = [];
						for (let prop of chunkdef as ComposedChunk[]) {
							props.push(buildParser(prop, typedef));
						}
						return structParser(props, true);
					}
				}
			}
		default:
			throw new Error(`'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(chunkdef)}`);
	}
}

//TODO validate these at startup instead of during decode/encode?
function validateIntType(primitive: PrimitiveInt) {
	let hasUnsigned = "unsigned" in primitive;
	let hasBytes = "bytes" in primitive;
	let hasVariable = "variable" in primitive;
	let hasEndianness = "endianness" in primitive;
	if (!(hasUnsigned && hasBytes && hasVariable && hasEndianness)) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'int' variables need to specify 'unsigned', 'bytes', 'variable', and 'endianness'`);
	if (typeof primitive.unsigned !== "boolean") throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'unsigned' must be a boolean`);
	if (typeof primitive.bytes !== "number") throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'bytes' must be an integer`);
	if (typeof primitive.variable !== "boolean") throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'variable' must be a boolean`);
	if (primitive.endianness !== "big" && primitive.endianness !== "little") throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'endianness' must be "big" or "little"`);
}

function validateStringType(primitive: PrimitiveString) {
	let hasEncoding = "encoding" in primitive;
	if (!hasEncoding) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'string' variables need to specify 'encoding'`);
	if (typeof primitive.encoding !== "string") throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'encoding' must be a string`);
	if (!(primitive.termination === null || typeof primitive.termination === "number")) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'termination' must be null or the string's length in bytes`);
}

function opcodesParser<T extends Record<string, any>>(opcodetype: ChunkParser<number>, opts: { [key in keyof T]: ChunkParser<T[key]> }): ChunkParser<Partial<T>> {

	let map = new Map<number, { key: keyof T, parser: ChunkParser<any> }>();
	for (let key in opts) {
		let opt = opts[key];
		if (opt.condName != "opcode" || typeof opt.condValue != "number") { throw new Error("option in opcode set that is not conditional on 'opcode'"); }
		map.set(opt.condValue, { key: key, parser: opt });
	}

	return {
		read(buffer, parentctx) {
			let ctx: ParserContext = {};
			let r: Partial<T> = {};
			while (true) {
				if (buffer.scan == buffer.length) {
					console.log("ended reading file without 0x00 opcode");
					break;
				}
				let opt = opcodetype.read(buffer, ctx);
				ctx.opcode = opt;
				if (opt == 0) { break; }
				let parser = map.get(opt);
				if (!parser) { throw new Error("unknown chunk " + opt); }
				r[parser.key] = parser.parser.read(buffer, ctx);
			}
			return r;
		},
		write(buffer, value) {
			if (typeof value != "object") { throw new Error("oject expected") }
			for (let key in value) {
				let parser = opts[key];
				if (!parser) { throw new Error("unknown property " + key); }
				opcodetype.write(buffer, parser.condValue);
				parser.write(buffer, value[key]);
			}
			opcodetype.write(buffer, 0);
		}
	}
}

function structParser<TUPPLE extends boolean, T extends Record<TUPPLE extends true ? number : string, any>>(props: { [key in keyof T]: ChunkParser<T[key]> }, isTuple: TUPPLE): ChunkParser<T> {
	let keys: (keyof T)[] = Object.keys(props) as any;
	return {
		read(buffer, parentctx) {
			let r = (isTuple ? [] : {}) as T;
			let ctx: ParserContext = Object.create(parentctx);
			for (let key of keys) {
				let v = props[key].read(buffer, ctx);
				if (v !== undefined) {
					r[key] = v;
				}
				if (typeof v == "number") {
					ctx[key as string] = v;
				}
			}
			return r;
		},
		write(buffer, value) {
			if (typeof value != "object" || !value) { throw new Error("object expected"); }
			for (let i = 0; i < keys.length; i++) {
				let key = keys[i];
				if (!(key in value)) { throw new Error(`struct has no property ${key}`); }
				let propvalue = value[key as string];
				let prop = props[key];
				//TODO
				// if (prop.isSwitchValue) {
				// 	propvalue = 0;
				// 	let found = false;
				// 	for (let j = i; j < keys.length; j++) {
				// 		let key = keys[i];
				// 		let req = props[key].getWriteSwitchstate?.(value[key as any]);
				// 		if (req && req.name == key) {
				// 			propvalue = req.value;
				// 			found = true;
				// 			break;
				// 		}
				// 	}
				// 	if (!found) { console.log(`no value found for switch property ${key} defaulting to 0`); }
				// }
				prop.write(buffer, propvalue);
			}
		}
	}
}

function optParser<T>(type: ChunkParser<T>, condvar: string, condvalue: number): ChunkParser<T | undefined> {
	return {
		read(buffer, ctx) {
			if (ctx[condvar] != condvalue) {
				return undefined;
			}
			return type.read(buffer, ctx);
		},
		write(buffer, value) {
			if (typeof value != "undefined") {
				return type.write(buffer, value);
			}
		},
		condName: condvar,
		condValue: condvalue
	}
}

function arrayParser<T>(lengthtype: ChunkParser<number>, proptype: ChunkParser<T>): ChunkParser<T[]> {
	return {
		read(buffer, ctx) {
			let len = lengthtype.read(buffer, ctx);
			let r: T[] = [];
			for (let i = 0; i < len; i++) {
				r.push(proptype.read(buffer, ctx));
			}
			return r;
		},
		write(buffer, value) {
			if (!Array.isArray(value)) { throw new Error("array expected"); }
			lengthtype.write(buffer, value.length);
			for (let i = 0; i < value.length; i++) {
				proptype.write(buffer, value[i]);
			}
		}
	};
}

function intParser(primitive: PrimitiveInt): ChunkParser<number> {
	validateIntType(primitive);
	return {
		read(buffer) {
			let unsigned = primitive.unsigned;
			let bytes = primitive.bytes;
			let variable = primitive.variable;
			let endianness = primitive.endianness;
			let output = 0;
			if (variable) {
				let firstByte = buffer.readUInt8(buffer.scan);

				let mask = 0xFF;
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
		},
		write(buffer, value) {
			if (typeof value != "number" || value % 1 != 0) throw new Error(`integer expected`);
			let unsigned = primitive.unsigned;
			let bytes = primitive.bytes;
			let variable = primitive.variable;
			let endianness = primitive.endianness;
			let output = 0;
			if (variable) {
				if (endianness != "big") throw new Error(`variable length int only accepts big endian`);
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
		}
	}
}

function literalValueParser<T>(primitive: PrimitiveValue<T>): ChunkParser<T> {
	if (!("value" in primitive)) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'value' variables need to specify a 'value'`);
	return {
		read(buffer) {
			return primitive.value;
		},
		write(buffer, value) {
			if (primitive.value != value) throw new Error(`expected constant ${primitive.value} was not present during write`);
			//this is a nop, the existence of this field implis its value
		}
	}
}

function stringParser(primitive: PrimitiveString): ChunkParser<string> {
	validateStringType(primitive);
	return {
		read(buffer) {
			let encoding = primitive.encoding;
			let termination = primitive.termination;
			for (let i = 0; i < primitive.prebytes.length; i++, buffer.scan++) {
				if (buffer.readUInt8(buffer.scan) != primitive.prebytes[i]) {
					throw new Error("failed to match string header bytes");
				}
			}
			let end = buffer.scan;
			for (; end < buffer.length; ++end) {
				if ((termination === null && buffer.readUInt8(end) == 0x0) || (end - buffer.scan) == termination) {
					break;
				}
			}
			let outputstr = buffer.toString(encoding, buffer.scan, end);
			buffer.scan = end + 1;
			return outputstr;
		},
		write(buffer, value) {
			if (typeof value != "string") throw new Error(`string expected`);
			validateStringType(primitive);
			let encoding = primitive.encoding;
			let termination = primitive.termination;
			let strbuf = Buffer.from(value, encoding);
			//either pad with 0's to fixed length and truncate and longer strings, or add a single 0 at the end
			let strbinbuf = Buffer.alloc(termination == null ? strbuf.byteLength + 1 : termination, 0);
			strbuf.copy(strbinbuf, 0, 0, Math.max(strbuf.byteLength, strbinbuf.byteLength));
			strbinbuf.copy(buffer, buffer.scan);
			buffer.scan += strbinbuf.byteLength;
		}
	}
}

function booleanParser(): ChunkParser<boolean> {
	return {
		read(buffer) {
			let boolint = buffer.readUInt8(buffer.scan++);
			if (boolint != 1 && boolint != 0) throw new Error(`value parsed as bool was not 0x00 or 0x01`)
			return boolint != 0;
		},
		write(buffer, value) {
			buffer.writeUInt8(value ? 1 : 0, buffer.scan++);
		}
	}
}

function primitiveParser(primitive: Primitive<any>): ChunkParser<any> {
	if (!("primitive" in primitive)) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', needs to specify its datatype (e.g. "primitive": "int")`);
	switch (primitive.primitive) {
		case "bool":
			return booleanParser();
		case "int":
			return intParser(primitive);
		case "string":
			return stringParser(primitive);
		case "value":
			return literalValueParser(primitive);
		default:
			//@ts-ignore
			throw new Error(`Unsupported primitive '${primitive.primitive}' in typedef.json`);
	}
}
