import { clientscript } from "../../generated/clientscript";
import { clientscriptdata } from "../../generated/clientscriptdata";
import { getOrInsert } from "../utils";
import { ClientscriptObfuscation, OpcodeInfo, getArgType, getReturnType } from "./callibrator";
import { debugAst } from "./codewriter";
import { branchInstructions, branchInstructionsOrJump, dynamicOps, typeToPrimitive, namedClientScriptOps, variableSources, StackDiff, StackInOut, StackList, StackTypeExt, ClientScriptOp, StackConst, StackType, StackConstants, getParamOps, subtypes, branchInstructionsInt, branchInstructionsLong, ExactStack, dependencyGroup, dependencyIndex, typeuuids, getOpName, makeop } from "./definitions";
import { ClientScriptSubtypeSolver } from "./subtypedetector";

/**
 * known issues
 * - If all branches (and default) of a switch statement return, then the last branch is emptied and its contents are placed after the end of the block (technically still correct)
 *   - has to do with the way the branching detection works (AstNode.findNext)
 * - some op arguments still not figured out
 * - none of this is tested for older builds
 *   - probably breaks at the build where pushconst ops were merged (~700?)
 */

export function getSingleChild<T extends AstNode>(op: AstNode | null | undefined, type: { new(...args: any[]): T }) {
    if (!op || op.children.length != 1 || !(op.children[0] instanceof type)) { return null; }
    return op.children[0] as T;
}

export function isNamedOp(op: AstNode, id: number): op is RawOpcodeNode {
    return op instanceof RawOpcodeNode && op.op.opcode == id;
}

function tracerNops(text: string) {
    return [
        makeop(namedClientScriptOps.pushconst, 2, text),
        makeop(10983)// POP_STRING_DISCARD
    ]
}

class OpcodeWriterContext {
    calli: ClientscriptObfuscation;
    labels = new Map<ClientScriptOp, number>();
    namedLabels = new Map<string, ClientScriptOp>();
    subfunctions = new Map<string, { label: ClientScriptOp, func: ClientScriptFunction }>();
    returnsites = new Map<number, ClientScriptOp>();
    returnsiteidcounter = 1;
    constructor(calli: ClientscriptObfuscation) {
        this.calli = calli;
    }
    getNamedLabel(name: string) {
        return getOrInsert(this.namedLabels, name, () => {
            let label: ClientScriptOp = makeop(namedClientScriptOps.jump, 0);
            this.declareLabel(label);
            return label;
        });
    }
    makeSubCallOps(func: ClientScriptFunction, args: AstNode[]) {
        let returnid = this.returnsiteidcounter++;
        let target = this.subfunctions.get(func.scriptname);
        if (!target) { throw new Error("subcall func does not exist"); }
        let body: ClientScriptOp[] = [];
        let labelobj = this.getNamedLabel(func.scriptname);
        body.push(...args.flatMap(q => q.getOpcodes(this)))
        body.push(makeop(namedClientScriptOps.pushconst, 0, returnid));
        body.push(makeop(namedClientScriptOps.jump, 0, { type: "jumplabel", value: labelobj }));
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
        let label = this.getNamedLabel(func.scriptname);
        this.subfunctions.set(func.scriptname, { label, func });
    }
}

export abstract class AstNode {
    parent: AstNode | null = null;
    knownStackDiff: StackInOut | null = null;
    children: AstNode[] = [];
    originalindex: number;
    constructor(originalindex: number) {
        this.originalindex = originalindex;
    }
    abstract getOpcodes(ctx: OpcodeWriterContext): ClientScriptOp[];
    pushList(nodes: AstNode[]) {
        for (let node of nodes) {
            if (node.parent == this) { continue; }
            node.parent = null;//prevents parent array shuffle
            this.push(node);
        }
    }
    push(node: AstNode) {
        if (node == this) { throw new Error("tried to add self to ast children"); }
        node.parent?.remove(node);
        this.children.push(node);
        node.parent = this;
    }
    clear() {
        this.children.forEach(q => q.parent = null);
        this.children.length = 0;
    }
    unshift(node: AstNode) {
        node.parent?.remove(node);
        this.children.unshift(node);
        node.parent = this;
    }
    replaceChild(oldnode: AstNode, newnode: AstNode) {
        if (newnode == this) { throw new Error("tried to add self to ast children"); }
        newnode.parent?.remove(newnode);
        let index = this.children.indexOf(oldnode);
        if (index == -1) { throw new Error("tried to replace node that isn't a child"); }
        newnode.parent = this;
        oldnode.parent = null;
        this.children[index] = newnode;
    }
    remove(node: AstNode) {
        let index = this.children.indexOf(node);
        if (index == -1) { throw new Error("tried to remove node that isn't a child"); }
        this.children.splice(index, 1);
        node.parent = null;
    }
}

export class SubcallNode extends AstNode {
    func: ClientScriptFunction;
    constructor(originalindex: number, func: ClientScriptFunction) {
        super(originalindex);
        this.func = func;
    }
    getOpcodes(ctx: OpcodeWriterContext) {
        return ctx.makeSubCallOps(this.func, this.children);
    }
}

export type ComposedopType = "++x" | "--x" | "x++" | "x--";
export class ComposedOp extends AstNode {
    type: ComposedopType;
    internalOps: AstNode[] = [];
    constructor(originalindex: number, type: ComposedopType) {
        super(originalindex);
        this.type = type;
    }
    getOpcodes(ctx: OpcodeWriterContext) {
        if (this.children.length != 0) { throw new Error("no children expected on composednode"); }
        return this.internalOps.flatMap(q => q.getOpcodes(ctx));
    }
}

export class IntrinsicNode extends AstNode {
    type: "$callopid" | "$getopid";
    constructor(type: IntrinsicNode["type"]) {
        super(-1);
        this.type = type;
    }
    static fromString(name: string, args: AstNode[]) {
        if (name != "$callopid" && name != "$getopid") {
            throw new Error(`unknown intrinsic ${name}`);
        }
        let res = new IntrinsicNode(name);
        res.pushList(args);
        return res;
    }

    getOpcodes(ctx: OpcodeWriterContext) {
        let body: ClientScriptOp[] = [];
        if (this.type == "$callopid") {
            let switchop: ClientScriptOp = { opcode: namedClientScriptOps.switch, imm: -1, imm_obj: null };
            let defaultjmp: ClientScriptOp = { opcode: namedClientScriptOps.jump, imm: -1, imm_obj: null };
            body.push(switchop);//TODO switch map id
            let jumpstart = body.length;
            body.push(defaultjmp);

            let endops: ClientScriptOp[] = [];
            let jumptable: ClientScriptOp["imm_obj"] = { type: "switchvalues", value: [] };
            for (let id of ctx.calli.decodedMappings.keys()) {
                let opid = +id;
                if (branchInstructionsOrJump.includes(opid)) { continue; }
                if (opid == namedClientScriptOps.switch) { continue; }
                if (opid == namedClientScriptOps.return) { continue; }
                if (opid == namedClientScriptOps.pushconst) { continue; }
                jumptable.value.push({ value: opid, label: body.length - jumpstart });
                body.push({ opcode: opid, imm: 0, imm_obj: null });
                let jmp: ClientScriptOp = { opcode: namedClientScriptOps.jump, imm: -1, imm_obj: null };
                body.push(jmp);
                endops.push(jmp);
            }

            defaultjmp.imm = body.length - body.indexOf(defaultjmp) - 1;
            let jmp: ClientScriptOp = { opcode: namedClientScriptOps.jump, imm: -1, imm_obj: null };
            body.push(jmp);
            endops.push(jmp);

            //make all jump point to the end now we know the length
            for (let op of endops) {
                let index = body.indexOf(op);
                op.imm = body.length - index - 1;
            }

            switchop.imm_obj = jumptable;
        } else if (this.type == "$getopid") {
            //pop arg0 to string0
            body.push({ opcode: namedClientScriptOps.poplocalstring, imm: 0, imm_obj: null });
            for (let [id, opinfo] of ctx.calli.decodedMappings) {
                let name = getOpName(id);
                //strcomp(opname,string0)==0
                body.push({ opcode: namedClientScriptOps.pushconst, imm: 2, imm_obj: name });
                body.push({ opcode: namedClientScriptOps.pushlocalstring, imm: 0, imm_obj: null });
                body.push({ opcode: namedClientScriptOps.strcmp, imm: 0, imm_obj: null });
                body.push({ opcode: namedClientScriptOps.pushconst, imm: 0, imm_obj: 0 });
                body.push({ opcode: namedClientScriptOps.branch_eq, imm: 1, imm_obj: 0 });
                //jump over
                body.push({ opcode: namedClientScriptOps.jump, imm: 2, imm_obj: 0 });
                //return id
                body.push({ opcode: namedClientScriptOps.pushconst, imm: 0, imm_obj: +id });
                body.push({ opcode: namedClientScriptOps.return, imm: 0, imm_obj: null });
            }
            body.push({ opcode: namedClientScriptOps.pushconst, imm: 0, imm_obj: -1 });
            body.push({ opcode: namedClientScriptOps.return, imm: 0, imm_obj: null });
        }
        return body;
    }
}

