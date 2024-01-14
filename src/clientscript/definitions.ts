import { rs3opnames } from "./opnames";

export const variableSources = {
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
    pushlocallong: 11603,
    poplocallong: 11607,

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

    //non-existent opcodes
    shorting_or: 9100,
    shorting_and: 9101,

    //math stuff
    plus: 10000,
    minus: 10006,
    intdiv: 10001,
    strtolower: 10003,//not sure
    strcmp: 10004,//0 for equal, might be string - operator
    intmod: 10005,//todo is wrong, this is bitwise and
    strconcat: 10060,
    inttostring: 10687,

    //enums
    enum_getvalue: 10063,
    struct_getparam: 10023,
    item_getparam: 10110,
    quest_getparam: 10885,
    npc_getparam: 10699,
    cc_getparam: 10672,
    mec_getparam: 10815,
    dbrow_getfield: 10717,

    //arrays
    define_array: 11631,
    pop_array: 46,
    push_array: 45,

    //interface stuff
    if_setop: 10072
    //11601=get clientvar int? push clientvar int with id imm>>11??
    //11602=set
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

    //used internally when the type is unknowable (literals in code)
    loose_int: 501,
    loose_long: 502,
    loose_string: 503
    //max 511 (9bit) or overflow elsewhere in code
}

const stringtypes = [
    subtypes.string,
    subtypes.coordfine,
    subtypes.loose_string
];
const longtypes = [
    subtypes.type_35,
    subtypes.clanhash,
    subtypes.clanforumqfc,
    subtypes.hash64,
    subtypes.long,
    subtypes.type_115,
    subtypes.type_116,
    subtypes.loose_long
];

export function typeToPrimitive(typeint: number): "int" | "long" | "string" {
    if (stringtypes.includes(typeint)) { return "string"; }
    else if (longtypes.includes(typeint)) { return "long"; }
    else { return "int"; }
}

export const knownClientScriptOpNames: Record<number, string> = {
    ...rs3opnames,
    ...Object.fromEntries(Object.entries(namedClientScriptOps).map(q => [q[1], q[0]]))
}

globalThis.knownClientScriptOpNames = knownClientScriptOpNames;

export const branchInstructionsInt = [
    namedClientScriptOps.branch_not,
    namedClientScriptOps.branch_eq,
    namedClientScriptOps.branch_lt,
    namedClientScriptOps.branch_gt,
    namedClientScriptOps.branch_lteq,
    namedClientScriptOps.branch_gteq,
]
export const branchInstructionsLong = [
    namedClientScriptOps.branch_unk11619,
    namedClientScriptOps.branch_unk11611,
    namedClientScriptOps.branch_unk11613,
    namedClientScriptOps.branch_unk11606,
    namedClientScriptOps.branch_unk11624,
    namedClientScriptOps.branch_unk11625
]

export const branchInstructions = [
    ...branchInstructionsInt,
    ...branchInstructionsLong
];

export const binaryOpSymbols = new Map([
    [namedClientScriptOps.shorting_or, "||"],
    [namedClientScriptOps.shorting_and, "&&"],

    [namedClientScriptOps.branch_not, "!="],
    [namedClientScriptOps.branch_eq, "=="],
    [namedClientScriptOps.branch_lteq, "<="],
    [namedClientScriptOps.branch_gteq, ">="],
    [namedClientScriptOps.branch_lt, "<"],//make sure shorter ops are after longer ones
    [namedClientScriptOps.branch_gt, ">"],
    // probably comparing longs
    [namedClientScriptOps.branch_unk11619, ":op1:"],
    [namedClientScriptOps.branch_unk11611, ":op2:"],
    [namedClientScriptOps.branch_unk11613, ":op3:"],
    [namedClientScriptOps.branch_unk11606, ":op4:"],
    [namedClientScriptOps.branch_unk11624, ":op5:"],
    [namedClientScriptOps.branch_unk11625, ":op6:"],

    //math
    [namedClientScriptOps.plus, "+"],
    [namedClientScriptOps.minus, "-"],
    [namedClientScriptOps.intdiv, "/"],
    [namedClientScriptOps.intmod, "%"],

    //string
    [namedClientScriptOps.strconcat, "strcat"],
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
    namedClientScriptOps.dbrow_getfield,//dbrow_getfield
    10735,//dbrow_findnext
];

export type ImmediateType = "byte" | "int" | "tribyte" | "switch" | "long" | "string";

export type ClientScriptOp = {
    opcode: number,
    imm: number,
    imm_obj: string | number | [number, number] | { value: number, label: number }[] | null,
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
export type StackType = "int" | "long" | "string" | "vararg";
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
    isEmpty() { return this.values.length == 0; }
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
    toTypeScriptVarlist() {
        let res = "";
        let counts = new StackDiff();
        for (let part of this.values) {
            if (part instanceof StackDiff) { res += part.toTypeScriptVarlist(counts); }
            else if (part == "int") { res += `int${counts.int++}:number,`; }
            else if (part == "long") { res += `long${counts.long++}:BigInt,`; }
            else if (part == "string") { res += `string${counts.string++}:string,`; }
            else if (part == "vararg") { res += "vararg:any,"; }
            else throw new Error("unsupported stack type");
        }
        if (res.endsWith(",")) {
            res = res.slice(0, -1);
        }
        return res;
    }
    toTypeScriptReturnType() {
        if (this.values.length == 1) {
            let type = this.values[0];
            if (type instanceof StackDiff) {
                if (type.int != 0) { return "number"; }
                if (type.long != 0) { return "BigInt"; }
                if (type.string != 0) { return "string"; }
                if (type.vararg != 0) { return "any"; }
            } else {
                if (type == "int") { return "number"; }
                if (type == "long") { return "BigInt"; }
                if (type == "string") { return "string"; }
                if (type == "vararg") { return "any"; }
            }
        }
        return `[${this.toTypeScriptVarlist()}]`;
    }
    toJson() { return this.values; }
    static fromJson(v: ReturnType<StackList["toJson"]>) { return new StackList(v); }
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
                for (let i = 0; i < value.int; i++) { res.push(subtypes.loose_int); }
                for (let i = 0; i < value.long; i++) { res.push(subtypes.loose_long); }
                for (let i = 0; i < value.string; i++) { res.push(subtypes.loose_string); }
            }
            else if (value == "int") { res.push(subtypes.loose_int); }
            else if (value == "long") { res.push(subtypes.loose_long); }
            else if (value == "string") { res.push(subtypes.loose_string); }
            else throw new Error("vararg doesn't have a vm type");
        }
        return res;
    }
}
export class StackInOut {
    in = new StackList();
    out = new StackList();
    exactin: number[] | null = null;
    exactout: number[] | null = null;
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
        let res = new StackInOut(new StackList(inlist.map(typeToPrimitive)), new StackList(outlist.map(typeToPrimitive)))
        res.exactin = inlist;
        res.exactout = outlist;
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
    toTypeScriptVarlist(nameoffset: StackDiff) {
        let res = "";
        for (let i = 0; i < this.int; i++) { res += `int${nameoffset.int++}:number,`; }
        for (let i = 0; i < this.long; i++) { res += `long${nameoffset.long++}:BigInt,`; }
        for (let i = 0; i < this.string; i++) { res += `string${nameoffset.string++}:string,`; }
        for (let i = 0; i < this.vararg; i++) { res += `vararg${nameoffset.string++}:any,`; }
        return res;
    }
}