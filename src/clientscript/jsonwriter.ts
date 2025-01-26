import { clientscript } from "../../generated/clientscript";
import { getOrInsert } from "../utils";
import { AstNode, ClientScriptFunction } from "./ast";
import { ClientscriptObfuscation } from "./callibrator";
import { branchInstructionsOrJump, namedClientScriptOps, StackDiff, ClientScriptOp, getOpName, makeop, pushOrPopLocalOps, makejump, SwitchJumpTable, StackList, variableSources, popDiscardOps } from "./definitions";

const tmplocaloffset = 0x10000;

export class OpcodeWriterContext {
    calli: ClientscriptObfuscation;
    tempcounts = new StackDiff();
    labels = new Map<ClientScriptOp, number>();
    namedLabels = new Map<string, ClientScriptOp>();
    subfunctions = new Map<string, { label: ClientScriptOp, func: ClientScriptFunction }>();
    returntableLabel: ClientScriptOp | null = null;
    returnsites = new Map<number, ClientScriptOp>();
    returnsiteidcounter = 1;
    constructor(calli: ClientscriptObfuscation) {
        this.calli = calli;
    }
    makeReturnOp() {
        if (!this.returntableLabel) {
            this.returntableLabel = makeop(namedClientScriptOps.jump, 0);
            this.declareLabel(this.returntableLabel);
        }
        return makejump(this.returntableLabel);
    }
    getSubfunctionLabel(name: string) {
        return getOrInsert(this.namedLabels, name, () => {
            let label = makeop(namedClientScriptOps.jump, 0);
            this.declareLabel(label);
            return label;
        });
    }
    makeSubCallOps(funcname: string) {
        let returnid = this.returnsiteidcounter++;
        let body: ClientScriptOp[] = [];
        let labelobj = this.getSubfunctionLabel(funcname);
        if (!labelobj) { throw new Error("subcall func does not exist"); }
        body.push(makeop(namedClientScriptOps.pushconst, 0, returnid));
        body.push(makejump(labelobj));
        let returnsite = makeop(namedClientScriptOps.jump, 0);
        body.push(returnsite);
        this.returnsites.set(returnid, returnsite);
        this.declareLabel(returnsite);
        return body;
    }
    declareLabel(op: ClientScriptOp) {
        this.labels.set(op, -1);
    }
    addSubfunction(func: ClientScriptFunction) {
        if (this.subfunctions.has(func.scriptname)) { throw new Error(`subfunction ${func.scriptname} already exists`); }
        let label = this.getSubfunctionLabel(func.scriptname);
        this.subfunctions.set(func.scriptname, { label, func });
    }
}

function tracerNops(text: string) {
    return [
        makeop(namedClientScriptOps.pushconst, 2, text),
        makeop(namedClientScriptOps.popdiscardstring)
    ]
}

