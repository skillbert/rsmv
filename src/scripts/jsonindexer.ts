import { JSONSchema6, JSONSchema6Definition } from "json-schema";
import { cacheMajors, internalNameFiles, vartypeReverseMap, vartypes } from "../constants";
import { cacheFileJsonModes, iterateJsonFiles, JsonBasedFile } from "../parser/jsondecoders";
import { styleSheetImageProps, styleSheetRGBAProps, styleSheetRGBProps } from "./renderrsinterface";
import { BrowseModes, makeFileId } from "../viewer/tabs/browse";
import { CacheFileSource, getCacheVersionFingerprint } from "../cache";
import { loadParams } from "../clientscript/util";
import { params } from "../../generated/params";
import { LogicalIndex } from "../parser/filelookup";
import { AbstractSQLite, AbstractSQLiteNode } from "../libs/sqlite3wrap";
import { packAnimFrame, packComponent, packCoordgrid, packMapsquare, unpackComponent, unpackMapsquare, unpackCoordgrid, unpackAnimFrame } from "../utils";
import { CLIScriptOutput, ScriptOutput } from "../scriptrunner";
import { ClientScriptDeobLoader, renderClientScript } from "../clientscript";
import { isNamedOp, parseClientScriptIm, RawOpcodeNode, RewriteCursor } from "../clientscript/ast";
import { namedClientScriptOps } from "../clientscript/definitions";
import { clientscript } from "../../generated/clientscript";


type CustomPropTypes = "params" | "color" | "imagefile" | "rgb" | "argb" | "type" | "enumkey"
    | "enumvalue" | "paramvalue" | "dbvalue" | "dbrow_definition" | "dbtable_definition" | "varbit" | "stylevalue";
export type BrowsableType = keyof typeof vartypes | CustomPropTypes | "unknown" | "";

export const vartypeToDecoder: Partial<Record<keyof typeof vartypes, BrowseModes>> = {
    achievement: "achievements",
    bas: "animgroupconfigs",
    chatcat: "quickchatcats",
    chatphrase: "quickchatlines",
    cursor: "cursors",
    cutscene: "cutscenes",
    dbrow: "dbrows",
    enum: "enums",
    idkit: "identitykit",
    obj: "items",
    loc: "locs",
    model: "models",
    fontmetrics: "fontmetrics",
    npc: "npcs",
    seq: "sequences",
    spotanim: "spotanims",
    sound: "sounds",
    midi: "music",
    struct: "structs",
    quest: "quests",
    material: "materials",
    var_player: "var_player",
    stylesheet: "stylesheets",
    skybox: "skyboxes",
    graphic: "sprites",
    interface: "interfaces",
    scriptref: "clientscript",
    inv: "inventories",
    coordgrid: "coordgrid",
    maparea: "mapzones",
    hitmark: "hitmarks",
    ["dbtable" as any]: "dbtables",
    // TODO fix these
    ["headbar" as any]: "headbars",
    ["maplabel" as any]: "maplabels",
    ["varbit" as any]: "varbits",
    ["clientscriptops" as any]: "clientscript",
    // need to confirm
    // mapsceneicon: "mapscenes",
    // mapelement: "maplabels",
    // non-json
    // texture: "textures",
    // maparea: "mapareas",
    component: "interfaceviewer",
    // interface: "interfaces"
}

