import { clientscript } from "../../generated/clientscript"
import { ClientscriptObfuscation } from "./callibrator";
import { ClientScriptOp, StackDiff, StackList, SwitchJumpTable, branchInstructions, getParamOps, knownClientScriptOpNames, longBigIntToJson, longJsonToBigInt, namedClientScriptOps, typeToPrimitive } from "./definitions"
import { rs3opnames } from "./opnames";
import { CS2Api, MAGIC_CONST_CURRENTCOMP, UiRenderContext } from "../scripts/renderrsinterface";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { getEnumInt, getStructInt, loadEnum, loadStruct } from "./util";


type ScriptScope = {
    scriptid: number;
    index: number;
    ops: ClientScriptOp[];
    switches: SwitchJumpTable[];
    localints: number[];
    locallongs: bigint[];
    localstrings: string[];
}

type InterpreterWithScope = ClientScriptInterpreter & { scope: ScriptScope };
type OpImplementation = (inter: InterpreterWithScope, op: ClientScriptOp) => void | Promise<void>;

export class ClientScriptInterpreter {
    intstack: number[] = [];
    longstack: bigint[] = [];
    stringstack: string[] = [];
    scopeStack: ScriptScope[] = [];
    calli: ClientscriptObfuscation;
    mockscripts = new Map<number, (number | bigint | string)[]>();
    scope: ScriptScope | null = null;
    activecompid = -1;
    clientcomps: (CS2Api | undefined)[] = [undefined, undefined];
    stalled: Promise<boolean> | void = undefined;
    uictx: UiRenderContext | null = null;
    constructor(calli: ClientscriptObfuscation, uictx: UiRenderContext | null = null) {
        this.calli = calli;
        this.uictx = uictx;
    }
    reset() {
        if (this.stalled) {
            console.log("resetting cs2 interpreter while an async op is running, everything is probably corrupt");
        }
        this.scopeStack.length = 0;
        this.scope = null;
        this.intstack.length = 0;
        this.longstack.length = 0;
        this.stringstack.length = 0;
        this.activecompid = -1;
        this.clientcomps.fill(undefined);
    }
    popComponent() {
        return this.getComponent(this.popint());
    }
    getClientComp(imm: number) {
        let comp = this.clientcomps[imm];
        if (!comp) { throw new Error(`clientcomp not set`); }
        return comp;
    }
    getComponent(compid: number) {
        if ((compid | 0) == MAGIC_CONST_CURRENTCOMP) { compid = this.activecompid; }
        let comp = this.uictx?.comps.get(compid);
        if (!comp) { return new CS2Api(null); }
        return comp.api;
    }
    async callscriptid(id: number) {
        let data = await this.calli.source.getFileById(cacheMajors.clientscript, id);
        this.callscript(parse.clientscript.read(data, this.calli.source), id);
    }
    async runToEnd() {
        while (true) {
            let res = this.next();
            if (res instanceof Promise) {
                res = await res;
            }
            if (!res) { break; }
        }
    }
    callscript(script: clientscript, scriptid: number) {
        this.log(`calling script ${scriptid}`);
        this.scope = {
            scriptid: scriptid,
            index: 0,
            ops: script.opcodedata,
            switches: script.switches,
            localints: new Array(script.localintcount).fill(0),
            locallongs: new Array(script.locallongcount).fill(0n),
            localstrings: new Array(script.localstringcount).fill("")
        };
        for (let i = script.intargcount - 1; i >= 0; i--) { this.scope.localints[i] = this.popint(); }
        for (let i = script.longargcount - 1; i >= 0; i--) { this.scope.locallongs[i] = this.poplong(); }
        for (let i = script.stringargcount - 1; i >= 0; i--) { this.scope.localstrings[i] = this.popstring(); }
        this.scopeStack.push(this.scope);
    }

