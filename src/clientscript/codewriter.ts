import { boundMethod } from "autobind-decorator";
import { AstNode, BranchingStatement, ClientScriptFunction, CodeBlockNode, ComposedOp, FunctionBindNode, IfStatementNode, IntrinsicNode, RawOpcodeNode, SwitchStatementNode, VarAssignNode, WhileLoopStatementNode, getSingleChild, SubcallNode } from "./ast";
import { ClientscriptObfuscation } from "./callibrator";
import { ClientScriptSubtypeSolver } from "./subtypedetector";
import { ClientScriptOp, PrimitiveType, binaryOpSymbols, branchInstructionsOrJump, getOpName, namedClientScriptOps, subtypeToTs, subtypes } from "./definitions";

/**
 * known compiler differences
 * - in some situations bunny hop jumps in nested ifs are merged while the jagex compiler doesn't
 * - default return values for int can be -1 for some specialisations while this compiler doesn't know about those
 * - this ast tree automatically strips dead code so round trips won't be identical if there dead code
 * - when a script has no return values but the original code had an explicit return then this compiler won't output that
 * - the jagex compiler uses some unknown logic to put the default branch of a switch statement either at the start or end of the block
 */

/**
 * decompiler TODO
 * - fix default return of -1 for int specialisations
 * - fix function bind arrays
 */

export function debugAst(node: AstNode) {
    let writer = new TsWriterContext(globalThis.deob, new ClientScriptSubtypeSolver())
    let res = "";
    if (node instanceof CodeBlockNode) { res += `//[${node.scriptid},${node.originalindex}]\n`; }
    res += writer.getCode(node);
    console.log(res);
}
globalThis.debugAst = debugAst;

export class TsWriterContext {
    calli: ClientscriptObfuscation;
    typectx: ClientScriptSubtypeSolver;
    indent = 0;
    constructor(calli: ClientscriptObfuscation, typectx: ClientScriptSubtypeSolver) {
        this.calli = calli;
        this.typectx = typectx;
    }
    codeIndent(linenr = -1, hasquestionmark = false) {
        // return (linenr == -1 ? "" : linenr + ":").padEnd(5 + amount * 4, " ") + (hasquestionmark ? "?? " : "   ");
        return "    ".repeat(this.indent);
    }
    @boundMethod
    getCode(node: AstNode) {
        let writer = writermap.get(node.constructor);
        if (!writer) { throw new Error(`no writer defined for ${node.constructor.name} node`); }
        return writer(node, this);
    }
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
    return getOpName(op.opcode);
}

function getOpcodeCallCode(ctx: TsWriterContext, op: ClientScriptOp, children: AstNode[], originalindex: number) {
    let binarysymbol = binaryOpSymbols.get(op.opcode);
    if (binarysymbol) {
        if (children.length == 2) {
            return `(${ctx.getCode(children[0])} ${binarysymbol} ${ctx.getCode(children[1])})`;
        } else {
            return `(${binarysymbol} ${children.map(ctx.getCode).join(" ")})`;
        }
    }
    if (op.opcode == namedClientScriptOps.return) {
        if (children.length == 0) { return `return`; }
        if (children.length == 1) { return `return ${ctx.getCode(children[0])}`; }
        return `return [${children.map(ctx.getCode).join(", ")}]`;
    }
    if (op.opcode == namedClientScriptOps.gosub) {
        return `script${op.imm}(${children.map(ctx.getCode).join(", ")})`;
    }
    let metastr = "";
    if (branchInstructionsOrJump.includes(op.opcode)) {
        metastr = `[${op.imm + originalindex + 1}]`;
    } else if (op.opcode == namedClientScriptOps.gosub) {
        metastr = `[${op.imm}]`;
    } else if (op.imm != 0) {
        metastr = `[${op.imm}]`;
    }
    return `${getOpcodeName(ctx.calli, op)}${metastr}(${children.map(ctx.getCode).join(", ")})`;
}

const writermap = new Map<AstNode["constructor"], (node: AstNode, ctx: TsWriterContext) => string>();

function addWriter<T extends new (...args: any[]) => AstNode>(type: T, writer: (node: InstanceType<T>, ctx: TsWriterContext) => string) {
    writermap.set(type, writer as any);
}

