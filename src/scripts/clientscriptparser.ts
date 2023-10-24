import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { trickleTasksTwoStep } from "../utils";
import { DecodeState } from "../opcode_reader";
import { clientscriptdata } from "../../generated/clientscriptdata";
import { Openrs2CacheSource } from "../cache/openrs2loader";

const detectableImmediates = ["byte", "int", "tribyte", "switch"] satisfies ImmediateType[];
const lastNonObfuscatedBuild = 668;

const namedOps = {
    pushint: 0x00,
    pushlong: 0x36,
    pushstring: 0x03,
    joinstring: 0x25,
    gosub: 40,
    return: 21,
    //unknown original ids
    //TODO assigned ids work different now, this is wrong
    pushconst: 0x4101,
    tribyte1: 0x4102,
    tribyte2: 0x4103
}

type ClientScriptOp = {
    opcode: number,
    imm: number,
    imm_obj: string | number | [number, number] | null
}

class OpcodeInfo {
    scrambledid: number;
    id: number;
    possibleTypes: Set<ImmediateType>;
    type: ImmediateType | "unknown";
    optype: OpTypes | "unknown" = "unknown";
    //TODO should probly construct this from the ClientscriptObfuscation and automatically set the mappings
    constructor(scrambledid: number, id: number, possibles: ImmediateType[]) {
        this.scrambledid = scrambledid;
        this.id = id;
        this.possibleTypes = new Set(possibles);
        if (possibles.length == 1) {
            this.type = possibles[0]
        } else {
            this.type = "unknown";
        }
    }
}

type StackDiff = {
    int: number,
    string: number,
    long: number
}

type ScriptCandidate = {
    id: number,
    solutioncount: number,
    buf: Buffer,
    script: clientscriptdata,
    scriptcontents: ClientScriptOp[] | null,
    returnType: StackDiff | null,
    argtype: StackDiff | null,
    unknowns: Map<number, OpcodeInfo>
};

type ReferenceScript = {
    id: number,
    scriptdata: clientscriptdata,
    scriptops: ClientScriptOp[]
}

type ReferenceCallibration = {
    buildnr: number,
    scripts: ReferenceScript[]
    mappings: Map<number, OpcodeInfo>
};

type ImmediateType = "byte" | "int" | "tribyte" | "switch" | "long" | "string";
type OpTypes = "standard" | "return" | "gosub" | "seton" | "pushconst" | "branch";

export type ReadOpCallback = (state: DecodeState) => ClientScriptOp;

function opcodeToType(op: number) {
    let type: ImmediateType = "byte";
    if (op < 0x80 && op != 0x15 && op != 0x26 && op != 0x27 && op != 0x66) { type = "int"; }
    if (op == namedOps.pushconst) { type = "switch"; }
    if (op == namedOps.tribyte1 || op == namedOps.tribyte2) { type = "tribyte"; }
    return type;
}

function translateClientScript(opcodes: ClientScriptOp[], frombuild: number, tobuild: number) {
    if (frombuild < 751 && tobuild >= 751) {
        return opcodes.map<ClientScriptOp>(q => {
            //for sure build 751
            if (q.opcode == namedOps.pushconst) { return { opcode: namedOps.pushconst, imm: 0, imm_obj: q.imm }; }
            if (q.opcode == namedOps.pushlong) { return { opcode: namedOps.pushconst, imm: 1, imm_obj: q.imm_obj }; }
            if (q.opcode == namedOps.pushstring) { return { opcode: namedOps.pushconst, imm: 2, imm_obj: q.imm_obj }; }

            //idk build, between base and 751
            if (q.opcode == 0x2a) { return { opcode: 0x2a, imm: (2 << 24) | (q.imm << 8), imm_obj: q.imm_obj }; }
            if (q.opcode == 0x2b) { return { opcode: 0x2b, imm: (2 << 24) | (q.imm << 8), imm_obj: q.imm_obj }; }

            return q;
        });
    } else {
        return opcodes.slice();
    }
}

function cannonicalOp(operation: ClientScriptOp) {
    let op = operation.opcode;
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
    return { opcode: op, imm, imm_obj } as ClientScriptOp
}

