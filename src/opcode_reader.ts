import type * as jsonschema from "json-schema";

type PrimitiveInt = {
	primitive: "int",
	unsigned: boolean,
	bytes: number,
	readmode: "fixed" | "smart" | "sumtail"
	endianness: "big" | "little"
};
type PrimitiveFloat = {
	primitive: "float",
	bytes: number,
	endianness: "big" | "little"
};
type PrimitiveHardcode = {
	primitive: "hardcode",
	name: string
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
export type ScanBuffer = Buffer & { scan: number };

type CompareMode = "eq" | "eqnot" | "bitflag" | "bitflagnot" | "bitor" | "bitand" | "gteq" | "lteq";

export type Primitive<T> = PrimitiveInt | PrimitiveFloat | PrimitiveBool | PrimitiveString | PrimitiveHardcode | PrimitiveValue<T>;
export type ChunkType<T> = Primitive<T> | string;

export type ComposedChunk = string | number
	| [type: "array", props: ComposedChunk]
	| [type: "chunkedarray", length: ComposedChunk | number, ...chunks: [name: string, value: any][]]
	| [type: "array", length: ComposedChunk | number, valueType: ComposedChunk]
	| ["buffer", ComposedChunk | number, keyof typeof BufferTypes, number]
	| [type: "nullarray", optcodeType: ComposedChunk, valueType: ComposedChunk]
	| [type: "bytesleft"]
	| [type: "ref", ref: string, bitrange?: [number, number], offset?: number]
	| [type: "arg", ref: string,]
	| [type: "accum", ref: string, addvalue: ComposedChunk, mode?: "add" | "add-1" | "hold"]
	| [type: "opt", condition: (number | [ref: string, value: number, compare: CompareMode]), value: ComposedChunk]
	| { $opcode: string } & Record<string, { name: string, read: ComposedChunk }>
	| [type: "struct", ...props: [name: string, value: any][]]
	| [type: "tuple", ...props: any[]]


export type TypeDef = { [name: string]: ChunkType<any> | ComposedChunk };

const BufferTypes = {
	buffer: { constr: Buffer as any as Uint8ArrayConstructor },//Buffer typings doesn't have BYTES_PER_ELEMENT
	hex: { constr: Uint8Array },//used to debug into json file
	byte: { constr: Int8Array },
	ubyte: { constr: Uint8Array },
	short: { constr: Int16Array },
	ushort: { constr: Uint16Array },
	int: { constr: Int32Array },
	uint: { constr: Uint32Array },
};

var debugdata: null | { structstack: object[], opcodes: { op: number | string, index: number, stacksize: number, external?: { start: number, len: number } }[] } = null;
export function getDebug(trigger: boolean) {
	let ret = debugdata;
	//TODO structstack is obsolete because of the stack in state
	debugdata = trigger ? { structstack: [], opcodes: [] } : null;
	return ret;
}

export type DecodeState = {
	stack: object[],
	hiddenstack: object[],
	scan: number,
	endoffset: number,
	startoffset: number,
	buffer: Buffer,
	args: Record<string, any>,
	keepBufferJson: boolean,
	clientVersion: number
}

export type EncodeState = {
	scan: number
	buffer: Buffer,
	clientVersion: number
}

export type ResolvedReference = {
	stackdepth: number,
	owner: ChunkParser,
	resolve(v: unknown, oldvalue: number): number
}

export type ChunkParser<T = any> = {
	read(state: DecodeState): T,
	write(state: EncodeState, v: unknown): void,
	getTypescriptType(indent: string): string,
	getJsonSchema(): jsonschema.JSONSchema6Definition
}

export type ChunkParent = ChunkParserContainer | null;

export type ChunkParserContainer<T = any> = (ChunkParser<T> & {
	resolveReference(name: string, childresolve: ResolvedReference): ResolvedReference
});

function resolveAlias(typename: string, parent: ChunkParent, typedef: TypeDef) {
	let newtype: Primitive<any> | ComposedChunk | string = typename;
	for (let redirects = 0; redirects < 1024; redirects++) {
		if (!Object.prototype.hasOwnProperty.call(typedef, newtype)) {
			throw new Error(`Type '${typename}' not found in typedef.json`);
		}
		newtype = typedef[newtype];
		if (typeof newtype != "string") {
			if (typeof newtype != "number" && "primitive" in newtype) {
				//TODO this break when aliased types have a key "primitive"
				return primitiveParser(parent, newtype as any, typedef);
			} else {
				//TODO this recursion is unchecked
				return buildParser(parent, newtype, typedef);
			}
		}
	}
	throw new Error(`Couldn't resolve alias stack for '${typename}', perhaps due to an infinite loop - last known alias was '${newtype!}'`);
}

export function buildParser(parent: ChunkParent | null, chunkdef: ComposedChunk, typedef: TypeDef): ChunkParser {
	switch (typeof chunkdef) {
		case "number":
			return literalValueParser({ primitive: "value", value: chunkdef });
		case "string":
			return resolveAlias(chunkdef, parent, typedef);
		case "object":
			if (chunkdef == null) {
				return literalValueParser({ primitive: "value", value: null });
			} else if (!Array.isArray(chunkdef)) {
				return opcodesParser(chunkdef, parent, typedef);
			} else {
				if (chunkdef.length < 1) throw new Error(`'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(chunkdef)}`);
				let args = chunkdef.slice(1);
				switch (chunkdef[0]) {
					case "ref":
						return referenceValueParser(args, parent, typedef);
					case "accum":
						return intAccumlatorParser(args, parent, typedef);
					case "opt":
						return optParser(args, parent, typedef);
					case "chunkedarray":
						return chunkedArrayParser(args, parent, typedef);
					case "bytesleft":
						return bytesRemainingParser();
					case "buffer":
						return bufferParser(args, parent, typedef);
					case "nullarray":
						return arrayNullTerminatedParser(args, parent, typedef);
					case "array":
						return arrayParser(args, parent, typedef);
					case "struct":
						return structParser(args, parent, typedef);
					case "tuple":
						return tuppleParser(args, parent, typedef);
					default: {
						if (hardcodes[chunkdef[0]]) {
							return hardcodes[chunkdef[0]](args, parent, typedef);
						}
					}
				}
			}
		default:
			throw new Error(`'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(chunkdef)}`);
	}
}

function validateFloatType(primitive: PrimitiveFloat) {
	let hasBytes = "bytes" in primitive;
	let hasEndianness = "endianness" in primitive;
	if (!(hasBytes && hasEndianness)) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'float' variables need to specify 'bytes' and 'endianness'`);
	if (typeof primitive.bytes !== "number" || primitive.bytes != 4) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'bytes' must be an integer 4`);
	if (primitive.endianness !== "big" && primitive.endianness !== "little") throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'endianness' must be "big" or "little"`);
}

function validateIntType(primitive: PrimitiveInt) {
	let hasUnsigned = "unsigned" in primitive;
	let hasBytes = "bytes" in primitive;
	let hasReadmode = "readmode" in primitive;
	let hasEndianness = "endianness" in primitive;
	if (!(hasUnsigned && hasBytes && hasReadmode && hasEndianness)) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'int' variables need to specify 'unsigned', 'bytes', 'variable', and 'endianness'`);
	if (typeof primitive.unsigned !== "boolean") throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'unsigned' must be a boolean`);
	if (typeof primitive.bytes !== "number") throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'bytes' must be an integer`);
	if (["fixed", "smart", "sumtail"].indexOf(primitive.readmode) == -1) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'readmode' must be a 'fixed', 'smart' or 'sumtail'`)
	if (primitive.endianness !== "big" && primitive.endianness !== "little") throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'endianness' must be "big" or "little"`);
}