addWriter(ComposedOp, (node, ctx) => {
    if (node.children.length != 0) { throw new Error("no children expected on composednode"); }
    return node.tscode;
});
addWriter(VarAssignNode, (node, ctx) => {
    let name = `${node.varops.map(q => q instanceof RawOpcodeNode ? getOpcodeName(ctx.calli, q.op) : "??").join(", ")}`;
    let varlist = "";
    if (node.varops.length != 1) { varlist += "["; }
    varlist += name;
    if (node.varops.length != 1) { varlist += "]"; }
    return `var ${varlist} = ${node.children.map(ctx.getCode).join(", ")}`
});
addWriter(CodeBlockNode, (node, ctx) => {
    let code = "";
    if (node.parent) {
        code += `{\n`;
        ctx.indent++;
    }
    // code += `${codeIndent(indent, node.originalindex)}//[${node.scriptid},${node.originalindex}]\n`;
    for (let child of node.children) {
        code += `${ctx.codeIndent(child.originalindex)}${ctx.getCode(child)};\n`;
    }
    if (node.parent) {
        ctx.indent--;
        code += `${ctx.codeIndent()}}`;
    }
    return code;
});
addWriter(BranchingStatement, (node, ctx) => {
    return getOpcodeCallCode(ctx, node.op, node.children, node.originalindex);
});
addWriter(WhileLoopStatementNode, (node, ctx) => {
    let res = `while (${ctx.getCode(node.statement)}) `;
    res += ctx.getCode(node.body);
    return res;
});
addWriter(SwitchStatementNode, (node, ctx) => {
    let res = "";
    res += `switch (${node.valueop ? ctx.getCode(node.valueop) : ""}) {\n`;
    ctx.indent++;
    for (let [i, branch] of node.branches.entries()) {
        res += `${ctx.codeIndent(branch.block.originalindex)}case ${branch.value}:`;
        if (i + 1 < node.branches.length && node.branches[i + 1].block == branch.block) {
            res += `\n`;
        } else {
            res += " " + ctx.getCode(branch.block);
            res += `\n`;
        }
    }
    if (node.defaultbranch) {
        res += `${ctx.codeIndent()}default: `;
        res += ctx.getCode(node.defaultbranch);
        res += `\n`;
    }
    ctx.indent--;
    res += `${ctx.codeIndent()}}`;
    return res;
});
addWriter(IfStatementNode, (node, ctx) => {
    let res = `if (${ctx.getCode(node.statement)}) `;
    res += ctx.getCode(node.truebranch);
    if (node.falsebranch) {
        res += ` else `;
        //skip brackets for else if construct
        let subif = getSingleChild(node.falsebranch, IfStatementNode);
        if (subif) {
            res += ctx.getCode(subif);
        } else {
            res += ctx.getCode(node.falsebranch);
        }
    }
    return res;
});
addWriter(RawOpcodeNode, (node, ctx) => {
    if (node.op.opcode == namedClientScriptOps.pushconst) {
        let gettypecast = (subt: PrimitiveType) => {
            if (!node.knownStackDiff?.exactout) { return ""; }
            let key = node.knownStackDiff.exactout[subt][0];
            let type = ctx.typectx.knowntypes.get(key);
            if (typeof type != "number" || type == subtypes.int || type == subtypes.string || type == subtypes.long) { return ""; }
            return ` as ${subtypeToTs(type)}`;
        }
        if (typeof node.op.imm_obj == "string") {
            return `"${node.op.imm_obj.replace(/(["\\])/g, "\\$1")}"${gettypecast("string")}`;
        } else if (Array.isArray(node.op.imm_obj)) {
            //build our bigint as unsigned
            let int = (BigInt(node.op.imm_obj[0] as number) << 32n) | BigInt(node.op.imm_obj[1] as number);
            if (node.op.imm_obj[0] as number & 0x8000_0000) {
                //subtract complement when most significant bit is set
                int = int - 0x1_0000_0000_0000_0000n;
            }
            return `${int}n${gettypecast("long")}`;
        } else {
            return `${node.op.imm_obj}${gettypecast("int")}`;
        }
    }
    if (node.op.opcode == namedClientScriptOps.pushlocalint || node.op.opcode == namedClientScriptOps.poplocallong || node.op.opcode == namedClientScriptOps.pushlocalstring || node.op.opcode == namedClientScriptOps.pushvar) {
        return getOpcodeName(ctx.calli, node.op);
    }
    if (node.op.opcode == namedClientScriptOps.joinstring) {
        let res = "`";
        for (let child of node.children) {
            if (child instanceof RawOpcodeNode && child.opinfo.id == namedClientScriptOps.pushconst && typeof child.op.imm_obj == "string") {
                res += child.op.imm_obj;
            } else {
                res += `\${${ctx.getCode(child)}}`;
            }
        }
        res += "`";
        return res;
    }
    return getOpcodeCallCode(ctx, node.op, node.children, node.originalindex);
});
addWriter(ClientScriptFunction, (node, ctx) => {
    let scriptidmatch = node.scriptname.match(/^script(\d+)$/);
    let meta = (scriptidmatch ? ctx.calli.scriptargs.get(+scriptidmatch[1]) : null);
    let res = "";
    res += `//${meta?.scriptname ?? "unknown name"}\n`;
    res += `${ctx.codeIndent()}function ${node.scriptname}(${node.argtype.toTypeScriptVarlist(true, meta?.stack.exactin)}): ${node.returntype.toTypeScriptReturnType(meta?.stack.exactout)} `;
    res += ctx.getCode(node.children[0]);
    return res;
});
addWriter(FunctionBindNode, (node, ctx) => {
    let scriptid = node.children[0]?.knownStackDiff?.constout ?? -1;
    if (scriptid == -1 && node.children.length == 1) { return `callback()`; }
    return `callback(script${scriptid}${node.children.length > 1 ? ", " : ""}${node.children.slice(1).map(ctx.getCode).join(", ")})`;
});
addWriter(IntrinsicNode, (node, ctx) => {
    return `${node.type}(${node.children.map(ctx.getCode).join(", ")})`;
});