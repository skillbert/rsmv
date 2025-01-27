import { enums } from "../../generated/enums";
import { params } from "../../generated/params";
import { structs } from "../../generated/structs";
import { CacheFileSource } from "../cache";
import { cacheConfigPages, cacheMajors } from "../constants";
import { parse } from "../opdecoder";

export async function loadParams(source: CacheFileSource) {
    let paramindex = await source.getArchiveById(cacheMajors.config, cacheConfigPages.params);
    let parammeta = new Map<number, params>();
    for (let file of paramindex) {
        parammeta.set(file.fileid, parse.params.read(file.buffer, source));
    }
    return parammeta;
}

export async function loadEnum(source: CacheFileSource, id: number) {
    return parse.enums.read(await source.getFileById(cacheMajors.enums, id), source);
}

export function getEnumIntPairs(enumjson: enums) {
    return (enumjson.intArrayValue1 ?? enumjson.intArrayValue2?.values)!;
}

export async function loadStruct(source: CacheFileSource, structid: number) {
    return parse.structs.read(await source.getFileById(cacheMajors.structs, structid), source);
}

export function getEnumInt(enumjson: enums, key: number) {
    //TODO changed from -1 to 0 default backup
    return (enumjson.intArrayValue1 ?? enumjson.intArrayValue2?.values)?.find(q => q[0] == key)?.[1] ?? enumjson.intValue ?? 0;
}

export function getEnumString(enumjson: enums, key: number) {
    return (enumjson.stringArrayValue1 ?? enumjson.stringArrayValue2?.values)?.find(q => q[0] == key)?.[1] ?? enumjson.stringValue ?? "";
}

export function getStructInt(paramtable: Map<number, params>, struct: structs | null, paramid: number) {
    let parammeta = paramtable.get(paramid);
    if (!parammeta) { throw new Error(`unkown param ${paramid}`); }

    let match = struct?.extra?.find(q => q.prop == paramid);
    if (!match) { return parammeta.type?.defaultint ?? -1; }
    if (match.intvalue == undefined) { throw new Error("param is not of type int"); }
    return match.intvalue;
}

export function getStructString(paramtable: Map<number, params>, struct: structs | null, paramid: number) {
    let parammeta = paramtable.get(paramid);
    if (!parammeta) { throw new Error(`unkown param ${paramid}`); }

    let match = struct?.extra?.find(q => q.prop == paramid);
    if (!match) { return parammeta.type?.defaultstring ?? ""; }
    if (match.stringvalue == undefined) { throw new Error("param is not of type string"); }
    return match.stringvalue;
}