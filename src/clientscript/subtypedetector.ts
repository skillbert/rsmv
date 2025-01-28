import { ClientScriptFunction, CodeBlockNode, RawOpcodeNode, SubcallNode, generateAst } from "./ast";
import { ClientscriptObfuscation, ScriptCandidate } from "./callibrator";
import { ExactStack, PrimitiveType, StackConstants, StackDiff, branchInstructionsInt, branchInstructionsLong, debugKey, decomposeKey, dependencyGroup, dependencyIndex, dynamicOps, knownDependency, namedClientScriptOps, subtypes } from "./definitions";

//to test
//await cli("extract --mode clientscript -i 0");await deob.preloadData(false);deob.parseCandidateContents();detectSubTypes(deob);

const looseOps = [
    //TODO most of these have known types depending on literal args
    dependencyGroup("opin", namedClientScriptOps.enum_hasoutput) | dependencyIndex("int", 2),
    dependencyGroup("opout", namedClientScriptOps.enum_getreverseindex) | dependencyIndex("int", 0),
    dependencyGroup("opin", namedClientScriptOps.enum_getreverseindex) | dependencyIndex("int", 3),
    dependencyGroup("opin", namedClientScriptOps.enum_getreversecount) | dependencyIndex("int", 2),
    dependencyGroup("opin", namedClientScriptOps.enum_getstring) | dependencyIndex("int", 1),
    dependencyGroup("opin", namedClientScriptOps.popdiscardint) | dependencyIndex("int", 0),
    dependencyGroup("opout", namedClientScriptOps.lc_getparam) | dependencyIndex("int", 0),
    dependencyGroup("opin", namedClientScriptOps.cc_setparam) | dependencyIndex("int", 1),
    dependencyGroup("opin", namedClientScriptOps.db_find_with_count) | dependencyIndex("int", 1),

    dependencyGroup("opin", namedClientScriptOps.pop_array) | dependencyIndex("int", 1),
    dependencyGroup("opout", namedClientScriptOps.push_array) | dependencyIndex("int", 0),
    dependencyGroup("opin", namedClientScriptOps.switch) | dependencyIndex("int", 0),
    knownDependency(subtypes.unknown_int),
    knownDependency(subtypes.unknown_long),
    knownDependency(subtypes.unknown_string),
    ...branchInstructionsInt.flatMap(q => [dependencyGroup("opin", q) | dependencyIndex("int", 0), dependencyGroup("opin", q) | dependencyIndex("int", 1)]),
    ...branchInstructionsLong.flatMap(q => [dependencyGroup("opin", q) | dependencyIndex("long", 0), dependencyGroup("opin", q) | dependencyIndex("long", 1)]),
];

export class ClientScriptSubtypeSolver {
    map = new Map<number, Set<number>>();
    knowntypes = new Map<number, number>();
    uuidcounter = 1;

    constructor() {
        for (let subtype of Object.values(subtypes)) {
            let key = knownDependency(subtype);
            this.knowntypes.set(key, subtype);
        }
    }

    entangle(key: number, other: number | undefined) {
        if (other == undefined) { return; }
        if (key == other) { return; }
        if (looseOps.includes(key) || looseOps.includes(other)) { return; }
        if (Array.isArray(globalThis.testkey) && key == globalThis.testkey[0] && other == globalThis.testkey[1]) {
            debugger;
        }
        if (Array.isArray(globalThis.testkey) && key == globalThis.testkey[1] && other == globalThis.testkey[0]) {
            debugger;
        }
        if (typeof globalThis.testboth == "number" && (key == globalThis.testboth || other == globalThis.testboth)) {
            debugger;
        }
        if (key < 512 && other < 512) {
            // debugger;
            console.log(`unexpected exact type equation ${key} ${other}`);
        }
        let eqset = this.map.get(key);
        if (!eqset) {
            eqset = new Set();
            this.map.set(key, eqset);
        }
        eqset.add(other);
        let otherset = this.map.get(other);
        if (!otherset) {
            otherset = new Set();
            this.map.set(other, otherset);
        }
        otherset.add(key);
    }