    log(text: string) {
        console.log(`CS2: ${"  ".repeat(this.scopeStack.length)} ${text}`);
    }
    pushStackdiff(diff: StackDiff) {
        if (diff.vararg != 0) { throw new Error("cannot push vararg"); }
        for (let i = 0; i < diff.int; i++) { this.pushint(0); }
        for (let i = 0; i < diff.long; i++) { this.pushlong(0n); }
        for (let i = 0; i < diff.string; i++) { this.pushstring(""); }
    }
    popStacklist(list: StackList) {
        for (let i = list.values.length - 1; i >= 0; i--) {
            let val = list.values[i];
            if (val instanceof StackDiff) { this.popStackdiff(val); }
            else if (val == "int") { this.popint(); }
            else if (val == "long") { this.poplong(); }
            else if (val == "string") { this.popstring(); }
            else if (val == "vararg") { this.popvararg(); }
            else { throw new Error("unexpected"); }
        }
    }
    popvararg() {
        let str = this.popstring();
        for (let i = str.match(/Y/g)?.length ?? 0; i > 0; i--) { for (let ii = this.popint(); ii > 0; ii--) { this.popint(); } }
        for (let i = str.match(/i/g)?.length ?? 0; i > 0; i--) { this.popint(); }
        for (let i = str.match(/l/g)?.length ?? 0; i > 0; i--) { this.poplong(); }
        for (let i = str.match(/s/g)?.length ?? 0; i > 0; i--) { this.popstring(); }
    }
    popStackdiff(diff: StackDiff) {
        if (diff.vararg != 0) { throw new Error("can't pop vararg since the order of pops is ambiguous"); }
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
    pushlist(list: (number | bigint | string)[]) {
        for (let v of list) {
            if (typeof v == "number") { this.pushint(v); }
            else if (typeof v == "bigint") { this.pushlong(v); }
            else if (typeof v == "string") { this.pushstring(v); }
            else { throw new Error("unexpected"); }
        }
    }
    pushint(v: number) { this.intstack.push(v); }
    pushlong(v: bigint) { this.longstack.push(v); }
    pushstring(v: string) { this.stringstack.push(v); }
    next(): boolean | Promise<boolean> {
        if (this.stalled) { return this.stalled = this.stalled.then(res => res && this.next()); }
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
        let res: Promise<void> | void = undefined;
        if (op.opcode == namedClientScriptOps.return) {
            this.scopeStack.pop();
            this.scope = this.scopeStack.at(-1) ?? null;
            return !!this.scope;
        } else if (implemented) {
            res = implemented(this as InterpreterWithScope, op);
        } else {
            let opinfo = this.calli.decodedMappings.get(op.opcode);
            if (!opinfo) { throw new Error(`Uknown op with opcode ${op.opcode}`); }
            if (!opinfo.stackinfo.initializedthrough) { throw new Error(`Unknown params/returns for op ${op.opcode}`); }
            this.popStacklist(opinfo.stackinfo.in);
            this.pushStackdiff(opinfo.stackinfo.out.toStackDiff());
        }

        if (res instanceof Promise) {
            this.stalled = res.finally(() => this.stalled = undefined).then(q => true).catch(q => false);
            return this.stalled;
        } else {
            return true;
        }
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
            res += `script stack ${this.scopeStack.map(q => q.scriptid).join(", ")}\n`;
            for (let i = -5; i < 10; i++) {
                let index = this.scope.index + i;
                if (index < 0 || index >= this.scope.ops.length) { continue; }
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

const implementedops = new Map<number, OpImplementation>();
branchInstructions.forEach(id => implementedops.set(id, branchOp));
getParamOps.forEach(id => implementedops.set(id, getParamOp));


implementedops.set(namedClientScriptOps.gosub, (inter, op) => {
    let mockreturn = inter.mockscripts.get(op.imm);
    if (mockreturn) {
        let func = inter.calli.scriptargs.get(op.imm);
        if (!func) { throw new Error(`calling unknown clientscript ${op.imm}`); }
        inter.log(`CS2 - calling sub ${op.imm}${mockreturn ? ` with mocked return value: ${mockreturn}` : ""}`);
        inter.popStacklist(func.stack.in);
        for (let val of mockreturn) {
            if (typeof val == "number") { inter.pushint(val); }
            if (typeof val == "bigint") { inter.pushlong(val); }
            if (typeof val == "string") { inter.pushstring(val); }
        }
    } else {
        // inter.pushStackdiff(func.stack.out.toStackDiff());
        return inter.callscriptid(op.imm);
    }
});
implementedops.set(namedClientScriptOps.enum_getvalue, async inter => {
    let key = inter.popint();
    let enumid = inter.popint();
    let outtype = inter.popint();
    let keytype = inter.popint();

    let outprim = typeToPrimitive(outtype);
    let enumjson = await loadEnum(inter.calli.source, enumid);

    if (outprim != "int") { throw new Error("enum_getvalue can only look up int values"); }

    let res = getEnumInt(enumjson, key);
    inter.pushint(res);
});
implementedops.set(namedClientScriptOps.struct_getparam, async inter => {
    let param = inter.popint();
    let structid = inter.popint();

    let json = await loadStruct(inter.calli.source, structid).catch(q => null);
    let res = getStructInt(inter.calli.parammeta, json, param);
    inter.pushint(res);
});

implementedops.set(namedClientScriptOps.dbrow_getfield, inter => {
    let subrow = inter.popint();
    let tablefield = inter.popint();
    let rowid = inter.popint();

    let dbtable = (tablefield >> 12) & 0xffff;
    let columnid = (tablefield >> 4) & 0xff;
    let subfield = tablefield & 0xf;
    let table = inter.calli.dbtables.get(dbtable);
    let column = table?.unk01?.columndata.find(q => q.id == columnid) ?? table?.unk02?.columndata.find(q => q.id == columnid);
    if (!column) { throw new Error(`couldn't find dbtable ${dbtable}.${columnid}`); }
    let types = (subfield != 0 ? [column.columns[subfield - 1].type] : column.columns.map(q => q.type));
    inter.pushStackdiff(new StackList(types.map(typeToPrimitive)).toStackDiff());
});

implementedops.set(namedClientScriptOps.joinstring, (inter, op) => {
    inter.pushstring(new Array(op.imm).fill("").map(q => inter.popstring()).reverse().join(""));
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
implementedops.set(namedClientScriptOps.printmessage, inter => inter.log(`>> ${inter.popstring()}`));
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
    inter.popStacklist(new StackList([varmeta.type]));
});


const namedimplementations = new Map<string, OpImplementation>();
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
namedimplementations.set("MES_TYPED", inter => inter.log(`>> ${inter.popint()} ${inter.popint()} ${inter.popstring()}`));
namedimplementations.set("LONG_ADD", inter => inter.pushlong(inter.popdeeplong(1) + inter.popdeeplong(0)));
namedimplementations.set("LONG_SUB", inter => inter.pushlong(inter.popdeeplong(1) - inter.popdeeplong(0)));
namedimplementations.set("TOSTRING_LONG", inter => inter.pushstring(inter.poplong().toString()));
namedimplementations.set("INT_TO_LONG", inter => inter.pushlong(BigInt(inter.popint())));
namedimplementations.set("OPENURLRAW", inter => inter.log(`CS2 OPENURLRAW: ${inter.popint()}, ${inter.popstring()}`));

namedimplementations.set("ENUM_GETOUTPUTCOUNT", async inter => {
    let json = await loadEnum(inter.calli.source, inter.popint());
    inter.pushint((json.intArrayValue1 ?? json.intArrayValue2?.values ?? json.stringArrayValue1 ?? json.stringArrayValue2?.values)?.length ?? 0);
});

// this is wrong, not sure what it does
// namedimplementations.set("IF_FIND", (inter, op) => inter.pushint(+!!inter.getComponent(inter.popint()).comp));
namedimplementations.set("CC_CREATE", (inter, op) => { inter.clientcomps[op.imm] = inter.getComponent(inter.popdeep(2)).createChild(inter.popint(), inter.popint()); });
namedimplementations.set("CC_FIND", (inter, op) => inter.pushint(+!!(inter.clientcomps[op.imm] = inter.getComponent(inter.popdeep(1)).findChild(inter.popint()))));
namedimplementations.set("IF_GETLAYER", inter => { inter.popint(); inter.pushint(-1) });//mocked to be -1
namedimplementations.set("IF_GETPARENTLAYER", inter => { inter.popint(); inter.pushint(-1) });//not sure what the difference is
namedimplementations.set("IF_GETNEXTSUBID", inter => inter.pushint(inter.popComponent().getNextChildId()));
namedimplementations.set("ACHIEVEMENT_FINDNEXT", inter => inter.pushint(-1));

namedimplementations.set("IF_SETHIDE", inter => inter.popComponent().setHide(inter.popint()));
namedimplementations.set("IF_GETHEIGHT", inter => inter.pushint(inter.popComponent().getHeight()));
namedimplementations.set("IF_GETWIDTH", inter => inter.pushint(inter.popComponent().getWidth()));
namedimplementations.set("IF_GETX", inter => inter.pushint(inter.popComponent().getX()));
namedimplementations.set("IF_GETY", inter => inter.pushint(inter.popComponent().getY()));
namedimplementations.set("IF_SETOP", inter => inter.popComponent().setOp(inter.popint(), inter.popstring()));
namedimplementations.set("IF_GETHIDE", inter => inter.pushint(inter.popComponent().getHide()));
namedimplementations.set("IF_GETTEXT", inter => inter.pushstring(inter.popComponent().getText()));
namedimplementations.set("IF_SETTEXT", inter => inter.popComponent().setText(inter.popstring()));
namedimplementations.set("IF_SETTEXTALIGN", inter => inter.popComponent().setTextAlign(inter.popint(), inter.popint(), inter.popint()));
namedimplementations.set("IF_GETGRAPHIC", inter => inter.pushint(inter.popComponent().getGraphic()));
namedimplementations.set("IF_GETHFLIP", inter => inter.pushint(+inter.popComponent().getHFlip()));
namedimplementations.set("IF_GETVFLIP", inter => inter.pushint(+inter.popComponent().getVFlip()));
namedimplementations.set("IF_SETGRAPHIC", inter => inter.popComponent().setGraphic(inter.popint()));
namedimplementations.set("IF_SETHFLIP", inter => inter.popComponent().setHFlip(!!inter.popint()));
namedimplementations.set("IF_SETVFLIP", inter => inter.popComponent().setVFlip(!!inter.popint()));
namedimplementations.set("IF_SETMODEL", inter => inter.popComponent().setModel(inter.popint()));
namedimplementations.set("IF_GETTRANS", inter => inter.pushint(inter.popComponent().getTrans()));
namedimplementations.set("IF_GETCOLOUR", inter => inter.pushint(inter.popComponent().getColor()));
namedimplementations.set("IF_GETFILLED", inter => inter.pushint(inter.popComponent().getFilled()));
namedimplementations.set("IF_SETTRANS", inter => inter.popComponent().setTrans(inter.popint()));
namedimplementations.set("IF_SETCOLOUR", inter => inter.popComponent().setColor(inter.popint()));
namedimplementations.set("IF_SETFill", inter => inter.popComponent().setFilled(inter.popint()));
namedimplementations.set("IF_SETSIZE", inter => inter.popComponent().setSize(inter.popdeep(3), inter.popdeep(2), inter.popdeep(1), inter.popdeep(0)));
namedimplementations.set("IF_SETPOSITION", inter => inter.popComponent().setPosition(inter.popdeep(3), inter.popdeep(2), inter.popdeep(1), inter.popdeep(0)));
namedimplementations.set("IF_SETTILING", inter => inter.popComponent().setTiling(inter.popint()));
namedimplementations.set("IF_GETTILING", inter => inter.pushint(inter.popComponent().getTiling()));

//exactly the same as above but with clientcomp from imm instead of server comp from stack
namedimplementations.set("CC_SETHIDE", (inter, op) => inter.getClientComp(op.imm).setHide(inter.popint()));
namedimplementations.set("CC_GETHEIGHT", (inter, op) => inter.pushint(inter.getClientComp(op.imm).getHeight()));
namedimplementations.set("CC_GETWIDTH", (inter, op) => inter.pushint(inter.getClientComp(op.imm).getWidth()));
namedimplementations.set("CC_GETX", (inter, op) => inter.pushint(inter.getClientComp(op.imm).getX()));
namedimplementations.set("CC_GETY", (inter, op) => inter.pushint(inter.getClientComp(op.imm).getY()));
namedimplementations.set("CC_SETOP", (inter, op) => inter.getClientComp(op.imm).setOp(inter.popint(), inter.popstring()));
namedimplementations.set("CC_GETHIDE", (inter, op) => inter.pushint(inter.getClientComp(op.imm).getHide()));
namedimplementations.set("CC_GETTEXT", (inter, op) => inter.pushstring(inter.getClientComp(op.imm).getText()));
namedimplementations.set("CC_SETTEXT", (inter, op) => inter.getClientComp(op.imm).setText(inter.popstring()));
namedimplementations.set("CC_SETTEXTALIGN", (inter, op) => inter.getClientComp(op.imm).setTextAlign(inter.popint(), inter.popint(), inter.popint()))
namedimplementations.set("CC_GETGRAPHIC", (inter, op) => inter.pushint(inter.getClientComp(op.imm).getGraphic()));
namedimplementations.set("CC_GETHFLIP", (inter, op) => inter.pushint(+inter.getClientComp(op.imm).getHFlip()));
namedimplementations.set("CC_GETVFLIP", (inter, op) => inter.pushint(+inter.getClientComp(op.imm).getVFlip()));
namedimplementations.set("CC_SETGRAPHIC", (inter, op) => inter.getClientComp(op.imm).setGraphic(inter.popint()));
namedimplementations.set("CC_SETHFLIP", (inter, op) => inter.getClientComp(op.imm).setHFlip(!!inter.popint()));
namedimplementations.set("CC_SETVFLIP", (inter, op) => inter.getClientComp(op.imm).setVFlip(!!inter.popint()));
namedimplementations.set("CC_SETMODEL", (inter, op) => inter.getClientComp(op.imm).setModel(inter.popint()));
namedimplementations.set("CC_GETTRANS", (inter, op) => inter.pushint(inter.getClientComp(op.imm).getTrans()));
namedimplementations.set("CC_GETCOLOUR", (inter, op) => inter.pushint(inter.getClientComp(op.imm).getColor()));
namedimplementations.set("CC_GETFILLED", (inter, op) => inter.pushint(inter.getClientComp(op.imm).getFilled()));
namedimplementations.set("CC_SETTRANS", (inter, op) => inter.getClientComp(op.imm).setTrans(inter.popint()));
namedimplementations.set("CC_SETCOLOUR", (inter, op) => inter.getClientComp(op.imm).setColor(inter.popint()));
namedimplementations.set("CC_SETFill", (inter, op) => inter.getClientComp(op.imm).setFilled(inter.popint()));
namedimplementations.set("CC_SETSIZE", (inter, op) => inter.getClientComp(op.imm).setSize(inter.popdeep(3), inter.popdeep(2), inter.popdeep(1), inter.popdeep(0)));
namedimplementations.set("CC_SETPOSITION", (inter, op) => inter.getClientComp(op.imm).setPosition(inter.popdeep(3), inter.popdeep(2), inter.popdeep(1), inter.popdeep(0)));
namedimplementations.set("CC_SETTILING", (inter, op) => inter.getClientComp(op.imm).setTiling(inter.popint()));
namedimplementations.set("CC_GETTILING", (inter, op) => inter.pushint(inter.getClientComp(op.imm).getTiling()));


// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
// namedimplementations.set("xxxxx", inter => xxxx)
