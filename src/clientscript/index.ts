import { TsWriterContext } from "./typescript/codewriter";
import { parseClientScriptIm } from "./ast";
import { ClientscriptObfuscation } from "./callibration/callibrator";
import { CacheFileSource } from "../cache";
import { parseClientscriptTs } from "./typescript/codeparser";
import { parse } from "../parser/jsondecoders";
import { astToImJson } from "./jsonwriter";
import { clientscript } from "../../generated/clientscript";
import { crc32, crc32addInt } from "../libs/crc32util";
import { CLIScriptOutput, ScriptOutput } from "../scriptrunner";
// import { Openrs2CacheSource } from "../cache/openrs2loader";
// import { GameCacheLoader } from "../cache/sqlite";

export { writeClientVarFile, writeOpcodeFile } from "./typescript/codewriter";

export async function compileClientScript(source: CacheFileSource, code: string) {
    let calli = await ClientScriptDeobLoader.forCache(source).loadOrGenerate(source);

    let parseresult = parseClientscriptTs(calli, code);
    if (!parseresult.success) { throw new Error("failed to parse clientscript", { cause: parseresult.failedOn }); }
    if (parseresult.remaining != "") { throw new Error("failed to parse clientscript, left over: " + parseresult.remaining.slice(0, 100)); }
    return astToImJson(calli, parseresult.result);
}

export async function renderClientScript(source: CacheFileSource, buf: Buffer, fileid: number, relativeComps = false, notypes = false, int32casts = false) {
    let calli = await ClientScriptDeobLoader.forCache(source).loadOrGenerate(source);
    let script = parse.clientscript.read(buf, source);
    let { rootfunc, sections, typectx } = parseClientScriptIm(calli, script, fileid);
    // globalThis[`cs${fileid}`] = rootfunc;//TODO remove

    let writer = new TsWriterContext(calli, typectx);
    if (relativeComps) { writer.setCompOffsets(rootfunc); }
    writer.typescript = !notypes;
    writer.int32casts = int32casts;
    return { writer, rootfunc };
}

export class ClientScriptDeobLoader {
    loaded: ClientscriptObfuscation | null = null;
    loadStoredPromise: Promise<ClientscriptObfuscation | null> | null = null;
    generatePromise: Promise<ClientscriptObfuscation> | null = null;

    constructor(deob?: ClientscriptObfuscation) {
        this.loaded = deob ?? null;
    }

    static forCache(source: CacheFileSource): ClientScriptDeobLoader {
        return source.decodeArgs.clientScriptDeob ??= new ClientScriptDeobLoader();
    }
    static forCacheArgsOrThrow(args: Record<string, any>) {
        let res = args.clientScriptDeob as ClientScriptDeobLoader | undefined;
        if (!res || !res.loaded) { throw new Error("clientScriptDeob not set in args"); }
        return res.loaded;
    }

    getOrThrow() {
        if (!this.loaded) { throw new Error("clientscript deob not loaded yet"); }
        return this.loaded;
    }

    tryLoadStored(source: CacheFileSource) {
        if (this.loaded) { return this.loaded; }
        if (this.generatePromise) { return this.generatePromise; }
        this.loadStoredPromise ??= (async () => {
            let deob = await ClientscriptObfuscation.tryLoadCached(source).catch(() => null);
            if (deob) {
                this.loaded = deob;
                globalThis.deob = deob;
            }
            return deob;
        })();
        return this.loadStoredPromise;
    }

    async loadOrGenerate(source: CacheFileSource, makeScriptOutput?: () => Promise<ScriptOutput>) {
        if (this.loadStoredPromise) { await this.loadStoredPromise; }
        if (this.loaded) { return this.loaded; }
        this.generatePromise ??= (async () => {
            let deob = await ClientscriptObfuscation.create(source);
            let scriptctx = (makeScriptOutput ? await makeScriptOutput() : new CLIScriptOutput());
            await scriptctx.run(out => deob.runAutoCallibrate(out, source));
            if (scriptctx.state != "done") {
                this.generatePromise = null;
                throw new Error("failed to run auto callibration");
            } else {
                this.loaded = deob;
                globalThis.deob = deob;
            }
            return deob;
        })();
        return this.generatePromise;
    }
}

export function clientscriptHash(script: clientscript) {
    let hash = 0;
    hash = crc32addInt(script.byte0, hash);

    hash = crc32addInt(script.intargcount, hash);
    hash = crc32addInt(script.longargcount, hash);
    hash = crc32addInt(script.stringargcount, hash);

    hash = crc32addInt(script.localintcount, hash);
    hash = crc32addInt(script.locallongcount, hash);
    hash = crc32addInt(script.localstringcount, hash);

    hash = crc32addInt(script.instructioncount, hash);
    for (let op of script.opcodedata) {
        hash = crc32addInt(op.opcode, hash);
        hash = crc32addInt(op.imm, hash);
        if (op.imm_obj == null) { }
        else if (typeof op.imm_obj == "number") { hash = crc32addInt(op.imm_obj, hash); }
        else if (Array.isArray(op.imm_obj)) { hash = crc32addInt(op.imm_obj[0], hash); hash = crc32addInt(op.imm_obj[1], hash); }
        else if (typeof op.imm_obj == "string") { hash = crc32(Buffer.from(op.imm_obj, "latin1"), hash); }
        else { throw new Error("unexpected"); }
    }

    hash = crc32addInt(script.switchsize, hash);
    for (let sub of script.switches) {
        hash = crc32addInt(sub.length, hash);
        for (let choice of sub) {
            hash = crc32addInt(choice.value, hash);
            hash = crc32addInt(choice.jump, hash);
        }
    }
    return hash;
}

// export async function writeExtendedRuntimeScripts(source: CacheFileSource) {
//     let calli = await prepareClientScript(source);

//     let missingruntimes = new Map<string, { scriptid: number, ast: ReturnType<typeof generateAst> } | null>(Object.keys(runtimeFuncs).map(q => [q, null]));
//     let targetin = new StackDiff(1, 0, 0);
//     let candidates: { scriptid: number, script: clientscript, ast: ReturnType<typeof generateAst> }[] = [];
//     for (let [id, cand] of calli.scriptargs) {
//         if (cand.stack.in.toStackDiff().equals(targetin) && cand.stack.out.isEmpty()) {
//             let script = parse.clientscript.read(await source.getFileById(cacheMajors.clientscript, id), source);
//             let ast = generateAst(calli, script, script.opcodedata, id);
//             let matchcount = 0;
//             for (let sub of ast.subfuncs) {
//                 let runtimeid = missingruntimes.get(sub.scriptname);
//                 if (runtimeid === null) {
//                     missingruntimes.set(sub.scriptname, { scriptid: id, ast });
//                     matchcount++
//                 }
//             }
//             if (matchcount > 1) { throw new Error("multiple runtime funcs in one script, unexpected"); }
//             if (matchcount == 0) {
//                 if (ast.sections.length == 1 && ast.sections[0].children.length<20) {
//                     candidates.push({ scriptid: id, script, ast });
//                     if (candidates.length > missingruntimes.size + 10) { break; }
//                 }
//             }
//         }
//     }

//     for (let [name, meta] of missingruntimes) {
//         if (meta) { continue; }
//         let cand = candidates.shift();
//         if (!cand) { throw new Error("not enough runtime candidate scripts, unexpected"); }
//         let ops =
//     }
// }