function isOpEqual(a: ClientScriptOp, b: ClientScriptOp) {
    a = cannonicalOp(a);
    b = cannonicalOp(b);

    if (a.opcode != b.opcode) { return false; }
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
    } else if (type == "string") {
        let end = offset;
        while (true) {
            if (end == buf.length) { return null; }
            if (buf.readUInt8(end) == 0) { break; }
            end++;
        }
        imm_obj = buf.toString("latin1", offset, end);
        offset = end + 1;
    } else if (type == "long") {
        if (buf.length < offset + 8) { return null; }
        imm_obj = [
            buf.readUint32BE(offset),
            buf.readUint32BE(offset + 4),
        ];
        offset += 8;
    } else {
        throw new Error("unknown imm type");
    }
    return {
        imm,
        imm_obj,
        offset
    }
}

let referenceOpcodeDump: Promise<ReferenceCallibration> | null = null;
async function getReferenceOpcodeDump() {
    referenceOpcodeDump ??= (async () => {
        let rootsource = await Openrs2CacheSource.fromId(1383);
        let refsource = await Openrs2CacheSource.fromId(1572);
        let rootcalli = new ClientscriptObfuscation();
        let refcalli = new ClientscriptObfuscation();
        rootcalli.setNonObbedMappings();
        await refcalli.runCallibrationFrom(refsource, rootsource, rootcalli);

        //2 opcodes have the tribyte type
        let tribyte1 = new OpcodeInfo(0x0314, refcalli.opidcounter++, ["tribyte"]);
        let tribyte2 = new OpcodeInfo(0x025d, refcalli.opidcounter++, ["tribyte"]);
        refcalli.mappings.set(tribyte1.scrambledid, tribyte1);
        refcalli.mappings.set(tribyte2.scrambledid, tribyte2);
        refcalli.decodedMappings.set(tribyte1.id, tribyte1);
        refcalli.decodedMappings.set(tribyte2.id, tribyte2);

        //opcodes with unknown original opcode, but still in the id<0x80 range so they have 4 byte imm
        let specialReferenceOps = [0x0023, 0x003b, 0x003f, 0x00a4, 0x00a8, 0x00f6, 0x0175, 0x01a0, 0x022f, 0x0273, 0x02c2, 0x033a, 0x0374, 0x03a1, 0x0456, 0x04ea, 0x04f4, 0x0501, 0x0559, 0x059d, 0x0676, 0x072d, 0x077d, 0x0798, 0x07a0, 0x07d8, 0x080f, 0x0838];
        for (let op of specialReferenceOps) {
            if (refcalli.mappings.get(op) == undefined) {
                let newop = new OpcodeInfo(op, refcalli.opidcounter++, ["int"]);
                refcalli.mappings.set(op, newop);
                refcalli.decodedMappings.set(newop.id, newop);
            }
        }
        return refcalli.generateDump(refsource);
    })();
    return referenceOpcodeDump;
}

export class ClientscriptObfuscation {
    mappings = new Map<number, OpcodeInfo>();
    decodedMappings = new Map<number, OpcodeInfo>();
    candidates: Promise<ScriptCandidate[]> | null = null;
    callibrated = false;
    opidcounter = 10000;
    missedParseOps: number[] = [];

