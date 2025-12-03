import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { ScriptFS, ScriptOutput } from "../scriptrunner";
import { CacheFileSource, archiveToFileId } from "../cache";
import prettyJson from "json-stringify-pretty-compact";
import { getOrInsert } from "../utils";


export async function getSequenceGroups(output: ScriptOutput, outdir: ScriptFS, source: CacheFileSource) {
    let frametoframemap = new Map<number, number>();
    output.log(`starting frames`)
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

    output.log(`starting skeletals`)
    let skeletaltoframemap = new Map<number, number>();
    let skeletalindex = await source.getCacheIndex(cacheMajors.skeletalAnims);
    for (let skeletalid of skeletalindex) {
        if (!skeletalid) { continue; }
        try {
            let animfile = await source.getFileById(cacheMajors.skeletalAnims, skeletalid.minor);
            let anim = parse.skeletalAnim.read(animfile, source);
            skeletaltoframemap.set(skeletalid.minor, anim.framebase);
        } catch (e) {
            // currently known error in the bzip2 decompression on file 56.2242
            // seems like an error in the js bzip2 implementation
            output.log(`failed to parse skeletal ${skeletalid.minor}`);
        }
    }
    output.log(`completed skeletals`);

    output.log(`starting sequences`);
    let seqperframemap = new Map<number, number[]>();
    let sequenceindex = await source.getCacheIndex(cacheMajors.sequences);
    for (let seqid of sequenceindex) {
        if (!seqid) { continue; }
        let arch = await source.getArchiveById(seqid.major, seqid.minor);
        for (let sub of arch) {
            let seqsubid = archiveToFileId(seqid.major, seqid.minor, sub.fileid);
            let seq = parse.sequences.read(sub.buffer, source);
            let mapid: number | null | undefined = null;
            if (seq.frames && seq.frames.length != 0) {
                mapid = frametoframemap.get(seq.frames[0].frameidhi);
            }
            if (seq.skeletal_animation != null) {
                mapid = skeletaltoframemap.get(seq.skeletal_animation);
            }
            if (mapid != null) {
                let list = getOrInsert(seqperframemap, mapid, () => []);
                list.push(seqsubid);
            }
        }
    }
    output.log(`completed sequences`);

    let outjson = Object.fromEntries(seqperframemap);
    outdir.writeFile("sequences.json", prettyJson(outjson));
    output.log(`done`);
}
