import { TsWriterContext } from "./codewriter";
import { astToImJson, parseClientScriptIm } from "./ast";
import { ClientscriptObfuscation } from "./callibrator";
import { CacheFileSource } from "../cache";
import { clientscriptParser } from "../clientscript/codeparser";
import { parse } from "../opdecoder";

export { writeClientVarFile, writeOpcodeFile } from "../clientscript/codeparser";

export async function compileClientScript(source: CacheFileSource, code: string) {
    let calli = await prepareClientScript(source);

    let parseresult = clientscriptParser(calli).runparse(code);
    if (!parseresult.success) { throw new Error("failed to parse clientscript", { cause: parseresult.failedOn }); }
    if (parseresult.remaining != "") { throw new Error("failed to parse clientscript, left over: " + parseresult.remaining.slice(0, 100)); }
    return astToImJson(calli, parseresult.result);
}

export async function renderClientScript(source: CacheFileSource, buf: Buffer, fileid: number) {
    let calli = await prepareClientScript(source);
    let script = parse.clientscript.read(buf, source);
    let full = true;//TODO remove
    let { func, sections, typectx } = parseClientScriptIm(calli, script, fileid, full);
    globalThis[`cs${fileid}`] = func;//TODO remove

    let writer = new TsWriterContext(calli, typectx);

    let res = "";
    if (full) {
        res += writer.getCode(func);
    } else {
        sections.forEach(q => res += writer.getCode(q));
    }
    return res;
}

export async function prepareClientScript(source: CacheFileSource) {
    if (!source.decodeArgs.clientScriptDeob) {
        let deob = await ClientscriptObfuscation.create(source);
        source.decodeArgs.clientScriptDeob = deob;
        await deob.runAutoCallibrate(source);
        globalThis.deob = deob;//TODO remove
    }
    return source.decodeArgs.clientScriptDeob as ClientscriptObfuscation;
}