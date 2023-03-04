import type * as jsonschema from "json-schema";

type CompareMode = "eq" | "eqnot" | "bitflag" | "bitflagnot" | "bitor" | "bitand" | "gteq" | "lteq";

export type TypeDef = { [name: string]: unknown };

const BufferTypes = {
	buffer: { constr: Buffer as any as Uint8ArrayConstructor },//Buffer typings doesn't have BYTES_PER_ELEMENT
	hex: { constr: Uint8Array },//used to debug into json file
	byte: { constr: Int8Array },
	ubyte: { constr: Uint8Array },
	short: { constr: Int16Array },
	ushort: { constr: Uint16Array },
	int: { constr: Int32Array },
	uint: { constr: Uint32Array },
	float: { constr: Float32Array }
};

var debugdata: null | {
	structstack: object[],
	opcodes: {
		op: number | string,
		index: number,
		stacksize: number,
		external?: { start: number, len: number }
	}[]
} = null;

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
	resolve(v: unknown, oldvalue: number): number
}

export type ChunkParser = {
	read(state: DecodeState): any,
	write(state: EncodeState, v: unknown): void,
	getTypescriptType(indent: string): string,
	getJsonSchema(): jsonschema.JSONSchema6Definition
}

type ChunkParentCallback = (prop: string, childresolve: ResolvedReference) => ResolvedReference;

function resolveAlias(typename: string, parent: ChunkParentCallback, typedef: TypeDef) {
	if (!Object.hasOwn(typedef, typename)) {
		throw new Error(`Type '${typename}' not found in typedef.json`);
	}
	let newtype = typedef[typename];
	if (typeof newtype != "string") {
		//TODO this recursion is unchecked
		return buildParser(parent, newtype, typedef);
	} else if (Object.hasOwn(parserPrimitives, newtype)) {
		return parserPrimitives[newtype];
	} else {
		return resolveAlias(newtype, parent, typedef);
	}
}

export function buildParser(parent: ChunkParentCallback | null, chunkdef: unknown, typedef: TypeDef): ChunkParser {
	parent ??= () => { throw new Error("reference failed to resolve"); };
	switch (typeof chunkdef) {
		case "boolean":
		case "number":
			return literalValueParser(chunkdef);
		case "string": {
			if (Object.hasOwn(parserPrimitives, chunkdef)) {
				return parserPrimitives[chunkdef];
			} else {
				return resolveAlias(chunkdef, parent, typedef);
			}
		}
		case "object":
			if (chunkdef == null) {
				return literalValueParser(null);
			} else if (!Array.isArray(chunkdef)) {
				return opcodesParser(chunkdef, parent, typedef);
			} else {
				if (chunkdef.length < 1) throw new Error(`'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(chunkdef)}`);
				let args = chunkdef.slice(1);
				if (parserFunctions[chunkdef[0]]) {
					return parserFunctions[chunkdef[0]](args, parent, typedef);
				}
			}
		default:
			throw new Error(`'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(chunkdef)}`);
	}
}

