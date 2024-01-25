import { boundMethod } from "autobind-decorator";
import { AstNode, BranchingStatement, ClientScriptFunction, CodeBlockNode, ComposedOp, FunctionBindNode, IfStatementNode, IntrinsicNode, RawOpcodeNode, SwitchStatementNode, VarAssignNode, WhileLoopStatementNode, getSingleChild, SubcallNode, ComposedopType } from "./ast";
import { ClientscriptObfuscation } from "./callibrator";
import { ClientScriptSubtypeSolver } from "./subtypedetector";
import { ClientScriptOp, PrimitiveType, binaryOpSymbols, branchInstructionsOrJump, getOpName, namedClientScriptOps, popDiscardOps, popLocalOps, subtypeToTs, subtypes } from "./definitions";

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
    indents: boolean[] = [];
    declaredVars: Set<string>[] = [];
    constructor(calli: ClientscriptObfuscation, typectx: ClientScriptSubtypeSolver) {
        this.calli = calli;
        this.typectx = typectx;
    }
    codeIndent(linenr = -1, hasquestionmark = false) {
        // return (linenr == -1 ? "" : linenr + ":").padEnd(5 + amount * 4, " ") + (hasquestionmark ? "?? " : "   ");
        return "    ".repeat(this.indents.length);
    }
    pushIndent(hasScope: boolean) {
        this.indents.push(hasScope);
        if (hasScope) {
            this.declaredVars.push(new Set());
        }
    }
    popIndent() {
        let hadscope = this.indents.pop();
        if (hadscope == undefined) { throw new Error("negative indent"); }
        if (hadscope) {
            this.declaredVars.pop();
        }
    }
    declareLocal(varname: string) {
        let set = this.declaredVars.at(-1);
        if (!set) { throw new Error("no scope"); }
        if (set.has(varname)) {
            return true;
        } else {
            set.add(varname);
            return false;
        }
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
    } else if (op.opcode == namedClientScriptOps.popdiscardint || op.opcode == namedClientScriptOps.popdiscardlong || op.opcode == namedClientScriptOps.popdiscardstring) {
        return "";
    } else if (op.opcode == namedClientScriptOps.popvar || op.opcode == namedClientScriptOps.pushvar) {
        let varmeta = calli.getClientVarMeta(op.imm);
        if (varmeta) {
            return `var${varmeta.name}_${varmeta.varid}`;
        } else {
            return `varunk_${op.imm}`;
        }
    } else if (op.opcode == namedClientScriptOps.popvarbit || op.opcode == namedClientScriptOps.pushvarbit) {
        let id = op.imm >> 8;
        let optarget = (op.imm & 0xff);
        let varbitmeta = calli.varbitmeta.get(id);
        if (typeof varbitmeta?.varid != "number") {
            return `varbitunk_${op.imm}`;
        } else {
            let groupmeta = calli.varmeta.get(varbitmeta.varid >> 16);
            return `varbit${groupmeta?.name ?? "unk"}_${id}${optarget == 0 ? "" : `[${optarget}]`}`;//TODO this is currently not supported in the parser
        }
    }
    return getOpName(op.opcode);
}

function valueList(ctx: TsWriterContext, nodes: AstNode[]) {
    if (nodes.length == 1) { return ctx.getCode(nodes[0]); }
    return `[${nodes.map(ctx.getCode).join(", ")}]`;
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
        return `return ${valueList(ctx, children)}`;
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
    if ((["++x", "--x", "x++", "x--"] as ComposedopType[]).includes(node.type)) {
        let varname = getOpcodeName(ctx.calli, (node.internalOps[0] as RawOpcodeNode).op);
        if (node.type == "++x") { return `++${varname}`; }
        if (node.type == "--x") { return `--${varname}`; }
        if (node.type == "x++") { return `${varname}++`; }
        if (node.type == "x--") { return `${varname}--`; }
    }
    throw new Error("unknown composed op type");
});
addWriter(VarAssignNode, (node, ctx) => {
    let res = "";
    let fulldiscard = node.varops.every(q => popDiscardOps.includes(q.op.opcode));
    if (!fulldiscard) {
        let hasglobal = false;
        let hasundeclared = false;
        let varnames: string[] = [];
        let exacttypes: number[] = [];
        let vardeclared: boolean[] = [];
        for (let sub of node.varops) {
            let name = getOpcodeName(ctx.calli, sub.op);

            let exacttype = -1;
            if (node.knownStackDiff?.exactin) {
                let all = node.knownStackDiff.exactin.all();
                if (all.length != 1) { throw new Error("unexpected"); }
                let type = ctx.typectx.knowntypes.get(all[0]);
                if (typeof type == "number") {
                    exacttype = type;
                }
            }
            exacttypes.push(exacttype);
            if (popLocalOps.includes(sub.op.opcode)) {
                let isdeclared = ctx.declareLocal(name);
                hasundeclared ||= !isdeclared;
                vardeclared.push(isdeclared);
            } else {
                hasglobal = true;
            }
            varnames.push(name);
        }
        if (hasundeclared) {
            if (hasglobal) {
                //we need a "var" expression, but can't add var to the entire destructor operation, add seperate var declarations
                for (let [index, name] of varnames.entries()) {
                    if (vardeclared[index]) { continue; }
                    res += `var ${name}:${subtypeToTs(exacttypes[index])};`;
                    res += ctx.codeIndent();
                }
            } else {
                res += "var ";
            }
        }
        if (node.varops.length != 1) { res += "["; }
        res += `${varnames.join(", ")}`;
        if (node.varops.length != 1) { res += "]"; }
        res += " = ";
    }
    res += valueList(ctx, node.children);
    return res;
});
addWriter(CodeBlockNode, (node, ctx) => {
    let code = "";
    if (node.parent) {
        code += `{\n`;
        ctx.pushIndent(node.parent instanceof ClientScriptFunction);
    }
    // code += `${codeIndent(indent, node.originalindex)}//[${node.scriptid},${node.originalindex}]\n`;
    for (let child of node.children) {
        code += `${ctx.codeIndent(child.originalindex)}${ctx.getCode(child)};\n`;
    }
    if (node.parent) {
        ctx.popIndent();
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
    ctx.pushIndent(false);
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
    ctx.popIndent();
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
        let exacttype = -1;
        if (node.knownStackDiff?.exactout) {
            let all = node.knownStackDiff.exactout.all();
            if (all.length != 1) { throw new Error("unexpected"); }
            let type = ctx.typectx.knowntypes.get(all[0]);
            if (typeof type == "number") {
                exacttype = type;
            }
        }
        let gettypecast = (subt: PrimitiveType) => {
            if (exacttype == -1) { return ""; }
            if (exacttype == subtypes.int || exacttype == subtypes.string || exacttype == subtypes.long) { return ""; }
            return ` as ${subtypeToTs(exacttype)}`;
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
        } else if (typeof node.op.imm_obj == "number") {
            if (exacttype == subtypes.component) {
                return `comp(${node.op.imm_obj >> 16}, ${node.op.imm_obj & 0xffff})`;
            }
            if (exacttype == subtypes.boolean) {
                return (node.op.imm_obj == 1 ? "true" : "false");
            }
            return `${node.op.imm_obj}${gettypecast("int")}`;
        } else {
            throw new Error("unexpected");
        }
    }
    if (node.op.opcode == namedClientScriptOps.pushlocalint
        || node.op.opcode == namedClientScriptOps.poplocallong
        || node.op.opcode == namedClientScriptOps.pushlocalstring
        || node.op.opcode == namedClientScriptOps.pushvar
        || node.op.opcode == namedClientScriptOps.pushvarbit) {
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