    parseSections(sections: CodeBlockNode[]) {
        for (let section of sections) {
            //TODO the solver currently doesn't support subfunc scope
            if (section.subfuncid != -1) { continue; }
            let stack = new CombinedExactStack(this);
            for (let op of section.children) {
                if (op instanceof RawOpcodeNode) {
                    if (!stack.pushopcode(op, section.scriptid)) {
                        break;
                    }
                } else if (op instanceof ClientScriptFunction) {
                    break;
                } else if (op instanceof SubcallNode) {
                    break;
                } else {
                    throw new Error("unexpected");
                }
            }
        }
    }

    addKnownFromCalli(calli: ClientscriptObfuscation) {
        for (let key of this.map.keys()) {
            let [type, stacktype, group, index] = decomposeKey(key);
            let isin = type == "opin" || type == "scriptargvar";
            let isscript = type == "scriptargvar" || type == "scriptret";
            let isop = type == "opin" || type == "opout";
            if (isscript || isop) {
                let stackinout = (isscript ? calli.scriptargs.get(group)?.stack : calli.decodedMappings.get(group)?.stackinfo);
                if (stackinout) {
                    let stack = (isin ? stackinout.exactin : stackinout.exactout);
                    if (stack) {
                        let typedstack = stack[stacktype];
                        if (index < typedstack.length) {
                            this.knowntypes.set(key, typedstack[index]);
                        }
                    }
                }
            }
        }
    }

    solve() {
        let activekeys = new Set(this.knowntypes.keys());
        let itercount = 0;
        while (activekeys.size != 0) {
            // console.log(`iteration ${itercount++}, known: ${this.knowntypes.size}, active:${activekeys.size}`);
            let nextactivekeys = new Set<number>();
            for (let key of activekeys) {
                let links = this.map.get(key);
                if (links) {
                    let known = this.knowntypes.get(key)!;
                    for (let link of links) {
                        let prevknown = this.knowntypes.get(link);
                        if (typeof prevknown == "undefined") {
                            nextactivekeys.add(link);
                            this.knowntypes.set(link, known);
                        } else if (prevknown != known) {
                            globalThis.testkey = [key, link];
                            throw new Error(`conflicting types old:${Object.entries(subtypes).find(q => q[1] == prevknown)?.[0] ?? "??"}, new:${Object.entries(subtypes).find(q => q[1] == known)?.[0] ?? "??"}\n${key} - ${debugKey(key)}\n${link} - ${debugKey(link)}`);
                        }
                    }
                }
            }
            activekeys = nextactivekeys;
        }
    }
}

function getScriptLocalDep(env: number, type: PrimitiveType, index: number) {
    return env;
}
function getPositionalDep(env: number, type: PrimitiveType, index: number) {
    return env | dependencyIndex(type, index);
}