function opcodesParser(chunkdef: {}, parent: ChunkParentCallback, typedef: TypeDef) {
	let r: ChunkParser = {
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

	let resolveReference = function (targetprop: string, name: string, childresolve: ResolvedReference) {
		let result: ResolvedReference = {
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
	}

	let opcodetype = buildParser(null, (chunkdef["$opcode"] ?? "unsigned byte"), typedef);
	let opts: Record<string, { op: number, parser: ChunkParser }> = {};
	for (let key in chunkdef) {
		if (key.startsWith("$")) { continue; }
		let op = chunkdef[key];
		if (typeof op != "object" || !op) { throw new Error("op name expected"); }
		let opname = op["name"];
		if (typeof opname != "string") { throw new Error("op name expected"); }
		if (opts[opname]) { throw new Error("duplicate opcode key " + opname); }
		opts[opname] = {
			op: parseInt(key),
			parser: buildParser(resolveReference.bind(null, key), op["read"], typedef)
		};
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

function tuppleParser(args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) {
	let r: ChunkParser = {
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
	};

	const resolveReference = function (index: number, name: string, child: ResolvedReference) {
		return buildReference(name, parent, {
			stackdepth: child.stackdepth,
			resolve(v, old) {
				if (!Array.isArray(v)) { throw new Error("Array expected"); }
				return child.resolve(v[index], old)
			}
		})
	}

	let props = args.map((d, i) => buildParser(resolveReference.bind(null, i), d, typedef));
	return r;
}

export function buildReference(name: string, container: ChunkParentCallback | null, startingpoint: ResolvedReference) {
	if (!container) { throw new Error("reference " + name + " could not be resolved"); }
	return container(name, startingpoint);
}

function refgetter(refparent: ChunkParentCallback | null, propname: string, resolve: (v: unknown, old: number) => number) {
	let final = buildReference(propname, refparent, { stackdepth: 0, resolve });
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

function structParser(args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) {
	let refs: Record<string, ResolvedReference[] | undefined> = {};
	let r: ChunkParser = {
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

	let resolveReference = function (targetprop: string, name: string, childresolve: ResolvedReference) {
		let result: ResolvedReference = {
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
	}

	let props = {};
	for (let propdef of args) {
		if (!Array.isArray(propdef) || propdef.length != 2) { throw new Error("each struct args should be a [name,type] pair"); }
		if (typeof propdef[0] != "string") { throw new Error("prop name should be string"); }
		if (props[propdef[0]]) { throw new Error("duplicate struct prop " + propdef[0]); }
		props[propdef[0]] = buildParser(resolveReference.bind(null, propdef[0]), propdef[1], typedef);
	}
	let keys = Object.keys(props);
	return r;
}

function optParser(args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) {
	let r: ChunkParser = {
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

	let resolveReference = function (name: string, child: ResolvedReference) {
		return buildReference(name, parent, {
			stackdepth: child.stackdepth,
			resolve(v, old) {
				return (v != null ? child.resolve(v, old) : old);
			}
		})
	}

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

	let ref = refgetter(parent, condvar, (v: unknown, oldvalue: number) => {
		return forceCondition(cmpmode, condvalue, oldvalue, v != null);
	});

	let type = buildParser(resolveReference, args[1], typedef);

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

function chunkedArrayParser(args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) {
	let r: ChunkParser = {
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
						.map(([key, prop]) => [key, prop.getJsonSchema()])
					),
					required: keys.filter(k => !k.startsWith("$"))
				}
			};
		}
	};
	const resolveLength: ChunkParentCallback = function (prop, childresolve) {
		return buildReference(prop, parent, {
			stackdepth: childresolve.stackdepth,
			resolve(v, old) {
				if (!Array.isArray(v)) { throw new Error("array expected"); }
				return childresolve.resolve(v.length, old);
			}
		});
	}

	const resolveReference = function (targetprop: string, name: string, childresolve: ResolvedReference) {
		let result: ResolvedReference = {
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
	}

	let rawchunks = args.slice(1);
	let lengthtype = buildParser(resolveLength, args[0], typedef);

	let refs: Record<string, ResolvedReference[] | undefined> = {};
	let fullobj: Record<string, ChunkParser> = {};
	let chunktypes: Record<string, ChunkParser>[] = [];
	for (let chunk of rawchunks) {
		if (!Array.isArray(chunk)) { throw new Error("each argument for composed chunk should be an array") }
		let group: Record<string, ChunkParser> = {};
		chunktypes.push(group);
		for (let propdef of chunk as unknown[]) {
			if (!Array.isArray(propdef) || propdef.length != 2 || typeof propdef[0] != "string") { throw new Error("each composedchunk should be a [name,type] pair"); }
			let p = buildParser(resolveReference.bind(null, propdef[0]), propdef[1], typedef);
			group[propdef[0]] = p;
			fullobj[propdef[0]] = p;
		}
	}

	let keys = chunktypes.flatMap(Object.keys);

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

function bufferParser(args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) {
	let r: ChunkParser = {
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
		getTypescriptType(indent) {
			return type.constr.name;
		},
		getJsonSchema() {
			return { type: "string" };
		}
	};

	const resolveLengthReference: ChunkParentCallback = function (name, child) {
		return buildReference(name, parent, {
			stackdepth: child.stackdepth,
			resolve(rawvalue, old) {
				let value = bufferParserValue(rawvalue, type, scalartype);
				return child.resolve(value.length / vectorLength, old);
			}
		});
	}

	if (args.length < 1) throw new Error(`'read' variables interpretted as an array must contain items: ${JSON.stringify(args)}`);
	let typestring = args[1] ?? "buffer";
	let lenarg = args[2] ?? 1;
	if (typeof typestring != "string" || !Object.hasOwn(BufferTypes, typestring)) { throw new Error("unknown buffer type " + args[1]); }
	if (typeof lenarg != "number") { throw new Error("vectorlength should be a number"); }
	let vectorLength = lenarg;
	let scalartype: keyof typeof BufferTypes = typestring as any;

	let lengthtype = buildParser(resolveLengthReference, args[0], typedef);
	const type = BufferTypes[typestring];
	return r;
}

function arrayParser(args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) {
	let r: ChunkParser = {
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
	const resolveLengthReference: ChunkParentCallback = function (name, child) {
		return buildReference(name, parent, {
			stackdepth: child.stackdepth,
			resolve(v, old) {
				if (!Array.isArray(v)) { throw new Error("array expected"); }
				return child.resolve(v.length, old);
			}
		});
	}
	const resolvePropReference = function (name, child) {
		return buildReference(name, parent, {
			stackdepth: child.stackdepth,
			resolve(v, old) {
				if (!Array.isArray(v)) { throw new Error("array expected"); }
				//possibly do this for all elements in the array if needed and allowed by performance
				return child.resolve(v[0], old);
			}
		});
	}


	if (args.length < 1) throw new Error(`'read' variables interpretted as an array must contain items: ${JSON.stringify(args)}`);
	let sizearg = (args.length >= 2 ? args[0] : "variable unsigned short");
	let lengthtype = buildParser(resolveLengthReference, sizearg, typedef);
	let subtype = buildParser(resolvePropReference, args[args.length >= 2 ? 1 : 0], typedef);
	return r;
}

function arrayNullTerminatedParser(args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) {
	let r: ChunkParser = {
		read(state) {
			let r: any[] = [];
			let ctx = { $opcode: 0 };
			state.hiddenstack.push(ctx);
			state.stack.push({});
			while (true) {
				let oldscan = state.scan;
				let header = lengthtype.read(state);
				if (debugdata) {
					debugdata.opcodes.push({ op: "$opcode", index: oldscan, stacksize: state.stack.length });
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
	const resolveReference: ChunkParentCallback = function (name, child) {
		if (name == "$opcode") {
			return {
				stackdepth: child.stackdepth + 1,
				resolve(v, old) { throw new Error("not implemented") }
			}
		}
		return buildReference(name, parent, {
			stackdepth: child.stackdepth + 1,
			resolve(v, old) {
				if (!Array.isArray(v)) { throw new Error("array expcted"); }
				//possibly do this for all elements in the array if needed and allowed by performance
				return child.resolve(v[0], old);
			}
		})
	}

	if (args.length < 1) throw new Error(`'read' variables interpretted as an array must contain items: ${JSON.stringify(args)}`);
	let sizearg = (args.length >= 2 ? args[0] : "variable unsigned short");
	let lengthtype = buildParser(null, sizearg, typedef);
	let subtype = buildParser(resolveReference, args[args.length >= 2 ? 1 : 0], typedef);
	return r;
}

function literalValueParser(constvalue: unknown) {
	if (typeof constvalue != "number" && typeof constvalue != "string" && typeof constvalue != "boolean" && constvalue != null) {
		throw new Error("only bool, number, string or null literals allowed");
	}
	return {
		read(state) {
			return constvalue;
		},
		write(state, value) {
			if (value != constvalue) throw new Error(`expected constant ${constvalue} was not present during write`);
			//this is a nop, the existence of this field implies its value
		},
		getTypescriptType() {
			return JSON.stringify(constvalue);
		},
		getJsonSchema() {
			return { const: constvalue }
		}
	}
}
function referenceValueParser(args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) {
	let r: ChunkParser = {
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
			bitlength = args[1][1];
		} else {
			throw new Error("second argument for ref should be [minbit,bitlen] pair");
		}
	}
	let offset = args[2] ?? 0;
	if (typeof offset != "number") { throw new Error("ref offset should be a number"); }

	let ref = refgetter(parent, propname, (v, old) => {
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
function bytesRemainingParser(): ChunkParser {
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

function intAccumlatorParser(args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) {
	let r: ChunkParser = {
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

	const resolveReference: ChunkParentCallback = function (name, child) {
		//TODO can't just use parent here?
		return buildReference(name, parent, { stackdepth: child.stackdepth, resolve: child.resolve });
	}

	if (args.length < 2) throw new Error(`2 arguments exptected for proprety with type accum`);
	let refname = args[0];
	let value = buildParser(resolveReference, args[1], typedef);
	let mode = args[2] ?? "add";
	if (typeof refname != "string") { throw new Error("ref name should be a string"); }

	let ref = refgetter(parent, refname, (v, old) => {
		throw new Error("write for accumolator not implemented");
	});

	return r;
}

function stringParser(prebytes: number[]): ChunkParser {
	const encoding = "latin1";
	return {
		read(state) {
			for (let i = 0; i < prebytes.length; i++, state.scan++) {
				if (state.buffer.readUInt8(state.scan) != prebytes[i]) {
					throw new Error("failed to match string header bytes");
				}
			}
			let end = state.scan;
			while (true) {
				if (end == state.endoffset) {
					throw new Error("reading string without null termination");
				}
				if (state.buffer.readUInt8(end) == 0) {
					break;
				}
				end++;
			}
			let outputstr = state.buffer.toString(encoding, state.scan, end);
			state.scan = end + 1;
			return outputstr;
		},
		write(state, value) {
			if (typeof value != "string") throw new Error(`string expected`);
			let writebytes = [
				...prebytes,
				...Buffer.from(value, encoding),
				0
			];
			state.buffer.set(writebytes, state.scan);
			state.scan += writebytes.length;;
		},
		getTypescriptType() {
			return "string";
		},
		getJsonSchema() {
			return { type: "string" };
		}
	}
}

const hardcodes: Record<string, (args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) => ChunkParser> = {
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

		let r: ChunkParser = {
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
			getTypescriptType(indent) {
				return "(" + options.map(opt => opt.parser.getTypescriptType(indent + "\t")).join("|") + ")";
			},
			getJsonSchema() {
				return { oneOf: options.map(opt => opt.parser.getJsonSchema()) };
			},
		}

		const resolveReference = function (name, child) {
			let res: ResolvedReference = {
				stackdepth: child.stackdepth + 1,
				resolve(v, old) {
					throw new Error("write not supported");
				}
			}
			if (name == "$opcode") { return res; }
			return buildReference(name, parent, res);
		}

		let options: { op: ops, value: number, parser: ChunkParser }[] = [];
		let optparser = buildParser(resolveReference, args[0], typedef);
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
			options.push({ op, value, parser: buildParser(resolveReference, args[1][opt], typedef) });
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
	},
	"tailed varushort": function (args, parent, typedef) {
		const overflowchunk = 0x7fff;
		return {
			read(state) {
				let sum = 0;
				while (true) {
					let byte0 = state.buffer.readUint8(state.scan++);
					let v: number;
					if ((byte0 & 0x80) == 0) {
						v = byte0;
					} else {
						let byte1 = state.buffer.readUint8(state.scan++);
						v = ((byte0 & 0x7f) << 8) | byte1;
					}
					sum += v;
					if (v != overflowchunk) {
						return sum;
					}
				}
			},
			write(state, v) {
				if (typeof v != "number") { throw new Error("number expected"); }
				while (v >= 0) {
					let chunk = Math.min(overflowchunk, v);
					if (chunk < 0x80) {
						state.buffer.writeUint8(chunk, state.scan++);
					} else {
						state.buffer.writeUint16BE(chunk | 0x8000, state.scan);
						state.scan += 2;
					}
					v -= chunk;
				}
			},
			getTypescriptType(indent) {
				return "number";
			},
			getJsonSchema() {
				return { type: "number" };
			}
		}
	}
}

const numberTypes: Record<string, { read: (s: DecodeState) => number, write: (s: EncodeState, v: number) => void, min: number, max: number }> = {
	ubyte: {
		read(s) { let r = s.buffer.readUInt8(s.scan); s.scan += 1; return r; },
		write(s, v) { s.buffer.writeUInt8(v, s.scan); s.scan += 1; },
		min: 0, max: 255
	},
	byte: {
		read(s) { let r = s.buffer.readInt8(s.scan); s.scan += 1; return r; },
		write(s, v) { s.buffer.writeInt8(v, s.scan); s.scan += 1; },
		min: -128, max: 127
	},
	ushort: {
		read(s) { let r = s.buffer.readUInt16BE(s.scan); s.scan += 2; return r; },
		write(s, v) { s.buffer.writeUInt16BE(v, s.scan); s.scan += 2; },
		min: 0, max: 2 ** 16 - 1
	},
	short: {
		read(s) { let r = s.buffer.readInt16BE(s.scan); s.scan += 2; return r; },
		write(s, v) { s.buffer.writeInt16BE(v, s.scan); s.scan += 2; },
		min: -(2 ** 15), max: 2 ** 15 - 1
	},
	uint: {
		read(s) { let r = s.buffer.readUInt32BE(s.scan); s.scan += 4; return r; },
		write(s, v) { s.buffer.writeUInt32BE(v, s.scan); s.scan += 4; },
		min: 0, max: 2 ** 32 - 1
	},
	int: {
		read(s) { let r = s.buffer.readInt32BE(s.scan); s.scan += 4; return r; },
		write(s, v) { s.buffer.writeInt32BE(v, s.scan); s.scan += 4; },
		min: -(2 ** 31), max: 2 ** 31 - 1
	},

	uint_le: {
		read(s) { let r = s.buffer.readUInt32LE(s.scan); s.scan += 4; return r; },
		write(s, v) { s.buffer.writeUint32LE(v, s.scan); s.scan += 4; },
		min: 0, max: 2 ** 32 - 1
	},
	ushort_le: {
		read(s) { let r = s.buffer.readUInt16LE(s.scan); s.scan += 2; return r; },
		write(s, v) { s.buffer.writeUint16LE(v, s.scan); s.scan += 2; },
		min: 0, max: 2 ** 16 - 1
	},
	utribyte: {
		read(s) { let r = s.buffer.readUIntBE(s.scan, 3); s.scan += 3; return r; },
		write(s, v) { s.buffer.writeUintBE(v, s.scan, 3); s.scan += 3; },
		min: 0, max: 2 ** 24 - 1
	},
	float: {
		read(s) { let r = s.buffer.readFloatBE(s.scan); s.scan += 4; return r; },
		write(s, v) { s.buffer.writeFloatBE(v, s.scan); s.scan += 4; },
		min: Number.MIN_VALUE, max: Number.MAX_VALUE
	},

	varushort: {
		read(s) {
			let firstByte = s.buffer.readUInt8(s.scan++);
			if ((firstByte & 0x80) == 0) {
				return firstByte;
			}
			let secondByte = s.buffer.readUInt8(s.scan++);
			return ((firstByte & 0x7f) << 8) | secondByte;
		},
		write(s, v) {
			if (v < 0x80) {
				s.buffer.writeUInt8(v, s.scan);
				s.scan += 1;
			} else {
				s.buffer.writeUint16BE(v | 0x8000, s.scan);
				s.scan += 2;
			}
		},
		min: 0, max: 2 ** 15 - 1
	},
	varshort: {
		read(s) {
			let firstByte = s.buffer.readUInt8(s.scan++);
			if ((firstByte & 0x80) == 0) {
				//sign extend from 7nth bit (>> fills using 32th bit)
				return (firstByte << (32 - 7)) >> (32 - 7);
			}
			let secondByte = s.buffer.readUInt8(s.scan++);
			return ((((firstByte & 0x7f) << 8) | secondByte) << (32 - 15)) >> (32 - 15);
		},
		write(s, v) {
			if (v < 0x40 && v >= -0x40) {
				s.buffer.writeUInt8(v & 0x7f, s.scan);
				s.scan += 1;
			} else {
				s.buffer.writeInt16BE(v | 0x8000, s.scan);
				s.scan += 2;
			}
		},
		min: -(2 ** 14), max: 2 ** 14 - 1
	},
	varuint: {
		read(s) {
			let firstWord = s.buffer.readUInt16BE(s.scan);
			s.scan += 2;
			if ((firstWord & 0x8000) == 0) {
				return firstWord;
			} else {
				let secondWord = s.buffer.readUInt16BE(s.scan);
				s.scan += 2;
				return ((firstWord & 0x7fff) << 16) | secondWord;
			}
		},
		write(s, v) {
			if (v < 0x8000) {
				s.buffer.writeUInt16BE(v, s.scan);
				s.scan += 2;
			} else {
				s.buffer.writeUint32BE(v | 0x80000000, s.scan);
				s.scan += 4;
			}
		},
		min: 0, max: 2 ** 31 - 1
	},
	varint: {
		read(s) {
			let firstWord = s.buffer.readUInt16BE(s.scan);
			s.scan += 2;
			if ((firstWord & 0x8000) == 0) {
				//sign extend from 7nth bit (>> fills using 32th bit)
				return (firstWord << (32 - 15)) >> (32 - 15);
			}
			let secondWord = s.buffer.readUInt16BE(s.scan);
			s.scan += 2;
			return ((((firstWord & 0x7fff) << 16) | secondWord) << (32 - 31)) >> (32 - 31);
		},
		write(s, v) {
			if (v < 0x4000 && v >= -0x4000) {
				//reset bits 31-15
				s.buffer.writeUInt16BE(v & 0x7fff, s.scan);
				s.scan += 2;
			} else {
				s.buffer.writeInt32BE(v | 0x800000, s.scan);
				s.scan += 4;
			}
		},
		min: -(2 ** 30), max: 2 ** 30 - 1
	}
}

const parserPrimitives: Record<string, ChunkParser> = {
	...Object.fromEntries(Object.entries(numberTypes).map<[string, ChunkParser]>(([k, e]) => [k, {
		read: e.read,
		write: (s, v) => {
			if (typeof v != "number" || v > e.max || v < e.min) { throw new Error(); }
			e.write(s, v);
		},
		getJsonSchema() {
			return { type: "number", maximum: e.max, minimum: e.min };
		},
		getTypescriptType(indent) {
			return "number";
		}
	}])),
	bool: {
		read(s) {
			let r = s.buffer.readUInt8(s.scan++);
			if (r != 0 && r != 1) { throw new Error("1 or 0 expected boolean value"); }
			return r != 0;
		},
		write(s, v) {
			if (typeof v != "boolean") { throw new Error("boolean expected"); }
			s.buffer.writeUInt8(+v, s.scan++);
		},
		getJsonSchema() {
			return { type: "boolean" };
		},
		getTypescriptType(indent) {
			return "boolean";
		}
	},
	string: stringParser([]),
	paddedstring: stringParser([0]),
}

const parserFunctions = {
	ref: referenceValueParser,
	accum: intAccumlatorParser,
	opt: optParser,
	chunkedarray: chunkedArrayParser,
	bytesleft: bytesRemainingParser,
	buffer: bufferParser,
	nullarray: arrayNullTerminatedParser,
	array: arrayParser,
	struct: structParser,
	tuple: tuppleParser,

	...hardcodes,
	...parserPrimitives
}
