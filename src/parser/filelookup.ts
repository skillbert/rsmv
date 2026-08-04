import { archiveToFileId, CacheFileSource, CacheIndex, fileIdToArchiveminor, SubFile } from "../cache";
import { cacheMajors, lastLegacyBuildnr } from "../constants";
import { cacheFilenameHash } from "../utils";

export type DecodeLookup = {
    major: number | undefined,
    minor: number | undefined,
    logicalDimensions: number,
    usesArchieves: boolean,
    internalNamefile: number | undefined,
    logicalRangeToFiles(source: CacheFileSource, start: LogicalIndex, end: LogicalIndex): Promise<CacheFileId[]>,
    fileToLogical(source: CacheFileSource, major: number, minor: number, subfile: number): LogicalIndex,
    logicalToFile(source: CacheFileSource, id: LogicalIndex): FileId
}

export type FileId = {
    major: number,
    minor: number,
    subid: number
};

export type CacheFileId = {
    index: CacheIndex,
    subindex: number
}

export type LogicalIndex = number[];

export async function filerange(source: CacheFileSource, startindex: FileId, endindex: FileId) {
    if (startindex.major != endindex.major) { throw new Error("range must span one major"); }
    let files: CacheFileId[] = [];
    if (source.getBuildNr() <= lastLegacyBuildnr) {
        //dummy filerange since we don't have an index
        let itercount = 0;
        for (let minor = startindex.minor; minor <= endindex.minor; minor++) {
            if (itercount++ > 1000) { break; }
            try {
                //bit silly since we download the files and then only return their ids
                //however it doesn't matter that much since the entire cache is <20mb
                let group: SubFile[] = [];
                group = await source.getArchiveById(startindex.major, minor);
                let groupindex: CacheIndex = {
                    major: startindex.major,
                    minor,
                    crc: 0,
                    name: null,
                    subindexcount: group.length,
                    subindices: group.map(q => q.fileid),
                    subnames: group.map(q => q.fileid),
                    version: 0
                };
                for (let sub of group) {
                    if (sub.fileid >= startindex.subid && sub.fileid <= endindex.subid) {
                        files.push({
                            index: groupindex,
                            subindex: sub.fileid
                        });
                    }
                }
            } catch {
                //omit missing groups from listing
            }
        }
    } else {
        let indexfile = await source.getCacheIndex(startindex.major);
        for (let index of indexfile) {
            if (!index) { continue; }
            if (index.minor >= startindex.minor && index.minor <= endindex.minor) {
                for (let fileindex = 0; fileindex < index.subindices.length; fileindex++) {
                    let subfileid = index.subindices[fileindex];
                    if (index.minor == startindex.minor && subfileid < startindex.subid) { continue; }
                    if (index.minor == endindex.minor && subfileid > endindex.subid) { continue; }
                    files.push({ index, subindex: fileindex });
                }
            }
        }
    }
    return files;
}


export function oldWorldmapIndex(key: "l" | "m"): DecodeLookup {
    return {
        major: cacheMajors.mapsquares,
        minor: undefined,
        logicalDimensions: 2,
        usesArchieves: false,
        internalNamefile: undefined,
        fileToLogical(source, major, minor, subfile) {
            return [255, minor];
        },
        logicalToFile(source, id) {
            throw new Error("not implemented");
        },
        async logicalRangeToFiles(source, start, end) {
            let index = await source.getCacheIndex(cacheMajors.mapsquares);
            let res: CacheFileId[] = [];
            for (let x = start[0]; x <= Math.min(end[0], 100); x++) {
                for (let z = start[1]; z <= Math.min(end[1], 200); z++) {
                    let namehash = cacheFilenameHash(`${key}${x}_${z}`, source.getBuildNr() <= lastLegacyBuildnr);
                    let file = index.find(q => q && q.name == namehash);
                    if (file) { res.push({ index: file, subindex: 0 }); }
                }
            }
            return res;
        }
    }
}

export function worldmapIndex(subfile: number): DecodeLookup {
    const major = cacheMajors.mapsquares;
    const worldStride = 128;
    return {
        major,
        minor: undefined,
        logicalDimensions: 2,
        usesArchieves: true,
        internalNamefile: undefined,
        fileToLogical(source, major, minor, subfile) {
            return [minor % worldStride, Math.floor(minor / worldStride)];
        },
        logicalToFile(source, id: LogicalIndex) {
            return { major, minor: id[0] + id[1] * worldStride, subid: subfile };
        },
        async logicalRangeToFiles(source, start, end) {
            let indexfile = await source.getCacheIndex(major);
            let files: CacheFileId[] = [];
            for (let index of indexfile) {
                if (!index) { continue; }
                let x = index.minor % worldStride;
                let z = Math.floor(index.minor / worldStride);
                if (x >= start[0] && x <= end[0] && z >= start[1] && z <= end[1]) {
                    for (let fileindex = 0; fileindex < index.subindices.length; fileindex++) {
                        let subfileid = index.subindices[fileindex];
                        if (subfileid == subfile) {
                            files.push({ index, subindex: fileindex });
                        }
                    }
                }
            }
            return files;
        }
    }
}