export const intrinsics = new Map<string, { in: StackList, out: StackList, write: (ctx: OpcodeWriterContext) => ClientScriptOp[] }>();
intrinsics.set("varbittable", {
    in: new StackList(),
    out: new StackList(["string"]),
    write(ctx: OpcodeWriterContext) {
        //it think all of this might be obsolete because of VAR_REFERENCE_GET
        let body: ClientScriptOp[] = [];
        let lookupstr = ",";
        for (let [id, meta] of ctx.calli.varbitmeta) {
            let group = meta.varid >> 16;
            let varid = meta.varid & 0xffff;
            lookupstr += `${id}:${group}/${varid}/${meta.bits[0]}/${meta.bits[1]},`;
        }
        body.push(makeop(namedClientScriptOps.pushconst, 2, lookupstr));
        body.push(ctx.makeReturnOp());//return address is still on int stack as argument
        return body;
    }
});
intrinsics.set("opnametoid", {
    in: new StackList(["string"]),
    out: new StackList(["int"]),
    write(ctx: OpcodeWriterContext) {
        let body: ClientScriptOp[] = [];
        //args=returnaddr:int,name:string
        ctx.tempcounts.int = Math.max(ctx.tempcounts.int, 1);
        ctx.tempcounts.string = Math.max(ctx.tempcounts.string, 1);
        body.push(makeop(namedClientScriptOps.poplocalint, tmplocaloffset + 0));
        body.push(makeop(namedClientScriptOps.poplocalstring, tmplocaloffset + 0));

        let endlabel = makeop(namedClientScriptOps.jump, 0);
        ctx.declareLabel(endlabel);

        for (let [id, opinfo] of ctx.calli.decodedMappings) {
            let name = getOpName(id).toLowerCase();
            //strcomp(opname,string0)==0
            body.push(makeop(namedClientScriptOps.pushconst, 2, name));
            body.push(makeop(namedClientScriptOps.pushlocalstring, tmplocaloffset + 0));
            body.push(makeop(namedClientScriptOps.strcmp));
            body.push(makeop(namedClientScriptOps.pushconst, 0, 0));
            body.push(makeop(namedClientScriptOps.branch_eq, 1));
            //jump over
            body.push(makeop(namedClientScriptOps.jump, 2));
            //push result
            body.push(makeop(namedClientScriptOps.pushconst, 0, id));
            body.push(makejump(endlabel));
        }
        //push default -1 if nothing matched
        body.push(makeop(namedClientScriptOps.pushconst, 2, "no opcode id found for : "));
        body.push(makeop(namedClientScriptOps.pushlocalstring, tmplocaloffset + 0));
        body.push(makeop(namedClientScriptOps.joinstring, 2));
        body.push(makeop(namedClientScriptOps.printmessage));
        body.push(makeop(namedClientScriptOps.pushconst, 0, -1));
        body.push(endlabel);
        //subreturn
        body.push(makeop(namedClientScriptOps.pushlocalint, tmplocaloffset + 0));
        body.push(ctx.makeReturnOp());
        return body;
    }
});

function partialCallIntrinsic(idstart: number, idend: number) {
    return (ctx: OpcodeWriterContext) => {
        let body: ClientScriptOp[] = [];
        let jumptable: SwitchJumpTable = [];

        //btree,returnaddr
        ctx.tempcounts.int = Math.max(ctx.tempcounts.int, 2);
        body.push(makeop(namedClientScriptOps.poplocalint, tmplocaloffset + 1));

        let jumpstart = body.length;
        let endlabel = makeop(namedClientScriptOps.jump, 0);
        ctx.declareLabel(endlabel);

        //default case
        body.push(makeop(namedClientScriptOps.pushconst, 2, "no script matched"));
        body.push(makeop(namedClientScriptOps.printmessage));
        body.push(makejump(endlabel));

        //find last known script id and round to next 1k, with at least 1k padding
        // let maxscriptid = 0;
        // for (let id of ctx.calli.scriptargs.keys()) { maxscriptid = Math.max(maxscriptid, id); }
        // maxscriptid = maxscriptid - (maxscriptid % 1000) + 2000;
        for (let id = idstart; id < idend; id++) {
            // for (let id of [19500, 19501, 19502, 19503, 19504, 19505, 19506, 19507, 39]) {
            jumptable.push({ value: id, jump: body.length - jumpstart });
            body.push(makeop(namedClientScriptOps.gosub, id));
            // body.push(makeop(namedClientScriptOps.pushconst, 2, `calling ${id}`));
            // body.push(makeop(namedClientScriptOps.printmessage));
            body.push(makejump(endlabel));
        }

        body.push(endlabel);

        //replace the switch with a btree made of ifs because the total number of switch cases in a script has to be <~8k
        ctx.tempcounts.int = Math.max(ctx.tempcounts.int, 1);
        body.splice(jumpstart, 0, ...jumptableToBTree(jumptable, tmplocaloffset + 0));

        //subreturn
        body.push(makeop(namedClientScriptOps.pushlocalint, tmplocaloffset + 1));
        body.push(ctx.makeReturnOp());

        return body;
    }
}

