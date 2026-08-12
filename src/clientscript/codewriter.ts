import { boundMethod } from "autobind-decorator";
import { AstNode, BranchingStatement, ClientScriptFunction, CodeBlockNode, ComposedOp, FunctionBindNode, IfStatementNode, RawOpcodeNode, SwitchStatementNode, VarAssignNode, WhileLoopStatementNode, getSingleChild, SubcallNode, ComposedopType, isNamedOp, RewriteCursor } from "./ast";
import { ClientscriptObfuscation } from "./callibrator";
import { ClientScriptSubtypeSolver } from "./subtypedetector";
import { ClientScriptOp, PrimitiveType, binaryOpSymbols, branchInstructionsOrJump, getOpName, longJsonToBigInt, namedClientScriptOps, popDiscardOps, popLocalOps, subtypeToTs } from "./definitions";
import { getOrInsert, unpackCoordgrid } from "../utils";
import { vartypes } from "../constants";

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
    compoffsets = new Map<number, number>();
    usecompoffset = false;
    int32casts = false;
    typescript = true;
    constructor(calli: ClientscriptObfuscation, typectx: ClientScriptSubtypeSolver) {
        this.calli = calli;
        this.typectx = typectx;
    }
    setCompOffsets(rootnode: AstNode) {
        let cursor = new RewriteCursor(rootnode);
        for (let node = cursor.goToStart(); node; node = cursor.next()) {
            if (!isNamedOp(node, namedClientScriptOps.pushconst)) { continue; }
            if (!node.knownStackDiff?.exactout) { continue; }
            let all = node.knownStackDiff.exactout.all();
            if (all.length != 1) { throw new Error("unexpected"); }
            let type = this.typectx.knowntypes.get(all[0]);
            if (typeof type != "number") { continue; }
            if (typeof node.op.imm_obj != "number") { continue; }
            let intf = node.op.imm_obj >> 16;
            let sub = node.op.imm_obj & 0xffff;

            let least = getOrInsert(this.compoffsets, intf, () => sub);
            if (sub < least) { this.compoffsets.set(intf, sub); }
        }
        this.usecompoffset = true;
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
    @boundMethod
    getCodeString(node: AstNode) {
        let parts: string[] = [];
        let recur = (frag: string | WriteResult) => {
            if (typeof frag == "string") {
                parts.push(frag);
            } else {
                frag.fragments.forEach(recur);
            }
        };
        recur(this.getCode(node));
        return parts.join("");
    }
    @boundMethod
    getCodeDom(node: AstNode) {
        let root = new DocumentFragment();

        let recur = (frag: string | WriteResult, parent: DocumentFragment | HTMLElement) => {
            if (typeof frag == "string") {
                parent.appendChild(document.createTextNode(frag));
            } else {
                let group: HTMLElement;
                if (!frag.objectid) {
                    group = document.createElement("span");
                } else {
                    let anchor = document.createElement("a");
                    anchor.href = `#${frag.objectid}`;
                    group = anchor;
                }
                frag.fragments.forEach(q => recur(q, group));
                parent.appendChild(group);
            }
        }

        recur(this.getCode(node), root);
        return root;
    }
}

