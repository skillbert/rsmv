import { prepareClientScript, writeOpcodeFile } from ".";
import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { AstNode, ClientScriptFunction, CodeBlockNode, isNamedOp, parseClientScriptIm, RawOpcodeNode, RewriteCursor, FunctionBindNode } from "./ast";
import { ClientscriptObfuscation } from "./callibrator";
import { TsWriterContext } from "./codewriter";
import { ClientScriptSubtypeSolver } from "./subtypedetector";
import { namedClientScriptOps, StackConstants, subtypeToTs } from "./definitions";
import { loadEnum, loadStruct } from "./util";
import { ScriptFS, ScriptOutput } from "../scriptrunner";


type CS2Script = {
    func: ClientScriptFunction,
    sections: CodeBlockNode[],
    ctx: ClientScriptSubtypeSolver,
    scripts: Set<number>,
    enums: Set<number>,
    structs: Set<number>,
    params: Set<number>,
    vars: Set<number>,
    varbits: Set<number>
}

namespace implementations {


    type Param = { defaultValue: number | string | bigint };
    type Struct = Map<number, string | number | bigint>;
    type Enum = { defaultFrom: number, defaultTo: string | number, from: number[], to: number[] | string[] };

    var paramtable = new Map<number, Param>();
    var structatble = new Map<number, Struct>();
    var enumtable = new Map<number, Enum>();
    export function struct_getparam(structid: number, paramid: number) {
        let param = paramtable.get(paramid);
        if (!param) { throw new Error(`unknown param id ${paramid}`); }
        let struct = structatble.get(structid);
        let res = struct?.get(paramid) ?? param.defaultValue;
        return res;
    }

    export function enum_getvalue(fromtype: number, totype: number, enumid: number, key: number) {
        let enumdata = enumtable.get(enumid);
        if (!enumdata) { throw new Error(`unknown enum id ${enumid}`); }
        let index = enumdata.from.indexOf(key);
        return (index == -1 ? enumdata.defaultTo : enumdata.to[index]);
    }

    export function ENUM_GETOUTPUTCOUNT(enumid: number) {
        let enumdata = enumtable.get(enumid);
        if (!enumdata) { throw new Error(`unknown enum id ${enumid}`); }
        return enumdata.from.length;
    }
}

export async function extractClientModuleCode(output: ScriptOutput, outdir: ScriptFS, source: CacheFileSource, entryscripts: number[]) {
    let mod = await IsolatedCS2Module.fromSource(source);
    globalThis.cs2mod = mod;//TODO remove
    let res = await mod.run(entryscripts);
    outdir.writeFile("module.ts", res);
}

export class IsolatedCS2Module {
    scripts = new Map<number, CS2Script>();
    enums = new Map<number, { from: number[], to: number[] }>();
    params = new Map<number, { default: number | string }>();
    structs = new Map<number, {}>();
    source: CacheFileSource;
    deob: ClientscriptObfuscation;
    mockscripts = new Set<number>();
    entrypoints: number[] = [];

    constructor(deob: ClientscriptObfuscation) {
        this.source = deob.source;
        this.deob = deob;
    }

    static async fromSource(source: CacheFileSource) {
        let deob = await prepareClientScript(source);
        return new IsolatedCS2Module(deob);
    }

    async run(entryscripts: number[]) {
        this.entrypoints = entryscripts;
        let queue = entryscripts.slice();
        while (queue.length != 0) {
            let id = queue.pop()!;
            let fn = await this.addscript(id);
            if (this.scripts.size % 100 == 0) { console.log(`script count: ${this.scripts.size}, queue: ${queue.length}`); }
            if (fn) { queue.push(...[...fn.scripts].filter(q => !this.scripts.has(q))); }
        }

        let res = "";
        res += writeOpcodeFile(this.deob);
        res += this.writeVars();
        res += await this.writeStructsParamsEnums();
        res += implementations.enum_getvalue + "\n";
        res += implementations.struct_getparam + "\n";
        res += implementations.ENUM_GETOUTPUTCOUNT + "\n";

        res += this.writeScripts();


        return res;
    }

    async addscript(id: number) {
        if (this.scripts.has(id)) { return null; }
        if (this.mockscripts.has(id)) { return null; }

        let filebuf = await this.source.getFileById(cacheMajors.clientscript, id);
        let script = parse.clientscript.read(filebuf, this.source);
        let { rootfunc, sections, typectx } = parseClientScriptIm(this.deob, script, id);
        let fn: CS2Script = {
            func: rootfunc,
            ctx: typectx,
            sections,
            enums: new Set(),
            params: new Set(),
            structs: new Set(),
            scripts: new Set(),
            vars: new Set(),
            varbits: new Set()
        }
        scriptdeps(this, fn);
        this.scripts.set(id, fn);
        return fn;
    }

