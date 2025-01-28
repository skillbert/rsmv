import { cacheConfigPages } from "../constants";
import { rs3opnames } from "./opnames";

export const variableSources = {
    player: { key: 0, index: cacheConfigPages.varplayer },
    npc: { key: 1, index: cacheConfigPages.varnpc },
    client: { key: 2, index: cacheConfigPages.varclient },
    world: { key: 3, index: cacheConfigPages.varworld },
    region: { key: 4, index: cacheConfigPages.varregion },
    object: { key: 5, index: cacheConfigPages.varobject },
    clan: { key: 6, index: cacheConfigPages.varclan },
    clansettings: { key: 7, index: cacheConfigPages.varclansettings },
    // campaign: { key: 8, index: cacheConfigPages.varcampaign },//seems incorrect after 30oct2023
    playergroup: { key: 9, index: cacheConfigPages.varplayergroup }//not sure about 75
};
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
    pushlocallong: 10024,
    poplocallong: 10237,

    //pop discard
    popdiscardint: 10004,
    popdiscardlong: 9104,//op not seen yet
    popdiscardstring: 10360,

    //variable number of args
    joinstring: 37,
    gosub: 40,

    //complicated types
    pushvar: 42,
    popvar: 43,
    pushvarbit: 10022,
    popvarbit: 10023,

    //control flow
    jump: 6,
    branch_not: 7,
    branch_eq: 8,
    branch_lt: 9,
    branch_gt: 10,
    branch_lteq: 31,
    branch_gteq: 32,
    branch_eq_long: 10153,
    branch_not_long: 10449,
    branch_lt_long: 10411,
    branch_gt_long: 10321,
    branch_lteq_long: 10491,
    branch_gteq_long: 10349,
    switch: 51,
    return: 21,

    //unknown original ids
    pushconst: 9001,
    tribyte1: 9002,
    tribyte2: 9003,

    //non-existent opcodes
    shorting_or: 9100,
    shorting_and: 9101,

    //math stuff
    plus: 4000,
    minus: 4001,
    intdiv: 4003,
    intmul: 4002,
    strcmp: 4107,//0 for equal, might be string - operator
    strconcat: 4101,
    inttostring: 10064,

    //enums
    enum_getvalue: 3408,
    struct_getparam: 4500,
    item_getparam: 4208,
    quest_getparam: 10262,
    npc_getparam: 10076,
    cc_getparam: 10049,
    mec_getparam: 10192,
    dbrow_getfield: 10094,
    dbrow_findnext: 10112,

    //dynamic subtype ops
    cc_setparam: 10098,
    db_find_with_count: 10100,
    lc_getparam: 10798,
    enum_getstring: 10047,
    enum_getreverseindex: 10154,
    enum_getreversecount: 10240,
    enum_hasoutput: 10244,

    //arrays
    define_array: 10569,
    pop_array: 46,
    push_array: 45,

    //interface stuff
    printmessage: 3100
}

