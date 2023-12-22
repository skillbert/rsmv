import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { FileParser, parse } from "../opdecoder";
import { posmod, trickleTasksTwoStep } from "../utils";
import { DecodeState } from "../opcode_reader";
import { clientscriptdata } from "../../generated/clientscriptdata";
import { clientscript } from "../../generated/clientscript";
import { Openrs2CacheSource } from "../cache/openrs2loader";
import { osrsOpnames } from "./osrsopnames";
import { CodeBlockNode, RawOpcodeNode, generateAst } from "./ast";
import * as fs from "fs/promises";
import * as path from "path";
import { crc32 } from "../libs/crc32util";

const detectableImmediates = ["byte", "int", "tribyte", "switch"] satisfies ImmediateType[];
const lastNonObfuscatedBuild = 668;
const firstModernOpsBuild = 751;

const variableSources = {
    player: { key: 0, index: 60 },
    npc: { key: 1, index: 61 },
    client: { key: 2, index: 62 },
    world: { key: 3, index: 63 },
    region: { key: 4, index: 64 },
    object: { key: 5, index: 65 },
    clan: { key: 6, index: 66 },
    clansettings: { key: 7, index: 67 },
    // campaign: { key: 8, index: 68 },//seems incorrect after 30oct2023
    playergroup: { key: 9, index: 75 }//not sure about 75
};

let varInfoParser = new FileParser<{ type: number }>({
    "0x03": { "name": "type", "read": "ubyte" },
    "0x04": { "name": "0x04", "read": "ubyte" },
    "0x07": { "name": "0x07", "read": true },
    "0x6e": { "name": "0x6e", "read": "ushort" },
});

export const namedClientScriptOps = {
    //old caches only
    pushint: 0,
    pushlong: 54,
    pushstring: 3,

    //local var assign
    pushlocalint: 33,
    poplocalint: 34,
    pushlocalstring: 35,
    poplocalstring: 36,

    //variable number of args
    joinstring: 37,
    gosub: 40,

    //complicated types
    pushvar: 42,
    popvar: 43,

    //control flow
    jump: 6,
    branch_not: 7,
    branch_eq: 8,
    branch_lt: 9,
    branch_gt: 10,
    branch_lteq: 31,
    branch_gteq: 32,
    branch_unk11619: 11619,
    branch_unk11611: 11611,
    branch_unk11613: 11613,
    branch_unk11606: 11606,
    branch_unk11624: 11624,
    branch_unk11625: 11625,
    switch: 51,
    return: 21,

    //unknown original ids
    pushconst: 9001,
    tribyte1: 9002,
    tribyte2: 9003,

    //math stuff
    plus: 10000
}

export const knownClientScriptOpNames: Record<number, string> = {
    ...osrsOpnames,
    ...Object.fromEntries(Object.entries(namedClientScriptOps).map(q => [q[1], q[0]]))
}

const branchInstructions = [
    namedClientScriptOps.branch_not,
    namedClientScriptOps.branch_eq,
    namedClientScriptOps.branch_lt,
    namedClientScriptOps.branch_gt,
    namedClientScriptOps.branch_lteq,
    namedClientScriptOps.branch_gteq,
    //probably comparing longs
    namedClientScriptOps.branch_unk11619,
    namedClientScriptOps.branch_unk11611,
    namedClientScriptOps.branch_unk11613,
    namedClientScriptOps.branch_unk11606,
    namedClientScriptOps.branch_unk11624,
    namedClientScriptOps.branch_unk11625
];

type StackDiffEquation = {
    section: CodeBlockNode,
    unknowns: Set<OpcodeInfo>
}

export type ClientScriptOp = {
    opcode: number,
    imm: number,
    imm_obj: string | number | [number, number] | null,
    opname?: string
}

