import { has, hasMore, parse, optional, invert, isEnd } from "../libs/yieldparser";
import { AstNode, BranchingStatement, CodeBlockNode, FunctionBindNode, IfStatementNode, RawOpcodeNode, VarAssignNode, WhileLoopStatementNode, SwitchStatementNode, ClientScriptFunction, astToImJson, ComposedOp } from "./ast";
import { ClientscriptObfuscation, OpcodeInfo } from "./callibrator";
import { TsWriterContext, debugAst } from "./codewriter";
import { binaryOpIds, binaryOpSymbols, typeToPrimitive, knownClientScriptOpNames, namedClientScriptOps, variableSources, StackDiff, StackInOut, StackList, StackTypeExt, getParamOps, dynamicOps, subtypes, subtypeToTs, ExactStack, tsToSubtype } from "./definitions";
import prettyJson from "json-stringify-pretty-compact";
import { ClientScriptSubtypeSolver } from "./subtypedetector";

function* whitespace() {
    while (true) {
        let match = yield [/^\/\/.*$/m, /^\/\*[\s\S]*?\*\//, /^\s+/, ""];
        if (match === "") { break; }
    }
}
const newline = /^\s*?\n/;
const unmatchable = /$./;
const reserverd = "if,while,break,continue,else,switch,strcat,script,return".split(",");
const binaryconditionals = "||,&&,>=,<=,==,!=,>,<".split(",");
const binaryops = [...binaryOpSymbols.values()];
const binaryopsoremtpy = binaryops.concat("");

globalThis.prettyjson = prettyJson;

export function clientscriptParser(deob: ClientscriptObfuscation) {

    function makeStringConst(str: string, subtypestr: string) {
        let constop = getopinfo(namedClientScriptOps.pushconst);
        let node = new RawOpcodeNode(-1, { opcode: constop.id, imm: 2, imm_obj: str }, constop);
        node.knownStackDiff = new StackInOut(new StackList([]), new StackList(["string"]));
        node.knownStackDiff.constout = str;
        if (subtypestr != "") {
            node.knownStackDiff.exactout = new ExactStack();
            node.knownStackDiff.exactout.string.push(tsToSubtype(subtypestr));
        }
        return node;
    }

    function makeLongConst(int1: number, int2: number, subtypestr: string) {
        let constop = getopinfo(namedClientScriptOps.pushconst);
        let val: [number, number] = [int1, int2];
        let node = new RawOpcodeNode(-1, { opcode: constop.id, imm: 1, imm_obj: val }, constop);
        node.knownStackDiff = new StackInOut(new StackList([]), new StackList(["long"]));
        node.knownStackDiff.constout = val;
        if (subtypestr != "") {
            node.knownStackDiff.exactout = new ExactStack();
            node.knownStackDiff.exactout.long.push(tsToSubtype(subtypestr));
        }
        return node;
    }

    function makeIntConst(int: number, subtypestr: string) {
        let constop = getopinfo(namedClientScriptOps.pushconst);
        let node = new RawOpcodeNode(-1, { opcode: constop.id, imm: 0, imm_obj: int }, constop);
        node.knownStackDiff = new StackInOut(new StackList([]), new StackList(["int"]));
        node.knownStackDiff.constout = int;
        if (subtypestr != "") {
            node.knownStackDiff.exactout = new ExactStack();
            node.knownStackDiff.exactout.int.push(tsToSubtype(subtypestr));
        }
        return node;
    }

    function getopinfo(id: number) {
        return deob.getNamedOp(id);
    }

    // function* stackdiff() {
    //     let [match, int, long, string, vararg] = yield (/^\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    //     return new StackDiff(+int, +long, +string, +vararg);
    // }

    // function* stacklist() {
    //     let items: StackTypeExt[] = [];
    //     while (items.length == 0 || (yield has(","))) {
    //         yield whitespace;
    //         let match = yield [stackdiff, "int", "long", "string", "vararg", ""];
    //         if (match == "") {
    //             if (items.length == 0) { break; }
    //             yield unmatchable;
    //         }
    //         items.push(match);
    //     }
    //     return new StackList(items);
    // }

    function* argumentDeclaration() {
        let args: { name: string, type: string }[] = [];
        while (true) {
            let name = yield [varname, ""];
            if (!name) { break; }
            yield whitespace;
            let type = "";
            if (yield has(":")) {
                yield whitespace;
                [type] = yield (/^\w+/);
            }
            args.push({ name, type });
            yield whitespace;
            if (!(yield has(","))) { break; }
        }
        return args;
    }

    function* typeDeclaration() {
        let first = yield [/^\w+/, "["];
        if (first == "void") { return []; }
        if (first != "[") { return [first] }
        let typelist: string[] = [];
        while (true) {
            if ((yield has("]"))) { break; }
            yield whitespace;
            typelist.push((yield (/^\w+/))[0]);
            yield whitespace;
            yield [",", /^(?=])/];
            yield whitespace;
        }
        return typelist;
    }

    function* stringInterpolation() {
        yield "`";
        let parts: AstNode[] = [];
        let str = "";
        while (true) {
            let next = yield ["${", "`", /^[\s\S]/];
            if (next == "\\") {
                str += yield (/^[\s\S]/);
            } else if (next == "${") {
                if (str != "") { parts.push(makeStringConst(str, "")); }
                str = "";
                yield whitespace;
                parts.push(yield valueStatement);
                yield whitespace;
                yield "}";
            } else if (next == "`") {
                if (str != "") { parts.push(makeStringConst(str, "")); }
                break;
            } else {
                str += next;
            }
        }
        let strjoin = getopinfo(namedClientScriptOps.joinstring);
        let node = new RawOpcodeNode(-1, { opcode: strjoin.id, imm: parts.length, imm_obj: null }, strjoin);
        node.pushList(parts);
        return node;
    }

    function* literalcast() {
        if (yield has("as")) {
            yield whitespace;
            return yield varname;
        }
        return "";
    }

    function* stringliteral() {
        yield '"';
        let value = "";
        while (!(yield has('"'))) {
            let next = yield ["\\", /^[^"]/];
            if (next == "\\") {
                value += yield (/^./)
            } else {
                value += next;
            }
        }
        yield whitespace;
        let subt = yield literalcast;
        return makeStringConst(value, subt || "string");
    }

    function* intliteral() {
        let [digits] = yield (/^-?\d+\b/);
        yield whitespace;
        let subt = yield literalcast;
        return makeIntConst(parseInt(digits, 10), subt || "int");
    }

    function* longliteral() {
        let [match, int] = yield (/^(-\d+)n\b/);
        let bigint = BigInt(int) & 0xffff_ffff_ffff_ffffn;
        let upper = Number((bigint >> 32n) & 0xffff_ffffn);
        let lower = Number(bigint & 0xffff_ffffn);
        yield whitespace;
        let subt = yield literalcast;
        return makeLongConst(upper, lower, subt || "long");
    }

    function* varname() {
        const [name]: [string] = yield (/^[a-zA-Z]\w*/);
        if (reserverd.includes(name)) { yield unmatchable; }
        return name;
    }

    function* valueList() {
        let args: any[] = [];
        while (true) {
            args.push(yield valueStatement);
            yield whitespace;
            if (!(yield has(","))) { break; }
            yield whitespace;
        }
        return args;
    }

    function* call() {
        let funcname: string = yield varname;
        let metaid = 0;
        yield whitespace;
        if (yield has("[")) {
            metaid = parseInt(yield (/^-?\d+/), 10);
            yield whitespace;
            yield "]";
            yield whitespace;
        }
        yield "(";
        yield whitespace;
        let args: AstNode[];
        if (yield has(")")) {
            args = [];
        } else {
            args = yield valueList;
            yield whitespace;
            yield ")";
        }

        if (funcname == "callback") {
            let res = new FunctionBindNode(-1, new StackList());//TODO need this list in order to compile
            if (args.length == 0) {
                res.push(makeIntConst(-1, "int"));
            } else {
                res.pushList(args);
            }
            return res;
        }

        let fnid = -1;
        let unkmatch = funcname.match(/^(unk|script)(\d+)$/);
        if (unkmatch) {
            if (unkmatch[1] == "unk") {
                fnid = +unkmatch[2];
            } else {
                metaid = +unkmatch[2];
                fnid = namedClientScriptOps.gosub;
            }
        } else {
            for (let id in knownClientScriptOpNames) {
                if (funcname == knownClientScriptOpNames[id]) {
                    fnid = +id;
                }
            }
        }
        let fn = getopinfo(fnid);
        let node = new RawOpcodeNode(-1, { opcode: fnid, imm: metaid, imm_obj: null }, fn);
        node.pushList(args);
        return node;
    }

    function* returnStatement() {
        yield "return";
        yield whitespace;
        let values: AstNode[];
        let first = yield [valueStatement, "[", ""];
        if (first instanceof AstNode) {
            values = [first];
        } else if (first == "[") {
            yield whitespace;
            values = yield valueList
            yield whitespace;
            yield "]";
        } else {
            values = [];
        }
        let returnop = getopinfo(namedClientScriptOps.return);
        let res = new RawOpcodeNode(-1, { opcode: returnop.id, imm: 0, imm_obj: null }, returnop);
        res.pushList(values);
        return res;
    }

    function* assignStatement() {
        let hasvarkeyword = yield has("var");
        yield whitespace;
        let varnames: string[] = [];
        let first = yield [varname, "["];
        if (first == "[") {
            yield whitespace;
            while (!(yield has("]"))) {
                if (varnames.length != 0) {
                    yield ",";
                    yield whitespace;
                }
                varnames.push(yield varname);
                yield whitespace;
            }
        } else {
            varnames.push(first);
        }
        yield whitespace;
        yield (/^=(?!=)/);
        let values: AstNode[];
        //deal with incomplete code where the assigned variables are unknown but somewhere on stack
        if (yield has(newline)) {
            values = [];
        } else {
            yield whitespace;
            values = yield [valueList, "\n"];
        }
        let node = new VarAssignNode(-1);

        node.varops = varnames.map(q => {
            let m = q.match(/^(int|long|string|var(\w+)_)(\d+)$/);
            if (!m) { throw new Error("unknown var name"); }
            let varid = +m[3];
            if (m[2]) {
                let popvar = getopinfo(namedClientScriptOps.popvar);
                let source = variableSources[m[2]];
                if (!source) { throw new Error("unknown var source"); }
                let varkey = (source.key << 24) | (varid << 8);
                return new RawOpcodeNode(-1, { opcode: popvar.id, imm: varkey, imm_obj: null }, popvar);
            } else if (m[1] == "int") {
                let popintop = getopinfo(namedClientScriptOps.poplocalint);
                return new RawOpcodeNode(-1, { opcode: popintop.id, imm: varid, imm_obj: null }, popintop);
            } else if (m[1] == "long") {
                let poplongop = getopinfo(namedClientScriptOps.poplocallong);
                return new RawOpcodeNode(-1, { opcode: poplongop.id, imm: varid, imm_obj: null }, poplongop);
            } else if (m[1] == "string") {
                let popstringop = getopinfo(namedClientScriptOps.poplocalstring);
                return new RawOpcodeNode(-1, { opcode: popstringop.id, imm: varid, imm_obj: null }, popstringop);
            } else {
                throw new Error("unexpected");
            }
        });

        node.pushList(values);

        return node;
    }

    function* switchCaseEntry() {
        let value = 0;
        let type = yield ["case", "default"];
        yield whitespace;
        if (type == "case") {
            value = parseInt(yield (/^-?\d+/), 10);
            yield whitespace;
        }
        yield ":";
        return { type, value };
    }

    function* switchStatement() {
        yield "switch";
        yield whitespace;
        yield "(";
        yield whitespace;
        let switchvalue = yield valueStatement;
        yield whitespace;
        yield ")";
        yield whitespace;
        yield "{";
        yield whitespace;
        let cases: { value: number, block: CodeBlockNode }[] = [];
        let defaultcase = null;
        while (!(yield has("}"))) {
            let entries: { type: "case" | "default", value: number }[] = [];
            while (true) {
                let entry = yield [switchCaseEntry, ""];
                if (!entry) { break; }
                yield whitespace;
                entries.push(entry);
            }
            let block = yield [codeBlock];
            yield whitespace;
            for (let { type, value } of entries) {
                if (type == "case") {
                    cases.push({ value, block });
                } else {
                    defaultcase = block;
                }
            }
        }
        let node = new SwitchStatementNode(-1, switchvalue, defaultcase, cases);
        return node;
    }

    function* ifStatement() {
        yield "if";
        yield whitespace;
        yield "(";
        yield whitespace;
        let condition = yield valueStatement;
        yield whitespace;
        yield ")";
        yield whitespace;
        let truebranch = yield codeBlock;
        yield whitespace;
        let falsebranch: any = null;
        if (yield has("else")) {
            yield whitespace;
            falsebranch = yield [ifStatement, codeBlock];
            if (falsebranch instanceof IfStatementNode) {
                falsebranch = new CodeBlockNode(-1, -1, [falsebranch]);
            }
        }
        let node = new IfStatementNode(-1);
        node.setBranches(condition, truebranch, falsebranch, -1);
        return node;
    }

    function* readVariable() {
        let preop = yield ["++", "--", ""];
        if (preop) { yield whitespace; }
        let name = yield [varname];
        let m = name.match(/^(int|long|string|script|var(\w+)_)(\d+)$/);
        if (!m) { throw new Error("unknown var name"); }
        let postop = "";
        if (!preop) {
            yield whitespace;
            postop = yield ["++", "--", ""];
        }
        let varid = +m[3];
        let readopid: number;
        let writeopid: number;
        if (m[1] == "script") {
            //function pointer used in callback
            return makeIntConst(varid, "int");
        } else if (m[2]) {
            let source = variableSources[m[2]];
            if (!source) { throw new Error("unknown var source"); }
            varid = (source.key << 24) | (varid << 8);
            readopid = namedClientScriptOps.pushvar;
            writeopid = namedClientScriptOps.popvar;
        } else if (m[1] == "int") {
            readopid = namedClientScriptOps.pushlocalint;
            writeopid = namedClientScriptOps.poplocalint;
        } else if (m[1] == "long") {
            readopid = namedClientScriptOps.pushlocallong;
            writeopid = namedClientScriptOps.poplocallong;
        } else if (m[1] == "string") {
            readopid = namedClientScriptOps.pushlocalstring;
            writeopid = namedClientScriptOps.poplocalstring;
        } else {
            throw new Error("unexpected");
        }
        let readop = getopinfo(readopid);
        if (postop || preop) {
            let writeop = getopinfo(writeopid);
            let operationop = getopinfo(postop == "++" || preop == "++" ? namedClientScriptOps.plus : namedClientScriptOps.minus);
            let combined = new ComposedOp(-1, (preop == "--" ? "--x" : preop == "++" ? "++x" : postop == "--" ? "x--" : "x++"), varid);
            if (postop) { combined.internalOps.push(new RawOpcodeNode(-1, { opcode: readop.id, imm: varid, imm_obj: null }, readop)); }
            combined.internalOps.push(new RawOpcodeNode(-1, { opcode: readop.id, imm: varid, imm_obj: null }, readop));
            combined.internalOps.push(makeIntConst(1, "int"));
            combined.internalOps.push(new RawOpcodeNode(-1, { opcode: operationop.id, imm: 0, imm_obj: null }, operationop));
            combined.internalOps.push(new RawOpcodeNode(-1, { opcode: writeop.id, imm: varid, imm_obj: null }, writeop));
            if (preop) { combined.internalOps.push(new RawOpcodeNode(-1, { opcode: readop.id, imm: varid, imm_obj: null }, readop)); }
            return combined;
        } else {
            return new RawOpcodeNode(-1, { opcode: readop.id, imm: varid, imm_obj: null }, readop);
        }
    }

    function* bracketedValue() {
        yield "(";
        yield whitespace;
        let res = yield valueStatement;
        yield whitespace;
        yield ")";
        return res;
    }

    function* whileStatement() {
        yield "while";
        yield whitespace;
        yield "(";
        yield whitespace;
        let condition = yield valueStatement;
        yield whitespace;
        yield ")";
        yield whitespace;
        let code = yield codeBlock;
        return new WhileLoopStatementNode(-1, condition, code);
    }

    function* valueStatement() {
        let left = yield [incorrectBinaryOp, bracketedValue, call, readVariable, stringInterpolation, literal];
        yield whitespace;
        //TODO doesn't currently account for operator precedence
        let op = yield binaryopsoremtpy;
        if (op == "") { return left; }
        yield whitespace;
        let right = yield valueStatement;
        let opid = binaryOpIds.get(op);
        if (!opid) { throw new Error("unexpected"); }
        let node: AstNode;
        if (binaryconditionals.includes(op)) {
            node = new BranchingStatement({ opcode: opid, imm: 0, imm_obj: null }, -1);
        } else {
            node = new RawOpcodeNode(-1, { opcode: opid, imm: 0, imm_obj: null }, deob.getNamedOp(opid));
        }
        node.children.push(left, right);
        return node;
    }

    function* incorrectBinaryOp() {
        yield "(";
        yield whitespace;
        let op = yield binaryops;
        //need at least one whitespace to prevent matching x=(-5)
        if ((yield whitespace) == "") {
            yield unmatchable;
        }
        let statements = yield statementlist;
        yield ")";
        let opid = binaryOpIds.get(op);
        if (!opid) { throw new Error("unexpected"); }
        let node: AstNode;
        if (binaryconditionals.includes(op)) {
            node = new BranchingStatement({ opcode: opid, imm: 0, imm_obj: null }, -1);
        } else {
            node = new RawOpcodeNode(-1, { opcode: opid, imm: 0, imm_obj: null }, deob.getNamedOp(opid));
        }
        node.pushList(statements);
        return node;
    }

    function* literal() {
        return yield [intliteral, stringliteral, longliteral];
    }

    function* statement() {
        return yield [ifStatement, whileStatement, switchStatement, returnStatement, assignStatement, valueStatement];
    }

    function* statementlist() {
        let statements: any[] = [];
        yield whitespace;
        while (true) {
            let next = yield [";", statement, ""];
            if (next == "") { break; }
            if (next != ";") {
                statements.push(next);
            }
            yield whitespace;
        }
        return statements;
    }

    function* codeBlock() {
        yield "{";
        let statements = yield statementlist;
        let closed = yield ["}", ""];
        if (!closed) { throw new Error("closing bracket expected"); }
        return new CodeBlockNode(-1, -1, statements);
    }

    function* functionFile() {
        yield whitespace;
        yield "function";
        yield whitespace;
        let [name]: [string] = yield (/^\w+/);
        yield whitespace;
        yield "(";
        yield whitespace;
        let argtypes: { name: string, type: string }[] = yield argumentDeclaration;
        yield whitespace;
        yield ")";
        yield whitespace;
        yield ":";
        yield whitespace;
        let returntypes: string[] = yield typeDeclaration;
        yield whitespace;
        let codeblock: CodeBlockNode = yield codeBlock;
        let namematch = name.match(/^script(\d+)$/);
        let res = new ClientScriptFunction(
            (namematch ? +namematch[1] : -1),
            new StackList(returntypes.map(q => typeToPrimitive(tsToSubtype(q)))),
            new StackList(argtypes.map(q => typeToPrimitive(tsToSubtype(q.type))))
        );
        res.push(codeblock);
        return res;
    }

    function runparse(code: string) {
        let res = parse<ClientScriptFunction>(code, functionFile() as any);
        return res;
    }

    return { runparse, deob };
}

//TODO remove
globalThis.testy = async () => {
    const fs = require("fs") as typeof import("fs");
    let codefs = await globalThis.cli("extract -m clientscripttext -i 0-2999");
    let codefiles = [...codefs.extract.filesMap.entries()]
        .filter(q => q[0].startsWith("clientscript"))
        .map(q => q[1].data.replace(/^\d+:/gm, m => " ".repeat(m.length))); 1;
    let jsonfs = await globalThis.cli("extract -m clientscript -i 0-2999");
    jsonfs.extract.filesMap.delete(".schema-clientscript.json");
    let jsonfiles = [...jsonfs.extract.filesMap.values()];
    let subtest = (index: number) => {
        const deob = globalThis.deob as ClientscriptObfuscation;
        const originalts = codefiles[index];
        let parseresult = clientscriptParser(deob).runparse(originalts);
        if (!parseresult.success) { return parseresult; }
        let roundtripped = astToImJson(deob, parseresult.result);
        let jsondata = JSON.parse(jsonfiles[index].data);
        delete jsondata.$schema;
        // jsondata.opcodedata.forEach(q => { delete q.opname });
        roundtripped.opcodedata.forEach(q => (q as any).opname = knownClientScriptOpNames[q.opcode] ?? `unk_${q.opcode}`);
        let original = prettyJson(jsondata.opcodedata);

        let rawinput = prettyJson(jsondata);
        let rawroundtrip = prettyJson(roundtripped);
        let roundtripts = new TsWriterContext(deob, new ClientScriptSubtypeSolver()).getCode(parseresult.result);

        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/raw1.json", rawinput);
        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/raw2.json", rawroundtrip);
        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/json1.json", prettyJson(jsondata.opcodedata));
        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/json2.json", prettyJson(roundtripped.opcodedata));
        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/js1.ts", originalts);
        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/js2.ts", roundtripts);
        return { exact: rawinput == rawroundtrip, exactts: originalts == roundtripts, roundtripped, original };
    }
    return { subtest, codefiles, codefs, jsonfs, jsonfiles };
}

export function writeOpcodeFile(calli: ClientscriptObfuscation) {
    let res = "";
    res += "declare class BoundFunction{}\n";
    res += "declare function callback():BoundFunction;\n";
    res += "declare function callback<T extends (...args:any[])=>any>(fn:T,...args:Parameters<T>):BoundFunction;\n";
    res += "\n";
    for (let type of Object.values(subtypes)) {
        let prim = typeToPrimitive(type);
        let name = subtypeToTs(type);
        if (name == "string") { continue; }
        res += `type ${name} = ${prim == "int" ? "number" : prim == "long" ? "BigInt" : "string"}\n`;
    }
    res += "\n";
    for (let op of calli.mappings.values()) {
        let opname = knownClientScriptOpNames[op.id] ?? `unk${op.id}`;
        if (reserverd.includes(opname)) { continue; }
        if (op.id == namedClientScriptOps.enum_getvalue) {
            res += `declare function ${opname}(int0:number,int1:number,int2:number,int3:number):any;\n`;
        } else if (op.id == namedClientScriptOps.dbrow_getfield) {
            res += `declare function ${opname}(int0:number,int1:number,int2:number):any;\n`;
        } else if (!dynamicOps.includes(op.id) && op.stackinfo.initializedthrough) {
            let args = op.stackinfo.in.toTypeScriptVarlist(true, op.stackinfo.exactin);
            let returns = op.stackinfo.out.toTypeScriptReturnType(op.stackinfo.exactout);
            res += `declare function ${opname}(${args}):${returns};\n`;
        } else {
            res += `declare function ${opname}(...args:any[]):any;\n`;
        }
    }
    return res;
}

export function writeClientVarFile(calli: ClientscriptObfuscation) {
    let res = "";
    for (let domain of calli.varmeta.values()) {
        res += `// ===== ${domain.name} =====\n`;
        for (let [id, meta] of domain.vars) {
            res += `declare var var${domain.name}_${id}: ${subtypeToTs(meta.type)};\n`;
        }
    }
    return res;
}