// from runestar cs2-rs3
export const subtypes = {
    int: 0,
    boolean: 1,
    type_2: 2,
    quest: 3,
    questhelp: 4,
    cursor: 5,
    seq: 6,
    colour: 7,
    loc_shape: 8,
    component: 9,
    idkit: 10,
    midi: 11,
    npc_mode: 12,
    namedobj: 13,
    synth: 14,
    type_15: 15,
    area: 16,
    stat: 17,
    npc_stat: 18,
    writeinv: 19,
    mesh: 20,
    maparea: 21,
    coordgrid: 22,
    graphic: 23,
    chatphrase: 24,
    fontmetrics: 25,
    enum: 26,
    type_27: 27,
    jingle: 28,
    chatcat: 29,
    loc: 30,
    model: 31,
    npc: 32,
    obj: 33,
    player_uid: 34,
    type_35: 35,
    string: 36,
    spotanim: 37,
    npc_uid: 38,
    inv: 39,
    texture: 40,
    category: 41,
    char: 42,
    laser: 43,
    bas: 44,
    type_45: 45,
    collision_geometry: 46,
    physics_model: 47,
    physics_control_modifier: 48,
    clanhash: 49,
    coordfine: 50,
    cutscene: 51,
    itemcode: 53,
    type_54: 54,
    mapsceneicon: 55,
    clanforumqfc: 56,
    vorbis: 57,
    verify_object: 58,
    mapelement: 59,
    categorytype: 60,
    social_network: 61,
    hitmark: 62,
    package: 63,
    particle_effector: 64,
    type_65: 65,
    particle_emitter: 66,
    plogtype: 67,
    unsigned_int: 68,
    skybox: 69,
    skydecor: 70,
    hash64: 71,
    inputtype: 72,
    struct: 73,
    dbrow: 74,
    type_75: 75,
    type_76: 76,
    type_77: 77,
    type_78: 78,
    type_79: 79,
    type_80: 80,
    type_81: 81,
    type_83: 83,
    type_84: 84,
    type_85: 85,
    type_86: 86,
    type_87: 87,
    type_88: 88,
    gwc_platform: 89,
    type_90: 90,
    type_91: 91,
    type_92: 92,
    type_93: 93,
    bug_template: 94,
    billing_auth_flag: 95,
    account_feature_flag: 96,
    interface: 97,
    toplevelinterface: 98,
    overlayinterface: 99,
    clientinterface: 100,
    movespeed: 101,
    material: 102,
    seqgroup: 103,
    temp_hiscore: 104,
    temp_hiscore_length_type: 105,
    temp_hiscore_display_type: 106,
    temp_hiscore_contribute_result: 107,
    audiogroup: 108,
    audiomixbuss: 109,
    long: 110,
    crm_channel: 111,
    http_image: 112,
    pop_up_display_behaviour: 113,
    poll: 114,
    type_115: 115,
    type_116: 116,
    pointlight: 117,
    player_group: 118,
    player_group_status: 119,
    player_group_invite_result: 120,
    player_group_modify_result: 121,
    player_group_join_or_create_result: 122,
    player_group_affinity_modify_result: 123,
    player_group_delta_type: 124,
    client_type: 125,
    telemetry_interval: 126,
    type_127: 127,
    type_128: 128,
    type_129: 129,
    type_130: 130,
    achievement: 131,
    stylesheet: 133,
    type_138: 138,
    type_200: 200,
    type_201: 201,
    type_202: 202,
    type_203: 203,
    type_204: 204,
    type_205: 205,
    type_206: 206,
    type_207: 207,
    type_208: 208,
    var_reference: 209,

    //TODO try to remove this, no longer required but still used for unknown subtypes
    unknown_int: 501,
    unknown_long: 502,
    unknown_string: 503,
    scriptref: 504,
    scriptsubref: 505
    //max 511 (9bit) or overflow elsewhere in code
}

export interface SubCallable {
    scriptname: string;
    originalindex: number;
    returntype: StackList;
    argtype: StackList;
    localCounts: StackDiff;
}

export type PrimitiveType = "int" | "long" | "string";
type DependentType = "known" | "opin" | "opout" | "scriptargvar" | "scriptret" | "uuid";

//key bit layout, using only bits 0-29 to fit inside a 31bit signed v8 smi
//29-27, 26-25, 24-9, 0-8 
//type   stack  group index

const stacktypekeys: PrimitiveType[] = ["int", "long", "string"];
const grouptypekeys: DependentType[] = ["known", "opin", "opout", "scriptargvar", "scriptret", "uuid"];
function primitiveToId(prim: PrimitiveType) {
    return stacktypekeys.indexOf(prim);//2 bits
}
function dependentToId(dep: DependentType) {
    return grouptypekeys.indexOf(dep);//3 bits
}
export function dependencyGroup(deptype: DependentType, id: number) {
    return (dependentToId(deptype) << 27) | (id << 9);
}
export function dependencyIndex(subtype: PrimitiveType, index: number) {
    return (primitiveToId(subtype) << 25) | index;
}
export function knownDependency(fulltype: number) {
    return (primitiveToId(typeToPrimitive(fulltype)) << 25) | fulltype;
}
export function keyToPrimitive(key: number): PrimitiveType {
    let deptype = (key >> 27) & 7;
    if (deptype == 0) { return typeToPrimitive(key & 0x1ff); }
    let typekey = (key >> 25) & 3;
    return typekey == 0 ? "int" : typekey == 1 ? "long" : "string";
}
export function decomposeKey(key: number) {
    let sourcetype = grouptypekeys[(key >> 27) & 0x7];
    let stacktype = stacktypekeys[(key >> 25) & 0x3];
    let group = (key >> 9) & 0xffff;
    let index = key & 0x1ff;
    if (sourcetype == "uuid") {
        index = key & 0x1ffffff;
        group = 0;
    }
    return [sourcetype, stacktype, group, index] as const;
}