export class OpcodeInfo {
    scrambledid: number;
    id: number;
    possibleTypes: Set<ImmediateType>;
    type: ImmediateType | "unknown";
    optype: OpTypes | "unknown" = "unknown";
    stackinfo = new StackInOut();
    stackChangeConstraints = new Set<StackDiffEquation>();
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
    static fromJson(json: ReturnType<OpcodeInfo["toJson"]>) {
        let r = new OpcodeInfo(json.scrambledid, json.id, json.type == "unknown" ? detectableImmediates : [json.type]);
        r.optype = json.optype;
        r.stackinfo = new StackInOut(ValueList.fromJson(json.stackin), ValueList.fromJson(json.stackout));
        return r;
    }
    toJson() {
        return {
            id: this.id,
            scrambledid: this.scrambledid,
            stackin: this.stackinfo.in.toJson(),
            stackout: this.stackinfo.out.toJson(),
            type: this.type,
            optype: this.optype
        }
    }
}
export type StackType = "int" | "long" | "string" | "vararg";
export class ValueList {
    values: StackType[];
    constructor(values: StackType[] = []) {
        this.values = values;
    }
    static fromFlipped(other: ValueList) {
        return new ValueList(other.values.slice().reverse());
    }
    pushone(type: StackType) { this.values.push(type); }
    int() { this.values.push("int"); }
    long() { this.values.push("long"); }
    string() { this.values.push("string"); }
    isEmpty() { return this.values.length == 0; }

    pop(list: ValueList) {
        if (!this.tryPop(list)) { throw new Error("tried to pop values set that are not on stack"); }
    }
    popReversed(list: ValueList) {
        if (!this.tryPopReversed(list)) { throw new Error("tried to pop values set that are not on stack"); }
    }
    tryPopReversed(list: ValueList) {
        if (list.getFlippedOverlap(this) == list.values.length) {
            this.values.length -= list.values.length;
            return true;
        } else {
            return false;
        }
    }
    tryPop(list: ValueList) {
        if (this.getOverlap(list) == list.values.length) {
            this.values.length -= list.values.length;
            return true;
        } else {
            return false;
        }
    }
    push(list: ValueList) {
        this.values.push(...list.values);
    }
    pushReversed(list: ValueList) {
        for (let i = list.values.length - 1; i >= 0; i--) {
            this.values.push(list.values[i]);
        }
    }
    clone() {
        return new ValueList(this.values.slice());
    }
    getFlippedOverlap(other: ValueList) {
        let overlap = Math.min(this.values.length, other.values.length);
        for (let i = 0; i < overlap; i++) {
            if (other.values[other.values.length - 1 - i] != this.values[i]) {
                overlap = i;
                break;
            }
        }
        return overlap;
    }
    getOverlap(other: ValueList) {
        let overlap = Math.min(this.values.length, other.values.length);
        for (let i = 0; i < overlap; i++) {
            if (other.values[other.values.length - 1 - i] != this.values[this.values.length - 1 - i]) {
                overlap = i;
                break;
            }
        }
        return overlap;
    }
    leastCommon(other: ValueList) {
        return this.values.splice(0, this.values.length - this.getOverlap(other));
    }
    leastCommonFlipped(other: ValueList) {
        let overlap = this.getFlippedOverlap(other);
        let res = this.values.slice(this.values.length - 1 - overlap);
        this.values.length -= overlap;
        return res;
    }
    cancelout(other: ValueList) {
        let overlap = this.getOverlap(other);
        let res = this.values.slice(this.values.length - overlap);
        this.values.length -= overlap;
        other.values.length -= overlap;
        return res;
    }
    toJson() { return this.values; }
    static fromJson(v: ReturnType<ValueList["toJson"]>) { return new ValueList(v); }
    getStackdiff() {
        let r = new StackDiff();
        for (let v of this.values) {
            if (v == "int") { r.int++; }
            if (v == "string") { r.string++; }
            if (v == "long") { r.long++; }
            if (v == "vararg") { r.vararg++; }
        }
        return r;
    }
}
export class StackInOut {
    in = new ValueList();
    out = new ValueList();
    initializedin = false;
    initializedout = false;
    initializedthrough = false;
    constructor(inlist?: ValueList, outlist?: ValueList) {
        this.in = inlist ?? new ValueList();
        this.out = outlist ?? new ValueList();
        this.initializedin = !!inlist;
        this.initializedout = !!outlist;
        this.initializedthrough = this.initializedin && this.initializedout;
    }
    getBottomOverlap() {
        let maxlen = Math.min(this.in.values.length, this.out.values.length);
        for (let i = 0; i < maxlen; i++) {
            if (this.in.values[i] != this.out.values[i]) {
                return i;
            }
        }
        return maxlen;
    }
    totalChange() {
        return this.out.values.length - this.in.values.length;
    }
    getCode() {
        return `${this.out.values.join(",")}(${this.in.values.join(",")})`;
    }
}
export class StackDiff {
    int: number;
    long: number;
    string: number;
    vararg: number;
    static fromJson(json: ReturnType<StackDiff["toJson"]> | undefined | null) {
        if (!json) { return null; }
        return new StackDiff(json.int, json.long, json.string, json.vararg)
    }
    toJson() {
        return { ...this };
    }
    constructor(int = 0, long = 0, string = 0, vararg = 0) {
        this.int = int;
        this.long = long;
        this.string = string;
        this.vararg = vararg;
    }
    sub(other: StackDiff) {
        this.int -= other.int;
        this.long -= other.long;
        this.string -= other.string;
        this.vararg -= other.vararg;
        return this;
    }
    add(other: StackDiff) {
        this.int += other.int;
        this.long += other.long;
        this.string += other.string;
        this.vararg += other.vararg;
        return this;
    }
    minzero() {
        this.int = Math.max(0, this.int);
        this.long = Math.max(0, this.long);
        this.string = Math.max(0, this.string);
        this.vararg = Math.max(0, this.vararg);
        return this;
    }
    min(other: StackDiff) {
        this.int = Math.min(other.int, this.int);
        this.long = Math.min(other.long, this.long);
        this.string = Math.min(other.string, this.string);
        this.vararg = Math.min(other.vararg, this.vararg);
    }
    mult(n: number) {
        this.int *= n;
        this.long *= n;
        this.string *= n;
        this.vararg *= n;
        return this;
    }
    intdiv(n: number) {
        if (this.int % n != 0 || this.long % n != 0 || this.string % n != 0 || this.vararg % n != 0) {
            throw new Error("attempted stackdiv division leading to remainder");
        }
        this.int /= n;
        this.long /= n;
        this.string /= n;
        this.vararg /= n;
        return this;
    }
    lteq(other: StackDiff) {
        return this.int <= other.int && this.long <= other.long && this.string <= other.string && this.vararg <= other.vararg;
    }
    equals(other: StackDiff) {
        return this.int == other.int && this.long == other.long && this.string == other.string && this.vararg == other.vararg;
    }
    isEmpty() {
        return this.int == 0 && this.long == 0 && this.string == 0 && this.vararg == 0;
    }
    toString() {
        return `(${this.int},${this.long},${this.string},${this.vararg})`;
    }
    clone() {
        return new StackDiff().add(this);
    }
    getArglist() {
        let ntypes = +!!this.int + +!!this.string + +!!this.long + +!!this.vararg;
        if (ntypes > 1) {
            //can't know the order of the args
            return null;
        } else {
            let inargs = new ValueList();
            inargs.values.push(...Array<StackType>(this.int).fill("int"));
            inargs.values.push(...Array<StackType>(this.string).fill("string"));
            inargs.values.push(...Array<StackType>(this.long).fill("long"));
            inargs.values.push(...Array<StackType>(this.vararg).fill("vararg"));
            return inargs;
        }
    }
}