function getOpcodeName(calli: ClientscriptObfuscation, op: ClientScriptOp) {
    if (op.opcode == namedClientScriptOps.poplocalint || op.opcode == namedClientScriptOps.pushlocalint) {
        return new WriteResult(19, [`int${op.imm}`]);
    } else if (op.opcode == namedClientScriptOps.poplocalstring || op.opcode == namedClientScriptOps.pushlocalstring) {
        return new WriteResult(19, [`string${op.imm}`]);
    } else if (op.opcode == namedClientScriptOps.poplocallong || op.opcode == namedClientScriptOps.pushlocallong) {
        return new WriteResult(19, [`long${op.imm}`]);
    } else if (op.opcode == namedClientScriptOps.popdiscardint || op.opcode == namedClientScriptOps.popdiscardlong || op.opcode == namedClientScriptOps.popdiscardstring) {
        return new WriteResult(19, []);
    } else if (op.opcode == namedClientScriptOps.popvar || op.opcode == namedClientScriptOps.pushvar) {
        let name = calli.getClientVarName(op.imm);
        return new WriteResult(19, [name], calli.getClientVarObjectId(op.imm));
    } else if (op.opcode == namedClientScriptOps.popvarbit || op.opcode == namedClientScriptOps.pushvarbit) {
        let id = op.imm >> 8;
        let optarget = (op.imm & 0xff);
        return new WriteResult(19, [calli.getClientVarbitName(id, optarget)], `varbit_${id}`);
    }
    return new WriteResult(19, [getOpName(op.opcode)]);
}

function valueList(elements: WriteResult[]) {
    if (elements.length == 1) { return elements[0]; }
    let res = new WriteResult(19, ["["]);
    for (let i = 0; i < elements.length; i++) {
        if (i != 0) { res.push(", "); }
        res.push(elements[i]);
    }
    res.push("]");
    return res;
}

function escapeStringLiteral(source: string, quotetype: "template" | "double" | "single") {
    return source.replace(/[`"'\\\n\r\t\b\f\x00-\x1F]|\$\{/g, m => {
        switch (m) {
            case '"': return (quotetype == "double" ? '\\"' : "\"");
            case "'": return (quotetype == "single" ? "\\'" : "'");
            case "\\": return "\\\\";
            case "\n": return "\\n";
            case "\r": return "\\r";
            case "\t": return "\\t";
            case "\b": return "\\b";
            case "\f": return "\\f";
            case "${": return (quotetype == "template" ? "\\${" : "${");
            case "`": return (quotetype == "template" ? "\\`" : "`");
            default: return `\\x${m.charCodeAt(0).toString(16).padStart(2, "0")}`;
        }
    });
}

function writeCall(ctx: TsWriterContext, func: WriteResult, children: AstNode[]) {
    let res = new WriteResult(17, [addBracketsIfNeeded(17, "left", true, false, func)]);
    res.push("(");
    for (let i = 0; i < children.length; i++) {
        if (i != 0) { res.push(", "); }
        res.push(ctx.getCode(children[i]));
    }
    res.push(")");
    return res;
}
function getOpcodeCallCode(ctx: TsWriterContext, op: ClientScriptOp, children: AstNode[], originalindex: number) {
    let binarysymbol = binaryOpSymbols.get(op.opcode);
    if (binarysymbol) {
        if (children.length == 2) {
            let op = code(binarysymbol.prec, binarysymbol.assoc)`${ctx.getCode(children[0])} ${binarysymbol.str} ${ctx.getCode(children[1])}`;
            if (ctx.int32casts && binarysymbol.intmath) {
                return code(5)`${op} | 0`;// js in32 cast
            } else {
                return op;
            }
        } else {
            return new WriteResult(17, [`operator("${binarysymbol.str}"`, ...children.map(ctx.getCode).flatMap((c, i) => [", ", c]), `)`]);
        }
    }
    if (op.opcode == namedClientScriptOps.return) {
        if (children.length == 0) { return new WriteResult(0, ["return"]); }
        return new WriteResult(0, [`return `, valueList(children.map(ctx.getCode))]);
    }
    if (op.opcode == namedClientScriptOps.gosub) {
        return writeCall(ctx, new WriteResult(19, [`script${op.imm}`], `script_${op.imm}`), children);
    }
    let metastr = "";
    if (branchInstructionsOrJump.includes(op.opcode)) {
        metastr = `[${op.imm + originalindex + 1}]`;
    } else if (op.opcode == namedClientScriptOps.gosub) {
        metastr = `[${op.imm}]`;
    } else if (op.imm != 0) {
        metastr = `[${op.imm}]`;
    }
    return writeCall(ctx, new WriteResult(17, [getOpcodeName(ctx.calli, op), metastr]), children);
}

