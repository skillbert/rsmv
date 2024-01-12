import { clientscript } from "../../generated/clientscript";
import { clientscriptdata } from "../../generated/clientscriptdata";
import { CacheFileSource } from "../cache";
import { parse } from "../opdecoder";
import { ClientscriptObfuscation, OpcodeInfo, getArgType, getReturnType, prepareClientScript, typeToPrimitive } from "./callibrator";
import { clientscriptParser } from "./codeparser";
import { binaryOpIds, binaryOpSymbols, branchInstructions, branchInstructionsOrJump, dynamicOps, knownClientScriptOpNames, namedClientScriptOps, variableSources, StackDiff, StackInOut, StackList, StackTypeExt, ClientScriptOp, StackConst, StackType, StackConstants, getParamOps } from "./definitions";

/**
 * known issues
 * - If all branches (and default) of a switch statement return, then the last branch is emptied and its contents are placed after the end of the block (technically still correct)
 *   - has to do with the way the branching detection works (AstNode.findNext)
 * - some op arguments still not figured out
 * - none of this is tested for older builds
 *   - probably breaks at the build where pushconst ops were merged (~700?)
 */
//get script names from https://api.runewiki.org/hashes?rev=930

/**
 * known compiler differences
 * - in some situations bunny hop jumps in nested ifs are merged while the jagex compiler doesn't
 * - default return values for int can be -1 for some specialisations while this compiler doesn't know about those
 * - this ast tree automatically strips dead code so round trips won't be identical if there dead code
 * - when a script has no return values but the original code had an explicit return then this compiler won't output that
 */


function getSingleChild<T extends AstNode>(op: AstNode | null | undefined, type: { new(...args: any[]): T }) {
    if (!op || op.children.length != 1 || !(op.children[0] instanceof type)) { return null; }
    return op.children[0] as T;
}

function isNamedOp(op: AstNode, id: number): op is RawOpcodeNode {
    return op instanceof RawOpcodeNode && op.op.opcode == id;
}

function codeIndent(amount: number, linenr = -1, hasquestionmark = false) {
    // return (linenr == -1 ? "" : linenr + ":").padEnd(5 + amount * 4, " ") + (hasquestionmark ? "?? " : "   ");
    return "    ".repeat(amount);
}

function getOpcodeName(calli: ClientscriptObfuscation, op: ClientScriptOp) {
    if (op.opcode == namedClientScriptOps.poplocalint || op.opcode == namedClientScriptOps.pushlocalint) {
        return `int${op.imm}`;
    } else if (op.opcode == namedClientScriptOps.poplocalstring || op.opcode == namedClientScriptOps.pushlocalstring) {
        return `string${op.imm}`;
    } else if (op.opcode == namedClientScriptOps.poplocallong || op.opcode == namedClientScriptOps.pushlocallong) {
        return `long${op.imm}`;
    } else if (op.opcode == namedClientScriptOps.popvar || op.opcode == namedClientScriptOps.pushvar) {
        let varmeta = calli.getClientVarMeta(op.imm);
        if (varmeta) {
            return `var${varmeta.name}_${varmeta.varid}`;
        } else {
            return `varunk_${op.imm}`;
        }
    }
    return knownClientScriptOpNames[op.opcode] ?? `unk${op.opcode}`;
}

function getOpcodeCallCode(calli: ClientscriptObfuscation, op: ClientScriptOp, children: AstNode[], originalindex: number, indent: number) {
    let binarysymbol = binaryOpSymbols.get(op.opcode);
    if (binarysymbol) {
        if (children.length == 2) {
            return `(${children[0].getCode(calli, indent)} ${binarysymbol} ${children[1].getCode(calli, indent)})`;
        } else {
            return `(${binarysymbol} ${children.map(q => q.getCode(calli, indent)).join(" ")})`;
        }
    }
    if (op.opcode == namedClientScriptOps.return) {
        return `return ${children.length == 1 ? children[0].getCode(calli, indent) : `[${children.map(q => q.getCode(calli, indent)).join(",")}]`}`;
    }
    if (op.opcode == namedClientScriptOps.gosub) {
        return `script${op.imm}(${children.map(q => q.getCode(calli, indent)).join(",")})`;
    }
    let metastr = "";
    if (branchInstructionsOrJump.includes(op.opcode)) {
        metastr = `[${op.imm + originalindex + 1}]`;
    } else if (op.opcode == namedClientScriptOps.gosub) {
        metastr = `[${op.imm}]`;
    } else if (op.imm != 0) {
        metastr = `[${op.imm}]`;
    }
    return `${getOpcodeName(calli, op)}${metastr}(${children.map(q => q.getCode(calli, indent)).join(",")})`;
}