const modeactions: Record<keyof typeof cacheFileJsonModes, "full" | "typedonly" | "skip"> = {
    items: "full",
    enums: "full",
    npcs: "full",
    locs: "full",
    achievements: "full",
    structs: "full",
    spotanims: "full",
    materials: "full",
    quickchatcats: "full",
    quickchatlines: "full",
    dbtables: "full",
    dbrows: "full",
    quests: "full",
    hitmarks: "full",
    headbars: "full",
    varbits: "full",
    var_player: "full",
    var_npc: "full",
    var_client: "full",
    var_world: "full",
    var_region: "full",
    var_object: "full",
    var_clan: "full",
    var_clansetting: "full",
    var_campaign: "full",
    var_player_group: "full",
    overlays: "full",
    identitykit: "full",
    inventories: "full",
    params: "full",
    underlays: "full",
    mapscenes: "full",
    skyboxes: "full",
    cursors: "full",
    maplabels: "full",
    maplabellocations: "full",
    mapzones: "full",
    mappastes: "full",
    stylesheets: "full",
    cutscenes: "full",
    fontmetrics: "full",
    // only explicitly typed fields
    interfaces: "typedonly",
    animgroupconfigs: "typedonly",
    // skip
    client_cutscenes: "skip",
    maptiles: "skip",
    maplocations: "skip",
    frames: "skip",
    skeletons: "skip",
    framemaps: "skip",
    sequences: "skip",
    models: "skip",
    soundjson: "skip",
    musicjson: "skip",
    oldmaterials: "skip",
    mapzones_sub3: "skip",
    mapzones_sub4: "skip",
    particles0: "skip",
    particles1: "skip",
    maptiles_nxt: "skip",
    maptiles_old: "skip",
    maplocations_old: "skip",
    oldmodels: "skip",
    proctextures: "skip",
    oldproctextures: "skip",
    config83: "skip",
    indices: "skip",
    rootindex: "skip",
    clientscriptops: "skip",
    test: "skip",
    // broken - fixable
    mapenvs: "skip",
}
const extendedmodeactions: Partial<Record<keyof typeof cacheFileJsonModes, "full" | "typedonly" | "skip">> = {
    maptiles: "typedonly",
    maplocations: "typedonly",
    frames: "typedonly",
    framemaps: "typedonly",
    sequences: "typedonly",
    clientscriptops: "typedonly",
    // models: "typedonly",
}

const allModes = new Set([
    ...Object.entries(modeactions).filter(([_, action]) => action != "skip").map(q => q[0]),
    ...Object.entries(extendedmodeactions).filter(([_, action]) => action != "skip").map(q => q[0]),
]);

export class IndexGraphLoader {
    source: CacheFileSource;
    loaded: ReferenceGraph | null = null;
    loadPromise: Promise<ReferenceGraph> | null = null;

    constructor(source: CacheFileSource) {
        this.source = source;
    }

    static forCache(source: CacheFileSource): IndexGraphLoader {
        return source.decodeArgs.indexGraphLoader ??= new IndexGraphLoader(source);
    }

    load(source: CacheFileSource) {
        return this.loadPromise ??= ReferenceGraph.create(source).then(graph => {
            this.loaded = graph;
            return graph;
        });
    }
}

async function calculateReferenceGraph(out: ScriptOutput, graph: ReferenceGraph, source: CacheFileSource, full: boolean) {
    for (let [modenamestr, action] of Object.entries(modeactions)) {
        let modename = modenamestr as keyof typeof cacheFileJsonModes;
        if (full && extendedmodeactions[modename]) {
            action = extendedmodeactions[modename]!;
        }
        let oldprogressrows = await graph.db.getProgress.run(modename);
        let oldprogress = oldprogressrows?.[0]?.completed ?? 0;

        let mode = cacheFileJsonModes[modename];
        if (action == "skip") { continue; }
        if (out.state != "running") { break; }

        out.log(`=== Indexing ${modename} ===`);
        let allfiles = await mode.lookup.logicalRangeToFiles(source, [0, 0, 0], [Infinity, Infinity, Infinity]);
        let schema = mode.parser.parser.getJsonSchema();

        let lastfile = allfiles.at(-1);
        let lastlogical = (lastfile ? mode.lookup.fileToLogical(source, lastfile.index.major, lastfile.index.minor, lastfile.subindex) : [0, 0, 0]);
        let lastpackedlogical = logicalIdToPackedInt(lastlogical, modename);

        if (lastpackedlogical <= oldprogress) {
            out.log(`Skipping ${modename} - already completed`);
            continue;
        }

        graph.currentmode = modename;
        graph.currentlogicalmax = lastpackedlogical;
        graph.currenttypedonly = action == "typedonly";

        if (modename == "clientscriptops") {
            let subscriptout = new CLIScriptOutput();
            subscriptout.log = out.log.bind(out);
            await ClientScriptDeobLoader.forCache(source).loadOrGenerate(source, async () => subscriptout);
        }

        let count = 0;
        let lastprogress = Date.now();
        await iterateJsonFiles(source, mode, allfiles, (obj, fileid, logical) => {
            if (out.state != "running") { throw new Error("script aborted"); }

            let packed = logicalIdToPackedInt(logical, modename);
            graph.currentlogicalpacked = packed;
            graph.currentobjstack = [];

            if (packed <= oldprogress) {
                return;
            }

            if (modename == "clientscriptops") {
                parseClientScriptValue(out, graph, source, obj, logical);
            } else {
                parseJsonValue(graph, "root", obj, schema);
            }

            count++;
            if (Date.now() - lastprogress > 10000) {
                out.log(`Processed ${count}/${allfiles.length} files`);
                lastprogress = Date.now();
            }
            if (count % 500 == 0) {
                return graph.maybeFlush();
            }
        }, (err, fileid, logical) => {
            out.log(`Error processing ${modename}_${logical.join("_")}: ${err.message}`);
        });
        await graph.flush();
        out.log(`Finished ${modename} - ${count} files`);
    }
    out.log(`=== Finished indexing reference graph ===`);
}

