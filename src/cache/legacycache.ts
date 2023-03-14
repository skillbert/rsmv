import { SubFile } from "./index";
import { EngineCache } from "../3d/modeltothree";
import { cacheFilenameHash, Stream } from "../utils";
import { legacybz2 } from "./compression";

export const legacyMajors = {
    data: 0,//mostly index 2 in dat2
    oldmodels: 1,//index 7 in dat2
    oldframebases: 2,//index 0 in dat2
    //3? has 636 files sprites?
    map: 4// index 5 in dat2
}

export const legacyGroups = {
    //1 login 
    config: 2,
    //3 interface?
    sprites: 4,
    index: 5,
    textures: 6
}

//pre-2006 caches
export function parseLegacyArchive(file: Buffer, major: number, minor: number): SubFile[] {
    if (major != 0) {
        return [{
            buffer: file,
            fileid: 0,
            namehash: null,
            offset: 0,
            size: file.byteLength
        }];
    }
    let stream = new Stream(file);
    let compressedlen = stream.readTribyte();
    let len = stream.readTribyte();
    if (compressedlen != len) {
        stream = new Stream(legacybz2(stream.readBuffer()));
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
globalThis.parseLegacyArchive = parseLegacyArchive;

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
        // underlays: readLegacySubGroup(configgroup, "FLU"),??
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