function validateStringType(primitive: PrimitiveString) {
	let hasEncoding = "encoding" in primitive;
	if (!hasEncoding) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'string' variables need to specify 'encoding'`);
	if (typeof primitive.encoding !== "string") throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'encoding' must be a string`);
	if (!(primitive.termination === null || typeof primitive.termination === "number")) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'termination' must be null or the string's length in bytes`);
}

function opcodesParser(chunkdef: Record<string, unknown>, parent: ChunkParent, typedef: TypeDef): ChunkParser {

	let r: ChunkParserContainer = {
		read(state) {
			let r: Record<string, any> = {};
			let hidden: any = { $opcode: 0 };
			state.stack.push(r);
			state.hiddenstack.push(hidden);
			if (debugdata) { debugdata.structstack.push(r); }
			while (true) {
				if (state.scan == state.endoffset) {
					if (!hasexplicitnull) {
						// throw new Error("ended reading opcode struct at end of file without 0x00 opcode");
						console.log("ended reading opcode struct at end of file without 0x00 opcode");
					}
					break;
				}
				let opt = opcodetype.read(state);
				hidden.$opcode = opt;
				if (!hasexplicitnull && opt == 0) { break; }
				let parser = map.get(opt);
				if (debugdata) {
					debugdata.opcodes.push({ op: (parser ? parser.key as string : `_0x${opt.toString(16)}_`), index: state.scan - 1, stacksize: state.stack.length });
				}
				if (!parser) { throw new Error("unknown chunk 0x" + opt.toString(16).toUpperCase()); }
				r[parser.key] = parser.parser.read(state);
			}
			state.stack.pop();
			state.hiddenstack.pop();
			if (debugdata) { debugdata.structstack.pop(); }
			return r;
		},
		write(state, value) {
			if (typeof value != "object") { throw new Error("oject expected") }
			for (let key in value) {
				if (key.startsWith("$")) { continue; }
				let opt = opts[key];
				if (!opt) { throw new Error("unknown property " + key); }
				opcodetype.write(state, opt.op);
				opt.parser.write(state, value[key]);
			}
			if (hasexplicitnull) {
				opcodetype.write(state, 0);
			}
		},
		resolveReference(name, childresolve) {
			let targetprop = Object.entries(opts).find(([name, parser]) => parser.parser == childresolve.owner)?.[0];
			if (!targetprop) { throw new Error("reference owner not found"); }
			if (!parent) { throw new Error("parent not set"); }
			let result: ResolvedReference = {
				owner: r,
				stackdepth: childresolve.stackdepth + 1,
				resolve(v, oldvalue) {
					if (typeof v != "object" || !v) { throw new Error("object expected"); }
					let res = v[targetprop!];
					return childresolve.resolve(res, oldvalue);
				}
			};
			if (name == "$opcode" || Object.prototype.hasOwnProperty.call(opts, name)) {
				refs[name] ??= [];
				refs[name]!.push(result);
				return result;
			} else {
				return buildReference(name, parent, result);
			}
		},
		getTypescriptType(indent) {
			let r = "{\n";
			let newindent = indent + "\t";
			for (let val of map.values()) {
				r += newindent + (val.key as string) + "?: " + val.parser.getTypescriptType(newindent) + " | null\n";
			}
			r += indent + "}";
			return r;
		},
		getJsonSchema() {
			return {
				type: "object",
				properties: Object.fromEntries([...map.values()]
					.filter(prop => !(prop.key as string).startsWith("$"))
					.map((prop) => {
						return [prop.key, { oneOf: [prop.parser.getJsonSchema(), { type: "null" }] }];
					})
				)
			}
		}
	}

	let opcodetype = buildParser(r, (chunkdef.$opcode ?? "unsigned byte") as ComposedChunk, typedef);
	let opts: Record<string, { op: number, parser: ChunkParser }> = {};
	for (let key in chunkdef) {
		if (key.startsWith("$")) { continue; }
		let op = chunkdef[key];
		if (typeof op != "object" || !op) { throw new Error("op name expected"); }
		let opname = op["name"];
		if (typeof opname != "string") { throw new Error("op name expected"); }
		if (opts[opname]) { throw new Error("duplicate opcode key " + opname); }
		opts[opname] = { op: parseInt(key), parser: buildParser(r, op["read"], typedef) };
	}

	let map = new Map<number, { key: string, parser: ChunkParser }>();
	let refs: Record<string, ResolvedReference[] | undefined> = {};
	for (let key in opts) {
		let opt = opts[key];
		map.set(opt.op, { key: key, parser: opt.parser });
	}
	let hasexplicitnull = !!map.get(0);

	return r;
}