export type ScriptCandidate = {
    id: number,
    solutioncount: number,
    buf: Buffer,
    script: clientscriptdata,
    scriptcontents: ClientScriptOp[] | null,
    returnType: ValueList | null,
    argtype: StackDiff | null,
    unknowns: Map<number, OpcodeInfo>,
    didmatch: boolean
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
    if (op == namedClientScriptOps.pushconst) { type = "switch"; }
    if (op == namedClientScriptOps.tribyte1 || op == namedClientScriptOps.tribyte2) { type = "tribyte"; }
    return type;
}

function translateClientScript(opcodes: ClientScriptOp[], frombuild: number, tobuild: number) {
    if (frombuild < firstModernOpsBuild && tobuild >= firstModernOpsBuild) {
        return opcodes.map<ClientScriptOp>(q => {
            //for sure build 751
            if (q.opcode == namedClientScriptOps.pushint) { return { opcode: namedClientScriptOps.pushconst, imm: 0, imm_obj: q.imm }; }
            if (q.opcode == namedClientScriptOps.pushlong) { return { opcode: namedClientScriptOps.pushconst, imm: 1, imm_obj: q.imm_obj }; }
            if (q.opcode == namedClientScriptOps.pushstring) { return { opcode: namedClientScriptOps.pushconst, imm: 2, imm_obj: q.imm_obj }; }

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
        let rootcalli = await ClientscriptObfuscation.create(rootsource);
        let refcalli = await ClientscriptObfuscation.create(refsource);
        rootcalli.setNonObbedMappings();
        await refcalli.runCallibrationFrom(rootcalli);

        //2 opcodes have the tribyte type
        let tribyte1 = new OpcodeInfo(0x0314, namedClientScriptOps.tribyte1, ["tribyte"]);
        let tribyte2 = new OpcodeInfo(0x025d, namedClientScriptOps.tribyte2, ["tribyte"]);
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
        return refcalli.generateDump();
    })();
    return referenceOpcodeDump;
}

export class ClientscriptObfuscation {
    mappings = new Map<number, OpcodeInfo>();
    decodedMappings = new Map<number, OpcodeInfo>();
    callibrated = false;
    opidcounter = 10000;
    source: CacheFileSource;
    varmeta: Map<number, { name: string, vars: Map<number, typeof varInfoParser extends FileParser<infer T> ? T : never> }> = new Map();
    scriptargs = new Map<number, {
        args: StackDiff,
        returns: ValueList
        arglist: ValueList | null,//seperate entries since order is not well defined
        returnlist: ValueList | null,//is null when order can be ambiguous
    }>();
    candidates = new Map<number, ScriptCandidate>();

    static async fromJson(source: CacheFileSource, json: ReturnType<ClientscriptObfuscation["toJson"]>) {
        if (json.buildnr != source.getBuildNr()) {
            throw new Error("build numbers of json deob and loaded cache don't match");
        }
        let r = new ClientscriptObfuscation(source);
        for (let opjson of json.mappings) {
            let op = OpcodeInfo.fromJson(opjson);
            r.mappings.set(op.scrambledid, op);
            r.decodedMappings.set(op.id, op);
        }
        r.opidcounter = json.opidcounter;
        r.callibrated = true;
        r.scriptargs = new Map(json.scriptargs.map(v => {
            let args = StackDiff.fromJson(v.args)!;
            let returns = ValueList.fromJson(v.returns);
            return [v.id, {
                args: args,
                returns: returns!,
                arglist: args.getArglist(),
                returnlist: returns.getStackdiff().getArglist()
            }];
        }));
        await r.preloadData(true);
        return r;
    }

    toJson() {
        let r = {
            buildnr: this.source.getBuildNr(),
            mappings: [...this.mappings.values()].map(v => v.toJson()),
            opidcounter: this.opidcounter,
            scriptargs: [...this.scriptargs].map(([k, v]) => ({ id: k, args: v.args.toJson(), returns: v.returns.toJson() }))
        }
        return r;
    }

    static async getSaveName(source: CacheFileSource) {
        let index = await source.getCacheIndex(cacheMajors.clientscript);
        let firstindex = index.find(q => q);//[0] might be undefined
        if (!firstindex) { throw new Error("cache has no clientscripts"); }
        let firstscript = await source.getFileById(firstindex.major, firstindex.minor);
        let crc = crc32(firstscript);
        return `cache/opcodes-build${source.getBuildNr()}-${crc}.json`;
    }

    async save() {
        if (typeof fs == "undefined") {
            throw new Error("no filesystem access");
        }
        let json = this.toJson();
        let filedata = JSON.stringify(json);
        let filename = await ClientscriptObfuscation.getSaveName(this.source);
        await fs.mkdir(path.dirname(filename), { recursive: true });
        await fs.writeFile(filename, filedata);
    }

    private constructor(source: CacheFileSource) {
        this.source = source;
    }

    static async create(source: CacheFileSource, nocached = false) {
        if (!nocached) {
            try {
                let file = await fs.readFile(await this.getSaveName(source), "utf8");
                let json = JSON.parse(file);
                return this.fromJson(source, json);
            } catch { }
        }
        let res = new ClientscriptObfuscation(source);
        await res.preloadData(false);
        return res;
    }

    declareOp(rawopid: number, types: ImmediateType[]) {
        let op = new OpcodeInfo(rawopid, this.opidcounter++, types);
        if (this.mappings.has(rawopid)) { throw new Error("op already exists"); }
        if (this.decodedMappings.has(op.id)) { throw new Error("allocated op id alerady exists"); }
        this.mappings.set(rawopid, op);
        this.decodedMappings.set(op.id, op);
        return op;
    }

    async preloadData(skipcandidates: boolean) {
        let loadVars = async (subid: number) => {
            let archieve = await this.source.getArchiveById(cacheMajors.config, subid);
            return new Map(archieve.map(q => [q.fileid, varInfoParser.read(q.buffer, this.source)]));
        }

        //only tested on current 932 caches
        if (this.source.getBuildNr() > 900) {
            this.varmeta = new Map(await Promise.all(Object.entries(variableSources).map(async q => [
                q[1].key,
                {
                    name: q[0],
                    vars: await loadVars(q[1].index)
                }
            ] as const)));
        }

        if (!skipcandidates) {
            let index = await this.source.getCacheIndex(cacheMajors.clientscript);
            this.candidates.clear();
            let source = this.source;
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
                        unknowns: new Map(),
                        didmatch: false
                    }));
                }
            }, q => this.candidates.set(q.id, q));
        }
    }

    async generateDump() {
        let cands = this.candidates;
        let scripts: ReferenceScript[] = [];
        parseCandidateContents(this);
        for (let cand of cands.values()) {
            if (cand.scriptcontents) {
                scripts.push({ id: cand.id, scriptdata: cand.script, scriptops: cand.scriptcontents });
            }
        }
        console.log(`dumped ${scripts.length} /${cands.size} scripts`);
        return {
            buildnr: this.source.getBuildNr(),
            scripts,
            mappings: this.mappings,
            opidcounter: this.opidcounter
        } satisfies ReferenceCallibration;
    }
    async runAutoCallibrate(source: CacheFileSource) {
        if (source.getBuildNr() <= lastNonObfuscatedBuild) {
            this.setNonObbedMappings();
        } else if (!this.callibrated) {
            let ref = await getReferenceOpcodeDump();
            await this.runCallibration(ref);
        }
    }
    async runCallibrationFrom(previousCallibration: ClientscriptObfuscation) {
        let refscript = await previousCallibration.generateDump();
        await this.runCallibration(refscript);
        console.log("callibrated", this);
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
    async runCallibration(refcalli: ReferenceCallibration) {
        let convertedref = refcalli.scripts.map<ClientScriptOp[]>(q => translateClientScript(q.scriptops, refcalli.buildnr, this.source.getBuildNr()));
        let candidates = this.candidates;

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
            cand.didmatch = true;
            for (let [k, v] of unconfirmed) {
                let info = new OpcodeInfo(k, v.opcode, [opcodeToType(v.opcode)]);
                this.mappings.set(k, info);
                this.decodedMappings.set(v.opcode, info);
            }
            return true;
        }

        let iter = async () => {
            for (let [index, ref] of refcalli.scripts.entries()) {
                let cand = candidates.get(ref.id);
                if (!cand) { continue; }
                testCandidate(cand, convertedref[index])
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

        await findOpcodeImmidiates(this);
        this.callibrated = true;
        parseCandidateContents(this);

        for (let op of this.mappings.values()) {
            if (op.id == namedClientScriptOps.gosub) {
                op.optype = "gosub";
            } else if (op.id == namedClientScriptOps.return) {
                op.optype = "return";
            } else if (branchInstructions.includes(op.id)) {
                op.optype = "branch";
            }
        }
        findOpcodeTypes(this);
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

        let opname = knownClientScriptOpNames[res.id] ?? "unknown";

        return { opcode: res.id, imm: imm.imm, imm_obj: imm.imm_obj, opname } satisfies ClientScriptOp;
    }
    getClientVarMeta(varint: number) {
        let groupid = (varint >> 24) & 0xff;
        let varid = (varint >> 8) & 0xffff;
        let group = this.varmeta.get(groupid);
        let varmeta = group?.vars.get(varid);
        if (!group || !varmeta) { return null; }
        let diff = new StackDiff();
        if ([36, 50].includes(varmeta.type)) { diff.string++; }
        else if ([35, 49, 56, 71, 110, 115, 116].includes(varmeta.type)) { diff.long++; }
        else { diff.int++; }
        let type = (diff.int ? "int" as const : diff.long ? "long" as const : "string" as const);

        return { name: group.name, varid, diff, type };
    }
}

function parseCandidateContents(calli: ClientscriptObfuscation) {
    for (let cand of calli.candidates.values()) {
        try {
            cand.scriptcontents ??= parse.clientscript.read(cand.buf, calli.source, { clientScriptDeob: calli }).opcodedata;
        } catch (e) { }

        if (!cand.scriptcontents) { continue; }
        cand.returnType = getReturnType(calli, cand.scriptcontents);
        cand.argtype = getArgType(cand.script);
        calli.scriptargs.set(cand.id, {
            args: cand.argtype,
            returns: cand.returnType,
            arglist: cand.argtype.getArglist(),
            returnlist: cand.returnType.getStackdiff().getArglist()
        });
    }
}

async function findOpcodeImmidiates(calli: ClientscriptObfuscation) {

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
    let candidates = [...calli.candidates.values()];
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

function findOpcodeTypes(calli: ClientscriptObfuscation) {
    parseCandidateContents(calli);

    //TODO merge with previous loop?
    let allsections: CodeBlockNode[] = [];
    for (let cand of calli.candidates.values()) {
        if (!cand.scriptcontents) { continue }
        let sections = generateAst(calli, cand.script, cand.scriptcontents, cand.id);
        allsections.push(...sections);
    }
    allsections.sort((a, b) => a.children.length - b.children.length);
    globalThis.allsections = allsections;//TODO remove

    let testSection = (eq: StackDiffEquation) => {
        let { section, unknowns } = eq;
        if (Array.isArray(globalThis.test) && section.scriptid == globalThis.test[0] && section.originalindex == globalThis.test[1]) {
            console.log(section.getCode(calli, 0))
            debugger;
        }
        if (section.hasUnexplainedChildren) { return false; }
        let frontstack = new ValueList();
        let backstack = new ValueList();
        for (let i = 0; i < section.children.length; i++) {
            let node = section.children[i];
            if (!(node instanceof RawOpcodeNode)) { throw new Error("unescpted"); }
            if (node.knownStackDiff) {
                frontstack.popReversed(node.knownStackDiff.in);
                frontstack.pushReversed(node.knownStackDiff.out);
            } else {
                let info = node.opinfo.stackinfo;
                if (!info.initializedin) {
                    info.in = ValueList.fromFlipped(frontstack);
                    info.initializedin = true;
                } else {
                    let shortage = info.in.values.length - info.in.getFlippedOverlap(frontstack)
                    let inoutoverlap = info.in.getOverlap(info.out);
                    if (shortage > 0) {
                        if (info.initializedthrough) {
                            if (inoutoverlap < shortage) { throw new Error("not compatible"); }
                            info.out.values.length -= shortage;
                            inoutoverlap -= shortage;
                        }
                        info.in.values.length -= shortage;
                    }
                    frontstack.popReversed(info.in);
                    if (!info.initializedthrough && info.initializedout && info.initializedin) {
                        // info.initializedthrough = true;
                        // foundset.add(node.opinfo.id);
                    }
                }
                if (!info.initializedthrough || !info.initializedout) {
                    break;
                }
                frontstack.pushReversed(info.out);
            }
        }
        for (let i = 0; i < section.children.length; i++) {
            let node = section.children[section.children.length - 1 - i];
            if (!(node instanceof RawOpcodeNode)) { throw new Error("unescpted"); }

            if (node.knownStackDiff) {
                backstack.popReversed(node.knownStackDiff.out);
                backstack.pushReversed(node.knownStackDiff.in);
            } else {
                let info = node.opinfo.stackinfo;
                if (!info.initializedout) {
                    info.out = ValueList.fromFlipped(backstack);
                    info.initializedout = true;
                } else {
                    let shortage = info.out.values.length - info.out.getFlippedOverlap(backstack);
                    let inoutoverlap = info.in.getOverlap(info.out);
                    if (shortage > 0) {
                        if (info.initializedthrough) {
                            if (inoutoverlap < shortage) { throw new Error("not compatible"); }
                            info.in.values.length -= shortage;
                            inoutoverlap -= shortage;
                        }
                        info.out.values.length -= shortage;
                    }
                    if (!info.initializedthrough && info.initializedout && info.initializedin) {
                        // info.initializedthrough = true;
                        // foundset.add(node.opinfo.id);
                    }
                    backstack.popReversed(info.out);
                }
                if (!info.initializedthrough || !info.initializedin) {
                    break;
                }
                backstack.pushReversed(info.in);
            }
        }

        let unkcount = 0;
        let unktype: OpcodeInfo | null = null;
        let totalstack = 0;
        unknowns.clear();
        for (let child of section.children) {
            if (!(child instanceof RawOpcodeNode)) { throw new Error("unescpted"); }
            if (child.knownStackDiff) {
                totalstack += child.knownStackDiff.totalChange();
            } else if (child.opinfo.stackinfo.initializedthrough) {
                totalstack += child.opinfo.stackinfo.totalChange();
            } else {
                unktype = child.opinfo;
                unknowns.add(child.opinfo);
                unkcount++;
            }
        }
        if (unktype && unknowns.size == 1) {
            if (posmod(totalstack, unkcount) != 0) { throw new Error("stack different is not evenly dividable between equal ops"); }
            let diffeach = totalstack / unkcount + unktype.stackinfo.totalChange();
            if (diffeach > 0) {
                unktype.stackinfo.out.values.length -= diffeach;
            } else if (diffeach < 0) {
                unktype.stackinfo.in.values.length -= -diffeach;
            }
            unktype.stackinfo.initializedthrough = true;
            unknowns.delete(unktype);
            foundset.add(unktype.id);
        } else if (unknowns.size > 1) {
            for (let unk of unknowns) {
                let mapping = calli.decodedMappings.get(unk.id)!;
                mapping.stackChangeConstraints.add(eq);
            }
        }

        for (let unk of unknowns) {
            let prev = opmap.get(unk.id);
            if (!prev) {
                prev = new Set();
                prev.add(eq);
                opmap.set(unk.id, prev);
            }
            prev.add(eq);
        }

        return true;
    }

    let opmap = new Map<number, Set<StackDiffEquation>>();
    let pendingEquations: StackDiffEquation[] = [];
    let pendingEquationSet = new Set<StackDiffEquation>();
    let foundset = new Set<number>();
    for (let section of allsections) {
        if (section.hasUnexplainedChildren) { continue; }
        let eq: StackDiffEquation = { section, unknowns: new Set() };
        testSection(eq);
        pendingEquations.push(eq);
    }
    for (let i = 0; i < 4; i++) {
        for (let eq of pendingEquations) {
            testSection(eq);
        }
        let total = 0;
        let partial = 0;
        let done = 0;
        let missing = new Set<OpcodeInfo>()
        for (let op of calli.mappings.values()) {
            if (op.stackinfo.initializedthrough) { done++; }
            else if (op.stackinfo.initializedin || op.stackinfo.initializedout) { partial++; }
            else { missing.add(op); }
            total++;
        }
        console.log("total", total, "done", done, "partial", partial, "incomplete", missing.size);
    }
    pendingEquations.sort((a, b) => a.unknowns.size - b.unknowns.size);
    globalThis.eqs = pendingEquations;//TODO remove
    for (let eq of pendingEquations) {

    }
}


export async function prepareClientScript(source: CacheFileSource) {
    // source.decodeArgs.clientScriptDeob = null;//TODO remove
    if (!source.decodeArgs.clientScriptDeob) {
        let deob = await ClientscriptObfuscation.create(source);
        globalThis.deob = deob;//TODO remove
        source.decodeArgs.clientScriptDeob = deob;
        await deob.runAutoCallibrate(source);
    }
}

export function getArgType(script: clientscriptdata | clientscript) {
    let res = new StackDiff();
    res.int = script.intargcount;
    res.long = script.unk0;
    res.string = script.stringargcount;
    return res;
}

export function getReturnType(calli: ClientscriptObfuscation, ops: ClientScriptOp[]) {
    let res = new ValueList();
    //the jagex compiler appends a default return with null constants to the script, even if this would be dead code
    for (let i = ops.length - 2; i >= 0; i--) {
        let op = ops[i];
        let opinfo = calli.decodedMappings.get(op.opcode);
        if (!opinfo) { throw new Error("unnexpected"); }
        if (opinfo.id == namedClientScriptOps.pushconst) {
            if (op.imm == 0) { res.int(); }
            if (op.imm == 1) { res.long(); }
            if (op.imm == 2) { res.string(); }
        } else if (opinfo.id == namedClientScriptOps.pushint) {
            res.int();
        } else if (opinfo.id == namedClientScriptOps.pushlong) {
            res.long();
        } else if (opinfo.id == namedClientScriptOps.pushstring) {
            res.string();
        } else {
            break;
        }
    }
    return res;
}

function firstKey<T>(map: Map<T, any>) {
    return map.keys().next().value as T;
}
