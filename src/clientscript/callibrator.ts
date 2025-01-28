import { CacheFileSource } from "../cache";
import { cacheConfigPages, cacheMajors } from "../constants";
import { FileParser, parse } from "../opdecoder";
import { posmod, trickleTasksTwoStep } from "../utils";
import { DecodeState, EncodeState } from "../opcode_reader";
import { clientscriptdata } from "../../generated/clientscriptdata";
import { clientscript } from "../../generated/clientscript";
import { Openrs2CacheSource } from "../cache/openrs2loader";
import * as fs from "fs/promises";
import { crc32, crc32addInt } from "../libs/crc32util";
import { params } from "../../generated/params";
import { ClientScriptOp, ImmediateType, StackConstants, StackDiff, StackInOut, StackList, namedClientScriptOps, variableSources, typeToPrimitive, getOpName, knownClientScriptOpNames } from "./definitions";
import { dbtables } from "../../generated/dbtables";
import { reverseHashes } from "../libs/rshashnames";
import { CodeBlockNode, RawOpcodeNode, generateAst, parseClientScriptIm } from "./ast";
import { detectSubtypes as callibrateSubtypes } from "./subtypedetector";
import * as datastore from "idb-keyval";
import { loadParams } from "./util";


const detectableImmediates = ["byte", "int", "tribyte", "switch"] satisfies ImmediateType[];
const lastNonObfuscatedBuild = 668;
const firstModernOpsBuild = 751;

type OpreadInstance = {
    opcode: number,
    imm: number,
    imm_obj: ClientScriptOp["imm_obj"],
    immtype: ImmediateType
}

export type StackDiffEquation = {
    section: CodeBlockNode,
    unknowns: Set<OpcodeInfo>
}

//TODO move to file
let varInfoParser = new FileParser<{ type: number }>({
    "0x03": { "name": "type", "read": "ubyte" },
    "0x04": { "name": "0x04", "read": "ubyte" },
    "0x07": { "name": "0x07", "read": true },
    "0x6e": { "name": "0x6e", "read": "ushort" },
});

var varbitInfoParser = new FileParser<{ varid: number, bits: [number, number] }>({
    "0x01": { "name": "varid", "read": "utribyte" },//[8bit domain][16bit id] read as tribyte since thats also how we read pushvar/popvar imm
    "0x02": { "name": "bits", "read": ["tuple", "ubyte", "ubyte"] }
});

export class OpcodeInfo {
    scrambledid: number;
    id: number;
    possibleTypes: Set<ImmediateType>;
    type: ImmediateType | "unknown";
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
        r.stackinfo = StackInOut.fromJson(json.stackinfo);
        return r;
    }
    toJson() {
        return {
            id: this.id,
            scrambledid: this.scrambledid,
            stackinfo: this.stackinfo.toJson(),
            type: this.type
        }
    }
}


export type ScriptCandidate = {
    id: number,
    scriptname: string,
    solutioncount: number,
    buf: Buffer,
    script: clientscriptdata,
    scriptcontents: clientscript | null,
    returnType: StackList | null,
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
    decodedMappings: Map<number, OpcodeInfo>,
    opidcounter: number
};

export type ReadOpCallback = (state: DecodeState) => ClientScriptOp;

//only works for old caches before opcode obfuscation
function getClassicImmType(op: number) {
    //originally all <0x80 were ints
    //except several special cases
    let type: ImmediateType = "byte";
    if (op == namedClientScriptOps.pushstring) { type = "string"; }
    else if (op == namedClientScriptOps.pushlong) { type = "long"; }
    else if (op == namedClientScriptOps.return) { type = "byte"; }
    else if (op == 0x26) { type = "byte"; }
    else if (op == 0x27) { type = "byte"; }
    else if (op == 0x66) { type = "byte"; }
    else if (op < 0x80) { type = "int"; }
    return type;
}