function parseClientScriptValue(out: ScriptOutput, graph: ReferenceGraph, source: CacheFileSource, obj: clientscript, logical: number[]) {
    let deob = ClientScriptDeobLoader.forCache(source).getOrThrow();
    try {
        var res = parseClientScriptIm(deob, obj, logical[0]);
    } catch (e) {
        out.log(`Error parsing clientscript ${logical[0]}: ${e.message}`);
        return;
    }
    let cursor = new RewriteCursor(res.rootfunc);
    for (let node = cursor.goToStart(); node; node = cursor.next()) {
        if (isNamedOp(node, namedClientScriptOps.pushconst)) {
            let vartype = node.knownStackDiff?.exactout?.all()?.[0];
            if (vartype == undefined) {
                out.log(`vartype not set for op pushconst at ${logical[0]}:${node.originalindex}`);
                continue;
            }
            let solvedtype = res.typectx.getType(vartype);
            let typename = vartypeReverseMap.get(solvedtype);
            if (!typename) {
                out.log(`vartype ${solvedtype} not recognized for op pushconst at ${logical[0]}:${node.originalindex}`);
                continue;
            }
            if (Array.isArray(node.op.imm_obj)) {
                // uint64 packed as [hi,lo]
                out.log(`skipping unsupported pushconst i64 at ${logical[0]}:${node.originalindex}`);
            } else if (typeof node.op.imm_obj == "number") {
                // int
                graph.addInt("pushconst", node.op.imm_obj, typename);
            } else if (typeof node.op.imm_obj == "string") {
                // string
                graph.addString("pushconst", node.op.imm_obj, typename);
            }
        }
    }
}

type RefEntry<T> = { srcmode: string, srcid: number, propname: string, value: T, dstmode: string };

class ReferenceGraph {
    params!: Map<number, params>;
    paramnames!: Map<number, string>;

    currentobjstack: any[] = [];
    currentlogicalmax = 0;
    currentlogicalpacked = 0;
    currentmode: BrowseModes = "" as any;
    currenttypedonly = false;

    intqueue: RefEntry<number>[] = [];
    stringqueue: RefEntry<string>[] = [];

    db!: Awaited<ReturnType<typeof ReferenceGraph.initDB>>;

    private constructor() {
    }

    locked = Promise.resolve();

    runIndexer(script: ScriptOutput, source: CacheFileSource, full: boolean) {
        return this.locked = this.locked.finally(async () => {
            if (script.state != "running") { return; }
            await calculateReferenceGraph(script, this, source, full);
        });
    }

