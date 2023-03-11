import { CacheFileSource, CacheIndexFile } from "../cache";
import { Openrs2CacheSource, validOpenrs2Caches } from "../cache/openrs2loader";
import { cacheMajors } from "../constants";
import { ScriptFS, ScriptOutput } from "../viewer/scriptsui";
import { cacheFileDecodeModes } from "./filetypes";


type HistoricVersion = {
    cacheids: string[],
    buildnr: number[],
    hash: number | null,
    file: Buffer | null,
    decoded: string | Buffer | null
    decodedname: string
}

export async function fileHistory(output: ScriptOutput, outdir: ScriptFS, mode: keyof typeof cacheFileDecodeModes, id: number[], basecache: CacheFileSource | null) {
    let histsources = await validOpenrs2Caches();
    let decoder = cacheFileDecodeModes[mode]({});

    let allsources = function* () {
        if (basecache) {
            yield basecache;
        }
        for (let id of histsources) {
            yield new Openrs2CacheSource(id);
        }
    }

    let lastversion: HistoricVersion | null = null;

    let history: HistoricVersion[] = [];

    for (let source of allsources()) {
        try {
            let sourcename = source.getCacheMeta().name.replace(/:/g, "-");
            let changed = false;
            let fileid = decoder.logicalToFile(id);
            let indexfile = await source.getCacheIndex(fileid.major);
            let filemeta = indexfile.at(fileid.minor);
            let newfile: Buffer | null = null;
            let decoded: string | Buffer | null = null;
            if (filemeta) {
                let newarchive = await source.getFileArchive(filemeta);
                newfile = newarchive[fileid.subid]?.buffer;
                if (!newfile) { throw new Error("invalid subid"); }
                if (!lastversion?.file || Buffer.compare(newfile, lastversion.file) != 0) {
                    if (lastversion && filemeta.crc == lastversion.hash) {
                        console.log("file change detected without crc change");
                    }
                    changed = true;
                    decoded = await decoder.read(newfile, id, source);
                }
            } else if (lastversion && lastversion.file) {
                changed = true;
            }
            if (changed) {
                let majorname = Object.entries(cacheMajors).find(([k, v]) => v == fileid.major)?.[0] ?? `unkown-${fileid.major}`;
                let decodedname = `${majorname}-${fileid.minor}-${fileid.subid}-${sourcename}.${decoded ? decoder.ext : "txt"}`;

                lastversion = {
                    cacheids: [],
                    buildnr: [],
                    hash: filemeta?.crc ?? 0,
                    decoded,
                    decodedname,
                    file: newfile,
                };
                history.push(lastversion);
                await outdir.writeFile(decodedname, decoded ?? "empty");
            }

            lastversion!.buildnr.push(source.getBuildNr());
            lastversion!.cacheids.push(source.getCacheMeta().name);
        } catch (e) {
            console.log(`error while decoding diffing file ${id} in "${source.getCacheMeta().name}, ${source.getCacheMeta().descr}"`);
            //TODO use different stopping condition
            return history;
        } finally {
            if (source != basecache) {
                source.close();
            }
        }
    }
    return history;
}
