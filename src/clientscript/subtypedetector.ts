import { CodeBlockNode, RawOpcodeNode, VarAssignNode, generateAst, getNodeStackIn, getNodeStackOut, parseClientScriptIm, translateAst, varArgtype } from "./ast";
import { ClientscriptObfuscation } from "./callibrator";
import { ExactStack, StackConstants, StackDiff, StackInOut, StackList, StackType, branchInstructionsInt, branchInstructionsLong, dynamicOps, getParamOps, knownClientScriptOpNames, namedClientScriptOps, subtypes, typeToPrimitive } from "./definitions";

//to test
//await cli("extract --mode clientscripttext -i 0");await deob.preloadData(false);deob.parseCandidateContents();detectSubTypes(deob);


type PrimitiveType = "int" | "long" | "string";
type DependentType = "scriptargvar" | "scriptret" | "opin" | "opout" | "known";

function primitiveToId(prim: PrimitiveType) {
    //2 bits
    return (prim == "int" ? 0 : prim == "long" ? 1 : 2);
}
function dependentToId(dep: DependentType) {
    //3 bits
    return (dep == "known" ? 0 : dep == "opin" ? 1 : dep == "opout" ? 2 : dep == "scriptargvar" ? 3 : 4);
}
function dependencyGroup(deptype: DependentType, id: number) {
    return (dependentToId(deptype) << 27) | (id << 11);
}
function dependencyIndex(subtype: PrimitiveType, index: number) {
    return (primitiveToId(subtype) << 9) | index;
}
function knownDependency(fulltype: number) {
    return (primitiveToId(typeToPrimitive(fulltype)) << 9) | fulltype;
}

const looseOps = [
    //TODO build these from conststants using debugKey(int)
    156174337,
    156473346,
    156289027,
    156465154,
    155981824,
    156069889,
    291825664,
    290506752,
    156178433,

    dependencyGroup("opin", namedClientScriptOps.pop_array) | dependencyIndex("int", 1),
    dependencyGroup("opout", namedClientScriptOps.push_array) | dependencyIndex("int", 0),
    dependencyGroup("opin", namedClientScriptOps.switch) | dependencyIndex("int", 0),
    knownDependency(subtypes.loose_int),
    knownDependency(subtypes.loose_long),
    knownDependency(subtypes.loose_string),
    ...branchInstructionsInt.flatMap(q => [dependencyGroup("opin", q) | dependencyIndex("int", 0), dependencyGroup("opin", q) | dependencyIndex("int", 1)]),
    ...branchInstructionsLong.flatMap(q => [dependencyGroup("opin", q) | dependencyIndex("long", 0), dependencyGroup("opin", q) | dependencyIndex("long", 1)]),
];
globalThis.looseOps = looseOps;

function debugKey(key: number) {
    let index = key & 0x1ff;
    let stacktype = (key >> 9) & 0x3;
    let group = (key >> 11) & 0xffff;
    let sourcetype = (key >> 27) & 0x7;
    let stackstring = (stacktype == 0 ? "int" : stacktype == 1 ? "long" : "string");

    if (sourcetype == 0) { return `known type ${index} ${Object.entries(subtypes).find(q => q[1] == index)?.[0]}`; }
    if (sourcetype == 1) { return `opin ${group} ${knownClientScriptOpNames[group] ?? "unk"} ${index} ${stackstring}`; }
    if (sourcetype == 2) { return `opout ${group} ${knownClientScriptOpNames[group] ?? "unk"} ${index} ${stackstring}`; }
    if (sourcetype == 3) { return `script ${group} arg/local ${index} ${stackstring}`; }
    if (sourcetype == 4) { return `script ${group} return ${index} ${stackstring}`; }
}
globalThis.debugkey = debugKey;