    private static async initDB(db: AbstractSQLite) {
        // int table
        await db.exec(`CREATE TABLE IF NOT EXISTS refints (srcmode TEXT, srcid UINT, propname TEXT, value INT, dstmode TEXT);`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_refints_value ON refints (value, dstmode);`);
        let addInt = await db.prepare<[srcmode: string, srcid: number, propname: string, value: number, dstmode: string], any>(`INSERT INTO refints (srcmode, srcid, propname, value, dstmode) VALUES (?,?,?,?,?)`);
        let addIntBatchSize = 32;
        let addIntBatchQuery = `INSERT INTO refints (srcmode, srcid, propname, value, dstmode) VALUES ${Array.from({ length: addIntBatchSize }).fill("(?,?,?,?,?)").join(",")}`;
        let addIntBatch = await db.prepare<any, any>(addIntBatchQuery);
        // strings table
        await db.exec(`CREATE TABLE IF NOT EXISTS refstrings (srcmode TEXT, srcid UINT, propname TEXT, value TEXT, dstmode TEXT);`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_refstrings_value ON refstrings (value, dstmode);`);
        let addString = await db.prepare<[srcmode: string, srcid: number, propname: string, value: string, dstmode: string], any>(`INSERT INTO refstrings (srcmode, srcid, propname, value, dstmode) VALUES (?,?,?,?,?)`);
        // progress table
        await db.exec(`CREATE TABLE IF NOT EXISTS progress (mode TEXT PRIMARY KEY, completed INT, max INT, intensity INT);`);
        let updateProgress = await db.prepare<[mode: string, completed: number, max: number, intensity: number], any>(`INSERT OR REPLACE INTO progress (mode, completed, max, intensity) VALUES (?,?,?,?)`);
        let getProgress = await db.prepare<[mode: string], { completed: number, max: number, intensity: number }>(`SELECT completed, max, intensity FROM progress WHERE mode=?`);
        // search
        let findrefs = await db.prepare<[mode: string, id: number, limit: number], { srcmode: string, srcid: number, propname: string, value: number, dstmode: string }>(`SELECT * FROM refints WHERE dstmode=? AND value=? GROUP BY srcmode,srcid LIMIT ?`);
        let findints = await db.prepare<[int: number, limit: number], { srcmode: string, srcid: number, propname: string, value: number, dstmode: string }>(`SELECT * FROM refints WHERE value=? LIMIT ?`);
        let findstrings = await db.prepare<[pattern: string, limit: number], { srcmode: string, srcid: number, propname: string, value: string, dstmode: string }>(`SELECT * FROM refstrings WHERE value LIKE ? LIMIT ?`);
        return { sqlite: db, addInt, addIntBatch, addIntBatchSize, addString, updateProgress, getProgress, findrefs, findints, findstrings };
    }

    static async create(source: CacheFileSource) {
        let builder = new ReferenceGraph();
        builder.params = await loadParams(source);
        builder.paramnames = await source.getInternalNameList(internalNameFiles.param);

        let versionint = await getCacheVersionFingerprint(source);
        if (versionint < +new Date(2000, 0) / 1000) {
            // TODO this is a bit weak, especially for pre-timestamp caches
            console.warn("using weak heuristic for cache version fingerprint - possible overwriting or mixing of other cache refgraph");
        }
        let dbname = `build${source.getBuildNr()}-refgraph-${versionint}.sqlite3`;

        // builder.refdb = await AbstractSQLiteWorker.create(dbname);
        let db = await AbstractSQLiteNode.create(dbname, { create: true, write: true });
        builder.db = await ReferenceGraph.initDB(db);
        return builder;
    }

    async flush() {
        await this.db.sqlite.exec("BEGIN TRANSACTION;");
        try {
            let proms: Promise<any>[] = [];
            let lastintindex = 0;
            for (; lastintindex + this.db.addIntBatchSize < this.intqueue.length; lastintindex += this.db.addIntBatchSize) {
                let batch = this.intqueue.slice(lastintindex, lastintindex + this.db.addIntBatchSize).flatMap(entry => [
                    entry.srcmode,
                    entry.srcid,
                    entry.propname,
                    entry.value,
                    entry.dstmode
                ]);
                proms.push(this.db.addIntBatch.run(...batch));
            }
            proms.push(...this.intqueue.slice(lastintindex).map(entry => this.db.addInt.run(entry.srcmode, entry.srcid, entry.propname, entry.value, entry.dstmode)));
            proms.push(...this.stringqueue.map(entry => this.db.addString.run(entry.srcmode, entry.srcid, entry.propname, entry.value, entry.dstmode)));
            await Promise.all(proms);
            await this.db.updateProgress.run(this.currentmode, this.currentlogicalpacked, this.currentlogicalmax, this.currenttypedonly ? 1 : 0);
            await this.db.sqlite.exec("COMMIT;");
            this.intqueue = [];
            this.stringqueue = [];
        } catch (e) {
            await this.db.sqlite.exec("ROLLBACK;");
            throw e;
        }
    }

    async maybeFlush() {
        if (this.intqueue.length + this.stringqueue.length > 10000) {
            await this.flush();
        }
    }