function tuppleParser(args: unknown[], parent: ChunkParent, typedef: TypeDef) {
	let r: ChunkParserContainer<any[]> = {
		read(state) {
			let r: any[] = [];
			for (let prop of props) {
				let v = prop.read(state);
				r.push(v);
			}
			return r;
		},
		write(state, value) {
			if (!Array.isArray(value)) { throw new Error("array expected"); }
			for (let [i, prop] of props.entries()) {
				prop.write(state, value[i]);
			}
		},
		resolveReference(name, child) {
			let index = props.indexOf(child.owner);
			if (index == -1) { throw new Error("tuple child prop not found"); }
			return buildReference(name, parent, {
				stackdepth: child.stackdepth,
				owner: r,
				resolve(v, old) {
					if (!Array.isArray(v)) { throw new Error("Array expected"); }
					return child.resolve(v[index], old)
				}
			})
		},
		getTypescriptType(indent) {
			let r = "[\n";
			let newindent = indent + "\t";
			for (let prop of props) { r += newindent + prop.getTypescriptType(newindent) + ",\n"; }
			r += indent + "]";
			return r;
		},
		getJsonSchema() {
			return {
				type: "array",
				items: Object.entries(props).map(([k, v]: [string, ChunkParser]) => v.getJsonSchema()),
				minItems: Object.keys(props).length,
				maxItems: Object.keys(props).length
			};
		}
	}

	let props = args.map(d => buildParser(r, d as ComposedChunk, typedef));
	return r;
}

export function buildReference(name: string, container: ChunkParent | null, startingpoint: ResolvedReference) {
	if (!container) { throw new Error("reference " + name + " could not be resolved"); }
	return container.resolveReference(name, startingpoint);
}

function refgetter(owner: ChunkParser, refparent: ChunkParent | null, propname: string, resolve: (v: unknown, old: number) => number) {
	let final = buildReference(propname, refparent, { owner, stackdepth: 0, resolve });
	let depth = final.stackdepth;
	let hidden = propname.startsWith("$");
	return {
		read(state: DecodeState) {
			let stack = (hidden ? state.hiddenstack : state.stack);
			return stack[stack.length - depth][propname];
		},
		write(state: DecodeState, newvalue: number) {
			let stack = (hidden ? state.hiddenstack : state.stack);
			stack[stack.length - depth][propname] = newvalue;
		}
	}
}

function structParser(args: unknown[], parent: ChunkParent, typedef: TypeDef): ChunkParser {

	let refs: Record<string, ResolvedReference[] | undefined> = {};
	let r: ChunkParserContainer = {
		read(state) {
			let r = {};
			let hidden = {};
			state.stack.push(r);
			state.hiddenstack.push(hidden);
			for (let key of keys) {
				if (debugdata) { debugdata.opcodes.push({ op: key, index: state.scan, stacksize: state.stack.length }); }
				let v = props[key].read(state);
				if (v !== undefined) {
					if (key[0] == "$") {
						hidden[key] = v;
					} else {
						r[key] = v;
					}
				}
			}
			state.stack.pop();
			state.hiddenstack.pop();
			return r;
		},
		write(state, value) {
			if (typeof value != "object" || !value) { throw new Error("object expected"); }
			for (let key of keys) {
				let propvalue = value[key as string];
				let refarray = refs[key];
				if (refarray) {
					propvalue = propvalue ?? 0;
					for (let ref of refarray) {
						propvalue = ref.resolve(value, propvalue);
					}
				}
				let prop = props[key];
				prop.write(state, propvalue);
			}
		},
		resolveReference(name, childresolve) {
			let targetprop = Object.entries(props).find(([name, parser]) => parser == childresolve.owner)?.[0];
			if (!targetprop) { throw new Error("reference owner not found"); }
			let result: ResolvedReference = {
				owner: r,
				stackdepth: childresolve.stackdepth + 1,
				resolve(v, oldvalue) {
					if (typeof v != "object" || !v) { throw new Error("object expected"); }
					let res = v[targetprop!];
					return childresolve.resolve(res, oldvalue);
				}
			};
			if (Object.prototype.hasOwnProperty.call(props, name)) {
				refs[name] ??= [];
				refs[name]!.push(result);
				return result;
			} else {
				return buildReference(name, parent, result);
			}
		},
		getTypescriptType(indent) {
			let r = "{\n";
			let newindent = indent + "\t";
			for (let key of keys) {
				if (key[0] == "$") { continue; }
				r += newindent + key + ": " + props[key].getTypescriptType(newindent) + ",\n";
			}
			r += indent + "}";
			return r;
		},
		getJsonSchema() {
			return {
				type: "object",
				properties: Object.fromEntries([...Object.entries(props)]
					.filter(([key]) => !key.startsWith("$"))
					.map(([key, prop]) => [key, (prop as ChunkParser).getJsonSchema()])
				),
				required: keys.filter(k => !k.startsWith("$"))
			}
		}
	}

	let props = {};
	for (let prop of args) {
		if (!Array.isArray(prop) || prop.length != 2) { throw new Error("each struct args should be a [name,type] pair"); }
		if (typeof prop[0] != "string") { throw new Error("prop name should be string"); }
		if (props[prop[0]]) { throw new Error("duplicate struct prop " + prop[0]); }
		props[prop[0]] = buildParser(r, prop[1], typedef);
	}
	let keys = Object.keys(props);
	return r;
}

function optParser(args: unknown[], parent: ChunkParent, typedef: TypeDef): ChunkParser {
	let r: ChunkParserContainer = {
		read(state) {
			let value = ref.read(state);
			if (!checkCondition(cmpmode, condvalue, value)) {
				return null;
			}
			return type.read(state);
		},
		write(state, value) {
			if (value != null) {
				return type.write(state, value);
			}
		},
		resolveReference(name, child) {
			return buildReference(name, parent, {
				owner: r,
				stackdepth: child.stackdepth,
				resolve(v, old) {
					return (v != null ? child.resolve(v, old) : old);
				}
			})
		},
		getTypescriptType(indent) {
			return type.getTypescriptType(indent) + " | null";
		},
		getJsonSchema() {
			return {
				oneOf: [
					type.getJsonSchema(),
					{ type: "null" }
				]
			}
		}
	};

	if (args.length < 2) throw new Error(`2 arguments exptected for proprety with type opt`);
	let condvar: string;
	let arg1 = args[0];
	let condvalue: number;
	let cmpmode: CompareMode = "eq";
	if (Array.isArray(arg1)) {
		condvar = arg1[0];
		cmpmode = arg1[2] ?? "eq";
		if (typeof arg1[1] == "number") {
			condvalue = arg1[1];
		} else {
			throw new Error("only literal ints as condition value are supported");
		}
	} else {
		if (typeof arg1 != "number") { throw new Error(""); }
		condvar = "$opcode";
		condvalue = arg1;
	}

	let ref = refgetter(r, parent, condvar, (v: unknown, oldvalue: number) => {
		return forceCondition(cmpmode, condvalue, oldvalue, v != null);
	});

	let type = buildParser(r, args[1] as ComposedChunk, typedef);

	return r;
}