class CombinedExactStack {
    intstack: number[] = [];
    longstack: number[] = [];
    stringstack: number[] = [];
    consts = new StackConstants();
    ctx: ClientScriptSubtypeSolver;
    constructor(ctx: ClientScriptSubtypeSolver) {
        this.ctx = ctx;
    }
    pushopcode(node: RawOpcodeNode, scriptid: number) {
        if (Array.isArray(globalThis.test) && globalThis.test[0] == scriptid && globalThis.test[1] == node.originalindex) {
            debugger;
        }
        let stackinout = node.knownStackDiff ?? node.opinfo.stackinfo;
        if (!stackinout.initializedthrough) { return false; }
        if (!node.knownStackDiff && dynamicOps.includes(node.op.opcode)) { return false; }

        let depenvin = 0;
        let depenvout = 0;
        let depfunc: typeof getScriptLocalDep;

        let islocalint = node.opinfo.id == namedClientScriptOps.poplocalint || node.opinfo.id == namedClientScriptOps.pushlocalint;
        let islocallong = node.opinfo.id == namedClientScriptOps.poplocallong || node.opinfo.id == namedClientScriptOps.pushlocallong;
        let islocalstring = node.opinfo.id == namedClientScriptOps.poplocalstring || node.opinfo.id == namedClientScriptOps.pushlocalstring;
        if (islocalint || islocallong || islocalstring) {
            const typestr = (islocalint ? "int" : islocallong ? "long" : "string");
            depenvin = dependencyGroup("scriptargvar", scriptid) | dependencyIndex(typestr, node.op.imm);
            depenvout = depenvin;
            depfunc = getScriptLocalDep;
        } else if (node.opinfo.id == namedClientScriptOps.gosub) {
            depenvin = dependencyGroup("scriptargvar", node.op.imm);
            depenvout = dependencyGroup("scriptret", node.op.imm);
            depfunc = getPositionalDep;
        } else if (node.opinfo.id == namedClientScriptOps.return) {
            depenvin = dependencyGroup("scriptret", scriptid);
            depenvout = depenvin//doesn't happen
            depfunc = getPositionalDep;
        } else {
            depenvin = dependencyGroup("opin", node.op.opcode);
            depenvout = dependencyGroup("opout", node.op.opcode)
            depfunc = getPositionalDep;
        }

        if (node.knownStackDiff?.exactin) {
            let exact = node.knownStackDiff.exactin;
            for (let i = exact.int.length - 1; i >= 0; i--) { this.ctx.entangle(knownDependency(exact.int[i]), this.intstack.pop()); }
            for (let i = exact.long.length - 1; i >= 0; i--) { this.ctx.entangle(knownDependency(exact.long[i]), this.longstack.pop()); }
            for (let i = exact.string.length - 1; i >= 0; i--) { this.ctx.entangle(knownDependency(exact.string[i]), this.stringstack.pop()); }
        } else {
            let stackin = stackinout.in;
            //need to do inputs in correct order because of vararg
            let stackcounts = stackin.getStackdiff();
            for (let i = stackin.values.length - 1; i >= 0; i--) {
                let value = stackin.values[i];
                if (value instanceof StackDiff) {
                    for (let i = value.int - 1; i >= 0; i--) { this.ctx.entangle(depfunc(depenvin, "int", --stackcounts.int), this.intstack.pop()) }
                    for (let i = value.long - 1; i >= 0; i--) { this.ctx.entangle(depfunc(depenvin, "long", --stackcounts.long), this.longstack.pop()) }
                    for (let i = value.string - 1; i >= 0; i--) { this.ctx.entangle(depfunc(depenvin, "string", --stackcounts.string), this.stringstack.pop()) }
                }
                else if (value == "int") { this.ctx.entangle(depfunc(depenvin, "int", --stackcounts.int), this.intstack.pop()); }
                else if (value == "long") { this.ctx.entangle(depfunc(depenvin, "long", --stackcounts.long), this.longstack.pop()); }
                else if (value == "string") { this.ctx.entangle(depfunc(depenvin, "string", --stackcounts.string), this.stringstack.pop()); }
                else if (value == "vararg") {
                    return false;//TODO implement
                    //todo there might actually be a "vararg" on stack at this point because of generateAst
                    // let varargs = varArgtype(this.consts.pop(), this.consts.values.at(-1));
                    // if (!varargs) { throw new Error("vararg string expected on constant stack"); }
                    // this.consts.popList(varargs);
                } else {
                    throw new Error("unexpected");
                }
            }
        }

        if (node.knownStackDiff?.exactout) {
            let exact = node.knownStackDiff.exactout;
            for (let i = 0; i < exact.int.length; i++) { this.intstack.push(knownDependency(exact.int[i])); }
            for (let i = 0; i < exact.long.length; i++) { this.longstack.push(knownDependency(exact.long[i])); }
            for (let i = 0; i < exact.string.length; i++) { this.stringstack.push(knownDependency(exact.string[i])); }
        } else {
            //only ensure order per primitive type
            let totalout = stackinout.out.getStackdiff();
            if (totalout.vararg != 0) { return false; }//TODO implement
            if (!totalout.isNonNegative() || totalout.vararg != 0) { throw new Error("unexpected"); }
            for (let i = 0; i < totalout.int; i++) { this.intstack.push(depfunc(depenvout, "int", i)); }
            for (let i = 0; i < totalout.long; i++) { this.longstack.push(depfunc(depenvout, "long", i)); }
            for (let i = 0; i < totalout.string; i++) { this.stringstack.push(depfunc(depenvout, "string", i)); }
        }
        return true;
    }
}

