import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { trickleTasksTwoStep } from "../utils";
import { DecodeState } from "../opcode_reader";
import { clientscriptdata } from "../../generated/clientscriptdata";
import { clientscript } from "../../generated/clientscript";
import { Openrs2CacheSource } from "../cache/openrs2loader";
import { osrsOpnames } from "./osrsopnames";

const detectableImmediates = ["byte", "int", "tribyte", "switch"] satisfies ImmediateType[];
const lastNonObfuscatedBuild = 668;
const firstModernOpsBuild = 751;

const namedOps = {
    //old caches only
    pushint: 0,
    pushlong: 54,
    pushstring: 3,

    //variable number of args
    joinstring: 37,
    gosub: 40,

    //control flow
    jump: 6,
    branch_not: 7,
    branch_eq: 8,
    branch_lt: 9,
    branch_gt: 10,
    branch_lteq: 31,
    branch_gteq: 32,
    switch: 51,
    return: 21,

    //unknown original ids
    pushconst: 9001,
    tribyte1: 9002,
    tribyte2: 9003
}

const knownOpNames: Record<number, string> = {
    ...osrsOpnames,
    ...Object.fromEntries(Object.entries(namedOps).map(q => [q[1], q[0]]))
}

const branchInstructions = [
    namedOps.jump,
    namedOps.branch_not,
    namedOps.branch_eq,
    namedOps.branch_lt,
    namedOps.branch_gt,
    namedOps.branch_lteq,
    namedOps.branch_gteq
];

type ClientScriptOp = {
    opcode: number,
    imm: number,
    imm_obj: string | number | [number, number] | null,
    opname?: string
}

class OpcodeInfo {
    scrambledid: number;
    id: number;
    possibleTypes: Set<ImmediateType>;
    type: ImmediateType | "unknown";
    optype: OpTypes | "unknown" = "unknown";
    stackchange: StackDiff | null = null;
    stackchangeproofs = new Set<CodeBlockNode>();//TODO remove
    //TODO should probly construct this from the ClientscriptObfuscation and automatically set the mappings
    constructor(scrambledid: number, id: number, possibles: ImmediateType[]) {
        this.scrambledid = scrambledid;
        this.id = id;
        this.possibleTypes = new Set(possibles);
        if (possibles.length == 1) {
            this.type = possibles[0];
        } else {
            this.type = "unknown";
        }
    }
}

class StackDiff {
    int = 0;
    long = 0;
    string = 0;
    sub(other: StackDiff) {
        this.int -= other.int;
        this.long -= other.long;
        this.string -= other.string;
        return this;
    }
    add(other: StackDiff) {
        this.int += other.int;
        this.long += other.long;
        this.string += other.string;
        return this;
    }
    intdiv(n: number) {
        if (this.int % n != 0 || this.long % n != 0 || this.string % n != 0) {
            throw new Error("attempted stackdiv division leading to remainder");
        }
        this.int /= n;
        this.long /= n;
        this.string /= n;
        return this;
    }
    equals(other: StackDiff) {
        return this.int == other.int && this.long == other.long && this.string == other.string;
    }
    isEmpty() {
        return this.int == 0 && this.long == 0 && this.string == 0;
    }
    toString() {
        return `int:${this.int}, long:${this.long}, str:${this.string}`;
    }
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
    scripts: ReferenceScript[],
    mappings: Map<number, OpcodeInfo>,
    opidcounter: number
};

type ImmediateType = "byte" | "int" | "tribyte" | "switch" | "long" | "string";
type OpTypes = "standard" | "return" | "gosub" | "seton" | "branch";

export type ReadOpCallback = (state: DecodeState) => ClientScriptOp;

function opcodeToType(op: number) {
    let type: ImmediateType = "byte";
    if (op < 0x80 && op != 0x15 && op != 0x26 && op != 0x27 && op != 0x66) { type = "int"; }
    if (op == namedOps.pushconst) { type = "switch"; }
    if (op == namedOps.tribyte1 || op == namedOps.tribyte2) { type = "tribyte"; }
    return type;
}