class TypeContext {
    map = new Map<number, Set<number>>();

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
            debugger;
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
    ctx: TypeContext;
    constructor(ctx: TypeContext) {
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

        if (stackinout.exactin) {
            for (let i = stackinout.exactin.int.length - 1; i >= 0; i--) { this.ctx.entangle(knownDependency(stackinout.exactin.int[i]), this.intstack.pop()); }
            for (let i = stackinout.exactin.long.length - 1; i >= 0; i--) { this.ctx.entangle(knownDependency(stackinout.exactin.long[i]), this.longstack.pop()); }
            for (let i = stackinout.exactin.string.length - 1; i >= 0; i--) { this.ctx.entangle(knownDependency(stackinout.exactin.string[i]), this.stringstack.pop()); }
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

        if (stackinout.exactout) {
            for (let i = 0; i < stackinout.exactout.int.length; i++) { this.intstack.push(knownDependency(stackinout.exactout.int[i])); }
            for (let i = 0; i < stackinout.exactout.long.length; i++) { this.longstack.push(knownDependency(stackinout.exactout.long[i])); }
            for (let i = 0; i < stackinout.exactout.string.length; i++) { this.stringstack.push(knownDependency(stackinout.exactout.string[i])); }
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

export function detectSubtypes(calli: ClientscriptObfuscation) {
    let ctx = new TypeContext();
    globalThis.subtypectx = ctx;
    for (let cand of calli.candidates.values()) {
        if (!cand.scriptcontents) { continue; }
        let sections = generateAst(calli, cand.script, cand.scriptcontents.opcodedata, cand.id);
        for (let section of sections) {
            let stack = new CombinedExactStack(ctx);
            for (let op of section.children) {
                if (!(op instanceof RawOpcodeNode)) { throw new Error("unexpected"); }
                if (!stack.pushopcode(op, cand.id)) {
                    break;
                }
            }
        }
    }

    let knowntypes = new Map<number, number>();
    let activekeys = new Set<number>();
    for (let [typename, subtype] of Object.entries(subtypes)) {
        let key = knownDependency(subtype);
        activekeys.add(key);
        knowntypes.set(key, subtype);
    }
    let itercount = 0;
    while (activekeys.size != 0) {
        console.log("iteration " + itercount++);
        let nextactivekeys = new Set<number>();
        for (let key of activekeys) {
            let links = ctx.map.get(key);
            if (links) {
                let known = knowntypes.get(key)!;
                for (let link of links) {
                    let prevknown = knowntypes.get(link);
                    if (typeof prevknown == "undefined") {
                        nextactivekeys.add(link);
                        knowntypes.set(link, known);
                    } else if (prevknown != known) {
                        globalThis.testkey = [key, link];
                        throw new Error(`conflicting types old:${Object.entries(subtypes).find(q => q[1] == prevknown)?.[0] ?? "??"}, new:${Object.entries(subtypes).find(q => q[1] == known)?.[0] ?? "??"}\n${key} - ${debugKey(key)}\n${link} - ${debugKey(link)}`);
                    }
                }
            }
        }
        activekeys = nextactivekeys;
    }
    for (let op of calli.mappings.values()) {
        if (!op.stackinfo.initializedthrough) { continue; }
        let exactin = new ExactStack();
        let diffin = op.stackinfo.in.getStackdiff();
        for (let i = 0; i < diffin.int; i++) { exactin.int.push(knowntypes.get(dependencyGroup("opin", op.id) | dependencyIndex("int", i)) ?? subtypes.loose_int); }
        for (let i = 0; i < diffin.long; i++) { exactin.long.push(knowntypes.get(dependencyGroup("opin", op.id) | dependencyIndex("long", i)) ?? subtypes.loose_long); }
        for (let i = 0; i < diffin.string; i++) { exactin.string.push(knowntypes.get(dependencyGroup("opin", op.id) | dependencyIndex("string", i)) ?? subtypes.loose_string); }

        let exactout = new ExactStack();
        let diffout = op.stackinfo.out.getStackdiff();
        for (let i = 0; i < diffout.int; i++) { exactout.int.push(knowntypes.get(dependencyGroup("opin", op.id) | dependencyIndex("int", i)) ?? subtypes.loose_int); }
        for (let i = 0; i < diffout.long; i++) { exactout.long.push(knowntypes.get(dependencyGroup("opin", op.id) | dependencyIndex("long", i)) ?? subtypes.loose_long); }
        for (let i = 0; i < diffout.string; i++) { exactout.string.push(knowntypes.get(dependencyGroup("opin", op.id) | dependencyIndex("string", i)) ?? subtypes.loose_string); }

        op.stackinfo.exactin = exactin;
        op.stackinfo.exactout = exactout;
    }
    // for (let [id,func] of calli.scriptargs) {
    //     func.
    // }
    return knowntypes;
}

globalThis.detectSubTypes = detectSubtypes;