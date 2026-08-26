import { JSONSchema6, JSONSchema6Definition } from "json-schema";
import { cacheMajors, internalNameFiles, JsonFieldTypes, vartypeReverseMap, vartypes } from "../constants";
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
import { ClientscriptObfuscation } from "../clientscript/callibration/callibrator";
import { cacheFileDecodeModes } from "../parser/filetypes";

// technical types with custom handling, usually objects
type ComposedPropTypes = "paramtable" | "enumkey" | "clientscriptbinding" | "enumvalue" | "paramvalue" | "dbvalue" | "dbrow_definition" | "dbtable_definition" | "stylevalue";
// specializations with custom display that the client handles as primitives
type DisplayPropTypes = "color" | "rgb" | "argb" | "type" | "imagefile";
// types that are missing from vartypes, possibly not identified
export type ExtendedJsonFieldTypes = JsonFieldTypes | ComposedPropTypes | DisplayPropTypes;

export const vartypeToDecoder: Partial<Record<JsonFieldTypes, BrowseModes>> = {
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
    synth: "sounds",
    midi: "music",
    jingle: "music",
    struct: "structs",
    quest: "quests",
    material: "materials",
    varbit: "varbits",
    var_player: "var_player",
    var_world: "var_world",
    var_player_group: "var_player_group",
    var_region: "var_region",
    var_clan_setting: "var_clan_setting",
    var_campaign: "var_campaign",
    var_clan: "var_clan",
    var_client: "var_client",
    var_npc: "var_npc",
    var_object: "var_object",

    stylesheet: "stylesheets",
    skybox: "skyboxes",
    graphic: "sprites",
    component: "components",
    interface: "interfaceviewer",
    overlayinterface: "interfaceviewer",
    clientscript: "clientscript",
    inv: "inventories",
    coordgrid: "coordgrid",
    maparea: "mapzones",
    hitmark: "hitmarks",
    headbar: "headbars",
    mapsceneicon: "mapscenes",
    category: "categories",
    param: "params",

    dbtable: "dbtables",
    mapelement: "maplabels",
    // non-json
    // texture: "textures"
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
    var_clan_setting: "full",
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
    stylesheets: "full",
    cutscenes: "full",
    fontmetrics: "full",
    // only explicitly typed fields
    mapzones: "typedonly",
    mappastes: "typedonly",
    components: "typedonly",
    animgroupconfigs: "typedonly",
    // broken - fixable
    mapenvs: "skip",
    // skip
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
    maptiles_nxt: "skip",
    maptiles_old: "skip",
    maplocations_old: "skip",
    oldmodels: "skip",
    proctextures: "skip",
    oldproctextures: "skip",
    indices: "skip",
    rootindex: "skip",
    clientscriptops: "skip"
}
const extendedmodeactions: Partial<Record<keyof typeof cacheFileJsonModes, "full" | "typedonly" | "skip">> = {
    maptiles: "typedonly",
    maplocations: "typedonly",
    frames: "typedonly",
    framemaps: "typedonly",
    sequences: "typedonly"
}
const allModes = {
    ...modeactions,
    ...extendedmodeactions,
    clientscriptops: "typedonly"
};

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