export class VarAssignNode extends AstNode {
    varops: RawOpcodeNode[] = [];
    knownStackDiff = new StackInOut(new StackList(), new StackList());
    getOpcodes(ctx: OpcodeWriterContext) {
        let res = this.children.flatMap(q => q.getOpcodes(ctx));
        return res.concat(this.varops.flatMap(q => q.getOpcodes(ctx)).reverse());
    }
    addVar(node: RawOpcodeNode) {
        this.varops.unshift(node);
        this.knownStackDiff.in.push(getNodeStackIn(node));
    }
}

export class CodeBlockNode extends AstNode {
    scriptid: number;
    possibleSuccessors: CodeBlockNode[] = [];
    firstPointer: CodeBlockNode | null = null;
    lastPointer: CodeBlockNode | null = null;
    branchEndNode: CodeBlockNode | null = null;
    maxEndIndex = -1;

    knownStackDiff = new StackInOut(new StackList(), new StackList());
    constructor(scriptid: number, startindex: number, children?: AstNode[]) {
        super(startindex);
        this.scriptid = scriptid;
        if (children) {
            this.pushList(children);
        }
    }
    addSuccessor(block: CodeBlockNode) {
        if (this.originalindex < block.originalindex && (!block.firstPointer || this.originalindex < block.firstPointer.originalindex)) {
            block.firstPointer = this;
        }
        if (this.originalindex > block.originalindex && (!block.lastPointer || this.originalindex > block.lastPointer.originalindex)) {
            block.lastPointer = this;
            block.maxEndIndex = this.originalindex;
        }
        //successors are required to be duplicate when there is a 0 jump branch
        // if (this.possibleSuccessors.includes(block)) { throw new Error("added same successor twice"); }
        if (!block) { throw new Error("added null successor"); }
        this.possibleSuccessors.push(block);
    }
    mergeBlock(block: CodeBlockNode, flatten: boolean) {
        if (flatten) {
            this.pushList(block.children);
            block.children.length = 0;
        } else {
            this.push(block);
        }
        this.possibleSuccessors = block.possibleSuccessors;
        this.branchEndNode = block.branchEndNode;
    }
    findNext() {
        if (!this.branchEndNode) {
            if (this.possibleSuccessors.length == 0) {
                this.branchEndNode = null;
            } else if (this.possibleSuccessors.length == 1) {
                if (this.possibleSuccessors[0].originalindex < this.originalindex) {
                    this.branchEndNode = null;//looping jump
                } else {
                    this.branchEndNode = this.possibleSuccessors[0];
                }
            } else {
                let optionstates = this.possibleSuccessors.slice() as (CodeBlockNode | null)[];
                while (true) {
                    let first: CodeBlockNode | null = null;
                    for (let op of optionstates) {
                        if (op && (first == null || op.originalindex < first.originalindex)) {
                            first = op;
                        }
                    }
                    if (!first) {
                        this.branchEndNode = null;
                        break;
                    }
                    if (optionstates.every(q => !q || q == first)) {
                        this.branchEndNode = first;
                        break;
                    }
                    optionstates[optionstates.indexOf(first)] = first.findNext();
                }
            }
        }
        return this.branchEndNode;
    }
    getOpcodes(ctx: OpcodeWriterContext) {
        return this.children.flatMap(q => {
            if (q instanceof ClientScriptFunction) {
                ctx.addSubfunction(q);
                return [];
            } else {
                return q.getOpcodes(ctx);
            }
        });
    }
    dump() {
        debugAst(this);
    }
}

function retargetJumps(ctx: OpcodeWriterContext, code: ClientScriptOp[], from: number, to: number) {
    let lastop = code.at(-1);
    let insertedcount = 0;
    if (lastop && lastop.opcode != namedClientScriptOps.jump && from == 0) {
        //insert jump op here
        let jumpop = ctx.calli.getNamedOp(namedClientScriptOps.jump);
        code.push({ opcode: jumpop.id, imm: to - 1, imm_obj: null });
        insertedcount++;
    }
    for (let index = 0; index < code.length; index++) {
        let op = code[index];
        if (branchInstructionsOrJump.includes(op.opcode)) {
            let target = index + 1 + op.imm;
            if (target >= code.length - insertedcount) {
                target += insertedcount;
            }
            if (target == code.length + from) {
                target = code.length + to;
            }
            op.imm = target - index - 1;
        }
    }
}

export class BranchingStatement extends AstNode {
    op: ClientScriptOp;
    knownStackDiff = new StackInOut(new StackList(["int", "int"]), new StackList(["int"]));//TODO not correct, we also use this for longs
    constructor(opcodeinfo: ClientScriptOp, originalindex: number) {
        super(originalindex);
        this.op = opcodeinfo;
    }

    getOpcodes(ctx: OpcodeWriterContext) {
        if (this.op.opcode == namedClientScriptOps.shorting_or || this.op.opcode == namedClientScriptOps.shorting_and) {
            if (this.children.length != 2) { throw new Error("unexpected"); }
            let left = this.children[0].getOpcodes(ctx);
            let right = this.children[1].getOpcodes(ctx);
            if (this.op.opcode == namedClientScriptOps.shorting_or) {
                //retarget true jumps to true outcome of combined statement
                retargetJumps(ctx, left, 1, right.length + 1);
                //index 0 [false] will already point to start of right condition
            } else {
                //retarget the false jumps to one past end [false] of combined statement
                retargetJumps(ctx, left, 0, right.length);
                //retarget true jumps to start of right statement
                retargetJumps(ctx, left, 1, 0);
            }
            return [...left, ...right];
        }
        let op: ClientScriptOp = { opcode: this.op.opcode, imm: 1, imm_obj: null };
        return this.children.flatMap(q => q.getOpcodes(ctx)).concat(op);
    }
}

