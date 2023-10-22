import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { trickleTasksTwoStep } from "../utils";
import { DecodeState } from "../opcode_reader";
import { clientscriptdata } from "../../generated/clientscriptdata";

type ClientScriptOp = {
    op: number,
    imm: number,
    imm_obj: string | number | [number, number] | null
}
export type ReadOpCallback = (state: DecodeState) => ClientScriptOp;

const lastNonObfuscatedBuild = 668;
function translateClientScript(opcodes: ClientScriptOp[], frombuild: number, tobuild: number) {
    let res = opcodes.slice()

    if (frombuild < 751 && tobuild >= 751) {
        opcodes = opcodes.map<ClientScriptOp>(q => {
            //for sure build 751
            if (q.op == 0x00) { return { op: 0x4101, imm: 0, imm_obj: q.imm }; }
            // if (q.op == 0x56) { return { op: 0x4001, imm: 0, imm_obj: q.imm }; }
            if (q.op == 0x36) { return { op: 0x4101, imm: 1, imm_obj: q.imm_obj }; }
            if (q.op == 0x03) { return { op: 0x4101, imm: 2, imm_obj: q.imm_obj }; }

            //idk build, between base and 751
            if (q.op == 0x2a) { return { op: 0x2a, imm: (2 << 24) | (q.imm << 8), imm_obj: q.imm_obj }; }
            if (q.op == 0x2b) { return { op: 0x2b, imm: (2 << 24) | (q.imm << 8), imm_obj: q.imm_obj }; }

            return q;
        });
    }

    return res;
}

function cannonicalOp(operation: ClientScriptOp) {
    let op = operation.op;
    let imm = operation.imm;
    let imm_obj = operation.imm_obj;
    if (op == 3) {
        if (typeof imm_obj == "number") {
            imm = imm_obj;
            imm_obj = null;
            op = 0x0;
        }
        if (typeof imm_obj == "string") {
            imm = 0;
        }
        if (typeof imm_obj == "object" && imm_obj) {
            imm = 0;
            op = 0x36;
        }
    }
    return { op, imm, imm_obj } as ClientScriptOp
}

function isOpEqual(a: ClientScriptOp, b: ClientScriptOp) {
    a = cannonicalOp(a);
    b = cannonicalOp(b);

    if (a.op != b.op) { return false; }
    if (a.imm != b.imm) {
        //imm is allowed to differ, as the value is not between 0-10 and is relatively near
        if (Math.sign(a.imm) != Math.sign(b.imm)) { return false; }
        if (a.imm >= 0 && a.imm < 10) { return false; }
        if (b.imm >= 0 && b.imm < 10) { return false; }
        if (Math.abs(a.imm - b.imm) > Math.max(a.imm + b.imm) / 2 * 0.2 + 10) { return false; }
    }
    if (typeof a.imm_obj != typeof b.imm_obj) { return false; }
    if (Array.isArray(a.imm_obj)) {
        if (!Array.isArray(b.imm_obj)) {
            return false;
        }
        //bigints are allowed to differ
    } else if (typeof a.imm_obj == "string") {
        //string are allowed to differ
    } else if (typeof a.imm_obj == "number") {
        //int value
        if (Math.abs(a.imm - b.imm) > Math.max(a.imm + b.imm) / 2 * 0.2 + 10) { return false; }
    } else if (a.imm_obj != b.imm_obj) {
        return false;
    }
    return true;
}