    writeScripts() {
        let res = "";
        for (let mockid of [...this.mockscripts]) {
            res += `var script${mockid} = function(...args[]){};\n`;
        }
        res += "\n";

        let funcs = [...this.scripts].sort((a, b) => a[0] - b[0]).map(q => q[1]);
        for (let fn of funcs) {
            let writer = new TsWriterContext(this.deob, fn.ctx);
            let code = writer.getCode(fn.func);
            res += code + "\n\n";
        }
        return res;
    }

    async writeStructsParamsEnums() {
        let res = "";
        let allstructs = new Set<number>();
        let allparams = new Set<number>();
        let allenums = new Set<number>();
        for (let fn of this.scripts.values()) {
            fn.structs.forEach(q => allstructs.add(q));
            fn.params.forEach(q => allparams.add(q));
            fn.enums.forEach(q => allenums.add(q));
        }
        res += `type Param = { defaultValue: number | string | bigint };\n`;
        res += `type Struct = Map<number, string | number | bigint>;\n`;
        res += `type Enum = { defaultFrom: number, defaultTo: string | number, from: number[] | string[], to: number[] | string[] };\n`;
        res += "\n";

        res += `var paramtable = new Map<number, Param>();\n`;
        for (let paramid of allparams) {
            let param = this.deob.parammeta.get(paramid);
            res += `paramtable.set(${paramid},${JSON.stringify({ defaultValue: param?.type?.defaultint ?? param?.type?.defaultstring })});\n`;
        }
        res += "\n";

        res += `var structatble = new Map<number, Struct>();\n`;
        for (let structid of allstructs) {
            let struct = await loadStruct(this.source, structid);
            res += `structtable.set(${structid}, new Map([\n`
            for (let val of struct.extra ?? []) {
                res += `\t[${val.prop}, ${val.intvalue ?? `"${(val.stringvalue ?? "").replace(/\\/g, "\\\\").replace(/"/, "\\\"")}"`}],\n`;
            }
            res += `]))\n`;
        }
        res += "\n";

        res += `var enumtable = new Map<number, Enum>();\n`;
        for (let enumsid of allenums) {
            let enumdata = await loadEnum(this.source, enumsid);
            let intarr = enumdata.intArrayValue1 ?? enumdata.intArrayValue2?.values;
            let stringarr = enumdata.stringArrayValue1 ?? enumdata.stringArrayValue2?.values;
            let arr = intarr ?? stringarr;
            let from = arr?.map((q: [number, number | string]) => q[0]) ?? [];
            let to = arr?.map((q: [number, number | string]) => q[1]) ?? [];
            let defaultFrom = -1;
            let defaultTo = (stringarr ? "" : -1);
            res += `enumtable.set(${enumsid}, ${JSON.stringify({ defaultFrom, defaultTo, from, to })})\n`;
        }
        res += "\n";
        return res;
    }

    writeVars() {
        let res = ""
        let allvars = new Set<number>();
        let allvarbits = new Set<number>();
        for (let fn of this.scripts.values()) {
            fn.vars.forEach(q => allvars.add(q));
            fn.varbits.forEach(q => allvarbits.add(q));
        }

        for (let varid of [...allvars].sort((a, b) => a - b)) {
            let varmeta = this.deob.getClientVarMeta(varid);
            let varname = (varmeta ? `var${varmeta.name}_${varmeta.varid}` : `varunk_${varid}`);
            res += `var ${varname}`;
            res += `: ${varmeta ? subtypeToTs(varmeta.fulltype) : "any"}`;
            res += `\n`;
        }
        res += "\n";
        for (let varid of [...allvarbits].sort((a, b) => a - b)) {
            let id = varid >> 8;
            let optarget = (varid & 0xff);
            let varbitmeta = this.deob.varbitmeta.get(id);
            let varname = "";
            let comment = "unknown";
            if (typeof varbitmeta?.varid != "number") {
                varname = `varbitunk_${varid}`;
            } else {
                let groupmeta = this.deob.varmeta.get(varbitmeta.varid >> 16);
                varname = `varbit${groupmeta?.name ?? "unk"}_${id}${optarget == 0 ? "" : `[${optarget}]`}`;
                comment = `${varbitmeta.bits[1] - varbitmeta.bits[0] + 1}`;
            }
            res += `var ${varname}`;
            res += `: int`;
            res += `; //${comment}\n`;
        }
        res += "\n";
        return res;
    }
}

globalThis.IsolatedCS2Module = IsolatedCS2Module;