export class WhileLoopStatementNode extends AstNode {
    statement: AstNode;
    body: CodeBlockNode;
    knownStackDiff = new StackInOut(new StackList(), new StackList());
    constructor(originalindex: number, statement: AstNode, body: CodeBlockNode) {
        super(originalindex);
        this.statement = statement;
        this.body = body;
        this.push(statement);
        this.push(body);
    }
    static fromIfStatement(originalindex: number, originnode: IfStatementNode) {
        if (originnode.falsebranch) { throw new Error("cannot have else branch in loop"); }
        if (!originnode.parent) { throw new Error("unexpected"); }
        return new WhileLoopStatementNode(originalindex, originnode.statement, originnode.truebranch);
    }
    getOpcodes(ctx: OpcodeWriterContext) {
        let cond = this.statement.getOpcodes(ctx);
        let body = this.body.getOpcodes(ctx);
        let jump = ctx.calli.getNamedOp(namedClientScriptOps.jump);
        cond.push({ opcode: jump.id, imm: body.length + 1, imm_obj: null });
        body.push({ opcode: jump.id, imm: -(body.length + 1 + cond.length), imm_obj: null });
        return [...cond, ...body];
    }
}

export class SwitchStatementNode extends AstNode {
    branches: { value: number, block: CodeBlockNode }[] = [];
    valueop: AstNode | null;
    defaultbranch: CodeBlockNode | null = null;
    knownStackDiff = new StackInOut(new StackList(["int"]), new StackList());
    constructor(originalindex: number, valueop: AstNode | null, defaultnode: CodeBlockNode | null, branches: { value: number, block: CodeBlockNode }[]) {
        super(originalindex);
        this.valueop = valueop;
        this.defaultbranch = defaultnode;
        this.branches = branches;
        if (valueop) {
            this.push(valueop);
        }
        this.pushList(branches.map(q => q.block));
        if (defaultnode) {
            this.push(defaultnode);
        }
    }
    static create(switchop: RawOpcodeNode, scriptjson: clientscript, nodes: CodeBlockNode[], endindex: number) {
        let valueop: AstNode | null = switchop.children[0] ?? null;
        let branches: { value: number, block: CodeBlockNode }[] = [];

        let cases = scriptjson.switches[switchop.op.imm];
        if (!cases) { throw new Error("no matching cases in script"); }
        for (let casev of cases) {
            //TODO multiple values can point to the same case
            let node = nodes.find(q => q.originalindex == switchop.originalindex + 1 + casev.label);
            if (!node) { throw new Error("switch case branch not found"); }
            branches.push({ value: casev.value, block: node });
            node.maxEndIndex = endindex;
            if (node.originalindex != switchop.originalindex + 1 + casev.label) {
                throw new Error("switch branches don't match");
            }
        }

        let defaultblock: CodeBlockNode | null = nodes.find(q => q.originalindex == switchop.originalindex + 1) ?? null;
        let defaultblockjump = getSingleChild(defaultblock, RawOpcodeNode);
        if (defaultblock && defaultblockjump && defaultblockjump.opinfo.id == namedClientScriptOps.jump) {
            if (defaultblock.possibleSuccessors.length != 1) { throw new Error("jump successor branch expected"); }
            defaultblock = defaultblock.possibleSuccessors[0];
            if (defaultblock.originalindex == endindex) {
                defaultblock = null;
            }
        }

        if (defaultblock) {
            defaultblock.maxEndIndex = endindex;
        }
        return new SwitchStatementNode(switchop.originalindex, valueop, defaultblock, branches);
    }
    getOpcodes(ctx: OpcodeWriterContext) {
        let body: ClientScriptOp[] = [];
        if (this.valueop) { body.push(...this.valueop.getOpcodes(ctx)); }
        let jump = ctx.calli.getNamedOp(namedClientScriptOps.jump);
        let switchopinfo = ctx.calli.getNamedOp(namedClientScriptOps.switch);
        let switchop: ClientScriptOp = { opcode: switchopinfo.id, imm: -1, imm_obj: null };
        let defaultjmp: ClientScriptOp = { opcode: jump.id, imm: -1, imm_obj: null };
        body.push(switchop);//TODO switch map id
        let jumpstart = body.length;
        body.push(defaultjmp);

        let endops: ClientScriptOp[] = [];

        let jumptable: ClientScriptOp["imm_obj"] = { type: "switchvalues", value: [] };
        let lastblock: CodeBlockNode | null = null;
        let lastblockindex = 0;
        for (let i = 0; i < this.branches.length; i++) {
            let branch = this.branches[i];
            //add a jump so the previous branch skips to end (and last branch doesn't)
            if (branch.block == lastblock) {
                jumptable.value.push({ value: branch.value, label: lastblockindex });
                continue;
            }
            if (lastblock) {
                let jmp: ClientScriptOp = { opcode: jump.id, imm: -1, imm_obj: null };
                body.push(jmp);
                endops.push(jmp);
            }
            lastblock = branch.block;
            lastblockindex = body.length - jumpstart;
            jumptable.value.push({ value: branch.value, label: lastblockindex });
            body.push(...branch.block.getOpcodes(ctx));
        }

        if (this.defaultbranch) {
            if (lastblock) {
                let jmp: ClientScriptOp = { opcode: jump.id, imm: -1, imm_obj: null };
                body.push(jmp);
                endops.push(jmp);
            }

            defaultjmp.imm = body.length - body.indexOf(defaultjmp) - 1;
            body.push(...this.defaultbranch.getOpcodes(ctx));
        } else {
            endops.push(defaultjmp);
        }

        //make all jump point to the end now we know the length
        for (let op of endops) {
            let index = body.indexOf(op);
            op.imm = body.length - index - 1;
        }

        switchop.imm_obj = jumptable;

        return body;
    }
}

export class IfStatementNode extends AstNode {
    truebranch!: CodeBlockNode;
    falsebranch!: CodeBlockNode | null;
    statement!: AstNode;
    knownStackDiff = new StackInOut(new StackList(["int"]), new StackList());
    ifEndIndex!: number;
    constructor(originalindex: number) {
        super(originalindex);
    }
    setBranches(statement: AstNode, truebranch: CodeBlockNode, falsebranch: CodeBlockNode | null, endindex: number) {
        if (truebranch == falsebranch) { throw new Error("unexpected"); }
        this.ifEndIndex = endindex;
        //statement
        this.statement = statement;
        this.push(statement);

        //true
        this.truebranch = truebranch;
        truebranch.maxEndIndex = this.ifEndIndex;

        //false
        this.falsebranch = falsebranch;
        if (falsebranch) {
            falsebranch.maxEndIndex = this.ifEndIndex;
        }

        //need the children in the original order to make sure && and || merges correctly
        if (falsebranch && falsebranch.originalindex < truebranch.originalindex) {
            this.push(falsebranch);
        }
        this.push(truebranch);
        if (falsebranch && falsebranch.originalindex >= truebranch.originalindex) {
            this.push(falsebranch);
        }
    }
    getOpcodes(ctx: OpcodeWriterContext) {
        let cond = this.statement.getOpcodes(ctx);
        let truebranch = this.truebranch.getOpcodes(ctx);
        let falsebranch: ClientScriptOp[] = [];
        if (this.falsebranch) {
            falsebranch = this.falsebranch.getOpcodes(ctx);
            truebranch.push({ opcode: ctx.calli.getNamedOp(namedClientScriptOps.jump).id, imm: falsebranch.length, imm_obj: null });
            // retargetJumps(calli, truebranch, 0, falsebranch.length)
        }
        //TODO rerouting true jumps past 2 in order to switch them with false at 1, this is stupid
        retargetJumps(ctx, cond, 0, truebranch.length == 1 ? 2 : truebranch.length);
        retargetJumps(ctx, cond, 1, 0);
        if (truebranch.length == 1) { retargetJumps(ctx, cond, 2, 1); }
        return [...cond, ...truebranch, ...falsebranch];
    }
}