export async function findOpcodeImmidiates3(source: CacheFileSource) {
    const opclass = {
        byte: 0x81,
        int: 0x00,
        tribyte: 0x4102,
        switch: 0x4101,
        // long: 0x36,
        // string: 0x03,
    }
    type ImmediateType = keyof typeof opclass;
    const immediates = Object.keys(opclass) as ImmediateType[];
    type ScriptCandidate = {
        id: number,
        solutioncount: number,
        buf: Buffer,
        script: clientscriptdata,
        unknowns: Map<number, Opcode>
    };

    class Opcode {
        id: number;
        possibleTypes = new Set(immediates);
        type: ImmediateType | "unknown" = "unknown";
        constructor(id: number) {
            this.id = id;
        }
    }

    class SolveContext {
        ops: Map<number, Opcode>;
        unconfirmedops = new Map<number, Opcode>();
        constructor(ops: Map<number, Opcode>) {
            this.ops = ops;
        }
        getOp(id: number) {
            let res = this.ops.get(id);
            if (!res) {
                res = this.unconfirmedops.get(id);
                if (!res) {
                    res = new Opcode(id);
                    this.unconfirmedops.set(id, res);
                }
            }
            return res;
        }
    }


    function parseImm(buf: Buffer, offset: number, type: ImmediateType) {
        let imm = 0;
        let imm_obj = null as ClientScriptOp["imm_obj"];
        if (type == "byte") {
            if (buf.length < offset + 1) { return null; }
            imm = buf.readUint8(offset);
            offset += 1;
        } else if (type == "int") {
            if (buf.length < offset + 4) { return null; }
            imm = buf.readUint32BE(offset);
            offset += 4;
        } else if (type == "tribyte") {
            if (buf.length < offset + 3) { return null; }
            imm = buf.readUintBE(offset, 3);
            offset += 3;
        } else if (type == "switch") {
            if (buf.length < offset + 1) { return null; }
            let subtype = buf.readUint8(offset++);
            if (subtype == 0) {
                if (buf.length < offset + 4) { return null; }
                imm_obj = buf.readUint32BE(offset);
                offset += 4;
            } else if (subtype == 1) {
                if (buf.length < offset + 8) { return null; }
                imm_obj = [
                    buf.readUint32BE(offset),
                    buf.readUint32BE(offset + 4),
                ];
                offset += 8;
            } else if (subtype == 2) {
                let end = offset;
                while (true) {
                    if (end == buf.length) { return null; }
                    if (buf.readUInt8(end) == 0) { break; }
                    end++;
                }
                imm_obj = buf.toString("latin1", offset, end);
                offset = end + 1;
            }
        } else {
            throw new Error("unknown imm type");
        }
        return {
            imm,
            imm_obj,
            offset
        }
    }

    let switchcompleted = false;
    let tribytecompleted = false;

    function* tryMakeOp(context: SolveContext, script: clientscriptdata, offset: number, parent: ScriptState | null, opsleft: number) {
        if (opsleft == -1) { return; }
        if (script.opcodedata.length < offset + 2) { return; }
        let opid = script.opcodedata.readUint16BE(offset);
        //TODO does this assumption hold that opcode 0 can't exist in scrambled caches? 
        //TODO it doesn't hold, but still results in good parsing??
        if (opid == 0) { return; }
        offset += 2;
        let previoustheory = parent;
        while (previoustheory) {
            if (previoustheory.opid == opid) { break; }
            previoustheory = previoustheory.parent;
        }
        let op = context.getOp(opid);
        let options = (previoustheory ? [previoustheory.type][Symbol.iterator]() : op.possibleTypes.values());
        for (let type of options) {
            if (type == "switch" && switchcompleted && op.type == "unknown") { continue; }
            if (type == "tribyte" && tribytecompleted && op.type == "unknown") { continue; }
            let imm = parseImm(script.opcodedata, offset, type);
            if (!imm) { continue; }
            yield new ScriptState(context, script, opid, imm.offset, type, parent, opsleft);
        }
    }

    class ScriptState {
        context: SolveContext;
        script: clientscriptdata;
        endoffset: number;
        opsleft: number;
        opid: number;
        type: ImmediateType;
        children: ScriptState[] = [];
        parent: ScriptState | null;
        constructor(context: SolveContext, script: clientscriptdata, opid: number, endoffset: number, type: ImmediateType, parent: ScriptState | null, opsleft: number) {
            this.context = context;
            this.script = script;
            this.opid = opid;
            this.endoffset = endoffset;
            this.type = type;
            this.parent = parent;
            this.opsleft = opsleft;
        }
    }

    let index = await source.getCacheIndex(cacheMajors.clientscript);
    let candidates: ScriptCandidate[] = [];
    await trickleTasksTwoStep(10, function* () {
        for (let entry of index) {
            if (!entry) { continue; }
            yield source.getFile(entry.major, entry.minor, entry.crc).then<ScriptCandidate>(buf => ({
                id: entry.minor,
                solutioncount: 0,
                buf,
                script: parse.clientscriptdata.read(buf, source),
                unknowns: new Map()
            }));
        }
    }, q => candidates.push(q));

    candidates.sort((a, b) => a.script.instructioncount - b.script.instructioncount || a.script.opcodedata.length - b.script.opcodedata.length);
    let mappings = new Map<number, Opcode>();

    let runtheories = (cand: ScriptCandidate, chained: (ScriptState | null)[]) => {
        let context = new SolveContext(mappings);
        let statesa: ScriptState[] = [];
        let statesb: ScriptState[] = [];
        let solutions: ScriptState[] = [];
        let totalstates = 0;

        //breath first search by alternating two lists
        for (let prev of chained) {
            statesa.push(...tryMakeOp(context, cand.script, 0, prev, cand.script.instructioncount - 1));
        }
        let bailed = false;
        while (statesa.length != 0) {
            if (statesa.length > 1000) {
                bailed = true;
                break;
            }
            totalstates += statesa.length;
            let sub: ScriptState | undefined = undefined;
            while (sub = statesa.pop()) {
                if (sub.opsleft == 0 && sub.endoffset == sub.script.opcodedata.byteLength) {
                    solutions.push(sub);
                } else {
                    statesb.push(...tryMakeOp(context, cand.script, sub.endoffset, sub, sub.opsleft - 1));
                }
            }
            totalstates += statesb.length;
            while (sub = statesb.pop()) {
                if (sub.opsleft == 0 && sub.endoffset == sub.script.opcodedata.byteLength) {
                    solutions.push(sub);
                } else {
                    statesa.push(...tryMakeOp(context, cand.script, sub.endoffset, sub, sub.opsleft - 1));
                }
            }
        }

        return (bailed ? null : solutions);
    }

    let evaluateSolution = (updateCandidate: ScriptCandidate | null, solutions: ScriptState[], maxsols = 10) => {
        let infocount = 0;
        if (solutions.length <= maxsols) {
            let row = solutions;
            updateCandidate?.unknowns.clear();
            while (row.length != 0) {
                let nextrow: ScriptState[] = [];
                let opid = row[0].opid;
                let types = new Set<ImmediateType>();
                let matched = true;
                for (let sol of row) {
                    if (sol.opid == opid) { types.add(sol.type); }
                    else { matched = false; }
                    if (sol.parent) { nextrow.push(sol.parent); }
                    row = nextrow;
                }
                if (matched) {
                    let op = mappings.get(opid);
                    if (!op) {
                        op = new Opcode(opid);
                        mappings.set(opid, op);
                    }
                    for (let t of op.possibleTypes) {
                        if (!types.has(t)) {
                            op.possibleTypes.delete(t);
                            infocount++;
                        }
                    }
                    if (op.possibleTypes.size == 1 && op.type == "unknown") {
                        op.type = op.possibleTypes.values().next().value;
                    }
                    if (op.type == "unknown" && updateCandidate) {
                        updateCandidate.unknowns.set(op.id, op);
                    }
                }
            }
        }
        if (updateCandidate) {
            updateCandidate.solutioncount = solutions.length;
        }
        return infocount;
    }

    let runfixedaddition = () => {
        for (let limit of [10, 10, 10, 20, 30, 40, 50, 100, 1e10, 1e10, 1e10, 1e10]) {
            for (let cand of candidates) {
                if (cand.solutioncount == 1) { continue; }
                if (cand.script.instructioncount > limit) { break; }

                let nswitch = 0;
                let ntribyte = 0;
                for (let op of mappings.values()) {
                    if (op.type == "switch") { nswitch++; }
                    if (op.type == "tribyte") { ntribyte++; }
                }
                if (!switchcompleted && nswitch == 1) { switchcompleted = true; console.log("switch completed"); }
                if (nswitch > 1) { throw new Error(""); }
                if (!tribytecompleted && ntribyte == 2) { tribytecompleted = true; console.log("tribyte completed"); }
                else if (ntribyte > 2) { throw new Error(""); }

                let solutions = runtheories(cand, [null]);
                if (solutions) {
                    evaluateSolution(cand, solutions);
                }
            }

            let combinable = candidates
                .filter(q => q.unknowns.size >= 1)
                .sort((a, b) => a.unknowns.size - b.unknowns.size || firstKey(a.unknowns) - firstKey(b.unknowns));

            let run = () => {
                if (index == lastindex + 1) { return; }
                let solutions: ScriptState[] | null = null;
                for (let i = lastindex; i < index; i++) {
                    let cand = combinable[i];
                    let res = runtheories(cand, solutions ?? [null]);
                    if (!res) { return; }
                    solutions = res;
                }
                if (solutions) {
                    evaluateSolution(null, solutions);
                }
            }

            let lastkey = -1;
            let lastindex = -1;
            let index = 0;
            for (; index < combinable.length; index++) {
                let cand = combinable[index];
                let key = firstKey(cand.unknowns);
                if (key != lastkey) {
                    run();
                    lastkey = key;
                    lastindex = index;
                }
            }
            run();

            console.log(limit, [...mappings.values()].length);
        }
    }

    runfixedaddition();

    let readOpcode = (state: DecodeState) => {
        let opcode = state.buffer.readUint16BE(state.scan);
        state.scan += 2;
        let res = mappings.get(opcode);
        if (!res || res.type == "unknown") {
            globalThis.unknownops ??= [];
            globalThis.unknownops.push(opcode);
            // throw new Error("op type not resolved: 0x" + opcode.toString(16));
            //TODO add warning about guessing here
            res = { id: opcode, type: "byte", possibleTypes: new Set(["byte"]) };
        }

        let imm = parseImm(state.buffer, state.scan, res.type as any);
        if (!imm) { throw new Error("failed to read immidiate"); }
        state.scan = imm.offset;

        return {
            op: res.id,
            imm: imm.imm,
            imm_obj: imm.imm_obj
        }
    }

    globalThis.testOpcodeGetter = readOpcode;

    console.log([...mappings].sort((a, b) => a[0] - b[0]).map(q => [q[0].toString(16), [...q[1].possibleTypes].join(",")]));

    //TODO remove
    globalThis.candidates = candidates;

    return {
        mappings,
        readOpcode,
        test(id: number) {
            let cand = candidates.find(q => q.id == id)!
            runtheories(cand, [null]);
        },
        getop(opid: number) {
            let cands = candidates.filter(q => q.unknowns.has(opid));
            return cands;
        },
        candidates,
        runtheories,
        evaluateSolution,
        testCascade(ipop: number) {
            let target = [ipop];
            outerloop: while (true) {
                let cands = candidates.filter(q => target.some(w => q.unknowns.has(w)));
                console.log(cands);
                let sols: ScriptState[] | null = null;
                for (let cand of cands) {
                    sols = runtheories(cand, sols ?? [null]);
                    if (!sols) {
                        return "too many states";
                    }
                }
                console.log(sols);
                let changecount = evaluateSolution(null, sols!, 500);
                if (changecount != 0) {
                    return changecount;
                }
                for (let cand of cands) {
                    for (let unk of cand.unknowns.keys()) {
                        if (!target.includes(unk)) {
                            target.push(unk);
                            continue outerloop;
                        }
                    }
                }
                return "could not expand problem further";
            }
        }
    }
}

function firstKey<T>(map: Map<T, any>) {
    return map.keys().next().value as T;
}

globalThis.findOpcodeImmidiates = findOpcodeImmidiates3;