function partialVarIntrinsic(iswrite: boolean, dottarget: number, sectionindex: number) {
    return (ctx: OpcodeWriterContext) => {
        let body: ClientScriptOp[] = [];
        let jumptable: SwitchJumpTable = [];

        let keys: number[] = [];
        function addgroup(key: number, start: number, maxcount: number) {
            let maxid = ctx.calli.varmeta.get(key)?.maxid ?? 0;
            maxid = Math.ceil((maxid + 200) / 100) * 100;//add 200 and round up to next 100
            maxid = Math.min(maxid, start + maxcount);
            for (let i = start; i < maxid; i++) {
                keys.push((key << 24) | (i << 8) | dottarget);
            }
        }
        if (sectionindex == 0) {
            addgroup(variableSources.player.key, 0, 10000);
        } else if (sectionindex == 1) {
            addgroup(variableSources.client.key, 0, 10000);
        } else if (sectionindex == 2) {
            for (let group of Object.values(variableSources)) {
                if (group == variableSources.player) { continue; }
                if (group == variableSources.client) { continue; }
                addgroup(group.key, 0, 10000);
            }
            // need to slice the end off player group because its too large to fit in one group
            addgroup(variableSources.player.key, 10000, 10000);
        } else {
            throw new Error("unexpected");
        }

        //btree,returnaddr
        ctx.tempcounts.int = Math.max(ctx.tempcounts.int, 2);
        body.push(makeop(namedClientScriptOps.poplocalint, tmplocaloffset + 1));

        let jumpstart = body.length;
        let endlabel = makeop(namedClientScriptOps.jump, 0);
        ctx.declareLabel(endlabel);

        //default case
        body.push(makeop(namedClientScriptOps.pushconst, 2, "no var matched"));
        body.push(makeop(namedClientScriptOps.printmessage));
        body.push(makejump(endlabel));

        for (let key of keys) {
            jumptable.push({ value: key, jump: body.length - jumpstart });
            body.push(makeop(iswrite ? namedClientScriptOps.popvar : namedClientScriptOps.pushvar, key));
            body.push(makejump(endlabel));
        }

        body.push(endlabel);

        //replace the switch with a btree made of ifs because the total number of switch cases in a script has to be <~8k
        ctx.tempcounts.int = Math.max(ctx.tempcounts.int, 1);
        body.splice(jumpstart, 0, ...jumptableToBTree(jumptable, tmplocaloffset + 0));

        //subreturn
        body.push(makeop(namedClientScriptOps.pushlocalint, tmplocaloffset + 1));
        body.push(ctx.makeReturnOp());

        return body;
    }
}

//need to split up the call intrinsic since it takes about 100k ops in total while the max is 65k per script
intrinsics.set("call0", { in: new StackList(["int"]), out: new StackList(), write: partialCallIntrinsic(0, 10e3) });
intrinsics.set("call1", { in: new StackList(["int"]), out: new StackList(), write: partialCallIntrinsic(10e3, 20e3) });

intrinsics.set("getvar0", { in: new StackList(["int"]), out: new StackList(), write: partialVarIntrinsic(false, 0, 0) });
intrinsics.set("getvar1", { in: new StackList(["int"]), out: new StackList(), write: partialVarIntrinsic(false, 0, 1) });
intrinsics.set("getvar2", { in: new StackList(["int"]), out: new StackList(), write: partialVarIntrinsic(false, 0, 2) });
intrinsics.set("getvarother0", { in: new StackList(["int"]), out: new StackList(), write: partialVarIntrinsic(false, 1, 0) });
intrinsics.set("getvarother1", { in: new StackList(["int"]), out: new StackList(), write: partialVarIntrinsic(false, 1, 1) });
intrinsics.set("getvarother2", { in: new StackList(["int"]), out: new StackList(), write: partialVarIntrinsic(false, 1, 2) });
intrinsics.set("setvar0", { in: new StackList(["int"]), out: new StackList(), write: partialVarIntrinsic(true, 0, 0) });
intrinsics.set("setvar1", { in: new StackList(["int"]), out: new StackList(), write: partialVarIntrinsic(true, 0, 1) });
intrinsics.set("setvar2", { in: new StackList(["int"]), out: new StackList(), write: partialVarIntrinsic(true, 0, 2) });

