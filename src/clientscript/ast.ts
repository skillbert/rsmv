import { clientscript } from "../../generated/clientscript";
import { clientscriptdata } from "../../generated/clientscriptdata";
import { CacheFileSource } from "../cache";
import { parse } from "../opdecoder";
import { ClientScriptOp, ClientscriptObfuscation, OpcodeInfo, ScriptCandidate, StackDiff, getArgType, getReturnType, knownClientScriptOpNames, namedClientScriptOps } from "./callibrator";

export abstract class AstNode {
    parent: AstNode | null = null;
    children: AstNode[] = [];
    originalindex: number;
    constructor(originalindex: number) {
        this.originalindex = originalindex;
    }
    debugString(indent: string, calli: ClientscriptObfuscation) {
        return `${indent} unknown op\n${this.debugStringArgs(indent, calli)}`;
    }
    debugStringArgs(indent: string, calli: ClientscriptObfuscation) {
        let res = "";
        if (this.children.length != 0) {
            res += `\n${indent}(\n`;
            for (let child of this.children) {
                res += `${child.debugString(indent + "\t", calli)}\n`;
            }
            res += `${indent})`;
        }
        return res;
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
    remove(node: AstNode) {
        let index = this.children.indexOf(node);
        if (index == -1) { throw new Error("tried to remove node that isn't a child"); }
        this.children.splice(index, 1);
        node.parent = null;
    }
}

export class CodeBlockNode extends AstNode {
    scriptid: number;
    possibleSuccessors: CodeBlockNode[] = [];
    constructor(scriptid: number, startindex: number) {
        super(startindex);
        this.scriptid = scriptid;
    }
    debugString(indent: string, calli: ClientscriptObfuscation) {
        let res = `============ section ${this.originalindex} ============\n`;
        // res += this.debugStringArgs(indent, calli);
        for (let [subline, command] of this.children.entries()) {
            res += `${command.debugString(indent, calli)}\n`;
        }
        if (this.possibleSuccessors.some(q => q.originalindex == this.originalindex + this.children.length)) {
            res += `${indent}${" ".repeat(5 + 1 + 5)} merge into next\n`;
        }
        return res;
    }
}

export class RawOpcodeNode extends AstNode {
    op: ClientScriptOp;
    opinfo: OpcodeInfo;
    opnr: number;
    constructor(index: number, op: ClientScriptOp, opinfo: OpcodeInfo, opnr: number) {
        super(index);
        this.op = op;
        this.opnr = opnr;
        this.opinfo = opinfo;
    }
    debugString(indent: string, calli: ClientscriptObfuscation) {
        let opinfo = calli.decodedMappings.get(this.op.opcode);
        if (!opinfo) { throw new Error("unknown op"); }
        let name = knownClientScriptOpNames[this.op.opcode] ?? "unk";
        let res = `${this.originalindex.toString().padStart(4, " ")}: `;
        let immobj = (typeof this.op.imm_obj == "string" ? `"${this.op.imm_obj}"` : (this.op.imm_obj ?? "").toString());
        res += `${this.op.opcode.toString().padStart(5, " ")} ${(name ?? "unk").slice(0, 15).padEnd(15, " ")} ${this.op.imm.toString().padStart(10, " ")} ${immobj.padStart(10, " ")}`;
        //TODO make subclass for this?
        if (opinfo.stackchange) {
            res += ` (${opinfo.stackchange})`;
        }
        if (opinfo.optype == "branch" || opinfo.id == namedClientScriptOps.jump) {
            res += `  jumpto ${this.opnr + 1 + this.op.imm}`;
        }
        res += this.debugStringArgs(indent, calli);
        return res;
    }
}

class RawGoSubNode extends RawOpcodeNode {
    argumentType = new StackDiff();
    returnType = new StackDiff();
    constructor(cands: ScriptCandidate[], index: number, op: ClientScriptOp, opinfo: OpcodeInfo, opnr: number) {
        super(index, op, opinfo, opnr);
        let sub = cands.find(q => q.id == op.imm);
        if (sub?.returnType) { this.returnType = sub.returnType; }
        if (sub?.argtype) { this.argumentType = sub.argtype; }
    }
    debugString(indent: string, calli: ClientscriptObfuscation) {
        return `${super.debugString(indent, calli)}  ${this.returnType}(${this.argumentType})${this.debugStringArgs(indent, calli)}`;
    }
}

class StackOpNode extends AstNode {
    ispop: boolean;
    amount: StackDiff;
    constructor(index: number, ispop: boolean, amount: StackDiff) {
        super(index);
        this.ispop = ispop;
        this.amount = amount;
    }
}

class FunctionCallNode extends AstNode {
    stackin: StackDiff;
    stackout: StackDiff;
    targetOpcode: OpcodeInfo | null = null;
    targetClientScript: number | null = null;
    arguments: AstNode[] = [];
    constructor(index: number, stackin: StackDiff, stackout: StackDiff) {
        super(index);
        this.stackin = stackin;
        this.stackout = stackout;
    }