async function calculateReferenceGraph(out: ScriptOutput, graph: ReferenceGraph, source: CacheFileSource, clientscript: boolean, extramodes: boolean) {
    let modes = { ...modeactions };
    if (extramodes) {
        Object.assign(modes, extendedmodeactions);
    }

    if (clientscript) {
        try {
            out.log(`Loading client script deobfuscation data...`);
            let subscriptout = new CLIScriptOutput();
            subscriptout.log = out.log.bind(out);
            graph.deob = await ClientScriptDeobLoader.forCache(source).loadOrGenerate(source, async () => subscriptout);
            out.log(`Client script deobfuscation data loaded`);
            modes.clientscriptops = "typedonly";
        } catch (e) {
            out.log(`Failed to load client script deob: ${e}`);
        }
    }

    // internal file names
    await parseNameFiles(out, graph, source);

    for (let [modenamestr, action] of Object.entries(modes)) {
        let modename = modenamestr as keyof typeof modeactions;
        if (action == "skip") { continue; }

        let oldprogressrows = await graph.db.getProgress.run(modename);
        let oldprogress = oldprogressrows?.[0]?.completed ?? 0;

        let mode = cacheFileJsonModes[modename];
        if (out.state != "running") { break; }
        let rstype = mode.proptype ?? "unknown";

        out.log(`=== Indexing ${modename} ===`);
        let allfiles = await mode.lookup.logicalRangeToFiles(source, [0, 0, 0], [Infinity, Infinity, Infinity]);
        let schema = mode.parser.parser.getJsonSchema();

        let lastfile = allfiles.at(-1);
        let lastlogical = (lastfile ? mode.lookup.fileToLogical(source, lastfile.index.major, lastfile.index.minor, lastfile.subid) : [0, 0, 0]);
        let lastpackedlogical = logicalIdToPackedInt(lastlogical, rstype);

        if (lastpackedlogical <= oldprogress) {
            out.log(`Skipping ${modename} - already completed`);
            continue;
        }

        graph.currentmode = modename;
        graph.currentlogicalmax = lastpackedlogical;
        graph.currenttypedonly = action == "typedonly";

        let count = 0;
        let lastprogress = Date.now();
        await iterateJsonFiles(source, mode, allfiles, (obj, fileid, logical) => {
            if (out.state != "running") { throw new Error("script aborted"); }

            let packed = logicalIdToPackedInt(logical, rstype);
            graph.currentlogicalpacked = packed;
            graph.currentobjstack = [];

            if (packed <= oldprogress) {
                return;
            }

            if (modename == "clientscriptops") {
                parseClientScriptValue(out, graph, source, obj as any, logical);
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

async function parseNameFiles(out: ScriptOutput, graph: ReferenceGraph, source: CacheFileSource) {
    out.log(`=== Parsing name files ===`);
    let oldprogressrows = await graph.db.getProgress.run("namefiles");
    let oldprogress = oldprogressrows?.[0]?.completed ?? 0;

    graph.currentlogicalmax = Math.max(...Object.values(internalNameFiles));
    for (let [mode, fileid] of Object.entries(internalNameFiles)) {
        if (out.state != "running") { break; }
        if (fileid <= oldprogress) { continue; }

        let decoder = vartypeToDecoder[mode] as BrowseModes | undefined;
        if (!decoder) {
            out.log(`No decoder for name file ${mode} - skipping`);
            continue;
        }

        graph.currentmode = decoder ?? mode;
        graph.currentobjstack = [];
        graph.currenttypedonly = false;

        let count = 0;
        let namedata = await source.getInternalNameList(fileid);
        for (let [id, name] of namedata) {
            graph.currentlogicalpacked = id;
            graph.addString("filename", name, "");
            if (++count % 1000 == 0) {
                // technically wrong progress id since we treat the entire name file as one file
                // however, we overflow the transaction limits otherwise
                await graph.maybeFlush("namefiles" as any, fileid);
            }
        }
        await graph.flush("namefiles" as any, fileid);
    }
    out.log(`name files completed`);
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
                // not tracking these for now
            } else if (typeof node.op.imm_obj == "number") {
                // int
                graph.addInt("const", node.op.imm_obj, typename);
            } else if (typeof node.op.imm_obj == "string") {
                // string
                graph.addString("const", node.op.imm_obj, typename);
                // embedded sprite tags
                node.op.imm_obj.matchAll(/<sprite=(\d+)(,\d+)?>/g).forEach(match => {
                    let spriteId = parseInt(match[1], 10);
                    graph.addInt("stringinsert", spriteId, "graphic");
                });
            }
        }
        if (isNamedOp(node, namedClientScriptOps.pushvar) || isNamedOp(node, namedClientScriptOps.popvar)) {
            let groupid = (node.op.imm >> 24) & 0xff;
            let varid = (node.op.imm >> 8) & 0xffff;
            let groupname = "var_" + (deob.varmeta.get(groupid) ?? ("unk" + groupid));
            graph.addInt(node.op.opcode == namedClientScriptOps.pushvar ? "read" : "write", varid, groupname as any);
        }
        if (isNamedOp(node, namedClientScriptOps.pushvarbit) || isNamedOp(node, namedClientScriptOps.popvarbit)) {
            graph.addInt(node.op.opcode == namedClientScriptOps.pushvarbit ? "read" : "write", node.op.imm, "varbit");
        }
        if (isNamedOp(node, namedClientScriptOps.gosub)) {
            graph.addInt("call", node.op.imm, "clientscript");
        }
    }
}

type RefEntry<T> = { srcmode: BrowseModes, srcid: number, propname: string, value: T, dstmode: ExtendedJsonFieldTypes };

class ReferenceGraph {
    params!: Map<number, params>;
    paramnames!: Map<number, string>;
    deob?: ClientscriptObfuscation;

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

    runIndexer(script: ScriptOutput, source: CacheFileSource, clientscript: boolean, extramodes: boolean) {
        return this.locked = this.locked.finally(async () => {
            if (script.state != "running") { return; }
            await calculateReferenceGraph(script, this, source, clientscript, extramodes);
        });
    }

    private static async initDB(db: AbstractSQLite) {
        // ===== int table =====
        await db.exec(`CREATE TABLE IF NOT EXISTS refints (srcdecoder TEXT, srcid UINT, propname TEXT, value INT, dsttype TEXT);`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_refints_value ON refints (value, dsttype);`);
        let addInt = await db.prepare<[srcdecoder: BrowseModes, srcid: number, propname: string, value: number, dsttype: ExtendedJsonFieldTypes], any>(
            `INSERT INTO refints (srcdecoder, srcid, propname, value, dsttype) VALUES (?,?,?,?,?)`);
        let addIntBatchSize = 32;
        let addIntBatchQuery =
            `INSERT INTO refints (srcdecoder, srcid, propname, value, dsttype) VALUES ${Array.from({ length: addIntBatchSize }).fill("(?,?,?,?,?)").join(",")}`;
        let addIntBatch = await db.prepare<any, any>(addIntBatchQuery);
        // ===== strings table =====
        await db.exec(`CREATE TABLE IF NOT EXISTS refstrings (srcdecoder TEXT, srcid UINT, propname TEXT, value TEXT, dsttype TEXT);`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_refstrings_value ON refstrings (value, dsttype);`);
        let addString = await db.prepare<[srcdecoder: BrowseModes, srcid: number, propname: string, value: string, dsttype: ExtendedJsonFieldTypes], any>(
            `INSERT INTO refstrings (srcdecoder, srcid, propname, value, dsttype) VALUES (?,?,?,?,?)`);
        // ===== progress table =====
        await db.exec(`CREATE TABLE IF NOT EXISTS progress (mode TEXT PRIMARY KEY, completed INT, max INT, intensity INT);`);
        let updateProgress = await db.prepare<[mode: string, completed: number, max: number, intensity: number], any>(
            `INSERT OR REPLACE INTO progress (mode, completed, max, intensity) VALUES (?,?,?,?)`);
        let getProgress = await db.prepare<[mode: string], { completed: number, max: number, intensity: number }>(
            `SELECT completed, max, intensity FROM progress WHERE mode=?`);
        // ===== search =====
        let findrefs = await db.prepare<[dsttype: ExtendedJsonFieldTypes, id: number, limit: number], { srcdecoder: BrowseModes, srcid: number, propname: string, value: number, dsttype: ExtendedJsonFieldTypes }>(
            `SELECT * FROM refints WHERE dsttype=? AND value=? GROUP BY srcdecoder,srcid LIMIT ?`);
        let findints = await db.prepare<[int: number, limit: number], { srcdecoder: BrowseModes, srcid: number, propname: string, value: number, dsttype: ExtendedJsonFieldTypes }>(
            `SELECT * FROM refints WHERE value=? LIMIT ?`);
        let findstrings = await db.prepare<[pattern: string, limit: number], { srcdecoder: BrowseModes, srcid: number, propname: string, value: string, dsttype: ExtendedJsonFieldTypes }>(
            `SELECT * FROM refstrings WHERE value LIKE ? LIMIT ?`);
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

        let backend = await AbstractSQLite.createAutoCache(dbname);
        builder.db = await ReferenceGraph.initDB(backend);
        return builder;
    }

    async flush(mode = this.currentmode, progress = this.currentlogicalpacked) {
        await this.db.sqlite.transaction(async () => {
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
            await this.db.updateProgress.run(mode, progress, this.currentlogicalmax, this.currenttypedonly ? 1 : 0);
        });
        this.intqueue = [];
        this.stringqueue = [];
    }

    async maybeFlush(mode = this.currentmode, progress = this.currentlogicalpacked) {
        if (this.intqueue.length + this.stringqueue.length > 10000) {
            await this.flush(mode, progress);
        }
    }

    addInt(propname: string, value: number, type: ExtendedJsonFieldTypes) {
        // let rsmvtype = vartypeToDecoder[type];
        // if (rsmvtype) { type = rsmvtype; }
        if (this.currenttypedonly && (type == "int" || type == "unknown" || type == "" || type == "unknown_int")) {
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
    addString(propname: string, value: string, type: ExtendedJsonFieldTypes) {
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
        for (let [modename, action] of Object.entries(allModes)) {
            if (action == "skip") { continue; }
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

    async findReferences(mode: ExtendedJsonFieldTypes, logical: LogicalIndex) {
        let packed = logicalIdToPackedInt(logical, mode);
        let res = await this.db.findrefs.run(mode, packed, 1000);
        return res.map(q => {
            return {
                srcdecoder: q.srcdecoder,
                srcpacked: q.srcid,
                propname: q.propname
            };
        });
    }

    async findStrings(pattern: string) {
        let res = await this.db.findstrings.run(pattern, 1000);
        return res.map(q => {
            let logical = packedIntToLogical(q.srcid, q.srcdecoder);
            return {
                srcmode: q.srcdecoder,
                srcpacked: q.srcid,
                srclogical: logical,
                srcobject: makeFileId(q.srcdecoder, logical),
                propname: q.propname,
                value: q.value,
                dstmode: q.dsttype
            };
        });
    }
}

function logicalIdToPackedInt(id: LogicalIndex, mode: ExtendedJsonFieldTypes | BrowseModes) {
    if (mode == "component" || mode == "components") {
        return packComponent(id[0], id[1]);
    }
    if (mode == "frames") {
        return packAnimFrame(id[0], id[1]);
    }
    if (mode == "coordgrid") {
        return packCoordgrid(id[0], id[1], id[2]);
    }
    if (mode == "mapsquare" || mode == "maptiles" || mode == "maptiles_nxt" || mode == "maplocations" || mode == "mapenvs") {
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

export function packedIntToLogical(id: number, mode: ExtendedJsonFieldTypes | BrowseModes) {
    if (mode == "component" || mode == "components") {
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
    if (mode == "mapsquare" || mode == "maptiles" || mode == "maptiles_nxt" || mode == "maplocations" || mode == "mapenvs") {
        let r = unpackMapsquare(id);
        return [r.x, r.z];
    }
    return [id];
}

export function traverseJsonSchema(meta: JSONSchema6Definition | null | undefined, prop: string) {
    if (typeof meta == "boolean" || !meta) { return; null; }

    // strip nullable type from schema
    if (meta?.oneOf) {
        meta = meta.oneOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
    }
    if (meta?.anyOf) {
        meta = meta.anyOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
    }
    if (!meta.properties || !meta.properties[prop]) { return null; }
    return meta.properties[prop];
}

export function iterateTypedJson(objstack: any[], meta: JSONSchema6Definition | null | undefined, data: any, nameorindex: string | number) {
    let rsmvtype: ExtendedJsonFieldTypes = meta?.["x-rsmv-type"] ?? "";

    // make typescript happy
    if (typeof meta == "boolean") { meta = null; }
    // strip nullable type from schema
    if (meta?.oneOf) {
        meta = meta.oneOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
        rsmvtype ||= meta?.["x-rsmv-type"];
    }
    if (meta?.anyOf) {
        meta = meta.anyOf.find(q => (q as JSONSchema6).type != "null") as JSONSchema6;
        rsmvtype ||= meta?.["x-rsmv-type"];
    }

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
        data = data & 0xffffff;
        if (domainid == 0) {
            rsmvtype = "achievement";
        } else if (domainid == 1) {
            rsmvtype = "varbit";
        } else if (domainid == 0xff && data == 0xffffff) {
            //null achievement
            rsmvtype = "achievement";
            data = -1;
        }
        else { console.log("unknown achievement_or_varbit domainid: " + domainid); }
    }
    return { rsmvtype, data, meta };
}

function parseParamtable(graph: ReferenceGraph, value: any[]) {
    for (let entry of value) {
        let paramname = graph.paramnames.get(entry.prop) ?? `param_${entry.prop}`;
        let paramdata = graph.params.get(entry.prop);
        let typeid = paramdata?.type?.vartype ?? -1;
        let typename = vartypeReverseMap.get(typeid) ?? "unknown" as const;
        if (entry.intvalue != undefined) { graph.addInt(paramname, entry.intvalue, typename); }
        if (entry.stringvalue != undefined) { graph.addString(paramname, entry.stringvalue, typename); }
        graph.addInt("" + (entry.intvalue ?? entry.stringvalue), entry.prop, "param");
    }
}

function parseClientScriptBinding(graph: ReferenceGraph, propname: string, data: any[]) {
    if (data.length == 0) { return; }
    let scriptid = data[0];
    graph.addInt(propname, scriptid, "clientscript");

    let scripttype = graph.deob?.scriptargs.get(scriptid);
    if (!scripttype || !scripttype.stack.exactin) { return; }

    let intcount = 0;
    let stringcount = 0;
    for (let i = 1; i < data.length; i++) {
        let arg = data[i];
        if (typeof arg == "number") {
            let argtype = scripttype.stack.exactin.int[intcount];
            let typename = vartypeReverseMap.get(argtype) ?? "int";
            graph.addInt(`${propname}_arg${i - 1}`, arg, typename);
            intcount++;
        }
        if (typeof arg == "string") {
            let argtype = scripttype.stack.exactin.string[stringcount];
            let typename = vartypeReverseMap.get(argtype) ?? "string";
            graph.addString(`${propname}_arg${i - 1}`, arg, typename);
            stringcount++;
        }
    }
}


function parseJsonValue(graph: ReferenceGraph, nameorindex: string | number, data: any, meta: JSONSchema6Definition | null | undefined) {
    let name = typeof nameorindex == "number" ? "" : nameorindex;
    graph.currentobjstack.push(data);
    try {
        // === find expected type ===
        let rsmvtype: ExtendedJsonFieldTypes;
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
            if (rsmvtype == "clientscriptbinding") {
                parseClientScriptBinding(graph, nameorindex.toString(), data);
            }
            if (rsmvtype == "paramtable") {
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