intrinsics.set("op", {
    in: new StackList(["int"]),
    out: new StackList(),
    write(ctx: OpcodeWriterContext) {
        let body: ClientScriptOp[] = [];

        //store return addr to tmp0
        ctx.tempcounts.int = Math.max(ctx.tempcounts.int, 1);
        body.push(makeop(namedClientScriptOps.poplocalint, tmplocaloffset + 0));

        let jumptable: ClientScriptOp["imm_obj"] = { type: "switchvalues", value: [] };
        let switchop = makeop(namedClientScriptOps.switch, 0, jumptable);
        body.push(switchop);
        let jumpstart = body.length;

        let endlabel = makeop(namedClientScriptOps.jump, 0);
        ctx.declareLabel(endlabel);

        //default case
        body.push(makeop(namedClientScriptOps.pushconst, 2, "no opcodes matched"));
        body.push(makeop(namedClientScriptOps.printmessage));
        body.push(makejump(endlabel));

        for (let id of ctx.calli.decodedMappings.keys()) {
            let opid = +id;
            if (branchInstructionsOrJump.includes(opid)) { continue; }
            if (opid == namedClientScriptOps.switch) { continue; }
            if (opid == namedClientScriptOps.return) { continue; }
            if (opid == namedClientScriptOps.pushconst) { continue; }
            jumptable.value.push({ value: opid, jump: body.length - jumpstart });
            body.push({ opcode: opid, imm: 0, imm_obj: null });
            body.push(makejump(endlabel));
        }

        body.push(endlabel);
        //subreturn
        body.push(makeop(namedClientScriptOps.pushlocalint, tmplocaloffset + 0));
        body.push(ctx.makeReturnOp());
        return body;
    }
});

function jumptableToBTree(table: SwitchJumpTable, tmpintlocal: number) {
    //number of equality comparisons per btree bucket
    //needs to be relatively high in order to fit 20k branches in 65535 ops for the "call" intrinsic
    const bucketsize = 16;
    table.sort((a, b) => a.value - b.value);

    let body: ClientScriptOp[] = [];
    body.push(makeop(namedClientScriptOps.poplocalint, tmpintlocal));
    let branch = (start: number, end: number) => {
        let len = end - start;
        if (len < bucketsize) {
            for (let i = 0; i < len; i++) {
                let entry = table[start + i];
                //val==case[i] --> jump to label[i]
                body.push(makeop(namedClientScriptOps.pushlocalint, tmpintlocal));
                body.push(makeop(namedClientScriptOps.pushconst, 0, entry.value));
                body.push(makeop(namedClientScriptOps.branch_eq, entry.jump));
            }
            //default --> go to next statement after "switch"
            body.push(makeop(namedClientScriptOps.jump, 0));
        } else {
            let split = start + Math.ceil(len / 2);
            let branchop = makeop(namedClientScriptOps.branch_gteq, 0);
            body.push(makeop(namedClientScriptOps.pushlocalint, tmpintlocal));
            body.push(makeop(namedClientScriptOps.pushconst, 0, table[split].value));
            body.push(branchop);
            let branchbase = body.length;
            branch(start, split);
            branchop.imm = body.length - branchbase;
            branch(split, end);
        }
    }
    branch(0, table.length);
    //retarget all jumps to make them relative to end of this construct
    for (let i = 0; i < body.length; i++) {
        let op = body[i];
        if (op.opcode == namedClientScriptOps.branch_eq || op.opcode == namedClientScriptOps.jump) {
            op.imm += body.length - i - 1;
        }
    }
    return body;
}

/**
 * This type of subfunction allows raw access to the stack, however calls to other functions or intrinsics aren't allowed
 */
