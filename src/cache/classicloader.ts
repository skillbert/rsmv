import { CacheFileSource, CacheIndex, DirectCacheFileSource } from ".";
import { mapsquare_locations } from "../../generated/mapsquare_locations";
import { mapsquare_tiles } from "../../generated/mapsquare_tiles";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { objects } from "../../generated/objects";
import { ChunkData, classicChunkSize, MapRect, PlacedMesh, tiledimensions, TileGrid, TileGridSource, TileProps, tileshapes } from "../3d/mapsquare";
import { constModelsIds, EngineCache } from "../3d/modeltothree";
import { cacheFilenameHash, HSL2packHSL, ModelModifications, RGB2HSL, Stream } from "../utils";
import { ScriptFS } from "../viewer/scriptsui";
import { parseLegacyArchive } from "./legacycache";


export const classicGroups = {
    //same as early rs2
    textures: 6,

    //classic only
    models: 101,
    entity: 102,
    maps: 103,
    land: 104,
    filter: 105,
    jagex: 106,
    media: 107,
    sounds: 108,
    config: 110
} as const;

const classicLocIdWall = 1000000;
const classicLocIdRoof = 2000000;

//reverse lookup
const classicGroupNames = Object.fromEntries(Object.entries(classicGroups)
    .map(([name, id]) => [id, name]));

type LocPlacementExtra = mapsquare_locations["locations"][number]["uses"][number]["extra"];

export class ClassicFileSource extends DirectCacheFileSource {
    files: Record<string, { file: Buffer, version: number }[]> = {};
    memfiles: Record<string, { file: Buffer, version: number }[]> = {};

    constructor() {
        super(false);
    }

    async loadFiles(files: ScriptFS) {
        this.files = {};
        let filenames = await files.readDir(".");
        for (let filename of filenames) {
            let namematch = filename.match(/^(?<name>[a-zA-Z]+)(?<version>\d+)\.(?<type>jag|mem)$/);
            if (!namematch) { continue; }
            let file = await files.readFileBuffer(filename);
            let ismem = namematch.groups!.type == "mem";
            let lookup = (ismem ? this.memfiles : this.files);
            let group = lookup[namematch.groups!.name] ??= [];
            group.push({ file: file, version: +namematch.groups!.version });
        }
        for (let group of [...Object.values(this.files), ...Object.values(this.memfiles)]) {
            //sort highest number+members first
            group.sort((a, b) => b.version - a.version);
        }
    }

    async getFileArchive(meta: CacheIndex) {
        if (meta.major != 0) {
            throw new Error("all files are placed in index 0 for classic caches");
        }
        let name = classicGroupNames[meta.minor];
        let jagfile = this.getNamedFile(name, false);
        let memfile = this.getNamedFile(name, true);
        let jagarch = (!jagfile ? [] : parseLegacyArchive(jagfile.file, meta.major, true));
        let memarch = (!memfile ? [] : parseLegacyArchive(memfile.file, meta.major, true));
        if (jagarch.length == 0 && memarch.length == 0) {
            throw new Error("no files found in index " + meta.minor);
        }
        return [...jagarch, ...memarch];
    }

    getNamedFile(name: string, mem: boolean) {
        let group = (mem ? this.memfiles : this.files)[name];
        if (!group) { return null; }
        console.log("loading", name, group[0].version, (mem ? "mem" : "jag"));
        return group[0];
    }

    getBuildNr() {
        return 200;//somewhat high rsc build nr
    }
    async getFile(major: number, minor: number) {
        throw new Error("classic cache getfile is not supported");
        return null!;
        if (major != 0) {
            throw new Error("all files are placed in index 0 for classic caches");
        }
        let name = classicGroupNames[minor];
        if (!name) { throw new Error(`no file for ${major}.${minor}`); }
        // return this.getNamedFile(name);
    }
}

function mapprops<T extends Record<string, any>>(count: number, template: { [key in keyof T]: () => T[key] }) {
    let res: T[] = new Array(count).fill(null).map(() => ({} as any));
    for (let [key, callback] of Object.entries(template)) {
        for (let i = 0; i < count; i++) {
            res[i][key as keyof T] = callback();
        }
    }
    return res;
}