export function debugKey(key: number) {
    let [sourcetype, stackstring, group, index] = decomposeKey(key);

    if (sourcetype == "known") { return `known type ${index} ${Object.entries(subtypes).find(q => q[1] == index)?.[0]}`; }
    if (sourcetype == "opin") { return `opin ${group} ${getOpName(group)} ${index} ${stackstring}`; }
    if (sourcetype == "opout") { return `opout ${group} ${getOpName(group)} ${index} ${stackstring}`; }
    if (sourcetype == "scriptargvar") { return `script ${group} arg/local ${index} ${stackstring}`; }
    if (sourcetype == "scriptret") { return `script ${group} return ${index} ${stackstring}`; }
    if (sourcetype == "uuid") { return `uuid ${index} ${stackstring}`; }
}
globalThis.debugkey = debugKey;

export const typeuuids = {
    int: dependencyGroup("uuid", 0) | dependencyIndex("int", 0),
    long: dependencyGroup("uuid", 0) | dependencyIndex("long", 0),
    string: dependencyGroup("uuid", 0) | dependencyIndex("string", 0),
}

export function getOpName(id: number) {
    return knownClientScriptOpNames[id] ?? `unk${id}`;
}

export function longJsonToBigInt(tuple: [number, number]) {
    let res = (BigInt(tuple[0] >>> 0) << 32n) | BigInt(tuple[1] >>> 0);
    if (tuple[0] & 0x8000_0000) {
        //subtract complement when most significant bit is set
        res = res - 0x1_0000_0000_0000_0000n;
    }
    return res;
}

export function longBigIntToJson(long: bigint): [number, number] {
    let bigint = long & 0xffff_ffff_ffff_ffffn;
    let upper = Number((bigint >> 32n) & 0xffff_ffffn);
    let lower = Number(bigint & 0xffff_ffffn);
    return [upper, lower];
}

export function subtypeToTs(subt: number) {
    let resentry = Object.entries(subtypes).find(q => q[1] == subt);
    if (!resentry) { return `type_${subt}`; }
    let res = resentry[0];
    // if (res == "boolean") { res = "cs2bool"; }
    if (res == "enum") { res = "cs2enum"; }
    return res;
}

export function tsToSubtype(tscode: string) {
    if (tscode == "cs2bool") { return subtypes.boolean; }
    if (tscode == "cs2enum") { return subtypes.enum; }
    if (!Object.hasOwn(subtypes, tscode)) {
        let m = tscode.match(/^type_(\d+)$/);
        if (!m) { throw new Error("unknown subtype " + tscode); }
        return +m[1];
    }
    return subtypes[tscode];
}

const stringtypes = [
    subtypes.string,
    subtypes.coordfine,
    subtypes.unknown_string
];
const longtypes = [
    subtypes.type_35,
    subtypes.clanhash,
    subtypes.clanforumqfc,
    subtypes.hash64,
    subtypes.long,
    subtypes.type_115,
    subtypes.type_116,
    subtypes.unknown_long
];

export function typeToPrimitive(typeint: number): PrimitiveType {
    if (stringtypes.includes(typeint)) { return "string"; }
    else if (longtypes.includes(typeint)) { return "long"; }
    else { return "int"; }
}
export function primitiveToUknownExact(stacktype: PrimitiveType) {
    if (stacktype == "int") { return subtypes.unknown_int; }
    if (stacktype == "long") { return subtypes.unknown_long; }
    if (stacktype == "string") { return subtypes.unknown_string; }
    throw new Error(`uknown stack type ${stacktype}`);
}

