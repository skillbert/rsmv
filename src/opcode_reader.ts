import { lastLegacyBuildnr } from "./constants";
import type * as jsonschema from "json-schema";
import type { ClientscriptObfuscation } from "./clientscript/callibrator";

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
	rootstate: unknown,
	opcodes: {
		op: string,
		index: number,
		stacksize: number,
		jump?: { to: number }
	}[]
} = null;

export function getDebug(trigger: boolean) {
	let ret = debugdata;
	debugdata = trigger ? { rootstate: null, opcodes: [] } : null;
	return ret;
}

type SharedEncoderState = {
	isWrite: boolean,
	stack: object[],
	hiddenstack: object[],
	scan: number,
	endoffset: number,
	buffer: Buffer,
	args: Record<string, unknown>
}

export type DecodeState = SharedEncoderState & { isWrite: false };
export type EncodeState = SharedEncoderState & { isWrite: true };

export type ResolvedReference = {
	stackdepth: number,
	resolve(v: unknown, oldvalue: number): number
}

export type ChunkParser = {
	read(state: DecodeState): any,
	write(state: EncodeState, v: unknown): void,
	getTypescriptType(indent: string): string,
	getJsonSchema(): jsonschema.JSONSchema6Definition,
	readConst?(state: SharedEncoderState): any
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
			if (debugdata && !debugdata.rootstate) { debugdata.rootstate = r; }
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
			return r;
		},
		write(state, value) {
			if (typeof value != "object" || !value) { throw new Error("oject expected") }
			state.stack.push(value);
			state.hiddenstack.push({});
			for (let key in value) {
				if (key.startsWith("$")) { continue; }
				let opt = opts[key];
				if (!opt) { throw new Error("unknown property " + key); }
				opcodetype.write(state, opt.op);
				opt.parser.write(state, value[key]);
			}
			if (!hasexplicitnull) {
				opcodetype.write(state, 0);
			}
			state.stack.pop();
			state.hiddenstack.pop();
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
	let refs: Record<string, ResolvedReference[] | undefined> = {};
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
		read(state: SharedEncoderState) {
			let stack = (hidden ? state.hiddenstack : state.stack);
			return stack[stack.length - depth][propname];
		},
		write(state: SharedEncoderState, newvalue: number) {
			if (state.isWrite && !hidden) { throw new Error(`can update ref values in write mode when they are hidden (prefixed with $) in ${propname}`); }
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
			if (debugdata && !debugdata.rootstate) { debugdata.rootstate = r; }
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
			let hiddenvalue = {};
			state.stack.push(value);
			state.hiddenstack.push(hiddenvalue);
			for (let key of keys) {
				let propvalue = value[key as string];
				let prop = props[key];

				if (key.startsWith("$")) {
					if (prop.readConst != undefined) {
						propvalue = prop.readConst(state);
					} else {
						let refarray = refs[key];
						if (!refarray) { throw new Error("cannot write hidden values if they are not constant or not referenced"); }
						propvalue ??= 0;
						for (let ref of refarray) {
							propvalue = ref.resolve(value, propvalue);
						}
					}
					hiddenvalue[key] = propvalue;
				}
				prop.write(state, propvalue);
			}
			state.stack.pop();
			state.hiddenstack.pop();
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
			let matchindex = condchecker.match(state);
			if (matchindex == -1) { return null; }
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
	let arg1 = args[0];
	let condstr = "";
	if (typeof arg1 == "string") {
		condstr = arg1;
	} else {
		type CompareMode = "eq" | "eqnot" | "bitflag" | "bitflagnot" | "bitor" | "bitand" | "gteq" | "lteq";

		let condvar: string;
		let condvalue: number;
		let cmpmode: CompareMode = "eq";
		if (Array.isArray(arg1)) {
			if (typeof arg1[1] != "number") {
				throw new Error("only literal ints as condition value are supported");
			}
			condvar = arg1[0];
			cmpmode = arg1[2] ?? "eq";
			condvalue = arg1[1];
		} else {
			if (typeof arg1 != "number") { throw new Error(""); }
			condvar = "$opcode";
			condvalue = arg1;
		}
		let condmap: Record<CompareMode, string> = {
			bitand: "&=",
			bitflag: "&",
			bitflagnot: "!&",
			bitor: "&",
			eq: "==",
			eqnot: "!=",
			gteq: ">=",
			lteq: "<="
		}
		let mapped = condmap[cmpmode]
		if (cmpmode == "bitflag" || cmpmode == "bitflagnot") {
			condvalue = 1 << condvalue;
		}
		condstr = `${condvar}${mapped}${condvalue}`;
	}
	let condchecker = conditionParser(resolveReference, [condstr], v => (v == null ? -1 : 0));

	let type = buildParser(resolveReference, args[1], typedef);

	return r;
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
		write(state, v) {
			if (!Array.isArray(v)) { throw new Error("array expected"); }
			lengthtype.write(state, v.length);

			let hiddenprops: object[] = [];
			for (let chunkindex = 0; chunkindex < chunktypes.length; chunkindex++) {
				let proptype = chunktypes[chunkindex];
				for (let i = 0; i < v.length; i++) {
					let entry = v[i];
					let hiddenvalue = (chunkindex == 0 ? (hiddenprops[i] = {}) : hiddenprops[i]);
					state.stack.push(entry);
					state.hiddenstack.push(hiddenvalue);
					if (typeof entry != "object" || !entry) { throw new Error("object expected"); }
					for (let key in proptype) {
						let prop = proptype[key];
						let propvalue = entry[key];
						if (key.startsWith("$")) {
							if (prop.readConst != undefined) {
								propvalue = prop.readConst(state);
							} else {
								let refarray = refs[key];
								if (!refarray) { throw new Error("cannot write hidden values if they are not constant or not referenced"); }
								propvalue ??= 0;
								for (let ref of refarray) {
									propvalue = ref.resolve(entry, propvalue);
								}
							}
							hiddenvalue[key] = propvalue;
						}
						prop.write(state, propvalue);
					}
					state.stack.pop();
					state.hiddenstack.pop();
				}
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
			if (state.scan + bytelen > state.endoffset) { throw new Error("trying to read outside buffer bounds"); }
			let bytes = Buffer.from(backing);
			bytes.set(state.buffer.subarray(state.scan, state.scan + bytelen));
			state.scan += bytelen;
			let array = (scalartype == "buffer" ? bytes : new type.constr(backing));
			if (scalartype == "hex") { (array as any).toJSON = () => bytes.toString("hex"); }
			else if (state.args.keepBufferJson === true) { (array as any).toJSON = () => `buffer ${scalartype}${vectorLength != 1 ? `[${vectorLength}]` : ""}[${len}]`; }
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
				ctx.$opcode = header;
				let endint = endvalue.read(state);
				if (header == endint) { break; }
				r.push(subtype.read(state));
			}
			state.hiddenstack.pop();
			state.stack.pop();
			return r;
		},
		write(state, value) {
			if (!Array.isArray(value)) { throw new Error("array expected"); }
			//TODO probably very wrong
			state.stack.push(value);
			state.hiddenstack.push({});
			for (let prop of value) {
				lengthtype.write(state, 1);
				subtype.write(state, prop);
			}
			lengthtype.write(state, 0);
			state.stack.pop();
			state.hiddenstack.pop();
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
				if (!Array.isArray(v)) { throw new Error("array expected"); }
				//possibly do this for all elements in the array if needed and allowed by performance
				return child.resolve(v[0], old);
			}
		})
	}

	if (args.length < 1) throw new Error(`'read' variables interpretted as an array must contain items: ${JSON.stringify(args)}`);
	let sizearg = (args.length >= 2 ? args[0] : "variable unsigned short");
	let endintarg = (args.length >= 3 ? args[1] : 0);
	let lengthtype = buildParser(null, sizearg, typedef);
	let endvalue = buildParser(null, endintarg, typedef);
	let subtype = buildParser(resolveReference, args[args.length - 1], typedef);
	return r;
}

