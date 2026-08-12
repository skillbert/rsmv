import { vartypes } from "../../constants";
import { ClientscriptObfuscation } from "../callibrator";
import { ClientScriptOp, ExactStack, getOpName, namedClientScriptOps, StackDiff, StackList } from "../definitions";

type FragmentType = "literalstring" | "literalnumber" | "global" | "local" | "scriptname" | "opname" | "keyword" | "type" | "comment" | "";

export class WriteResult {
    // precedence based on https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence#precedence_and_associativity
    precedence: number;
    objectid: string;
    type: string;
    fragments: Array<string | WriteResult>;
    constructor(precedence: number, fragments: Array<string | WriteResult> = [], type: FragmentType = "", objectid = "") {
        this.precedence = precedence;
        this.fragments = fragments;
        this.type = type;
        this.objectid = objectid;
    }
    push(...fragments: Array<string | WriteResult>) {
        this.fragments.push(...fragments);
    }
};

export function addBracketsIfNeeded(slotprec: number, assoc: "left" | "right" | "none", isleft: boolean, isright: boolean, sub: WriteResult) {
    let needbracket = sub.precedence < slotprec;
    needbracket ||= sub.precedence == slotprec && isleft && assoc == "right";
    needbracket ||= sub.precedence == slotprec && isright && assoc == "left";
    needbracket ||= sub.precedence == slotprec && assoc == "none";
    if (needbracket) {
        return new WriteResult(18, ["(", sub, ")"]);
    } else {
        return sub;
    }
}

export function subtypeToTs(subt: number) {
    let resentry = Object.entries(vartypes).find(q => q[1] == subt);
    if (!resentry) { return `type_${subt}`; }
    let res = resentry[0];
    // prevent conflict with ts keywords
    // if (res == "boolean") { res = "cs2bool"; }
    if (res == "enum") { res = "cs2enum"; }
    return res;
}

export function tsToSubtype(tscode: string) {
    // prevent conflict with ts keywords
    if (tscode == "cs2bool") { return vartypes.boolean; }
    if (tscode == "cs2enum") { return vartypes.enum; }
    if (!Object.hasOwn(vartypes, tscode)) {
        let m = tscode.match(/^type_(\d+)$/);
        if (!m) { throw new Error("unknown subtype " + tscode); }
        return +m[1];
    }
    return vartypes[tscode];
}

export function addTypeCast(exacttype: number, child: WriteResult) {
    if (exacttype == -1) { return child; }
    if (exacttype == vartypes.int || exacttype == vartypes.string || exacttype == vartypes.long) {
        return child;
    }
    if (exacttype == vartypes.unknown_int || exacttype == vartypes.unknown_string || exacttype == vartypes.unknown_long) {
        return child
    }
    // precedence of `as` operator in ts seems to be 8.5
    return new WriteResult(9, [addBracketsIfNeeded(9, "left", true, false, child), " ", writeLeaf("keyword", "as"), " ", writeLeaf("type", subtypeToTs(exacttype))]);
}

export function writeLeaf(type: FragmentType, str: string, objectid = "") {
    return new WriteResult(19, [str], type, objectid);
}

export function getOpcodeName(calli: ClientscriptObfuscation, op: ClientScriptOp) {
    if (op.opcode == namedClientScriptOps.poplocalint || op.opcode == namedClientScriptOps.pushlocalint) {
        return writeLeaf("local", `int${op.imm}`);
    } else if (op.opcode == namedClientScriptOps.poplocalstring || op.opcode == namedClientScriptOps.pushlocalstring) {
        return writeLeaf("local", `string${op.imm}`);
    } else if (op.opcode == namedClientScriptOps.poplocallong || op.opcode == namedClientScriptOps.pushlocallong) {
        return writeLeaf("local", `long${op.imm}`);
    } else if (op.opcode == namedClientScriptOps.popdiscardint || op.opcode == namedClientScriptOps.popdiscardlong || op.opcode == namedClientScriptOps.popdiscardstring) {
        return new WriteResult(19, []);
    } else if (op.opcode == namedClientScriptOps.popvar || op.opcode == namedClientScriptOps.pushvar) {
        let name = calli.getClientVarName(op.imm);
        return writeLeaf("global", name, calli.getClientVarObjectId(op.imm));
    } else if (op.opcode == namedClientScriptOps.popvarbit || op.opcode == namedClientScriptOps.pushvarbit) {
        let id = op.imm >> 8;
        let optarget = (op.imm & 0xff);
        return writeLeaf("global", calli.getClientVarbitName(id, optarget), `varbit_${id}`);
    }
    return writeLeaf("opname", getOpName(op.opcode));
}

