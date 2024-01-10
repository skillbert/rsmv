import { has, hasMore, parse, optional, invert, isEnd } from "../libs/yieldparser";
import { AstNode, BranchingStatement, CodeBlockNode, FunctionBindNode, IfStatementNode, RawOpcodeNode, VarAssignNode, WhileLoopStatementNode, SwitchStatementNode, ClientScriptFunction, astToImJson } from "./ast";
import { ClientscriptObfuscation } from "./callibrator";
import { binaryOpIds, binaryOpSymbols, knownClientScriptOpNames, namedClientScriptOps, variableSources, StackDiff, StackInOut, StackList, StackTypeExt } from "./definitions";
import prettyJson from "json-stringify-pretty-compact";

function* whitespace() {
    while (true) {
        let match = yield [/^\/\/.*$/m, /^\/\*[\s\S]*\*\//, /^\s+/, ""];
        if (match === "") { break; }
    }
}
const newline = /^\s*?\n/;
const unmatchable = /$./;
const reserverd = "if,while,break,continue,else,switch,strcat,script".split(",");
const binaryconditionals = "||,&&,>=,<=,==,!=,>,<".split(",");
const binaryops = [...binaryOpSymbols.values()];
const binaryopsoremtpy = binaryops.concat("");

globalThis.prettyjson = prettyJson;

export function clientscriptParser(deob: ClientscriptObfuscation) {

    function makeStringConst(str: string) {
        let constop = getopinfo(namedClientScriptOps.pushconst);
        let node = new RawOpcodeNode(-1, { opcode: constop.id, imm: 2, imm_obj: str }, constop);
        node.knownStackDiff = new StackInOut(new StackList([]), new StackList(["string"]));
        node.knownStackDiff.constout = str;
        return node;
    }

    function makeLongConst(int1: number, int2: number) {
        let constop = getopinfo(namedClientScriptOps.pushconst);
        let val: [number, number] = [int1, int2];
        let node = new RawOpcodeNode(-1, { opcode: constop.id, imm: 1, imm_obj: val }, constop);
        node.knownStackDiff = new StackInOut(new StackList([]), new StackList(["long"]));
        node.knownStackDiff.constout = val;
        return node;
    }

    function makeIntConst(int: number) {
        let constop = getopinfo(namedClientScriptOps.pushconst);
        let node = new RawOpcodeNode(-1, { opcode: constop.id, imm: 0, imm_obj: int }, constop);
        node.knownStackDiff = new StackInOut(new StackList([]), new StackList(["int"]));
        node.knownStackDiff.constout = int;
        return node;
    }

    function getopinfo(id: number) {
        return deob.getNamedOp(id);
    }

    function* stackdiff() {
        let [match, int, long, string, vararg] = yield (/^\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
        return new StackDiff(+int, +long, +string, +vararg);
    }

    function* stacklist() {
        let items: StackTypeExt[] = [];
        while (items.length == 0 || (yield has(","))) {
            yield whitespace;
            let match = yield [stackdiff, "int", "long", "string", "vararg", ""];
            if (match == "") {
                if (items.length == 0) { break; }
                yield unmatchable;
            }
            items.push(match);
        }
        return new StackList(items);
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
                parts.push(makeStringConst(str));
                str = "";
                yield whitespace;
                parts.push(yield valueStatement);
                yield whitespace;
                yield "}";
            } else if (next == "`") {
                parts.push(makeStringConst(str));
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
        return makeStringConst(value);
    }

    function* intliteral() {
        let [digits] = yield (/^-?\d+\b/);
        return makeIntConst(parseInt(digits, 10));
    }

    function* longliteral() {
        let [match, int] = yield (/^(-\d+)n\b/);
        let bigint = BigInt(int) & 0xffff_ffff_ffff_ffffn;
        let upper = Number((bigint >> 32n) & 0xffff_ffffn);
        let lower = Number(bigint & 0xffff_ffffn);
        return makeLongConst(upper, lower);
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

        if (funcname == "bind") {
            let res = new FunctionBindNode(-1, new StackList());//TODO need this list in order to compile

            let constop = getopinfo(namedClientScriptOps.pushconst);
            let node = new RawOpcodeNode(-1, { opcode: constop.id, imm: 0, imm_obj: metaid }, constop);
            node.knownStackDiff = new StackInOut(new StackList([]), new StackList(["int"]));
            node.knownStackDiff.constout = metaid;

            res.push(node);
            res.pushList(args);
            return res;
        }

        let fnid = -1;
        let unkmatch = funcname.match(/^unk(\d+)$/);
        if (unkmatch) {
            fnid = +unkmatch[1];
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

    function* assignStatement() {
        let varnames: string[] = [];
        while (!(yield has(/^=(?!=)/))) {
            if (varnames.length != 0) {
                yield ",";
                yield whitespace;
            }
            varnames.push(yield varname);
            yield whitespace;
        }
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
                // } else if (m[1] == "long") {
                // let popintop=getopinfo(namedClientScriptOps.poplocalint);
                //     return new RawOpcodeNode(-1, { opcode: poplongop.id, imm: varid, imm_obj: null }, poplongop);
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
        let name = yield varname;
        let m = name.match(/^(int|long|string|var(\w+)_)(\d+)$/);
        if (!m) { throw new Error("unknown var name"); }
        let varid = +m[3];
        if (m[2]) {
            let popvar = getopinfo(namedClientScriptOps.pushvar);
            let source = variableSources[m[2]];
            if (!source) { throw new Error("unknown var source"); }
            let varkey = (source.key << 24) | (varid << 8);
            return new RawOpcodeNode(-1, { opcode: popvar.id, imm: varkey, imm_obj: null }, popvar);
        } else if (m[1] == "int") {
            let popintop = getopinfo(namedClientScriptOps.pushlocalint);
            return new RawOpcodeNode(-1, { opcode: popintop.id, imm: varid, imm_obj: null }, popintop);
        } else if (m[1] == "long") {
            let poplongop = getopinfo(namedClientScriptOps.pushlocallong);
            return new RawOpcodeNode(-1, { opcode: poplongop.id, imm: varid, imm_obj: null }, poplongop);
        } else if (m[1] == "string") {
            let popstringop = getopinfo(namedClientScriptOps.pushlocalstring);
            return new RawOpcodeNode(-1, { opcode: popstringop.id, imm: varid, imm_obj: null }, popstringop);
        } else {
            throw new Error("unexpected");
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
        return yield [ifStatement, whileStatement, switchStatement, assignStatement, valueStatement];
    }

    function* statementlist() {
        let statements: any[] = [];
        yield whitespace;
        while (true) {
            let next = yield [statement, ""];
            if (next == "") { break; }
            statements.push(next);
            yield whitespace;
        }
        return statements;
    }

    function* codeBlock() {
        yield "{";
        let statements = yield statementlist;
        yield "}";
        return new CodeBlockNode(-1, -1, statements);
    }

    function* functionFile() {
        yield "script";
        yield whitespace;
        let [name]: [string] = yield (/^\w+/);
        yield whitespace;
        let returntype: StackList = yield stacklist;
        yield whitespace;
        yield "(";
        yield whitespace;
        let argtype: StackList = yield stacklist;
        yield whitespace;
        yield ")";
        yield whitespace;
        let ops: AstNode[] = yield statementlist;
        let codeblock = new CodeBlockNode(-1, -1, ops);
        let res = new ClientScriptFunction(name, returntype, argtype);
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
    let codefs = await globalThis.cli("extract -m clientscripttext -i 0-1999");
    let codefiles = [...codefs.extract.filesMap.values()].map(q => q.data.replace(/^\d+:/gm, m => " ".repeat(m.length))); 1;
    let jsonfs = await globalThis.cli("extract -m clientscript -i 0-1999");
    jsonfs.extract.filesMap.delete(".schema-clientscript.json");
    let jsonfiles = [...jsonfs.extract.filesMap.values()];
    let subtest = (index: number) => {
        const deob = globalThis.deob as ClientscriptObfuscation;
        let parseresult = clientscriptParser(deob).runparse(codefiles[index]);
        if (!parseresult.success) { return parseresult; }
        let roundtripped = astToImJson(deob, parseresult.result);
        let jsondata = JSON.parse(jsonfiles[index].data);
        delete jsondata.$schema;
        jsondata.opcodedata.forEach(q => { delete q.opname });
        let original = prettyJson(jsondata.opcodedata);

        let rawinput = prettyJson(jsondata);
        let rawroundtrip = prettyJson(roundtripped);

        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/raw1.json", rawinput);
        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/raw2.json", rawroundtrip);
        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/json1.json", prettyJson(jsondata.opcodedata));
        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/json2.json", prettyJson(roundtripped.opcodedata));
        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/js1.js", codefiles[index]);
        fs.writeFileSync("C:/Users/wilbe/tmp/clinetscript/js2.js", parseresult.result.getCode(deob, 0));
        return { roundtripped, original, exact: rawinput == rawroundtrip };
    }
    return { subtest, codefiles, codefs, jsonfs, jsonfiles };
}