function literalValueParser(constvalue: unknown) {
	if (typeof constvalue != "number" && typeof constvalue != "string" && typeof constvalue != "boolean" && constvalue != null) {
		throw new Error("only bool, number, string or null literals allowed");
	}
	let r: ChunkParser = {
		read(state) {
			return constvalue;
		},
		readConst() {
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
	return r;
}
function referenceValueParser(args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) {
	let read = (state: SharedEncoderState) => {
		let value = ref.read(state);
		if (minbit != -1) {
			value = (value >> minbit) & ~((~0) << bitlength);
		}
		return value + offset;
	}
	let r: ChunkParser = {
		read,
		readConst: read,
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

function intAccumolatorParser(args: unknown[], parent: ChunkParentCallback, typedef: TypeDef) {
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
		write(state, v) {
			if (typeof v != "number") { throw new Error("number expected"); }

			let refvalue = ref.read(state) ?? 0;

			let increment: number;
			if (mode == "add" || mode == "add-1") {
				increment = v - refvalue + (mode == "add-1" ? 1 : 0);
			} else if (mode == "hold") {
				throw new Error("writing accum intaccum hold not implemented");
			} else if (mode == "postadd") {
				throw new Error("writing accum intaccum postadd not implemented");
			} else {
				throw new Error("unknown accumolator mode");
			}
			value.write(state, increment);
			ref.write(state, v);
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
	let value = buildParser(parent, args[1], typedef);
	let mode = args[2] ?? "add";
	if (typeof refname != "string") { throw new Error("ref name should be a string"); }

	let ref = refgetter(parent, refname, (v, old) => {
		return old;
	});

	return r;
}

function stringParser(prebytes: number[]): ChunkParser {
	const encoding = "latin1";
	return {
		read(state) {
			let terminator = (getClientVersion(state.args) <= lastLegacyBuildnr ? 0xA : 0);
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
				if (state.buffer.readUInt8(end) == terminator) {
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
			let terminator = (getClientVersion(state.args) <= lastLegacyBuildnr ? 0xA : 0);
			let writebytes = [
				...prebytes,
				...Buffer.from(value, encoding),
				terminator
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

function conditionParser(parent: ChunkParentCallback, optionstrings: string[], writegetindex?: (v: unknown) => number) {
	type ops = "=" | "<" | "<=" | ">" | ">=" | "&" | "!&" | "!=" | "&=";
	type cond = { op: ops, value: number, varname: string, varindex: number };

	let varmap: { name: string, parser: ReturnType<typeof refgetter> }[] = [];
	let options: cond[][] = [];
	for (let str of optionstrings) {
		str = str.replace(/\s/g, "");
		let parts = str.split(/&&/g);
		let conds: cond[] = [];
		for (let opt of parts) {
			let op: ops;
			let varname: string;
			let value = 0;
			if (opt == "default" || opt == "other") {
				continue;
			} else {
				let m = opt.match(/^((?<var>[\$a-zA-Z]\w*)?(?<op><|<=|>|>=|&|==|=|!&|&=|!=)?)?(?<version>0x[\da-fA=F]+|-?\d+)$/);
				if (!m) { throw new Error("invalid match value, expected <op><version>. For example '>10'"); }
				value = parseInt(m.groups!.version);
				op = (m.groups!.op ?? "=") as ops;
				if (op as any == "==") { op = "="; }
				varname = m.groups!.var ?? "$opcode";
			}

			let varindex = varmap.findIndex(q => q.name == varname);
			if (varindex == -1) {
				varindex = varmap.length;

				varmap.push({
					name: varname,
					parser: refgetter(parent, varname, (v, oldvalue) => {
						if (!writegetindex) { throw new Error("write not implemented"); }
						let index = writegetindex(v);

						for (let optionindex = 0; optionindex < options.length; optionindex++) {
							let option = options[optionindex];
							for (let con of option) {
								if (con.varindex != varindex) { continue; }
								let state = optionindex == index;
								let compValue = con.value;
								switch (con.op) {
									case "=": oldvalue = state ? compValue : oldvalue; break;
									case "!=": oldvalue = state ? oldvalue : compValue; break;
									case "&": oldvalue = (state ? oldvalue | compValue : oldvalue & ~compValue); break;
									case "&=": oldvalue = (state ? oldvalue | compValue : oldvalue & ~compValue); break;
									case "!&": oldvalue = (state ? oldvalue & ~compValue : oldvalue | compValue); break;
									case ">=": oldvalue = state ? Math.max(compValue, oldvalue) : oldvalue; break;
									case ">": oldvalue = state ? Math.max(compValue + 1, oldvalue) : oldvalue; break;
									case "<=": oldvalue = state ? Math.min(compValue, oldvalue) : oldvalue; break;
									case "<": oldvalue = state ? Math.min(compValue - 1, oldvalue) : oldvalue; break;
									default: throw new Error("unknown condition " + con.op);
								}
							}
						}
						return oldvalue;
					})
				});
			}

			conds.push({ op, value, varname, varindex });
		}
		options.push(conds);
	}

	let match = (state: SharedEncoderState) => {
		let vars = varmap.map(q => q.parser.read(state));

		for (let optindex = 0; optindex < options.length; optindex++) {
			let opt = options[optindex];
			let matched = true;
			for (let cond of opt) {
				let value = vars[cond.varindex];
				switch (cond.op) {
					case "=": matched = value == cond.value; break;
					case "!=": matched = value != cond.value; break;
					case "<": matched = value < cond.value; break;
					case "<=": matched = value <= cond.value; break;
					case ">": matched = value > cond.value; break;
					case ">=": matched = value >= cond.value; break;
					case "&": matched = (value & cond.value) != 0; break;
					case "!&": matched = (value & cond.value) == 0; break;
					case "&=": matched = (value & cond.value) == cond.value; break;
					default: throw new Error("unknown op" + cond.op);
				}
				if (!matched) {
					break;
				}
			}
			if (matched) {
				return optindex;
			}
		}
		return -1;
	}


	return { match };
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
				let activeitem = (typeof state.args.activeitem == "number" ? state.args.activeitem : -1);
				if (type == "ref") {
					activeitem++;
					state.args.activeitem = activeitem;
				}
				if (!Array.isArray(state.args.slots)) { throw new Error(""); }
				let ref = state.args.slots[activeitem];
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
			readConst(state) {
				return getClientVersion(state.args);
			},
			read(state) {
				return getClientVersion(state.args);
			},
			write(state, v) {/*noop*/ },
			getTypescriptType(indent) { return "number"; },
			getJsonSchema() { return { type: "number" } }
		}
	},
	match: function (args, parent, typedef) {
		let r: ChunkParser = {
			read(state) {
				let opcodeprop = { $opcode: 0 };
				state.stack.push({});
				state.hiddenstack.push(opcodeprop);
				let value = (opvalueparser ? opvalueparser.read(state) : 0);
				opcodeprop.$opcode = value;
				let opindex = conditionparser.match(state);
				if (opindex == -1) {
					throw new Error("no opcode matched");
				}
				let res = optionvalues[opindex].read(state);

				state.stack.pop();
				state.hiddenstack.pop();
				return res;
			},
			write(state, v) {
				let opcodeprop = { $opcode: 0 };
				state.stack.push({});
				state.hiddenstack.push(opcodeprop);

				if (opvalueparser) {
					//supporting this would require finding out the type from v
					if (!opvalueparser.readConst) { throw new Error("non-const or non-reference match value not implemented in write mode"); }
					opcodeprop.$opcode = opvalueparser.readConst(state);
				}
				let opindex = conditionparser.match(state);
				if (opindex == -1) { throw new Error("no opcode matched"); }
				optionvalues[opindex].write(state, v);

				state.stack.pop();
				state.hiddenstack.pop();
			},
			getTypescriptType(indent) {
				return "(" + optionvalues.map(opt => opt.getTypescriptType(indent + "\t")).join("|") + ")";
			},
			getJsonSchema() {
				return { anyOf: optionvalues.map(opt => opt.getJsonSchema()) };
			}
		}

		const resolveReference: ChunkParentCallback = function (name, child) {
			let res: ResolvedReference = {
				stackdepth: child.stackdepth + 1,
				resolve(v, old) {
					throw new Error("write not supported");
				}
			}
			if (name == "$opcode") { return res; }
			return buildReference(name, parent, res);
		}

		if (args.length == 1) { args = [null, args[0]]; }
		if (args.length != 2) { throw new Error("match chunks needs 2 arguments") }
		if (typeof args[1] != "object") { throw new Error("match chunk requires 2n+2 arguments"); }

		let opvalueparser = (args[0] ? buildParser(resolveReference, args[0], typedef) : null);
		let conditionstrings = Object.keys(args[1] as any);
		let optionvalues = Object.values(args[1] as any).map(q => buildParser(resolveReference, q, typedef))
		let conditionparser = conditionParser(resolveReference, conditionstrings);
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
				if (debugdata) {
					// debugdata.opcodes.push({ op: `footer`, index: oldscan, stacksize: state.stack.length + 1, external: { start: state.scan, len: 0 } });
					debugdata.opcodes.push({ op: `footer`, index: oldscan, stacksize: state.stack.length + 1, jump: { to: footstart } });
				}
				let res = subtype.read(state);
				if (debugdata) {
					debugdata.opcodes.push({ op: `footer`, index: state.scan, stacksize: state.stack.length + 1, jump: { to: oldscan } });
				}
				if (state.scan != state.endoffset) { console.log(`didn't read full footer, ${state.endoffset - state.scan} bytes left`); }
				state.scan = oldscan;
				state.endoffset = state.endoffset - len;

				return res;
			},
			write(state, v) {
				let oldscan = state.scan;
				subtype.write(state, v);
				let len = state.scan - oldscan;
				state.buffer.copyWithin(state.endoffset - len, oldscan, state.scan);
				state.scan = oldscan;
				state.endoffset -= len;
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
	},
	"legacy_maptile": function (args, parent, typedef) {
		return {
			read(state) {
				let res = {
					flags: 0,
					shape: null as number | null,
					overlay: null as number | null,
					settings: null as number | null,
					underlay: null as number | null,
					height: null as number | null
				}
				while (true) {
					let op = state.buffer.readUint8(state.scan++);
					if (op == 0) { break; }
					if (op == 1) {
						res.height = state.buffer.readUint8(state.scan++);
						break;
					}
					if (op >= 2 && op <= 49) {
						res.shape = op - 2;
						res.overlay = state.buffer.readUint8(state.scan);
						state.scan += 1;
					}
					if (op >= 50 && op <= 81) {
						res.settings = op - 49;
					}
					if (op >= 82) {
						res.underlay = op - 81;
					}
				}
				return res;
			},
			write(state) {
				throw new Error("not implemented");
			},
			getTypescriptType(indent) {
				let newindent = indent + "\t";
				return `{\n`
					+ `${newindent}flags: number,\n`
					+ `${newindent}shape: number | null,\n`
					+ `${newindent}overlay: number | null,\n`
					+ `${newindent}settings: number | null,\n`
					+ `${newindent}underlay: number | null,\n`
					+ `${newindent}height: number | null,\n`
					+ `${indent}}`;
			},
			getJsonSchema() {
				return { type: "any" };
			}
		}
	},
	scriptopt: function (args, parent, typedef) {
		return {
			read(state) {
				let cali = state.args.clientScriptDeob as ClientscriptObfuscation | undefined;
				//don't explicitly check prototype here as we would have to import the constructor
				if (!cali) {
					throw new Error("opcode callibration not set for clientscript with obfuscated opcodes");
				}
				if (debugdata) {
					debugdata.opcodes.push({ op: "opcode", index: state.scan, stacksize: state.stack.length + 1 });
				}
				let res = (cali as ClientscriptObfuscation).readOpcode(state);
				return res;
			},
			write(state, v) {
				let cali = state.args.clientScriptDeob as ClientscriptObfuscation | undefined;;
				if (!cali) {
					throw new Error("opcode callibration not set for clientscript with obfuscated opcodes");
				}
				cali.writeOpCode(state, v);
			},
			getJsonSchema() {
				return {
					type: "object",
					properties: {
						opcode: { type: "number" },
						imm: { type: "number" },
						imm_obj: { oneOf: [{ type: "number" }, { type: "string" }, { type: "null" }] }
					}
				}
			},
			getTypescriptType(indent) {
				let newindent = indent + "\t";
				return `{\n`
					+ `${newindent}opcode:number,\n`
					+ `${newindent}imm:number,\n`
					+ `${newindent}imm_obj:number|string|[number,number]|null,\n`
					+ `${indent}}`;
			}
		}
	}
}

function getClientVersion(args: Record<string, unknown>) {
	if (typeof args.clientVersion != "number") { throw new Error("client version not set"); }
	return args.clientVersion;
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
				//unsigned right shift to cast to uint32 again
				s.buffer.writeUint32BE((v | 0x80000000) >>> 0, s.scan);
				s.scan += 4;
			}
		},
		min: 0, max: 2 ** 31 - 1
	},
	varnullint: {
		read(s) {
			let firstWord = s.buffer.readUInt16BE(s.scan);
			s.scan += 2;
			if (firstWord == 0x7fff) {
				return -1;
			} else if ((firstWord & 0x8000) == 0) {
				return firstWord;
			} else {
				let secondWord = s.buffer.readUInt16BE(s.scan);
				s.scan += 2;
				return ((firstWord & 0x7fff) << 16) | secondWord;
			}
		},
		write(s, v) {
			if (v == -1) {
				s.buffer.writeUint16BE(0x7fff, s.scan);
				s.scan += 2;
			} else if (v < 0x8000) {
				s.buffer.writeUInt16BE(v, s.scan);
				s.scan += 2;
			} else {
				//unsigned right shift to cast to uint32 again
				s.buffer.writeUint32BE((v | 0x80000000) >>> 0, s.scan);
				s.scan += 4;
			}
		},
		min: -1, max: 2 ** 31 - 1
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
	accum: intAccumolatorParser,
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