class WriteResult {
    prec: number;
    objectid: string;
    fragments: Array<string | WriteResult>;
    constructor(prec: number, fragments: Array<string | WriteResult> = [], objectid = "") {
        this.prec = prec;
        this.fragments = fragments;
        this.objectid = objectid;
    }
    push(...fragments: Array<string | WriteResult>) {
        this.fragments.push(...fragments);
    }
};

function addBracketsIfNeeded(slotprec: number, assoc: "left" | "right" | "none", isleft: boolean, isright: boolean, sub: WriteResult) {
    let needbracket = sub.prec < slotprec;
    needbracket ||= sub.prec == slotprec && isleft && assoc == "right";
    needbracket ||= sub.prec == slotprec && isright && assoc == "left";
    needbracket ||= sub.prec == slotprec && assoc == "none";
    if (needbracket) {
        return new WriteResult(18, ["(", sub, ")"]);
    } else {
        return sub;
    }
}

function code(prec: number, assoc: "left" | "right" | "none" = "none", slotprec = prec) {
    // precedence based on https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence#precedence_and_associativity
    return (strings: TemplateStringsArray, ...values: (string | WriteResult)[]) => {
        const fragments: Array<string | WriteResult> = [];
        let slotindex = 0;
        for (let i = 0; i < strings.length; i++) {
            let str = strings[i];
            let val = values[i];
            if (str) { fragments.push(str); }
            if (val) {
                if (typeof val == "string") {
                    fragments.push(val);
                } else {
                    fragments.push(addBracketsIfNeeded(slotprec, assoc, slotindex == 0, slotindex == 1, val));
                }
                slotindex++;
            }
        }
        return new WriteResult(prec, fragments);
    };
}

const writermap = new Map<AstNode["constructor"], (node: AstNode, ctx: TsWriterContext) => WriteResult>();

function addWriter<T extends new (...args: any[]) => AstNode>(type: T, writer: (node: InstanceType<T>, ctx: TsWriterContext) => WriteResult) {
    writermap.set(type, writer as any);
}

