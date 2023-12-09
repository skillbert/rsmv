import { CacheFileSource, SubFile } from "./index";
import { EngineCache } from "../3d/modeltothree";
import { cacheFilenameHash, Stream } from "../utils";
import { legacybz2 } from "./compression";
import { parseLegacySprite, parseTgaSprite } from "../3d/sprite";
import { makeImageData } from "../imgutils";

export const legacyMajors = {
    data: 0,//mostly index 2 in dat2
    oldmodels: 1,//index 7 in dat2
    oldframebases: 2,//index 0 in dat2
    //3? has 636 files sprites?
    map: 4// index 5 in dat2
} as const;

export const legacyGroups = {
    //1 login 
    config: 2,
    //3 interface?
    sprites: 4,
    index: 5,
    textures: 6
} as const;

//pre-2006 caches
export function parseLegacyArchive(file: Buffer, major: number, isclassic: boolean): SubFile[] {
    if (!isclassic && major != 0) {
        return [{
            buffer: file,
            fileid: 0,
            namehash: null,
            offset: 0,
            size: file.byteLength
        }];
    }
    let stream = new Stream(file);
    let len = stream.readTribyte();
    let compressedlen = stream.readTribyte();
    if (compressedlen != len) {
        stream = new Stream(legacybz2(stream.readBuffer()));
        if (stream.bytesLeft() != len) { throw new Error("decompress failed"); }
    }

    let files: SubFile[] = [];
    let count = stream.readUShort(true);
    let filestream = stream.tee().skip(count * 10);
    for (let i = 0; i < count; i++) {
        let namehash = stream.readUInt(true);
        let subdecomplen = stream.readTribyte();
        let subcomplen = stream.readTribyte();
        let subfileoffset = filestream.scanloc();
        let subfile = filestream.readBuffer(subcomplen);
        if (subdecomplen != subcomplen) {
            subfile = legacybz2(subfile);
            if (subfile.length != subdecomplen) { throw new Error("decompress failed"); }
        }
        files.push({
            fileid: i,
            buffer: subfile,
            offset: subfileoffset,
            size: subdecomplen,
            namehash
        });
    }
    return files;
}

type Mapinfo = Map<number, { map: number, loc: number, crc: number, version: number }>;
type LegacyKeys = "items" | "objects" | "overlays" | "underlays" | "npcs" | "spotanims";
export type LegacyData = Record<LegacyKeys, Buffer[]> & {
    mapmeta: Mapinfo
}

export async function legacyPreload(engine: EngineCache) {
    let indexgroup = await engine.getArchiveById(legacyMajors.data, legacyGroups.index);
    let configgroup = await engine.getArchiveById(legacyMajors.data, legacyGroups.config);
    let r: LegacyData = {
        items: readLegacySubGroup(configgroup, "OBJ"),
        objects: readLegacySubGroup(configgroup, "LOC"),
        overlays: readLegacySubGroup(configgroup, "FLO"),
        npcs: readLegacySubGroup(configgroup, "NPC"),
        // spotanims: readLegacySubGroup(configgroup, "SPOT")
        underlays: [],
        spotanims: [],
        mapmeta: readLegacyMapIndex(indexgroup)
    }
    return r;
}

function readLegacyMapIndex(group: SubFile[]) {
    let indexname = cacheFilenameHash(`MAP_INDEX`, true);
    let versionname = cacheFilenameHash(`MAP_VERSION`, true);
    let crcname = cacheFilenameHash(`MAP_CRC`, true);
    let indexfile = group.find(q => q.namehash == indexname);
    let versionfile = group.find(q => q.namehash == versionname);
    let crcfile = group.find(q => q.namehash == crcname);
    if (!indexfile || !versionfile || !crcfile) { throw new Error(); }
    let index = new Stream(indexfile.buffer);
    let version = new Stream(versionfile.buffer);
    let crc = new Stream(crcfile.buffer);

    let mapinfo: Mapinfo = new Map();
    while (!index.eof()) {
        mapinfo.set(index.readUShort(true), {
            map: index.readUShort(true),
            loc: index.readUShort(true),
            crc: crc.readUInt(true),
            version: version.readUShort(true)
        });
        index.readUByte();//isf2p
    }
    return mapinfo;
}

function readLegacySubGroup(group: SubFile[], groupname: string) {
    let idxname = cacheFilenameHash(`${groupname}.IDX`, true);
    let datname = cacheFilenameHash(`${groupname}.DAT`, true);
    let idxfile = group.find(q => q.namehash == idxname);
    let datfile = group.find(q => q.namehash == datname);
    if (!idxfile || !datfile) { throw new Error(); }

    let idx = new Stream(idxfile.buffer);
    let count = idx.readUShort(true);
    let offset = 2;//skipping count
    let files: Buffer[] = [];
    for (let i = 0; i < count; i++) {
        let size = idx.readUShort(true);
        files.push(datfile.buffer.slice(offset, offset + size));
        offset += size;
    }
    return files;
}

async function getLegacyImage(source: CacheFileSource, name: string, usetga) {
    let filename = `${name}.${usetga ? "tga" : "dat"}`;
    let spritefile = await source.findSubfileByName(legacyMajors.data, legacyGroups.textures, filename);

    if (usetga) {
        return parseTgaSprite(spritefile!.buffer);
    } else {
        return parseLegacyImageFile(source, spritefile!.buffer);
    }
}

export async function parseLegacyImageFile(source: CacheFileSource, buf: Buffer) {
    let metafile = await source.findSubfileByName(legacyMajors.data, legacyGroups.textures, "INDEX.DAT");
    return parseLegacySprite(metafile!.buffer, buf);
}

export async function combineLegacyTexture(engine: EngineCache, name: string, subname: string, useTga: boolean) {
    let img = await getLegacyImage(engine, name, useTga);
    if (!subname) {
        return img;
    }
    let subimg = await getLegacyImage(engine, subname, useTga);


    if (subimg.img.width + subimg.x > img.img.width || subimg.img.height + subimg.y > img.img.height) {
        //TODO probably fixable by using subimg.fullwidth
        console.warn("tried to overlay image outside of dest bounds");
        return img;
        throw new Error("tried to overlay image outside of dest bounds");
    }
    let combined = makeImageData(img.img.data.slice(), img.img.width, img.img.height);
    for (let srcy = 0; srcy < subimg.img.height; srcy++) {
        for (let srcx = 0; srcx < subimg.img.width; srcx++) {
            let srci = (srcy * subimg.img.width + srcx) * 4;
            let dsti = ((srcy + subimg.y) * img.img.width + (srcx + subimg.x)) * 4;
            let subr = subimg.img.data[srci + 0];
            let subg = subimg.img.data[srci + 1];
            let subb = subimg.img.data[srci + 2];
            let suba = subimg.img.data[srci + 3];
            let forcetrans = (subr == 0 && subg == 255 && subb == 0 && suba == 255);
            let usesub = (suba == 255);
            combined.data[dsti + 0] = (forcetrans ? 0 : usesub ? subr : img.img.data[dsti + 0]);
            combined.data[dsti + 1] = (forcetrans ? 0 : usesub ? subg : img.img.data[dsti + 1]);
            combined.data[dsti + 2] = (forcetrans ? 0 : usesub ? subb : img.img.data[dsti + 2]);
            combined.data[dsti + 3] = (forcetrans ? 0 : usesub ? suba : img.img.data[dsti + 3]);
        }
    }
    return {
        x: img.x,
        y: img.y,
        fullwidth: img.fullwidth,
        fullheight: img.fullheight,
        img: combined
    };
}