export type ClassicConfig = Awaited<ReturnType<typeof classicConfig>>;

export async function classicConfig(source: CacheFileSource) {
    let modelarchive = await source.getArchiveById(0, classicGroups.models);

    let stringsbuf = (await source.findSubfileByName(0, classicGroups.config, "STRING.DAT"))!.buffer;
    let intbuf = (await source.findSubfileByName(0, classicGroups.config, "INTEGER.DAT"))!.buffer;

    let stringcursor = 0;
    let getstring = () => {
        let start = stringcursor;
        while (stringcursor < stringsbuf.length && stringsbuf[stringcursor++] != 0);
        return stringsbuf.toString("latin1", start, stringcursor - 1);
    }
    let intcursor = 0;
    let getuint = () => { let r = intbuf.readUint32BE(intcursor); intcursor += 4; return r; }
    let getint = () => { let r = intbuf.readInt32BE(intcursor); intcursor += 4; return r; }
    let getushort = () => { let r = intbuf.readUint16BE(intcursor); intcursor += 2; return r; }
    let getubyte = () => intbuf.readUint8(intcursor++);
    let getbool = () => !!getubyte();

    let items = mapprops(getushort(), {
        name: getstring,
        examine: getstring,
        command: getstring,
        sprite: getushort,
        price: getuint,
        stackable: getbool,
        special: getbool,
        equip: getushort,
        color: getuint,
        untradeable: getbool,
        member: getbool
    });
    let npcs = mapprops(getushort(), {
        name: getstring,
        examine: getstring,
        command: getstring,
        attack: getubyte,
        strength: getubyte,
        hits: getubyte,
        defence: getubyte,
        hostility: getubyte,
        anims: () => new Array(12).fill(null).map(getubyte),
        haircolor: getuint,
        topcolor: getuint,
        bottomcolor: getuint,
        skincolor: getuint,
        width: getushort,
        height: getushort,
        walkmodel: getubyte,
        combatmodel: getubyte,
        combatanim: getubyte
    });
    let textures = mapprops(getushort(), {
        name: getstring,
        subname: getstring
    });
    let anims = mapprops(getushort(), {
        name: getstring,
        color: getuint,
        gendermodel: getubyte,
        has_a: getbool,
        has_f: getbool,
        unk: getubyte
    });
    let objects = mapprops(getushort(), {
        name: getstring,
        examine: getstring,
        command_0: getstring,
        command_1: getstring,
        model: () => {
            let name = getstring();
            let namehash = cacheFilenameHash(`${name}.ob3`, true);
            let id = modelarchive.find(q => q.namehash == namehash)?.fileid;
            return { name, id };
        },
        xsize: getubyte,
        zsize: getubyte,
        type: getubyte,
        item_height: getubyte
    });
    let wallobjects = mapprops(getushort(), {
        name: getstring,
        examine: getstring,
        command_0: getstring,
        command_1: getstring,
        height: getushort,
        frontdecor: getint,
        backdecor: getint,
        blocked: getbool,
        invisible: getbool
    });
    let roofs = mapprops(getushort(), {
        height: getubyte,
        texture: getubyte
    });
    let tiles = mapprops(getushort(), {
        decor: getuint,
        type: () => {
            let type = getubyte();
            return {
                type,
                autoconnect: type == 1 || type == 3,
                indoors: type == 2,
                iswater: type == 3,
                bridge: type == 4
            };
        },
        blocked: getbool
    });
    let projectile = mapprops(getushort(), {
        //empty
    });
    let spells = mapprops(getushort(), {
        name: getstring,
        examine: getstring,
        level: getubyte,
        num_runes: getubyte,
        type: getubyte,
        runetypes: () => new Array(getubyte()).fill(null).map(getushort),
        runeamounts: () => new Array(getubyte()).fill(null).map(getubyte)
    });
    let prayers = mapprops(getushort(), {
        name: getstring,
        examine: getstring,
        level: getubyte,
        drain: getubyte
    });

    console.log(`decoded rsc config, ints ${intcursor}/${intbuf.length}, strings ${stringcursor}/${stringsbuf.length}`);

    return { items, npcs, textures, anims, objects, wallobjects, roofs, tiles, projectile, spells, prayers }
}