export class FunctionBindNode extends AstNode {
    constructor(originalindex: number, types: StackList) {
        super(originalindex);
        let intype = types.clone();
        intype.values.unshift("int");//function id
        this.knownStackDiff = new StackInOut(intype, new StackList(["int", "vararg"]));
    }
    getOpcodes(ctx: OpcodeWriterContext) {
        let scriptid = this.children[0]?.knownStackDiff?.constout ?? -1;
        if (typeof scriptid != "number") { throw new Error("unexpected"); }
        let typestring = "";
        if (scriptid != -1) {
            let func = ctx.calli.scriptargs.get(scriptid);
            if (!func) { throw new Error("unknown functionbind types"); }
            typestring = func.stack.in.toFunctionBindString();
        }
        let ops = this.children.flatMap(q => q.getOpcodes(ctx)).concat();
        ops.push({ opcode: namedClientScriptOps.pushconst, imm: 2, imm_obj: typestring });
        return ops;
    }
}

export class RawOpcodeNode extends AstNode {
    op: ClientScriptOp;
    opinfo: OpcodeInfo;
    unknownstack = false;//multiple possible explanations for stack usage
    constructor(index: number, op: ClientScriptOp, opinfo: OpcodeInfo) {
        super(index);
        this.op = op;
        this.opinfo = opinfo;
    }
    getOpcodes(ctx: OpcodeWriterContext) {
        let body = this.children.flatMap(q => q.getOpcodes(ctx));
        body.push({ ...this.op });
        return body;
    }
}

class RewriteCursor {
    rootnode: AstNode;
    cursorStack: AstNode[] = [];
    stalled = true;
    constructor(node: AstNode) {
        this.rootnode = node;
    }
    current() {
        return this.cursorStack.at(-1) ?? null;
    }
    setFirstChild(target: AstNode, stall = false) {
        this.stalled = stall;
        if (target != this.cursorStack.at(-1)) {
            this.cursorStack.push(target);
        }
        while (target.children.length != 0) {
            target = target.children[0];
            this.cursorStack.push(target);
        }
        return this.cursorStack.at(-1) ?? null;
    }
    remove() {
        let node = this.current();
        let newcurrent = this.prev();
        if (!node) { throw new Error("no node selected"); }
        if (!node.parent) { throw new Error("cannot remove root node"); }
        node.parent.remove(node);
        return newcurrent;
    }
    rebuildStack() {
        let current = this.current();
        this.cursorStack.length = 0;
        for (let node = current; node; node = node.parent) {
            this.cursorStack.unshift(node);
        }
    }
    replaceNode(newnode: AstNode) {
        let node = this.current();
        if (!node) { throw new Error("no node selected"); }
        if (!node.parent) { throw new Error("cannot replace root node"); }
        node.parent.replaceChild(node, newnode);
        this.cursorStack[this.cursorStack.length - 1] = newnode;
        return newnode;
    }
    next() {
        if (this.stalled) {
            this.stalled = false;
            //stalled at null==space before start
            if (this.cursorStack.length == 0) {
                this.goToStart();
            }
            return this.current();
        }
        let currentnode = this.cursorStack.at(-1);
        let parentnode = this.cursorStack.at(-2);
        if (!currentnode) { return null; }
        this.cursorStack.pop();
        if (!parentnode) { return null; }

        let index = parentnode.children.indexOf(currentnode);
        if (index == parentnode.children.length - 1) {
            return parentnode;
        }
        let newnode = parentnode.children[index + 1];
        return this.setFirstChild(newnode);
    }
    prev() {
        if (this.stalled) {
            this.stalled = false;
            return this.current();
        }
        let currentnode = this.cursorStack.at(-1);
        let parentnode = this.cursorStack.at(-2);
        if (!currentnode) { return null; }
        if (currentnode.children.length != 0) {
            let newnode = currentnode.children.at(-1)!;
            this.cursorStack.push(newnode);
            return newnode;
        }
        this.cursorStack.pop();
        if (!parentnode) {
            this.stalled = true;
            return null;
        }

        let index = parentnode.children.indexOf(currentnode);
        if (index == 0) {
            return this.prev();
        }
        let newnode = parentnode.children[index - 1];
        this.cursorStack.push(newnode);
        return newnode;
    }
    setNextNode(node: AstNode) {
        this.stalled = true;
        this.cursorStack.length = 0;
        for (let current: AstNode | null = node; current; current = current.parent) {
            this.cursorStack.unshift(current);
        }
    }
    goToStart() {
        this.stalled = false;
        this.cursorStack.length = 0;
        return this.setFirstChild(this.rootnode);
    }
    goToEnd() {
        this.stalled = false;
        this.cursorStack.length = 0;
        return null;
    }
}

export function getNodeStackOut(node: AstNode) {
    if (node.knownStackDiff) {
        return node.knownStackDiff.out;
    }
    if (node instanceof RawOpcodeNode && node.opinfo.stackinfo) {
        return node.opinfo.stackinfo.out;
    }
    console.log("unknown stack out");
    return new StackList();
}

export function getNodeStackIn(node: AstNode) {
    if (node.knownStackDiff) {
        return node.knownStackDiff.in;
    }
    if (node instanceof RawOpcodeNode && node.opinfo.stackinfo) {
        return node.opinfo.stackinfo.in;
    }
    console.log("unknown stack in");
    return new StackList();
}

