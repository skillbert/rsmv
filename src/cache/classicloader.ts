import { CacheFileSource, DirectCacheFileSource } from ".";
import { mapsquare_locations } from "../../generated/mapsquare_locations";
import { mapsquare_tiles } from "../../generated/mapsquare_tiles";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { objects } from "../../generated/objects";
import { ChunkData, classicChunkSize, MapRect, PlacedMesh, TileGrid, TileGridSource, TileProps } from "../3d/mapsquare";
import { EngineCache } from "../3d/modeltothree";
import { HSL2packHSL, ModelModifications, RGB2HSL, Stream } from "../utils";
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
        model: getstring,
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
    let chunkx = 100 - rs2x;
    let chunkz = 100 - rs2z;
    let chunknum = `${level}${chunkx.toString().padStart(2, "0")}${chunkz.toString().padStart(2, "0")}`;
    let datfile = await engine.findSubfileByName(0, classicGroups.maps, `M${chunknum}.DAT`);
    let locfile = await engine.findSubfileByName(0, classicGroups.maps, `M${chunknum}.LOC`);
    let heifile = await engine.findSubfileByName(0, classicGroups.land, `M${chunknum}.HEI`);


    if (!heifile) { return null; }

    if (!heifile) { throw new Error("need hei"); }

    let mappedtiles: mapsquare_tiles["tiles"] = new Array(chunkTileCount);

    let convertTileIndex = (i: number) => {
        const last = classicChunkSize - 1;
        let x = last - (i / classicChunkSize | 0);
        let z = last - i % classicChunkSize;
        return { index: x * classicChunkSize + z, x, z };
    }

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
                underlay: lastColor + 1 //1 offset as per rs2 spec
            }
        }
    }

    if (!hei.eof()) {
        throw new Error("unexpected height file length");
    }

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
                    id: hor - 1,
                    uses: [{ x: pos.x - 1, y: pos.z - 1, plane: level, rotation: 2, type: 0, extra: null }]
                });
            }
            if (ver) {
                locs.push({
                    id: ver - 1,
                    uses: [{ x: pos.x - 1, y: pos.z - 1, plane: level, rotation: 1, type: 0, extra: null }]
                });
            }
            if (diag1) {
                locs.push({
                    id: diag1 - 1,
                    uses: [{ x: pos.x - 1, y: pos.z - 1, plane: level, rotation: 0, type: 9, extra: null }]
                });
            }
            if (diag2) {
                locs.push({
                    id: diag2 - 1,
                    uses: [{ x: pos.x - 1, y: pos.z - 1, plane: level, rotation: 1, type: 9, extra: null }]
                });
            }
        }
    }

    let rect: MapRect = { x: rs2x * chunkSize, z: rs2z * chunkSize, xsize: chunkSize, zsize: chunkSize };
    return {
        rect,
        tiles: mappedtiles,
        locs,
        levels: 1
    };
}

function intToMods(int: number) {
    if (int == 12345678) {
        //TODO should be transparent/hidden
        return { material: 0, color: HSL2packHSL(...RGB2HSL(0, 0, 0)), invisible: true };
    } else if (int < 0) {
        let col = -int - 1;
        let r = (col >> 10) & 0x1f;
        let g = (col >> 5) & 0x1f;
        let b = (col >> 0) & 0x1f;
        return { material: 0, color: HSL2packHSL(...RGB2HSL(r, g, b)), invisible: false };
    } else {
        return { material: int, color: 0, invisible: false };
    }
}

export function classicIntToModelMods(int1: number, int2: number) {
    let mods1 = intToMods(int1);
    let mods2 = intToMods(int2);
    let r: objects = {
        color_replacements: [
            [0, mods1.color],
            [1, mods2.color]
        ],
        material_replacements: [
            [0, mods1.material + 1],
            [1, mods2.material + 1]
        ]
    };
    if (mods1.invisible || mods2.invisible) {
        r.models = null;
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

    return underlays;
}