const chunkSize = 48;
const chunkTileCount = chunkSize * chunkSize;

export async function getClassicMapData(engine: EngineCache, rs2x: number, rs2z: number) {
    let isunderground = rs2z > 100;

    const config = engine.classicData!;
    let chunkx = 100 - rs2x;
    let chunkz = 100 - rs2z;
    let chunknum = `${chunkx.toString().padStart(2, "0")}${chunkz.toString().padStart(2, "0")}`;

    //early return before allocating all kinds of stuff if chunk doesn't exist
    let heifiles: (Buffer | undefined)[] = [];

    let nlevels = (isunderground ? 1 : 3);
    for (let level = 0; level < nlevels; level++) {
        let sourcelevel = (isunderground ? 3 : level);
        let heifile = await engine.findSubfileByName(0, classicGroups.land, `M${sourcelevel}${chunknum}.HEI`);
        if (!heifile && level == 0) {
            //return before allocating all kinda of stuff if chunk doesn't exist
            return null;
        }
        heifiles.push(heifile?.buffer);
    }
    let grid = new ClassicMapBuilder(config, nlevels);
    for (let level = 0; level < nlevels; level++) {
        let heibuf = heifiles[level];
        if (heibuf) {
            grid.loadHeiFile(heibuf, level);
        }
    }
    for (let level = 0; level < nlevels; level++) {
        let sourcelevel = (isunderground ? 3 : level);
        let datfile = await engine.findSubfileByName(0, classicGroups.maps, `M${sourcelevel}${chunknum}.DAT`);
        let locfile = await engine.findSubfileByName(0, classicGroups.maps, `M${sourcelevel}${chunknum}.LOC`);
        if (datfile) {
            grid.loadDatfile(datfile.buffer, level);
        }
        if (locfile) {
            grid.loadLocFile(locfile.buffer, level);
        }
    }

    let rect: MapRect = { x: rs2x * chunkSize, z: rs2z * chunkSize, xsize: chunkSize, zsize: chunkSize }

    return {
        rect,
        tiles: grid.convertTiles(),
        locs: grid.locs,
        levels: nlevels
    };
}


let indexToPos = (i: number) => {
    const last = classicChunkSize - 1;
    let x = last - (i / classicChunkSize | 0);
    let z = last - i % classicChunkSize;
    return { rs2index: x * classicChunkSize + z, x, z };
}
let posToIndex = (x: number, z: number) => {
    return (classicChunkSize - 1 - x) * chunkSize + (classicChunkSize - 1 - z);
}

type ClassicTileDef = {
    // def: mapsquare_tiles["tiles"][number],
    height: number,
    hasbridge: boolean,
    wall: " " | "|" | "-" | "/" | "\\",
    loc: number,
    roof: number,
    overlayobj: ClassicConfig["tiles"][number] | null,
    overlay: number,
    underlay: number,
    locrotation: number
};

class ClassicMapBuilder {
    levels: number;
    tiles: ClassicTileDef[];
    locs: mapsquare_locations["locations"] = [];
    config: ClassicConfig;
    constructor(config: ClassicConfig, maxlevels: number) {
        this.config = config;
        this.levels = maxlevels;
        this.tiles = new Array(chunkTileCount * maxlevels).fill(null).map((q, i) => ({
            height: (i > chunkTileCount ? 96 : 0),//based on wall height 192/128*tilesize=768
            hasbridge: false,
            loc: 0,
            wall: " ",
            roof: 0,
            overlayobj: null,
            overlay: 0,
            underlay: 0,
            locrotation: 0
        }));
    }

    getTile(level: number, x: number, z: number) {
        if (x < 0 || z < 0 || x >= chunkSize || z >= chunkSize) { return undefined; }
        if (level < 0 || level >= this.levels) { return undefined; }
        return this.tiles[level * chunkTileCount + x * chunkSize + z];
    }

    getTileClassic(level: number, index: number) {
        const last = classicChunkSize - 1;
        let x = last - (index / classicChunkSize | 0);
        let z = last - index % classicChunkSize;
        return this.getTile(level, x, z);
    }