    addInt(propname: string, value: number, type: string) {
        let rsmvtype = vartypeToDecoder[type];
        if (rsmvtype) { type = rsmvtype; }
        if (this.currenttypedonly && (type == "unknown" || type == "" || type == "unknown_int")) {
            return;
        }
        this.intqueue.push({
            srcmode: this.currentmode,
            srcid: this.currentlogicalpacked,
            propname,
            value,
            dstmode: type
        });
    }
    addString(propname: string, value: string, type: string) {
        this.stringqueue.push({
            srcmode: this.currentmode,
            srcid: this.currentlogicalpacked,
            propname,
            value,
            dstmode: type
        });
    }
    async getProgress() {
        let progress: { mode: string, completed: number, total: number, typedonly: boolean }[] = [];
        for (let modename of allModes) {
            let rows = await this.db.getProgress.run(modename);
            let row = rows?.[0];
            progress.push({
                mode: modename,
                completed: row?.completed ?? -1,
                total: row?.max ?? -1,
                typedonly: (row?.intensity ?? 0) == 1
            });
        }
        return {
            completed: progress.filter(q => q.completed != -1 && q.completed == q.total).length,
            total: progress.length,
            progress
        }
    }

    async findReferences(mode: BrowseModes, logical: LogicalIndex) {
        let packed = logicalIdToPackedInt(logical, mode);
        let res = await this.db.findrefs.run(mode, packed, 1000);
        return res.map(q => {
            let logical = packedIntToLogical(q.srcid, q.srcmode as BrowseModes);
            return {
                srcmode: q.srcmode,
                srcpacked: q.srcid,
                srclogical: logical,
                srcobject: makeFileId(q.srcmode, logical),
                propname: q.propname
            };
        });
    }

    async findStrings(pattern: string) {
        return this.db.findstrings.run(pattern, 1000);
    }
}

function logicalIdToPackedInt(id: LogicalIndex, mode: BrowseModes) {
    if (mode == "interfaces") {
        return packComponent(id[0], id[1]);
    }
    if (mode == "frames") {
        return packAnimFrame(id[0], id[1]);
    }
    if (mode == "coordgrid") {
        return packCoordgrid(id[0], id[1], id[2]);
    }
    if (mode == "maptiles" || mode == "maptiles_nxt" || mode == "maplocations" || mode == "mapenvs") {
        return packMapsquare(id[0], id[1]);
    }

    if (id.length == 0) {
        return 0;
    }
    if (id.length != 1) {
        console.warn("logical id is not a single integer, cannot pack to int for refgraph: ", id, mode);
        return -1;
    }
    return id[0];
}

function packedIntToLogical(id: number, mode: BrowseModes) {
    if (mode == "interfaces") {
        let r = unpackComponent(id);
        return [r.intf, r.sub];
    }
    if (mode == "frames") {
        let r = unpackAnimFrame(id);
        return [r.intf, r.sub];
    }
    if (mode == "coordgrid") {
        let r = unpackCoordgrid(id);
        return [r.level, r.x, r.z];
    }
    if (mode == "maptiles" || mode == "maptiles_nxt" || mode == "maplocations" || mode == "mapenvs") {
        let r = unpackMapsquare(id);
        return [r.x, r.z];
    }
    return [id];
}

