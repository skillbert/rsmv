import { clientscript } from "../../generated/clientscript"
import { ClientscriptObfuscation } from "./callibrator";
import { ClientScriptOp, StackDiff, StackList, SwitchJumpTable, branchInstructions, branchInstructionsInt, getOpName, getParamOps, knownClientScriptOpNames, longBigIntToJson, longJsonToBigInt, namedClientScriptOps, typeToPrimitive } from "./definitions"
import { rs3opnames } from "./opnames";

type ScriptScope = {
    index: 0;
    ops: ClientScriptOp[];
    switches: SwitchJumpTable[];
    localints: number[];
    locallongs: bigint[];
    localstrings: string[];
}

type InterpreterWithScope = ClientScriptInterpreter & { scope: ScriptScope };

export class ClientScriptInterpreter {
    intstack: number[] = [];
    longstack: bigint[] = [];
    stringstack: string[] = [];
    scopeStack: ScriptScope[] = [];
    calli: ClientscriptObfuscation;
    mockscripts = new Map<number, (number | bigint | string)[]>();
    scope: ScriptScope | null = null;
    constructor(calli: ClientscriptObfuscation) {
        this.calli = calli;
    }
    callscript(script: clientscript) {
        this.scope = {
            index: 0,
            ops: script.opcodedata,
            switches: script.switches,
            localints: new Array(script.localintcount).fill(0),
            locallongs: new Array(script.locallongcount).fill(0n),
            localstrings: new Array(script.localstringcount).fill("")
        };
        this.scopeStack.push(this.scope);
    }

    pushStackdiff(diff: StackDiff) {
        if (diff.vararg != 0) { throw new Error("vararg not supported"); }
        for (let i = 0; i < diff.int; i++) { this.pushint(0); }
        for (let i = 0; i < diff.long; i++) { this.pushlong(0n); }
        for (let i = 0; i < diff.string; i++) { this.pushstring(""); }
    }
    popStackdiff(diff: StackDiff) {
        if (diff.vararg != 0) { throw new Error("vararg not supported"); }
        for (let i = 0; i < diff.int; i++) { this.popint(); }
        for (let i = 0; i < diff.long; i++) { this.poplong(); }
        for (let i = 0; i < diff.string; i++) { this.popstring(); }
    }
    //shorthand for unordered stack access in implementation
    popdeep(depth: number) {
        if (this.intstack.length < depth) { throw new Error(`tried to pop int while none are on stack at index ${(this.scope?.index ?? 0) - 1}`); }
        return this.intstack.splice(this.intstack.length - 1 - depth, 1)[0];
    }
    //shorthand for unordered stack access in implementation
    popdeeplong(depth: number) {
        if (this.longstack.length < depth) { throw new Error(`tried to pop long while none are on stack at index ${(this.scope?.index ?? 0) - 1}`); }
        return this.longstack.splice(this.longstack.length - 1 - depth, 1)[0];
    }
    //shorthand for unordered stack access in implementation
    popdeepstr(depth: number) {
        if (this.stringstack.length < depth) { throw new Error(`tried to pop string while none are on stack at index ${(this.scope?.index ?? 0) - 1}`); }
        return this.stringstack.splice(this.stringstack.length - 1 - depth, 1)[0];
    }
    popint() {
        if (this.intstack.length == 0) { throw new Error(`tried to pop int while none are on stack at index ${(this.scope?.index ?? 0) - 1}`); }
        return this.intstack.pop()!;
    }
    poplong() {
        if (this.longstack.length == 0) { throw new Error(`tried to pop long while none are on stack at index ${(this.scope?.index ?? 0) - 1}`); }
        return this.longstack.pop()!;
    }
    popstring() {
        if (this.stringstack.length == 0) { throw new Error(`tried to pop string while none are on stack at index ${(this.scope?.index ?? 0) - 1}`); }
        return this.stringstack.pop()!;
    }
    pushint(v: number) { this.intstack.push(v); }
    pushlong(v: bigint) { this.longstack.push(v); }
    pushstring(v: string) { this.stringstack.push(v); }
    next() {
        if (!this.scope) { throw new Error("no script"); }
        if (this.scope.index < 0 || this.scope.index >= this.scope.ops.length) {
            throw new Error("jumped out of bounds");
        }
        let op = this.scope.ops[this.scope.index++];
        let implemented = implementedops.get(op.opcode);
        if (!implemented) {
            //TODO create a proper way to deal with "not-quite-named" ops
            //try find raw op name
            for (let [id, name] of Object.entries(rs3opnames)) {
                if (+id == op.opcode) {
                    implemented = namedimplementations.get(name);
                    break;
                }
            }
        }
        if (op.opcode == namedClientScriptOps.return) {
            this.scope = null;
            //TODO pop scope stack
            return true;
        } else if (implemented) {
            implemented(this as InterpreterWithScope, op);
        } else {
            let opinfo = this.calli.decodedMappings.get(op.opcode);
            if (!opinfo) { throw new Error(`Uknown op with opcode ${op.opcode}`); }
            if (!opinfo.stackinfo.initializedthrough) { throw new Error(`Unknown params/returns for op ${op.opcode}`); }
            this.popStackdiff(opinfo.stackinfo.in.toStackDiff());
            this.pushStackdiff(opinfo.stackinfo.out.toStackDiff());
        }

        return false;
    }
    dump() {
        let res = "";
        res += "locals:\n";
        res += `${this.scope?.localints.join(",") ?? "no scope"}\n`;
        res += `${this.scope?.locallongs.join(",") ?? "no scope"}\n`;
        res += `${this.scope?.localstrings.map(q => `"${q}"`).join(",") ?? "no scope"}\n`;
        res += "stack:\n";
        res += `${this.intstack.join(",")}\n`;
        res += `${this.longstack.join(",")}\n`;
        res += `${this.stringstack.map(q => `"${q}"`).join(",")}\n`;
        if (this.scope) {
            for (let i = 0; i < 10; i++) {
                let index = this.scope.index + i;
                res += `${index} ${index == this.scope.index ? ">>" : "  "} `;
                let op = this.scope.ops[index];
                if (op) {
                    let opinfo = this.calli.decodedMappings.get(op.opcode);
                    let name = knownClientScriptOpNames[op.opcode];
                    res += `${name.padEnd(12, " ").slice(0, 12)} ${op.imm} ${op.imm_obj ?? ""}\n`;
                } else {
                    res += `??\n`;
                }
            }
        }
        console.log(res);
    }
}