function forceCondition(condMode: CompareMode, compValue: number, oldvalue: number, state: boolean) {
	switch (condMode) {
		case "eq":
			return state ? compValue : oldvalue;
		case "eqnot":
			return state ? oldvalue : compValue;
		case "bitflag":
			return (state ? oldvalue | (1 << compValue) : oldvalue & ~(1 << compValue));
		case "bitor":
			return (state ? oldvalue | compValue : oldvalue & ~compValue);
		case "bitand":
			return (state ? oldvalue | compValue : oldvalue & ~compValue);
		case "bitflagnot":
			return (state ? oldvalue & ~(1 << compValue) : oldvalue | (1 << compValue));
		case "gteq":
			return state ? Math.max(compValue, oldvalue) : oldvalue;
		case "lteq":
			return state ? Math.min(compValue, oldvalue) : oldvalue;
		default:
			throw new Error("unknown condition " + condMode);
	}
}

function checkCondition(condmode: CompareMode, compValue: number, v: number) {
	switch (condmode) {
		case "eq":
			return v == compValue;
		case "eqnot":
			return v != compValue;
		case "bitflag":
			return (v & (1 << compValue)) != 0;
		case "bitor":
			return (v & compValue) != 0;
		case "bitand":
			return (v & compValue) == compValue;
		case "bitflagnot":
			return (v & (1 << compValue)) == 0;
		case "gteq":
			return v >= compValue;
		case "lteq":
			return v <= compValue;
		default:
			throw new Error("unkown condition " + condmode);
	}
}

function chunkedArrayParser(args: unknown[], parent: ChunkParent, typedef: TypeDef): ChunkParser {

	let r: ChunkParserContainer = {
		read(state) {
			let len = lengthtype.read(state);
			let r: object[] = [];
			let hiddenprops: object[] = [];
			for (let chunkindex = 0; chunkindex < chunktypes.length; chunkindex++) {
				let proptype = chunktypes[chunkindex];
				if (debugdata) {
					debugdata.opcodes.push({ op: Object.keys(proptype).join(), index: state.scan, stacksize: state.stack.length });
				}
				for (let i = 0; i < len; i++) {
					let hidden: object;
					let obj: object;
					if (chunkindex == 0) {
						obj = {};
						r.push(obj);
						hidden = {};
						hiddenprops.push(hidden);
					} else {
						obj = r[i];
						hidden = hiddenprops[i];
					}
					//TODO check if we can save speed by manually overwriting stack[length-1] instead of pop->push
					state.stack.push(obj);
					state.hiddenstack.push(hidden);
					for (let key in proptype) {
						let value = proptype[key].read(state);
						if (key.startsWith("$")) {
							hidden[key] = value;
						} else {
							obj[key] = value;
						}
					}
					state.stack.pop();
					state.hiddenstack.pop();
				}
			}
			return r;
		},
		write(buf, v) {
			throw new Error("not implemented");
		},
		resolveReference(name, childresolve) {
			if (childresolve.owner == lengthtype) {
				return buildReference(name, parent, {
					owner: r,
					stackdepth: childresolve.stackdepth,
					resolve(v, old) {
						if (!Array.isArray(v)) { throw new Error("array expected"); }
						return childresolve.resolve(v.length, old);
					}
				});
			}
			let targetprop = Object.entries(fullobj).find(([name, parser]) => parser == childresolve.owner)?.[0];
			if (!targetprop) { throw new Error("reference owner not found"); }
			let result: ResolvedReference = {
				owner: r,
				stackdepth: childresolve.stackdepth + 1,
				resolve(v, oldvalue) {
					if (typeof v != "object" || !v) { throw new Error("object expected"); }
					let res = v[targetprop!];
					return childresolve.resolve(res, oldvalue);
				}
			};
			if (Object.prototype.hasOwnProperty.call(fullobj, name)) {
				refs[name] ??= [];
				refs[name]!.push(result);
				return result;
			} else {
				return buildReference(name, parent, result);
			}
		},
		getTypescriptType(indent) {
			let r = "{\n";
			let newindent = indent + "\t";
			for (let [key, prop] of Object.entries(fullobj)) {
				if (key[0] == "$") { continue; }
				r += newindent + key + ": " + prop.getTypescriptType(newindent) + ",\n";
			}
			r += indent + "}[]";
			return r;
		},
		getJsonSchema() {
			return {
				type: "array",
				items: {
					type: "object",
					properties: Object.fromEntries([...Object.entries(fullobj)]
						.filter(([key]) => !key.startsWith("$"))
						.map(([key, prop]) => [key, (prop as ChunkParser).getJsonSchema()])
					),
					required: keys.filter(k => !k.startsWith("$"))
				}
			};
		}
	};

	let rawchunks = args.slice(1);
	let lengthtype = buildParser(r, args[0] as ComposedChunk, typedef);

	let fullobj: Record<string, ChunkParser> = {};
	let chunktypes = rawchunks.map(chunk => {
		if (!Array.isArray(chunk)) { throw new Error("each argument for composed chunk should be an array") }
		return Object.fromEntries(chunk.map(q => {
			if (!Array.isArray(q) || q.length != 2 || typeof q[0] != "string") { throw new Error("each composedchunk should be a [name,type] pair"); }
			let p=buildParser(r, q[1], typedef);
			return [q[0], p];
		}))
	});

	let keys = chunktypes.flatMap(Object.keys);
	let refs: Record<string, ResolvedReference[] | undefined> = {};

	return r;
}