export function singleMinorIndex(major: number, minor: number, internalNamefile: number | undefined = undefined): DecodeLookup {
    return {
        major,
        minor,
        logicalDimensions: 1,
        usesArchieves: true,
        internalNamefile,
        fileToLogical(source, major, minor, subfile) {
            return [subfile];
        },
        logicalToFile(source, id: LogicalIndex) {
            return { major, minor, subid: id[0] };
        },
        async logicalRangeToFiles(source, start, end) {
            return filerange(source, { major, minor, subid: start[0] }, { major, minor, subid: end[0] });
        }
    }
}

export function chunkedIndex(major: number, internalNamefile: number | undefined = undefined): DecodeLookup {
    return {
        major,
        minor: undefined,
        logicalDimensions: 1,
        usesArchieves: true,
        internalNamefile,
        fileToLogical(source, major, minor, subfile) {
            return [archiveToFileId(major, minor, subfile)];
        },
        logicalToFile(source, id: LogicalIndex) {
            return fileIdToArchiveminor(major, id[0], source.getBuildNr());
        },
        async logicalRangeToFiles(source, start, end) {
            let startindex = fileIdToArchiveminor(major, start[0], source.getBuildNr());
            let endindex = fileIdToArchiveminor(major, end[0], source.getBuildNr());
            return filerange(source, startindex, endindex);
        }
    };
}

export function anyFileIndex(): DecodeLookup {
    return {
        major: undefined,
        minor: undefined,
        logicalDimensions: 3,
        usesArchieves: true,
        internalNamefile: undefined,
        fileToLogical(source, major, minor, subfile) { return [major, minor, subfile]; },
        logicalToFile(source, id) { return { major: id[0], minor: id[1], subid: id[2] }; },
        async logicalRangeToFiles(source, start, end) {
            if (start[0] != end[0]) { throw new Error("can only do one major at a time"); }
            let major = start[0];
            return filerange(source, { major, minor: start[1], subid: start[2] }, { major, minor: end[1], subid: end[2] });
        }
    }
}

export function noArchiveIndex(major: number, internalNamefile: number | undefined = undefined): DecodeLookup {
    return {
        major,
        minor: undefined,
        logicalDimensions: 1,
        usesArchieves: false,
        internalNamefile,
        fileToLogical(source, major, minor, subfile) { if (subfile != 0) { throw new Error("nonzero subfile in noarch index"); } return [minor]; },
        logicalToFile(source, id) { return { major, minor: id[0], subid: 0 }; },
        async logicalRangeToFiles(source, start, end) {
            return filerange(source, { major, minor: start[0], subid: 0 }, { major, minor: end[0], subid: 0 });
        }
    }
}

export function standardIndex(major: number, internalNamefile: number | undefined = undefined): DecodeLookup {
    return {
        major,
        minor: undefined,
        logicalDimensions: 2,
        usesArchieves: true,
        internalNamefile,
        fileToLogical(source, major, minor, subfile) { return [minor, subfile]; },
        logicalToFile(source, id) { return { major, minor: id[0], subid: id[1] }; },
        async logicalRangeToFiles(source, start, end) {
            return filerange(source, { major, minor: start[0], subid: start[1] }, { major, minor: end[0], subid: end[1] });
        }
    }
}
export function blacklistIndex(parent: DecodeLookup, blacklist: { major: number, minor: number }[]): DecodeLookup {
    return {
        ...parent,
        async logicalRangeToFiles(source, start, end) {
            let res = await parent.logicalRangeToFiles(source, start, end);
            return res.filter(q => !blacklist.some(w => w.major == q.index.major && w.minor == q.index.minor));
        },
    }
}
export function indexfileIndex(): DecodeLookup {
    return {
        major: cacheMajors.index,
        minor: undefined,
        logicalDimensions: 1,
        usesArchieves: false,
        internalNamefile: undefined,
        fileToLogical(source, major, minor, subfile) { return [minor]; },
        logicalToFile(source, id) { return { major: cacheMajors.index, minor: id[0], subid: 0 }; },
        async logicalRangeToFiles(source, start, end) {
            let indices = await source.getCacheIndex(cacheMajors.index);
            return indices
                .filter(index => index && index.minor >= start[0] && index.minor <= end[0])
                .map(index => ({ index, subindex: 0 }));
        }
    }
}

export function rootindexfileIndex(): DecodeLookup {
    return {
        major: cacheMajors.index,
        minor: 255,
        logicalDimensions: 0,
        usesArchieves: false,
        internalNamefile: undefined,
        fileToLogical(source, major, minor, subfile) { return []; },
        logicalToFile(source, id) { return { major: cacheMajors.index, minor: 255, subid: 0 }; },
        async logicalRangeToFiles(source, start, end) {
            return [
                { index: { major: 255, minor: 255, crc: 0, size: 0, version: 0, name: null, subindexcount: 1, subindices: [0], subnames: null }, subindex: 0 }
            ];
        }
    }
}