function cannonicalOp(operation: ClientScriptOp, buildnr: number, immtype: ImmediateType) {
    let op = operation.opcode;
    let imm = operation.imm;
    let imm_obj = operation.imm_obj;
    if (op == namedClientScriptOps.pushint) {
        imm_obj = imm;
        op = namedClientScriptOps.pushconst;
        immtype = "switch";
        imm = 0;
    }
    if (op == namedClientScriptOps.pushlong) {
        imm_obj = imm_obj;
        op = namedClientScriptOps.pushconst;
        immtype = "switch";
        imm = 1;
    }
    if (op == namedClientScriptOps.pushstring) {
        imm_obj = imm_obj;
        op = namedClientScriptOps.pushconst;
        immtype = "switch";
        imm = 2;
    }
    if (buildnr < firstModernOpsBuild) {
        if (op == namedClientScriptOps.pushvar || op == namedClientScriptOps.popvar) {
            imm = (2 << 24) | (imm << 8);
        }
    }

    return { opcode: op, imm, imm_obj, immtype } as OpreadInstance;
}

function isOpEqual(a: OpreadInstance, b: OpreadInstance) {

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
        let rootcalli = await ClientscriptObfuscation.create(await Openrs2CacheSource.fromId(1383));//668 20 dec 2011
        let bounce1 = await ClientscriptObfuscation.create(await Openrs2CacheSource.fromId(1572));//932 16 oct 2023
        //add extra bounces when the gap is too large and non of the scripts match
        rootcalli.setNonObbedMappings();
        await bounce1.runCallibrationFrom(rootcalli.generateDump());
        return bounce1.generateDump();
    })();
    return referenceOpcodeDump;
}

export class ClientscriptObfuscation {
    mappings = new Map<number, OpcodeInfo>();
    decodedMappings = new Map<number, OpcodeInfo>();
    isNonObbedCache = false;
    candidatesLoaded = false;
    foundEncodings = false;
    foundParameters = false;
    foundSubtypes = false;
    opidcounter = 10000;
    source: CacheFileSource;
    dbtables = new Map<number, dbtables>();
    varmeta: Map<number, { name: string, maxid: number, vars: Map<number, typeof varInfoParser extends FileParser<infer T> ? T : never> }> = new Map();
    varbitmeta: Map<number, typeof varbitInfoParser extends FileParser<infer T> ? T : never> = new Map();
    parammeta = new Map<number, params>();
    scriptargs = new Map<number, { scriptname: string, stack: StackInOut }>();
    candidates = new Map<number, ScriptCandidate>();

    static async fromJson(source: CacheFileSource, deobjson: ReturnType<ClientscriptObfuscation["toJson"]>, scriptjson: null | ReturnType<ClientscriptObfuscation["getScriptJson"]>) {
        if (deobjson.buildnr != source.getBuildNr()) {
            throw new Error("build numbers of json deob and loaded cache don't match");
        }
        let r = new ClientscriptObfuscation(source);
        for (let opjson of deobjson.mappings) {
            let op = OpcodeInfo.fromJson(opjson);
            r.mappings.set(op.scrambledid, op);
            r.decodedMappings.set(op.id, op);
        }
        r.opidcounter = deobjson.opidcounter;
        r.foundEncodings = true;
        await r.preloadData();
        if (scriptjson) {
            r.scriptargs = new Map(scriptjson.scriptargs.map(v => {
                return [v.id, {
                    scriptname: v.scriptname ?? "",
                    stack: StackInOut.fromJson(v.stack)
                }];
            }));
        } else {
            await r.loadCandidates();
            r.parseCandidateContents();
            callibrateSubtypes(r, r.candidates);//TODO is this needed?
        }
        return r;
    }

    toJson() {
        let r = {
            buildnr: this.source.getBuildNr(),
            mappings: [...this.mappings.values()].map(v => v.toJson()),
            opidcounter: this.opidcounter,
        }
        return r;
    }
    getScriptJson() {
        let r = {
            scriptargs: [...this.scriptargs].map(([k, v]) => ({ id: k, scriptname: v.scriptname, stack: v.stack.toJson() }))
        };
        return r;
    }