export const knownClientScriptOpNames: Record<number, string> = {
    ...rs3opnames,
    ...Object.fromEntries(Object.entries(namedClientScriptOps).map(q => [q[1], q[0]]))
}

globalThis.knownClientScriptOpNames = knownClientScriptOpNames;

export const popDiscardOps = [
    namedClientScriptOps.popdiscardint,
    namedClientScriptOps.popdiscardlong,
    namedClientScriptOps.popdiscardstring
]
export const popLocalOps = [
    namedClientScriptOps.poplocalint,
    namedClientScriptOps.poplocallong,
    namedClientScriptOps.poplocalstring
]
export const pushLocalOps = [
    namedClientScriptOps.pushlocalint,
    namedClientScriptOps.pushlocallong,
    namedClientScriptOps.pushlocalstring
]
export const pushOrPopLocalOps = [
    ...popDiscardOps,
    ...popLocalOps,
    ...pushLocalOps
]
export const branchInstructionsInt = [
    namedClientScriptOps.branch_not,
    namedClientScriptOps.branch_eq,
    namedClientScriptOps.branch_lt,
    namedClientScriptOps.branch_gt,
    namedClientScriptOps.branch_lteq,
    namedClientScriptOps.branch_gteq,
]
export const branchInstructionsLong = [
    namedClientScriptOps.branch_not_long,
    namedClientScriptOps.branch_eq_long,
    namedClientScriptOps.branch_lt_long,
    namedClientScriptOps.branch_gt_long,
    namedClientScriptOps.branch_lteq_long,
    namedClientScriptOps.branch_gteq_long
]

export const branchInstructions = [
    ...branchInstructionsInt,
    ...branchInstructionsLong
];

export const binaryOpSymbols = new Map([
    [namedClientScriptOps.shorting_or, "||"],
    [namedClientScriptOps.shorting_and, "&&"],

    //compare longs
    // [namedClientScriptOps.branch_not_long, ":!="],
    // [namedClientScriptOps.branch_eq_long, ":=="],
    // [namedClientScriptOps.branch_lteq_long, ":<="],
    // [namedClientScriptOps.branch_gteq_long, ":>="],
    // [namedClientScriptOps.branch_lt_long, ":<"],
    // [namedClientScriptOps.branch_gt_long, ":>"],

    //ints
    [namedClientScriptOps.branch_not, "!="],
    [namedClientScriptOps.branch_eq, "=="],
    [namedClientScriptOps.branch_lteq, "<="],
    [namedClientScriptOps.branch_gteq, ">="],
    [namedClientScriptOps.branch_lt, "<"],//make sure shorter ops are after longer ones
    [namedClientScriptOps.branch_gt, ">"],

    //math
    [namedClientScriptOps.plus, "+"],
    [namedClientScriptOps.minus, "-"],
    [namedClientScriptOps.intdiv, "/"],
    [namedClientScriptOps.intmul, "*"],
]);

export const int32MathOps = new Set([
    namedClientScriptOps.plus,
    namedClientScriptOps.minus,
    namedClientScriptOps.intdiv,
    namedClientScriptOps.intmul
]);

export const binaryOpIds = new Map([...binaryOpSymbols].map(q => [q[1], q[0]]));

export const branchInstructionsOrJump = [
    ...branchInstructions,
    namedClientScriptOps.jump
]

export const getParamOps = [
    namedClientScriptOps.cc_getparam,
    namedClientScriptOps.mec_getparam,
    namedClientScriptOps.npc_getparam,
    namedClientScriptOps.item_getparam,
    namedClientScriptOps.quest_getparam,
    namedClientScriptOps.struct_getparam,
]

export const dynamicOps = [
    ...getParamOps,
    namedClientScriptOps.pushvar,
    namedClientScriptOps.popvar,
    namedClientScriptOps.enum_getvalue,
    namedClientScriptOps.dbrow_getfield,
    namedClientScriptOps.dbrow_findnext,
];

export function makeop(opcode: number, imm = 0, imm_obj: ClientScriptOp["imm_obj"] = null) {
    return { opcode, imm, imm_obj } satisfies ClientScriptOp;
}
export function makejump(label: ClientScriptOp) {
    return { opcode: namedClientScriptOps.jump, imm: 0, imm_obj: { type: "jumplabel", value: label } } satisfies ClientScriptOp;
}