export function writeRawStackSubFunction(ctx: OpcodeWriterContext, subfunc: { label: ClientScriptOp, func: ClientScriptFunction }) {
    let opdata: ClientScriptOp[] = [];
    let intype = subfunc.func.argtype.getStackdiff();
    let outtype = subfunc.func.returntype.getStackdiff();
    //allocate all locals as temps
    ctx.tempcounts.int = Math.max(ctx.tempcounts.int, subfunc.func.localCounts.int + 1, outtype.int + 1);//1 extra for the return addr
    ctx.tempcounts.long = Math.max(ctx.tempcounts.long, subfunc.func.localCounts.long, outtype.long);
    ctx.tempcounts.string = Math.max(ctx.tempcounts.string, subfunc.func.localCounts.string, outtype.string);

    let headerindex = opdata.length;
    let headerop = makeop(namedClientScriptOps.pushconst, 2, "");
    opdata.push(headerop);
    let jumptarget = opdata.length;
    opdata.push(subfunc.label);
    //move return address from top of int stack to last tmp+1
    let returnaddrtemp = tmplocaloffset + subfunc.func.localCounts.int;
    opdata.push(makeop(namedClientScriptOps.poplocalint, returnaddrtemp));
    //move all args from stack to tmp locals
    for (let i = intype.int - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalint, tmplocaloffset + i)); }
    for (let i = intype.long - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocallong, tmplocaloffset + i)); }
    for (let i = intype.string - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalstring, tmplocaloffset + i)); }

    let funcbody = subfunc.func.getOpcodes(ctx);
    let endlabel = makeop(namedClientScriptOps.jump, 0);
    ctx.declareLabel(endlabel);

    funcbody.forEach((op, i) => {
        //replace all return ops into ops that jump to the end label (op itself is a nop)
        if (op.opcode == namedClientScriptOps.jump) {
            if (typeof op.imm_obj == "object" && op.imm_obj && "type" in op.imm_obj && op.imm_obj.type == "jumplabel") {
                throw new Error("subcalls not allowed in rawstack subfunction");
            }
        }
        if (op.opcode == namedClientScriptOps.return) {
            funcbody[i] = makejump(endlabel);
        }
        //replace change all local var ops to target a tmp local instead
        if (pushOrPopLocalOps.includes(op.opcode)) {
            funcbody[i] = { ...op, imm: tmplocaloffset + op.imm };
        }
    });
    opdata.push(...tracerNops(`subfunc ${subfunc.func.scriptname} body`));
    let bodyindex = opdata.length;
    opdata.push(...funcbody);
    let footindex = opdata.length;
    opdata.push(endlabel);
    opdata.push(...tracerNops(`subfunc ${subfunc.func.scriptname} footer`));
    opdata.push(makeop(namedClientScriptOps.pushlocalint, returnaddrtemp));
    opdata.push(ctx.makeReturnOp());
    opdata.push(...tracerNops(`subfunc ${subfunc.func.scriptname} end`));

    headerop.imm_obj = `${subfunclabel("subfunc", jumptarget - headerindex, opdata.length - headerindex, intype, outtype)} body=${bodyindex - headerindex} foot=${footindex - headerindex} rawstack=true`;

    return opdata;
}

