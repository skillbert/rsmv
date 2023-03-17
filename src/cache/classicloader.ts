import { CacheFileSource, DirectCacheFileSource } from ".";
import { mapsquare_locations } from "../../generated/mapsquare_locations";
import { mapsquare_tiles } from "../../generated/mapsquare_tiles";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { objects } from "../../generated/objects";
import { ChunkData, classicChunkSize, MapRect, PlacedMesh, tiledimensions, TileGrid, TileGridSource, TileProps, tileshapes } from "../3d/mapsquare";
import { constModelsIds, EngineCache } from "../3d/modeltothree";
import { cacheFilenameHash, HSL2packHSL, ModelModifications, RGB2HSL, Stream } from "../utils";
import { ScriptFS } from "../viewer/scriptsui";


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

const classicLocIdWall = 100000;
const classicLocIdRoof = 200000;

//reverse lookup
const classicGroupNames = Object.fromEntries(Object.entries(classicGroups)
    .map(([name, id]) => [id, name]));

export class ClassicFileSource extends DirectCacheFileSource {
    files: Record<string, { file: Buffer, version: number, mem: boolean }[]> = {};

    constructor() {
        super(false);
    }

    async loadFiles(files: ScriptFS) {
        this.files = {};
        let filenames = await files.readDir(".");
        for (let filename of filenames) {
            let namematch = filename.match(/^(?<name>[a-zA-Z]+)(?<version>\d+)\.(?<type>jag|mem)$/);
            if (!namematch) { continue; }
            //TODO support members stuff
            if (namematch.groups!.type == "mem") { continue; }
            let file = await files.readFileBuffer(filename);
            let group = this.files[namematch.groups!.name] ??= [];
            group.push({
                file,
                mem: namematch.groups!.type == "mem",
                version: +namematch.groups!.version
            });
        }
        for (let group of Object.values(this.files)) {
            //sort highest number+members first
            group.sort((a, b) => a.version == b.version ? +a.mem - +b.mem : b.version - a.version);
        }

        console.log(await classicConfig(this));
    }

    getNamedFile(name: string) {
        let group = this.files[name];
        if (!group) { throw new Error(`no cache files for group ${name}`); }
        console.log("loading", name, group[0].version);
        return group[0].file;
    }