export function analyzeCallGraph(mod: IsolatedCS2Module) {
    type DepthNode = { id: number, parent: DepthNode | null, children: Set<number> };
    let nodedepths = new Map<number, DepthNode>();

    let getdepth = (node: DepthNode | null) => {
        let d = 0;
        for (; node; node = node!.parent);
        return d;
    }

    let iter = (parent: DepthNode, scriptid: number) => {
        let fn = mod.scripts.get(scriptid);
        if (!fn) { return; }
        let node = nodedepths.get(scriptid);
        let runchildren = false;
        if (!node) {
            node = { id: scriptid, parent, children: new Set() };
            parent.children.add(scriptid);
            nodedepths.set(scriptid, node);
            runchildren = true;
        } else if (getdepth(node) > getdepth(parent) + 1) {
            node.parent?.children.delete(scriptid);
            node.parent = parent;
            runchildren = true;
        }
        if (runchildren) {
            for (let id of fn.scripts) {
                iter(node, id);
            }
        }
    }

    let rootnode: DepthNode = { id: -1, parent: null, children: new Set() };
    for (let entry of mod.entrypoints) {
        iter(rootnode, entry);
    }
    // let lenmap = Array.from({ length: nodedepths.size });
    // let res = "from," + lenmap.map((q, i) => "to" + i) + "\n";
    // for (let [id, node] of nodedepths) {
    //     res += `${id},${lenmap.map((q, i) => [...node.children][i] ?? "").join(",")}\n`;
    // }
    let res = "from,to\n";
    for (let [id, node] of nodedepths) {
        for (let child of node.children) {
            res += `${node.id},${child}\n`;
        }
    }
    return res;
}
globalThis.analizeCallGraph = analyzeCallGraph;

function alanyzeFull(mod: IsolatedCS2Module) {
    let res = "from,to\n";
    for (let [id, node] of mod.scripts) {
        for (let child of node.scripts) {
            res += `${id},${child}\n`;
        }
    }
    return res;
}
globalThis.alanyzeFull = alanyzeFull;


function scriptdeps(mod: IsolatedCS2Module, fn: CS2Script) {

    let consts: StackConstants | null = new StackConstants();
    let hasunknown = false;

    let cursor = new RewriteCursor(fn.func);

    for (let node = cursor.goToStart(); node; node = cursor.next()) {
        if (isNamedOp(node, namedClientScriptOps.enum_getvalue)) {
            //enum_getvalue(keytype,outtype,enumid,keyid)
            let enumid = consts?.values.at(-2);
            if (typeof enumid == "number") { fn.enums.add(enumid); }
        }
        if (isNamedOp(node, namedClientScriptOps.struct_getparam)) {
            //enum_getvalue(structid,paramid)
            let param = consts?.values.at(-1);
            let struct = consts?.values.at(-2);
            if (typeof param == "number") { fn.params.add(param); }
            if (typeof struct == "number") { fn.structs.add(struct); }
        }
        if (isNamedOp(node, namedClientScriptOps.enum_getreverseindex)) {
            //enum_getvalue(keytype,outtype,enumid,keyid,index)
            let enumid = consts?.values.at(-3);
            if (typeof enumid == "number") { fn.enums.add(enumid); }
        }
        if (isNamedOp(node, namedClientScriptOps.gosub)) {
            fn.scripts.add(node.op.imm);
        }
        if (isNamedOp(node, namedClientScriptOps.popvarbit) || isNamedOp(node, namedClientScriptOps.pushvarbit)) {
            fn.varbits.add(node.op.imm);
        }
        if (isNamedOp(node, namedClientScriptOps.popvar) || isNamedOp(node, namedClientScriptOps.pushvar)) {
            fn.vars.add(node.op.imm);
        }
        if (node instanceof FunctionBindNode) {
            let scriptid = node.children[0]?.knownStackDiff?.constout ?? -1;
            if (typeof scriptid == "number" && scriptid != -1) {
                // can't mock like this because it also hides direct calls in other sections
                // if (mod.mockcallbacks) { mod.mockscripts.add(scriptid); }
                // fn.scripts.add(scriptid);
            }
        }

        // keep track of stack
        let stackinout = node.knownStackDiff;
        if (node instanceof RawOpcodeNode) {
            stackinout ??= node.opinfo.stackinfo;
            hasunknown ||= node.unknownstack;
        }

        if (consts) {
            if (node.knownStackDiff?.constout != null) {
                consts.pushOne(node.knownStackDiff.constout);
            } else if (stackinout?.initializedthrough) {
                consts.applyInOut(stackinout);
            } else {
                consts = null;
            }
        }
    }
}