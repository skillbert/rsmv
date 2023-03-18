import { CacheFileSource, CacheIndex } from ".";
import { cacheFilenameHash } from "../utils";
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


type CacheVersion = {
    config: number,
    maps: number,
    land: number,
    media: number,
    models: number,
    textures: number,
    entity: number,
    sounds: number,
    filter: number
}

type DetectedVersion = {
    buildnr: number,
    nativelocs: boolean,
    iscomplete: boolean,
    externallocs: {}[] | null,
    target: CacheVersion,
    foundjag: CacheVersion,
    foundmem: CacheVersion,
};

//subset of https://classic.runescape.wiki/w/User:Logg#Combined_update,_client,_and_cache_history_table
const classicBuilds: { name: string, buildnr: number, haslocs: boolean, versions: CacheVersion }[] = [{
    name: "dec 2001 - last original world data",
    buildnr: 115,
    haslocs: true,
    versions: {
        config: 48,
        maps: 27,
        land: 0,//land data is inside maps
        media: 28,
        models: 12,
        textures: 8,
        entity: 10,
        sounds: 0,
        filter: 0
    }
}, {
    name: "Last version of entered files",
    buildnr: 230,
    haslocs: true,
    versions: {
        config: 100,
        maps: 100,
        land: 100,
        media: 100,
        models: 100,
        textures: 100,
        entity: 100,
        sounds: 100,
        filter: 100
    }
}];

//reverse lookup
const classicGroupNames = Object.fromEntries(Object.entries(classicGroups)
    .map(([name, id]) => [id, name])) as Record<number, keyof typeof classicGroups>;

export class ClassicFileSource extends CacheFileSource {
    versions: DetectedVersion[] = [];
    usingversion: DetectedVersion | null = null;
    fs: ScriptFS | null = null;

    async loadFiles(files: ScriptFS) {
        this.fs = files;
        for (let build of classicBuilds) {
            this.versions.push({
                buildnr: build.buildnr,
                iscomplete: false,
                nativelocs: build.haslocs,
                externallocs: null,
                target: build.versions,
                foundjag: Object.fromEntries(Object.entries(build.versions).map(([key]) => [key, 0])) as CacheVersion,
                foundmem: Object.fromEntries(Object.entries(build.versions).map(([key]) => [key, 0])) as CacheVersion
            });
        }

        let filenames = await files.readDir(".");
        for (let filename of filenames) {
            let namematch = filename.match(/^(?<name>[a-zA-Z]+)(?<version>\d+)\.(?<type>jag|mem)$/);
            if (namematch) {
                let version = +namematch.groups!.version;
                let ismem = namematch.groups!.type == "mem";
                let cachename = namematch.groups!.name;
                //just ignore mem for versioning purposes for now
                for (let cache of this.versions) {
                    let found = (ismem ? cache.foundmem : cache.foundjag);
                    if (cache.target[cachename] && version <= cache.target[cachename] && version > found[cachename]) {
                        found[cachename] = version;
                    }
                }
            }
        }

        for (let cache of this.versions) {
            let complete = true;
            for (let key in cache.target) {
                if (cache.foundjag[key] != cache.target[key]) { complete = false; }
                //TODO only checking mem version, not if they are missing since we don't know if they should exist
                if (cache.foundmem[key] != 0 && cache.foundmem[key] != cache.target[key]) { complete = false; }
            }
            cache.iscomplete = complete;
        }
        let index = localStorage.rsmv_classicversion ?? "-1";
        this.usingversion = this.versions.at(+index)!;
    }

    async getFileArchive(meta: CacheIndex) {
        if (meta.major != 0) {
            throw new Error("all files are placed in index 0 for classic caches");
        }
        let name = classicGroupNames[meta.minor];
        let jagfile = await this.getNamedFile(name, false);
        let memfile = await this.getNamedFile(name, true);
        let jagarch = (!jagfile ? [] : parseLegacyArchive(jagfile, meta.major, true));
        let memarch = (!memfile ? [] : parseLegacyArchive(memfile, meta.major, true));
        if (jagarch.length == 0 && memarch.length == 0) {
            throw new Error("no files found in index " + meta.minor);
        }
        return [...jagarch, ...memarch];
    }

    async getNamedFile(name: keyof typeof classicGroups, mem: boolean) {
        if (!this.usingversion || !this.fs) {
            throw new Error("no classic files loaded in classic cache loader");
        }
        let version = (mem ? this.usingversion.foundmem : this.usingversion.foundjag)[name];
        if (!version) { return null; }
        let filename = `${name}${version}.${mem ? "mem" : "jag"}`;
        console.log("loading", filename);
        return this.fs.readFileBuffer(filename);
    }

    getBuildNr() {
        return this.usingversion?.buildnr ?? 200;//somewhat high rsc build nr
    }

    getCacheMeta() {
        if (!this.usingversion) {
            return { name: "Classic", descr: "no files loaded" };
        }
        return {
            name: `Classic ${this.getBuildNr()}`,
            descr: `${Object.entries(this.usingversion.foundjag).map(([key, v]) => `${key}: ${v}`).join("\n")}`
        }
    }

    async getFile(major: number, minor: number): Promise<Buffer> {
        throw new Error("can only load archives in a classic cache");
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

export async function classicConfig(source: CacheFileSource, buildnr: number) {
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
        price: (buildnr < 180 ? getushort : getuint),//exact build nr unknown
        stackable: getbool,
        special: getbool,
        equip: getushort,
        color: getuint,
        untradeable: (buildnr < 180 ? () => false : getbool),//exact build nr unknown
        member: (buildnr < 180 ? () => false : getbool)//exact build nr unknown
    });
    let npcs = mapprops(getushort(), {
        name: getstring,
        examine: getstring,
        command: (buildnr < 180 ? () => "" : getstring),//exact build nr unknown
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