export function valueList(elements: WriteResult[]) {
    if (elements.length == 1) { return elements[0]; }
    let res = new WriteResult(19, ["["]);
    for (let i = 0; i < elements.length; i++) {
        if (i != 0) { res.push(", "); }
        res.push(elements[i]);
    }
    res.push("]");
    return res;
}

export function typelistUnordered(diff: StackDiff, nameoffset: StackDiff, withnames: boolean, withtypes: boolean, exacttype?: ExactStack | null) {
    let res = new WriteResult(19);
    let totalcount = diff.total();
    let totalindex = 0;
    for (let i = 0; i < diff.int; i++) {
        if (withnames) { res.push(writeLeaf("local", `int${nameoffset.int}`)); }
        if (withtypes) { res.push(": ", exacttype ? subtypeToTs(exacttype.int[nameoffset.int]) : writeLeaf("type", "number")); }
        if (++totalindex != totalcount) { res.push(", "); }
        nameoffset.int++;
    }
    for (let i = 0; i < diff.long; i++) {
        if (withnames) { res.push(writeLeaf("local", `long${nameoffset.long}`)); }
        if (withtypes) { res.push(": ", exacttype ? subtypeToTs(exacttype.long[nameoffset.long]) : writeLeaf("type", "BigInt")); }
        if (++totalindex != totalcount) { res.push(", "); }
        nameoffset.long++;
    }
    for (let i = 0; i < diff.string; i++) {
        if (withnames) { res.push(writeLeaf("local", `string${nameoffset.string}`)); }
        if (withtypes) { res.push(": ", exacttype ? subtypeToTs(exacttype.string[nameoffset.string]) : writeLeaf("type", "string")); }
        if (++totalindex != totalcount) { res.push(", "); }
        nameoffset.string++;
    }
    for (let i = 0; i < diff.vararg; i++) {
        if (withnames) { res.push(writeLeaf("local", `vararg${nameoffset.vararg}`)); }
        if (withtypes) { res.push(": ", writeLeaf("type", "BoundFunction")); }
        if (++totalindex != totalcount) { res.push(", "); }
        nameoffset.vararg++;
    }
    return res;
}

export function typeList(stack: StackList, withnames: boolean, withtypes: boolean, exacttype?: ExactStack | null) {
    let res = new WriteResult(19);
    let counts = new StackDiff();
    let withboth = withnames && withtypes;
    for (let i = 0; i < stack.values.length; i++) {
        let part = stack.values[i];
        if (part instanceof StackDiff) {
            res.push(typelistUnordered(part, counts, withnames, withtypes, exacttype));
        }
        else if (part == "int" && i + 1 < stack.values.length && stack.values[i + 1] == "vararg") {
            //combine int+vararg arguments into a single boundfunction argument
            if (withnames) { res.push(writeLeaf("local", `vararg${counts.vararg}`)); }
            if (withboth) { res.push(": "); }
            if (withtypes) { res.push(writeLeaf("type", "BoundFunction")); }
            counts.vararg++;
            i++;
        }
        else if (part == "int") {
            if (withnames) { res.push(writeLeaf("local", `int${counts.int}`)); }
            if (withboth) { res.push(": "); }
            if (withtypes) { res.push(exacttype ? subtypeToTs(exacttype.int[counts.int]) : writeLeaf("type", "number")); }
            counts.int++;
        }
        else if (part == "long") {
            if (withnames) { res.push(writeLeaf("local", `long${counts.long}`)); }
            if (withboth) { res.push(": "); }
            if (withtypes) { res.push(exacttype ? subtypeToTs(exacttype.long[counts.long]) : writeLeaf("type", "BigInt")); }
            counts.long++;
        }
        else if (part == "string") {
            if (withnames) { res.push(writeLeaf("local", `string${counts.string}`)); }
            if (withboth) { res.push(": "); }
            if (withtypes) { res.push(exacttype ? subtypeToTs(exacttype.string[counts.string]) : writeLeaf("type", "string")); }
            counts.string++;
        }
        else throw new Error("unsupported stack type");
        if (i != stack.values.length - 1) { res.push(", "); }
    }
    return res;
}

export function returntypeTuple(stack: StackList, exacttype?: ExactStack | null) {
    if (stack.values.length == 0) {
        return writeLeaf("type", "void");
    }
    if (stack.values.length == 1) {
        return typeList(stack, false, true, exacttype);
    }
    return new WriteResult(17, [
        "[",
        typeList(stack, false, true, exacttype),
        "]"
    ]);
}