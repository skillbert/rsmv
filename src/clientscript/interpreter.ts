import { clientscript } from "../../generated/clientscript"
import { ClientscriptObfuscation } from "./callibrator";
import { ClientScriptOp, StackDiff, StackList, SwitchJumpTable, branchInstructions, branchInstructionsInt, getParamOps, namedClientScriptOps, typeToPrimitive } from "./definitions"

export class ClientScriptInterpreter {
    ops: ClientScriptOp[];
    switches: SwitchJumpTable[];
    index = 0;
    localints: number[];
    locallongs: [number, number][];
    localstrings: string[];
    intstack: number[] = [];
    longstack: [number, number][] = [];
    stringstack: string[] = [];
    calli: ClientscriptObfuscation;
    constructor(calli: ClientscriptObfuscation, script: clientscript) {
        this.calli = calli;
        this.ops = script.opcodedata;
        this.switches = script.switches;
        this.localints = new Array(script.localintcount).fill(0);
        this.locallongs = new Array(script.locallongcount).fill([0, 0]);
        this.localstrings = new Array(script.localstringcount).fill("");
    }
    pushStackdiff(diff: StackDiff) {
        if (diff.vararg != 0) { throw new Error("vararg not supported"); }
        for (let i = 0; i < diff.int; i++) { this.intstack.push(0); }
        for (let i = 0; i < diff.long; i++) { this.longstack.push([0, 0]); }
        for (let i = 0; i < diff.string; i++) { this.stringstack.push(""); }
    }
    popStackdiff(diff: StackDiff) {
        if (diff.vararg != 0) { throw new Error("vararg not supported"); }
        for (let i = 0; i < diff.int; i++) { this.popint(); }
        for (let i = 0; i < diff.long; i++) { this.poplong(); }
        for (let i = 0; i < diff.string; i++) { this.popstring(); }
    }
    popint() {
        if (this.intstack.length == 0) { throw new Error(`tried to pop int while none are on stack at index ${this.index - 1}`); }
        return this.intstack.pop()!;
    }
    poplong() {
        if (this.longstack.length == 0) { throw new Error(`tried to pop long while none are on stack at index ${this.index - 1}`); }
        return this.longstack.pop()!;
    }
    popstring() {
        if (this.stringstack.length == 0) { throw new Error(`tried to pop string while none are on stack at index ${this.index - 1}`); }
        return this.stringstack.pop()!;
    }
    next() {
        if (this.index < 0 || this.index >= this.ops.length) {
            throw new Error("jumped out of bounds");
        }
        let op = this.ops[this.index++];

        if (op.opcode == namedClientScriptOps.jump) {
            this.index += op.imm;
        } else if (branchInstructions.includes(op.opcode)) {
            let result = false;
            if (op.opcode == namedClientScriptOps.branch_eq) { result = this.popint() == this.popint(); }
            else if (op.opcode == namedClientScriptOps.branch_not) { result = this.popint() != this.popint(); }
            else if (op.opcode == namedClientScriptOps.branch_lt) { result = this.popint() < this.popint(); }
            else if (op.opcode == namedClientScriptOps.branch_lteq) { result = this.popint() <= this.popint(); }
            else if (op.opcode == namedClientScriptOps.branch_gt) { result = this.popint() > this.popint(); }
            else if (op.opcode == namedClientScriptOps.branch_gteq) { result = this.popint() <= this.popint(); }
            else { throw new Error("unknown branch op (branch long not implemented)"); }
            // else if (op.opcode == namedClientScriptOps.branch_eq_long) { result = this.popint() == this.popint(); }
            // else if (op.opcode == namedClientScriptOps.branch_not_long) { result = this.popint() != this.popint(); }
            // else if (op.opcode == namedClientScriptOps.branch_lt_long) { result = this.popint() < this.popint(); }
            // else if (op.opcode == namedClientScriptOps.branch_lteq_long) { result = this.popint() <= this.popint(); }
            // else if (op.opcode == namedClientScriptOps.branch_gt_long) { result = this.popint() > this.popint(); }
            // else if (op.opcode == namedClientScriptOps.branch_gteq_long) { result = this.popint() <= this.popint(); }
            if (result) {
                this.index += op.imm;
            }
        } else if (op.opcode == namedClientScriptOps.pushconst) {
            if (op.imm == 0) {
                if (typeof op.imm_obj != "number") { throw new Error("exptected imm_obj to be number in pushconst int"); }
                this.intstack.push(op.imm_obj)
            } else if (op.imm == 1) {
                if (!Array.isArray(op.imm_obj) || op.imm_obj.length != 2 || typeof op.imm_obj[0] != "number" || typeof op.imm_obj[1] != "number") { throw new Error("exptected imm_obj to be [number,number] in pushconst long"); }
                this.longstack.push(op.imm_obj);
            } else if (op.imm == 2) {
                if (typeof op.imm_obj != "string") { throw new Error("exptected imm_obj to be string in pushconst string"); }
                this.stringstack.push(op.imm_obj);
            }
        } else if (op.opcode == namedClientScriptOps.return) {
            return true;
        } else if (op.opcode == namedClientScriptOps.gosub) {
            let func = this.calli.scriptargs.get(op.imm);
            if (!func) { throw new Error(`calling unknown clientscript ${op.imm}`); }
            this.popStackdiff(func.stack.in.toStackDiff());
            this.pushStackdiff(func.stack.out.toStackDiff());
        } else if (op.opcode == namedClientScriptOps.joinstring) {
            this.stringstack.push(new Array(op.imm).fill("").map(q => this.popstring()).join(""));
        } else if (op.opcode == namedClientScriptOps.enum_getvalue) {
            let key = this.popint();
            let enumid = this.popint();
            let outtype = this.popint();
            let keytype = this.popint();

            let outprim = typeToPrimitive(outtype);
            if (outprim == "int") { this.intstack.push(0); }
            if (outprim == "long") { this.longstack.push([0, 0]); }
            if (outprim == "string") { this.stringstack.push(""); }
        } else if (op.opcode == namedClientScriptOps.dbrow_getfield) {
            let subrow = this.popint();
            let tablefield = this.popint();
            let rowid = this.popint();

            let dbtable = (tablefield >> 12) & 0xffff;
            let columnid = (tablefield >> 4) & 0xff;
            let subfield = tablefield & 0xf;
            let column = this.calli.dbtables.get(dbtable)?.unk01?.columndata.find(q => q.id == columnid);
            if (!column) { throw new Error(`couldn't find dbtable ${dbtable}.${columnid}`); }
            let types = (subfield != 0 ? [column.columns[subfield - 1].type] : column.columns.map(q => q.type));
            this.pushStackdiff(new StackList(types.map(typeToPrimitive)).toStackDiff());
        } else if (getParamOps.includes(op.opcode)) {
            //args are structid/itemid,paramid
            let paramid = this.popint();
            let param = this.calli.parammeta.get(paramid);
            if (!param) {
                throw new Error(`unknown param ${paramid}`);
            } else {
                let outtype = (param.type ? param.type.vartype : 0);
                //all getparams except for cc_getparam require a target
                let target = (op.opcode == namedClientScriptOps.cc_getparam ? 0 : this.popint());
                let outprim = typeToPrimitive(outtype);
                if (outprim == "int") { this.intstack.push(0); }
                if (outprim == "long") { this.longstack.push([0, 0]); }
                if (outprim == "string") { this.stringstack.push(""); }
            }
        }
        else if (op.opcode == namedClientScriptOps.pushlocalint) { if (op.imm >= this.localints.length) { throw new Error("invalid pushlocalint"); } this.intstack.push(this.localints[op.imm]); }
        else if (op.opcode == namedClientScriptOps.pushlocallong) { if (op.imm >= this.locallongs.length) { throw new Error("invalid pushlocallong"); } this.longstack.push(this.locallongs[op.imm]); }
        else if (op.opcode == namedClientScriptOps.pushlocalstring) { if (op.imm >= this.localstrings.length) { throw new Error("invalid pushlocalstring"); } this.stringstack.push(this.localstrings[op.imm]); }
        else if (op.opcode == namedClientScriptOps.poplocalint) { if (op.imm >= this.localints.length || this.intstack.length == 0) { throw new Error("invalid poplocalint"); } this.localints[op.imm] = this.intstack.pop()!; }
        else if (op.opcode == namedClientScriptOps.poplocallong) { if (op.imm >= this.locallongs.length || this.longstack.length == 0) { throw new Error("invalid poplocallong"); } this.locallongs[op.imm] = this.longstack.pop()!; }
        else if (op.opcode == namedClientScriptOps.poplocalstring) { if (op.imm >= this.localstrings.length || this.stringstack.length == 0) { throw new Error("invalid poplocalstring"); } this.localstrings[op.imm] = this.stringstack.pop()!; }
        else {
            let opinfo = this.calli.decodedMappings.get(op.opcode);
            if (!opinfo) { throw new Error(`Uknown op with opcode ${op.opcode}`); }
            if (!opinfo.stackinfo.initializedthrough) { throw new Error(`Unknown params/returns for op ${op.opcode}`); }
            this.popStackdiff(opinfo.stackinfo.in.toStackDiff());
            this.pushStackdiff(opinfo.stackinfo.out.toStackDiff());
        }

        return false;
    }
}