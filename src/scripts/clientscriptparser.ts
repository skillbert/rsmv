import { clientscript } from "../../generated/clientscript";
import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { trickleTasksTwoStep } from "../utils";

export class ClientscriptObfuscation {
    mappings = new Map<number, number>();
    callibration = null as {
        unconfirmed: Map<number, number>,
        currentopindex: number,
        refscript: clientscript,
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
        if (oldcali.hadmismatch) { return false; }
        if (result.opcodes.length != ref.opcodes.length) { return false; }
        for (let i = 0; i < result.opcodes.length; i++) {
            let a = result.opcodes[i];
            let b = ref.opcodes[i];
            if (a.op != b.op) { return false; }
            if (a.imm != b.imm) { return false; }
            if (typeof a.imm_obj != typeof b.imm_obj) { return false; }
            if (ArrayBuffer.isView(a.imm_obj)) {
                if (!ArrayBuffer.isView(b.imm_obj) || a.imm_obj.length != b.imm_obj.length || !a.imm_obj.every((v, i) => v == (a.imm_obj as Uint8Array)[i])) {
                    return false;
                }
            } else if (a.imm_obj != b.imm_obj) { return false; }
        }
        for (let [k, v] of oldcali.unconfirmed) {
            this.mappings.set(k, v);
        }
        return true;
    }
    startCallibrate(refscript: clientscript) {
        if (this.callibration) {
            throw new Error("already callibrating clientscript");
        }
        this.callibration = {
            unconfirmed: new Map(),
            currentopindex: 0,
            refscript: refscript,
            hadmismatch: false
        }
    }
    async generateDump(source: CacheFileSource) {
        let index = await source.getCacheIndex(cacheMajors.clientscript);
        let scripts: { id: number, script: clientscript }[] = [];
        await trickleTasksTwoStep(16, function* () {
            for (let row of index) {
                if (!row) { continue; }
                yield source.getFile(row.major, row.minor, row.crc).then(q => [row.minor, q] as const)
            }
        }, ([id, buf]) => {
            scripts.push({
                id,
                script: parse.clientscript.read(buf, source, { clientscriptCallibration: this })
            });
        });
        return scripts;
    }
    runCallibration(source: CacheFileSource, refscripts: { id: number, script: clientscript }[]) {
        this.callibrationFinished ??= (async () => {
            let index = await source.getCacheIndex(cacheMajors.clientscript);
            await trickleTasksTwoStep(16, function* () {
                for (let scriptmeta of refscripts) {
                    let row = index[scriptmeta.id];
                    if (!row) { continue; }
                    yield source.getFile(row.major, row.minor, row.crc).then(buf => [scriptmeta, buf] as const)
                }
            }, ([meta, buf]) => {
                this.startCallibrate(meta.script);
                let res: clientscript | null = null;
                try {
                    res = parse.clientscript.read(buf, source, { clientscriptCallibration: this });
                } catch (e) {
                    let a = 1;
                }
                this.endCallibration(res);
            });
            this.callibrated = true;
        })();
        return this.callibrationFinished;
    }
    translateOpcode(op: number) {
        if (this.callibration) {
            let match = this.callibration.refscript.opcodes[this.callibration.currentopindex++];
            if (!match) {
                this.callibration.hadmismatch = true;
                return op;
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
                // throw new Error("unknown opcode");
                //TODO
                return op;
            }
            return res;
        }
    }
}