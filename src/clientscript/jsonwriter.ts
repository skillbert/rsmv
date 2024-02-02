import { clientscript } from "../../generated/clientscript";
import { getOrInsert } from "../utils";
import { AstNode, ClientScriptFunction } from "./ast";
import { ClientscriptObfuscation } from "./callibrator";
import { branchInstructionsOrJump, namedClientScriptOps, StackDiff, ClientScriptOp, getOpName, makeop, pushOrPopLocalOps, makejump, SwitchJumpTable, StackList } from "./definitions";

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
            let name = getOpName(id);
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
        body.push(makeop(namedClientScriptOps.pushconst, 0, -1));
        body.push(endlabel);
        //subreturn
        body.push(makeop(namedClientScriptOps.poplocalint, tmplocaloffset + 0));
        body.push(ctx.makeReturnOp());
        return body;
    }
});

intrinsics.set("call", {
    in: new StackList(["int"]),
    out: new StackList(),
    write(ctx: OpcodeWriterContext) {
        let body: ClientScriptOp[] = [];
        let jumptable: SwitchJumpTable = [];
        let jumpstart = body.length;

        //btree,returnaddr
        ctx.tempcounts.int = Math.max(ctx.tempcounts.int, 2);
        body.push(makeop(namedClientScriptOps.poplocalint, tmplocaloffset + 1));

        let endlabel = makeop(namedClientScriptOps.jump, 0);
        ctx.declareLabel(endlabel);

        //default case
        body.push(makeop(namedClientScriptOps.pushconst, 2, "no script matched"));
        body.push(makeop(namedClientScriptOps.printmessage));
        body.push(makejump(endlabel));

        //find last known script id and round to next 1k, with at least 1k padding
        let maxscriptid = 0;
        for (let id of ctx.calli.scriptargs.keys()) { maxscriptid = Math.max(maxscriptid, id); }
        maxscriptid = maxscriptid - (maxscriptid % 1000) + 2000;
        for (let id = 0; id < maxscriptid; id++) {
            let opid = +id;
            jumptable.push({ value: opid, jump: body.length - jumpstart });
            body.push(makeop(namedClientScriptOps.gosub, id));
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
});

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

intrinsics.set("getvar", {
    in: new StackList(["int"]),
    out: new StackList(["int"]),
    write(ctx: OpcodeWriterContext) {
        const tagetid = 0;
        let body: ClientScriptOp[] = [];

        //store return addr to tmp0
        ctx.tempcounts.int = Math.max(ctx.tempcounts.int, 1);
        body.push(makeop(namedClientScriptOps.poplocalint, tmplocaloffset + 0));

        let jumptable: SwitchJumpTable = [];
        let switchop = makeop(namedClientScriptOps.switch, 0, { type: "switchvalues", value: jumptable });
        body.push(switchop);
        let jumpstart = body.length;

        let endlabel = makeop(namedClientScriptOps.jump, 0);
        ctx.declareLabel(endlabel);

        //default case
        body.push(makeop(namedClientScriptOps.pushconst, 2, "no opcodes matched"));
        body.push(makeop(namedClientScriptOps.printmessage));
        body.push(makejump(endlabel));

        for (let [groupid, group] of ctx.calli.varmeta) {
            for (let [varid, varmeta] of group.vars) {
                let value = (varid << 8) || (groupid << 24) | tagetid;
                jumptable.push({ value: value, jump: body.length - jumpstart });
                body.push({ opcode: namedClientScriptOps.popvar, imm: value, imm_obj: null });
                body.push(makejump(endlabel));
            }
        }

        body.push(endlabel);
        //subreturn
        body.push(makeop(namedClientScriptOps.pushlocalint, tmplocaloffset + 0));
        body.push(ctx.makeReturnOp());
        return body;
    }
});

function jumptableToBTree(table: SwitchJumpTable, tmpintlocal: number) {
    table.sort((a, b) => a.value - b.value);

    let body: ClientScriptOp[] = [];
    body.push(makeop(namedClientScriptOps.poplocalint, tmpintlocal));
    let branch = (start: number, end: number) => {
        let len = end - start;
        if (len < 8) {
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
            let branchop = makeop(namedClientScriptOps.branch_lt, 0);
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
            op.imm += body.length - i;
        }
    }
    return body;
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
    for (let i = 0; i < outtype.int; i++) { opdata.push(makeop(namedClientScriptOps.poplocalint, tmplocaloffset + i)); }
    for (let i = 0; i < outtype.long; i++) { opdata.push(makeop(namedClientScriptOps.poplocallong, tmplocaloffset + i)); }
    for (let i = 0; i < outtype.string; i++) { opdata.push(makeop(namedClientScriptOps.poplocalstring, tmplocaloffset + i)); }
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
                opdata.push(...writeSubFunction(ctx, func));
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
                if (op.opcode == namedClientScriptOps.pushlocalint || op.opcode == namedClientScriptOps.poplocalint) { op.imm = func.localCounts.int + (op.imm & 0xffff); }
                if (op.opcode == namedClientScriptOps.pushlocallong || op.opcode == namedClientScriptOps.poplocallong) { op.imm = func.localCounts.long + (op.imm & 0xffff); }
                if (op.opcode == namedClientScriptOps.pushlocalstring || op.opcode == namedClientScriptOps.poplocalstring) { op.imm = func.localCounts.string + (op.imm & 0xffff); }
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
    //1+foreach(2+sublen*(4+4))
    script.switchsize = 1 + script.switches.reduce((a, v) => a + 2 + v.length * (4 + 4), 0);
    return script;
}
