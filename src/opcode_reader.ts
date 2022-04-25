
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

type CompareMode = "eq" | "eqnot" | "bitflag" | "bitflagnot" | "bitor" | "bitand";

export type Primitive<T> = PrimitiveInt | PrimitiveFloat | PrimitiveBool | PrimitiveString | PrimitiveHardcode | PrimitiveValue<T>;
export type ChunkType<T> = Primitive<T> | string;

export type ComposedChunk = string
	| [type: "array", props: ComposedChunk]
	| [type: "chunkedarray", length: ComposedChunk | number, ...chunks: [name: string, value: any][]]
	| [type: "array", length: ComposedChunk | number, valueType: ComposedChunk]
	| ["buffer", ComposedChunk | number, keyof typeof BufferTypes, number]
	| [type: "nullarray", optcodeType: ComposedChunk, valueType: ComposedChunk]
	| [type: "bytesleft"]
	| [type: "ref", ref: string, bitrange?: [number, number], offset?: number]
	| [type: "accum", ref: string, addvalue: ComposedChunk, mode?: "add" | "add-1" | "hold"]
	| [type: "opt", condition: (number | string | [ref: string, value: string | number, compare: CompareMode]), value: ComposedChunk]
	| { $opcode: string } & Record<string, { name: string, read: ComposedChunk }>
	| [type: "struct", ...props: [name: string, value: any]]
//dont add tupple here since it messes up all typings as it has overlap with the first string prop


type TypeDef = { [name: string]: ChunkType<any> | ComposedChunk };

type ChunkParserParent = ChunkParser | null;

const BufferTypes = {
	hex: { constr: Uint8Array },//used to debug into json file
	byte: { constr: Int8Array },
	ubyte: { constr: Uint8Array },
	short: { constr: Int16Array },
	ushort: { constr: Uint16Array },
	int: { constr: Int32Array },
	uint: { constr: Uint32Array },
};

var debugdata: null | { structstack: object[], opcodes: { op: number | string, index: number }[] } = null;
export function getDebug(trigger: boolean) {
	let ret = debugdata;
	debugdata = trigger ? { structstack: [], opcodes: [] } : null;
	return ret;
}

type DecodeState = {
	stack: object[],
	hiddenstack: object[],
	scan: number,
	endoffset: number,
	startoffset: number,
	buffer: Buffer
}

type EncodeState = {
	scan: number
	buffer: Buffer
}

type ResolvedReference = {
	stackdepth: number,
	owner: ChunkParser,
	resolve(v: unknown, oldvalue: number): number
}