export abstract class AstNode {
    parent: AstNode | null = null;
    knownStackDiff: StackInOut | null = null;
    children: AstNode[] = [];
    originalindex: number;
    constructor(originalindex: number) {
        this.originalindex = originalindex;
    }
    abstract getCode(calli: ClientscriptObfuscation, indent: number): string;
    abstract getOpcodes(calli: ClientscriptObfuscation): ClientScriptOp[];
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

type ComposedopType = "++x" | "--x" | "x++" | "x--";
export class ComposedOp extends AstNode {
    type: ComposedopType;
    varid: number;
    internalOps: AstNode[] = [];
    constructor(originalindex: number, type: ComposedopType, varid: number) {
        super(originalindex);
        this.type = type;
        this.varid = varid;
    }
    getCode(calli: ClientscriptObfuscation, indent: number) {
        if (this.children.length != 0) { throw new Error("no children expected on composednode"); }
        let n = `int${this.varid}`;
        if (this.type == "++x") { return `++${n}`; }
        else if (this.type == "--x") { return `--${n}`; }
        else if (this.type == "x++") { return `${n}++`; }
        else if (this.type == "x--") { return `${n}--`; }
        else throw new Error("unexpected op type " + this.type)
    }
    getOpcodes(calli: ClientscriptObfuscation) {
        if (this.children.length != 0) { throw new Error("no children expected on composednode"); }
        return this.internalOps.flatMap(q => q.getOpcodes(calli));
    }
}

export class VarAssignNode extends AstNode {
    varops: RawOpcodeNode[] = [];
    knownStackDiff = new StackInOut(new StackList(), new StackList());
    getName(calli: ClientscriptObfuscation) {
        let name = `${this.varops.map(q => q instanceof RawOpcodeNode ? getOpcodeName(calli, q.op) : "??")}`;
        return { name: name, extra: "" };
    }
    getCode(calli: ClientscriptObfuscation, indent: number) {
        let name = this.getName(calli);
        return `var ${this.varops.length == 1 ? "" : "["}${name.name}${this.varops.length == 1 ? "" : "]"} = ${this.children.map(q => q.getCode(calli, indent)).join(",")}`
    }
    getOpcodes(calli: ClientscriptObfuscation) {
        let res = this.children.flatMap(q => q.getOpcodes(calli));
        return res.concat(this.varops.flatMap(q => q.getOpcodes(calli)).reverse());
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
    getCode(calli: ClientscriptObfuscation, indent: number) {
        let code = "";
        if (this.parent) {
            code += `{\n`;
            indent++;
        }
        // code += `${codeIndent(indent, this.originalindex)}//[${this.scriptid},${this.originalindex}]\n`;
        for (let child of this.children) {
            code += `${codeIndent(indent, child.originalindex)}${child.getCode(calli, indent)}\n`;
        }
        if (this.parent) {
            code += `${codeIndent(indent - 1)}}`;
        }
        return code;
    }
    getOpcodes(calli: ClientscriptObfuscation) {
        return this.children.flatMap(q => q.getOpcodes(calli));
    }
    dump() {
        console.log(
            // `[${this.scriptid},${this.originalindex}]\n`+
            this.getCode(globalThis.deob, 0)
        );
    }
}

function retargetJumps(calli: ClientscriptObfuscation, code: ClientScriptOp[], from: number, to: number) {
    let lastop = code.at(-1);
    let insertedcount = 0;
    if (lastop && lastop.opcode != namedClientScriptOps.jump && from == 0) {
        //insert jump op here
        let jumpop = calli.getNamedOp(namedClientScriptOps.jump);
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

    getCode(calli: ClientscriptObfuscation, indent: number) {
        return getOpcodeCallCode(calli, this.op, this.children, this.originalindex, indent);
    }

    getOpcodes(calli: ClientscriptObfuscation) {
        if (this.op.opcode == namedClientScriptOps.shorting_or || this.op.opcode == namedClientScriptOps.shorting_and) {
            if (this.children.length != 2) { throw new Error("unexpected"); }
            let left = this.children[0].getOpcodes(calli);
            let right = this.children[1].getOpcodes(calli);
            if (this.op.opcode == namedClientScriptOps.shorting_or) {
                //retarget true jumps to true outcome of combined statement
                retargetJumps(calli, left, 1, right.length + 1);
                //index 0 [false] will already point to start of right condition
            } else {
                //retarget the false jumps to one past end [false] of combined statement
                retargetJumps(calli, left, 0, right.length);
                //retarget true jumps to start of right statement
                retargetJumps(calli, left, 1, 0);
            }
            return [...left, ...right];
        }
        let op: ClientScriptOp = { opcode: this.op.opcode, imm: 1, imm_obj: null };
        return this.children.flatMap(q => q.getOpcodes(calli)).concat(op);
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
    getCode(calli: ClientscriptObfuscation, indent: number) {
        let res = `while(${this.statement.getCode(calli, indent)})`;
        res += this.body.getCode(calli, indent);
        return res;
    }
    getOpcodes(calli: ClientscriptObfuscation) {
        let cond = this.statement.getOpcodes(calli);
        let body = this.body.getOpcodes(calli);
        let jump = calli.getNamedOp(namedClientScriptOps.jump);
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
    getCode(calli: ClientscriptObfuscation, indent: number) {
        let res = "";
        res += `switch(${this.valueop?.getCode(calli, indent) ?? ""}){\n`;
        for (let [i, branch] of this.branches.entries()) {
            res += `${codeIndent(indent + 1, branch.block.originalindex)}case ${branch.value}:`;
            if (i + 1 < this.branches.length && this.branches[i + 1].block == branch.block) {
                res += `\n`;
            } else {
                res += branch.block.getCode(calli, indent + 1);
                res += `\n`;
            }
        }
        if (this.defaultbranch) {
            res += `${codeIndent(indent + 1)}default:`;
            res += this.defaultbranch.getCode(calli, indent + 1);
        }
        res += `${codeIndent(indent)}}`;
        return res;
    }
    getOpcodes(calli: ClientscriptObfuscation) {
        let body: ClientScriptOp[] = [];
        if (this.valueop) { body.push(...this.valueop.getOpcodes(calli)); }
        let jump = calli.getNamedOp(namedClientScriptOps.jump);
        let switchopinfo = calli.getNamedOp(namedClientScriptOps.switch);
        let switchop: ClientScriptOp = { opcode: switchopinfo.id, imm: -1, imm_obj: [] };
        let defaultjmp: ClientScriptOp = { opcode: jump.id, imm: -1, imm_obj: null };
        body.push(switchop);//TODO switch map id
        let jumpstart = body.length;
        body.push(defaultjmp);

        let endops: ClientScriptOp[] = [];

        let jumptable: { value: number, label: number }[] = [];
        let lastblock: CodeBlockNode | null = null;
        let lastblockindex = 0;
        for (let i = 0; i < this.branches.length; i++) {
            let branch = this.branches[i];
            //add a jump so the previous branch skips to end (and last branch doesn't)
            if (branch.block == lastblock) {
                jumptable.push({ value: branch.value, label: lastblockindex });
                continue;
            }
            if (lastblock) {
                let jmp: ClientScriptOp = { opcode: jump.id, imm: -1, imm_obj: null };
                body.push(jmp);
                endops.push(jmp);
            }
            lastblock = branch.block;
            lastblockindex = body.length - jumpstart;
            jumptable.push({ value: branch.value, label: lastblockindex });
            body.push(...branch.block.getOpcodes(calli));
        }

        if (this.defaultbranch) {
            if (lastblock) {
                let jmp: ClientScriptOp = { opcode: jump.id, imm: -1, imm_obj: null };
                body.push(jmp);
                endops.push(jmp);
            }

            defaultjmp.imm = body.length - body.indexOf(defaultjmp) - 1;
            body.push(...this.defaultbranch.getOpcodes(calli));
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
    getCode(calli: ClientscriptObfuscation, indent: number) {
        let res = `if(${this.statement.getCode(calli, indent)})`;
        res += this.truebranch?.getCode(calli, indent);
        if (this.falsebranch) {
            res += `else`;
            //skip brackets for else if construct
            let subif = getSingleChild(this.falsebranch, IfStatementNode);
            if (subif) {
                res += " " + this.falsebranch.children[0].getCode(calli, indent);
            } else {
                res += this.falsebranch.getCode(calli, indent);
            }
        }
        return res;
    }
    getOpcodes(calli: ClientscriptObfuscation) {
        let cond = this.statement.getOpcodes(calli);
        let truebranch = this.truebranch.getOpcodes(calli);
        let falsebranch: ClientScriptOp[] = [];
        if (this.falsebranch) {
            falsebranch = this.falsebranch.getOpcodes(calli);
            truebranch.push({ opcode: calli.getNamedOp(namedClientScriptOps.jump).id, imm: falsebranch.length, imm_obj: null });
            // retargetJumps(calli, truebranch, 0, falsebranch.length)
        }
        //TODO rerouting true jumps past 2 in order to switch them with false at 1, this is stupid
        retargetJumps(calli, cond, 0, truebranch.length == 1 ? 2 : truebranch.length);
        retargetJumps(calli, cond, 1, 0);
        if (truebranch.length == 1) { retargetJumps(calli, cond, 2, 1); }
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

    getCode(calli: ClientscriptObfuscation, indent: number) {
        let scriptid = this.children[0]?.knownStackDiff?.constout ?? -1;
        return `bind[${scriptid}](${this.children.slice(1).map(q => q.getCode(calli, indent))})`;
    }

    getOpcodes(calli: ClientscriptObfuscation) {
        let scriptid = this.children[0]?.knownStackDiff?.constout ?? -1;
        if (typeof scriptid != "number") { throw new Error("unexpected"); }
        let func = calli.scriptargs.get(scriptid);
        let typestring = func?.arglist?.toFunctionBindString();
        if (!typestring) { throw new Error("unknown functionbind types"); }
        let ops = this.children.flatMap(q => q.getOpcodes(calli)).concat();
        ops.push({ opcode: calli.getNamedOp(namedClientScriptOps.pushconst).id, imm: 2, imm_obj: typestring });
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
    getCode(calli: ClientscriptObfuscation, indent: number) {
        if (this.op.opcode == namedClientScriptOps.pushconst) {
            if (typeof this.op.imm_obj == "string") { return `"${this.op.imm_obj.replace(/(["\\])/g, "\\$1")}"`; }
            else if (Array.isArray(this.op.imm_obj)) {
                //build our bigint as unsigned
                let int = (BigInt(this.op.imm_obj[0] as number) << 32n) | BigInt(this.op.imm_obj[1] as number);
                if (this.op.imm_obj[0] as number & 0x8000_0000) {
                    //subtract complement when most significant bit is set
                    int = int - 0x1_0000_0000_0000_0000n;
                }
                return `${int}n`;
            }
            else { return "" + this.op.imm_obj; }
        }
        if (this.op.opcode == namedClientScriptOps.pushlocalint || this.op.opcode == namedClientScriptOps.poplocallong || this.op.opcode == namedClientScriptOps.pushlocalstring || this.op.opcode == namedClientScriptOps.pushvar) {
            return getOpcodeName(calli, this.op);
        }
        if (this.op.opcode == namedClientScriptOps.joinstring) {
            let res = "`";
            for (let child of this.children) {
                if (child instanceof RawOpcodeNode && child.opinfo.id == namedClientScriptOps.pushconst && typeof child.op.imm_obj == "string") {
                    res += child.op.imm_obj;
                } else {
                    res += `\${${child.getCode(calli, indent)}}`;
                }
            }
            res += "`";
            return res;
        }
        return getOpcodeCallCode(calli, this.op, this.children, this.originalindex, indent);
    }
    getOpcodes(calli: ClientscriptObfuscation) {
        let body = this.children.flatMap(q => q.getOpcodes(calli));
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

function getNodeStackOut(node: AstNode) {
    if (node.knownStackDiff) {
        return node.knownStackDiff.out;
    }
    if (node instanceof RawOpcodeNode && node.opinfo.stackinfo) {
        return node.opinfo.stackinfo.out;
    }
    console.log("unknown stack out");
    return new StackList();
}

function getNodeStackIn(node: AstNode) {
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
                let op = new ComposedOp(popx.originalindex, (isminus ? (ispre ? "x--" : "--x") : (ispre ? "x++" : "++x")), popx.op.imm);
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
        if (node instanceof RawOpcodeNode && (node.op.opcode == namedClientScriptOps.poplocalint || node.op.opcode == namedClientScriptOps.poplocallong || node.op.opcode == namedClientScriptOps.poplocalstring || node.op.opcode == namedClientScriptOps.popvar)) {
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
        if (!(node instanceof ComposedOp) && !(node instanceof CodeBlockNode)) {
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
            let subif = getSingleChild(node.falsebranch, IfStatementNode);
            if (subif && subif.truebranch == node.truebranch) {
                let combined = new BranchingStatement({ opcode: namedClientScriptOps.shorting_or, imm: 0, imm_obj: null }, node.statement.originalindex);
                combined.push(node.statement);
                combined.push(subif.statement);
                node.setBranches(combined, node.truebranch, subif.falsebranch, subif.ifEndIndex);
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
                let isand = condnode.children.length <= 2 && grandparent.falsebranch == falseblock && grandparent.truebranch == parent;
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
    scriptid: number;
    returntype: StackList;
    argtype: StackList;
    constructor(scriptid: number, returntype: StackList, argtype: StackList) {
        super(0);
        this.scriptid = scriptid;
        this.returntype = returntype;
        this.argtype = argtype;
    }

    getCode(calli: ClientscriptObfuscation, indent: number) {
        let meta = calli.scriptargs.get(this.scriptid);
        let res = "";
        res += `//${meta?.scriptname ?? "unknown name"}\n`;
        res += `${codeIndent(indent)}function script${this.scriptid}(${this.argtype.toTypeScriptVarlist()}):${this.returntype.toTypeScriptReturnType()}`;
        res += this.children[0].getCode(calli, indent);
        return res;
    }
    getOpcodes(calli: ClientscriptObfuscation) {
        let body = this.children[0].getOpcodes(calli);

        //don't add the obsolete return call if there is already a return call and the type is empty
        if (!this.returntype.isEmpty() || body.at(-1)?.opcode != namedClientScriptOps.return) {
            let returnop = calli.getNamedOp(namedClientScriptOps.return);
            let constop = calli.getNamedOp(namedClientScriptOps.pushconst);
            let ret = this.returntype.clone();
            let pushconst = (type: StackType) => {
                if (type == "vararg") { throw new Error("unexpected"); }
                body.push({
                    opcode: constop.id,
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
            body.push({ opcode: returnop.id, imm: 0, imm_obj: null });
        }
        return body;
    }
}

function varArgtype(stringconst: string, lastintconst: number | unknown) {
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
            throw new Error("parsing vararg array, but legnth type was not an int");
        }
        for (let i = 0; i < lastintconst; i++) { indiff.int(); }
        indiff.int();//the length of the array on stack
    }
    return indiff;
}

function addKnownStackDiff(section: CodeBlockNode, calli: ClientscriptObfuscation) {
    let consts = new StackConstants();
    let constsknown = true;

    for (let node of section.children) {
        if (!(node instanceof RawOpcodeNode)) {
            continue;
        }

        if (node.opinfo.id == namedClientScriptOps.dbrow_getfield) {
            //args are rowid,tablefield,subrow
            let tablefield = consts.values.at(-2);
            if (typeof tablefield == "number") {
                let dbtable = (tablefield >> 12) & 0xffff;
                let columnid = (tablefield >> 4) & 0xff;
                let unk = tablefield & 0xf;
                let column = calli.dbtables.get(dbtable)?.unk01?.columndata.find(q => q.id == columnid);
                if (column) {
                    let out = (unk != 0 ? [typeToPrimitive(column.columns[unk - 1].type)] : column.columns.map(q => typeToPrimitive(q.type)));
                    node.knownStackDiff = new StackInOut(new StackList(["int", "int", "int"]), new StackList(out));
                }
            }
        }
        if (getParamOps.includes(node.opinfo.id)) {
            //args are structid/itemid,paramid
            let paramid = consts.values.at(-1);
            if (constsknown && typeof paramid == "number") {
                let param = calli.parammeta.get(paramid);
                if (!param) {
                    console.log("unknown param " + paramid);
                } else {
                    let outtype = (param.type ? typeToPrimitive(param.type.vartype) : "int");
                    let inputs = new StackList();
                    //all getparams except for cc_getparam require a target
                    if (node.opinfo.id != namedClientScriptOps.cc_getparam) { inputs.pushone("int"); }
                    inputs.pushone("int");
                    node.knownStackDiff = new StackInOut(inputs, new StackList([outtype]));
                }
            }
        } else if (node.opinfo.id == namedClientScriptOps.enum_getvalue) {
            //args are intypeid,outtypeid,enum,lookup
            let outtypeid = consts.values.at(-3);
            if (constsknown && typeof outtypeid == "number") {
                let outtype = typeToPrimitive(outtypeid);
                node.knownStackDiff = new StackInOut(new StackList(["int", "int", "int", "int"]), new StackList([outtype]));
            }
        } else if (node.opinfo.id == namedClientScriptOps.return) {
            let script = calli.scriptargs.get(section.scriptid);
            if (script && script.returns) {
                node.knownStackDiff = new StackInOut(script.returns, new StackList());
            }
        } else if (node.opinfo.id == namedClientScriptOps.gosub) {
            let script = calli.scriptargs.get(node.op.imm);
            if (script && script.arglist && script.returnlist) {
                node.knownStackDiff = new StackInOut(script.arglist, script.returnlist);
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

                let value = new StackList([varmeta.type]);
                let other = new StackList();
                node.knownStackDiff = new StackInOut(
                    (ispop ? value : other),
                    (ispop ? other : value)
                );
            }
        } else if (node.opinfo.id == namedClientScriptOps.pushconst) {
            if (node.op.imm == 0) {
                if (typeof node.op.imm_obj != "number") { throw new Error("unexpected"); }
                node.knownStackDiff = new StackInOut(new StackList(), new StackList(["int"]));
                node.knownStackDiff.constout = node.op.imm_obj;
            } else if (node.op.imm == 1) {
                node.knownStackDiff = new StackInOut(new StackList(), new StackList(["long"]));
                node.knownStackDiff.constout = node.op.imm_obj;
            } else if (node.op.imm == 2) {
                let stringconst = node.op.imm_obj as string;
                node.knownStackDiff = new StackInOut(new StackList(), new StackList(["string"]));
                node.knownStackDiff.constout = node.op.imm_obj;

                //a string like this indicates a vararg set where this string indicates the types
                //treat the entire thing as one vararg
                //only make use of this construct if it is at least 3 chars long
                //otherwise ignore the equation
                let varargmatch = stringconst.match(/^([ils]*)Y?$/);
                if (varargmatch && stringconst.length >= 3) {
                    let argtype = varArgtype(stringconst, consts.values.at(-1));
                    if (!argtype) { throw new Error("unexpected"); }
                    node.knownStackDiff = new StackInOut(argtype, new StackList(["vararg"]));
                    node.knownStackDiff.constout = node.op.imm_obj;
                } else if (varargmatch) {
                    node.unknownstack = true;
                    continue;
                }
            } else {
                throw new Error("unexpected");
            }
        }

        if (node.opinfo.id == namedClientScriptOps.pushconst) {
            consts.pushOne(node.op.imm_obj);
        } else if (node.knownStackDiff?.initializedthrough) {
            consts.applyInOut(node.knownStackDiff);
        } else if (node.opinfo.stackinfo.initializedthrough) {
            consts.applyInOut(node.opinfo.stackinfo);
        } else {
            constsknown = false;
        }

        if (!node.knownStackDiff && dynamicOps.includes(node.op.opcode)) {
            node.unknownstack = true;
        }
    }
    // return true;
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
    sections.forEach(q => addKnownStackDiff(q, calli))
    return sections;
}

export function parseClientScriptIm(calli: ClientscriptObfuscation, script: clientscript, fileid = -1, full = true) {
    let sections = generateAst(calli, script, script.opcodedata, fileid);
    let program = new CodeBlockNode(fileid, 0);

    if (full) {
        program.addSuccessor(sections[0]);
        for (let node: CodeBlockNode | null = program; node; node = node.findNext());
        sections.forEach(q => translateAst(q));
        fixControlFlow(program, script);
    } else {
        program.pushList(sections);
        for (let node: CodeBlockNode | null = program; node; node = node.findNext());
    }
    return { program, sections }
}
globalThis.parseClientScriptIm = parseClientScriptIm;

export function astToImJson(calli: ClientscriptObfuscation, func: ClientScriptFunction) {
    let opdata = func.getOpcodes(calli);
    let allargs = func.argtype.getStackdiff();
    let script: clientscript = {
        byte0: 0,
        switchsize: -1,
        switches: [],
        longargcount: allargs.long,
        stringargcount: allargs.string,
        intargcount: allargs.int,
        locallongcount: allargs.long,
        localstringcount: allargs.string,
        localintcount: allargs.int,
        instructioncount: opdata.length,
        opcodedata: opdata,
    }
    for (let op of opdata) {
        if (op.opcode == namedClientScriptOps.poplocalint || op.opcode == namedClientScriptOps.pushlocalint) { script.localintcount = Math.max(script.localintcount, op.imm + 1); }
        if (op.opcode == namedClientScriptOps.poplocallong || op.opcode == namedClientScriptOps.pushlocallong) { script.locallongcount = Math.max(script.locallongcount, op.imm + 1); }
        if (op.opcode == namedClientScriptOps.poplocalstring || op.opcode == namedClientScriptOps.pushlocalstring) { script.localstringcount = Math.max(script.localstringcount, op.imm + 1); }

        if (op.opcode == namedClientScriptOps.switch) {
            op.imm = script.switches.push(op.imm_obj as any) - 1;
            op.imm_obj = null;
        }
    }
    //1+foreach(2+sublen*(4+4))
    script.switchsize = 1 + script.switches.reduce((a, v) => a + 2 + v.length * (4 + 4), 0);
    return script;
}

export async function compileClientScript(source: CacheFileSource, code: string) {
    let calli = await prepareClientScript(source);

    let parseresult = clientscriptParser(calli).runparse(code);
    if (!parseresult.success) { throw new Error("failed to parse clientscript", { cause: parseresult.failedOn }); }
    if (parseresult.remaining != "") { throw new Error("failed to parse clientscript, left over: " + parseresult.remaining.slice(0, 100)); }
    return astToImJson(calli, parseresult.result);
}

export async function renderClientScript(source: CacheFileSource, buf: Buffer, fileid: number) {
    let calli = await prepareClientScript(source);
    let script = parse.clientscript.read(buf, source);
    let full = true;//TODO remove
    let { program, sections } = parseClientScriptIm(calli, script, fileid, full);
    globalThis[`cs${fileid}`] = program;//TODO remove

    let returntype = getReturnType(calli, script.opcodedata);
    let argtype = getArgType(script);
    let func = new ClientScriptFunction(fileid, returntype, new StackList([argtype]));
    let res = "";
    if (full) {
        func.push(program);
        res += func.getCode(calli, 0);
    } else {
        sections.forEach(q => res += q.getCode(calli, 0));
    }
    return res;
}