function bufferParserValue(value: unknown, type: typeof BufferTypes[keyof typeof BufferTypes], scalartype: keyof typeof BufferTypes) {
	if (typeof value == "string") {
		if (scalartype == "hex") {
			return Buffer.from(value, "hex");
		} else {
			//accept json-ified version of our data as well
			let m = value.match(/^buffer ([\w\[\]]+){([\d,\-\.]*)}/);
			if (!m) { throw new Error("invalid arraybuffer string"); }
			return new type.constr(m[2].split(",").map(q => +q));
		}
	}

	if (!(value instanceof type.constr)) { throw new Error("arraybuffer expected"); }
	return value;
}

function bufferParser(args: unknown[], parent: ChunkParent, typedef: TypeDef): ChunkParser {
	let r: ChunkParserContainer = {
		read(state) {
			let len = lengthtype.read(state);
			let bytelen = len * vectorLength * type.constr.BYTES_PER_ELEMENT;
			let backing = new ArrayBuffer(bytelen);
			let bytes = Buffer.from(backing);
			bytes.set(state.buffer.subarray(state.scan, state.scan + bytelen));
			state.scan += bytelen;
			let array = (scalartype == "buffer" ? bytes : new type.constr(backing));
			if (scalartype == "hex") { (array as any).toJSON = () => bytes.toString("hex"); }
			else if (!state.keepBufferJson) { (array as any).toJSON = () => `buffer ${scalartype}${vectorLength != 1 ? `[${vectorLength}]` : ""}[${len}]`; }
			else { (array as any).toJSON = () => `buffer ${scalartype}${vectorLength != 1 ? `[${vectorLength}]` : ""}[]{${[...array].join(",")}}` }
			return array;
		},
		write(state, rawvalue) {
			let value = bufferParserValue(rawvalue, type, scalartype);
			if (value.length % vectorLength != 0) { throw new Error("araybuffer is not integer multiple of vectorlength"); }
			lengthtype.write(state, value.length / vectorLength);

			let bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
			state.buffer.set(bytes, state.scan);
			state.scan += bytes.byteLength;
		},
		resolveReference(name, child) {
			return buildReference(name, parent, {
				owner: r,
				stackdepth: child.stackdepth,
				resolve(rawvalue, old) {
					let value = bufferParserValue(rawvalue, type, scalartype);
					if (child.owner == lengthtype) {
						return child.resolve(value.length / vectorLength, old);
					}
					//possibly do this for all elements in the array if needed and allowed by performance
					return child.resolve(value[0], old);
				}
			});
		},
		getTypescriptType(indent) {
			return type.constr.name;
		},
		getJsonSchema() {
			return { type: "string" };
		}
	};
	if (args.length < 1) throw new Error(`'read' variables interpretted as an array must contain items: ${JSON.stringify(args)}`);
	let typestring = args[1] ?? "buffer";
	let lenarg = args[2] ?? 1;
	if (typeof typestring != "string" || !Object.hasOwn(BufferTypes, typestring)) { throw new Error("unknown buffer type " + args[1]); }
	if (typeof lenarg != "number") { throw new Error("vectorlength should be a number"); }
	let vectorLength = lenarg;
	let scalartype: keyof typeof BufferTypes = typestring as any;

	let lengthtype = buildParser(r, args[0] as ComposedChunk, typedef);
	const type = BufferTypes[typestring];
	return r;
}

function arrayParser(args: unknown[], parent: ChunkParent, typedef: TypeDef): ChunkParser {
	let r: ChunkParserContainer = {
		read(state) {
			let len = lengthtype.read(state);
			let r: any[] = [];
			for (let i = 0; i < len; i++) {
				r.push(subtype.read(state));
			}
			return r;
		},
		write(state, value) {
			if (!Array.isArray(value)) { throw new Error("array expected"); }
			lengthtype.write(state, value.length);
			for (let i = 0; i < value.length; i++) {
				subtype.write(state, value[i]);
			}
		},
		resolveReference(name, child) {
			return buildReference(name, parent, {
				owner: r,
				stackdepth: child.stackdepth,
				resolve(v, old) {
					if (!Array.isArray(v)) { throw new Error("array expected"); }
					if (child.owner == lengthtype) {
						return child.resolve(v.length, old);
					}
					//possibly do this for all elements in the array if needed and allowed by performance
					return child.resolve(v[0], old);
				}
			});
		},
		getTypescriptType(indent) {
			return `${subtype.getTypescriptType(indent)}[]`;
		},
		getJsonSchema() {
			return {
				type: "array",
				items: subtype.getJsonSchema()
			}
		}
	};

	if (args.length < 1) throw new Error(`'read' variables interpretted as an array must contain items: ${JSON.stringify(args)}`);
	let sizearg = (args.length >= 2 ? args[0] : "variable unsigned short");
	let lengthtype = buildParser(r, sizearg as ComposedChunk, typedef);
	let subtype = buildParser(r, args[args.length >= 2 ? 1 : 0] as ComposedChunk, typedef);
	return r;
}

function arrayNullTerminatedParser(args: unknown[], parent: ChunkParent, typedef: TypeDef) {
	let r: ChunkParserContainer = {
		read(state) {
			let r: any[] = [];
			let ctx = { $opcode: 0 };
			state.hiddenstack.push(ctx);
			state.stack.push({});
			while (true) {
				let header = lengthtype.read(state);
				if (debugdata) {
					debugdata.opcodes.push({ op: "opcode", index: state.scan - 1, stacksize: state.stack.length });
				}
				if (header == 0) { break; }
				ctx.$opcode = header;
				r.push(subtype.read(state));
			}
			state.hiddenstack.pop();
			state.stack.pop();
			return r;
		},
		write(state, value) {
			if (!Array.isArray(value)) { throw new Error("array expected"); }
			//TODO probably very wrong
			for (let prop of value) {
				lengthtype.write(state, 1);
				subtype.write(state, prop);
			}
			lengthtype.write(state, 0);
		},
		resolveReference(name, child) {
			if (name == "$opcode") {
				return {
					owner: r,
					stackdepth: child.stackdepth + 1,
					resolve(v, old) { throw new Error("not implemented") }
				}
			}
			return buildReference(name, parent, {
				owner: r,
				stackdepth: child.stackdepth + 1,
				resolve(v, old) {
					if (!Array.isArray(v)) { throw new Error("array expcted"); }
					//possibly do this for all elements in the array if needed and allowed by performance
					return child.resolve(v[0], old);
				}
			})
		},
		getTypescriptType(indent) {
			return `${subtype.getTypescriptType(indent)}[]`;
		},
		getJsonSchema() {
			return {
				type: "array",
				items: subtype.getJsonSchema()
			};
		}
	};

	if (args.length < 1) throw new Error(`'read' variables interpretted as an array must contain items: ${JSON.stringify(args)}`);
	let sizearg = (args.length >= 2 ? args[0] : "variable unsigned short");
	let lengthtype = buildParser(r, sizearg as ComposedChunk, typedef);
	let subtype = buildParser(r, args[args.length >= 2 ? 1 : 0] as ComposedChunk, typedef);
	return r;
}