    placeLoc(id: number, type: number, rotation: number, level: number, x: number, z: number, extra: LocPlacementExtra = null) {
        let above = this.getTile(level + 1, x, z);
        if (above?.overlayobj?.type.bridge) {
            level++;
        } else if (type == 0) {
            //check other tile if our loc is a wall between two tiles
            let neighbour = (rotation == 2 ? this.getTile(level + 1, x + 1, z) : this.getTile(level + 1, x, z + 1));
            if (neighbour?.overlayobj?.type.bridge) {
                level++;
            }
        }
        this.locs.push({
            id,
            uses: [{ x, y: z, plane: level, rotation, type, extra }]
        });
    }

    convertTiles() {
        return this.tiles.map<mapsquare_tiles["tiles"][number]>((tile, i) => {
            let level = Math.floor(i / chunkTileCount);
            let below = this.tiles[i - chunkTileCount];
            return {
                height: (tile.hasbridge ? (level == 1 && below.hasbridge ? below.height / 4 : 0) : tile.height / 4),
                flags: 0,
                settings: (level == 1 && tile.hasbridge ? 2 : 0),
                overlay: tile.overlay,
                underlay: tile.underlay,
                shape: (tile.overlay ? 0 : null)
            }
        })
    }

    loadHeiFile(heifile: Buffer, level: number) {
        let hei = new Stream(heifile);

        //based on https://github.com/2003scape/rsc-landscape/blob/master/src/sector.js#L138
        let lastVal = 0;
        let terrainHeight = new Uint32Array(chunkTileCount);
        let terrainColor = new Uint32Array(chunkTileCount);

        for (let tile = 0; tile < chunkTileCount;) {
            let val = hei.readUByte();
            if (val < 128) {
                terrainHeight[tile++] = val & 0xff;
                lastVal = val;
            }
            if (val >= 128) {
                for (let i = 0; i < val - 128; i++) {
                    terrainHeight[tile++] = lastVal & 0xff;
                }
            }
        }
        for (let tile = 0; tile < chunkTileCount;) {
            let val = hei.readUByte();
            if (val < 128) {
                terrainColor[tile++] = val & 0xff;
                lastVal = val;
            }
            if (val >= 128) {
                for (let i = 0; i < val - 128; i++) {
                    terrainColor[tile++] = lastVal & 0xff;
                }
            }
        }

        let lastHeight = 64;
        let lastColor = 35;
        for (let classicY = 0; classicY < chunkSize; classicY++) {
            for (let classicX = 0; classicX < chunkSize; classicX++) {
                let index = classicX * chunkSize + classicY;

                lastHeight = terrainHeight[index] + (lastHeight & 0x7f);
                let height = (lastHeight * 2) & 0xff;

                lastColor = terrainColor[index] + lastColor & 0x7f;
                terrainColor[index] = (lastColor * 2) & 0xff;

                let tile = this.getTileClassic(level, index);
                if (!tile) { continue; }
                tile.height = height;
                tile.underlay = terrainColor[index] + 1;
            }
        }

        if (!hei.eof()) {
            throw new Error("unexpected height file length");
        }
    }