export function translateAst(ast: CodeBlockNode) {
    let cursor = new RewriteCursor(ast);

    //detect x++ and variants
    for (let i = 0; i < ast.children.length - 3; i++) {
        let prepushx = ast.children[i - 1];
        let pushx = ast.children[i];
        let push1 = ast.children[i + 1];
        let plusminus = ast.children[i + 2];
        let popx = ast.children[i + 3];
        let postpushx = ast.children[i + 4];
        if (
            isNamedOp(pushx, namedClientScriptOps.pushlocalint) &&
            isNamedOp(push1, namedClientScriptOps.pushconst) &&
            (isNamedOp(plusminus, namedClientScriptOps.plus) || isNamedOp(plusminus, namedClientScriptOps.minus)) &&
            isNamedOp(popx, namedClientScriptOps.poplocalint) &&
            pushx.op.imm == popx.op.imm
        ) {
            let isminus = plusminus.op.opcode == namedClientScriptOps.minus;
            let ispre = isNamedOp(prepushx, namedClientScriptOps.pushlocalint) && prepushx.op.imm == popx.op.imm;
            let ispost = !ispre && isNamedOp(postpushx, namedClientScriptOps.pushlocalint) && postpushx.op.imm == popx.op.imm;
            if (ispre || ispost) {
                let op = new ComposedOp(popx.originalindex, (isminus ? (ispre ? "x--" : "--x") : (ispre ? "x++" : "++x")));
                ast.remove(pushx);
                ast.remove(push1);
                ast.remove(plusminus);
                ast.replaceChild(popx, op);

                op.internalOps.push(pushx);
                op.internalOps.push(push1);
                op.internalOps.push(plusminus);
                op.internalOps.push(popx);
                if (ispre) {
                    ast.remove(prepushx);
                    op.internalOps.unshift(prepushx);
                } else {
                    ast.remove(postpushx);
                    op.internalOps.push(postpushx);
                }
                op.knownStackDiff = new StackInOut(new StackList(), new StackList(["int"]));
            }
        }
    }

    //merge variable assign nodes
    let currentassignnode: VarAssignNode | null = null;
    for (let node = cursor.goToStart(); node; node = cursor.next()) {
        if (node instanceof RawOpcodeNode && (
            node.op.opcode == namedClientScriptOps.poplocalint ||
            node.op.opcode == namedClientScriptOps.poplocallong ||
            node.op.opcode == namedClientScriptOps.poplocalstring ||
            node.op.opcode == namedClientScriptOps.popvar ||
            node.op.opcode == namedClientScriptOps.popvarbit ||
            node.op.opcode == namedClientScriptOps.popdiscardint ||
            node.op.opcode == namedClientScriptOps.popdiscardlong ||
            node.op.opcode == namedClientScriptOps.popdiscardstring
        )) {
            if (currentassignnode && currentassignnode.parent != node.parent) {
                throw new Error("ast is expected to be flat at this stage");
            }
            if (!currentassignnode) {
                currentassignnode = new VarAssignNode(node.originalindex);
                cursor.replaceNode(currentassignnode);
            } else {
                cursor.remove();
            }
            currentassignnode.addVar(node);
        } else {
            currentassignnode = null;
        }
    }

    let expandNode = (node: AstNode) => {
        if (!(node instanceof ComposedOp) && !(node instanceof CodeBlockNode) && !(node instanceof SubcallNode)) {
            let argtype = getNodeStackIn(node).clone();
            for (let i = node.children.length - 1; i >= 0; i--) {
                argtype.pop(getNodeStackOut(node.children[i]));
            }
            while (!argtype.isEmpty() && usablestackdata.length != 0) {
                let { stackel, stackconst } = usablestackdata.at(-1)!;
                let outtype = getNodeStackOut(stackel);
                if (argtype.hasSimple(bindargs)) {
                    if (typeof stackconst != "string") { throw new Error("expected vararg string"); }
                    usablestackdata.pop();
                    let bindnode: FunctionBindNode;
                    if (outtype.values.length == 1 && outtype.values[0] == "vararg") {
                        if (!stackel.knownStackDiff) { throw new Error("unexpected"); }
                        bindnode = new FunctionBindNode(stackel.originalindex, stackel.knownStackDiff.in);
                        bindnode.pushList(stackel.children);
                    } else {
                        let maybearraylen = usablestackdata.at(-1)?.stackconst;
                        let args = varArgtype(stackconst, maybearraylen);
                        if (!args) { throw new Error("vararg const string expected"); }
                        bindnode = new FunctionBindNode(stackel.originalindex, args);
                    }
                    expandNode(bindnode);
                    stackel.parent!.replaceChild(stackel, bindnode);

                    outtype = getNodeStackOut(bindnode);
                    stackel = bindnode;
                }
                if (outtype.isEmpty() || argtype.tryPop(outtype) != 0) { break; }
                node.unshift(stackel);
                usablestackdata.pop();
            }
        }

        //update usable stack data
        let outtype = getNodeStackOut(node);
        if (outtype.isEmpty()) {
            usablestackdata.length = 0;
        } else {
            usablestackdata.push({ stackel: node, stackconst: node.knownStackDiff?.constout ?? null });
        }
    }

    //find call arguments
    let bindargs = new StackList(["int", "vararg"]);
    let usablestackdata: { stackel: AstNode, stackconst: StackConst }[] = [];
    for (let node = cursor.goToStart(); node; node = cursor.next()) {
        expandNode(node);
    }
    return ast;
}
function fixControlFlow(ast: AstNode, scriptjson: clientscript) {
    let cursor = new RewriteCursor(ast);
    //find if statements
    for (let node = cursor.goToStart(); node; node = cursor.next()) {
        if (node instanceof IfStatementNode) {
            //detect an or statement that wasn't caught before (a bit late, there should be a better way to do this)
            let falseif = getSingleChild(node.falsebranch, IfStatementNode);
            if (falseif && falseif.truebranch == node.truebranch) {
                let combined = new BranchingStatement({ opcode: namedClientScriptOps.shorting_or, imm: 0, imm_obj: null }, node.statement.originalindex);
                combined.push(node.statement);
                combined.push(falseif.statement);
                node.setBranches(combined, node.truebranch, falseif.falsebranch, falseif.ifEndIndex);
            }
            let trueif = getSingleChild(node.truebranch, IfStatementNode);
            if (trueif && trueif.falsebranch == node.falsebranch) {
                let combined = new BranchingStatement({ opcode: namedClientScriptOps.shorting_and, imm: 0, imm_obj: null }, node.statement.originalindex);
                combined.push(node.statement);
                combined.push(trueif.statement);
                node.setBranches(combined, trueif.truebranch, trueif.falsebranch, node.ifEndIndex);
            }
        }
        if (node instanceof RawOpcodeNode && branchInstructions.includes(node.opinfo.id)) {
            let parent = node.parent;
            if (!(parent instanceof CodeBlockNode) || parent.possibleSuccessors.length != 2) { throw new Error("if op parent is not compatible"); }
            if (parent.children.at(-1) != node) { throw new Error("if op is not last op in codeblock"); }
            if (!parent.branchEndNode) { throw new Error("if statement parent end node expected"); }

            let trueblock = parent.possibleSuccessors[1];
            let falseblock: CodeBlockNode | null = parent.possibleSuccessors[0];
            let falseblockjump = getSingleChild(falseblock, RawOpcodeNode);
            if (falseblockjump && falseblockjump.opinfo.id == namedClientScriptOps.jump) {
                if (falseblock.possibleSuccessors.length != 1) { throw new Error("jump successor branch expected"); }
                falseblock = falseblock.possibleSuccessors[0];
                if (falseblock == parent.branchEndNode) {
                    falseblock = null;
                }
            }
            if (trueblock == parent.branchEndNode) {
                //empty true branch
                trueblock = new CodeBlockNode(trueblock.scriptid, trueblock.originalindex);
            }
            if (!(trueblock instanceof CodeBlockNode)) { throw new Error("true branch isn't a codeblock"); }
            if (falseblock && !(falseblock instanceof CodeBlockNode)) { throw new Error("false branch exists but is not a codeblock"); }

            //wrap loopable block with another codeblock
            if (trueblock.lastPointer) {
                let newblock = new CodeBlockNode(trueblock.scriptid, trueblock.originalindex);
                newblock.mergeBlock(trueblock, false);
                newblock.maxEndIndex = trueblock.maxEndIndex;
                trueblock = newblock;
            }
            if (falseblock && falseblock.lastPointer) {
                let newblock = new CodeBlockNode(falseblock.scriptid, falseblock.originalindex);
                newblock.mergeBlock(falseblock, false);
                newblock.maxEndIndex = falseblock.maxEndIndex;
                falseblock = newblock;
            }

            let condnode = new BranchingStatement(node.op, node.originalindex);
            condnode.pushList(node.children);

            let grandparent = parent?.parent;
            if (parent instanceof CodeBlockNode && grandparent instanceof IfStatementNode && grandparent.ifEndIndex == parent.branchEndNode.originalindex) {
                let isor = grandparent.truebranch == trueblock && grandparent.falsebranch == parent;
                let isand = parent.children.length == 1 && grandparent.falsebranch == falseblock && grandparent.truebranch == parent;
                if (isor || isand) {
                    parent.remove(node);
                    //TODO make some sort of in-line codeblock node for this
                    // console.log("merging if statements while 2nd if wasn't parsed completely, stack will be invalid");
                    while (parent.children.length != 0) {
                        condnode.unshift(parent.children[0]);
                    }
                    let fakeop: ClientScriptOp = { opcode: isor ? namedClientScriptOps.shorting_or : namedClientScriptOps.shorting_and, imm: 0, imm_obj: null };
                    let combinedcond = new BranchingStatement(fakeop, grandparent.originalindex);
                    combinedcond.push(grandparent.statement);
                    combinedcond.push(condnode);
                    if (isor) {
                        grandparent.setBranches(combinedcond, grandparent.truebranch, falseblock, parent.branchEndNode.originalindex);
                    } else {
                        grandparent.setBranches(combinedcond, trueblock, grandparent.falsebranch, parent.branchEndNode.originalindex);
                    }
                    continue;
                }
            }

            let ifstatement = new IfStatementNode(condnode.originalindex);
            ifstatement.setBranches(condnode, trueblock, falseblock, parent.branchEndNode.originalindex);
            cursor.replaceNode(ifstatement);
            cursor.setFirstChild(ifstatement, true);
        }
        if (node instanceof RawOpcodeNode && node.opinfo.id == namedClientScriptOps.switch) {
            if (!(node.parent instanceof CodeBlockNode) || !node.parent.branchEndNode) { throw new Error("code block expected"); }
            let casestatement = SwitchStatementNode.create(node, scriptjson, node.parent.possibleSuccessors, node.parent.branchEndNode.originalindex);
            cursor.replaceNode(casestatement);
            cursor.setFirstChild(casestatement, true);
        }
        if (node instanceof RawOpcodeNode && node.opinfo.id == namedClientScriptOps.jump) {
            let target = node.originalindex + 1 + node.op.imm;
            let parent = node.parent;
            if (parent instanceof CodeBlockNode && parent.maxEndIndex == target) {
                //strip obsolete closing bracket jumps
                cursor.remove();
                continue;
            } else {
                for (let ifnode = node.parent; ifnode; ifnode = ifnode.parent) {
                    if (ifnode instanceof IfStatementNode) {
                        let codeblock = ifnode.parent;
                        if (!(codeblock instanceof CodeBlockNode) || !codeblock.parent) { throw new Error("unexpected"); }
                        if (codeblock.originalindex != target) { continue; }
                        if (codeblock.children.at(-1) != ifnode) { throw new Error("unexpected"); }

                        //TODO this is silly, there might be more instructions in the enclosing block, make sure these aren't lost
                        //mostly seems to affect expansions of var++ and ++var constructs which are currently not supported
                        for (let i = codeblock.children.length - 2; i >= 0; i--) {
                            ifnode.statement.unshift(codeblock.children[i]);
                        }
                        let originalparent = codeblock.parent;
                        let loopstatement = WhileLoopStatementNode.fromIfStatement(codeblock.originalindex, ifnode);
                        originalparent.replaceChild(codeblock, loopstatement);
                        loopstatement.push(ifnode);
                        loopstatement.push(ifnode.truebranch);
                        cursor.rebuildStack();
                        cursor.remove();
                        break;
                    }
                }
            }
        }
        if (node instanceof CodeBlockNode && node.branchEndNode) {
            if (node.maxEndIndex == -1 || node.branchEndNode.originalindex < node.maxEndIndex) {
                let subnode = node.branchEndNode;
                cursor.prev();
                if (subnode.lastPointer) {
                    node.mergeBlock(subnode, false);
                } else {
                    node.mergeBlock(subnode, true);
                }
            }
        }
    }
}

