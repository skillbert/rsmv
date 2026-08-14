import { boundMethod } from "autobind-decorator";
import { AstNode, BranchingStatement, ClientScriptFunction, CodeBlockNode, ComposedOp, FunctionBindNode, IfStatementNode, RawOpcodeNode, SwitchStatementNode, VarAssignNode, WhileLoopStatementNode, getSingleChild, SubcallNode, ComposedopType, isNamedOp, RewriteCursor } from "../ast";
import { ClientscriptObfuscation } from "../callibration/callibrator";
import { ClientScriptSubtypeSolver } from "../callibration/subtypedetector";
import { ClientScriptOp, ExactStack, PrimitiveType, StackDiff, StackList, binaryOpSymbols, branchInstructionsOrJump, dynamicOps, getOpName, longJsonToBigInt, namedClientScriptOps, popDiscardOps, popLocalOps, typeToPrimitive } from "../definitions";
import { getOrInsert, unpackCoordgrid } from "../../utils";
import { vartypes } from "../../constants";
import { intrinsics } from "../jsonwriter";
import { reserved } from "./typescripthelpers";
import { getOpcodeName, returntypeTuple, typeList, subtypeToTs, valueList, writeLeaf, WriteResult, addTypeCast, addBracketsIfNeeded } from "./writehelpers";

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


const writermap = new Map<AstNode["constructor"], (node: AstNode, ctx: TsWriterContext) => WriteResult>();

function addWriter<T extends new (...args: any[]) => AstNode>(type: T, writer: (node: InstanceType<T>, ctx: TsWriterContext) => WriteResult) {
    writermap.set(type, writer as any);
}

export function debugAst(node: AstNode) {
    let writer = new TsWriterContext(globalThis.deob, new ClientScriptSubtypeSolver())
    let res = "";
    if (node instanceof CodeBlockNode) { res += `//[${node.scriptid},${node.originalindex}]\n`; }
    res += writer.getCodeString(node);
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
            if (!isNamedOp(node, namedClientScriptOps.pushconst) || typeof node.op.imm_obj != "number") { continue; }

            let key = node.knownStackDiff?.exactout?.int[0];
            if (key == undefined) { continue; }
            let type = this.typectx.getType(key);
            if (type != vartypes.component) { continue; }

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
    getCodeDom(node: AstNode, objclick?: (objectid: string) => void) {
        let root = document.createElement("div");
        root.classList.add("mv-codeview");
        let clickevent = (e: MouseEvent) => {
            let obj = (e.currentTarget as HTMLElement).dataset.objectid;
            if (obj && objclick) {
                objclick(obj);
            }
        }

        let recur = (frag: string | WriteResult, parent: DocumentFragment | HTMLElement) => {
            if (typeof frag == "string") {
                parent.appendChild(document.createTextNode(frag));
            } else if (frag.fragments.length != 0) {
                let group = document.createElement("span");
                if (frag.objectid) {
                    group.classList.add(`mv-code__link`);
                    group.dataset.objectid = frag.objectid;
                    group.addEventListener("click", clickevent);
                }
                if (frag.type) {
                    group.classList.add(`mv-code__${frag.type}`);
                }
                frag.fragments.forEach(q => recur(q, group));
                parent.appendChild(group);
            }
        }

        recur(this.getCode(node), root);
        return root;
    }
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
            return new WriteResult(17, [
                writeLeaf("keyword", "operator"),
                "(",
                writeLeaf("keyword", `"${binarysymbol.str}"`),
                ...children.map(ctx.getCode).flatMap((c, i) => [", ", c]),
                ")"
            ]);
        }
    }
    if (op.opcode == namedClientScriptOps.return) {
        if (children.length == 0) { return writeLeaf("keyword", "return"); }
        return new WriteResult(0, [writeLeaf("keyword", "return"), " ", valueList(children.map(ctx.getCode))]);
    }
    if (op.opcode == namedClientScriptOps.gosub) {
        return writeCall(ctx, writeLeaf("scriptname", `script${op.imm}`, `scriptref_${op.imm}`), children);
    }
    let metastr = "";
    if (branchInstructionsOrJump.includes(op.opcode)) {
        metastr = `[${op.imm + originalindex + 1}]`;
    } else if (op.opcode == namedClientScriptOps.gosub) {
        metastr = `[${op.imm}]`;
    } else if (op.imm != 0) {
        metastr = `[${op.imm}]`;
    }
    return writeCall(ctx, new WriteResult(19, [getOpcodeName(ctx.calli, op), metastr]), children);
}