function branchOp(inter: ClientScriptInterpreter, op: ClientScriptOp) {
    let result = false;
    if (op.opcode == namedClientScriptOps.branch_eq) { result = inter.popdeep(1) == inter.popdeep(0); }
    else if (op.opcode == namedClientScriptOps.branch_not) { result = inter.popdeep(1) != inter.popdeep(0); }
    else if (op.opcode == namedClientScriptOps.branch_lt) { result = inter.popdeep(1) < inter.popdeep(0); }
    else if (op.opcode == namedClientScriptOps.branch_lteq) { result = inter.popdeep(1) <= inter.popdeep(0); }
    else if (op.opcode == namedClientScriptOps.branch_gt) { result = inter.popdeep(1) > inter.popdeep(0); }
    else if (op.opcode == namedClientScriptOps.branch_gteq) { result = inter.popdeep(1) >= inter.popdeep(0); }
    else { throw new Error("unknown branch op (branch long not implemented)"); }
    // else if (op.opcode == namedClientScriptOps.branch_eq_long) { result = inter.popint() == inter.popint(); }
    // else if (op.opcode == namedClientScriptOps.branch_not_long) { result = inter.popint() != inter.popint(); }
    // else if (op.opcode == namedClientScriptOps.branch_lt_long) { result = inter.popint() < inter.popint(); }
    // else if (op.opcode == namedClientScriptOps.branch_lteq_long) { result = inter.popint() <= inter.popint(); }
    // else if (op.opcode == namedClientScriptOps.branch_gt_long) { result = inter.popint() > inter.popint(); }
    // else if (op.opcode == namedClientScriptOps.branch_gteq_long) { result = inter.popint() <= inter.popint(); }
    if (result) {
        if (!inter.scope) { throw new Error("unexpected"); }
        inter.scope.index += op.imm;
    }
}
function getParamOp(inter: ClientScriptInterpreter, op: ClientScriptOp) {
    //args are structid/itemid,paramid
    let paramid = inter.popint();
    let param = inter.calli.parammeta.get(paramid);
    if (!param) {
        throw new Error(`unknown param ${paramid}`);
    } else {
        let outtype = (param.type ? param.type.vartype : 0);
        //all getparams except for cc_getparam require a target
        let target = (op.opcode == namedClientScriptOps.cc_getparam ? 0 : inter.popint());
        let outprim = typeToPrimitive(outtype);
        if (outprim == "int") { inter.pushint(0); }
        if (outprim == "long") { inter.pushlong(0n); }
        if (outprim == "string") { inter.pushstring(""); }
    }
}