    loadDatfile(datfile: Buffer, level: number) {
        let dat = new Stream(datfile);
        let horbuffer = dat.readBuffer(chunkTileCount);
        let verbuffer = dat.readBuffer(chunkTileCount);
        let diag1buffer = dat.readBuffer(chunkTileCount);
        let diag2buffer = dat.readBuffer(chunkTileCount);

        //decode roofs
        let roofids = new Uint32Array(chunkTileCount);
        for (let tile = 0; tile < chunkTileCount;) {
            let val = dat.readUByte();
            if (val < 128) {
                roofids[tile] = val;
                tile++;
            } else {
                tile += val - 128;
            }
        }

        let bridgefytile = (level: number, x: number, z: number) => {
            let tile00 = this.getTile(level, x, z);
            let tile01 = this.getTile(level, x - 1, z);
            let tile10 = this.getTile(level, x, z - 1);
            let tile11 = this.getTile(level, x - 1, z - 1);

            if (tile00) { tile00.hasbridge = true; }
            if (tile01) { tile01.hasbridge = true; }
            if (tile10) { tile10.hasbridge = true; }
            if (tile11) { tile11.hasbridge = true; }
        }
        let tryExtendBridge = (level: number, x: number, z: number, bridgeid: number, waterid: number) => {
            let tile = this.getTile(level, x, z);
            if (tile && tile.overlay != waterid && tile.overlay != bridgeid) {
                let above = this.getTile(level + 1, x, z);
                if (above) {
                    above.overlay = bridgeid;
                    above.overlayobj = this.config.tiles[bridgeid - 1];
                }
                bridgefytile(level + 1, x, z);
            }
        }

        //decode and place floor overlays
        let lastVal = 0;
        for (let tileindex = 0; tileindex < chunkTileCount;) {
            let val = dat.readUByte();
            let iter = 1;
            if (val < 128) {
                lastVal = val;
            } else {
                iter = val - 128;
            }
            for (let i = 0; i < iter; i++) {
                let tile = this.getTileClassic(level, tileindex);
                if (!tile) { continue; }
                let overlay = this.config.tiles[lastVal - 1];
                if (lastVal != 0) {
                    tile.overlay = lastVal;
                    tile.overlayobj = overlay;
                }
                tileindex++;
            }
        }

        //seperate pass for bridges
        for (let tileindex = 0; tileindex < chunkTileCount; tileindex++) {
            let tile = this.getTileClassic(0, tileindex);
            if (tile?.overlayobj?.type.bridge) {
                //no known place for this in cache
                //the water type under the bridge depends on the bridge itself
                let waterid = (tile.overlay == 12 ? 11 : 2);
                let pos = indexToPos(tileindex);
                let tileabove = this.getTile(level + 1, pos.x, pos.z);
                //force neighbour vertices to 0 height
                tile.hasbridge = true;
                bridgefytile(level, pos.x, pos.z);
                bridgefytile(level + 1, pos.x, pos.z);
                tryExtendBridge(level, pos.x + 1, pos.z, tile.overlay, waterid);
                tryExtendBridge(level, pos.x - 1, pos.z, tile.overlay, waterid);
                tryExtendBridge(level, pos.x, pos.z + 1, tile.overlay, waterid);
                tryExtendBridge(level, pos.x, pos.z - 1, tile.overlay, waterid);

                if (tileabove) {
                    tileabove.height = tile.height;
                    tileabove.overlay = tile.overlay;
                    tileabove.overlayobj = tile.overlayobj;
                }
                let watertype = this.config.tiles[waterid - 1];
                tile.overlay = waterid;
                tile.overlayobj = watertype;
            }
        }

        let wallscale = (wallnr: number): LocPlacementExtra => {
            let wall = this.config.wallobjects[wallnr - 1];
            return { flags: 0, rotation: null, scale: null, scaleX: null, scaleY: wall.height, scaleZ: null, translateX: null, translateY: null, translateZ: null };
        }

        //walls
        for (let i = 0; i < chunkTileCount; i++) {
            let hor = horbuffer[i];
            let ver = verbuffer[i];
            let diag1 = diag1buffer[i];
            let diag2 = diag2buffer[i];
            let pos = indexToPos(i);
            if (hor) { this.placeLoc(classicLocIdWall + (hor - 1), 0, 2, level, pos.x, pos.z, wallscale(hor)); }
            if (ver) { this.placeLoc(classicLocIdWall + (ver - 1), 0, 1, level, pos.x, pos.z, wallscale(ver)); }
            if (diag1) { this.placeLoc(classicLocIdWall + (diag1 - 1), 9, 0, level, pos.x, pos.z, wallscale(diag1)); }
            if (diag2) { this.placeLoc(classicLocIdWall + (diag2 - 1), 9, 1, level, pos.x, pos.z, wallscale(diag2)); }
        }

        //TODO all of this is dumb, just use a buffer
        type RoofTile = "none" | "diagedge" | "full";
        let rooftype = (x: number, z: number): RoofTile => {
            if (x < 0 || x >= chunkSize || z < 0 || z >= chunkSize) { return "none"; }
            let index = posToIndex(x, z);
            if (roofids[index] == 0) { return "none"; }
            if (diag1buffer[index] != 0 || diag2buffer[index] != 0) { return "diagedge"; }
            return "full";
        }
        let findrooftype = (x: number, z: number): { type: number, rot: number } => {
            let neighbours: RoofTile[] = [
                rooftype(x + 1, z),//e
                rooftype(x + 1, z - 1),//se
                rooftype(x, z - 1),//s
                rooftype(x - 1, z - 1),//sw
                rooftype(x - 1, z),//w
                rooftype(x - 1, z + 1),//nw
                rooftype(x, z + 1),//north
                rooftype(x + 1, z + 1),//ne
            ];
            let selftype = rooftype(x, z);

            //high flat
            if (neighbours.every((q, i) => (i % 2 == 0 ? q == "full" : q != "none"))) {
                return { type: 17, rot: 0 };
            }

            for (let rot = 0; rot < 4; rot++) {
                let front = neighbours[(rot * 2 + 0) % 8];
                let right = neighbours[(rot * 2 + 2) % 8];
                let back = neighbours[(rot * 2 + 4) % 8];
                let left = neighbours[(rot * 2 + 6) % 8];
                let frontright = neighbours[(rot * 2 + 1) % 8];
                let backright = neighbours[(rot * 2 + 3) % 8];
                let backleft = neighbours[(rot * 2 + 5) % 8];
                let frontleft = neighbours[(rot * 2 + 7) % 8];
                //corner
                if (front == "none" && right == "none" && left != "none" && back != "none" && backleft != "none") {
                    return { type: (selftype == "diagedge" ? 13 : 16), rot };
                }
                //edge
                if (front == "none" && right != "none" && left != "none" && back != "none") {
                    //super weird inbetween section turns this into a corner (used in fally castle)
                    if (backright == "none") {
                        return { type: 16, rot };
                    }
                    if (backleft == "none") {
                        return { type: 16, rot: (rot + 3) % 4 };
                    }
                    return { type: 12, rot };
                }
                //concave corner
                if (front != "none" && right != "none" && left == "full" && back == "full" && frontright == "none") {
                    return { type: 14, rot };
                }
                //double convex diagonal roof
                if (front != "none" && right != "none" && left != "none" && back != "none" && frontright == "none" && backleft == "none") {
                    return { type: 15, rot };
                }
            }

            //low flat if no other shapes match
            //doesn't really exist in rs2, use loc type 10
            return { type: 10, rot: 0 };
        }

        for (let tile = 0; tile < roofids.length; tile++) {
            let id = roofids[tile];
            if (id != 0) {
                let pos = indexToPos(tile);
                let type = findrooftype(pos.x, pos.z);
                this.placeLoc(classicLocIdRoof + id - 1, type.type, type.rot, level, pos.x, pos.z);
            }
        }

        //rotation of locs on this tile
        for (let tileindex = 0; tileindex < chunkTileCount;) {
            let val = dat.readUByte();
            if (val < 128) {
                let tile = this.getTileClassic(level, tileindex);
                if (tile) {
                    tile.locrotation = val;
                }
                tileindex++;
            } else {
                tileindex += val - 128;
            }
        }
        if (!dat.eof()) { throw new Error("didn't end reading map.dat at end of file"); }
    }