export class ClientScriptFunction extends AstNode {
    returntype: StackList;
    argtype: StackList;
    scriptname: string;
    localCounts: StackDiff;
    constructor(scriptname: string, returntype: StackList, argtype: StackList, localCounts: StackDiff) {
        super(0);
        this.scriptname = scriptname;
        this.returntype = returntype;
        this.argtype = argtype;
        this.localCounts = localCounts;
    }

    getOpcodes(ctx: OpcodeWriterContext) {
        let body = this.children[0].getOpcodes(ctx);
        //don't add the obsolete return call if there is already a return call and the type is empty
        if (!this.returntype.isEmpty() || body.at(-1)?.opcode != namedClientScriptOps.return) {
            let ret = this.returntype.clone();
            let pushconst = (type: StackType) => {
                if (type == "vararg") { throw new Error("unexpected"); }
                body.push({
                    opcode: namedClientScriptOps.pushconst,
                    imm: { int: 0, long: 1, string: 2 }[type],
                    imm_obj: { int: 0, long: [0, 0] as [number, number], string: "" }[type],
                });
            }
            while (!ret.isEmpty()) {
                let type = ret.values.pop()!;
                if (type instanceof StackDiff) {
                    for (let i = 0; i < type.int; i++) { pushconst("int"); }
                    for (let i = 0; i < type.long; i++) { pushconst("long"); }
                    for (let i = 0; i < type.string; i++) { pushconst("string"); }
                    for (let i = 0; i < type.vararg; i++) { pushconst("vararg"); }
                } else {
                    pushconst(type);
                }
            }
            body.push({ opcode: namedClientScriptOps.return, imm: 0, imm_obj: null });
        }
        return body;
    }
}

export function varArgtype(stringconst: string | unknown, lastintconst: number | unknown) {
    if (typeof stringconst != "string") { return null; }
    //a string like this indicates a vararg set where this string indicates the types
    //treat the entire thing as one vararg
    let varargmatch = stringconst.match(/^([ils]*)Y?$/);
    if (!varargmatch) {
        return null;
    }
    //TODO throw if wrong
    let indiff = new StackList(varargmatch[1].split("").flatMap<StackType>(q => q == "i" ? "int" : q == "l" ? "long" : q == "s" ? "string" : null!));
    //variable number of ints
    if (stringconst.includes("Y")) {
        if (typeof lastintconst != "number") {
            throw new Error("parsing vararg array, but length type was not an int");
        }
        for (let i = 0; i < lastintconst; i++) { indiff.int(); }
        indiff.int();//the length of the array on stack
    }
    return indiff;
}

