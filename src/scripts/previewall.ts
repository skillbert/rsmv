import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { ScriptFS, ScriptOutput } from "../scriptrunner";
import { cacheFileDecodeModes } from "./filetypes";

export async function previewAllFileTypes(output: ScriptOutput, fs: ScriptFS, source: CacheFileSource, filespermode = 10) {
    let majors = await source.getCacheIndex(cacheMajors.index);
    let maxerrors = 20;

    for (let [untypedmodename, mode] of Object.entries(cacheFileDecodeModes)) {
        if (output.state != "running") { break; }
        let modename = untypedmodename as keyof typeof cacheFileDecodeModes;
        if (modename == "bin") { continue; }
        // if (modename == "cutscenehtml") { continue; }

        let decoder = mode({});
        try {
            await decoder.prepareDump(fs, source);
        } catch (e) {
            output.log(`failed to prepare extraction for ${modename}, ${e}`);
            continue;
        }
        if (typeof decoder.major == "undefined") { continue; }
        if (!majors[decoder.major]) {
            output.log(`skipped ${modename} because major ${decoder.major} is missing from the cache`);
            continue;
        }

        let minorindex = await source.getCacheIndex(decoder.major);

        let count = 0;
        let errors = 0;
        minorloop: for (let i = minorindex.length - 1; i >= 0; i--) {
            let entry = minorindex[i];
            if (output.state != "running") { break; }
            if (errors >= maxerrors) {
                output.log(`stopped mode ${modename} after ${errors} errors.`);
                break;
            }
            if (!entry) { continue; }
            if (typeof decoder.minor == "number" && decoder.minor != entry.minor) { continue; }
            try {
                var archieve = await source.getFileArchive(entry);
            } catch (e) {
                output.log(`failed to load ${entry.major}.${entry.minor}`);
                errors++;
                continue;
            }
            for (let { buffer, fileid } of archieve) {
                let logicalid = decoder.fileToLogical(source, entry.major, entry.minor, fileid);
                let resname = `${modename}_${logicalid.join(".")}.${decoder.ext}`;
                try {
                    var res = await decoder.read(buffer, logicalid, source);
                    if (typeof res != "string" && !Buffer.isBuffer(res)) {
                        throw new Error("decoder didn't return a valid file");
                    }
                    fs.writeFile(resname, res);
                } catch (e) {
                    output.log(`failed to decode ${resname}`);
                    errors++;
                    continue minorloop;
                }
                if (count++ >= filespermode) {
                    break minorloop;
                }
            }
        }
    }
}