    loadCandidates(source: CacheFileSource) {
        this.candidates ??= (async () => {
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
                        scriptcontents: null,
                        argtype: null,
                        returnType: null,
                        unknowns: new Map()
                    }));
                }
            }, q => candidates.push(q));
            return candidates;
        })();
        return this.candidates;
    }

    async generateDump(source: CacheFileSource) {
        let cands = await this.loadCandidates(source);
        let scripts: ReferenceScript[] = [];
        for (let cand of cands) {
            try {
                cand.scriptcontents ??= parse.clientscript.read(cand.buf, source, { translateCS2Opcode: this.readOpcode }).opcodedata;
                scripts.push({ id: cand.id, scriptdata: cand.script, scriptops: cand.scriptcontents });
            } catch (e) { }
        }
        console.log(`dumped ${scripts.length}/${cands.length} scripts`);
        return {
            buildnr: source.getBuildNr(),
            scripts,
            mappings: this.mappings
        } satisfies ReferenceCallibration;
    }
    async runAutoCallibrate(source: CacheFileSource) {
        if (source.getBuildNr() <= lastNonObfuscatedBuild) {
            this.setNonObbedMappings();
        } else {
            let ref = await getReferenceOpcodeDump();
            await this.runCallibration(source, ref, ref.buildnr);
        }
    }
    async runCallibrationFrom(currentsource: CacheFileSource, referenceSource: CacheFileSource, previousCallibration: ClientscriptObfuscation) {
        let refscript = await previousCallibration.generateDump(referenceSource);
        await this.runCallibration(currentsource, refscript, referenceSource.getBuildNr());
    }
    setNonObbedMappings() {
        //originally all <0x80 were ints
        for (let i = 0; i < 0x80; i++) {
            this.mappings.set(i, new OpcodeInfo(i, i, ["int"]));
        }
        //except several special cases
        this.mappings.set(0x03, new OpcodeInfo(0x03, 0x03, ["string"]));
        this.mappings.set(0x36, new OpcodeInfo(0x36, 0x36, ["long"]));
        this.mappings.set(0x15, new OpcodeInfo(0x15, 0x15, ["byte"]));
        this.mappings.set(0x26, new OpcodeInfo(0x26, 0x26, ["byte"]));
        this.mappings.set(0x27, new OpcodeInfo(0x27, 0x27, ["byte"]));
        this.mappings.set(0x66, new OpcodeInfo(0x66, 0x66, ["byte"]));
        this.mappings.forEach(value => this.decodedMappings.set(value.id, value));
        this.callibrated = true;
    }
    async runCallibration(source: CacheFileSource, refcalli: ReferenceCallibration, refbuildnr: number) {
        let convertedref = refcalli.scripts.map<ClientScriptOp[]>(q => translateClientScript(q.scriptops, refbuildnr, source.getBuildNr()));

        let candidates = await this.loadCandidates(source);

        let testCandidate = (cand: ScriptCandidate, refops: ClientScriptOp[]) => {
            if (cand.script.instructioncount != refops.length) {
                return false;
            }
            let unconfirmed = new Map<number, ClientScriptOp>();
            let offset = 0;
            let buf = cand.script.opcodedata;
            for (let i = 0; i < cand.script.instructioncount; i++) {
                let refop = refops[i];
                let reftype = opcodeToType(refop.opcode);

                if (buf.byteLength < offset + 2) { return false; }
                let opid = buf.readUint16BE(offset);
                offset += 2;
                let imm = parseImm(buf, offset, reftype);
                if (!imm) { return false; }
                offset = imm.offset;
                let op: ClientScriptOp = { opcode: refop.opcode, imm: imm.imm, imm_obj: imm.imm_obj };
                if (!isOpEqual(op, refop)) { return false; }
                unconfirmed.set(opid, refop);
            }
            if (offset != buf.byteLength) {
                return false;
            }
            for (let [k, v] of unconfirmed) {
                let info = new OpcodeInfo(k, v.opcode, [opcodeToType(v.opcode)]);
                this.mappings.set(k, info);
                this.decodedMappings.set(v.opcode, info);
            }
            return true;
        }

        let iter = async () => {
            let ia = 0;
            let ib = 0;
            while (ia < candidates.length && ib < refcalli.scripts.length) {
                let a = candidates[ia];
                let b = refcalli.scripts[ib];
                if (a.id == b.id) {
                    testCandidate(a, convertedref[ib]);
                    ia++;
                    ib++;
                } else if (a.id < b.id) {
                    ia++;
                } else {
                    ib++;
                }
            }
        }
        let oldcount = 0;
        let itercount = 0;
        for (; itercount < 10; itercount++) {
            await iter();
            let foundcount = this.mappings.size - oldcount;
            console.log(`iter ${itercount}, found:${foundcount}`);
            if (foundcount == 0) { break; }
            oldcount = this.mappings.size;
        }
        console.log(`callibrated in ${itercount + 1} iterations`);

        await this.findOpcodeImmidiates3(source);
        this.callibrated = true;
    }
    readOpcode: ReadOpCallback = (state: DecodeState) => {
        if (!this.callibrated) { throw new Error("clientscript deob not callibrated yet"); }
        let opcode = state.buffer.readUint16BE(state.scan);
        state.scan += 2;
        let res = this.mappings.get(opcode);
        if (!res || res.type == "unknown") {
            // throw new Error("op type not resolved: 0x" + opcode.toString(16));
            //TODO add warning about guessing here

            res = new OpcodeInfo(opcode, this.opidcounter++, ["byte"]);
            this.mappings.set(opcode, res);
            this.decodedMappings.set(res.id, res);
        }

        let imm = parseImm(state.buffer, state.scan, res.type as ImmediateType);
        if (!imm) { throw new Error("failed to read immidiate"); }
        state.scan = imm.offset;

        return { opcode: res.id, imm: imm.imm, imm_obj: imm.imm_obj } satisfies ClientScriptOp;
    }
    async findOpcodeImmidiates3(source: CacheFileSource) {
        await findOpcodeImmidiates3(this, source);
    }
    async findOpcodeTypes(source: CacheFileSource) {
        await findOpcodeTypes(this, source);
    }
}