export function addKnownStackDiffsub(consts: StackConstants | null, calli: ClientscriptObfuscation, node: RawOpcodeNode, scriptid: number) {
    if (node.opinfo.id == namedClientScriptOps.dbrow_getfield) {
        //args are rowid,tablefield,subrow
        let tablefield = consts?.values.at(-2);
        if (typeof tablefield == "number") {
            let dbtable = (tablefield >> 12) & 0xffff;
            let columnid = (tablefield >> 4) & 0xff;
            let subfield = tablefield & 0xf;
            let column = calli.dbtables.get(dbtable)?.unk01?.columndata.find(q => q.id == columnid);
            if (column) {
                node.knownStackDiff = StackInOut.fromExact(
                    [subtypes.dbrow, subtypes.int, subtypes.int],
                    (subfield != 0 ? [column.columns[subfield - 1].type] : column.columns.map(q => q.type))
                )
            }
        }
    } else if (getParamOps.includes(node.opinfo.id)) {
        //args are structid/itemid,paramid
        let paramid = consts?.values.at(-1);
        if (typeof paramid == "number") {
            let param = calli.parammeta.get(paramid);
            if (!param) {
                console.log("unknown param " + paramid);
            } else {
                let outtype = [param.type ? param.type.vartype : 0]
                let inputs = new StackList();
                //all getparams except for cc_getparam require a target
                if (node.opinfo.id != namedClientScriptOps.cc_getparam) { inputs.pushone("int"); }
                inputs.pushone("int");
                node.knownStackDiff = new StackInOut(inputs, new StackList(outtype.map(typeToPrimitive)));
                //don't set in type because it's probably different eg pointer to npc etc
                node.knownStackDiff.exactout = ExactStack.fromList(outtype);
            }
        }
    } else if (node.opinfo.id == namedClientScriptOps.enum_getvalue) {
        //args are intypeid,outtypeid,enum,lookup
        let outtypeid = consts?.values.at(-3);
        let intypeid = consts?.values.at(-4);
        if (typeof outtypeid == "number" && typeof intypeid == "number") {
            node.knownStackDiff = StackInOut.fromExact(
                [subtypes.int, subtypes.int, subtypes.enum, intypeid],
                [outtypeid],
            )
        }
    } else if (node.opinfo.id == namedClientScriptOps.return) {
        let script = calli.scriptargs.get(scriptid);
        if (script) {
            node.knownStackDiff = new StackInOut(script.stack.out, new StackList());
            node.knownStackDiff.exactin = script.stack.exactout;
        }
    } else if (node.opinfo.id == namedClientScriptOps.gosub) {
        let script = calli.scriptargs.get(node.op.imm);
        if (script) {
            node.knownStackDiff = script.stack;
        }
    } else if (node.opinfo.id == namedClientScriptOps.joinstring) {
        node.knownStackDiff = new StackInOut(
            new StackList(Array(node.op.imm).fill("string")),
            new StackList(["string"])
        )
    } else if (node.opinfo.id == namedClientScriptOps.pushvar || node.opinfo.id == namedClientScriptOps.popvar) {
        let varmeta = calli.getClientVarMeta(node.op.imm);
        if (varmeta) {
            let ispop = node.opinfo.id == namedClientScriptOps.popvar;

            let value = [varmeta.fulltype];
            node.knownStackDiff = StackInOut.fromExact(
                (ispop ? value : []),
                (ispop ? [] : value)
            );
        }
    } else if (node.opinfo.id == namedClientScriptOps.pushconst) {
        if (node.op.imm == 0) {
            if (typeof node.op.imm_obj != "number") { throw new Error("unexpected"); }
            node.knownStackDiff = StackInOut.fromExact([], [typeuuids.int++]);
            node.knownStackDiff.constout = node.op.imm_obj;
        } else if (node.op.imm == 1) {
            node.knownStackDiff = StackInOut.fromExact([], [typeuuids.long++]);
            node.knownStackDiff.constout = node.op.imm_obj;
        } else if (node.op.imm == 2) {
            let stringconst = node.op.imm_obj as string;
            node.knownStackDiff = StackInOut.fromExact([], [typeuuids.string++]);
            node.knownStackDiff.constout = node.op.imm_obj;

            //a string like this indicates a vararg set where this string indicates the types
            //treat the entire thing as one vararg
            //only make use of this construct if it is at least 3 chars long
            //otherwise ignore the equation
            let varargmatch = stringconst.match(/^([ils]*)Y?$/);
            if (consts && varargmatch && stringconst.length >= 3) {
                let argtype = varArgtype(stringconst, consts.values.at(-1));
                if (!argtype) { throw new Error("unexpected"); }
                node.knownStackDiff = new StackInOut(argtype, new StackList(["vararg"]));
                node.knownStackDiff.constout = node.op.imm_obj;
                node.knownStackDiff.exactin = ExactStack.fromList(argtype.toLooseSubtypes());
            } else if (varargmatch) {
                node.unknownstack = true;
            }
        } else {
            throw new Error("unexpected");
        }
    }

    if (!node.knownStackDiff && dynamicOps.includes(node.op.opcode)) {
        node.unknownstack = true;
    }
}

function addKnownStackDiff(children: AstNode[], calli: ClientscriptObfuscation, scriptid: number) {
    let consts: StackConstants | null = new StackConstants();
    let hasunknown = false;

    for (let node of children) {
        if (!(node instanceof RawOpcodeNode)) { throw new Error("unexpected"); }

        addKnownStackDiffsub(consts, calli, node, scriptid);

        if (consts) {
            if (node.knownStackDiff?.constout != null) {
                consts.pushOne(node.knownStackDiff.constout);
            } else if (node.knownStackDiff?.initializedthrough) {
                consts.applyInOut(node.knownStackDiff);
            } else if (node.opinfo.stackinfo.initializedthrough) {
                consts.applyInOut(node.opinfo.stackinfo);
            } else {
                consts = null;
            }
        }

        hasunknown ||= node.unknownstack;
    }
    return hasunknown;
}

export function generateAst(calli: ClientscriptObfuscation, script: clientscriptdata | clientscript, ops: ClientScriptOp[], scriptid: number) {
    let sections: CodeBlockNode[] = [];
    let getorMakeSection = (index: number) => {
        if (index >= ops.length) { throw new Error("tried to jump outside script"); }
        let section = sections.find(q => q.originalindex == index);
        if (!section) {
            section = new CodeBlockNode(scriptid, index);
            sections.push(section);
        }
        return section
    }

    let currentsection = getorMakeSection(0);

    //find all jump targets and make the sections
    for (let [index, op] of ops.entries()) {
        let nextindex = index + 1;
        let info = calli.getNamedOp(op.opcode);

        if (branchInstructionsOrJump.includes(info.id)) {
            let jumpindex = nextindex + op.imm;
            getorMakeSection(nextindex);
            getorMakeSection(jumpindex);
        }
    }

    //write the opcodes
    for (let [index, op] of ops.entries()) {
        let nextindex = index + 1;
        let info = calli.getNamedOp(op.opcode)!;
        let opnode = new RawOpcodeNode(index, op, info);

        //check if other flows merge into this one
        let addrsection = sections.find(q => q.originalindex == index);
        if (addrsection && addrsection != currentsection) {
            currentsection.addSuccessor(addrsection);
            currentsection = addrsection;
        }

        currentsection.push(opnode);

        if (branchInstructionsOrJump.includes(info.id)) {
            let jumpindex = nextindex + op.imm;
            let nextblock = getorMakeSection(nextindex);
            let jumpblock = getorMakeSection(jumpindex);
            if (info.id != namedClientScriptOps.jump) {
                currentsection.addSuccessor(nextblock);
            }
            currentsection.addSuccessor(jumpblock);
            currentsection = nextblock;
        } else if (opnode.opinfo.id == namedClientScriptOps.return) {
            if (index != ops.length - 1) {
                //dead code will be handled elsewhere
                currentsection = getorMakeSection(nextindex);
            }
        } else if (opnode.opinfo.id == namedClientScriptOps.switch) {
            let cases = script.switches[opnode.op.imm];
            if (!cases) { throw new Error("no matching cases in script"); }

            for (let cond of cases) {
                let jumpblock = getorMakeSection(nextindex + cond.label);
                if (!currentsection.possibleSuccessors.includes(jumpblock)) {
                    currentsection.addSuccessor(jumpblock);
                }
            }
            let nextblock = getorMakeSection(nextindex);
            currentsection.addSuccessor(nextblock);
            currentsection = nextblock;
        }
    }
    sections.sort((a, b) => a.originalindex - b.originalindex);
    sections.forEach(q => addKnownStackDiff(q.children, calli, q.scriptid));
    return sections;
}

export function parseClientScriptIm(calli: ClientscriptObfuscation, script: clientscript, fileid = -1, full = true) {
    let sections = generateAst(calli, script, script.opcodedata, fileid);
    let typectx = new ClientScriptSubtypeSolver();
    typectx.parseSections(sections);
    typectx.addKnownFromCalli(calli);
    typectx.solve();
    let program = new CodeBlockNode(fileid, 0);
    if (full) {
        program.addSuccessor(sections[0]);
        for (let node: CodeBlockNode | null = program; node; node = node.findNext());
        sections.forEach(translateAst);
        fixControlFlow(program, script);
    } else {
        program.pushList(sections);
        for (let node: CodeBlockNode | null = program; node; node = node.findNext());
    }

    let localcounts = new StackDiff();
    for (let op of script.opcodedata) {
        if (op.opcode == namedClientScriptOps.poplocalint || op.opcode == namedClientScriptOps.pushlocalint) { localcounts.int = Math.max(localcounts.int, op.imm + 1); }
        if (op.opcode == namedClientScriptOps.poplocallong || op.opcode == namedClientScriptOps.pushlocallong) { localcounts.long = Math.max(localcounts.long, op.imm + 1); }
        if (op.opcode == namedClientScriptOps.poplocalstring || op.opcode == namedClientScriptOps.pushlocalstring) { localcounts.string = Math.max(localcounts.string, op.imm + 1); }
    }

    let returntype = getReturnType(calli, script.opcodedata);
    let argtype = getArgType(script);
    let scriptname = `script${fileid == -1 ? "_unk" : fileid}`;
    let func = new ClientScriptFunction(scriptname, returntype, new StackList([argtype]), localcounts);
    func.push(program);
    return { func, sections, typectx };
}
globalThis.parseClientScriptIm = parseClientScriptIm;

