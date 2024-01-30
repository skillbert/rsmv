import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { ScriptFS, ScriptOutput } from "../scriptrunner";
import { CacheFileSource, archiveToFileId } from "../cache";
import prettyJson from "json-stringify-pretty-compact";
import { getOrInsert } from "../utils";


export async function getSequenceGroups(output: ScriptOutput, outdir: ScriptFS, source: CacheFileSource) {
    let frametoframemap = new Map<number, number>();
    let framesindex = await source.getCacheIndex(cacheMajors.frames);
    for (let frameid of framesindex) {
        if (!frameid) { continue; }
        let arch = await source.getArchiveById(cacheMajors.frames, frameid.minor);
        let frame0 = arch[0];
        if (frame0) {
            let frame = parse.frames.read(frame0.buffer, source);
            frametoframemap.set(frameid.minor, frame.probably_framemap_id);
        }
    }
    output.log(`completed frames`);

    let seqtoframes = new Map<number, number>();
    let sequenceindex = await source.getCacheIndex(cacheMajors.sequences);
    for (let seqid of sequenceindex) {
        if (!seqid) { continue; }
        let arch = await source.getArchiveById(seqid.major, seqid.minor);
        for (let sub of arch) {
            let seqsubid = archiveToFileId(seqid.major, seqid.minor, sub.fileid);
            let seq = parse.sequences.read(sub.buffer, source);
            if (seq.frames && seq.frames.length != 0) {
                seqtoframes.set(seqsubid, seq.frames[0].frameidhi);
            }
        }
    }
    output.log(`completed sequences`);

    let seqperframemap = new Map<number, number[]>();
    for (let [seq, frame] of seqtoframes) {
        let framemap = frametoframemap.get(frame);
        if (framemap != undefined) {
            let seqs = getOrInsert(seqperframemap, framemap, () => []);
            seqs.push(seq);
        }
    }

    let outjson = Object.fromEntries(seqperframemap);
    outdir.writeFile("sequences.json", prettyJson(outjson));
    output.log(`done`);
}