const implementedops = new Map<number, (inter: InterpreterWithScope, op: ClientScriptOp) => void>();
branchInstructions.forEach(id => implementedops.set(id, branchOp));
getParamOps.forEach(id => implementedops.set(id, getParamOp));

implementedops.set(namedClientScriptOps.enum_getvalue, inter => {
    let key = inter.popint();
    let enumid = inter.popint();
    let outtype = inter.popint();
    let keytype = inter.popint();

    let outprim = typeToPrimitive(outtype);
    if (outprim == "int") { inter.pushint(0); }
    if (outprim == "long") { inter.pushlong(0n); }
    if (outprim == "string") { inter.pushstring(""); }
});

implementedops.set(namedClientScriptOps.dbrow_getfield, inter => {
    let subrow = inter.popint();
    let tablefield = inter.popint();
    let rowid = inter.popint();

    let dbtable = (tablefield >> 12) & 0xffff;
    let columnid = (tablefield >> 4) & 0xff;
    let subfield = tablefield & 0xf;
    let column = inter.calli.dbtables.get(dbtable)?.unk01?.columndata.find(q => q.id == columnid);
    if (!column) { throw new Error(`couldn't find dbtable ${dbtable}.${columnid}`); }
    let types = (subfield != 0 ? [column.columns[subfield - 1].type] : column.columns.map(q => q.type));
    inter.pushStackdiff(new StackList(types.map(typeToPrimitive)).toStackDiff());
});

implementedops.set(namedClientScriptOps.joinstring, (inter, op) => {
    inter.pushstring(new Array(op.imm).fill("").map(q => inter.popstring()).reverse().join(""));
});

implementedops.set(namedClientScriptOps.gosub, (inter, op) => {
    let func = inter.calli.scriptargs.get(op.imm);
    let mockreturn = inter.mockscripts.get(op.imm);
    if (!func) { throw new Error(`calling unknown clientscript ${op.imm}`); }
    inter.popStackdiff(func.stack.in.toStackDiff());
    console.log(`CS2 - calling sub ${op.imm}${mockreturn ? ` with mocked return value: ${mockreturn}` : ""}`);
    if (mockreturn) {
        for (let val of mockreturn) {
            if (typeof val == "number") { inter.pushint(val); }
            if (typeof val == "bigint") { inter.pushlong(val); }
            if (typeof val == "string") { inter.pushstring(val); }
        }
    } else {
        inter.pushStackdiff(func.stack.out.toStackDiff());
    }
});

implementedops.set(namedClientScriptOps.pushconst, (inter, op) => {
    if (op.imm == 0) {
        if (typeof op.imm_obj != "number") { throw new Error("expected imm_obj to be number in pushconst int"); }
        inter.pushint(op.imm_obj)
    } else if (op.imm == 1) {
        if (!Array.isArray(op.imm_obj) || op.imm_obj.length != 2 || typeof op.imm_obj[0] != "number" || typeof op.imm_obj[1] != "number") { throw new Error("expected imm_obj to be [number,number] in pushconst long"); }
        inter.pushlong(longJsonToBigInt(op.imm_obj));
    } else if (op.imm == 2) {
        if (typeof op.imm_obj != "string") { throw new Error("expected imm_obj to be string in pushconst string"); }
        inter.pushstring(op.imm_obj);
    }
});

implementedops.set(namedClientScriptOps.switch, (inter, op) => {
    let branches = inter.scope.switches[op.imm];
    if (!branches) { throw new Error(`non-existant branches referenced switch at ${inter.scope.index}`); }
    let val = inter.popint();
    let match = branches.find(q => q.value == val);
    if (match) {
        inter.scope.index += match.jump;
    }
});

implementedops.set(namedClientScriptOps.jump, (inter, op) => {
    inter.scope.index += op.imm;
});

