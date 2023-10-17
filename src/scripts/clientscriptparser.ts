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
                let script = parse.clientscript.read(buf, source, { clientscriptCallibration: previousCallibration });
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
                    res = parse.clientscript.read(buf, source, { clientscriptCallibration: this });
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