function floatParser(primitive: PrimitiveFloat): ChunkParser<number> {
	validateFloatType(primitive);
	let parser: ChunkParser<number> = {
		read(state) {
			let buffer = state.buffer;
			if (primitive.bytes == 4) {
				let r = (primitive.endianness == "big" ? buffer.readFloatBE(state.scan) : buffer.readFloatLE(state.scan));
				state.scan += 4;
				return r;
			} else {
				throw new Error("only 4 byte floats supported");
			}
		},
		write(state, v) {
			if (typeof v != "number") { throw new Error("number expected"); }
			if (primitive.bytes == 4) {
				if (primitive.endianness == "big") { state.buffer.writeFloatBE(v, state.scan); }
				else { state.buffer.writeFloatLE(v, state.scan); }
				state.scan += 4;
			} else {
				throw new Error("only 4 byte flaots supported");
			}
		},
		getTypescriptType() { return "number"; },
		getJsonSchema() { return { type: "number" }; }
	}
	return parser;
}

function intParser(primitive: PrimitiveInt): ChunkParser<number> {
	validateIntType(primitive);
	let parser: ChunkParser<number> = {
		read(state) {
			//TODO clean this whole thing up and remove the variable bytes mode
			let unsigned = primitive.unsigned;
			let bytes = primitive.bytes;
			let readmode = primitive.readmode;
			let endianness = primitive.endianness;
			let output = 0;
			let buffer = state.buffer;
			if (readmode == "smart" || readmode == "sumtail") {
				let firstByte = buffer.readUInt8(state.scan);

				let mask = 0xFF;
				if ((firstByte & 0x80) != 0x80) bytes >>= 1; // Floored division by two when we don't have a continuation bit
				else mask = 0x7F;

				buffer[state.scan] &= mask;
				// If the number is signed and second-most-significant bit is 1,
				// set the most-significant bit to 1 since it's no longer a continuation bit
				if (!unsigned && (firstByte & 0x40) == 0x40) buffer[state.scan] |= 0x80;
				if (unsigned) {
					if (endianness == "big") { output = buffer.readUIntBE(state.scan, bytes); }
					else { output = buffer.readUIntLE(state.scan, bytes); }
				} else {
					if (endianness == "big") { output = buffer.readIntBE(state.scan, bytes); }
					else { output = buffer.readIntLE(state.scan, bytes); }
				}
				state.scan += bytes;
				buffer[state.scan - bytes] = firstByte; // Set it back to what it was originally
				if (readmode == "sumtail") {
					//this is very stupid but works
					//yay for recursion
					let overflowchunk = ~(~1 << (primitive.bytes * 8 - 2));//0111111.. pattern
					if (output == overflowchunk) {
						output += parser.read(state);
					}
				}
			} else {
				if (unsigned) {
					if (endianness == "big") { output = buffer.readUIntBE(state.scan, bytes); }
					else { output = buffer.readUIntLE(state.scan, bytes); }
				} else {
					if (endianness == "big") { output = buffer.readIntBE(state.scan, bytes); }
					else { output = buffer.readIntLE(state.scan, bytes); }
				}
				state.scan += bytes;
			}
			return output;
		},
		write(state, value) {
			if (typeof value != "number" || value % 1 != 0) throw new Error(`integer expected`);
			let unsigned = primitive.unsigned;
			let bytes = primitive.bytes;
			let readmode = primitive.readmode;
			let endianness = primitive.endianness;
			let output = 0;
			if (readmode == "smart") {
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
				//write 32bit ints as unsigned since js bitwise operations cast to int32
				state.buffer[`write${unsigned && bytes != 4 ? "U" : ""}IntBE`](int, state.scan, bytes);
				state.scan += bytes;
			} else if (readmode == "sumtail") {
				throw new Error("not implemented");
			} else {
				output = state.buffer[`write${unsigned ? "U" : ""}Int${endianness.charAt(0).toUpperCase()}E`](value, state.scan, bytes);
				state.scan += bytes;
			}
		},
		getTypescriptType() {
			return "number";
		},
		getJsonSchema() {
			return {
				type: "integer",
				maximum: 2 ** (primitive.bytes * 8 + (primitive.unsigned ? 0 : -1)) - 1,
				minimum: (primitive.unsigned ? 0 : -1 * (2 ** (primitive.bytes * 8 - 1)))
			}
		}
	}
	return parser;
}