    static async getSaveName(source: CacheFileSource) {
        let index = await source.getCacheIndex(cacheMajors.clientscript);
        let firstindex = index.find(q => q);//[0] might be undefined
        if (!firstindex) { throw new Error("cache has no clientscripts"); }
        let firstscript = await source.getFileById(firstindex.major, firstindex.minor);
        let crc = crc32(firstscript);
        let scripthash = 0;
        for (let i = 0; i < index.length; i++) {
            if (!index[i]) { continue; }
            scripthash = crc32addInt(index[i].crc, scripthash)
        }
        return {
            opcodename: `opcodes-build${source.getBuildNr()}-${crc}.json`,
            scriptname: `scripts-build${source.getBuildNr()}-${scripthash}.json`
        }
    }

    async save() {
        let { opcodename, scriptname } = await ClientscriptObfuscation.getSaveName(this.source);
        let filedata = JSON.stringify(this.toJson());
        let scriptfiledata = JSON.stringify(this.getScriptJson());
        if (fs.constants) {
            await fs.mkdir("cache", { recursive: true });
            await fs.writeFile(`cache/${opcodename}`, filedata);
            await fs.writeFile(`cache/${scriptname}`, scriptfiledata);
        } else if (datastore.set) {
            await datastore.set(opcodename, filedata);
            await datastore.set(scriptname, scriptfiledata);
        } else {
            console.log(`did not save cs2 callibration since there is no fs and no browser indexeddb`);
        }
    }

    private constructor(source: CacheFileSource) {
        this.source = source;
    }