    loadLocFile(locfile: Buffer, level: number) {
        let loc = new Stream(locfile);

        let locids = new Uint32Array(chunkTileCount);
        for (let tile = 0; tile < chunkTileCount;) {
            let val = loc.readUByte();
            if (val < 128) {
                locids[tile++] = val;
            } else {
                tile += val - 128;
            }
        }
        for (let tileindex = 0; tileindex < chunkTileCount; tileindex++) {
            let locid = locids[tileindex];
            if (locid) {
                let pos = indexToPos(tileindex);
                let obj = this.config.objects[locid - 1];
                //make sure we are the calling tile for this loc
                let isoverflow = false;
                for (let dx = 0; dx < obj.xsize; dx++) {
                    for (let dz = 0; dz < obj.zsize; dz++) {
                        if (dx == 0 && dz == 0) { continue; }
                        //TODO are there >1x1 locs in classic accros chunk borders? this will break
                        if (pos.x - dx < 0 || pos.z - dz < 0) { continue; }
                        let otherindex = posToIndex(pos.x - dx, pos.z - dz);
                        if (locids[otherindex] == locid) {
                            isoverflow = true;
                        }
                    }
                }
                if (!isoverflow) {
                    let tile = this.getTileClassic(level, tileindex);
                    if (tile) {
                        let rotation = (4 + tile?.locrotation) % 8;
                        let type = (rotation % 2 == 0 ? 10 : 11);
                        this.placeLoc(locid - 1, type, Math.floor(rotation / 2), level, pos.x, pos.z);
                    }
                }
            }
        }

        if (!loc.eof()) { throw new Error("didn't end reading map.loc at end of file"); }
    }
}