function literalValueParser<T>(primitive: PrimitiveValue<T>): ChunkParser<T> {
	if (!("value" in primitive)) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', 'value' variables need to specify a 'value'`);
	return {
		read(state) {
			return primitive.value;
		},
		write(state, value) {
			if (primitive.value != value) throw new Error(`expected constant ${primitive.value} was not present during write`);
			//this is a nop, the existence of this field implis its value
		},
		getTypescriptType() {
			if (typeof primitive.value == "number" || typeof primitive.value == "boolean") {
				return JSON.stringify(primitive.value);
			} else if (primitive.value == null) {
				return "null";
			} else {
				return typeof primitive.value;
			}
		},
		getJsonSchema() {
			return { const: primitive.value as any }
		}
	}
}
function referenceValueParser(args: unknown[], parent: ChunkParent, typedef: TypeDef): ChunkParser<number> {
	let r: ChunkParser<number> = {
		read(state) {
			let value = ref.read(state);
			if (minbit != -1) {
				value = (value >> minbit) & ~((~0) << bitlength);
			}
			return value + offset;
		},
		write(state, value) {
			//noop, the referenced value does the writing and will get its value from this prop through refgetter
		},
		getTypescriptType() {
			return "number";
		},
		getJsonSchema() {
			return {
				type: "integer",
				minimum: (bitlength == -1 ? undefined : 0),
				maximum: (bitlength == -1 ? undefined : 2 ** bitlength - 1)
			}
		}
	}

	if (args.length < 1) throw new Error(`1 argument exptected for proprety with type ref`);
	if (typeof args[0] != "string") { throw new Error("ref propname expected"); }
	let propname = args[0];
	let [minbit, bitlength] = [-1, -1];
	if (args[1]) {
		if (Array.isArray(args[1]) && args[1].length == 2 && typeof args[1][0] == "number" && typeof args[1][1] == "number") {
			minbit = args[1][0];
		} else {
			throw new Error("second argument for ref should be [minbit,bitlen] pair");
		}
	}
	let offset = args[2] ?? 0;
	if (typeof offset != "number") { throw new Error("ref offset should be a number"); }

	let ref = refgetter(r, parent, propname, (v, old) => {
		if (typeof v != "number") { throw new Error("number expected"); }
		if (minbit != -1) {
			let mask = (~(-1 << bitlength)) << minbit;
			return (old & ~mask) | (v << minbit);
		} else {
			return v;
		}
	});

	return r;
}
function bytesRemainingParser(): ChunkParser<number> {
	return {
		read(state) {
			return state.endoffset - state.scan;
		},
		write(state, value) {
			//nop, value exists only in context of output
		},
		getTypescriptType() {
			return "number";
		},
		getJsonSchema() {
			return { type: "integer" };
		}
	}
}

function intAccumlatorParser(args: unknown[], parent: ChunkParent, typedef: TypeDef): ChunkParser {
	let r: ChunkParserContainer<number> = {
		read(state) {
			//TODO fix the context situation
			let increment = value.read(state);
			let newvalue: number;
			let refvalue = ref.read(state) ?? 0;
			if (mode == "add" || mode == "add-1" || mode == "postadd") {
				newvalue = refvalue + (increment ?? 0) + (mode == "add-1" ? -1 : 0);
			} else if (mode == "hold") {
				newvalue = increment ?? refvalue;
			} else {
				throw new Error("unknown accumolator mode");
			}
			ref.write(state, newvalue);
			return (mode == "postadd" ? refvalue : newvalue);
		},
		resolveReference(name, child) {
			return buildReference(name, parent, { owner: r, stackdepth: child.stackdepth, resolve: child.resolve });
		},
		write(state, value) {
			//need to make the struct writer grab its value from here for invisible props
			throw new Error("write for accumolator not implemented");
		},
		getTypescriptType() {
			return "number";
		},
		getJsonSchema() {
			return { type: "integer" };
		}
	}

	if (args.length < 2) throw new Error(`2 arguments exptected for proprety with type accum`);
	let refname = args[0];
	let value = buildParser(r, args[1] as ComposedChunk, typedef);
	let mode = args[2] ?? "add";
	if (typeof refname != "string") { throw new Error("ref name should be a string"); }

	let ref = refgetter(r, parent, refname, (v, old) => {
		throw new Error("write for accumolator not implemented");
	});

	return r;
}

function stringParser(primitive: PrimitiveString): ChunkParser<string> {
	validateStringType(primitive);
	return {
		read(state) {
			let encoding = primitive.encoding;
			let termination = primitive.termination;
			for (let i = 0; i < primitive.prebytes.length; i++, state.scan++) {
				if (state.buffer.readUInt8(state.scan) != primitive.prebytes[i]) {
					throw new Error("failed to match string header bytes");
				}
			}
			let end = state.scan;
			for (; end < state.endoffset; ++end) {
				if ((termination === null && state.buffer.readUInt8(end) == 0x0) || (end - state.scan) == termination) {
					break;
				}
			}
			let outputstr = state.buffer.toString(encoding, state.scan, end);
			state.scan = end + 1;
			return outputstr;
		},
		write(state, value) {
			if (typeof value != "string") throw new Error(`string expected`);
			validateStringType(primitive);
			let encoding = primitive.encoding;
			let termination = primitive.termination;
			let strbuf = Buffer.from([...primitive.prebytes, ...Buffer.from(value, encoding)]);
			//either pad with 0's to fixed length and truncate and longer strings, or add a single 0 at the end
			let strbinbuf = Buffer.alloc(termination == null ? strbuf.byteLength + 1 : termination, 0);
			strbuf.copy(strbinbuf, 0, 0, Math.max(strbuf.byteLength, strbinbuf.byteLength));
			strbinbuf.copy(state.buffer, state.scan);
			state.scan += strbinbuf.byteLength;
		},
		getTypescriptType() {
			return "string";
		},
		getJsonSchema() {
			return { type: "string" };
		}
	}
}

function booleanParser(): ChunkParser<boolean> {
	return {
		read(state) {
			let boolint = state.buffer.readUInt8(state.scan++);
			if (boolint != 1 && boolint != 0) throw new Error(`value 0x${boolint} parsed as bool was not 0x00 or 0x01`)
			return boolint != 0;
		},
		write(state, value) {
			state.buffer.writeUInt8(value ? 1 : 0, state.scan++);
		},
		getTypescriptType() {
			return "boolean";
		},
		getJsonSchema() {
			return { type: "boolean" };
		}
	}
}

