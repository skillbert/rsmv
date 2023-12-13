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
    getName(calli: ClientscriptObfuscation): { name: string, extra: string } {
        return { name: "unk", extra: "" };
    }
    getCode(calli: ClientscriptObfuscation): string {
        return `unk(${this.children.map(q => q.getCode(calli)).join(",")})`
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
    getCode(calli: ClientscriptObfuscation) {
        let name = this.getName(calli);
        return `${name.name} = ${this.children.map(q => q.getCode(calli)).join(",")}`
    }
}

export class CodeBlockNode extends AstNode {
    scriptid: number;
    possibleSuccessors: CodeBlockNode[] = [];
    firstPointer: CodeBlockNode | null = null;
    lastPointer: CodeBlockNode | null = null;
    branchEndNode: CodeBlockNode | null = null;
    indentDepth = -1;

    hasUnexplainedChildren = false;
    constructor(scriptid: number, startindex: number) {
        super(startindex);
        this.scriptid = scriptid;
    }
    addSuccessor(block: CodeBlockNode) {
        if (!block.firstPointer || this.originalindex < block.firstPointer.originalindex) { block.firstPointer = this; }
        if (!block.lastPointer || this.originalindex > block.lastPointer.originalindex) { block.lastPointer = this; }

        this.possibleSuccessors.push(block);
        // this.branchEndNode = (this.possibleSuccessors.length == 1 ? this.possibleSuccessors[0] : null);
    }
    findNext(indent: number) {
        this.indentDepth = indent;
        if (this.possibleSuccessors.length == 0) {
            this.branchEndNode = null;
        } else if (this.possibleSuccessors.length == 1) {
            if (this.possibleSuccessors[0].originalindex <= this.originalindex) {
                this.branchEndNode = null;//looping jump
            } else {
                this.branchEndNode = this.possibleSuccessors[0];
            }
        } else {
            let optionstates = this.possibleSuccessors as (CodeBlockNode | null)[];
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
                optionstates[optionstates.indexOf(first)] = first.findNext(indent + 1);
            }
        }
        return this.branchEndNode;
    }
    getName(calli: ClientscriptObfuscation) {
        return { name: `code block`, extra: "" };
    }
    getCode(calli: ClientscriptObfuscation) {
        let code = "";
        code += `============ section ${this.originalindex} ${this.branchEndNode?.originalindex ?? "nope"} ============\n`;
        // code += `${node.originalindex.toString().padStart(4, " ")}: ${(indent + optext.name).slice(0, 20).padEnd(20, " ")}`;
        // code += optext.extra;
        // code += "\n";
        for (let child of this.children) {
            code += `${(child.originalindex + ":").padEnd(4 + this.indentDepth * 4, " ")} ` + child.getCode(calli) + "\n";
        }
        return code;
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
    getCode(calli: ClientscriptObfuscation) {
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
                    return `${name} = ${this.children.map(q => q.getCode(calli)).join(",")}`;
                }
            }
        }
        if (opinfo.optype == "branch") {
            name += `<${this.op.imm + this.originalindex + 1}>`;
        } else if (opinfo.optype == "gosub") {
            name += `<${this.op.imm}>`
        }
        return `${name}(${this.children.map(q => q.getCode(calli)).join(",")})`;
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
    replaceNode(newnode: AstNode) {
        let node = this.current();
        if (!node) { throw new Error("no node selected"); }
        if (!node.parent) { throw new Error("cannot replace root node"); }
        node.parent.replaceChild(node, newnode);
        this.cursorStack[this.cursorStack.length - 1] = newnode;
        return newnode;
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
        let opnode = new RawOpcodeNode(index, op, info, index);

        //check if other flows merge into this one
        let addrsection = sections.find(q => q.originalindex == index);
        if (addrsection && addrsection != currentsection) {
            currentsection.addSuccessor(addrsection);
            currentsection = addrsection;
        }

        currentsection.push(opnode);

        if (opnode.opinfo.optype == "branch") {
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

            let nextblock = getorMakeSection(nextindex);
            currentsection.addSuccessor(nextblock);
            for (let cond of cases) {
                let jumpblock = getorMakeSection(nextindex + cond.label);
                currentsection.addSuccessor(jumpblock);
            }
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

    let script = parse.clientscript.read(buf, source);
    let sections = generateAst(calli, script, script.opcodedata, fileid);
    sections.forEach(translateAst);
    for (let node: CodeBlockNode | null = sections[0]; node; node = node.findNext(0));

    let returntype = getReturnType(calli, script.opcodedata);
    let argtype = getArgType(script);
    let res = "";
    res += `script ${fileid} ${returntype} (${argtype})\n`;

    for (let section of sections) {
        res += section.getCode(calli);
    }
    return res;
}