export function writeSubFunction(ctx: OpcodeWriterContext, subfunc: { label: ClientScriptOp, func: ClientScriptFunction }) {
    let opdata: ClientScriptOp[] = [];
    let intype = subfunc.func.argtype.getStackdiff();
    let outtype = subfunc.func.returntype.getStackdiff();
    let localtype = subfunc.func.localCounts.clone();
    ctx.tempcounts.int = Math.max(ctx.tempcounts.int, intype.int + 1, outtype.int + 1);//1 extra for the return addr
    ctx.tempcounts.long = Math.max(ctx.tempcounts.long, intype.long, outtype.long);
    ctx.tempcounts.string = Math.max(ctx.tempcounts.string, intype.string, outtype.string);

    //have to do some stack wizardry here since the VM only lets you access the very top of the stack
    //sadly this requires extra local variables and i don't know how many we're allowed to have
    //the jump target for calls to this subfunction
    let headerindex = opdata.length;
    let headerop = makeop(namedClientScriptOps.pushconst, 2, "");
    opdata.push(headerop);
    let jumptarget = opdata.length;
    opdata.push(subfunc.label);
    //move return address from top of int stack to last tmp+1
    let returnaddrtemp = tmplocaloffset + Math.max(intype.int, outtype.int);
    opdata.push(makeop(namedClientScriptOps.poplocalint, returnaddrtemp));
    //move all args from stack to tmp locals
    for (let i = intype.int - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalint, tmplocaloffset + i)); }
    for (let i = intype.long - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocallong, tmplocaloffset + i)); }
    for (let i = intype.string - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalstring, tmplocaloffset + i)); }
    //save all locals that callee want to reuse to stack
    for (let i = 0; i < localtype.int; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalint, i)); }
    for (let i = 0; i < localtype.long; i++) { opdata.push(makeop(namedClientScriptOps.pushlocallong, i)); }
    for (let i = 0; i < localtype.string; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalstring, i)); }
    //push the return address back to stack
    opdata.push(makeop(namedClientScriptOps.pushlocalint, returnaddrtemp));
    //move the args from temp to start of locals
    for (let i = 0; i < intype.int; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalint, tmplocaloffset + i), makeop(namedClientScriptOps.poplocalint, i)); }
    for (let i = 0; i < intype.long; i++) { opdata.push(makeop(namedClientScriptOps.pushlocallong, tmplocaloffset + i), makeop(namedClientScriptOps.poplocallong, i)); }
    for (let i = 0; i < intype.string; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalstring, tmplocaloffset + i), makeop(namedClientScriptOps.poplocalstring, i)); }
    //function body (same as with a root function)
    let funcbody = subfunc.func.getOpcodes(ctx);
    //replace all return ops into ops that jump to the end label (op itself is a nop)
    let endlabel = makeop(namedClientScriptOps.jump, 0);
    ctx.declareLabel(endlabel);
    funcbody.forEach((op, i) => {
        if (op.opcode == namedClientScriptOps.return) {
            funcbody[i] = makejump(endlabel);
        }
    });
    opdata.push(...tracerNops(`subfunc ${subfunc.func.scriptname} body`));
    let bodyindex = opdata.length;
    opdata.push(...funcbody);
    let footindex = opdata.length;
    opdata.push(endlabel);
    opdata.push(...tracerNops(`subfunc ${subfunc.func.scriptname} footer`));
    //move all return values from stack to tmp locals
    for (let i = outtype.int - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalint, tmplocaloffset + i)); }
    for (let i = outtype.long - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocallong, tmplocaloffset + i)); }
    for (let i = outtype.string - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalstring, tmplocaloffset + i)); }
    //move the return address from stack to tmp
    opdata.push(makeop(namedClientScriptOps.poplocalint, returnaddrtemp));
    //restore all caller locals that we used (in reverse order)
    for (let i = localtype.int - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalint, i)); }
    for (let i = localtype.long - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocallong, i)); }
    for (let i = localtype.string - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalstring, i)); }
    //move the return values from tmp locals to stack
    for (let i = 0; i < outtype.int; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalint, tmplocaloffset + i)); }
    for (let i = 0; i < outtype.long; i++) { opdata.push(makeop(namedClientScriptOps.pushlocallong, tmplocaloffset + i)); }
    for (let i = 0; i < outtype.string; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalstring, tmplocaloffset + i)); }
    //now jump to the jumptable that acts a dynamic jump (pops the return "address" from top of int stack)
    opdata.push(makeop(namedClientScriptOps.pushlocalint, returnaddrtemp));
    opdata.push(ctx.makeReturnOp());
    //thats it, simple
    opdata.push(...tracerNops(`subfunc ${subfunc.func.scriptname} end`));

    headerop.imm_obj = `${subfunclabel("subfunc", jumptarget - headerindex, opdata.length - headerindex, intype, outtype)} body=${bodyindex - headerindex} foot=${footindex - headerindex}`;

    return opdata;
}