const hardcodes: Record<string, (args: unknown[], parent: ChunkParent, typedef: TypeDef) => ChunkParser> = {
	playeritem: function () {
		return {
			read(state) {
				let byte0 = state.buffer.readUInt8(state.scan++);
				if (byte0 == 0) { return 0; }
				let byte1 = state.buffer.readUInt8(state.scan++);
				if (byte1 == 0xff && byte0 == 0xff) { return -1; }
				return (byte0 << 8) | byte1;
			},
			write(state, value) {
				if (typeof value != "number") { throw new Error("number expected"); }
				if (value == 0) {
					state.buffer.writeUInt8(0, state.scan++);
				} else {
					//replicate explicit 16bit overflow bug since that's what the game does
					state.buffer.writeUint16BE((value == -1 ? 0xffff : value & 0xffff), state.scan);
					state.scan += 2;
				}
			},
			getTypescriptType() { return "number"; },
			getJsonSchema() { return { type: "integer", minimum: -1, maximum: 0xffff - 0x4000 - 1 }; }
		}
	},
	itemvar: function (args) {
		let type = args[0];
		if (typeof type != "string" || !["ref", "matcount", "colorcount", "modelcount"].includes(type)) { throw new Error(); }

		//yes this is hacky af...
		return {
			read(state) {
				if (type == "ref") { state.args.activeitem = (state.args.activeitem ?? -1) + 1; }
				let ref = state.args.slots[state.args.activeitem];
				if (type == "ref") { return ref; }
				else if (type == "matcount") { return ref?.replaceMaterials?.length ?? 0; }
				else if (type == "colorcount") { return ref?.replaceColors?.length ?? 0; }
				else if (type == "modelcount") { return ref?.models.length; }
				else { throw new Error(); }
			},
			write() {
				//noop
			},
			getTypescriptType() { return (type == "ref" ? "any" : "number"); },
			getJsonSchema() { return { type: (type == "ref" ? "any" : "integer") } }
		}
	},
	buildnr: function (args, typedef) {
		return {
			read(state) { return state.clientVersion },
			write(state, v) {/*noop*/ },
			getTypescriptType(indent) { return "number"; },
			getJsonSchema() { return { type: "number" } }
		}
	},
	match: function (args, parent, typedef) {
		if (args.length != 2) { throw new Error("match chunks needs 2 arguments") }
		if (typeof args[1] != "object") { throw new Error("match chunk requires 2n+2 arguments"); }

		type ops = "=" | "<" | "<=" | ">" | ">=" | "&" | "default"

		let r: ChunkParserContainer<any> = {
			read(state) {
				let opcodeprop = { $opcode: 0 };
				state.stack.push({});
				state.hiddenstack.push(opcodeprop);
				let value = optparser.read(state);
				opcodeprop.$opcode = value;
				let res: any;
				let matched = false;
				for (let option of options) {
					switch (option.op) {
						case "=": matched = value == option.value; break;
						case "<": matched = value < option.value; break;
						case "<=": matched = value <= option.value; break;
						case ">": matched = value > option.value; break;
						case ">=": matched = value >= option.value; break;
						case "&": matched = (value & option.value) != 0; break;
						case "default": matched = true; break;
					}
					if (matched) {
						res = option.parser.read(state);
						break;
					}
				}
				state.stack.pop();
				state.hiddenstack.pop();
				if (!matched) { throw new Error("no opcode matched"); }
				return res;
			},
			write(state, v) {
				//no way to retrieve the opcode, so this only works for refs/constants
				optparser.write(state, null);
			},
			resolveReference(name, child) {
				let res: ResolvedReference = {
					owner: r,
					stackdepth: child.stackdepth + 1,
					resolve(v, old) {
						//this info is lost
						return old;
					}
				}
				if (name == "$opcode") { return res; }
				return buildReference(name, parent, res);
			},
			getTypescriptType(indent) {
				return "(" + options.map(opt => opt.parser.getTypescriptType(indent + "\t")).join("|") + ")";
			},
			getJsonSchema() {
				return { oneOf: options.map(opt => opt.parser.getJsonSchema()) };
			},
		}

		let options: { op: ops, value: number, parser: ChunkParser }[] = [];
		let optparser = buildParser(r, args[0] as ComposedChunk, typedef);
		for (let opt in args[1]) {
			let op: ops;
			let value = 0;
			if (opt == "default" || opt == "other") {
				op = "default";
			} else {
				let m = opt.match(/(?<op><|<=|>|>=|&)?(?<version>(0x)?\d+)/);
				if (!m) { throw new Error("invalid match value, expected <op><version>. For example '>10'"); }
				value = parseInt(m.groups!.version);
				op = (m.groups!.op ?? "=") as ops;
			}
			options.push({ op, value, parser: buildParser(r, args[1][opt], typedef) });
		}

		return r;
	},
	footer: function (args, parent, typedef) {
		if (args.length != 2) { throw new Error("footer requires length and subtype arguments"); }
		let lentype = buildParser(parent, args[0] as any, typedef);
		let subtype = buildParser(parent, args[1] as any, typedef);
		return {
			read(state) {
				let len = lentype.read(state);
				let oldscan = state.scan;
				let footstart = state.endoffset - len;
				state.scan = footstart;
				let res = subtype.read(state);
				if (debugdata) {
					debugdata.opcodes.push({ op: `footer`, index: oldscan, stacksize: state.stack.length + 1, external: { start: footstart, len: state.scan - footstart } });
				}
				if (state.scan != state.endoffset) { console.log(`didn't read full footer, ${state.endoffset - state.scan} bytes left`); }
				state.scan = oldscan;
				state.endoffset = state.endoffset - len;

				return res;
			},
			write(state, v) {
				throw new Error("not implemented");
			},
			getTypescriptType(indent) {
				return subtype.getTypescriptType(indent);
			},
			getJsonSchema() {
				return subtype.getJsonSchema();
			},
		}
	}
}


function primitiveParser(parent: ChunkParent, primitive: Primitive<any>, typedef: TypeDef): ChunkParser {
	if (!("primitive" in primitive)) throw new Error(`Invalid primitive definition '${JSON.stringify(primitive)}', needs to specify its datatype (e.g. "primitive": "int")`);
	switch (primitive.primitive) {
		case "bool":
			return booleanParser();
		case "int":
			return intParser(primitive);
		case "float":
			return floatParser(primitive);
		case "string":
			return stringParser(primitive);
		case "value":
			return literalValueParser(primitive);
		case "hardcode":
			let parser = hardcodes[primitive.name];
			if (!parser) { throw new Error(`hardcode parser ${primitive.name} does not exist`); }
			return parser([], parent, typedef);
		default:
			//@ts-ignore
			throw new Error(`Unsupported primitive '${primitive.primitive}' in typedef.json`);
	}
}
