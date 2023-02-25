import { Openrs2CacheSource, validOpenrs2Caches } from "../cache/openrs2loader";
import { cacheMajors } from "../constants";
import { ScriptOutput } from "../viewer/scriptsui";

export async function openrs2Ids(output: ScriptOutput, date: string, near: string, logcontents: boolean) {
    let allids = await validOpenrs2Caches();
    if (date) {
        let m = date.match(/20\d\d/);
        if (!m) { throw new Error("4 digit year expected"); }
        let year = +m[0];
        let enddate = new Date((year + 1) + "");
        let startdate = new Date(year + "");
        allids = allids.filter(q => q.timestamp && new Date(q.timestamp) >= startdate && new Date(q.timestamp) <= enddate);
    }
    if (near) {
        let index = allids.findIndex(q => q.id == +near);
        if (index == -1) { throw new Error("cache id not found"); }
        let amount = 10;
        let beforeamount = Math.min(index, amount);
        allids = allids.slice(index - beforeamount, index + 1 + amount);
    }
    let linenr = 0;
    for (let cache of allids) {
        let line = `id ${cache.id.toString().padStart(4)}, build ${cache.builds[0]?.major ?? "???"}`;
        line += ` - ${(cache.timestamp ? new Date(cache.timestamp).toDateString() : "unknown date").padEnd(12)}`;
        if (near) { line += (+near == cache.id ? " <--" : "    "); }
        if (logcontents) {
            if (linenr % 10 == 0) {
                let extraline = "-".repeat(2 + 1 + 4 + 9 + 3 + 3 + 12 + 4);
                for (let i = 0; i < 60; i++) {
                    extraline += `+-${` ${i} `.padStart(6, "-")}--`;
                }
                output.log(extraline);
            }
            let src = new Openrs2CacheSource(cache);
            try {
                if (cache.builds[0].major >= 410) {
                    let index = await src.getCacheIndex(cacheMajors.index);
                    for (let i = 0; i < index.length; i++) {
                        let config = index[i];
                        if (!config) {
                            line += " ".repeat(10);
                        } else {
                            let subcount = 0;
                            if (config.crc != 0 && config.subindexcount == 0) {
                                let subindex = await src.getCacheIndex(config.minor);
                                subcount = subindex.reduce((a, v) => a + (v ? 1 : 0), 0);
                            } else {
                                subcount = config.subindexcount;
                            }
                            line += ` ${subcount.toString().padStart(9)}`;
                        }
                    }
                }
            } finally {
                src.close();
            }
        }
        output.log(line);
        linenr++;
    }
}