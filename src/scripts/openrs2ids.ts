import { Openrs2CacheSource, validOpenrs2Caches } from "../cache/openrs2loader";
import { cacheMajors } from "../constants";
import { ScriptOutput } from "../scriptrunner";

export async function openrs2Ids(output: ScriptOutput, date: string, near: string, logcontents: boolean) {
    let allids = await validOpenrs2Caches();
    if (date) {
        let startdate = new Date("");//nan
        let enddate = new Date("");//nan
        if (date.match(/^\d{4}$/)) {
            startdate = new Date(date);
            enddate = new Date((+date + 1) + "");
        } else if (date.match(/-/)) {
            let parts = date.split("-");
            startdate = new Date(parts[0]);
            enddate = new Date(parts[1]);
        }
        if (isNaN(+enddate)) { enddate = new Date("2100"); }
        if (isNaN(+startdate)) { startdate = new Date("1900"); }
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
                // if (cache.builds[0].major > lastLegacyBuildnr) {
                let index = await src.getCacheIndex(cacheMajors.index);
                for (let i = 0; i < index.length; i++) {
                    let config = index[i];
                    if (!config) {
                        line += " ".repeat(10);
                    } else {
                        let subcount = 0;
                        if (config.crc != 0 && config.subindexcount == 0) {
                            try {
                                let subindex = await src.getCacheIndex(config.minor);
                                subcount = subindex.reduce((a, v) => a + (v ? 1 : 0), 0);
                            } catch (e) {
                                subcount = NaN;
                            }
                        } else {
                            subcount = config.subindexcount;
                        }
                        line += ` ${subcount.toString().padStart(9)}`;
                    }
                }
                // }
            } catch (e) {
                line += `  Error ${e}`;
            } finally {
                src.close();
            }
        }
        output.log(line);
        linenr++;
    }
}