    getBuildNr() {
        return 200;//somewhat high rsc build nr
    }
    async getFile(major: number, minor: number) {
        if (major != 0) {
            throw new Error("all files are placed in index 0 for classic caches");
        }
        let name = classicGroupNames[minor];
        if (!name) { throw new Error(`no file for ${major}.${minor}`); }
        return this.getNamedFile(name);
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
        type: getubyte,
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

export async function getClassicMapData(engine: EngineCache, rs2x: number, rs2z: number, level: number) {
    let isunderground = rs2z > 100;

    let layer0 = await getClassicMapLayer(engine, rs2x, (isunderground ? rs2z - 100 : rs2z), (isunderground ? 3 : 0));
    let layer1 = (isunderground ? null : await getClassicMapLayer(engine, rs2x, rs2z, 1));
    let layer2 = (isunderground ? null : await getClassicMapLayer(engine, rs2x, rs2z, 2));

    let res = layer0;
    if (res && layer1) {
        res.levels = 2;
        res.tiles.push(...layer1.tiles);
        res.locs.push(...layer1.locs);
        if (layer2) {
            res.levels = 3;
            res.tiles.push(...layer2.tiles);
            res.locs.push(...layer2.locs);
        }
    }
    return res;
}

async function getClassicMapLayer(engine: EngineCache, rs2x: number, rs2z: number, level: number) {
    let chunkx = 100 - rs2x;
    let chunkz = 100 - rs2z;
    let chunknum = `${level}${chunkx.toString().padStart(2, "0")}${chunkz.toString().padStart(2, "0")}`;
    let datfile = await engine.findSubfileByName(0, classicGroups.maps, `M${chunknum}.DAT`);
    let locfile = await engine.findSubfileByName(0, classicGroups.maps, `M${chunknum}.LOC`);
    let heifile = await engine.findSubfileByName(0, classicGroups.land, `M${chunknum}.HEI`);

    let mappedtiles: mapsquare_tiles["tiles"] = new Array(chunkTileCount).fill(null).map(q => ({
        flags: 0
    } as mapsquare_tiles["tiles"][number]));

    let convertTileIndex = (i: number) => {
        const last = classicChunkSize - 1;
        let x = last - (i / classicChunkSize | 0);
        let z = last - i % classicChunkSize;
        return { index: x * classicChunkSize + z, x, z };
    }

    if (heifile) {
        let hei = new Stream(heifile.buffer);

        //based on https://github.com/2003scape/rsc-landscape/blob/master/src/sector.js#L138
        let lastVal = 0;
        let terrainHeight: number[] = [];
        let terrainColor: number[] = [];

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
        for (let tileY = 0; tileY < chunkSize; tileY++) {
            for (let tileX = 0; tileX < chunkSize; tileX++) {
                const index = tileX * chunkSize + tileY;

                lastHeight = terrainHeight[index] + (lastHeight & 0x7f);
                let height = (lastHeight * 2) & 0xff;

                lastColor = terrainColor[index] + lastColor & 0x7f;
                terrainColor[index] = (lastColor * 2) & 0xff;

                mappedtiles[convertTileIndex(index).index] = {
                    flags: 0,
                    height: height / 4,
                    overlay: null,
                    settings: null,
                    shape: null,
                    underlay: terrainColor[index] + 1 //1 offset as per rs2 spec
                }
            }
        }

        if (!hei.eof()) {
            throw new Error("unexpected height file length");
        }
    }

    let locrotations = new Uint32Array(chunkTileCount);
    let locs: mapsquare_locations["locations"] = [];
    if (datfile) {
        let dat = new Stream(datfile.buffer);
        let walls = dat.readBuffer(chunkTileCount * 4);

        for (let i = 0; i < chunkTileCount; i++) {
            let hor = walls[chunkTileCount * 0 + i];
            let ver = walls[chunkTileCount * 1 + i];
            let diag1 = walls[chunkTileCount * 2 + i];
            let diag2 = walls[chunkTileCount * 3 + i];
            let pos = convertTileIndex(i);
            if (hor) {
                locs.push({
                    id: classicLocIdWall + hor - 1,
                    uses: [{ x: pos.x, y: pos.z, plane: level, rotation: 2, type: 0, extra: null }]
                });
            }
            if (ver) {
                locs.push({
                    id: classicLocIdWall + ver - 1,
                    uses: [{ x: pos.x, y: pos.z, plane: level, rotation: 1, type: 0, extra: null }]
                });
            }
            if (diag1) {
                locs.push({
                    id: classicLocIdWall + diag1 - 1,
                    uses: [{ x: pos.x, y: pos.z, plane: level, rotation: 0, type: 9, extra: null }]
                });
            }
            if (diag2) {
                locs.push({
                    id: classicLocIdWall + diag2 - 1,
                    uses: [{ x: pos.x, y: pos.z, plane: level, rotation: 1, type: 9, extra: null }]
                });
            }
        }

        //roofs
        let debugroofs: number[] = [];
        for (let tile = 0; tile < chunkTileCount;) {
            let val = dat.readUByte();
            if (val < 128) {
                let pos = convertTileIndex(tile);
                locs.push({
                    id: classicLocIdRoof + val - 1,
                    uses: [{ x: pos.x, y: pos.z, plane: level, rotation: 0, type: 12, extra: null }]
                });
                debugroofs.push(val);
                tile++;
            } else {
                tile += val - 128;
                debugroofs.push(...new Array(val - 128).fill(0));
            }
        }
        // drawfile(debugroofs);

        //floor overlays
        let debugoverlays: number[] = [];
        let lastVal = 0;
        for (let tile = 0; tile < chunkTileCount;) {
            let val = dat.readUByte();
            let iter = 1;
            if (val < 128) {
                lastVal = val;
            } else {
                iter = val - 128;
            }
            for (let i = 0; i < iter; i++) {
                let index = convertTileIndex(tile);
                let floor = mappedtiles[index.index];
                // let overlay = engine.classicData!.tiles[lastVal];
                // floor.shape = overlay.type;
                if (lastVal != 0) {
                    floor.overlay = lastVal;
                    floor.shape = 0;//TODO remove
                }
                tile++;
                debugoverlays.push(lastVal);
            }
        }
        // drawfile(debugoverlays);

        //"tiledirection"
        for (let tile = 0; tile < chunkTileCount;) {
            let val = dat.readUByte();
            if (val < 128) {
                let index = convertTileIndex(tile);
                locrotations[index.index] = val;
                tile++;
            } else {
                tile += val - 128;
            }
        }
        if (!dat.eof()) { throw new Error("didn't end reading map.dat at end of file"); }
    }

    if (locfile) {
        let loc = new Stream(locfile.buffer);

        for (let tile = 0; tile < chunkTileCount;) {
            let val = loc.readUByte();
            if (val < 128) {
                let pos = convertTileIndex(tile++);
                let rotation = (4 + locrotations[pos.index]) % 8;
                let type = (rotation % 2 == 0 ? 10 : 11);
                locs.push({
                    id: val - 1,
                    uses: [{ x: pos.x, y: pos.z, plane: level, extra: null, rotation: rotation / 2 | 0, type }]
                })
            } else {
                tile += val - 128;
            }
        }
        console.log("locfile", loc.bytesLeft());
    }

    let rect: MapRect = { x: rs2x * chunkSize, z: rs2z * chunkSize, xsize: chunkSize, zsize: chunkSize };
    return {
        rect,
        tiles: mappedtiles,
        locs,
        levels: 1
    };
}

export function classicModifyTileGrid(grid: TileGrid) {
    //rs classic defines the origin of a tile as being at the northeast corner, however all later
    //versions (and this viewer) have it at the southwest, move over all tile colors and heights
    //to simulate this and howfully don't break too much
    for (let level = 0; level < grid.levels; level++) {
        for (let z = grid.zsize - 1; z >= 1; z--) {
            for (let x = grid.xsize - 1; x >= 1; x--) {
                let tile = grid.getTile(grid.xoffset + x, grid.zoffset + z, level)!;
                let targettile = grid.getTile(grid.xoffset + x - 1, grid.zoffset + z - 1, level)!;
                tile.y = targettile.y;
                tile.y01 = targettile.y01;
                tile.y10 = targettile.y10;
                tile.y11 = targettile.y11;
                tile.underlayprops = targettile.underlayprops;
            }
        }
    }
    for (let level = 0; level < grid.levels; level++) {
        for (let z = grid.zsize - 1; z >= 1; z--) {
            for (let x = grid.xsize - 1; x >= 1; x--) {
                let tile = grid.getTile(grid.xoffset + x, grid.zoffset + z, level)!;
                if (tile.rawOverlay) {
                    let top = grid.getTile(grid.xoffset + x, grid.zoffset + z + 1, level);
                    let left = grid.getTile(grid.xoffset + x - 1, grid.zoffset + z, level);
                    let right = grid.getTile(grid.xoffset + x + 1, grid.zoffset + z, level);
                    let bot = grid.getTile(grid.xoffset + x, grid.zoffset + z - 1, level);

                    // let hastop = top?.rawOverlay == tile.rawOverlay;
                    // let hasleft = left?.rawOverlay == tile.rawOverlay;
                    // let hasright = right?.rawOverlay == tile.rawOverlay;
                    // let hasbot = bot?.rawOverlay == tile.rawOverlay;
                    let hastop = !!top?.rawOverlay;
                    let hasleft = !!left?.rawOverlay;
                    let hasright = !!right?.rawOverlay;
                    let hasbot = !!bot?.rawOverlay;
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
    let locdata: objects = {};
    if (id >= classicLocIdRoof) {
        let rawloc = engine.classicData!.roofs[id - classicLocIdRoof];
        locdata = {
            name: `roof_${id - classicLocIdRoof}`,
            probably_morphFloor: true,
            models: [
                { type: 12, values: [constModelsIds.paperRoof] }
            ],
            //sets replace_colors/mats and if invisible sets models to null
            ...classicIntsToModelMods(rawloc.texture)
        }
    } else if (id >= classicLocIdWall) {
        let rawloc = engine.classicData!.wallobjects[id - classicLocIdWall];
        locdata = {
            name: rawloc.name,
            probably_morphFloor: true,
            models: [
                { type: 0, values: [constModelsIds.paperWall] },
                { type: 9, values: [constModelsIds.paperWallDiag] }
            ],
            //sets replace_colors/mats and if invisible sets models to null
            ...classicIntsToModelMods(rawloc.frontdecor, rawloc.backdecor)
        }
    } else {
        let loc = engine.classicData!.objects[id];
        if (loc.model.id == undefined) { console.warn(`model for ${loc.name} is missing`); }
        locdata = {
            name: loc.name,
            width: loc.xsize,
            length: loc.zsize,
            probably_morphFloor: true,
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