function code(prec: number, assoc: "left" | "right" | "none" = "none", slotprec = prec) {
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

export function writeOpcodeFile(calli: ClientscriptObfuscation) {
    let res = "";
    res += `// Need to be defined for the typescript compiler\n`;
    res += "interface Boolean { }\n";
    res += "interface Function { }\n";
    res += "interface Number { }\n";
    res += "interface Object { }\n";
    res += "interface RegExp { }\n";
    res += "interface String { }\n";
    res += "interface IArguments { }\n";
    res += "interface BigInt { }\n";
    res += "interface Symbol { }\n";
    res += "interface Array<T> { [Symbol.iterator](): any; }\n";
    res += "declare var Symbol: { readonly iterator: unique symbol };\n";
    res += "\n";
    res += `// Language constructs\n`;
    res += "declare class BoundFunction { }\n";
    res += "declare function operator(op: string, ...values:any[]): any;\n";
    res += "declare function callback(): BoundFunction;\n";
    res += "declare function callback<T extends (...args: any[]) => any>(fn: T, ...args: T extends (...args: (infer ARGS)[]) => any ? ARGS : never): BoundFunction;\n";
    res += "declare function comp(interf: number, element: number): component;\n";
    res += "declare function comprel(interf: number, elementrel: number): component;\n"
    res += "declare function pos(level: number, chunkx:number, chunkz:number, subx:number, subz:number): coordgrid;\n";
    res += "declare function stack(...args: any[]): any;\n";
    res += "\n";
    res += `// Compiler intrinsics\n`;
    for (let [name, intr] of intrinsics) {
        res += `declare function ${name}(${typeList(intr.in, true, true)}): ${returntypeTuple(intr.out)};\n`;
    }
    res += "\n";
    res += `// Clientscript types\n`;
    for (let type of Object.values(vartypes)) {
        let prim = typeToPrimitive(type);
        let name = subtypeToTs(type);
        if (name == "string") { continue; }
        if (name == "boolean") { continue; }
        res += `type ${name} = ${prim == "int" ? "number" : prim == "long" ? "BigInt" : "string"}\n`;
    }
    res += "\n";
    res += `// VM opcodes\n`;
    for (let op of calli.scrambledops.values()) {
        let opname = getOpName(op.id);
        if (reserved.includes(opname)) { continue; }
        if (op.id == namedClientScriptOps.enum_getvalue) {
            res += `declare function ${opname}(int0: number, int1: number, int2: number, int3: number): any;\n`;
        } else if (op.id == namedClientScriptOps.dbrow_getfield) {
            res += `declare function ${opname}(int0: number, int1: number, int2: number): any;\n`;
        } else if (!dynamicOps.includes(op.id) && op.stackinfo.initializedthrough) {
            let args = typeList(op.stackinfo.in, true, true, op.stackinfo.exactin);
            let returns = returntypeTuple(op.stackinfo.out, op.stackinfo.exactout);
            res += `declare function ${opname}(${args}): ${returns};\n`;
        } else {
            res += `declare function ${opname}(...args: any[]): any;\n`;
        }
    }
    return res;
}

export function writeClientVarFile(calli: ClientscriptObfuscation) {
    let res = "";
    for (let [domainid, domain] of calli.varmeta) {
        res += `// ===== ${domain.name} =====\n`;
        for (let [id, meta] of domain.vars) {
            let varid = domainid | (id << 8);
            res += `declare var ${calli.getClientVarName(varid)}: ${meta.type};\n`;
        }
    }
    res += `// ===== varbits =====\n`;
    for (let [id, meta] of calli.varbitmeta) {
        let name = calli.getClientVarbitName(id, 0);
        res += `declare var ${name}: number;\n`;
    }
    return res;
}
function writeIntLiteral(ctx: TsWriterContext, value: number, exacttype: number) {
    if (exacttype == vartypes.component) {
        let intf = value >> 16;
        let sub = value & 0xffff;
        if (ctx.usecompoffset && ctx.compoffsets.has(intf)) {
            return new WriteResult(17, [
                writeLeaf("keyword", "comprel"), "(",
                writeLeaf("literalnumber", `${intf}`), ", ",
                writeLeaf("literalnumber", `${sub - ctx.compoffsets.get(intf)!}`), ")"
            ], "", `comp_${intf}_${sub}`);
        } else {
            return new WriteResult(17, [
                writeLeaf("keyword", "comp"), "(",
                writeLeaf("literalnumber", `${intf}`), ", ",
                writeLeaf("literalnumber", `${sub}`), ")"
            ], "", `comp_${intf}_${sub}`);
        }
    }
    if (exacttype == vartypes.coordgrid && value != -1) {
        let pos = unpackCoordgrid(value);
        // TODO maybe make the entire construct look like a literal
        return new WriteResult(17, [
            writeLeaf("keyword", "coordgrid"), "(",
            writeLeaf("literalnumber", `${pos.level}`), ", ",
            writeLeaf("literalnumber", `${pos.x}`), ", ",
            writeLeaf("literalnumber", `${pos.z}`), ")"
        ], "", `coordgrid_${pos.level}_${pos.x}_${pos.z}`);
    }
    if (exacttype == vartypes.boolean) {
        if (value != 0 && value != 1) {
            // something went wrong if we land here, don't hide it
            return addTypeCast(vartypes.boolean, writeLeaf("literalnumber", "" + value));
        } else {
            return writeLeaf("keyword", value == 0 ? "false" : "true");
        }
    }
    let literal = writeLeaf("literalnumber", "" + value);
    let res = (ctx.typescript ? addTypeCast(exacttype, literal) : literal);
    if (exacttype != -1 && exacttype != vartypes.int && exacttype != vartypes.unknown_int) {
        let typename = Object.entries(vartypes).find(q => q[1] == exacttype);
        if (typename) {
            res.objectid = `${typename[0]}_${value}`;
        }
    }
    return res;
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
        return writeCall(ctx, writeLeaf("keyword", "stack"), node.children);
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
            exacttypes.push(ctx.typectx.getIntType(node.knownStackDiff?.exactin?.int[0]));
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
                res.push(writeLeaf("keyword", "var"), " ");
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
            code.push(ctx.codeIndent(), writeLeaf("keyword", "break"), ";\n");
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
    res.push(writeLeaf("keyword", "while"), " (", ctx.getCode(node.statement), `) `, ctx.getCode(node.body));
    return res;
});
addWriter(SwitchStatementNode, (node, ctx) => {
    let res = new WriteResult(0);
    let type = ctx.typectx.getIntType(node.knownStackDiff.exactin?.int[0]);
    res.push(writeLeaf("keyword", "switch"), " (", node.valueop ? ctx.getCode(node.valueop) : "", `) {\n`);
    ctx.pushIndent(false);
    for (let [i, branch] of node.branches.entries()) {
        res.push(ctx.codeIndent(branch.block.originalindex), writeLeaf("keyword", "case"), " ", writeIntLiteral(ctx, branch.value, type), ":");
        if (i + 1 < node.branches.length && node.branches[i + 1].block == branch.block) {
            res.push(`\n`);
        } else {
            res.push(" ", ctx.getCode(branch.block));
            res.push(`\n`);
        }
    }
    if (node.defaultbranch) {
        res.push(ctx.codeIndent(), writeLeaf("keyword", "default"), ": ");
        res.push(ctx.getCode(node.defaultbranch));
        res.push(`\n`);
    }
    ctx.popIndent();
    res.push(ctx.codeIndent(), `}`);
    return res;
});
addWriter(IfStatementNode, (node, ctx) => {
    let res = new WriteResult(0);
    res.push(writeLeaf("keyword", "if"), " (", ctx.getCode(node.statement), `) `);
    res.push(ctx.getCode(node.truebranch));
    if (node.falsebranch) {
        res.push(" ", writeLeaf("keyword", "else"), " ");
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
addWriter(RawOpcodeNode, (node, ctx) => {
    if (node.op.opcode == namedClientScriptOps.pushconst) {
        let exacttype = -1;
        if (node.knownStackDiff?.exactout) {
            let all = node.knownStackDiff.exactout.all();
            if (all.length != 1) { throw new Error("unexpected"); }
            let type = ctx.typectx.getType(all[0]);
            if (typeof type == "number") {
                exacttype = type;
            }
        }
        if (typeof node.op.imm_obj == "string") {
            let literal = writeLeaf("literalstring", `"${escapeStringLiteral(node.op.imm_obj, "double")}"`);
            return (ctx.typescript ? addTypeCast(exacttype, literal) : literal);
        } else if (Array.isArray(node.op.imm_obj)) {
            let literal = writeLeaf("literalnumber", `${longJsonToBigInt(node.op.imm_obj)}n`);
            return (ctx.typescript ? addTypeCast(exacttype, literal) : literal);
        } else if (typeof node.op.imm_obj == "number") {
            return writeIntLiteral(ctx, node.op.imm_obj, exacttype);
        } else {
            throw new Error("unexpected");
        }
    }
    if (node.op.opcode == namedClientScriptOps.pushlocalint
        || node.op.opcode == namedClientScriptOps.pushlocallong
        || node.op.opcode == namedClientScriptOps.pushlocalstring
        || node.op.opcode == namedClientScriptOps.pushvar
        || node.op.opcode == namedClientScriptOps.pushvarbit) {
        return getOpcodeName(ctx.calli, node.op);
    }
    if (node.op.opcode == namedClientScriptOps.joinstring) {
        let res = new WriteResult(19);
        let literalfrag = "`";
        for (let i = 0; i < node.children.length; i++) {
            let child = node.children[i];
            if (child instanceof RawOpcodeNode && child.opinfo.id == namedClientScriptOps.pushconst && typeof child.op.imm_obj == "string") {
                literalfrag += escapeStringLiteral(child.op.imm_obj, "template");
            } else {
                literalfrag += "${";
                res.push(writeLeaf("literalstring", literalfrag));
                res.push(ctx.getCode(child));
                literalfrag = "}";
            }
        }
        literalfrag += "`";
        res.push(writeLeaf("literalstring", literalfrag));
        return res;
    }
    return getOpcodeCallCode(ctx, node.op, node.children, node.originalindex);
});
addWriter(ClientScriptFunction, (node, ctx) => {
    let scriptidmatch = node.scriptname.match(/^script(\d+)$/);
    let meta = (scriptidmatch ? ctx.calli.scriptargs.get(+scriptidmatch[1]) : null);
    let res = new WriteResult(0, [
        writeLeaf("comment", `//${meta?.scriptname ?? "unknown name"}\n`),
        ctx.codeIndent(), writeLeaf("keyword", "function"), " ", writeLeaf("scriptname", node.scriptname), "(",
        typeList(node.argtype, true, ctx.typescript, meta?.stack.exactin),
        ")"
    ]);
    if (ctx.typescript) { res.push(`: `, returntypeTuple(node.returntype, meta?.stack.exactout), " "); }
    res.push(ctx.getCode(node.children[0]));
    return res;
});
addWriter(FunctionBindNode, (node, ctx) => {
    let scriptid = node.children[0]?.knownStackDiff?.constout ?? -1;
    if (scriptid == -1 && node.children.length == 1) { return new WriteResult(19, [writeLeaf("keyword", "callback"), "()"]); }
    let scriptnode = writeLeaf("scriptname", `script${scriptid}`, `scriptref_${scriptid}`);
    let children = node.children.slice(1).map(ctx.getCode);
    return new WriteResult(19, [writeLeaf("keyword", "callback"), "(", scriptnode, ...children.flatMap(q => [", ", q]), ")"]);
});
addWriter(SubcallNode, (node, ctx) => {
    return writeCall(ctx, writeLeaf("scriptname", node.funcname), node.children.slice(0, -1));
});