function subfunclabel(type: string, entry: number, end: number, arg: StackDiff, returns: StackDiff) {
    return `type=${type} entry=${entry} end=${end} in=${arg.int},${arg.long},${arg.string} out=${returns.int},${returns.long},${returns.string}`;
}

function calcSwitchSize(switches: SwitchJumpTable[]) {
    //1+foreach(2+sublen*(4+4))
    return 1 + switches.reduce((a, v) => a + 2 + v.length * (4 + 4), 0);
}

export function astToImJson(calli: ClientscriptObfuscation, func: ClientScriptFunction) {
    let ctx = new OpcodeWriterContext(calli);
    let opdata: ClientScriptOp[] = [];
    let funcbody = func.getOpcodes(ctx);//this needs to run before the subfunc section because it defines the subfuncs

    let switches: clientscript["switches"] = [];
    let returnsitejumps: SwitchJumpTable = [];

    if (ctx.subfunctions.size != 0 || ctx.returnsites.size != 0) {
        let footerendlabel = makeop(namedClientScriptOps.jump, 0);
        ctx.declareLabel(footerendlabel);
        opdata.push(makejump(footerendlabel));

        //jump table
        opdata.push(makeop(namedClientScriptOps.pushconst, 2, subfunclabel("returnjumps", 1, 6, new StackDiff(1, 0, 0), new StackDiff())));
        opdata.push(ctx.makeReturnOp().imm_obj.value);
        opdata.push(makeop(namedClientScriptOps.switch, 0, { type: "switchvalues", value: returnsitejumps }))
        opdata.push(makeop(namedClientScriptOps.pushconst, 2, "unknown return address on stack (stack is corrupt)"));
        opdata.push(makeop(namedClientScriptOps.printmessage));
        opdata.push(makeop(namedClientScriptOps.return));

        for (let funcname of ctx.namedLabels.keys()) {
            let intr = intrinsics.get(funcname);
            if (intr) {
                let tagop = makeop(namedClientScriptOps.pushconst, 2);
                let startindex = opdata.length;
                opdata.push(tagop);
                opdata.push(ctx.getSubfunctionLabel(funcname));
                opdata.push(...intr.write(ctx));
                let intype = intr.in.getStackdiff();
                let outtype = intr.out.getStackdiff();
                tagop.imm_obj = `${subfunclabel("intrinsic", 1, opdata.length - startindex, intype, outtype)} name=${funcname}`;
            } else {
                let func = ctx.subfunctions.get(funcname);
                if (!func) { throw new Error(`func ${funcname} is not declared`); }
                if (func.func.isRawStack) {
                    opdata.push(...writeRawStackSubFunction(ctx, func));
                } else {
                    opdata.push(...writeSubFunction(ctx, func));
                }
            }
        }

        opdata.push(footerendlabel);
    }

    opdata.push(...funcbody);

    let allargs = func.argtype.getStackdiff();
    let localcounts = func.localCounts.clone().add(ctx.tempcounts);
    let script: clientscript = {
        byte0: 0,
        switchsize: -1,
        switches: switches,
        longargcount: allargs.long,
        stringargcount: allargs.string,
        intargcount: allargs.int,
        locallongcount: localcounts.long + ctx.tempcounts.long,
        localstringcount: localcounts.string + ctx.tempcounts.string,
        localintcount: localcounts.int + ctx.tempcounts.int,
        instructioncount: opdata.length,
        opcodedata: opdata as clientscript["opcodedata"],
    }
    let labelmap = ctx.labels;
    for (let index = 0; index < opdata.length; index++) {
        let op = opdata[index];
        if (labelmap.get(op) !== undefined) { labelmap.set(op, index); }
    }
    for (let index = 0; index < opdata.length; index++) {
        let op = opdata[index];
        if (typeof op.imm_obj == "object" && op.imm_obj && !Array.isArray(op.imm_obj)) {
            if (op.imm_obj.type == "switchvalues") {
                op.imm = script.switches.push(op.imm_obj.value) - 1;
            } else if (op.imm_obj.type == "jumplabel") {
                let target = labelmap.get(op.imm_obj.value);
                if (typeof target != "number" || target == -1) { throw new Error("label not found"); }
                op.imm = target - (index + 1);
            }
            op.imm_obj = null;
        }
        //reallocate tmp locals to the end of normal locals
        if (pushOrPopLocalOps.includes(op.opcode)) {
            if (op.imm & tmplocaloffset) {
                if (op.opcode == namedClientScriptOps.pushlocalint || op.opcode == namedClientScriptOps.poplocalint || op.opcode == namedClientScriptOps.popdiscardint) {
                    op.imm = func.localCounts.int + (op.imm & 0xffff);
                }
                if (op.opcode == namedClientScriptOps.pushlocallong || op.opcode == namedClientScriptOps.poplocallong || op.opcode == namedClientScriptOps.popdiscardlong) {
                    op.imm = func.localCounts.long + (op.imm & 0xffff);
                }
                if (op.opcode == namedClientScriptOps.pushlocalstring || op.opcode == namedClientScriptOps.poplocalstring || op.opcode == namedClientScriptOps.popdiscardstring) {
                    op.imm = func.localCounts.string + (op.imm & 0xffff);
                }
            }
        }
    }
    if (ctx.returnsites.size != 0) {
        let switchbaseaddress = labelmap.get(ctx.makeReturnOp().imm_obj.value);
        if (typeof switchbaseaddress != "number") { throw new Error("dynamicjump section not found"); }
        switchbaseaddress += 2;//skip label nop+switch
        for (let [label, targetop] of ctx.returnsites) {
            let target = labelmap.get(targetop);
            if (target == undefined) { throw new Error("dynamicjump return address not found"); }
            returnsitejumps.push({ jump: target - switchbaseaddress, value: label });
        }
    }
    script.switchsize = calcSwitchSize(script.switches);
    if (script.switchsize > 0xffff) {
        throw new Error(`compiled script switch table size is larger than 65kb, this isn't supported by the binary format. This corresponds to a max of ~8k branches accross all switch statements, actual number: ${script.switches.reduce((a, v) => a + v.length, 0)}`);
    }
    if (script.opcodedata.length > 0xffff) {
        throw new Error(`compiled script is longer than max length of 0xffff, the Jagex VM will parse it incorrectly, actual length (${script.opcodedata.length})`);
    }
    return script;
}