export function classicModifyTileGrid(grid: TileGrid) {
    //rs classic defines the origin of a tile as being at the northeast corner, however all later
    //versions (and this viewer) have it at the southwest, move over all tile colors and heights
    //to simulate this and howfully don't break too much
    for (let level = 0; level < grid.levels; level++) {
        for (let z = grid.zsize - 1; z >= 1; z--) {
            for (let x = grid.xsize - 1; x >= 1; x--) {
                let tile = grid.getTile(grid.xoffset + x, grid.zoffset + z, level);
                let targettile = grid.getTile(grid.xoffset + x - 1, grid.zoffset + z - 1, level);
                if (!tile || !targettile) { continue; }
                tile.y = targettile.y;
                tile.underlayprops = targettile.underlayprops;

                //no fancy partial roof stuff
                tile.effectiveLevel = level;
                tile.effectiveVisualLevel = level;
            }
        }
    }

    let getoverlay = (tile: TileProps | undefined) => (tile?.raw.overlay ? grid.engine.classicData!.tiles[tile.raw.overlay! - 1] : undefined);

    for (let level = 0; level < grid.levels; level++) {
        for (let z = grid.zsize - 1; z >= 1; z--) {
            for (let x = grid.xsize - 1; x >= 1; x--) {
                let tile = grid.getTile(grid.xoffset + x, grid.zoffset + z, level);
                let overlay = getoverlay(tile);
                if (tile && (overlay?.type.autoconnect || overlay?.type.indoors)) {
                    if (overlay.blocked) {
                        if (tile.rawCollision) { tile.rawCollision.walk[0] = true; }
                        if (tile.effectiveCollision) { tile.effectiveCollision.walk[0] = true; }
                    }

                    let top = getoverlay(grid.getTile(grid.xoffset + x, grid.zoffset + z + 1, level));
                    let left = getoverlay(grid.getTile(grid.xoffset + x - 1, grid.zoffset + z, level));
                    let right = getoverlay(grid.getTile(grid.xoffset + x + 1, grid.zoffset + z, level));
                    let bot = getoverlay(grid.getTile(grid.xoffset + x, grid.zoffset + z - 1, level));

                    let hastop = (overlay.type.indoors ? top?.type.indoors : top?.type.autoconnect);
                    let hasleft = (overlay.type.indoors ? left?.type.indoors : left?.type.autoconnect);
                    let hasright = (overlay.type.indoors ? right?.type.indoors : right?.type.autoconnect);
                    let hasbot = (overlay.type.indoors ? bot?.type.indoors : bot?.type.autoconnect);

                    if (hastop && hasleft && !hasbot && !hasright) { tile.shape = tileshapes[5]; }
                    if (hastop && !hasleft && !hasbot && hasright) { tile.shape = tileshapes[6]; }
                    if (!hastop && !hasleft && hasbot && hasright) { tile.shape = tileshapes[7]; }
                    if (!hastop && hasleft && hasbot && !hasright) { tile.shape = tileshapes[4]; }
                }
            }
        }
    }
}

export function classicDecodeMaterialInt(int: number) {
    let material = 0;
    let invisible = false;
    let color: [number, number, number] = [255, 255, 255];
    if (int > 99999999) {
        //??????????????? ask mr gower
        int = 99999999 - int;
    }
    if (int == 12345678) {
        //TODO should be transparent/hidden
        invisible = true;
    } else if (int < 0) {
        let col = -int - 1;
        let r = (col >> 10) & 0x1f;
        let g = (col >> 5) & 0x1f;
        let b = (col >> 0) & 0x1f;
        color = [r, g, b];
    } else {
        material = int + 1;
    }
    return {
        color,
        colorint: HSL2packHSL(...RGB2HSL(...color)),
        material,
        invisible
    };
}