export type ChunkParser<T = any> = {
	read(state: DecodeState): T,
	write(state: EncodeState, v: unknown): void,
	setReferenceParent?(parent: ChunkParserContainer | null): void,
	getTypescriptType(indent: string): string,
	getJsonSchema(): jsonschema.JSONSchema6Definition,
	condName?: string,
	condValue?: number,
	condMode?: CompareMode
}
type ChunkParserContainer<T = any> = ChunkParser<T> & {
	resolveReference(name: string, childresolve: ResolvedReference): ResolvedReference,
	setReferenceParent(parent: ChunkParserContainer | null): void,
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

export function buildParser(chunkdef: ComposedChunk, typedef: TypeDef): ChunkParser {
	switch (typeof chunkdef) {
		case "string":
			return resolveAlias(chunkdef, typedef);
		case "object":
			if (!Array.isArray(chunkdef)) {
				let mappedobj: Record<string, ChunkParser> = {};
				for (let key in chunkdef) {
					if (key.startsWith("$")) { continue; }//TODO remove?
					let op = chunkdef[key];
					mappedobj[op.name] = optParser(buildParser(op.read, typedef), "$opcode", parseInt(key), "eq");
				}
				return opcodesParser(buildParser(chunkdef.$opcode ?? "unsigned byte", typedef), mappedobj);
			} else {
				if (chunkdef.length < 1) throw new Error(`'read' variables must either be a valid type-defining string, an array of type-defining strings / objects, or a valid type-defining object: ${JSON.stringify(chunkdef)}`);
				switch (chunkdef[0]) {
					case "ref": {
						if (chunkdef.length < 2) throw new Error(`2 arguments exptected for proprety with type ref`);
						let [minbit, bitlength] = chunkdef[2] ?? [-1, -1];
						let offset = chunkdef[3] ?? 0;
						return referenceValueParser(chunkdef[1], minbit, bitlength, offset);
					}
					case "accum": {
						if (chunkdef.length < 3) throw new Error(`3 arguments exptected for proprety with type accum`);
						return intAccumlatorParser(chunkdef[1], buildParser(chunkdef[2], typedef), chunkdef[3] ?? "add");
					}
					case "opt": {
						if (chunkdef.length < 3) throw new Error(`3 arguments exptected for proprety with type opt`);
						let cond: string;
						let valuearg = chunkdef[1];
						let cmpmode: CompareMode = "eq";
						if (Array.isArray(valuearg)) {
							cond = valuearg[0];
							cmpmode = valuearg[2] ?? "eq";
							valuearg = valuearg[1];
						} else {
							cond = "$opcode";
							valuearg = chunkdef[1] as number | string;
						}
						if (typeof valuearg == "string") { valuearg = parseInt(valuearg) }
						return optParser(buildParser(chunkdef[2], typedef), cond, valuearg, cmpmode);
					}
					case "chunkedarray": {
						if (chunkdef.length < 2) throw new Error(`'read' variables interpretted as an array must contain items: ${JSON.stringify(chunkdef)}`);
						let sizearg = (chunkdef.length >= 3 ? chunkdef[1] : "variable unsigned short");
						let rawchunks = chunkdef.slice(chunkdef.length >= 3 ? 2 : 1) as [name: string, value: ComposedChunk][][];
						let lentype = (typeof sizearg == "number" ? literalValueParser({ primitive: "value", value: sizearg }) : buildParser(sizearg, typedef))
						return chunkedArrayParser(lentype, rawchunks.map(chunk => Object.fromEntries(chunk.map(q => [q[0], buildParser(q[1], typedef)]))));
					}
					case "bytesleft":
						return bytesRemainingParser();
					case "buffer":
						if (chunkdef.length < 3) throw new Error(`'read' variables interpretted as an array must contain items: ${JSON.stringify(chunkdef)}`);
						let sizearg = chunkdef[1];
						let sizetype = (typeof sizearg == "number" ? literalValueParser({ primitive: "value", value: sizearg }) : buildParser(sizearg, typedef))
						return bufferParser(sizetype, chunkdef[2], chunkdef[3] ?? 1);
					case "nullarray":
					case "array": {
						if (chunkdef.length < 2) throw new Error(`'read' variables interpretted as an array must contain items: ${JSON.stringify(chunkdef)}`);
						let sizearg = (chunkdef.length >= 3 ? chunkdef[1] : "variable unsigned short");
						let sizetype = (typeof sizearg == "number" ? literalValueParser({ primitive: "value", value: sizearg }) : buildParser(sizearg, typedef));
						let valuetype = buildParser(chunkdef[chunkdef.length >= 3 ? 2 : 1] as ComposedChunk, typedef);
						if (chunkdef[0] == "array") {
							return arrayParser(sizetype, valuetype);
						} else {
							return arrayNullTerminatedParser(sizetype, valuetype);
						}
					}
					case "struct": {
						if (chunkdef.length < 2) throw new Error(`'read' variables interpretted as a struct must contain items: ${JSON.stringify(chunkdef)}`);
						let props = {};
						for (let prop of chunkdef.slice(1) as [string, ComposedChunk][]) {
							props[prop[0]] = buildParser(prop[1], typedef);
						}
						return structParser(props);
					}
					// Tuple
					default: {
						//@ts-ignore
						if (chunkdef.length < 2) throw new Error(`'read' variables interpretted as a struct must contain items: ${JSON.stringify(chunkdef)}`);
						let props: ChunkParser[] = [];
						for (let prop of chunkdef as ComposedChunk[]) {
							props.push(buildParser(prop, typedef));
						}
						return tuppleParser(props);
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

function opcodesParser<T extends Record<string, any>>(opcodetype: ChunkParser<number>, opts: { [key in keyof T]: ChunkParser<T[key]> }): ChunkParser<Partial<T>> {
	let map = new Map<number, { key: keyof T, parser: ChunkParser }>();
	let refs: Record<string, ResolvedReference[] | undefined> = {};
	for (let key in opts) {
		let opt = opts[key];
		if (opt.condName != "$opcode" || typeof opt.condValue != "number" || opt.condMode != "eq") { throw new Error("option in opcode set that is not conditional on '$opcode'"); }
		map.set(opt.condValue, { key: key, parser: opt });
	}
	let hasexplicitnull = !!map.get(0);
	let refparent: ChunkParserContainer | null = null;

	let r: ChunkParserContainer<Partial<T>> = {
		read(state) {
			let r: Partial<T> = {};
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
				if (debugdata) {
					debugdata.opcodes.push({ op: opt, index: state.scan - 1 });
				}
				let parser = map.get(opt);
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
				let parser = opts[key];
				if (!parser) { throw new Error("unknown property " + key); }
				opcodetype.write(state, parser.condValue);
				parser.write(state, value[key]);
			}
			if (hasexplicitnull) {
				opcodetype.write(state, 0);
			}
		},
		setReferenceParent(parent) {
			refparent = parent;
			opcodetype.setReferenceParent?.(r);
			(Object.values(opts) as ChunkParser[]).forEach(q => q.setReferenceParent?.(r));
		},
		resolveReference(name, childresolve) {
			let targetprop = Object.entries(opts).find(([name, parser]) => parser == childresolve.owner)?.[0];
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
			if (name == "$opcode" || Object.prototype.hasOwnProperty.call(opts, name)) {
				refs[name] ??= [];
				refs[name]!.push(result);
				return result;
			} else {
				return buildReference(name, refparent, result);
			}
		},
		getTypescriptType(indent) {
			let r = "{\n";
			let newindent = indent + "\t";
			for (let val of map.values()) {
				r += newindent + (val.key as string) + "?: " + val.parser.getTypescriptType(newindent) + "\n";
			}
			r += indent + "}";
			return r;
		},
		getJsonSchema() {
			return {
				type: "object",
				properties: Object.fromEntries([...map.values()].map((prop) => {
					return [prop.key, prop.parser.getJsonSchema()];
				}))
			}
		}
	}

	return r;
}

function tuppleParser(props: ChunkParser[]) {
	let refparent: ChunkParserContainer | null = null;
	let r: ChunkParserContainer<any[]> = {
		read(state) {
			let r: any[] = [];
			for (let prop of props) {
				let v = prop.read(state);
				r.push(v);
			}
			return r;
		},
		write(buffer, value) {
			if (!Array.isArray(value)) { throw new Error("array expected"); }
			for (let [i, prop] of props.entries()) {
				prop.write(buffer, value[i]);
			}
		},
		setReferenceParent(parent) {
			refparent = parent;
			props.forEach(q => q.setReferenceParent?.(r));
		},
		resolveReference(name, child) {
			let index = props.indexOf(child.owner);
			if (index == -1) { throw new Error("tuple child prop not found"); }
			return buildReference(name, refparent, {
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
	return r;
}

function buildReference(name: string, container: ChunkParserContainer | null, startingpoint: ResolvedReference) {
	if (!container) { throw new Error("reference " + name + " could not be resolved"); }
	return container.resolveReference(name, startingpoint);
}

function refgetter(owner: ChunkParser, refparent: ChunkParserContainer | null, propname: string, resolve: (v: unknown, old: number) => number) {
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

function structParser<T extends Record<string, any>>(props: { [key in keyof T]: ChunkParser<T[key]> }): ChunkParser<T> {
	let keys = Object.keys(props);
	let refs: Record<string, ResolvedReference[] | undefined> = {};
	let refparent: ChunkParserContainer | null = null;
	let r: ChunkParserContainer<T> = {
		read(state) {
			let r = {} as T;
			let hidden = {};
			state.stack.push(r);
			state.hiddenstack.push(hidden);
			for (let key of keys) {
				if (debugdata) { debugdata.opcodes.push({ op: key, index: state.scan }); }
				let v = props[key].read(state);
				if (v !== undefined) {
					if (key[0] == "$") {
						hidden[key] = v;
					} else {
						r[key as keyof T] = v;
					}
				}
			}
			state.stack.pop();
			state.hiddenstack.pop();
			return r;
		},
		write(buffer, value) {
			if (typeof value != "object" || !value) { throw new Error("object expected"); }
			for (let key of keys) {
				let propvalue = value[key as string];
				let refarray = refs[key];
				if (refarray) {
					propvalue = propvalue ?? 0;
					for (let ref of refarray) {
						//TODO
					}
				}
				let prop = props[key];
				prop.write(buffer, propvalue);
			}
		},
		setReferenceParent(parent) {
			refparent = parent;
			(Object.values(props) as ChunkParser[]).forEach(q => q.setReferenceParent?.(r));
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
				return buildReference(name, refparent, result);
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
				required: keys
			}
		}
	}
	return r;
}

function optParser<T>(type: ChunkParser<T>, condvar: string, condvalue: number, compare: CompareMode): ChunkParser<T | null> {
	let refparent: ChunkParserContainer | null = null;
	let ref: ReturnType<typeof refgetter>;
	let r: ChunkParserContainer<T | null> = {
		read(state) {
			let value = ref.read(state);
			if (!checkCondition(r, value)) {
				return null;
			}
			return type.read(state);
		},
		write(buffer, value) {
			if (value != null) {
				return type.write(buffer, value);
			}
		},
		setReferenceParent(parent) {
			refparent = parent;
			type.setReferenceParent?.(r);

			ref = refgetter(r, parent, condvar, (v: unknown, oldvalue: number) => {
				return forceCondition(r, oldvalue, v != null);
			});
		},
		resolveReference(name, child) {
			return buildReference(name, refparent, {
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
		},
		condName: condvar,
		condValue: condvalue,
		condMode: compare,
	};
	return r;
}

function forceCondition(parser: ChunkParser, oldvalue: number, state: boolean) {
	switch (parser.condMode!) {
		case "eq":
			return state ? parser.condValue! : oldvalue;
		case "eqnot":
			return state ? oldvalue : parser.condValue!;
		case "bitflag":
			return (state ? oldvalue | (1 << parser.condValue!) : oldvalue & ~(1 << parser.condValue!));
		case "bitor":
			return (state ? oldvalue | parser.condValue! : oldvalue & ~parser.condValue!);
		case "bitand":
			return (state ? oldvalue | parser.condValue! : oldvalue & ~parser.condValue!);
		case "bitflagnot":
			return (state ? oldvalue & ~(1 << parser.condValue!) : oldvalue | (1 << parser.condValue!));
		default:
			throw new Error("unknown condition " + parser.condMode);
	}
}

function checkCondition(parser: ChunkParser, v: number) {
	switch (parser.condMode!) {
		case "eq":
			return v == parser.condValue!;
		case "eqnot":
			return v != parser.condValue!;
		case "bitflag":
			return (v & (1 << parser.condValue!)) != 0;
		case "bitor":
			return (v & parser.condValue!) != 0;
		case "bitand":
			return (v & parser.condValue!) == parser.condValue!;
		case "bitflagnot":
			return (v & (1 << parser.condValue!)) == 0;
		default:
			throw new Error("unkown condition " + parser.condMode);
	}
}

function chunkedArrayParser<T extends object>(lengthtype: ChunkParser<number>, chunktypes: Record<string, ChunkParser>[]): ChunkParser<T[]> {
	let keys = Object.keys(chunktypes.flatMap(Object.keys));
	let fullobj: Record<string, ChunkParser> = Object.assign({}, ...chunktypes);
	let refs: Record<string, ResolvedReference[] | undefined> = {};
	let refparent: ChunkParserContainer | null = null;

	let r: ChunkParserContainer<T[]> = {
		read(state) {
			let len = lengthtype.read(state);
			let r: object[] = [];
			let hiddenprops: object[] = [];
			for (let chunkindex = 0; chunkindex < chunktypes.length; chunkindex++) {
				let proptype = chunktypes[chunkindex];
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
					//TODO check if we can save speed by manually overwriting state[length-1] instead of pop->push
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
			return r as T[];
		},
		write(buf, v) {
			throw new Error("not implemented");
		},
		setReferenceParent(parent) {
			refparent = parent;
			lengthtype.setReferenceParent?.(r);
			chunktypes.forEach(q => Object.values(q).forEach(q => q.setReferenceParent?.(r)));
		},
		resolveReference(name, childresolve) {
			if (childresolve.owner == lengthtype) {
				return buildReference(name, refparent, {
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
				return buildReference(name, refparent, result);
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
					required: keys
				}
			};
		}
	};

	return r;
}

function bufferParser(lengthtype: ChunkParser<number>, scalartype: keyof typeof BufferTypes, vectorLength: number): ChunkParser<ArrayLike<number>> {
	const type = BufferTypes[scalartype];
	let refparent: ChunkParserContainer | null = null;
	let r: ChunkParserContainer<ArrayLike<number>> = {
		read(state) {
			let len = lengthtype.read(state);
			let bytelen = len * vectorLength * type.constr.BYTES_PER_ELEMENT;
			let backing = new ArrayBuffer(bytelen);
			let bytes = Buffer.from(backing);
			bytes.set(state.buffer.subarray(state.scan, state.scan + bytelen));
			state.scan += bytelen;
			let array = new type.constr(backing);
			if (scalartype == "hex") { (array as any).toJSON = () => bytes.toString("hex"); }
			else { (array as any).toJSON = () => `buffer ${scalartype}${vectorLength != 1 ? `[${vectorLength}]` : ""}[${len}]`; }
			return array;
		},
		write(state, value) {
			if (!(value instanceof type.constr)) { throw new Error("arraybuffer expected"); }
			if (value.length % vectorLength != 0) { throw new Error("araybuffer is not integer multiple of vectorlength"); }
			lengthtype.write(state, value.length / vectorLength);

			let bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
			state.buffer.set(bytes, state.scan);
			state.scan += bytes.byteLength;
		},
		setReferenceParent(parent) {
			refparent = parent;
			lengthtype.setReferenceParent?.(r);
		},
		resolveReference(name, child) {
			return buildReference(name, refparent, {
				owner: r,
				stackdepth: child.stackdepth,
				resolve: child.resolve
			});
		},
		getTypescriptType(indent) {
			return type.constr.name;
		},
		getJsonSchema() {
			return { type: "string" };
		}
	};
	return r;
}

function arrayParser<T>(lengthtype: ChunkParser<number>, subtype: ChunkParser<T>): ChunkParser<T[]> {
	let refparent: ChunkParserContainer | null = null;
	let r: ChunkParserContainer<T[]> = {
		read(state) {
			let len = lengthtype.read(state);
			let r: T[] = [];
			for (let i = 0; i < len; i++) {
				r.push(subtype.read(state));
			}
			return r;
		},
		write(buffer, value) {
			if (!Array.isArray(value)) { throw new Error("array expected"); }
			lengthtype.write(buffer, value.length);
			for (let i = 0; i < value.length; i++) {
				subtype.write(buffer, value[i]);
			}
		},
		setReferenceParent(parent) {
			refparent = parent;
			lengthtype.setReferenceParent?.(r);
			subtype.setReferenceParent?.(r);
		},
		resolveReference(name, child) {
			return buildReference(name, refparent, {
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
			})
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

	return r;
}

function arrayNullTerminatedParser<T>(lengthtype: ChunkParser<number>, proptype: ChunkParser<T>): ChunkParser<T[]> {
	let refparent: ChunkParserContainer | null = null;
	let r: ChunkParserContainer<T[]> = {
		read(state) {
			let r: T[] = [];
			let ctx = { $opcode: 0 };
			state.hiddenstack.push(ctx);
			state.stack.push({});
			while (true) {
				let header = lengthtype.read(state);
				if (header == 0) { break; }
				ctx.$opcode = header;
				r.push(proptype.read(state));
			}
			state.hiddenstack.pop();
			state.stack.pop();
			return r;
		},
		write(buffer, value) {
			if (!Array.isArray(value)) { throw new Error("array expected"); }
			//TODO probably very wrong
			for (let prop of value) {
				lengthtype.write(buffer, 1);
				proptype.write(buffer, prop);
			}
			lengthtype.write(buffer, 0);
		},
		setReferenceParent(parent) {
			refparent = parent;
			lengthtype.setReferenceParent?.(r);
			proptype.setReferenceParent?.(r);
		},
		resolveReference(name, child) {
			if (name == "$opcode") {
				return {
					owner: r,
					stackdepth: child.stackdepth + 1,
					resolve(v, old) { throw new Error("not implemented") }
				}
			}
			return buildReference(name, refparent, {
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
			return `${proptype.getTypescriptType(indent)}[]`;
		},
		getJsonSchema() {
			return {
				type: "array",
				items: proptype.getJsonSchema()
			};
		}
	};
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
		write(buffer, value) {
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
				buffer[`write${unsigned && bytes != 4 ? "U" : ""}IntBE`](int, buffer.scan, bytes);
				buffer.scan += bytes;
			} else if (readmode == "sumtail") {
				throw new Error("not implemented");
			} else {
				output = buffer[`write${unsigned ? "U" : ""}Int${endianness.charAt(0).toUpperCase()}E`](value, buffer.scan, bytes);
				buffer.scan += bytes;
			}
		},
		getTypescriptType() {
			return "number";
		},
		getJsonSchema() {
			return {
				type: "integer",
				maximum: 2 ** (primitive.bytes * 8 + (primitive.unsigned ? 0 : -1)) - 1,
				minimum: (primitive.unsigned ? 0 : -1 * (2 ** (primitive.bytes * 8)))
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
			} else {
				return typeof primitive.value;
			}
		},
		getJsonSchema() { return { type: typeof primitive.value as any } }
	}
}
function referenceValueParser(propname: string, minbit: number, bitlength: number, offset: number): ChunkParser<number> {
	let ref: ReturnType<typeof refgetter>;
	let r: ChunkParser<number> = {
		read(state) {
			let value = ref.read(state);
			if (minbit != -1) {
				value = (value >> minbit) & ~((~0) << bitlength);
			}
			return value + offset;
		},
		write(buffer, value) {
			//noop, the referenced value does the writing and will get its value from this prop through refgetter
		},
		setReferenceParent(parent) {
			ref = refgetter(r, parent, propname, (v) => {
				if (typeof v != "number") { throw new Error("number expected"); }
				return v;
			});
		},
		getTypescriptType() {
			return "number";
		},
		getJsonSchema() {
			return {
				type: "integer",
				minimum: (bitlength == -1 ? undefined : 0),
				maximum: (bitlength == -1 ? undefined : 2 ** (bitlength * 8) - 1)
			}
		}
	}
	return r;
}
function bytesRemainingParser(): ChunkParser<number> {
	return {
		read(state) {
			return state.endoffset - state.scan;
		},
		write(buffer, value) {
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

function intAccumlatorParser(refname: string, value: ChunkParser<number | undefined>, mode: "add" | "add-1" | "hold"): ChunkParser<number> {
	let ref: ReturnType<typeof refgetter>;
	let refparent: ChunkParserContainer | null = null;
	let r: ChunkParserContainer<number> = {
		read(state) {
			//TODO fix the context situation
			let increment = value.read(state);
			let newvalue: number;
			let refvalue = ref.read(state);
			if (mode == "add" || mode == "add-1") {
				newvalue = refvalue + (increment ?? 0) + (mode == "add-1" ? -1 : 0);
			} else if (mode == "hold") {
				newvalue = increment ?? refvalue ?? 0;
			} else {
				throw new Error("unknown accumolator mode");
			}
			ref.write(state, newvalue);
			return newvalue;
		},
		setReferenceParent(parent) {
			ref = refgetter(r, parent, refname, (v, old) => {
				throw new Error("write for accumolator not implemented");
			});
			refparent = parent;
			value.setReferenceParent?.(r);
		},
		resolveReference(name, child) {
			return buildReference(name, refparent, { owner: r, stackdepth: child.stackdepth, resolve: child.resolve });
		},
		write(buffer, value) {
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


let hardcodes: Record<string, () => ChunkParser> = {
	playeritem: function () {
		return {
			read(state) {
				let byte0 = state.buffer.readUInt8(state.scan++);
				if (byte0 == 0) { return 0; }
				let byte1 = state.buffer.readUInt8(state.scan++);
				if (byte1 == 0xff && byte0 == 0xff) { return -1; }
				return (byte0 << 8) | byte1;
			},
			write(state, value) { throw new Error("not implemented"); },
			getTypescriptType() { return "number"; },
			getJsonSchema() { return { type: "integer", minimum: -1, maximum: 0xffff - 0x4000 - 1 }; }
		}
	}
}


function primitiveParser(primitive: Primitive<any>): ChunkParser {
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
			return parser();
		default:
			//@ts-ignore
			throw new Error(`Unsupported primitive '${primitive.primitive}' in typedef.json`);
	}
}