export function mergeScriptJsons(script1: clientscript, script2: clientscript, secret: number) {
    if (script1.intargcount != script2.intargcount) { throw new Error("int arg counts need to be equal"); }
    if (script1.longargcount != script2.longargcount) { throw new Error("long arg counts need to be equal"); }
    if (script1.stringargcount != script2.stringargcount) { throw new Error("string arg counts need to be equal"); }

    let switches = [...script1.switches, ...script2.switches];

    let opcodes: clientscript["opcodedata"] = [
        { opcode: namedClientScriptOps.pushconst, imm: 2, imm_obj: `` },
        { opcode: namedClientScriptOps.popdiscardstring, imm: 0, imm_obj: null },
        { opcode: namedClientScriptOps.pushlocalint, imm: 0, imm_obj: null },
        { opcode: namedClientScriptOps.pushconst, imm: 0, imm_obj: secret },
        { opcode: namedClientScriptOps.branch_not, imm: script1.opcodedata.length, imm_obj: null },
        ...script1.opcodedata,
        ...script2.opcodedata.map(q => q.opcode == namedClientScriptOps.switch ? { ...q, imm: q.imm + script1.switches.length } : q)
    ];

    let res: clientscript = {
        byte0: script1.byte0,
        intargcount: script1.intargcount,
        longargcount: script1.longargcount,
        stringargcount: script1.stringargcount,
        instructioncount: opcodes.length,
        localintcount: Math.max(script1.localintcount),
        locallongcount: Math.max(script1.locallongcount),
        localstringcount: Math.max(script1.localstringcount),
        opcodedata: opcodes,
        switches: switches,
        switchsize: calcSwitchSize(switches)
    };
    return res;
}