export function getClassicLoc(engine: EngineCache, id: number) {
    const config = engine.classicData!;
    let locdata: objects = {};
    if (id >= classicLocIdRoof) {
        let rawloc = config.roofs[id - classicLocIdRoof];
        locdata = {
            name: `roof_${id - classicLocIdRoof}`,
            // probably_morphFloor: true,
            models: [
                { type: 10, values: [constModelsIds.classicRoof10] },
                { type: 12, values: [constModelsIds.classicRoof12] },
                { type: 13, values: [constModelsIds.classicRoof13] },
                { type: 14, values: [constModelsIds.classicRoof14] },
                { type: 15, values: [constModelsIds.classicRoof15] },
                { type: 16, values: [constModelsIds.classicRoof16] },
                { type: 17, values: [constModelsIds.classicRoof17] }
            ],
            //sets replace_colors/mats and if invisible sets models to null
            ...classicIntsToModelMods(rawloc.texture)
        }
    } else if (id >= classicLocIdWall) {
        let rawloc = config.wallobjects[id - classicLocIdWall];
        locdata = {
            name: rawloc.name,
            probably_morphFloor: true,
            models: [
                { type: 0, values: [constModelsIds.classicWall] },
                { type: 9, values: [constModelsIds.classicWallDiag] }
            ],
            //sets replace_colors/mats and if invisible sets models to null
            ...classicIntsToModelMods(rawloc.frontdecor, rawloc.backdecor)
        }
    } else {
        let loc = config.objects[id];
        if (loc.model.id == undefined) { console.warn(`model for ${loc.name} is missing`); }
        locdata = {
            name: loc.name,
            width: loc.xsize,
            length: loc.zsize,
            // probably_morphFloor: true,
            models: [
                { type: 10, values: (loc.model.id == undefined ? [] : [loc.model.id]) }
            ]
        }
    }
    return locdata;
}

export function classicIntsToModelMods(...matints: number[]) {
    let r: objects = {
        color_replacements: [],
        material_replacements: []
    };
    for (let [i, matint] of matints.entries()) {
        let mods = classicDecodeMaterialInt(matint);
        r.color_replacements!.push([i, mods.colorint]);
        r.material_replacements!.push([i, mods.material]);
        if (mods.invisible) { r.models = null; }
    }
    return r;
}

export function classicUnderlays() {
    let underlays: mapsquare_underlays[] = [];

    for (let i = 0; i < 64; i += 1) {
        const r = 255 - i * 4;
        const g = 255 - ((i * 1.75) | 0);
        const b = 255 - i * 4;

        underlays.push({ color: [r, g, b] });
    }

    for (let i = 0; i < 64; i += 1) {
        const r = i * 3;
        const g = 144;
        const b = 0;

        underlays.push({ color: [r, g, b] });
    }

    for (let i = 0; i < 64; i += 1) {
        const r = 192 - ((i * 1.5) | 0);
        const g = 144 - ((i * 1.5) | 0);
        const b = 0;

        underlays.push({ color: [r, g, b] });
    }

    for (let l = 0; l < 64; l++) {
        const r = 96 - ((l * 1.5) | 0);
        const g = 48 + ((l * 1.5) | 0);
        const b = 0;

        underlays.push({ color: [r, g, b] });
    }

    //something something rsc engine darkens it a lot with lighting
    underlays.forEach(q => { q.color![0] /= 2; q.color![1] /= 2; q.color![2] /= 2 })

    return underlays;
}

function drawfile(file: ArrayLike<number>) {
    let chrs = ["  ", "..", "--", "++", "==", "nn", "88", "@@", "@@"];

    let r = "";
    let mapsize = 48 * 48;
    for (let offset = 0; offset + mapsize <= file.length; offset += mapsize) {
        for (let y = 0; y < 48; y++) {
            for (let x = 0; x < 48; x++) {
                let index = offset + (47 - x) * 48 + y;
                // r += file[index] ? "xxx" : "   ";
                r += chrs[(file[index] + 31) / 32 | 0];
            }
            r += "\n";
        }
        r += "\n----------------------\n";
    }
    console.log(r);
    return r;
}