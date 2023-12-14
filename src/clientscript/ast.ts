import { clientscript } from "../../generated/clientscript";
import { clientscriptdata } from "../../generated/clientscriptdata";
import { CacheFileSource } from "../cache";
import { parse } from "../opdecoder";
import { ClientScriptOp, ClientscriptObfuscation, OpcodeInfo, ScriptCandidate, StackDiff, getArgType, getReturnType, knownClientScriptOpNames, namedClientScriptOps } from "./callibrator";

function codeIndent(amount: number, linenr = -1) {
    return (linenr == -1 ? "" : linenr + ":").padEnd(5 + amount * 4, " ");
}

function findFirstAddress(node: AstNode) {
    let addr = node.originalindex;
    //has to be the very first child
    for (let sub = node; sub; sub = sub.children[0]) {
        addr = Math.min(addr, sub.originalindex);
    }
    return addr;
}

export abstract class AstNode {
    parent: AstNode | null = null;
    children: AstNode[] = [];
    originalindex: number;
    constructor(originalindex: number) {
        this.originalindex = originalindex;
    }
    getName(calli: ClientscriptObfuscation): { name: string, extra: string } {
        return { name: "unk", extra: "" };
    }
    getCode(calli: ClientscriptObfuscation, indent: number): string {
        return `unk(${this.children.map(q => q.getCode(calli, indent)).join(",")})`
    }
    push(node: AstNode) {
        node.parent?.remove(node);
        this.children.push(node);
        node.parent = this;
    }
    unshift(node: AstNode) {
        node.parent?.remove(node);
        this.children.unshift(node);
        node.parent = this;
    }
    replaceChild(oldnode: AstNode, newnode: AstNode) {
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

class VarAssignNode extends AstNode {
    varops: AstNode[] = [];
    getName(calli: ClientscriptObfuscation) {
        let name = `${this.varops.map(q => q instanceof RawOpcodeNode ? (q.op.opcode == namedClientScriptOps.poplocalstring ? "string" : "int") + q.op.imm : "??")}`;
        return { name: name, extra: "" };
    }
    getCode(calli: ClientscriptObfuscation, indent: number) {
        let name = this.getName(calli);
        return `${name.name} = ${this.children.map(q => q.getCode(calli, indent)).join(",")}`
    }
}

export class CodeBlockNode extends AstNode {
    scriptid: number;
    possibleSuccessors: CodeBlockNode[] = [];
    firstPointer: CodeBlockNode | null = null;
    lastPointer: CodeBlockNode | null = null;
    branchEndNode: CodeBlockNode | null = null;
    maxEndIndex = -1;

    hasUnexplainedChildren = false;
    constructor(scriptid: number, startindex: number) {
        super(startindex);
        this.scriptid = scriptid;
    }
    addSuccessor(block: CodeBlockNode) {
        if (!block.firstPointer || this.originalindex < block.firstPointer.originalindex) { block.firstPointer = this; }
        if (!block.lastPointer || this.originalindex > block.lastPointer.originalindex) { block.lastPointer = this; }
        if (this.possibleSuccessors.includes(block)) { throw new Error("added same successor twice"); }
        if (!block) { throw new Error("added null successor"); }
        this.possibleSuccessors.push(block);
    }
    mergeBlock(block: CodeBlockNode) {
        for (let child of block.children) {
            child.parent = this;
        }
        this.children.push(...block.children);
        this.possibleSuccessors = block.possibleSuccessors ?? [];
        this.branchEndNode = block.branchEndNode;
    }
    findNext() {
        if (this.possibleSuccessors.length == 0) {
            this.branchEndNode = null;
        } else if (this.possibleSuccessors.length == 1) {
            if (this.possibleSuccessors[0].originalindex <= this.originalindex) {
                this.branchEndNode = null;//TODO looping jump
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
        return this.branchEndNode;
    }
    getName(calli: ClientscriptObfuscation) {
        return { name: `code block`, extra: "" };
    }
    getCode(calli: ClientscriptObfuscation, indent: number) {
        let code = "";
        // code += `============ section ${this.originalindex} ${this.branchEndNode?.originalindex ?? "nope"} ============\n`;
        // code += `${node.originalindex.toString().padStart(4, " ")}: ${(indent + optext.name).slice(0, 20).padEnd(20, " ")}`;
        // code += optext.extra;
        // code += "\n";
        for (let child of this.children) {
            code += `${codeIndent(indent, child.originalindex)}${child.getCode(calli, indent)}\n`;
        }
        return code;
    }
}

type BinaryOpType = "||" | "&&" | ">" | ">=" | "<" | "<=" | "==" | "!=";
class BinaryOpStatement extends AstNode {
    type: BinaryOpType;
    left: AstNode;
    right: AstNode;
    constructor(type: BinaryOpType, originalindex: number, left: AstNode, right: AstNode) {
        super(originalindex);
        this.type = type;
        this.left = left;
        this.right = right;
        this.children.push(left, right);
        left.parent = this;
        right.parent = this;
    }

    getCode(calli: ClientscriptObfuscation, indent: number) {
        return `(${this.left.getCode(calli, indent)} ${this.type} ${this.right.getCode(calli, indent)})`;
    }
}

class WhileLoopStatementNode extends AstNode {
    statement: AstNode;
    body: CodeBlockNode;
    constructor(originnode: IfStatementNode) {
        super(originnode.originalindex);
        if (originnode.falsebranch) { throw new Error("cannot have else branch in loop"); }
        this.statement = originnode.statement;
        this.statement.parent = this;
        this.body = originnode.truebranch;
    }
    getCode(calli: ClientscriptObfuscation, indent: number) {
        let res = `while(${this.statement.getCode(calli, indent)}){\n`;
        res += this.body.getCode(calli, indent + 1);
        res += `${codeIndent(indent)}}`;
        return res;
    }
}

class SwitchStatementNode extends AstNode {
    branches: { value: number, block: CodeBlockNode }[] = [];
    valueop: AstNode;
    defaultbranch: CodeBlockNode | null = null;
    constructor(valueop: RawOpcodeNode, scriptjson: clientscript, nodes: CodeBlockNode[], endindex: number) {
        super(valueop.originalindex);
        if (valueop.children.length != 1) { throw new Error("switch value expected"); }
        this.valueop = valueop.children[0];
        this.valueop.parent = this;

        let cases = scriptjson.switches[valueop.op.imm];
        if (!cases) { throw new Error("no matching cases in script"); }
        if (nodes.length != cases.length + 1) { throw new Error("switch cases and nodes don't match"); }
        for (let [index, casev] of cases.entries()) {
            let node = nodes[index];
            this.branches.push({ value: casev.value, block: node });
            node.parent = this;
            node.maxEndIndex = endindex;
            this.children.push(node);
            if (node.originalindex != valueop.originalindex + 1 + casev.label) {
                throw new Error("switch branches don't match");
            }
        }


        let defaultblock: CodeBlockNode | null = nodes.at(-1)!;
        if (defaultblock.children.length == 1 && defaultblock.children[0] instanceof RawOpcodeNode && defaultblock.children[0].opinfo.id == namedClientScriptOps.jump) {
            if (defaultblock.possibleSuccessors.length != 1) { throw new Error("jump successor branch expected"); }
            defaultblock = defaultblock.possibleSuccessors[0];
            if (defaultblock.originalindex == endindex) {
                defaultblock = null;
            }
        }

        if (defaultblock) {
            this.defaultbranch = defaultblock;
            this.defaultbranch.parent = this;
            this.defaultbranch.maxEndIndex = endindex;
            this.children.push(defaultblock);
        }
    }
    getCode(calli: ClientscriptObfuscation, indent: number) {
        let res = "";
        res += `switch(${this.valueop.getCode(calli, indent)}){\n`;
        for (let branch of this.branches) {
            res += `${codeIndent(indent + 1, branch.block.originalindex)}case ${branch.value}:{\n`;
            res += branch.block.getCode(calli, indent + 2);
            res += `${codeIndent(indent + 1)}}\n`;
        }
        if (this.defaultbranch) {
            res += `${codeIndent(indent + 1)}default:{\n`;
            res += this.defaultbranch.getCode(calli, indent + 2);
            res += `${codeIndent(indent + 1)}}\n`;
        }
        res += `${codeIndent(indent)}}`;
        return res;
    }
}

class IfStatementNode extends AstNode {
    truebranch: CodeBlockNode;
    falsebranch: CodeBlockNode | null;
    statement: AstNode;
    endblock: CodeBlockNode;
    constructor(statement: AstNode, endblock: CodeBlockNode, truebranch: CodeBlockNode, falsebranch: CodeBlockNode | null, endindex: number) {
        if (truebranch == falsebranch) { throw new Error("unexpected"); }
        super(statement.originalindex);
        this.endblock = endblock;

        this.statement = statement;
        this.children.push(statement);
        statement.parent = this;

        this.truebranch = truebranch;
        this.children.push(truebranch);
        truebranch.parent = this;
        truebranch.maxEndIndex = endindex;

        this.falsebranch = falsebranch;
        if (falsebranch) {
            this.children.push(falsebranch);
            falsebranch.parent = this;
            falsebranch.maxEndIndex = endindex;
        }
    }
    getCode(calli: ClientscriptObfuscation, indent: number) {
        let res = `if(${this.statement.getCode(calli, indent)}){\n`;
        res += `${this.truebranch?.getCode(calli, indent + 1)}`;
        if (this.falsebranch) {
            res += `${codeIndent(indent)}}else{\n`;
            res += `${this.falsebranch.getCode(calli, indent + 1)}`;
        }
        res += `${codeIndent(indent)}}`;
        return res;
    }
}

export class RawOpcodeNode extends AstNode {
    op: ClientScriptOp;
    opinfo: OpcodeInfo;
    knownStackDiff: { in: StackDiff, out: StackDiff } | null = null;
    opnr: number;
    constructor(index: number, op: ClientScriptOp, opinfo: OpcodeInfo, opnr: number) {
        super(index);
        this.op = op;
        this.opnr = opnr;
        this.opinfo = opinfo;
    }
    getName(calli: ClientscriptObfuscation) {
        let opinfo = calli.decodedMappings.get(this.op.opcode);
        if (!opinfo) { throw new Error("unknown op"); }
        let name = knownClientScriptOpNames[this.op.opcode] ?? `unk${this.op.opcode}`;
        let res = "";
        res += (typeof this.op.imm_obj == "string" ? `"${this.op.imm_obj}"` : (this.op.imm_obj ?? "").toString());
        //TODO make subclass for this?
        if (this.knownStackDiff) {
            res += ` ${this.knownStackDiff.out}(${this.knownStackDiff.in})`;
        } else if (opinfo.stackchange) {
            res += ` (${opinfo.stackchange})`;
        }
        if (opinfo.stackmaxpassthrough) {
            res += ` <${opinfo.stackmaxpassthrough}>`;
        }
        return { name: name, extra: res };
    }
    getCode(calli: ClientscriptObfuscation, indent: number) {
        let opinfo = calli.decodedMappings.get(this.op.opcode);
        if (!opinfo) { throw new Error("unknown op"); }
        let { name, extra } = this.getName(calli);
        if (this.op.opcode == namedClientScriptOps.pushconst) {
            return typeof this.op.imm_obj == "string" ? `"${this.op.imm_obj.replace(/(["\\])/g, "\\$1")}"` : "" + this.op.imm_obj;
        }
        if (this.op.opcode == namedClientScriptOps.pushlocalint) {
            return `int${this.op.imm}`;
        } else if (this.op.opcode == namedClientScriptOps.pushlocalstring) {
            return `string${this.op.imm}`;
        }
        if (this.opinfo.id == namedClientScriptOps.pushvar || this.opinfo.id == namedClientScriptOps.popvar) {
            let varmeta = calli.getClientVarMeta(this.op.imm);
            if (varmeta) {
                let name = `var${varmeta.name}_${varmeta.varid}`;
                if (this.opinfo.id == namedClientScriptOps.pushvar) {
                    return name;
                } else {
                    return `${name} = ${this.children.map(q => q.getCode(calli, indent)).join(",")}`;
                }
            }
        }
        if (opinfo.optype == "branch" || opinfo.id == namedClientScriptOps.jump) {
            name += `<${this.op.imm + this.originalindex + 1}>`;
        } else if (opinfo.optype == "gosub") {
            name += `<${this.op.imm}>`;
        } else if (this.op.imm != 0) {
            name += `<${this.op.imm}>`;
        }
        return `${name}(${this.children.map(q => q.getCode(calli, indent)).join(",")})`;
    }
}

class RewriteCursor {
    rootnode: AstNode;
    cursorStack: AstNode[] = [];
    stalled = true;
    constructor(node: AstNode) {
        this.rootnode = node;
        this.goToStart();
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
    let out = new StackDiff();
    if (node instanceof RawOpcodeNode) {
        if (node.knownStackDiff) {
            out.add(node.knownStackDiff.out);
        } else if (node.opinfo.stackchange) {
            out.add(node.opinfo.stackchange);
            out.minzero();
            if (node.opinfo.stackmaxpassthrough) {
                out.add(node.opinfo.stackmaxpassthrough);
            }
        }
    }
    return out;
}

function getNodeStackIn(node: AstNode) {
    let out = new StackDiff();
    if (node instanceof RawOpcodeNode) {
        if (node.knownStackDiff) {
            out.add(node.knownStackDiff.in);
        } else if (node.opinfo.stackchange) {
            out.sub(node.opinfo.stackchange);
            out.minzero();
            if (node.opinfo.stackmaxpassthrough) {
                out.add(node.opinfo.stackmaxpassthrough);
            }
        }
    } else if (node instanceof VarAssignNode) {
        for (let child of node.varops) {
            out.add(getNodeStackIn(child));
        }
    }
    return out;
}

export function translateAst(ast: CodeBlockNode) {
    let cursor = new RewriteCursor(ast);

    //merge variable assign nodes
    let currentassignnode: VarAssignNode | null = null;
    for (let node = cursor.goToStart(); node; node = cursor.next()) {
        let isassign = node instanceof RawOpcodeNode && (node.op.opcode == namedClientScriptOps.poplocalint || node.op.opcode == namedClientScriptOps.poplocalstring)
        if (isassign) {
            if (currentassignnode && currentassignnode.parent != node.parent) {
                throw new Error("ast is expected to be flat at this stage");
            }
            if (!currentassignnode) {
                currentassignnode = new VarAssignNode(node.originalindex);
                cursor.replaceNode(currentassignnode);
            } else {
                cursor.remove();
            }
            currentassignnode.varops.push(node);
        } else {
            currentassignnode = null;
        }
    }

    //find call arguments
    let usablestackdata: AstNode[] = [];
    for (let node = cursor.goToStart(); node; node = cursor.next()) {
        let argtype = getNodeStackIn(node);
        let outtype = getNodeStackOut(node);
        while (!argtype.isEmpty() && usablestackdata.length != 0) {
            let stackel = usablestackdata.at(-1)!;
            let outtype = getNodeStackOut(stackel);
            if (outtype.isEmpty() || !outtype.lteq(argtype)) { break; }
            node.unshift(stackel);
            usablestackdata.pop();
            argtype.sub(outtype);
        }
        //TODO push opcodes to fill rest of argtype in case we called break
        // node.children.unshift({somethingwithpoptype:argtype});
        if (outtype.isEmpty()) {
            usablestackdata = [];
        } else {
            usablestackdata.push(node);
        }
    }
    return ast;
}
function fixControlFlow(ast: AstNode, scriptjson: clientscript) {
    let cursor = new RewriteCursor(ast);
    //find if statements
    for (let node = cursor.goToStart(); node; node = cursor.next()) {
        if (node instanceof RawOpcodeNode && node.opinfo.optype == "branch") {
            let parent = node.parent;
            if (!(parent instanceof CodeBlockNode) || parent.possibleSuccessors.length != 2) { throw new Error("if op parent is not compatible"); }
            if (parent.children.at(-1) != node) { throw new Error("if op is not last op in codeblock"); }
            if (!parent.branchEndNode) { throw new Error("if statement parent end node expected"); }
            //TODO move this insto if class
            let optype: BinaryOpType;
            if (node.op.opcode == namedClientScriptOps.branch_eq) { optype = "=="; }
            else if (node.op.opcode == namedClientScriptOps.branch_gt) { optype = ">"; }
            else if (node.op.opcode == namedClientScriptOps.branch_gteq) { optype = ">="; }
            else if (node.op.opcode == namedClientScriptOps.branch_lt) { optype = "<"; }
            else if (node.op.opcode == namedClientScriptOps.branch_lteq) { optype = "<="; }
            else if (node.op.opcode == namedClientScriptOps.branch_not) { optype = "!="; }
            else { throw new Error("unknown branch type"); }

            let trueblock = parent.possibleSuccessors[1];
            let falseblock: CodeBlockNode | null = parent.possibleSuccessors[0];
            if (falseblock.children.length == 1 && falseblock.children[0] instanceof RawOpcodeNode && falseblock.children[0].opinfo.id == namedClientScriptOps.jump) {
                if (falseblock.possibleSuccessors.length != 1) { throw new Error("jump successor branch expected"); }
                falseblock = falseblock.possibleSuccessors[0];
                if (falseblock == parent.branchEndNode) {
                    falseblock = null;
                }
            }
            if (!(trueblock instanceof CodeBlockNode)) { throw new Error("true branch isn't a codeblock"); }
            if (falseblock && !(falseblock instanceof CodeBlockNode)) { throw new Error("false branch exists but is not a codeblock"); }
            let condnode = new BinaryOpStatement(optype, node.originalindex, node.children[0], node.children[1]);

            let grandparent = parent?.parent;
            if (parent instanceof CodeBlockNode && parent.children.length == 1 && grandparent instanceof IfStatementNode && grandparent.endblock == parent.branchEndNode) {
                if (grandparent.truebranch == trueblock && grandparent.falsebranch == parent) {
                    let combinedcond = new BinaryOpStatement("||", grandparent.originalindex, grandparent.statement, condnode);
                    grandparent.statement = combinedcond;
                    grandparent.falsebranch = falseblock;
                    continue;
                } else if (grandparent.falsebranch == falseblock && grandparent.truebranch == parent) {
                    let combinedcond = new BinaryOpStatement("&&", grandparent.originalindex, grandparent.statement, condnode);
                    grandparent.statement = combinedcond;
                    grandparent.truebranch = trueblock;
                    continue;
                }
            }

            let ifstatement = new IfStatementNode(condnode, parent.branchEndNode, trueblock, falseblock, parent.branchEndNode.originalindex);
            cursor.replaceNode(ifstatement);
            cursor.setFirstChild(ifstatement, true);
        }
        if (node instanceof RawOpcodeNode && node.opinfo.id == namedClientScriptOps.switch) {
            if (!(node.parent instanceof CodeBlockNode) || !node.parent.branchEndNode) { throw new Error("code block expected"); }
            let casestatement = new SwitchStatementNode(node, scriptjson, node.parent.possibleSuccessors, node.parent.branchEndNode.originalindex);
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
                let grandparent = node.parent?.parent;
                let grandgrandparent = grandparent?.parent;
                if (!(grandparent instanceof IfStatementNode) || !(grandgrandparent instanceof CodeBlockNode)) { throw new Error("unexpected"); }
                if (grandgrandparent.children.at(-1) != grandparent || findFirstAddress(grandparent) != target) { throw new Error("unexpected"); }
                let loopstatement = new WhileLoopStatementNode(grandparent);
                grandgrandparent.replaceChild(grandparent, loopstatement);
                cursor.rebuildStack();
                cursor.remove();
            }
        }
        if (node instanceof CodeBlockNode && node.branchEndNode) {
            if (node.maxEndIndex == -1 || node.branchEndNode.originalindex < node.maxEndIndex) {
                cursor.prev();
                node.mergeBlock(node.branchEndNode);
            }
        }
    }

}

function addKnownStackDiff(section: CodeBlockNode, calli: ClientscriptObfuscation) {

    const problemops = [
        // 42,//42 PUSH_VARC_INT can somehow also push long?
        // 43,
        10023,
        10672,
        10110,
        10717,
        10063,
        10885,
        10699,
        10815,
        10735,//either this or 10736
    ];

    let lastintconst = -1;
    for (let node of section.children) {
        if (!(node instanceof RawOpcodeNode)) {
            section.hasUnexplainedChildren = true;
            return false;
        }
        if (node.opinfo.id == namedClientScriptOps.return) {
            let script = calli.scriptargs.get(section.scriptid);
            if (!script || !script.returns) {
                section.hasUnexplainedChildren = true;
                return false;
            }
            node.knownStackDiff = { in: script.returns, out: new StackDiff() };
        } else if (node.opinfo.id == namedClientScriptOps.gosub) {
            let script = calli.scriptargs.get(node.op.imm);
            if (!script || !script.returns || !script.args) {
                section.hasUnexplainedChildren = true;
                return false;
            }
            node.knownStackDiff = { in: script.args, out: script.returns };
        } else if (node.opinfo.id == namedClientScriptOps.joinstring) {
            node.knownStackDiff = {
                in: new StackDiff(0, 0, node.op.imm),
                out: new StackDiff(0, 0, 1)
            }
        } else if (node.opinfo.id == namedClientScriptOps.pushvar || node.opinfo.id == namedClientScriptOps.popvar) {
            let varmeta = calli.getClientVarMeta(node.op.imm);
            if (!varmeta) {
                section.hasUnexplainedChildren = true;
                return false;
            }
            let ispop = node.opinfo.id == namedClientScriptOps.popvar;

            node.knownStackDiff = {
                in: (ispop ? varmeta.diff : new StackDiff()),
                out: (ispop ? new StackDiff() : varmeta.diff)
            };
        } else if (node.opinfo.id == namedClientScriptOps.pushconst) {
            if (node.op.imm == 0) {
                node.knownStackDiff = {
                    in: new StackDiff(),
                    out: new StackDiff(1)
                }
                if (typeof node.op.imm_obj != "number") { throw new Error("unexpected"); }
                lastintconst = node.op.imm_obj;
            } else if (node.op.imm == 1) {
                node.knownStackDiff = {
                    in: new StackDiff(),
                    out: new StackDiff(0, 1)
                };
            } else if (node.op.imm == 2) {
                let stringconst = node.op.imm_obj as string;
                //a string like this indicates a vararg set where this string indicates the types
                //treat the entire thing as one vararg
                let varargmatch = stringconst.match(/^[ils]*Y?$/);
                if (varargmatch) {
                    //only make use of this construct if it is at least 3 chars long
                    //otherwise ignore the equation
                    if (stringconst.length >= 3) {
                        let indiff = new StackDiff(
                            stringconst.match(/i/g)?.length ?? 0,
                            stringconst.match(/l/g)?.length ?? 0,
                            stringconst.match(/s/g)?.length ?? 0
                        );
                        let outdiff = new StackDiff(0, 0, 0, 1);
                        node.knownStackDiff = { in: indiff, out: outdiff };
                        //variable number of ints
                        if (stringconst.includes("Y")) {
                            indiff.int++;//number of ints to take from stack
                            indiff.int += lastintconst;
                        }
                    } else {
                        section.hasUnexplainedChildren = true;
                    }
                } else {
                    node.knownStackDiff = {
                        in: new StackDiff(),
                        out: new StackDiff(0, 0, 1)
                    }
                }
            } else {
                throw new Error("unexpected");
            }
        }

        if (problemops.includes(node.op.opcode)) {
            section.hasUnexplainedChildren = true;
        }
    }
    return true;
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
        let info = calli.decodedMappings.get(op.opcode)!;
        if (!info) { throw new Error("tried to add unknown op to AST"); }

        if (info.optype == "branch" || info.id == namedClientScriptOps.jump) {
            let jumpindex = nextindex + op.imm;
            getorMakeSection(nextindex);
            getorMakeSection(jumpindex);
        }
    }

    //write the opcodes
    for (let [index, op] of ops.entries()) {
        let nextindex = index + 1;
        let info = calli.decodedMappings.get(op.opcode)!;
        if (!info) { throw new Error("tried to add unknown op to AST"); }
        let opnode = new RawOpcodeNode(index, op, info, index);

        //check if other flows merge into this one
        let addrsection = sections.find(q => q.originalindex == index);
        if (addrsection && addrsection != currentsection) {
            currentsection.addSuccessor(addrsection);
            currentsection = addrsection;
        }

        currentsection.push(opnode);

        if (opnode.opinfo.optype == "branch" || info.id == namedClientScriptOps.jump) {
            let jumpindex = nextindex + op.imm;
            let nextblock = getorMakeSection(nextindex);
            let jumpblock = getorMakeSection(jumpindex);
            if (info.id != namedClientScriptOps.jump) {
                currentsection.addSuccessor(nextblock);
            }
            currentsection.addSuccessor(jumpblock);
            currentsection = nextblock;
        } else if (opnode.opinfo.optype == "return") {
            if (index != ops.length - 1) {
                //dead code will be handled elsewhere
                currentsection = getorMakeSection(nextindex);
            }
        } else if (opnode.opinfo.id == namedClientScriptOps.switch) {
            let cases = script.switches[opnode.op.imm];
            if (!cases) { throw new Error("no matching cases in script"); }

            for (let cond of cases) {
                let jumpblock = getorMakeSection(nextindex + cond.label);
                currentsection.addSuccessor(jumpblock);
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

export async function renderClientScript(source: CacheFileSource, buf: Buffer, fileid: number) {
    let calli = source.getDecodeArgs().clientScriptDeob;
    if (!(calli instanceof ClientscriptObfuscation)) { throw new Error("no deob"); }
    const full = true;

    let script = parse.clientscript.read(buf, source);
    let sections = generateAst(calli, script, script.opcodedata, fileid);
    let program = sections[0];
    for (let node: CodeBlockNode | null = program; node; node = node.findNext());
    if (full) {
        sections.forEach(q => translateAst(q));
        fixControlFlow(program, script);
    }

    let returntype = getReturnType(calli, script.opcodedata);
    let argtype = getArgType(script);
    let res = "";
    res += `script ${fileid} ${returntype} (${argtype})\n`;
    if (full) {
        res += program.getCode(calli, 0);
    } else {
        for (let section of sections) {
            res += section.getCode(calli, 0);
        }
    }
    return res;
}