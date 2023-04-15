import { CacheFileSource, CacheIndex, SubFile } from ".";
import { cacheMajors } from "../constants";

export type CachedObject<T> = {
    size: number,
    lastuse: number,
    usecount: number,
    owner: Map<number, CachedObject<T>>,
    id: number,
    promise: Promise<T> | null,
    data: T | null
}
export class CachingFileSource extends CacheFileSource {
    private archieveCache = new Map<number, CachedObject<SubFile[]>>();
    private cachedObjects: CachedObject<any>[] = [];
    private cacheFetchCounter = 0;
    private cacheAddCounter = 0;
    maxcachesize = 200e6;

    rawsource: CacheFileSource;

    constructor(base: CacheFileSource) {
        super();
        this.rawsource = base;
    }

    fetchCachedObject<T>(map: Map<number, CachedObject<T>>, id: number, create: () => Promise<T>, getSize: (obj: T) => number) {
        let bucket = map.get(id);
        if (!bucket || globalThis.ignoreCache) {
            let data = create();
            bucket = {
                promise: data,
                data: null,
                owner: map,
                id: id,
                lastuse: 0,
                size: 0,
                usecount: 0
            }
            data.then(obj => {
                bucket!.size = getSize(obj);
                //delete the promise since otherwise v8 leaks the internal callback list
                //not sure why (chromium 110.0.5481.179, electron 23.1.3)
                bucket!.promise = null;
                bucket!.data = obj;
            });
            this.cachedObjects.push(bucket);
            map.set(id, bucket);
            if (++this.cacheAddCounter % 100 == 0) {
                this.sweepCachedObjects();
            }
        }
        bucket.usecount++;
        bucket.lastuse = this.cacheFetchCounter++;

        if (bucket.data) {
            //create a new promise here to prevent memory leak in v8, somehow adding new callback to a resolved promise
            //results in the promise holding a reference to all of them indefinitely
            return Promise.resolve(bucket.data);
        } else {
            return bucket.promise!;
        }
    }

    sweepCachedObjects() {
        let score = (bucket: CachedObject<any>) => {
            //less is better
            return (
                //up to 100 penalty for not being used recently
                Math.min(100, this.cacheFetchCounter - bucket.lastuse)
                //up to 100 score for being used often
                + Math.max(-100, -bucket.usecount * 10)
            )
        }
        this.cachedObjects.sort((a, b) => score(a) - score(b));
        let newlength = this.cachedObjects.length;
        let totalsize = 0;
        for (let i = 0; i < this.cachedObjects.length; i++) {
            let bucket = this.cachedObjects[i];
            totalsize += bucket.size;
            if (totalsize > this.maxcachesize) {
                newlength = Math.min(newlength, i);
                bucket.owner.delete(bucket.id);
            } else {
                bucket.usecount = 0;
            }
        }
        // console.log("scenecache sweep completed, removed", this.cachedObjects.length - newlength, "of", this.cachedObjects.length, "objects");
        // console.log("old totalsize", totalsize);
        this.cachedObjects.length = newlength;
    }

    getCacheIndex(major: number) {
        return this.rawsource.getCacheIndex(major);
    }
    getFile(major: number, minor: number, crc?: number | undefined) {
        return this.rawsource.getFile(major, minor, crc);
    }
    getFileArchive(index: CacheIndex) {
        let get = () => this.rawsource.getFileArchive(index);

        //don't attempt to cache large files that have their own cache
        if (index.major == cacheMajors.models || index.major == cacheMajors.texturesBmp || index.major == cacheMajors.texturesDds || index.major == cacheMajors.texturesPng) {
            return get();
        } else {
            let cachekey = (index.major << 23) | index.minor;//23bit so it still fits in a 31bit smi
            return this.fetchCachedObject(this.archieveCache, cachekey, get, obj => obj.reduce((a, v) => a + v.size, 0));
        }
    }
    getBuildNr() {
        return this.rawsource.getBuildNr();
    }
    getCacheMeta() {
        return this.rawsource.getCacheMeta();
    }
}
