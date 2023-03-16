import { GameCacheLoader } from "./sqlite";
import { WasmGameCacheLoader } from "./sqlitewasm";
import { ClassicFileSource } from "./classicloader";
import { CLIScriptFS, ScriptFS, UIScriptFS } from "../viewer/scriptsui";
import { CacheOpts } from "../cliparser";
//TODO .dat / .dat2

export async function selectFsCache(fs: ScriptFS, opts?: CacheOpts) {
    let filenames = await fs.readDir(".");

    let jcachecount = 0;
    let datcount = 0;
    let dat2count = 0;
    let jagcount = 0;
    for (let name of filenames) {
        let ext = name.match(/\.(\w+)$/);
        if (ext?.[1] == "jcache") { jcachecount++; }
        if (ext?.[1] == "dat2") { dat2count++; }
        if (ext?.[1] == "dat") { datcount++; }
        if (ext?.[1] == "jag") { jagcount++; }
    }
    let maxcount = Math.max(jcachecount, datcount, dat2count, jagcount);
    if (maxcount == 0) { throw new Error("no cache files found in selected directory"); }

    if (maxcount == jcachecount) {
        if (fs instanceof CLIScriptFS) {
            return new GameCacheLoader(fs.dir, !!opts?.writable);
        } else if (fs instanceof UIScriptFS) {
            if (!fs.rootdirhandle) { throw new Error("need fs with hard disk backing"); }
            let cache = new WasmGameCacheLoader();
            await cache.giveFsDirectory(fs.rootdirhandle);
            return cache;
        }
    }
    if (maxcount == datcount) {
        //TODO
    }
    if (maxcount == dat2count) {
        //TODO
    }
    if (maxcount == jagcount) {
        let cache = new ClassicFileSource();
        await cache.loadFiles(fs);
        return cache;
    }
    throw new Error("couldn't detect cache type");
}