export type ImmediateType = "byte" | "int" | "tribyte" | "switch" | "long" | "string";

export type SwitchJumpTable = { value: number, jump: number }[];

export type ClientScriptOp = {
    opcode: number,
    imm: number,
    imm_obj: string | number | [number, number] | { type: "switchvalues", value: SwitchJumpTable } | { type: "jumplabel", value: ClientScriptOp } | null,
    opname?: string
}

export class StackConstants {
    values: StackConst[] = [];
    constructor(v?: StackConst) {
        if (v !== undefined) {
            this.values.push(v);
        }
    }
    applyInOut(other: StackInOut) {
        let addedlength = other.out.values.length - other.in.values.length;
        if (this.values.length < other.in.values.length) {
            // console.log("ignored conststack inout that had to many through values");
        }
        if (addedlength > 0) {
            for (let i = 0; i < addedlength; i++) {
                this.values.push(null);
            }
        } else {
            this.values.length = Math.max(0, this.values.length + addedlength);
        }
    }
    popList(other: StackList, endoffset?: number) {
        this.values.length -= other.total(endoffset);
    }
    pushOne(other: StackConst | undefined) {
        this.values.push(other ?? null);
    }
    pushList(other: StackList, endoffset?: number) {
        for (let i = other.total(endoffset); i > 0; i--) { this.values.push(null); }
    }
    push(other: StackConstants) {
        this.values.push(...other.values);
    }
    pop() {
        if (this.values.length == 0) { throw new Error("tried to pop empty StackConsts"); }
        return this.values.pop()!;
    }
}