    static async create(source: CacheFileSource, nocached = false) {
        //TODO merge fromjson and runautocallibrate into this to untangle weird logic and double-loading
        if (!nocached) {
            try {
                let { opcodename, scriptname } = await this.getSaveName(source);
                let file: string | undefined = undefined;
                let scriptfile: string | undefined = undefined;
                if (fs.constants) {
                    file = await fs.readFile(`cache/${opcodename}`, "utf8");
                    scriptfile = await fs.readFile(`cache/${scriptname}`, "utf8").catch(() => undefined);
                } else if (datastore.get) {
                    file = await datastore.get(opcodename);
                    scriptfile = await datastore.get(scriptname).catch(() => undefined);
                }
                if (file) {
                    let json = JSON.parse(file);
                    let scriptjson = (scriptfile ? JSON.parse(scriptfile) : null);
                    return this.fromJson(source, json, scriptjson);
                }
            } catch { }
        }
        let res = new ClientscriptObfuscation(source);
        globalThis.deob = res;//TODO remove
        await res.preloadData();
        await res.loadCandidates();
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

    async preloadData() {
        let loadVars = async (subid: number) => {
            let archieve = await this.source.getArchiveById(cacheMajors.config, subid);
            let last = archieve.at(-1)?.fileid ?? 0;
            return { last, vars: new Map(archieve.map(q => [q.fileid, varInfoParser.read(q.buffer, this.source)])) };
        }

        let dbtables = await this.source.getArchiveById(cacheMajors.config, cacheConfigPages.dbtables);
        this.dbtables = new Map(dbtables.map(q => [q.fileid, parse.dbtables.read(q.buffer, this.source)]));

        //only tested on current 932 caches
        if (this.source.getBuildNr() > 900) {
            this.varmeta = new Map(await Promise.all(Object.entries(variableSources).map(async q => {
                let vardata = await loadVars(q[1].index);
                return [q[1].key, { name: q[0], vars: vardata.vars, maxid: vardata.last }] as const;
            })));

            let varbitarchieve = await this.source.getArchiveById(cacheMajors.config, cacheConfigPages.varbits);
            this.varbitmeta = new Map(varbitarchieve.map(q => [q.fileid, varbitInfoParser.read(q.buffer, this.source)]));

            this.parammeta = await loadParams(this.source);
        }
    }
    async loadCandidates(idstart = 0, idend = 0xffffff) {
        let index = await this.source.getCacheIndex(cacheMajors.clientscript);
        this.candidates.clear();
        let source = this.source;
        await trickleTasksTwoStep(10, function* () {
            for (let entry of index) {
                if (!entry) { continue; }
                if (entry.minor < idstart || entry.minor > idend) { continue; }
                yield source.getFile(entry.major, entry.minor, entry.crc).then<ScriptCandidate>(buf => ({
                    id: entry.minor,
                    scriptname: reverseHashes.get(index[entry.minor].name!) ?? "",
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
        this.candidatesLoaded = true;
    }
    parseCandidateContents() {
        if (!this.candidatesLoaded) { throw new Error("candidates not loaded"); }
        if (!this.foundEncodings) { throw new Error("can't parse candidates because op encodings are not yet callibrated"); }
        for (let cand of this.candidates.values()) {
            try {
                cand.scriptcontents ??= parse.clientscript.read(cand.buf, this.source, { clientScriptDeob: this });
            } catch (e) { }

            if (!cand.scriptcontents) { continue; }
            cand.returnType = getReturnType(this, cand.scriptcontents.opcodedata);
            cand.argtype = getArgType(cand.script);
            this.scriptargs.set(cand.id, {
                scriptname: cand.scriptname,
                stack: new StackInOut(
                    cand.argtype.getArglist(),
                    //need to get rid of known stack order here since the runescript compiler doesn't adhere to it
                    //known cases:
                    // pop_intstring_discard order seems to not care about order
                    cand.returnType.toStackDiff().getArglist()
                )
            });
        }
    }

    generateDump() {
        let cands = this.candidates;
        let scripts: ReferenceScript[] = [];
        this.parseCandidateContents();
        for (let cand of cands.values()) {
            if (cand.scriptcontents) {
                scripts.push({ id: cand.id, scriptdata: cand.script, scriptops: cand.scriptcontents.opcodedata });
            }
        }
        console.log(`dumped ${scripts.length} /${cands.size} scripts`);
        return {
            buildnr: this.source.getBuildNr(),
            scripts,
            decodedMappings: this.decodedMappings,
            opidcounter: this.opidcounter
        } satisfies ReferenceCallibration;
    }
    async runAutoCallibrate(source: CacheFileSource) {
        if (source.getBuildNr() <= lastNonObfuscatedBuild) {
            this.setNonObbedMappings();
        } else if (!this.foundEncodings) {
            let ref = await getReferenceOpcodeDump();
            await this.runCallibrationFrom(ref);
        }
    }
    async runCallibrationFrom(refscript: ReferenceCallibration) {
        console.log(`callibrating buildnr ${this.source.getBuildNr()}`);
        copyOpcodesFrom(this, refscript);
        findOpcodeImmidiates(this);
        this.parseCandidateContents();
        callibrateOperants(this, this.candidates);
        // todo, somehow a extra runs still finds new types, these should have been caught in the first run
        callibrateOperants(this, this.candidates);
        callibrateOperants(this, this.candidates);
        callibrateOperants(this, this.candidates);
        try {
            callibrateSubtypes(this, this.candidates);
        } catch (e) {
            console.log("subtype callibration failed, types info might not be accurate");
        }
    }
    // don't want them to be methods, use this to expose them to console
    findOpcodeImmidiates = findOpcodeImmidiates;
    callibrateOperants = callibrateOperants;
    callibrateSubtypes = callibrateSubtypes;
    setNonObbedMappings() {
        this.foundEncodings = true;
        this.isNonObbedCache = true;
    }
    writeOpCode = (state: EncodeState, v: unknown) => {
        if (!this.foundEncodings) { throw new Error("clientscript deob not callibrated yet"); }
        if (typeof v != "object" || !v) { throw new Error("opcode is expected to be an object"); }
        if (!("opcode" in v) || typeof v.opcode != "number") { throw new Error("opcode prop expectec"); }
        if (!("imm" in v) || typeof v.imm != "number") { throw new Error("imm prop expected"); }
        let op = this.getNamedOp(v.opcode);
        state.buffer.writeUint16BE(op.scrambledid, state.scan);
        state.scan += 2;
        if (op.type == "byte") {
            state.buffer.writeUint8(v.imm, state.scan);
            state.scan++;
        } else if (op.type == "int") {
            state.buffer.writeInt32BE(v.imm, state.scan);
            state.scan += 4;
        } else if (op.type == "tribyte") {
            state.buffer.writeUIntBE(v.imm, state.scan, 3);
            state.scan += 3;
        } else if (op.type == "switch") {
            if (!("imm_obj" in v)) { throw new Error("imm_obj prop expected"); }
            state.buffer.writeUInt8(v.imm, state.scan);
            state.scan++;
            if (v.imm == 0) {
                if (typeof v.imm_obj != "number") { throw new Error("int expected"); }
                state.buffer.writeInt32BE(v.imm_obj, state.scan);
                state.scan += 4;
            } else if (v.imm == 1) {
                if (!Array.isArray(v.imm_obj) || v.imm_obj.length != 2 || typeof v.imm_obj[0] != "number" || typeof v.imm_obj[1] != "number") { throw new Error("array with 2 ints expected"); }
                state.buffer.writeUInt32BE(v.imm_obj[0], state.scan + 0);
                state.buffer.writeUInt32BE(v.imm_obj[0], state.scan + 4);
                state.scan += 8;
            } else if (v.imm == 2) {
                if (typeof v.imm_obj != "string") { throw new Error("string expected"); }
                state.buffer.write(v.imm_obj, state.scan, "latin1");
                state.scan += v.imm_obj.length;
                state.buffer.writeUint8(0, state.scan);
                state.scan++;
            } else {
                throw new Error("unknown switch imm type " + v.imm);
            }
        } else {
            throw new Error("op type write not implemented " + op.type);
        }
    }
    readOpcode: ReadOpCallback = (state: DecodeState) => {
        if (!this.foundEncodings) { throw new Error("clientscript deob not callibrated yet"); }
        let opcode = state.buffer.readUint16BE(state.scan);
        state.scan += 2;
        let res = this.mappings.get(opcode);
        if (!res || res.type == "unknown") {
            if (this.isNonObbedCache) {
                res = new OpcodeInfo(opcode, opcode, [getClassicImmType(opcode)]);
                this.mappings.set(opcode, res);
                this.decodedMappings.set(opcode, res);
            } else {
                //TODO do this guess somewhere else
                // throw new Error("op type not resolved: 0x" + opcode.toString(16));
                if (res) {
                    res.type = "byte";
                    res.possibleTypes = new Set(res.type as any);
                } else {
                    res = this.declareOp(opcode, ["byte"]);
                }
                console.log(`op type not resolved: 0x${opcode.toString(16)} (opid:${res.id}), guessing imm type byte`);
            }
        }

        let imm = parseImm(state.buffer, state.scan, res.type as ImmediateType);
        if (!imm) { throw new Error("failed to read immidiate"); }
        state.scan = imm.offset;

        let opname = getOpName(res.id);

        return { opcode: res.id, imm: imm.imm, imm_obj: imm.imm_obj, opname } satisfies ClientScriptOp;
    }
    getClientVarMeta(varint: number) {
        let groupid = (varint >> 24) & 0xff;
        let varid = (varint >> 8) & 0xffff;
        let group = this.varmeta.get(groupid);
        let varmeta = group?.vars.get(varid);
        if (!group || !varmeta) { return null; }
        let fulltype = varmeta.type;
        let type = typeToPrimitive(fulltype);
        return { name: group.name, varid, type, fulltype };
    }
    getNamedOp(id: number) {
        let opinfo = this.decodedMappings.get(id);
        if (!opinfo) { throw new Error(`op with named id ${id} not found`); }
        return opinfo;
    }
}

function copyOpcodesFrom(deob: ClientscriptObfuscation, refcalli: ReferenceCallibration) {
    let candidates = deob.candidates;
    let newbuildnr = deob.source.getBuildNr();

    deob.opidcounter = refcalli.opidcounter;
    let testCandidate = (cand: ScriptCandidate, refops: ClientScriptOp[]) => {
        if (cand.script.instructioncount != refops.length) {
            return false;
        }
        let unconfirmed = new Map<number, OpreadInstance>();
        let offset = 0;
        let buf = cand.script.opcodedata;
        for (let i = 0; i < cand.script.instructioncount; i++) {
            let refopinfo = refcalli.decodedMappings.get(refops[i].opcode);
            if (!refopinfo || refopinfo.type == "unknown") { return false; }
            let refop = cannonicalOp(refops[i], refcalli.buildnr, refopinfo.type);

            if (buf.byteLength < offset + 2) { return false; }
            let opid = buf.readUint16BE(offset);
            offset += 2;
            let imm = parseImm(buf, offset, refop.immtype);
            if (!imm) { return false; }
            offset = imm.offset;
            let op: ClientScriptOp = { opcode: refop.opcode, imm: imm.imm, imm_obj: imm.imm_obj };
            if (!isOpEqual(cannonicalOp(op, newbuildnr, refop.immtype), refop)) { return false; }
            unconfirmed.set(opid, refop);
        }
        if (offset != buf.byteLength) {
            return false;
        }
        cand.didmatch = true;
        for (let [k, v] of unconfirmed) {
            let info = new OpcodeInfo(k, v.opcode, [v.immtype]);
            deob.mappings.set(k, info);
            deob.decodedMappings.set(v.opcode, info);
        }
        return true;
    }

    for (let [index, ref] of refcalli.scripts.entries()) {
        let cand = candidates.get(ref.id);
        if (!cand) { continue; }
        testCandidate(cand, ref.scriptops);
    }
    deob.opidcounter = refcalli.opidcounter;
    console.log(`copied ${deob.mappings.size} opcodes from reference cache, idcount:${deob.opidcounter}`);
}

function findOpcodeImmidiates(calli: ClientscriptObfuscation) {
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

                //TODO very wasteful n^2 going on here, take it out of loop?
                let nswitch = 0;
                let ntribyte = 0;
                for (let op of calli.mappings.values()) {
                    if (op.type == "switch") { nswitch++; }
                    if (op.type == "tribyte") { ntribyte++; }
                }
                if (!switchcompleted && nswitch == 1) { switchcompleted = true; console.log("switch completed"); }
                if (!tribytecompleted && ntribyte == 2) { tribytecompleted = true; console.log("tribyte completed"); }
                if (nswitch > 1) { throw new Error(""); }
                if (ntribyte > 2) { throw new Error(""); }

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


    calli.foundEncodings = true;

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

function callibrateOperants(calli: ClientscriptObfuscation, candidates: Map<number, ScriptCandidate>) {
    //TODO merge with previous loop?
    let allsections: CodeBlockNode[] = [];
    for (let cand of candidates.values()) {
        if (!cand.scriptcontents) { continue }
        let { sections } = generateAst(calli, cand.script, cand.scriptcontents.opcodedata, cand.id);
        allsections.push(...sections);
    }
    allsections.sort((a, b) => a.children.length - b.children.length);
    globalThis.allsections = allsections;//TODO remove

    let testSection = (eq: StackDiffEquation) => {
        let { section, unknowns } = eq;

        //scan through the ops from front to back
        let frontstack = new StackList();
        //TODO currently unused
        let frontstackconsts = new StackConstants();
        for (let i = 0; i < section.children.length; i++) {
            let node = section.children[i];
            if (!(node instanceof RawOpcodeNode) || node.unknownstack) { break; }
            if (node.knownStackDiff) {
                frontstack.pop(node.knownStackDiff.in);
                frontstack.push(node.knownStackDiff.out);

                frontstackconsts.popList(node.knownStackDiff.in);
                if (node.knownStackDiff.constout != null) {
                    frontstackconsts.pushOne(node.knownStackDiff.constout);
                } else {
                    frontstackconsts.pushList(node.knownStackDiff.out);
                }
            } else {
                let info = node.opinfo.stackinfo;
                if (!info.initializedin) {
                    info.in = frontstack.clone();
                    info.initializedin = true;
                } else {
                    let shortage = frontstack.tryPop(info.in);
                    if (shortage > 0) {
                        if (info.initializedthrough) {
                            if (info.out.tryPopReverse(info.in, info.in.values.length - shortage) != 0) {
                                throw new Error("not compatible");
                            }
                        }
                        info.in.values.splice(0, shortage);
                    }
                    frontstackconsts.popList(info.in);
                }
                if (!info.initializedthrough || !info.initializedout) {
                    break;
                }
                frontstack.push(info.out);
                frontstackconsts.pushList(info.out);
            }
        }

        //scan through the ops from back to front
        let backstack = new StackList();
        for (let i = 0; i < section.children.length; i++) {
            let node = section.children[section.children.length - 1 - i];
            if (!(node instanceof RawOpcodeNode) || node.unknownstack) { break; }

            if (node.knownStackDiff) {
                backstack.pop(node.knownStackDiff.out);
                backstack.push(node.knownStackDiff.in);
            } else {
                let info = node.opinfo.stackinfo;
                if (!info.initializedout) {
                    info.out = backstack.clone();
                    info.initializedout = true;
                } else {
                    let shortage = backstack.tryPop(info.out);
                    if (shortage > 0) {
                        if (info.initializedthrough) {
                            if (info.in.tryPopReverse(info.out, info.out.values.length - shortage) != 0) {
                                throw new Error("not compatible");
                            }
                        }
                        info.out.values.splice(0, shortage);
                    }
                }
                if (!info.initializedthrough || !info.initializedin) {
                    break;
                }
                backstack.push(info.in);
            }
        }

        let unkcount = 0;
        let unktype: OpcodeInfo | null = null;
        let totalstack = 0;
        let hasproblemops = false;
        unknowns.clear();
        for (let child of section.children) {
            if (!(child instanceof RawOpcodeNode) || child.unknownstack) {
                hasproblemops = true;
                break;
            }
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
        if (!hasproblemops && !unktype && totalstack != 0) { throw new Error("total stack doesn't add up to 0"); }
        if (!hasproblemops && unktype && unknowns.size == 1) {
            if (posmod(totalstack, unkcount) != 0) { throw new Error("stack different is not evenly dividable between equal ops"); }
            let diffeach = totalstack / unkcount + unktype.stackinfo.totalChange();
            //might fail if order at front of stack is unknown
            let success = true;
            if (diffeach > 0) {
                success = unktype.stackinfo.out.tryShift(diffeach);
            } else if (diffeach < 0) {
                success = unktype.stackinfo.in.tryShift(-diffeach);
            }
            if (success) {
                unktype.stackinfo.initializedthrough = true;
                unknowns.delete(unktype);
                foundset.add(unktype.id);
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
    }

    let opmap = new Map<number, Set<StackDiffEquation>>();
    let pendingEquations: StackDiffEquation[] = [];
    let foundset = new Set<number>();
    for (let section of allsections) {
        let eq: StackDiffEquation = { section, unknowns: new Set() };
        for (let op of section.children) {
            if (op instanceof RawOpcodeNode) {
                op.opinfo.stackChangeConstraints.add(eq);
            }
        }
        testSection(eq);
        pendingEquations.push(eq);
    }
    for (let i = 0; i < 3; i++) {
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
    calli.foundParameters = true;
}

export function getArgType(script: clientscriptdata | clientscript) {
    let res = new StackDiff();
    res.int = script.intargcount;
    res.long = script.longargcount;
    res.string = script.stringargcount;
    return res;
}

export function getReturnType(calli: ClientscriptObfuscation, ops: ClientScriptOp[], endindex = ops.length) {
    let res = new StackList();
    //the jagex compiler appends a default return with null constants to the script, even if this would be dead code
    //endindex-1=return, pushconsts begins at -2
    for (let i = endindex - 2; i >= 0; i--) {
        let op = ops[i];
        let opinfo = calli.getNamedOp(op.opcode);
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
    res.values.reverse();
    return res;
}

//TODO remove/hide
globalThis.getop = (opid: string) => {
    let id = -1;
    //don't use match because it breaks console hints
    if (opid.startsWith("unk")) {
        id = +opid.slice(3);
    } else {
        for (let op in knownClientScriptOpNames) {
            if (knownClientScriptOpNames[op] == opid) {
                id = +op;
            }
        }
    }
    let calli: ClientscriptObfuscation = globalThis.deob;
    return calli.decodedMappings.get(id);
};

function firstKey<T>(map: Map<T, any>) {
    return map.keys().next().value as T;
}