function translateClientScript(opcodes: ClientScriptOp[], frombuild: number, tobuild: number) {
    if (frombuild < firstModernOpsBuild && tobuild >= firstModernOpsBuild) {
        return opcodes.map<ClientScriptOp>(q => {
            //for sure build 751
            if (q.opcode == namedOps.pushint) { return { opcode: namedOps.pushconst, imm: 0, imm_obj: q.imm }; }
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
        imm = buf.readInt32BE(offset);
        offset += 4;
    } else if (type == "tribyte") {
        if (buf.length < offset + 3) { return null; }
        imm = buf.readUintBE(offset, 3);
        offset += 3;
    } else if (type == "switch") {
        if (buf.length < offset + 1) { return null; }
        let subtype = buf.readUint8(offset++);
        imm = subtype;
        if (subtype == 0) {
            if (buf.length < offset + 4) { return null; }
            imm_obj = buf.readInt32BE(offset);
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
        let tribyte1 = new OpcodeInfo(0x0314, namedOps.tribyte1, ["tribyte"]);
        let tribyte2 = new OpcodeInfo(0x025d, namedOps.tribyte2, ["tribyte"]);
        refcalli.mappings.set(tribyte1.scrambledid, tribyte1);
        refcalli.mappings.set(tribyte2.scrambledid, tribyte2);
        refcalli.decodedMappings.set(tribyte1.id, tribyte1);
        refcalli.decodedMappings.set(tribyte2.id, tribyte2);

        //opcodes with unknown original opcode, but still in the id<0x80 range so they have 4 byte imm
        let specialReferenceOps = [0x0023, 0x003b, 0x003f, 0x00a4, 0x00a8, 0x00f6, 0x0175, 0x01a0, 0x022f, 0x0273, 0x02c2, 0x033a, 0x0374, 0x03a1, 0x0456, 0x04ea, 0x04f4, 0x0501, 0x0559, 0x059d, 0x0676, 0x072d, 0x077d, 0x0798, 0x07a0, 0x07d8, 0x080f, 0x0838];
        for (let op of specialReferenceOps) {
            if (refcalli.mappings.get(op) == undefined) {
                refcalli.declareOp(op, ["int"]);
                // let newop = new OpcodeInfo(op, refcalli.opidcounter++, ["int"]);
                // refcalli.mappings.set(op, newop);
                // refcalli.decodedMappings.set(newop.id, newop);
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

    declareOp(rawopid: number, types: ImmediateType[]) {
        let op = new OpcodeInfo(rawopid, this.opidcounter++, types);
        if (this.mappings.has(rawopid)) { throw new Error("op already exists"); }
        if (this.decodedMappings.has(op.id)) { throw new Error("allocated op id alerady exists"); }
        this.mappings.set(rawopid, op);
        this.decodedMappings.set(op.id, op);
        return op;
    }

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
        parseCandidateContents(source, this, cands);
        for (let cand of cands) {
            if (cand.scriptcontents) {
                scripts.push({ id: cand.id, scriptdata: cand.script, scriptops: cand.scriptcontents });
            }
        }
        console.log(`dumped ${scripts.length}/${cands.length} scripts`);
        return {
            buildnr: source.getBuildNr(),
            scripts,
            mappings: this.mappings,
            opidcounter: this.opidcounter
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

        this.opidcounter = refcalli.opidcounter;
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
        parseCandidateContents(source, this, candidates);

        for (let op of this.mappings.values()) {
            if (op.id == namedOps.gosub) {
                op.optype = "gosub";
            } else if (op.id == namedOps.return) {
                op.optype = "return";
            } else if (branchInstructions.includes(op.id)) {
                op.optype = "branch";
            }
        }

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
            if (!res) {
                res = this.declareOp(opcode, ["byte"]);
            } else {
                res.type = res.possibleTypes.values().next().value;
                res.possibleTypes = new Set<ImmediateType>(res.type as any);
            }
            // res = new OpcodeInfo(opcode, this.opidcounter++, ["byte"]);
            // this.mappings.set(opcode, res);
            // this.decodedMappings.set(res.id, res);
        }

        let imm = parseImm(state.buffer, state.scan, res.type as ImmediateType);
        if (!imm) { throw new Error("failed to read immidiate"); }
        state.scan = imm.offset;

        let opname = knownOpNames[res.id] ?? "unknown";

        return { opcode: res.id, imm: imm.imm, imm_obj: imm.imm_obj, opname } satisfies ClientScriptOp;
    }
    async findOpcodeImmidiates3(source: CacheFileSource) {
        await findOpcodeImmidiates3(this, source);
    }
    async findOpcodeTypes(source: CacheFileSource) {
        return await findOpcodeTypes(this, source);
    }
}

function parseCandidateContents(source: CacheFileSource, calli: ClientscriptObfuscation, cands: ScriptCandidate[]) {
    for (let cand of cands) {
        try {
            cand.scriptcontents ??= parse.clientscript.read(cand.buf, source, { clientScriptDeob: calli }).opcodedata;
        } catch (e) { }

        if (!cand.scriptcontents) { continue; }
        cand.returnType = getReturnType(calli, cand.scriptcontents);
        cand.argtype = getArgType(cand.script);
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
                        op = calli.declareOp(opid, detectableImmediates);
                        // op = new OpcodeInfo(opid, calli.opidcounter++, detectableImmediates);
                        // calli.mappings.set(opid, op);
                        // calli.decodedMappings.set(op.id, op);
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
    let candmap = new Map<number, ScriptCandidate>();
    let cands = await calli.loadCandidates(source);

    parseCandidateContents(source, calli, cands);

    for (let cand of cands) {
        if (!cand.scriptcontents) { continue; }
        candmap.set(cand.id, cand);
    }

    //TODO merge with previous loop?
    let allsections: CodeBlockNode[] = [];
    for (let cand of cands) {
        if (!cand.scriptcontents) { continue }
        let sections = generateAst(cands, calli, cand.script, cand.scriptcontents, cand.id);
        allsections.push(...sections);
    }
    allsections.sort((a, b) => a.nodes.length - b.nodes.length);

    type StackDiffEquation = {
        section: CodeBlockNode,
        ops: Map<number, number>,
        constant: StackDiff,
        dependon: Set<OpcodeInfo>,
        hasVararg: boolean
    }

    let opmap = new Map<number, StackDiffEquation[]>();
    let allequations: StackDiffEquation[] = [];
    sectionloop: for (let section of allsections) {
        // if (allsections.indexOf(section) == 202928) { debugger; }
        let ops = new Map<number, number>();
        let constant = new StackDiff();
        let dependon = new Set<OpcodeInfo>();
        let hasVararg = false;
        for (let node of section.nodes) {
            if (!(node instanceof RawOpcodeNode)) { continue sectionloop; }
            if (node.opinfo.id == namedOps.return) {
                let script = candmap.get(section.scriptid);
                if (!script || !script.returnType) { continue sectionloop; }
                constant.sub(script.returnType);
            } else if (node.opinfo.id == namedOps.gosub) {
                let script = candmap.get(node.op.imm);
                if (!script || !script.returnType || !script.argtype) { continue sectionloop; }
                constant.sub(script.argtype).add(script.returnType);
            } else if (node.opinfo.id == namedOps.joinstring) {
                constant.string += -node.op.imm + 1;
            } else if (node.opinfo.id == namedOps.pushconst) {
                if (node.op.imm == 0) { constant.int++; }
                else if (node.op.imm == 1) { constant.long++; }
                else if (node.op.imm == 2) {
                    constant.string++;
                    if ((node.op.imm_obj as string).match(/^[is]*Y?$/)) {
                        hasVararg = true;
                    }
                }
                else { throw new Error("unexpected"); }
            } else if (node.opinfo.stackchange) {
                constant.add(node.opinfo.stackchange);
                dependon.add(node.opinfo);
            } else {
                let count = ops.get(node.op.opcode) ?? 0;
                ops.set(node.op.opcode, count + 1);
            }

            //42 PUSH_VARC_INT is weird
            const problemops = [
                42,
                43,
                10023,
                10672,
                10110,
                10717,
                10063,
                10885,
                10699,
                10815,
                10735,//either this or 10736
            ];
            // const problemops = [10023, 10672, 10110, 10717,];
            if (problemops.includes(node.op.opcode)) {
                hasVararg = true;
            }
        }
        let eq: StackDiffEquation = { section, ops, constant, hasVararg, dependon };
        for (let op of ops.keys()) {
            let entry = opmap.get(op);
            if (!entry) {
                entry = [];
                opmap.set(op, entry);
            }
            entry.push(eq);
        }
        allequations.push(eq);
    }
    opmap.forEach(q => q.sort((a, b) => a.ops.size - b.ops.size));

    let activeEquations = allequations;
    let didsolve = true;
    while (didsolve) {
        activeEquations.sort((a, b) => a.ops.size - b.ops.size);
        console.log("active equations", activeEquations.length);
        let newequations: StackDiffEquation[] = [];
        didsolve = false;
        for (let eq of activeEquations) {
            if (eq.hasVararg) {
                //ignore sections that have a type string constant in them that might indicate a if_seton* opcode
                continue;
            }
            if (eq.ops.size == 0) {
                if (!eq.constant.isEmpty()) { throw new Error("equation failed"); }
                //ignore 0=0 equation
            } else if (eq.ops.size == 1) {
                let opid = firstKey(eq.ops);
                let op = calli.decodedMappings.get(opid)!;
                let newdiff = new StackDiff().sub(eq.constant).intdiv(eq.ops.get(opid)!);
                if (op.stackchange && !op.stackchange.equals(newdiff)) {
                    let debugref = allsections.filter(q => q.nodes.some(q => (q instanceof RawOpcodeNode) && q.op.opcode == opid));
                    throw new Error("second equation leads to different result");
                }
                op.stackchange = newdiff;
                op.stackchangeproofs.add(eq.section);
                didsolve = true;
            } else {
                //TODO do some rewriting here
                let neweq: StackDiffEquation | null = null;
                for (let [op, amount] of eq.ops) {
                    let info = calli.decodedMappings.get(op);
                    if (info?.stackchange) {
                        neweq ??= {
                            section: eq.section,
                            ops: new Map(eq.ops),
                            constant: new StackDiff().add(eq.constant),
                            hasVararg: eq.hasVararg,
                            dependon: new Set(eq.dependon)
                        };
                        neweq.ops.delete(op);
                        for (let i = 0; i < amount; i++) {
                            neweq.constant.add(info.stackchange);
                        }
                        neweq.dependon.add(info);
                        didsolve = true;
                    }
                }
                newequations.push(neweq ?? eq);
            }
        }
        activeEquations = newequations;
    }

    //solve the set of linear equations
    // for(let eq of allequations){
    //     let unknowns=
    // }

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
    return activeEquations;
}

abstract class AstNode {
    debugString(calli: ClientscriptObfuscation) { return "unknown op"; }
}
class MergeIntoNode extends AstNode {
    target: CodeBlockNode;
    constructor(target: CodeBlockNode) {
        super();
        this.target = target;
    }
    debugString() {
        return " ".repeat(5) + " merge into next";
    }
}

class CodeBlockNode extends AstNode {
    startindex: number;
    scriptid: number;
    nodes: AstNode[] = [];
    possibleSuccessors: CodeBlockNode[] = [];
    constructor(scriptid: number, startindex: number) {
        super();
        this.scriptid = scriptid;
        this.startindex = startindex;
    }
}

class RawOpcodeNode extends AstNode {
    op: ClientScriptOp;
    opinfo: OpcodeInfo;
    opnr: number;
    constructor(op: ClientScriptOp, opinfo: OpcodeInfo, opnr: number) {
        super();
        this.op = op;
        this.opnr = opnr;
        this.opinfo = opinfo;
    }
    debugString(calli: ClientscriptObfuscation) {
        let opinfo = calli.decodedMappings.get(this.op.opcode);
        if (!opinfo) { throw new Error("unknown op"); }
        let name = knownOpNames[this.op.opcode] ?? "unk";
        let res = "";
        let immobj = (typeof this.op.imm_obj == "string" ? `"${this.op.imm_obj}"` : (this.op.imm_obj ?? "").toString());
        res += `${this.op.opcode.toString().padStart(5, " ")} ${(name ?? "unk").slice(0, 15).padEnd(15, " ")} ${this.op.imm.toString().padStart(10, " ")} ${immobj.padStart(10, " ")}`;
        //TODO make subclass for this?
        if (opinfo.optype == "branch" || opinfo.id == namedOps.jump) {
            res += `  jumpto ${this.opnr + 1 + this.op.imm}`;
        }
        return res;
    }
}
class GoSubNode extends RawOpcodeNode {
    subargs = new StackDiff();
    returntype = new StackDiff();
    constructor(cands: ScriptCandidate[], op: ClientScriptOp, opinfo: OpcodeInfo, opnr: number) {
        super(op, opinfo, opnr);
        let sub = cands.find(q => q.id == op.imm);
        if (sub?.returnType) { this.returntype = sub.returnType; }
        if (sub?.argtype) { this.subargs = sub.argtype; }
    }
    debugString(calli: ClientscriptObfuscation) {
        return `${super.debugString(calli)}  ${this.returntype}(${this.subargs})`;
    }
}

function generateAst(cands: ScriptCandidate[], calli: ClientscriptObfuscation, script: clientscriptdata | clientscript, ops: ClientScriptOp[], scriptid: number) {
    let sections: CodeBlockNode[] = [];
    let getorMakeSection = (index: number) => {
        if (index >= ops.length) { throw new Error("tried to jump outside script"); }
        let section = sections.find(q => q.startindex == index);
        if (!section) {
            section = new CodeBlockNode(scriptid, index);
            sections.push(section);
        }
        return section
    }

    let currentsection = getorMakeSection(0);

    //find all jump targets and make the sections
    for (let [index, op] of ops.entries()) {
        let nextindex = index + 1;
        let info = calli.decodedMappings.get(op.opcode)!;
        if (!info) { throw new Error("tried to add unknown op to AST"); }

        if (info.optype == "branch") {
            let jumpindex = nextindex + op.imm;
            getorMakeSection(nextindex);
            getorMakeSection(jumpindex);
        }
    }

    //write the opcodes
    for (let [index, op] of ops.entries()) {
        let nextindex = index + 1;
        let info = calli.decodedMappings.get(op.opcode)!;
        if (!info) { throw new Error("tried to add unknown op to AST"); }
        let opnode: RawOpcodeNode;
        if (info.id == namedOps.gosub) {
            opnode = new GoSubNode(cands, op, info, index);
        } else {
            opnode = new RawOpcodeNode(op, info, index);
        }

        //check if other flows merge into this one
        let addrsection = sections.find(q => q.startindex == index);
        if (addrsection && addrsection != currentsection) {
            currentsection.nodes.push(new MergeIntoNode(addrsection));
            currentsection.possibleSuccessors.push(addrsection);
            currentsection = addrsection;
        }

        currentsection.nodes.push(opnode);

        if (opnode.opinfo.optype == "branch") {
            let jumpindex = nextindex + op.imm;
            let nextblock = getorMakeSection(nextindex);
            let jumpblock = getorMakeSection(jumpindex);
            currentsection.possibleSuccessors.push(nextblock, jumpblock);
            currentsection = nextblock;
        } else if (opnode.opinfo.optype == "return") {
            if (index != ops.length - 1) {
                //dead code will be handled elsewhere
                currentsection = getorMakeSection(nextindex);
            }
        } else if (opnode.opinfo.id == namedOps.switch) {
            let cases = script.switches[opnode.op.imm];
            if (!cases) { throw new Error("no matching cases in script"); }

            let nextblock = getorMakeSection(nextindex);
            currentsection.possibleSuccessors.push(nextblock)
            for (let cond of cases) {
                let jumpblock = getorMakeSection(nextindex + cond.label);
                currentsection.possibleSuccessors.push(jumpblock);
            }
            currentsection = nextblock;
        }
    }
    sections.sort((a, b) => a.startindex - b.startindex);
    return sections;
}

export async function prepareClientScript(source: CacheFileSource) {
    if (!source.decodeArgs.clientScriptDeob) {
        let deob = new ClientscriptObfuscation();
        globalThis.deob = deob;//TODO remove
        source.decodeArgs.clientScriptDeob = deob;
        await deob.runAutoCallibrate(source);
    }
}

function getArgType(script: clientscriptdata | clientscript) {
    let res = new StackDiff();
    res.int = script.intargcount;
    res.long = script.unk0;
    res.string = script.stringargcount;
    return res;
}

function getReturnType(calli: ClientscriptObfuscation, ops: ClientScriptOp[]) {
    let res = new StackDiff();
    //the jagex compiler appends a default return with null constants to the script, even if this would be dead code
    for (let i = ops.length - 2; i >= 0; i--) {
        let op = ops[i];
        let opinfo = calli.decodedMappings.get(op.opcode);
        if (!opinfo) { throw new Error("unnexpected"); }
        if (opinfo.id == namedOps.pushconst) {
            if (op.imm == 0) { res.int++; }
            if (op.imm == 1) { res.long++; }
            if (op.imm == 2) { res.string++; }
        } else if (opinfo.id == namedOps.pushint) {
            res.int++;
        } else if (opinfo.id == namedOps.pushlong) {
            res.long++;
        } else if (opinfo.id == namedOps.pushstring) {
            res.string++;
        } else {
            break;
        }
    }
    return res;
}

export async function renderClientScript(source: CacheFileSource, buf: Buffer, fileid: number) {
    let calli = source.getDecodeArgs().clientScriptDeob;
    if (!(calli instanceof ClientscriptObfuscation)) { throw new Error("no deob"); }

    let cands = await calli.loadCandidates(source);

    let script = parse.clientscript.read(buf, source);
    let sections = generateAst(cands, calli, script, script.opcodedata, fileid);

    let returntype = getReturnType(calli, script.opcodedata);
    let argtype = getArgType(script);
    let res = "";
    res += `script ${fileid} ${returntype} (${argtype})\n`;

    for (let section of sections) {
        res += `============ section ${section.startindex} ============\n`;
        for (let [subline, command] of section.nodes.entries()) {
            let currentline = section.startindex + subline;
            res += `${currentline.toString().padStart(4, " ")}: ${command.debugString(calli)}\n`;
        }
    }
    return res;
}

function firstKey<T>(map: Map<T, any>) {
    return map.keys().next().value as T;
}