export type StackConst = ClientScriptOp["imm_obj"];
export type StackType = PrimitiveType | "vararg";
export type StackTypeExt = StackType | StackDiff;
export class StackList {
    values: StackTypeExt[];
    constructor(values: StackTypeExt[] = []) {
        this.values = values;
    }
    pushone(type: StackType) { this.values.push(type); }
    int() { this.values.push("int"); }
    long() { this.values.push("long"); }
    string() { this.values.push("string"); }
    isEmpty() { return this.values.every(q => q instanceof StackDiff && q.isEmpty()); }
    total(endoffset = 0) {
        let r = 0;
        for (let i = this.values.length - 1; i >= endoffset; i--) {
            let v = this.values[i];
            if (v instanceof StackDiff) { r += v.total(); }
            else { r++; }
        }
        return r;
    }
    tryShift(n: number) {
        let count = 0;
        let sliceindex = -1;
        for (let i = 0; i < this.values.length; i++) {
            let val = this.values[i];
            if (val instanceof StackDiff) {
                count += val.total();
            } else {
                count++;
            }
            if (count >= n) {
                sliceindex = i + 1;
                break;
            }
        }
        if (count != n) { return false; }
        this.values.splice(0, sliceindex);
        return true;
    }
    hasSimple(other: StackList) {
        let len = other.values.length - 1;
        if (this.values.length < len) { return false; }
        for (let i = 0; i <= len; i++) {
            let otherval = other.values[len - i];
            if (typeof otherval != "string") { return false; }
            let val = this.values[this.values.length - 1 - i];
            if (typeof val != "string" || val != otherval) { return false; }
        }
        return true;
    }
    pop(list: StackList, limit = 0) {
        if (this.tryPop(list, limit) != 0) {
            throw new Error("missing pop values on stack");
        }
    }
    tryPopReverse(list: StackList, limit = 0) {
        this.values.reverse();
        list.values.reverse();
        try {
            return this.tryPop(list, limit);
        } finally {
            this.values.reverse();
            list.values.reverse();
        }
    }
    tryPopUnordered(otherval: StackDiff) {
        while (!otherval.isEmpty()) {
            if (this.values.length == 0) { return false; }
            let val = this.values[this.values.length - 1];
            if (val instanceof StackDiff) {
                if (otherval.lteq(val)) {
                    val.sub(otherval);
                    otherval.sub(otherval);
                } else if (val.lteq(otherval)) {
                    otherval.sub(val);
                    val.sub(val);
                    this.values.pop();
                } else {
                    return false;
                }
            } else {
                let amount = otherval.getSingle(val);
                if (amount <= 0) { return false; }
                otherval.setSingle(val, amount - 1);
                this.values.pop();
            }
        }
        return true;
    }
    tryPopSingle(otherval: StackType) {
        if (this.values.length == 0) { return false; }
        let val = this.values[this.values.length - 1];
        if (val instanceof StackDiff) {
            let amount = val.getSingle(otherval);
            if (amount <= 0) { return false; }
            val.setSingle(otherval, amount - 1);
            if (val.isEmpty()) { this.values.pop(); }
        } else {
            if (val != otherval) { return false; }
            this.values.pop();
        }
        return true;
    }
    tryPop(list: StackList, limit = 0) {
        //sort of using 1 based indexing like a freak!!, there is in fact a situation where you'd need 1 based indices
        let otherindex = list.values.length;
        while (otherindex > limit) {
            let otherval: StackTypeExt = list.values[otherindex - 1];
            if (otherval instanceof StackDiff) {
                if (!this.tryPopUnordered(otherval.clone())) { break; }
                otherindex--;
            } else {
                if (!this.tryPopSingle(otherval)) { break; }
                otherindex--;
            }
        }
        return otherindex - limit;
    }
    push(list: StackList) {
        for (let val of list.values) {
            if (val instanceof StackDiff) {
                this.values.push(val.clone());
            } else {
                this.values.push(val);
            }
        }
    }
    clone() {
        return new StackList(this.values.map(q => q instanceof StackDiff ? q.clone() : q));
    }
    toString() {
        let res: string[] = [];
        let lastdiff: StackDiff | null = null;
        for (let v of this.values) {
            if (typeof v == "string") { res.push(v); }
            else if (v == lastdiff) { continue; }
            else {
                lastdiff = v;
                res.push(v.toString());
            }
        }
        return res.join(",");
    }
    toFunctionBindString() {
        let res = "";
        for (let part of this.values) {
            if (part instanceof StackDiff) { res += part.toFunctionBindString(); }
            else if (part == "int") { res += "i"; }
            else if (part == "long") { res += "l"; }
            else if (part == "string") { res += "s"; }
            else throw new Error("unsupported stack type");
        }
        return res;
    }
    toTypeScriptVarlist(withnames: boolean, withtypes: boolean, exacttype?: ExactStack | null) {
        let res = "";
        let counts = new StackDiff();
        for (let i = 0; i < this.values.length; i++) {
            let part = this.values[i];
            if (part instanceof StackDiff) { res += part.toTypeScriptVarlist(counts, withnames, withtypes, exacttype); }
            else if (part == "int" && i + 1 < this.values.length && this.values[i + 1] == "vararg") {
                //combine int+vararg arguments into a single boundfunction argument
                if (withnames) { res += `vararg${withtypes ? ": " : ""}`; }
                if (withtypes) { res += "BoundFunction"; }
                counts.vararg++;
                i++;
            }
            else if (part == "int") {
                if (withnames) { res += `int${counts.int}${withtypes ? ": " : ""}`; }
                if (withtypes) { res += (exacttype ? subtypeToTs(exacttype.int[counts.int]) : "number"); }
                counts.int++;
            }
            else if (part == "long") {
                if (withnames) { res += `long${counts.long}${withtypes ? ": " : ""}`; }
                if (withtypes) { res += (exacttype ? subtypeToTs(exacttype.long[counts.long]) : "BigInt"); }
                counts.long++;
            }
            else if (part == "string") {
                if (withnames) { res += `string${counts.string}${withtypes ? ": " : ""}`; }
                if (withtypes) { res += (exacttype ? subtypeToTs(exacttype.string[counts.string]) : "string"); }
                counts.string++;
            }
            else throw new Error("unsupported stack type");
            if (i != this.values.length - 1) { res += ", "; }
        }
        // res = res.replace(/,\s?$/, "");
        return res;
    }
    toTypeScriptReturnType(exacttype?: ExactStack | null) {
        if (this.values.length == 0) {
            return "void";
        }
        if (this.values.length == 1) {
            return this.toTypeScriptVarlist(false, true, exacttype);
        }
        return `[${this.toTypeScriptVarlist(false, true, exacttype)}]`;
    }
    toJson() { return this.values.map(q => typeof q == "string" ? q : q.toJson()); }
    static fromJson(v: ReturnType<StackList["toJson"]>) {
        return new StackList(v.map(q => typeof q == "string" ? q : StackDiff.fromJson(q)!));
    }
    getStackdiff() {
        let r = new StackDiff();
        for (let v of this.values) {
            if (v === "int") { r.int++; }
            else if (v === "string") { r.string++; }
            else if (v === "long") { r.long++; }
            else if (v === "vararg") { r.vararg++; }
            else if (v instanceof StackDiff) { r.add(v); }
            else { throw new Error("unexpected"); }
        }
        return r;
    }
    toStackDiff() {
        let res = new StackDiff();
        for (let part of this.values) {
            if (part instanceof StackDiff) { res.add(part); }
            else { res.setSingle(part, res.getSingle(part) + 1); }
        }
        return res;
    }
    toLooseSubtypes() {
        let res: number[] = [];
        for (let value of this.values) {
            if (value instanceof StackDiff) {
                if (value.vararg != 0) { throw new Error("vararg doesn't have a vm type"); }
                for (let i = 0; i < value.int; i++) { res.push(typeuuids.int++); }
                for (let i = 0; i < value.long; i++) { res.push(typeuuids.long++); }
                for (let i = 0; i < value.string; i++) { res.push(typeuuids.string++); }
            }
            else if (value == "int") { res.push(typeuuids.int++); }
            else if (value == "long") { res.push(typeuuids.long++); }
            else if (value == "string") { res.push(typeuuids.string++); }
            else throw new Error("vararg doesn't have a vm type");
        }
        return res;
    }
}