export function astToImJson(calli: ClientscriptObfuscation, func: ClientScriptFunction) {
    let ctx = new OpcodeWriterContext(calli);
    let opdata: ClientScriptOp[] = [];
    let funcbody = func.getOpcodes(ctx);//this needs to run before the subfunc section because it defines the subfuncs

    let switches: clientscript["switches"] = [];
    let tempstacks = new StackDiff();
    let returnsitejumps: clientscript["switches"][number] = [];

    if (ctx.subfunctions.size != 0 || ctx.returnsites.size != 0) {
        let footerendlabel = ctx.getNamedLabel("footerend");
        opdata.push(makeop(namedClientScriptOps.jump, -1, { type: "jumplabel", value: footerendlabel }));

        //jump table
        opdata.push(...tracerNops(`dynamicjump start`));
        opdata.push(ctx.getNamedLabel("dynamicjump"));
        opdata.push(makeop(namedClientScriptOps.switch, switches.push(returnsitejumps) - 1));
        opdata.push(...tracerNops(`dynamicjump end`));
        //TODO add error for default case?

        for (let subfunc of ctx.subfunctions.values()) {
            let intype = subfunc.func.argtype.getStackdiff();
            let outtype = subfunc.func.returntype.getStackdiff();
            let localtype = subfunc.func.localCounts.clone();
            tempstacks.int = Math.max(tempstacks.int, intype.int + 1, outtype.int + 1);//1 extra for the return addr
            tempstacks.long = Math.max(tempstacks.long, intype.long, outtype.long);
            tempstacks.string = Math.max(tempstacks.string, intype.string, outtype.string);

            //have to do some stack wizardry here since the VM only lets you access the very top of the stack
            //sadly this requires extra local variables and i don't know how many we're allowed to have
            //the jump target for calls to this subfunction
            opdata.push(...tracerNops(`subfunc ${subfunc.func.scriptname} start`));
            opdata.push(subfunc.label);
            //move return address from top of int stack to last tmp+1
            let returnaddrtemp = func.localCounts.int + Math.max(intype.int, outtype.int);
            opdata.push(makeop(namedClientScriptOps.poplocalint, returnaddrtemp));
            //move all args from stack to tmp locals
            for (let i = intype.int - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalint, func.localCounts.int + i)); }
            for (let i = intype.long - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocallong, func.localCounts.long + i)); }
            for (let i = intype.string - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalstring, func.localCounts.string + i)); }
            //save all locals that callee want to reuse to stack
            for (let i = 0; i < localtype.int; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalint, i)); }
            for (let i = 0; i < localtype.long; i++) { opdata.push(makeop(namedClientScriptOps.pushlocallong, i)); }
            for (let i = 0; i < localtype.string; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalstring, i)); }
            //push the return address back to stack
            opdata.push(makeop(namedClientScriptOps.pushlocalint, returnaddrtemp));
            //move the args from temp to start of locals
            for (let i = 0; i < intype.int; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalint, func.localCounts.int + i), makeop(namedClientScriptOps.poplocalint, i)); }
            for (let i = 0; i < intype.long; i++) { opdata.push(makeop(namedClientScriptOps.pushlocallong, func.localCounts.long + i), makeop(namedClientScriptOps.poplocallong, i)); }
            for (let i = 0; i < intype.string; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalstring, func.localCounts.string + i), makeop(namedClientScriptOps.poplocalstring, i)); }
            //function body (same as with a root function)
            let funcbody = subfunc.func.getOpcodes(ctx);
            //replace all return ops into ops that jump to the end label (op itself is a nop)
            let endlabel = makeop(namedClientScriptOps.jump, 0);
            ctx.declareLabel(endlabel);
            funcbody.forEach((op, i) => {
                if (op.opcode == namedClientScriptOps.return) {
                    funcbody[i] = makeop(namedClientScriptOps.jump, -1, { type: "jumplabel", value: endlabel });
                }
            });
            opdata.push(...tracerNops(`subfunc ${subfunc.func.scriptname} body`));
            opdata.push(...funcbody);
            opdata.push(...tracerNops(`subfunc ${subfunc.func.scriptname} footer`));
            opdata.push(endlabel);
            //move all return values from stack to tmp locals
            for (let i = 0; i < outtype.int; i++) { opdata.push(makeop(namedClientScriptOps.poplocalint, func.localCounts.int + i)); }
            for (let i = 0; i < outtype.long; i++) { opdata.push(makeop(namedClientScriptOps.poplocallong, func.localCounts.long + i)); }
            for (let i = 0; i < outtype.string; i++) { opdata.push(makeop(namedClientScriptOps.poplocalstring, func.localCounts.string + i)); }
            //move the return address from stack to tmp
            opdata.push(makeop(namedClientScriptOps.poplocalint, returnaddrtemp));
            //restore all caller locals that we used (in reverse order)
            for (let i = localtype.int - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalint, i)); }
            for (let i = localtype.long - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocallong, i)); }
            for (let i = localtype.string - 1; i >= 0; i--) { opdata.push(makeop(namedClientScriptOps.poplocalstring, i)); }
            //move the return values from tmp locals to stack
            for (let i = 0; i < outtype.int; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalint, func.localCounts.int + i)); }
            for (let i = 0; i < outtype.long; i++) { opdata.push(makeop(namedClientScriptOps.pushlocallong, func.localCounts.long + i)); }
            for (let i = 0; i < outtype.string; i++) { opdata.push(makeop(namedClientScriptOps.pushlocalstring, func.localCounts.string + i)); }
            //now jump to the jumptable that acts a dynamic jump (pops the return "address" from top of int stack)
            opdata.push(makeop(namedClientScriptOps.pushlocalint, returnaddrtemp));
            opdata.push(makeop(namedClientScriptOps.jump, -1, { type: "jumplabel", value: ctx.getNamedLabel("dynamicjump") }));
            //thats it, simple
            opdata.push(...tracerNops(`subfunc ${subfunc.func.scriptname} end`));
        }

        opdata.push(footerendlabel);
    }

    opdata.push(...funcbody);

    let allargs = func.argtype.getStackdiff();
    let localcounts = func.localCounts.clone().add(tempstacks);
    let script: clientscript = {
        byte0: 0,
        switchsize: -1,
        switches: switches,
        longargcount: allargs.long,
        stringargcount: allargs.string,
        intargcount: allargs.int,
        locallongcount: localcounts.long + tempstacks.long,
        localstringcount: localcounts.string + tempstacks.string,
        localintcount: localcounts.int + tempstacks.int,
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
    }
    if (ctx.returnsites.size != 0) {
        let switchbaseaddress = labelmap.get(ctx.getNamedLabel("dynamicjump"));
        if (typeof switchbaseaddress != "number") { throw new Error("dynamicjump section not found"); }
        switchbaseaddress += 2;//+label+switchop
        for (let [label, targetop] of ctx.returnsites) {
            let target = labelmap.get(targetop);
            if (target == undefined) { throw new Error("dynamicjump return address not found"); }
            returnsitejumps.push({ label: target - switchbaseaddress, value: label });//TODO the engine might not support negative switch jumps
        }
    }
    //1+foreach(2+sublen*(4+4))
    script.switchsize = 1 + script.switches.reduce((a, v) => a + 2 + v.length * (4 + 4), 0);
    return script;
}