    grabArguments(ctx: RewriteCursor) {
    }
}

class RewriteCursor {
    rootnode: AstNode;
    cursorStack: AstNode[] = [];
    constructor(node: AstNode) {
        this.rootnode = node;
        this.goToStart();
    }
    current() {
        return this.cursorStack.at(-1) ?? null;
    }
    findFirstChild(target: AstNode) {
        this.cursorStack.push(target);
        while (target.children.length != 0) {
            target = target.children[0];
            this.cursorStack.push(target);
        }
        return this.cursorStack.at(-1)!;
    }
    remove() {

    }
    next() {
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
        return this.findFirstChild(newnode);
    }
    prev() {
        let currentnode = this.cursorStack.at(-1);
        let parentnode = this.cursorStack.at(-2);
        if (!currentnode) { return null; }
        if (currentnode.children.length != 0) {
            let newnode = currentnode.children.at(-1)!;
            this.cursorStack.push(currentnode);
            return newnode;
        }
        this.cursorStack.pop();
        if (!parentnode) { return null; }

        let index = parentnode.children.indexOf(currentnode);
        if (index == 0) {
            return this.prev();
        }
        let newnode = parentnode.children[index - 1];
        this.cursorStack.push(newnode);
        return newnode;
    }
    goToStart() {
        this.cursorStack.length = 0;
        return this.findFirstChild(this.rootnode);
    }
    goToEnd() {
        this.cursorStack.length = 0;
        this.cursorStack.push(this.rootnode);
        return this.rootnode;
    }
}

function getNodeStackOut(node: AstNode) {
    let out = new StackDiff();
    if (node instanceof RawGoSubNode) {
        out.add(node.returnType);
    } else if (node instanceof RawOpcodeNode) {
        if (node.opinfo.stackchange) {
            out.add(node.opinfo.stackchange).minzero();
        }
    }
    return out;
}

function getNodeStackIn(node: AstNode) {
    let out = new StackDiff();
    if (node instanceof RawGoSubNode) {
        out.add(node.argumentType);
    } else if (node instanceof RawOpcodeNode) {
        if (node.opinfo.stackchange) {
            out.sub(node.opinfo.stackchange).minzero();
        }
    }
    return out;
}

export function translateAst(ast: CodeBlockNode) {
    let cursor = new RewriteCursor(ast);
    let usablestackdata: AstNode[] = [];
    for (let node = cursor.current(); node; node = cursor.next()) {
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

export function generateAst(cands: ScriptCandidate[], calli: ClientscriptObfuscation, script: clientscriptdata | clientscript, ops: ClientScriptOp[], scriptid: number) {
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

        if (info.optype == "branch") {
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
        let opnode: RawOpcodeNode;
        if (info.id == namedClientScriptOps.gosub) {
            opnode = new RawGoSubNode(cands, index, op, info, index);
        } else {
            opnode = new RawOpcodeNode(index, op, info, index);
        }

        //check if other flows merge into this one
        let addrsection = sections.find(q => q.originalindex == index);
        if (addrsection && addrsection != currentsection) {
            currentsection.possibleSuccessors.push(addrsection);
            currentsection = addrsection;
        }

        currentsection.push(opnode);

        if (opnode.opinfo.optype == "branch") {
            let jumpindex = nextindex + op.imm;
            let nextblock = getorMakeSection(nextindex);
            let jumpblock = getorMakeSection(jumpindex);
            if (info.id != namedClientScriptOps.jump) {
                currentsection.possibleSuccessors.push(nextblock);
            }
            currentsection.possibleSuccessors.push(jumpblock);
            currentsection = nextblock;
        } else if (opnode.opinfo.optype == "return") {
            if (index != ops.length - 1) {
                //dead code will be handled elsewhere
                currentsection = getorMakeSection(nextindex);
            }
        } else if (opnode.opinfo.id == namedClientScriptOps.switch) {
            let cases = script.switches[opnode.op.imm];
            if (!cases) { throw new Error("no matching cases in script"); }

            let nextblock = getorMakeSection(nextindex);
            currentsection.possibleSuccessors.push(nextblock)
            for (let cond of cases) {
                let jumpblock = getorMakeSection(nextindex + cond.label);
                currentsection.possibleSuccessors.push(jumpblock);
            }
            currentsection = nextblock;
        }
    }
    sections.sort((a, b) => a.originalindex - b.originalindex);
    return sections;
}

export async function renderClientScript(source: CacheFileSource, buf: Buffer, fileid: number) {
    let calli = source.getDecodeArgs().clientScriptDeob;
    if (!(calli instanceof ClientscriptObfuscation)) { throw new Error("no deob"); }

    let cands = await calli.loadCandidates(source);

    let script = parse.clientscript.read(buf, source);
    let sections = generateAst(cands, calli, script, script.opcodedata, fileid);
    // sections = sections.map(q => translateAst(q));

    let returntype = getReturnType(calli, script.opcodedata);
    let argtype = getArgType(script);
    let res = "";
    res += `script ${fileid} ${returntype} (${argtype})\n`;

    for (let section of sections) {
        res += section.debugString("", calli);
    }
    return res;
}