export class ExactStack {
    int: number[] = [];
    long: number[] = [];
    string: number[] = [];
    all() {
        return this.int.concat(this.long, this.string);
    }
    static fromList(types: number[]) {
        let res = new ExactStack();
        for (let type of types) {
            res[keyToPrimitive(type)].push(type);
        }
        return res;
    }
    static fromJson(json: ReturnType<ExactStack['toJson']>) {
        let res = new ExactStack();
        res.int = json.int;
        res.long = json.long;
        res.string = json.string;
        return res;
    }
    toJson() {
        return this;
    }
}
export class StackInOut {
    in = new StackList();
    out = new StackList();
    exactin: ExactStack | null = null;
    exactout: ExactStack | null = null;
    constout: StackConst = null;
    initializedin = false;
    initializedout = false;
    initializedthrough = false;
    constructor(inlist?: StackList, outlist?: StackList) {
        this.in = inlist ?? new StackList();
        this.out = outlist ?? new StackList();
        this.initializedin = !!inlist;
        this.initializedout = !!outlist;
        this.initializedthrough = this.initializedin && this.initializedout;
    }
    static fromExact(inlist: number[], outlist: number[]) {
        let res = new StackInOut(new StackList(inlist.map(keyToPrimitive)), new StackList(outlist.map(keyToPrimitive)));
        res.exactin = ExactStack.fromList(inlist);
        res.exactout = ExactStack.fromList(outlist);
        return res;
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
        return this.out.total() - this.in.total();
    }
    getCode() {
        return `${this.out.values.join(",")}(${this.in.values.join(",")})`;
    }
    toString() {
        return `${this.out + "" || "void"}${this.initializedthrough ? "" : "??"}(${this.in})`;
    }
    toJson() {
        return {
            in: this.in.toJson(),
            out: this.out.toJson(),
            initializedthrough: this.initializedthrough,
            exactin: this.exactin?.toJson(),
            exactout: this.exactout?.toJson()
        }
    }
    static fromJson(json: ReturnType<StackInOut["toJson"]>) {
        let res = new StackInOut(StackList.fromJson(json.in), StackList.fromJson(json.out));
        res.initializedthrough = json.initializedthrough;
        res.initializedin = json.initializedthrough;
        res.initializedout = json.initializedthrough;
        res.exactin = (json.exactin ? ExactStack.fromJson(json.exactin) : null);
        res.exactout = (json.exactout ? ExactStack.fromJson(json.exactout) : null);
        return res;
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
    min(other: StackDiff) {
        this.int = Math.min(other.int, this.int);
        this.long = Math.min(other.long, this.long);
        this.string = Math.min(other.string, this.string);
        this.vararg = Math.min(other.vararg, this.vararg);
    }
    max(other: StackDiff) {
        this.int = Math.max(other.int, this.int);
        this.long = Math.max(other.long, this.long);
        this.string = Math.max(other.string, this.string);
        this.vararg = Math.max(other.vararg, this.vararg);
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
    isNonNegative() {
        return this.int >= 0 && this.long >= 0 && this.string >= 0 && this.vararg >= 0;
    }
    toString() {
        return `(${this.int},${this.long},${this.string},${this.vararg})`;
    }
    total() {
        return this.int + this.long + this.string + this.vararg;
    }
    clone() {
        return new StackDiff().add(this);
    }
    isMonoType(): PrimitiveType | "multi" {
        if (this.vararg != 0) { return "multi"; }
        if (this.int != 0 && this.long == 0 && this.string == 0) { return "int"; }
        if (this.int == 0 && this.long != 0 && this.string == 0) { return "long"; }
        if (this.int == 0 && this.long == 0 && this.string != 0) { return "string"; }
        return "multi";
    }
    getSingle(stack: StackType) {
        if (stack == "int") { return this.int; }
        else if (stack == "long") { return this.long; }
        else if (stack == "string") { return this.string; }
        else if (stack == "vararg") { return this.vararg; }
        else { throw new Error("unknown stack type"); }
    }
    setSingle(stack: StackType, value: number) {
        if (stack == "int") { this.int = value; }
        else if (stack == "long") { this.long = value; }
        else if (stack == "string") { this.string = value; }
        else if (stack == "vararg") { this.vararg = value; }
        else { throw new Error("unknown stack type"); }
    }
    getArglist() {
        let inargs = new StackList();
        let ntypes = +!!this.int + +!!this.string + +!!this.long + +!!this.vararg;
        if (ntypes > 1) {
            inargs.values.push(this.clone());
        } else {
            inargs.values.push(...Array<StackType>(this.int).fill("int"));
            inargs.values.push(...Array<StackType>(this.string).fill("string"));
            inargs.values.push(...Array<StackType>(this.long).fill("long"));
            inargs.values.push(...Array<StackType>(this.vararg).fill("vararg"));
        }
        return inargs;
    }
    toFunctionBindString() {
        let res = "";
        res += "i".repeat(this.int);
        res += "l".repeat(this.long);
        res += "s".repeat(this.string);
        if (this.vararg != 0) { throw new Error("vararg not supported"); }
        return res;
    }
    toTypeScriptVarlist(nameoffset: StackDiff, withnames: boolean, withtypes: boolean, exacttype?: ExactStack | null) {
        let res = "";
        for (let i = 0; i < this.int; i++) {
            if (withnames) { res += `int${nameoffset.int}${withtypes ? ": " : ""}`; }
            if (withtypes) { res += (exacttype ? subtypeToTs(exacttype.int[nameoffset.int]) : "number"); }
            res += ", ";
            nameoffset.int++;
        }
        for (let i = 0; i < this.long; i++) {
            if (withnames) { res += `long${nameoffset.long}${withtypes ? ": " : ""}`; }
            if (withtypes) { res += (exacttype ? subtypeToTs(exacttype.long[nameoffset.long]) : "BigInt"); }
            res += ", ";
            nameoffset.long++;
        }
        for (let i = 0; i < this.string; i++) {
            if (withnames) { res += `string${nameoffset.string}${withtypes ? ": " : ""}`; }
            if (withtypes) { res += (exacttype ? subtypeToTs(exacttype.string[nameoffset.string]) : "string"); }
            res += ", ";
            nameoffset.string++;
        }
        for (let i = 0; i < this.vararg; i++) {
            if (withnames) { res += `vararg${nameoffset.vararg}${withtypes ? ": " : ""}`; }
            if (withtypes) { res += "BoundFunction"; }
            res += ", ";
            nameoffset.vararg++;
        }
        res = res.replace(/, $/, "");
        return res;
    }
}