import { clientscript } from "../../generated/clientscript";
import { clientscriptdata } from "../../generated/clientscriptdata";
import { CacheFileSource } from "../cache";
import { parse } from "../opdecoder";
import { ClientScriptOp, ClientscriptObfuscation, OpcodeInfo, ScriptCandidate, StackDiff, getArgType, getReturnType, knownClientScriptOpNames, namedClientScriptOps } from "./callibrator";

export abstract class AstNode {
    debugString(calli: ClientscriptObfuscation) { return "unknown op"; }
}
export class MergeIntoNode extends AstNode {
    target: CodeBlockNode;
    constructor(target: CodeBlockNode) {
        super();
        this.target = target;
    }
    debugString() {
        return " ".repeat(5) + " merge into next";
    }
}

export class CodeBlockNode extends AstNode {
    startindex: number;
    scriptid: number;
    nodes: AstNode[] = [];
    possibleSuccessors: CodeBlockNode[] = [];
    constructor(scriptid: number, startindex: number) {
        super();
        this.scriptid = scriptid;
        this.startindex = startindex;
    }
    debugString(calli: ClientscriptObfuscation) {
        let res = `============ section ${this.startindex} ============\n`;
        for (let [subline, command] of this.nodes.entries()) {
            let currentline = this.startindex + subline;
            res += `${currentline.toString().padStart(4, " ")}: ${command.debugString(calli)}\n`;
        }
        return res;
    }
}

export class RawOpcodeNode extends AstNode {
    op: ClientScriptOp;
    opinfo: OpcodeInfo;
    opnr: number;
    constructor(op: ClientScriptOp, opinfo: OpcodeInfo, opnr: number) {
        super();
        this.op = op;
        this.opnr = opnr;
        this.opinfo = opinfo;
    }
    debugString(calli: ClientscriptObfuscation) {
        let opinfo = calli.decodedMappings.get(this.op.opcode);
        if (!opinfo) { throw new Error("unknown op"); }
        let name = knownClientScriptOpNames[this.op.opcode] ?? "unk";
        let res = "";
        let immobj = (typeof this.op.imm_obj == "string" ? `"${this.op.imm_obj}"` : (this.op.imm_obj ?? "").toString());
        res += `${this.op.opcode.toString().padStart(5, " ")} ${(name ?? "unk").slice(0, 15).padEnd(15, " ")} ${this.op.imm.toString().padStart(10, " ")} ${immobj.padStart(10, " ")}`;
        //TODO make subclass for this?
        if (opinfo.optype == "branch" || opinfo.id == namedClientScriptOps.jump) {
            res += `  jumpto ${this.opnr + 1 + this.op.imm}`;
        }
        return res;
    }
}

class GoSubNode extends RawOpcodeNode {
    subargs = new StackDiff();
    returntype = new StackDiff();
    constructor(cands: ScriptCandidate[], op: ClientScriptOp, opinfo: OpcodeInfo, opnr: number) {
        super(op, opinfo, opnr);
        let sub = cands.find(q => q.id == op.imm);
        if (sub?.returnType) { this.returntype = sub.returnType; }
        if (sub?.argtype) { this.subargs = sub.argtype; }
    }
    debugString(calli: ClientscriptObfuscation) {
        return `${super.debugString(calli)}  ${this.returntype}(${this.subargs})`;
    }
}

export function generateAst(cands: ScriptCandidate[], calli: ClientscriptObfuscation, script: clientscriptdata | clientscript, ops: ClientScriptOp[], scriptid: number) {
    let sections: CodeBlockNode[] = [];
    let getorMakeSection = (index: number) => {
        if (index >= ops.length) { throw new Error("tried to jump outside script"); }
        let section = sections.find(q => q.startindex == index);
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
            opnode = new GoSubNode(cands, op, info, index);
        } else {
            opnode = new RawOpcodeNode(op, info, index);
        }

        //check if other flows merge into this one
        let addrsection = sections.find(q => q.startindex == index);
        if (addrsection && addrsection != currentsection) {
            currentsection.nodes.push(new MergeIntoNode(addrsection));
            currentsection.possibleSuccessors.push(addrsection);
            currentsection = addrsection;
        }

        currentsection.nodes.push(opnode);

        if (opnode.opinfo.optype == "branch") {
            let jumpindex = nextindex + op.imm;
            let nextblock = getorMakeSection(nextindex);
            let jumpblock = getorMakeSection(jumpindex);
            currentsection.possibleSuccessors.push(nextblock, jumpblock);
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
    sections.sort((a, b) => a.startindex - b.startindex);
    return sections;
}

export async function renderClientScript(source: CacheFileSource, buf: Buffer, fileid: number) {
    let calli = source.getDecodeArgs().clientScriptDeob;
    if (!(calli instanceof ClientscriptObfuscation)) { throw new Error("no deob"); }

    let cands = await calli.loadCandidates(source);

    let script = parse.clientscript.read(buf, source);
    let sections = generateAst(cands, calli, script, script.opcodedata, fileid);

    let returntype = getReturnType(calli, script.opcodedata);
    let argtype = getArgType(script);
    let res = "";
    res += `script ${fileid} ${returntype} (${argtype})\n`;

    for (let section of sections) {
        res += section.debugString(calli);
    }
    return res;
}