export function detectSubtypes(calli: ClientscriptObfuscation, candidates: Map<number, ScriptCandidate>) {
    let ctx = new ClientScriptSubtypeSolver();
    for (let cand of candidates.values()) {
        if (!cand.scriptcontents) { continue; }
        let { sections } = generateAst(calli, cand.script, cand.scriptcontents.opcodedata, cand.id);
        ctx.parseSections(sections);
    }
    ctx.solve();
    assignKnownTypes(calli, ctx.knowntypes);
    calli.foundSubtypes = true;
}
export function assignKnownTypes(calli: ClientscriptObfuscation, knowntypes: Map<number, number>) {
    for (let op of calli.mappings.values()) {
        if (!op.stackinfo.initializedthrough) { continue; }
        let exactin = new ExactStack();
        let diffin = op.stackinfo.in.getStackdiff();
        for (let i = 0; i < diffin.int; i++) { exactin.int.push(knowntypes.get(dependencyGroup("opin", op.id) | dependencyIndex("int", i)) ?? subtypes.unknown_int); }
        for (let i = 0; i < diffin.long; i++) { exactin.long.push(knowntypes.get(dependencyGroup("opin", op.id) | dependencyIndex("long", i)) ?? subtypes.unknown_long); }
        for (let i = 0; i < diffin.string; i++) { exactin.string.push(knowntypes.get(dependencyGroup("opin", op.id) | dependencyIndex("string", i)) ?? subtypes.unknown_string); }
        op.stackinfo.exactin = exactin;

        let exactout = new ExactStack();
        let diffout = op.stackinfo.out.getStackdiff();
        for (let i = 0; i < diffout.int; i++) { exactout.int.push(knowntypes.get(dependencyGroup("opout", op.id) | dependencyIndex("int", i)) ?? subtypes.unknown_int); }
        for (let i = 0; i < diffout.long; i++) { exactout.long.push(knowntypes.get(dependencyGroup("opout", op.id) | dependencyIndex("long", i)) ?? subtypes.unknown_long); }
        for (let i = 0; i < diffout.string; i++) { exactout.string.push(knowntypes.get(dependencyGroup("opout", op.id) | dependencyIndex("string", i)) ?? subtypes.unknown_string); }
        op.stackinfo.exactout = exactout;
    }
    for (let [id, func] of calli.scriptargs) {
        let exactin = new ExactStack();
        let diffin = func.stack.in.getStackdiff();
        for (let i = 0; i < diffin.int; i++) { exactin.int.push(knowntypes.get(dependencyGroup("scriptargvar", id) | dependencyIndex("int", i)) ?? subtypes.unknown_int); }
        for (let i = 0; i < diffin.long; i++) { exactin.long.push(knowntypes.get(dependencyGroup("scriptargvar", id) | dependencyIndex("long", i)) ?? subtypes.unknown_long); }
        for (let i = 0; i < diffin.string; i++) { exactin.string.push(knowntypes.get(dependencyGroup("scriptargvar", id) | dependencyIndex("string", i)) ?? subtypes.unknown_string); }
        func.stack.exactin = exactin;

        let exactout = new ExactStack();
        let diffout = func.stack.out.getStackdiff();
        for (let i = 0; i < diffout.int; i++) { exactout.int.push(knowntypes.get(dependencyGroup("scriptret", id) | dependencyIndex("int", i)) ?? subtypes.unknown_int); }
        for (let i = 0; i < diffout.long; i++) { exactout.long.push(knowntypes.get(dependencyGroup("scriptret", id) | dependencyIndex("long", i)) ?? subtypes.unknown_long); }
        for (let i = 0; i < diffout.string; i++) { exactout.string.push(knowntypes.get(dependencyGroup("scriptret", id) | dependencyIndex("string", i)) ?? subtypes.unknown_string); }
        func.stack.exactout = exactout;
    }
    return knowntypes;
}