addWriter(ComposedOp, (node, ctx) => {
    if ((["++x", "--x", "x++", "x--"] as ComposedopType[]).includes(node.type)) {
        if (node.children.length != 0) { throw new Error("no children expected on composednode"); }
        let varname = getOpcodeName(ctx.calli, (node.internalOps[0] as RawOpcodeNode).op);
        if (ctx.int32casts) {
            if (node.type == "++x") { return code(2)`${varname} = ${varname} + 1 | 0`; }
            if (node.type == "--x") { return code(2)`${varname} = ${varname} - 1 | 0`; }
            if (node.type == "x++") { return code(1)`${varname} = ${varname} + 1 | 0, ${varname} - 1 | 0`; }
            if (node.type == "x--") { return code(1)`${varname} = ${varname} - 1 | 0, ${varname} + 1 | 0`; }
        } else {
            if (node.type == "++x") { return code(14)`++${varname}`; }
            if (node.type == "--x") { return code(14)`--${varname}`; }
            if (node.type == "x++") { return code(13)`${varname}++`; }
            if (node.type == "x--") { return code(13)`${varname}--`; }
        }
    }
    if (node.type == "stack") {
        return writeCall(ctx, new WriteResult(19, ["stack"]), node.children);
    }
    throw new Error("unknown composed op type");
});
addWriter(VarAssignNode, (node, ctx) => {
    let res = new WriteResult(0);
    let fulldiscard = node.varops.every(q => popDiscardOps.includes(q.op.opcode));
    if (!fulldiscard) {
        let hasglobal = false;
        let hasundeclared = false;
        let varnames: WriteResult[] = [];
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
                let varname = name.fragments[0]
                if (typeof varname != "string" || !varname) { throw new Error("unexpected"); }
                let isdeclared = ctx.declareLocal(varname);
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
                    res.push(code(0)`var ${name}${ctx.typescript ? ":" + subtypeToTs(exacttypes[index]) : ""};\n`);
                    res.push(ctx.codeIndent());
                }
            } else {
                res.push("var ");
            }
        }
        res.push(valueList(varnames));
        res.push(" = ");
    }
    res.push(valueList(node.children.map(ctx.getCode)));
    return res;
});
addWriter(CodeBlockNode, (node, ctx) => {
    let code = new WriteResult(0);
    if (node.parent) {
        code.push(`{\n`);
        ctx.pushIndent(node.parent instanceof ClientScriptFunction);
    }
    // code += `${codeIndent(indent, node.originalindex)}//[${node.scriptid},${node.originalindex}]\n`;
    for (let child of node.children) {
        code.push(ctx.codeIndent(child.originalindex), ctx.getCode(child), `;\n`);
    }
    if (node.parent) {
        if (node.parent instanceof SwitchStatementNode && node.branchEndNode != null) {
            code.push(ctx.codeIndent(), `break;\n`);
        }
        if (node.deadcodeSuccessor) {
            code.push(ctx.getCode(node.deadcodeSuccessor));
        }
        ctx.popIndent();
        code.push(ctx.codeIndent(), `}`);
    }
    return code;
});
addWriter(BranchingStatement, (node, ctx) => {
    return getOpcodeCallCode(ctx, node.op, node.children, node.originalindex);
});
addWriter(WhileLoopStatementNode, (node, ctx) => {
    let res = new WriteResult(0);
    res.push(`while (`, ctx.getCode(node.statement), `) `, ctx.getCode(node.body));
    return res;
});
addWriter(SwitchStatementNode, (node, ctx) => {
    let res = new WriteResult(0);
    res.push(`switch (`, node.valueop ? ctx.getCode(node.valueop) : "", `) {\n`);
    ctx.pushIndent(false);
    for (let [i, branch] of node.branches.entries()) {
        res.push(ctx.codeIndent(branch.block.originalindex), `case ${branch.value}:`);
        if (i + 1 < node.branches.length && node.branches[i + 1].block == branch.block) {
            res.push(`\n`);
        } else {
            res.push(" ", ctx.getCode(branch.block));
            res.push(`\n`);
        }
    }
    if (node.defaultbranch) {
        res.push(ctx.codeIndent(), `default: `);
        res.push(ctx.getCode(node.defaultbranch));
        res.push(`\n`);
    }
    ctx.popIndent();
    res.push(ctx.codeIndent(), `}`);
    return res;
});
addWriter(IfStatementNode, (node, ctx) => {
    let res = new WriteResult(0);
    res.push(`if (`, ctx.getCode(node.statement), `) `);
    res.push(ctx.getCode(node.truebranch));
    if (node.falsebranch) {
        res.push(` else `);
        //skip brackets for else if construct
        let subif = getSingleChild(node.falsebranch, IfStatementNode);
        if (subif) {
            res.push(ctx.getCode(subif));
        } else {
            res.push(ctx.getCode(node.falsebranch));
        }
    }
    return res;
});