async function findOpcodeImmidiates3(calli: ClientscriptObfuscation, source: CacheFileSource) {

    let switchcompleted = false;
    let tribytecompleted = false;

    function* tryMakeOp(script: clientscriptdata, offset: number, parent: ScriptState | null, opsleft: number) {
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
        let op = calli.mappings.get(opid);
        let options = (previoustheory ? [previoustheory.type] : op ? [...op.possibleTypes] : detectableImmediates);
        for (let type of options) {
            if (type == "switch" && switchcompleted && (!op || op.type == "unknown")) { continue; }
            if (type == "tribyte" && tribytecompleted && (!op || op.type == "unknown")) { continue; }
            let imm = parseImm(script.opcodedata, offset, type);
            if (!imm) { continue; }
            yield new ScriptState(script, opid, imm.offset, type, parent, opsleft);
        }
    }

    class ScriptState {
        script: clientscriptdata;
        endoffset: number;
        opsleft: number;
        opid: number;
        type: ImmediateType;
        children: ScriptState[] = [];
        parent: ScriptState | null;
        constructor(script: clientscriptdata, opid: number, endoffset: number, type: ImmediateType, parent: ScriptState | null, opsleft: number) {
            this.script = script;
            this.opid = opid;
            this.endoffset = endoffset;
            this.type = type;
            this.parent = parent;
            this.opsleft = opsleft;
        }
    }

    //copy array since the rest of the code wants it in id order
    let candidates = (await calli.loadCandidates(source)).slice();
    candidates.sort((a, b) => a.script.instructioncount - b.script.instructioncount || a.script.opcodedata.length - b.script.opcodedata.length);

    let runtheories = (cand: ScriptCandidate, chained: (ScriptState | null)[]) => {
        let statesa: ScriptState[] = [];
        let statesb: ScriptState[] = [];
        let solutions: ScriptState[] = [];
        let totalstates = 0;

        //breath first search by alternating two lists
        for (let prev of chained) {
            statesa.push(...tryMakeOp(cand.script, 0, prev, cand.script.instructioncount - 1));
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
                    statesb.push(...tryMakeOp(cand.script, sub.endoffset, sub, sub.opsleft - 1));
                }
            }
            totalstates += statesb.length;
            while (sub = statesb.pop()) {
                if (sub.opsleft == 0 && sub.endoffset == sub.script.opcodedata.byteLength) {
                    solutions.push(sub);
                } else {
                    statesa.push(...tryMakeOp(cand.script, sub.endoffset, sub, sub.opsleft - 1));
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
                    let op = calli.mappings.get(opid);
                    if (!op) {
                        op = new OpcodeInfo(opid, calli.opidcounter++, detectableImmediates);
                        calli.mappings.set(opid, op);
                        calli.decodedMappings.set(op.id, op);
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
                for (let op of calli.mappings.values()) {
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

            console.log(limit, calli.mappings.size);
        }
    }

    runfixedaddition();
    // console.log([...mappings].sort((a, b) => a[0] - b[0]).map(q => [q[0].toString(16), [...q[1].possibleTypes].join(",")]));

    //TODO return values are obsolete
    return {
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

async function findOpcodeTypes(calli: ClientscriptObfuscation, source: CacheFileSource) {
    let returnop = -1;
    let gosubop = -1;
    for (let [id, op] of calli.mappings) {
        if (op.id == namedOps.gosub) {
            op.optype = "gosub";
            gosubop = id;
        } else if (op.id == namedOps.return) {
            op.optype = "return";
            returnop = id;
        } else if (op.type == "switch") {
            op.optype = "pushconst";
        }
    }
    let cands = await calli.loadCandidates(source);
    for (let cand of cands) {
        try {
            cand.scriptcontents ??= parse.clientscript.read(cand.buf, source, { translateCS2Opcode: calli.readOpcode }).opcodedata;
        } catch (e) { }

        if (!cand.scriptcontents) { continue; }
        cand.argtype = { int: cand.script.intargcount, long: cand.script.unk0, string: cand.script.stringargcount };
        cand.returnType = { int: 0, long: 0, string: 0 };
        //the jagex compiler appends a default return with null constants to the script, even if this would be dead code
        for (let i = cand.scriptcontents.length - 2; i >= 0; i--) {
            let op = cand.scriptcontents[i];
            let opinfo = calli.decodedMappings.get(op.opcode);
            if (!opinfo) { throw new Error("unnexpected"); }
            if (opinfo.id == namedOps.pushconst) {
                if (op.imm == 0) { cand.returnType.int++; }
                if (op.imm == 1) { cand.returnType.long++; }
                if (op.imm == 2) { cand.returnType.string++; }
            } else if (opinfo.id == namedOps.pushint) {
                cand.returnType.int++;
            } else if (opinfo.id == namedOps.pushlong) {
                cand.returnType.long++;
            } else if (opinfo.id == namedOps.pushstring) {
                cand.returnType.string++;
            } else {
                break;
            }
        }
    }

    abstract class AstNode {

    }
    class MergeIntoNode extends AstNode {
        target: CodeBlockNode;
        constructor(target: CodeBlockNode) {
            super();
            this.target = target;
        }
    }

    class CodeBlockNode extends AstNode {
        startindex: number;
        nodes: AstNode[] = [];
        possibleSuccessors: CodeBlockNode[] = [];
        constructor(startindex: number) {
            super();
            this.startindex = startindex;
        }
    }

    class RawOpcodeNode extends AstNode {
        op: ClientScriptOp;
        opinfo: OpcodeInfo;
        constructor(op: ClientScriptOp) {
            super();
            this.op = op;
            let info = calli.decodedMappings.get(op.opcode)!;
            if (!info) { throw new Error("tried to add unknown op to AST") }
            this.opinfo = info;
        }
    }

    let allsections: CodeBlockNode[] = [];
    for (let cand of cands) {
        if (!cand.scriptcontents) { continue; }

        let rootnode = new CodeBlockNode(0);
        let sections: CodeBlockNode[] = [rootnode];
        let currentsection = rootnode;

        let getorMakeSection = (index: number) => {
            if (index >= cand.scriptcontents!.length) { throw new Error("tried to jump outside script"); }
            let section = sections.find(q => q.startindex == index);
            if (!section) {
                section = new CodeBlockNode(index);
                sections.push(section);
            }
            return section
        }

        for (let [index, op] of cand.scriptcontents.entries()) {
            let opnode = new RawOpcodeNode(op);

            //check if other flows merge into this one
            let addrsection = sections.find(q => q.startindex == index);
            if (addrsection && addrsection != currentsection) {
                currentsection.nodes.push(new MergeIntoNode(addrsection));
                currentsection.possibleSuccessors.push(addrsection);
                currentsection = addrsection;
            }

            currentsection.nodes.push(opnode);

            if (opnode.opinfo.optype == "branch") {
                let jumpindex = index + op.imm;
                let nextblock = getorMakeSection(index + 1);
                let jumpblock = getorMakeSection(jumpindex);
                currentsection = nextblock;
                currentsection.possibleSuccessors.push(nextblock, jumpblock);
            }

            if (opnode.opinfo.optype == "return") {
                if (index != cand.scriptcontents.length - 1) {
                    //dead code will be handled elsewhere
                    currentsection = getorMakeSection(index + 1);
                }
            }
        }

        allsections.push(...sections);
    }

    allsections.sort((a, b) => a.nodes.length - b.nodes.length);

    //variable number of pops/pushes
    //joinstring (int imm)
    //return (detect from tail const return)
    //gosub (detect from other scripts)
    //seton (detect from last pushed string or from other scripts)
    // - has a bunch of variations, finding the opcodes might be challenging
    //branches
    // - branch
    // - if
    // - switch
    // - else?
    return allsections;
}

function firstKey<T>(map: Map<T, any>) {
    return map.keys().next().value as T;
}