implementedops.set(namedClientScriptOps.pushlocalint, (inter, op) => {
    if (op.imm >= inter.scope.localints.length) { throw new Error("invalid pushlocalint"); }
    inter.pushint(inter.scope.localints[op.imm]);
});
implementedops.set(namedClientScriptOps.pushlocallong, (inter, op) => {
    if (op.imm >= inter.scope.locallongs.length) { throw new Error("invalid pushlocallong"); }
    inter.pushlong(inter.scope.locallongs[op.imm]);
});
implementedops.set(namedClientScriptOps.pushlocalstring, (inter, op) => {
    if (op.imm >= inter.scope.localstrings.length) { throw new Error("invalid pushlocalstring"); }
    inter.pushstring(inter.scope.localstrings[op.imm]);
});
implementedops.set(namedClientScriptOps.poplocalint, (inter, op) => {
    if (op.imm >= inter.scope.localints.length) { throw new Error("invalid poplocalint"); }
    inter.scope.localints[op.imm] = inter.popint();
});
implementedops.set(namedClientScriptOps.poplocallong, (inter, op) => {
    if (op.imm >= inter.scope.locallongs.length) { throw new Error("invalid poplocallong"); }
    inter.scope.locallongs[op.imm] = inter.poplong();
});
implementedops.set(namedClientScriptOps.poplocalstring, (inter, op) => {
    if (op.imm >= inter.scope.localstrings.length) { throw new Error("invalid poplocalstring"); }
    inter.scope.localstrings[op.imm] = inter.popstring();
});
implementedops.set(namedClientScriptOps.printmessage, inter => console.log(`CS2: ${inter.popstring()}`));
implementedops.set(namedClientScriptOps.inttostring, inter => inter.pushstring(inter.popdeep(1).toString(inter.popdeep(0))));
implementedops.set(namedClientScriptOps.strcmp, inter => {
    let right = inter.popstring();
    let left = inter.popstring();
    inter.pushint(left < right ? -1 : left > right ? 1 : 0);
});
implementedops.set(namedClientScriptOps.pushvar, (inter, op) => {
    let varmeta = inter.calli.getClientVarMeta(op.imm);
    if (!varmeta) { throw new Error(`unknown clientvar with id ${op.imm}`); }
    inter.pushStackdiff(new StackList([varmeta.type]).toStackDiff());
});
implementedops.set(namedClientScriptOps.popvar, (inter, op) => {
    let varmeta = inter.calli.getClientVarMeta(op.imm);
    if (!varmeta) { throw new Error(`unknown clientvar with id ${op.imm}`); }
    inter.popStackdiff(new StackList([varmeta.type]).toStackDiff());
});


const namedimplementations = new Map<string, (inter: InterpreterWithScope, op: ClientScriptOp) => void>();
namedimplementations.set("STRING_LENGTH", inter => inter.pushint(inter.popstring().length));
namedimplementations.set("SUBSTRING", inter => inter.pushstring(inter.popstring().substring(inter.popdeep(1), inter.popdeep(0))));
namedimplementations.set("STRING_INDEXOF_STRING", inter => inter.pushint(inter.popdeepstr(1).indexOf(inter.popdeepstr(0), inter.popint())));
namedimplementations.set("STRING_INDEXOF_CHAR", inter => inter.pushint(inter.popstring().indexOf(String.fromCharCode(inter.popdeep(1)), inter.popdeep(0))));
namedimplementations.set("MIN", inter => inter.pushint(Math.min(inter.popint(), inter.popint())));
namedimplementations.set("MAX", inter => inter.pushint(Math.max(inter.popint(), inter.popint())));
namedimplementations.set("ADD", inter => inter.pushint(inter.popint() + inter.popint() | 0));
namedimplementations.set("SUB", inter => inter.pushint(inter.popdeep(1) - inter.popint() | 0));
namedimplementations.set("DIVIDE", inter => inter.pushint(inter.popdeep(1) / inter.popint() | 0));
namedimplementations.set("MULTIPLY", inter => inter.pushint(Math.imul(inter.popdeep(1), inter.popint())));
namedimplementations.set("AND", inter => inter.pushint(inter.popint() & inter.popint()));
namedimplementations.set("OR", inter => inter.pushint(inter.popint() | inter.popint()));
namedimplementations.set("LOWERCASE", inter => inter.pushstring(inter.popstring().toLowerCase()));
namedimplementations.set("LONG_UNPACK", inter => { let long = longBigIntToJson(inter.poplong()); inter.pushint(long[0] >> 0); inter.pushint(long[1] >> 0); });
namedimplementations.set("MES_TYPED", inter => console.log(`CS2: ${inter.popint()} ${inter.popint()} ${inter.popstring()}`));
namedimplementations.set("LONG_ADD", inter => inter.pushlong(inter.popdeeplong(1) + inter.popdeeplong(0)));
namedimplementations.set("LONG_SUB", inter => inter.pushlong(inter.popdeeplong(1) - inter.popdeeplong(0)));
namedimplementations.set("TOSTRING_LONG", inter => inter.pushstring(inter.poplong().toString()));
namedimplementations.set("INT_TO_LONG", inter => inter.pushlong(BigInt(inter.popint())));
namedimplementations.set("OPENURLRAW", inter => console.log("CS2 OPENURLRAW:", inter.popint(), inter.popstring()));