function addTypeCast(ctx: TsWriterContext, exacttype: number, child: WriteResult) {
    if (!ctx.typescript) { return child; }
    if (exacttype == -1) { return child; }
    if (exacttype == vartypes.int || exacttype == vartypes.string || exacttype == vartypes.long) {
        return child;
    }
    if (exacttype == vartypes.unknown_int || exacttype == vartypes.unknown_string || exacttype == vartypes.unknown_long) {
        return child
    }
    // precedence of `as` operator in ts seems to be 8.5
    return code(9)`${child} as ${subtypeToTs(exacttype)}`;
}
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
        if (typeof node.op.imm_obj == "string") {
            return addTypeCast(ctx, exacttype, new WriteResult(19, [`"${escapeStringLiteral(node.op.imm_obj, "double")}"`]));
        } else if (Array.isArray(node.op.imm_obj)) {
            return addTypeCast(ctx, exacttype, new WriteResult(19, [`${longJsonToBigInt(node.op.imm_obj)}n`]));
        } else if (typeof node.op.imm_obj == "number") {
            if (exacttype == vartypes.component) {
                let intf = node.op.imm_obj >> 16;
                let sub = node.op.imm_obj & 0xffff;
                if (ctx.usecompoffset && ctx.compoffsets.has(intf)) {
                    return new WriteResult(17, [`comprel(${intf}, ${sub - ctx.compoffsets.get(intf)!})`]);
                } else {
                    return new WriteResult(17, [`comp(${intf}, ${sub})`]);
                }
            }
            if (exacttype == vartypes.coordgrid && node.op.imm_obj != -1) {
                let v = node.op.imm_obj;
                let pos = unpackCoordgrid(v);
                //plane,chunkx,chunkz,subx,subz
                return new WriteResult(17, [`coordgrid(${pos.level},${pos.x},${pos.z})`]);
            }
            if (exacttype == vartypes.boolean) {
                return new WriteResult(19, [node.op.imm_obj == 0 ? "false" : "true"]);
            }
            return addTypeCast(ctx, exacttype, new WriteResult(19, [`${node.op.imm_obj}`]));
        } else {
            throw new Error("unexpected");
        }
    }
    if (node.op.opcode == namedClientScriptOps.pushlocalint
        || node.op.opcode == namedClientScriptOps.pushlocallong
        || node.op.opcode == namedClientScriptOps.pushlocalstring
        || node.op.opcode == namedClientScriptOps.pushvar
        || node.op.opcode == namedClientScriptOps.pushvarbit) {
        let name = getOpcodeName(ctx.calli, node.op);
        return new WriteResult(19, [name],);
    }
    if (node.op.opcode == namedClientScriptOps.joinstring) {
        let res = new WriteResult(19, ["`"]);
        for (let child of node.children) {
            if (child instanceof RawOpcodeNode && child.opinfo.id == namedClientScriptOps.pushconst && typeof child.op.imm_obj == "string") {
                res.push(escapeStringLiteral(child.op.imm_obj, "template"));
            } else {
                res.push("${", ctx.getCode(child), "}");
            }
        }
        res.push("`");
        return res;
    }
    return getOpcodeCallCode(ctx, node.op, node.children, node.originalindex);
});
addWriter(ClientScriptFunction, (node, ctx) => {
    let scriptidmatch = node.scriptname.match(/^script(\d+)$/);
    let meta = (scriptidmatch ? ctx.calli.scriptargs.get(+scriptidmatch[1]) : null);
    let res = new WriteResult(0);
    res.push(`//${meta?.scriptname ?? "unknown name"}\n`);
    res.push(ctx.codeIndent(), `function ${node.scriptname}(`, node.argtype.toTypeScriptVarlist(true, ctx.typescript, meta?.stack.exactin), `)`);
    if (ctx.typescript) { res.push(`: `, node.returntype.toTypeScriptReturnType(meta?.stack.exactout), " "); }
    res.push(ctx.getCode(node.children[0]));
    return res;
});
addWriter(FunctionBindNode, (node, ctx) => {
    let scriptid = node.children[0]?.knownStackDiff?.constout ?? -1;
    if (scriptid == -1 && node.children.length == 1) { return new WriteResult(17, [`callback()`]); }
    let scriptnode = new WriteResult(17, [`script${scriptid}`], `scripts_${scriptid}`);
    let children = node.children.slice(1).map(ctx.getCode);
    return new WriteResult(19, [`callback(`, scriptnode, ...children.flatMap(q => [", ", q]), `)`]);
});
addWriter(SubcallNode, (node, ctx) => {
    return writeCall(ctx, new WriteResult(19, [node.funcname]), node.children.slice(0, -1));
});