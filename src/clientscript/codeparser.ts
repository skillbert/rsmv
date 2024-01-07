import { has, hasMore, parse, optional, invert, isEnd } from "../libs/yieldparser";
import { AstNode, BinaryOpStatement, CodeBlockNode, FunctionBindNode, IfStatementNode, RawOpcodeNode, VarAssignNode, WhileLoopStatementNode, SwitchStatementNode } from "./ast";
import { ClientscriptObfuscation, knownClientScriptOpNames, namedClientScriptOps, variableSources } from "./callibrator";

const whitespace = /^\s*/;
const unmatchable = /$./;
const reserverd = "if,while,break,continue,else,switch".split(",");
const binaryops = ["+", "-", "/", "*", "%", "||", "&&", ">=", "<=", "==", "!=", ">", "<"];
const binaryopsoremtpy = binaryops.concat("");

export function clientscriptParser(deob: ClientscriptObfuscation) {
    function getopinfo(id: number) {
        let res = deob.decodedMappings.get(id);
        if (!res) { throw new Error("named op not found"); }
        return res;
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
        let constop = getopinfo(namedClientScriptOps.pushconst);
        return new RawOpcodeNode(-1, { opcode: constop.id, imm: 2, imm_obj: value }, constop);
    }

    function* intliteral() {
        let digits = yield (/^-?\d+/);
        let value = parseInt(digits, 10);
        let constop = getopinfo(namedClientScriptOps.pushconst);
        return new RawOpcodeNode(-1, { opcode: constop.id, imm: 0, imm_obj: value }, constop);
    }

    function* longliteral() {
        //TODO
        yield unmatchable;
    }

    function* varname() {
        const [name]: [string] = yield (/^[a-zA-Z]\w*/);
        if (reserverd.includes(name)) { yield unmatchable; }
        return name;
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
        let args: any[] = [];
        while (!(yield has(")"))) {
            if (args.length != 0) {
                yield ",";
                yield whitespace;
            }
            args.push(yield valueStatement);
            yield whitespace;
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
        let fn = deob.decodedMappings.get(fnid);
        if (!fn) { throw new Error("function name not found " + funcname); }
        let node = new RawOpcodeNode(-1, { opcode: fnid, imm: metaid, imm_obj: null }, fn);
        node.pushList(args);
        return node;
    }

    function* assignStatement() {
        let varnames: string[] = [];
        while (!(yield has("="))) {
            if (varnames.length != 0) {
                yield ",";
                yield whitespace;
            }
            varnames.push(yield varname);
            yield whitespace;
        }
        yield whitespace;
        let value = yield valueStatement;
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
                // } else if (m[2] == "long") {
                // let popintop=getopinfo(namedClientScriptOps.poplocalint);
                //     return new RawOpcodeNode(-1, { opcode: poplongop.id, imm: varid, imm_obj: null }, poplongop);
            } else if (m[3] == "string") {
                let popstringop = getopinfo(namedClientScriptOps.poplocalstring);
                return new RawOpcodeNode(-1, { opcode: popstringop.id, imm: varid, imm_obj: null }, popstringop);
            } else {
                throw new Error("unexpected");
            }
        });

        node.children.push(value);

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
            // } else if (m[2] == "long") {
            // let popintop=getopinfo(namedClientScriptOps.poplocalint);
            //     return new RawOpcodeNode(-1, { opcode: poplongop.id, imm: varid, imm_obj: null }, poplongop);
        } else if (m[3] == "string") {
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
        yield "if";
        yield whitespace;
        yield "(";
        yield whitespace;
        let condition = yield valueStatement;
        yield whitespace;
        yield ")";
        let code = yield codeBlock;
        return new WhileLoopStatementNode(-1, condition, code);
    }

    function* valueStatement() {
        let left = yield [incorrectBinaryOp, bracketedValue, call, readVariable, literal];
        yield whitespace;
        //TODO doesn't currently account for operator precedence
        let op = yield binaryopsoremtpy;
        if (op == "") { return left; }
        yield whitespace;
        let right = yield valueStatement;
        let node = new BinaryOpStatement(op, -1);
        node.children.push(left, right);
        return node;
    }

    function* incorrectBinaryOp() {
        yield "(";
        yield whitespace;
        let op = yield binaryops;

        let statements: any[] = [];
        yield whitespace;
        while (true) {
            let next = yield [statement, ""];
            if (next == "") { break; }
            statements.push(next);
            yield whitespace;
        }
        yield ")";
        let node = new BinaryOpStatement(op, -1);
        node.pushList(statements);
        return node;
    }

    function* literal() {
        return yield [intliteral, stringliteral, longliteral];
    }

    function* statement() {
        return yield [assignStatement, ifStatement, whileStatement, switchStatement, valueStatement];
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

    function runparse(code: string) {
        let res = parse(code, statementlist());
        if (res.success) {
            (res.result as any) = new CodeBlockNode(-1, -1, res.result);
        }
        return res;
    }

    return { runparse, deob };
}