export function iterateTypedJson(objstack: any[], meta: JSONSchema6Definition | null | undefined, data: any, nameorindex: string | number) {
    let rsmvtype = meta?.["x-rsmv-type"] ?? "unknown";
    if (rsmvtype == "enumkey") {
        let keyint = objstack.at(0)?.key_type1 ?? objstack.at(0)?.key_type2;
        rsmvtype = vartypeReverseMap.get(keyint) as any ?? "unknown";
    }
    if (rsmvtype == "enumvalue") {
        let valueint = objstack.at(0)?.value_type1 ?? objstack.at(0)?.value_type2;
        rsmvtype = vartypeReverseMap.get(valueint) as any ?? "unknown";
    }
    if (rsmvtype == "paramvalue") {
        let paramint = objstack.at(0)?.type?.vartype;
        rsmvtype = vartypeReverseMap.get(paramint) as any ?? "unknown";
    }
    if (rsmvtype == "dbvalue") {
        let fieldtype = objstack.at(-1)?.type ?? objstack.at(-4)?.subtypes?.[nameorindex];
        rsmvtype = vartypeReverseMap.get(fieldtype) as any ?? "unknown";
    }
    if (typeof data == "number" && rsmvtype == "stylevalue") {
        let proptype = objstack.at(-2)?.prop;
        if (proptype != null) {
            if (styleSheetImageProps.includes(proptype)) {
                rsmvtype = "graphic";
            } else if (styleSheetRGBProps.includes(proptype)) {
                rsmvtype = "rgb";
                data = [(data >> 16) & 0xff, (data >> 8) & 0xff, data & 0xff];
            } else if (styleSheetRGBAProps.includes(proptype)) {
                rsmvtype = "argb";
                data = [(data >> 0) & 0xff, (data >> 24) & 0xff, (data >> 16) & 0xff, (data >> 8) & 0xff];
            } else {
                rsmvtype = "unknown";
            }
        }
    }
    // collapse multitypes
    if (typeof data == "number" && rsmvtype == "var_reference") {
        let domainid = (data >> 24) & 0xff;
        data = data & 0xffff;
        if (domainid == 0) { rsmvtype = "var_player"; }
        else if (domainid == 1) { rsmvtype = "varbit"; }
        else { console.log("unknown var_reference domainid: " + domainid); }
    }
    if (typeof data == "number" && rsmvtype == "achievement_or_varbit") {
        let domainid = (data >> 24) & 0xff;
        data = data & 0xffff;
        if (domainid == 0) { rsmvtype = "achievement"; }
        else if (domainid == 1) { rsmvtype = "varbit"; }
        else { console.log("unknown achievement_or_varbit domainid: " + domainid); }
    }
    meta = shedSchemaNull(meta);
    return { rsmvtype, data, meta };
}

function shedSchemaNull(meta: JSONSchema6Definition | undefined | null) {
    // make typescript happy
    if (typeof meta == "boolean") {
        meta = null;
    }
    // strip nullable type from schema
    if (meta?.oneOf) {
        meta = meta.oneOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
    }
    if (meta?.anyOf) {
        meta = meta.anyOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
    }
    return meta;
}


function parseParamtable(graph: ReferenceGraph, value: any[]) {
    for (let entry of value) {
        let paramname = graph.paramnames.get(entry.prop) ?? `param_${entry.prop}`;
        let paramdata = graph.params.get(entry.prop);
        let typeid = paramdata?.type?.vartype ?? -1;
        let typename = vartypeReverseMap.get(typeid) ?? "unknown";
        if (entry.intvalue != undefined) { graph.addInt(paramname, entry.intvalue, typename); }
        if (entry.stringvalue != undefined) { graph.addString(paramname, entry.stringvalue, typename); }
        graph.addInt("" + (entry.intvalue ?? entry.stringvalue), entry.prop, "params");
    }
}

function parseJsonValue(graph: ReferenceGraph, nameorindex: string | number, data: any, meta: JSONSchema6Definition | null | undefined) {
    let name = typeof nameorindex == "number" ? "" : nameorindex;
    graph.currentobjstack.push(data);
    try {
        // === find expected type ===
        let rsmvtype: BrowsableType;
        ({ rsmvtype, data, meta } = iterateTypedJson(graph.currentobjstack, meta, data, nameorindex));

        // === render data ===
        if (data == null) {
            // nop
        } else if (typeof data == "boolean") {
            // don't store booleans
        } else if (ArrayBuffer.isView(data)) {
            // skip typed arrays/buffers
        } else if (typeof data == "number") {
            graph.addInt(name, data, rsmvtype);
        } else if (typeof data == "string") {
            graph.addString(name, data, rsmvtype);
        } else if (Array.isArray(data)) {
            if (rsmvtype == "params") {
                parseParamtable(graph, data);
            } else {
                for (let i = 0; i < data.length; i++) {
                    let itemmeta: JSONSchema6Definition | null = null;
                    if (meta && meta.items) {
                        if (Array.isArray(meta.items)) {
                            itemmeta = meta.items[i];
                        } else {
                            itemmeta = meta.items;
                        }
                    }
                    parseJsonValue(graph, i, data[i], itemmeta);
                }
            }
        } else if (typeof data == "object") {
            for (let key in data) {
                if (key.startsWith("$")) { continue; } // skip internal properties
                let itemmeta: JSONSchema6Definition | null = null;
                if (meta && meta.properties && meta.properties[key]) {
                    itemmeta = meta.properties[key];
                }
                parseJsonValue(graph, key, data[key], itemmeta);
            }
        } else {
            throw new Error(`Unsupported data type: ${typeof data}`);
        }
    } finally {
        graph.currentobjstack.pop();
    }
}
