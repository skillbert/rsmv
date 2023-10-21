import { boundMethod } from "autobind-decorator";
import { clientscript } from "../../generated/clientscript";
import { CacheFileSource } from "../cache";
import { Openrs2CacheSource, openrs2GetEffectiveBuildnr, validOpenrs2Caches } from "../cache/openrs2loader";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { ScriptFS, ScriptOutput } from "../scriptrunner";
import { trickleTasksTwoStep } from "../utils";

type Op = clientscript["opcodes"][number];

const lastNonObfuscatedBuild = 668;
function translateClientScript(script: clientscript, frombuild: number, tobuild: number) {
    let res = {
        ...script,
        opcodes: script.opcodes.slice()
    };

    if (frombuild < 751 && tobuild >= 751) {
        res.opcodes = res.opcodes.map<Op>(q => {
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

function cannonicalOp(operation: Op) {
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
    return { op, imm, imm_obj } as Op
}

function isOpEqual(a: Op, b: Op) {
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
    if (ArrayBuffer.isView(a.imm_obj)) {
        if (!ArrayBuffer.isView(b.imm_obj) || a.imm_obj.length != b.imm_obj.length || !a.imm_obj.every((v, i) => v == (a.imm_obj as Uint8Array)[i])) {
            return false;
        }
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

export class ClientscriptObfuscation {
    mappings = new Map<number, number>();
    allocid = 0x5000;
    callibration = null as {
        unconfirmed: Map<number, number>,
        currentopindex: number,
        refscript: clientscript,
        scriptid: number,
        hadmismatch: boolean
    } | null;
    callibrated = false;
    callibrationFinished: Promise<void> | null = null;
    endCallibration(result: clientscript | null) {
        let oldcali = this.callibration;
        if (!oldcali) { throw new Error("tried to end non-existant clientscript callibration"); }
        this.callibration = null;
        let ref = oldcali.refscript;
        if (!result) { return false; }
        // if (oldcali.hadmismatch) { return false; }
        if (result.opcodes.length != ref.opcodes.length) { return false; }
        for (let i = 0; i < result.opcodes.length; i++) {
            let a = result.opcodes[i];
            let b = ref.opcodes[i];
            if (!isOpEqual(a, b)) { return false; }
        }
        for (let [k, v] of oldcali.unconfirmed) {
            this.mappings.set(k, v);
        }
        return true;
    }
    startCallibrate(refscript: clientscript, scriptid: number) {
        if (this.callibration) {
            throw new Error("already callibrating clientscript");
        }
        this.callibration = {
            unconfirmed: new Map(),
            currentopindex: 0,
            refscript: refscript,
            scriptid: scriptid,
            hadmismatch: false
        }
    }
    static async generateDump(source: CacheFileSource, previousCallibration: ClientscriptObfuscation | null) {
        let index = await source.getCacheIndex(cacheMajors.clientscript);
        let scripts: { id: number, script: clientscript }[] = [];
        await trickleTasksTwoStep(10, function* () {
            for (let row of index) {
                if (!row) { continue; }
                yield source.getFile(row.major, row.minor, row.crc).then(q => [row.minor, q] as const)
            }
        }, ([id, buf]) => {
            try {
                let script = parse.clientscript.read(buf, source, { translateCS2Opcode: previousCallibration?.translateOpcode });
                scripts.push({ id, script });
            } catch (e) { }
        });
        return scripts;
    }
    static async generateReferenceDump() {
        let rootsource = await Openrs2CacheSource.fromId(1383);
        let refsource = await Openrs2CacheSource.fromId(1572);
        let refcalli = new ClientscriptObfuscation();
        await refcalli.runCallibrationFrom(refsource, rootsource, null);

        //specific 3 byte ops with special cases in the parser
        refcalli.mappings.set(0x0314, 0x4102);
        refcalli.mappings.set(0x025d, 0x4103);

        //opcodes with unknown original opcode, but still in the id<0x80 range so they have 4 byte imm
        let specialReferenceOps = [0x0023, 0x003b, 0x003f, 0x00a4, 0x00a8, 0x00f6, 0x0175, 0x01a0, 0x022f, 0x0273, 0x02c2, 0x033a, 0x0374, 0x03a1, 0x0456, 0x04ea, 0x04f4, 0x0501, 0x0559, 0x059d, 0x0676, 0x072d, 0x077d, 0x0798, 0x07a0, 0x07d8, 0x080f, 0x0838];
        for (let [i, op] of specialReferenceOps.entries()) {
            if (refcalli.mappings.get(op) == undefined) {
                refcalli.mappings.set(op, 0x4010 + i);
            }
        }

        return {
            buildnr: refsource.getBuildNr(),
            dump: await ClientscriptObfuscation.generateDump(refsource, refcalli)
        };
    }
    async runAutoCallibrate(source: CacheFileSource) {
        let ref = await ClientscriptObfuscation.generateReferenceDump();
        await this.runCallibration(source, ref.dump, ref.buildnr);
    }
    async runCallibrationFrom(currentsource: CacheFileSource, referenceSource: CacheFileSource, previousCallibration: ClientscriptObfuscation | null) {
        let refscript = await ClientscriptObfuscation.generateDump(referenceSource, previousCallibration);
        await this.runCallibration(currentsource, refscript, referenceSource.getBuildNr());
    }
    async runCallibration(source: CacheFileSource, refscripts: { id: number, script: clientscript }[], refbuildnr: number) {
        let convertedref = refscripts.map(q => ({
            ...q,
            script: translateClientScript(q.script, refbuildnr, source.getBuildNr())
        }));

        let index = await source.getCacheIndex(cacheMajors.clientscript);

        let candidates: { meta: { id: number, script: clientscript }, buf: Buffer }[] = [];
        await trickleTasksTwoStep(10, function* () {
            for (let meta of convertedref) {
                let row = index[meta.id];
                if (!row) { continue; }
                yield source.getFile(row.major, row.minor, row.crc).then(buf => ({ meta, buf }) as const)
            }
        }, q => candidates.push(q));
        let iter = async () => {
            for (let { meta, buf } of candidates) {
                this.startCallibrate(meta.script, meta.id);
                let res: clientscript | null = null;
                try {
                    res = parse.clientscript.read(buf, source, { translateCS2Opcode: this.translateOpcode });
                } catch (e) {
                    let a = 1;
                }
                this.endCallibration(res);
            };
            this.callibrated = true;
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
    }
    @boundMethod
    translateOpcode(op: number, buildnr: number) {
        if (buildnr <= lastNonObfuscatedBuild) {
            return op;
        }
        if (this.callibration) {
            let opindex = this.callibration.currentopindex++;
            let res = this.mappings.get(op);
            if (typeof res == "number") {
                return res;
            }
            let match = this.callibration.refscript.opcodes[opindex];
            if (!match) {
                throw new Error("no matching refernce opcode");
            }
            let prevunconf = this.callibration.unconfirmed.get(op);
            if (prevunconf != undefined && prevunconf != match.op) {
                this.callibration.hadmismatch = true;
            }
            this.callibration.unconfirmed.set(op, match.op);
            return match.op;
        } else {
            let res = this.mappings.get(op);
            if (res == undefined) {
                let newop = this.allocid++;
                this.mappings.set(op, newop);
                res = newop;
                // throw new Error("deobfuscated opcode not availabe for 0x" + op.toString(16).padStart(4, "0"));
                //TODO
                // return op;
            }
            return res;
        }
    }
}

export async function testDeobHistoric(output: ScriptOutput, fs: ScriptFS) {
    let versions = (await validOpenrs2Caches()).slice().reverse();
    let lastnonobbed = versions.findLastIndex(q => openrs2GetEffectiveBuildnr(q) <= lastNonObfuscatedBuild);

    let lastopencache = new Openrs2CacheSource(versions[lastnonobbed]);
    let lastdump = await ClientscriptObfuscation.generateDump(lastopencache, null);
    let lastversion = lastopencache.getBuildNr();
    let lastcacheid = lastopencache.meta.id;
    for (let i = lastnonobbed + 1; i < versions.length; i++) {
        let cachemeta = versions[i];
        let cache = new Openrs2CacheSource(cachemeta);

        let deob = new ClientscriptObfuscation();
        await deob.runCallibration(cache, lastdump, lastversion);
        output.log(`${cache.getBuildNr()} (openrs2:${cachemeta.id}) matched mappings: ${deob.mappings.size}`);
        let outfile = `buildnr: ${lastversion}->${cache.getBuildNr()}\n`
            + `openrs2: ${lastcacheid}->${cachemeta.id}\n`
            + `matched mappings: ${deob.mappings.size}\n`
            + `\n`
            + [...deob.mappings]
                .sort((a, b) => a[1] - b[1])
                .map(q => `${q[1].toString(16)}\t${q[0].toString(16)}`)
                .join("\n");
        await fs.writeFile(`mappings_${cache.getBuildNr()}_openrs2-${cachemeta.id}.txt`, outfile);
        lastdump = await ClientscriptObfuscation.generateDump(cache, deob);
        lastversion = cache.getBuildNr();
        lastcacheid = cachemeta.id;
    }
}

async function findOpcodeImmidiates(source: CacheFileSource) {
    type ScriptCandidate = { id: number, succeeded: boolean, buf: Buffer, unknowninstruction: number };
    let index = await source.getCacheIndex(cacheMajors.clientscript);
    let candidates: ScriptCandidate[] = [];
    await trickleTasksTwoStep(10, function* () {
        for (let entry of index) {
            if (!entry) { continue; }
            yield source.getFile(entry.major, entry.minor, entry.crc).then(buf => ({
                id: entry.minor,
                succeeded: false,
                unknowninstruction: -1,
                buf
            }) as ScriptCandidate);
        }
    }, q => candidates.push(q));

    const immediates = ["byte", "int", "tribyte", "string", "long", "switch"] as const;

    type ImmediateType = typeof immediates[number];
    const opclass: Record<ImmediateType, number> = {
        int: 0x00,
        string: 0x03,
        long: 0x36,
        byte: 0x81,
        switch: 0x4101,
        tribyte: 0x4102
    }

    type OpcodeInfo = {
        id: number,
        generation: number,
        immediateType: ImmediateType | "unknown",
        maxstackpop: number
    }

    let mappings = new Map<number, OpcodeInfo>();
    let getmapping = (id: number) => {
        let res = mappings.get(id);
        if (!res) {
            res = { id, immediateType: "unknown", generation: 0, maxstackpop: 1e3 };
            mappings.set(id, res);
        }
        return res;
    }
    let translateknown = (op: number) => {
        let match = mappings.get(op);
        if (match && match.immediateType != "unknown") {
            return opclass[match.immediateType];
        }
        return -1;
    }

    candidates.sort((a, b) => a.buf.byteLength - b.buf.byteLength);

    // first round, pick low hanging fruit by running all scripts that have only 1 byte opcodes
    let previoussuccesses = 0;
    let previousopcodes = 0;
    let generation = 0;
    let runfixedaddition = (type: ImmediateType, maxsize: number) => {
        generation++;
        let fourbytegetter = (op: number, buildnr: number, bytesleft: number, instructioncount: number) => {
            originalops.push(op);
            let res = translateknown(op);
            if (res != -1) { return res; }
            if (firstunknown == -1) { firstunknown = op; }
            fillops.add(op);
            return opclass[type];
        }
        let originalops: number[] = [];
        let firstunknown = -1;
        let successes = 0;
        let contradictions = 0;
        let fillops = new Set<number>();
        candidateloop: for (let cand of candidates) {
            if (cand.buf.byteLength > maxsize) { break; }
            // if (cand.unknowninstruction != -1 && !mappings.has(cand.unknowninstruction)) { continue; }
            // if (cand.succeeded) {
            //     successes++;
            //     continue;
            // }
            let res: clientscript | null = null;
            for (let isretry of [false, true]) {
                originalops.length = 0;
                fillops.clear();
                firstunknown = -1;
                try {
                    res = parse.clientscript.read(cand.buf, source, { translateCS2Opcode: fourbytegetter });
                } catch (e) { }
                if (!res) {
                    if (fillops.size == 0) {
                        // console.log(`contradiction detected at script ${cand.id}, resetting opcodes ${originalops.join()}`);
                        contradictions++;
                        for (let op of fillops) {
                            let opobj = mappings.get(op);
                            if (opobj && opobj.generation >= generation) {
                                //todo
                            }
                        }
                        continue;
                    }
                }
            }
            cand.unknowninstruction = firstunknown;
            if (!res) { continue candidateloop; }
            successes++;
            if (fillops.size != 1) { continue candidateloop; }
            //when detecting ints one of the first 3 bytes must contain a 0x00 to ensure we aren't matching a string
            if (type == "int" && !res.opcodes.every((q, i) => {
                let entry = mappings.get(originalops[i]);
                return !entry || ((q.imm >> 24) & 0xff) == 0 || ((q.imm >> 16) & 0xff) == 0 || ((q.imm >> 8) & 0xff) == 0
            })) {
                continue;
            }

            for (let op of fillops) {
                let mapping = getmapping(op);
                if (mapping.immediateType != "unknown") { debugger; }
                mapping.immediateType = type;
                mapping.generation = generation;
                // console.log(`found op ${op.toString(16)} ${type} in script ${cand.id}`);
            }
            cand.succeeded = true;
        }
        let newfound = mappings.size - previousopcodes;
        if (contradictions != 0) {
            console.log(`contradictions ${contradictions}`);
        }
        console.log(`${type} opcode run succeeded ${successes}/${candidates.length} (+${successes - previoussuccesses}) scripts, found ${newfound} opcodes`);
        previoussuccesses = successes;
        previousopcodes = mappings.size;
        return newfound;
    }

    runfixedaddition("byte", 50);
    runfixedaddition("int", 100);
    runfixedaddition("byte", 500);
    runfixedaddition("int", 500);
    for (let i = 0; i < 20; i++) {
        let found = 0;
        for (let type of ["byte", "int", "switch"] satisfies ImmediateType[]) {
            found += runfixedaddition(type, 1e10);
        }
        if (found == 0) { break; }
    }

    let testGetter = (op: number, buildnr: number) => {
        let res = translateknown(op);
        if (res == -1) { throw new Error("unknown op"); }
        return res;
    }

    globalThis.testOpcodeGetter = testGetter;

    console.log([...mappings].sort((a, b) => a[0] - b[0]).map(q => [q[0].toString(16), q[1].immediateType]));

    return mappings;
}

// globalThis.findOpcodeImmidiates = findOpcodeImmidiates;

async function findOpcodeImmidiates2(source: CacheFileSource) {
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
    type ScriptCandidate = { id: number, succeeded: boolean, buf: Buffer, unknowninstruction: number };

    class Opcode {
        id: number;
        possibleTypes = immediates.slice();
        theories: Theory[] = [];
        constructor(id: number) {
            this.id = id;
        }
    }


    class SolveContext {
        ops: Map<number, Opcode>;
        unconfirmedops = new Map<number, Opcode>();
        theories: Theory[] = [];
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

    class Theory {
        context: SolveContext;
        // opsleft: number;
        // opoffset: number;
        opid: number;
        op: Opcode;
        optype: ImmediateType;
        parent: Theory | null = null;
        linkedTheory: Theory;
        children: Theory[] = []
        isDisproven = false;
        activeBranch: Theory | null = null;
        childrenAdded = false;
        childrenCompleted = true;
        constructor(context: SolveContext, opid: number, type: ImmediateType) {
            this.context = context;
            this.opid = opid;
            this.optype = type;
            this.linkedTheory = this;
            this.op = this.context.getOp(opid);
        }
        getnext(opid: number) {
            if (this.childrenCompleted) {
                let linkedTheory: Theory | null = this;
                while (linkedTheory) {
                    if (linkedTheory.opid == opid) { break; }
                    linkedTheory = linkedTheory.parent;
                }
                let options = (linkedTheory ? [linkedTheory.optype] : this.context.getOp(opid).possibleTypes);
                let type = options.find(q => !this.children.some(w => w.optype == q));
                let lasttype = options.findLast(q => !this.children.some(w => w.optype == q));
                this.childrenAdded = (type == lasttype);
                if (!type) {
                    this.childrenAdded = true;
                    throw new Error("already complete");
                }
                let child = new Theory(this.context, opid, type);
                child.parent = this;
                child.linkedTheory = linkedTheory ?? child;
                this.children.push(child);
                this.activeBranch = child;
                this.isDisproven = false;
                this.childrenCompleted = false;
                return child;
            } else {
                if (!this.activeBranch) {
                    throw new Error("shouldnt happen");
                }
                return this.activeBranch;
            }
        }
        completed() {
            this.childrenAdded = true;
            //unroll recursion into loop since it might overflow stack
            for (let target: Theory | null = this; target; target = target.parent) {
                if (!target.children.every(q => q.childrenCompleted)) {
                    break;
                }
                target.childrenCompleted = true;
                if (!target.childrenAdded) {
                    break;
                }
            }
        }
        disproven() {
            //unroll recursion into loop since it might overflow stack
            for (let target: Theory | null = this; target; target = target.parent) {
                if (!target.childrenCompleted || !target.childrenAdded || !target.children.every(q => q.isDisproven)) {
                    break;
                }
                target.isDisproven = true;
            }
        }
        log(indent = 0) {
            let res = `${"\t".repeat(indent)}${this.optype} ${this.opid == -1 ? "root" : this.opid.toString(16).padStart(4, "0")} ${this.childrenAdded ? "added" : "missing"} ${this.childrenCompleted ? "complete" : "incomplete"} ${this.isDisproven ? "disproven" : "possible"}\n`
                + this.children.map(q => q.log(indent + 1)).join("");
            return res;
        }
    }
    let index = await source.getCacheIndex(cacheMajors.clientscript);
    let candidates: ScriptCandidate[] = [];
    await trickleTasksTwoStep(10, function* () {
        for (let entry of index) {
            if (!entry) { continue; }
            yield source.getFile(entry.major, entry.minor, entry.crc).then(buf => ({
                id: entry.minor,
                succeeded: false,
                unknowninstruction: -1,
                buf
            }) as ScriptCandidate);
        }
    }, q => candidates.push(q));

    candidates.sort((a, b) => a.buf.byteLength - b.buf.byteLength);
    let mappings = new Map<number, Opcode>();
    let zeroop = new Opcode(0);
    zeroop.possibleTypes = ["byte"];
    mappings.set(0, zeroop);

    let runtheories = (cand: ScriptCandidate) => {
        let context = new SolveContext(mappings);
        let roottheory = new Theory(context, -1, "int");
        let currentTheory = roottheory;
        let getter = (op: number, buildnr: number, bytesleft: number, instructioncount: number) => {
            currentTheory = currentTheory.getnext(op);
            return opclass[currentTheory.optype];
        }
        let attempts = 0;
        while (!roottheory.childrenAdded || !roottheory.childrenCompleted) {
            if (attempts++ > 500) { return; }
            currentTheory = roottheory;
            let res: clientscript | null = null;
            try {
                res = parse.clientscript.read(cand.buf, source, { translateCS2Opcode: getter });
            } catch (e) { }
            currentTheory.completed();
            if (!res) {
                currentTheory.disproven();
            }
            let qq = 1;
        }
        if (roottheory.isDisproven) {
            throw new Error("root theory disproven somehow");
        }
        let branch: Theory = roottheory;
        while (branch.children.length != 0) {
            let nvalids = 0;
            let op = branch.children[0].op;
            let nextchild: Theory | null = null;
            for (let sub of branch.children) {
                if (!sub.isDisproven) {
                    nvalids++
                    nextchild = sub;
                } else {
                    let index = op.possibleTypes.indexOf(sub.optype);
                    if (index != -1) { op.possibleTypes.splice(index, 1); }
                }
            }
            if (nvalids >= 1) {
                if (branch != roottheory) {
                    mappings.set(branch.opid, branch.op);
                }
                if (nvalids == 1) {
                    branch = nextchild!;
                } else {
                    cand.unknowninstruction = op.id;
                    break;
                }
            } else {
                throw new Error("unexpected");
            }
        }
    }

    let runfixedaddition = () => {
        for (let limit of [60, 60, 60, 60, 60, 60, 60, 70, 80, 90, 100, 110, 150, 200, 500, 1e10]) {
            console.log(limit, mappings.size);
            for (let cand of candidates) {
                if (cand.buf.byteLength > limit) { break; }
                runtheories(cand);
            }
        }
    }

    runfixedaddition();

    let testGetter = (op: number, buildnr: number) => {
        let res = mappings.get(op);
        if (!res) { throw new Error("unknown op"); }
        if (res.possibleTypes.length != 1) { throw new Error("op type not resolvedd"); }
        return opclass[res.possibleTypes[0]];
    }

    globalThis.testOpcodeGetter = testGetter;

    console.log([...mappings].sort((a, b) => a[0] - b[0]).map(q => [q[0].toString(16), q[1].possibleTypes.join(",")]));

    return mappings;
}

globalThis.findOpcodeImmidiates = findOpcodeImmidiates2;