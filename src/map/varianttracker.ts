import { LayerConfig } from ".";
import { ScriptOutput } from "../scriptrunner";
import { MapRender } from "./backends";


const variantGridSize = 32;
const filemagic = "chnk";

type VariantMetadata = {
    layerfolder: string,
    zoom: number | null,
    fileext: string,
    hasHashes: boolean,
    basex: number,
    basey: number,
    sizex: number,
    sizey: number,
    variants: { name: string, version: number }[]
}

export type VariantInfo = {
    dependencyhash: number,
    exacthash: number,
    savedLayerName: string,
    savedLayerVersion: number
}

export class VariantGroup {
    manager: VariantResolver | null;
    layerfolder: string;
    fileext: string;
    zoom: number | null = null;
    basex: number;
    basey: number;
    gridsizex: number;
    gridsizey: number;
    lastUsed = 0;
    dirty = false;

    private dependencyhashes = new Uint32Array(variantGridSize * variantGridSize);
    private exacthashes = new Uint32Array(variantGridSize * variantGridSize);
    private sourceindices = new Uint8Array(variantGridSize * variantGridSize);
    private layers: { name: string, version: number }[] = [];

    constructor(manager: VariantResolver | null, layerfolder: string, zoom: number | null, fileext: string, basex: number, basey: number, gridsizex: number, gridsizey: number) {
        this.manager = manager;
        this.layerfolder = layerfolder;
        this.zoom = zoom;
        this.fileext = fileext;
        this.basex = basex;
        this.basey = basey;
        this.gridsizex = gridsizex;
        this.gridsizey = gridsizey;
        // null variant - doesn't exist
        this.layers.push({ name: "", version: 0 });
    }

    getIndex(x: number, y: number) {
        return (y % variantGridSize) * variantGridSize + (x % variantGridSize);
    }

    static makeMetaFilename(config: MapRender, layerfolder: string, zoom: number | null, groupx: number, groupy: number, includehashes: boolean) {
        return config.makeFileName(layerfolder, zoom, groupx, groupy, "bin", (includehashes ? "hashes" : "smallhashes"));
    }
    makeMetaFilename(config: MapRender, includehashes: boolean) {
        return VariantGroup.makeMetaFilename(config, this.layerfolder, this.zoom, this.basex / variantGridSize, this.basey / variantGridSize, includehashes);
    }
    makeFilename(config: MapRender, x: number, y: number) {
        return config.makeFileName(this.layerfolder, this.zoom, x, y, this.fileext);
    }

    set(x: number, y: number, variant: VariantInfo | null) {
        if (this.manager) { this.lastUsed = this.manager.chunkscompleted; }
        this.dirty = true;
        let index = this.getIndex(x, y);
        if (variant === null) {
            this.sourceindices[index] = 0;
            this.dependencyhashes[index] = 0;
            this.exacthashes[index] = 0;
        } else {
            let layerindex = this.layers.findIndex(l => l.name == variant.savedLayerName && l.version == variant.savedLayerVersion);
            if (layerindex == -1) {
                layerindex = this.layers.length;
                this.layers.push({ name: variant.savedLayerName, version: variant.savedLayerVersion });
            }
            this.sourceindices[index] = layerindex;
            this.dependencyhashes[index] = variant.dependencyhash;
            this.exacthashes[index] = variant.exacthash;
        }
    }

    get(x: number, y: number) {
        if (this.manager) { this.lastUsed = this.manager.chunkscompleted; }
        let index = this.getIndex(x, y);
        let layerindex = this.sourceindices[index];
        if (layerindex == 0) {
            return null;
        }
        let layer = this.layers[layerindex];
        return {
            savedLayerName: layer.name,
            savedLayerVersion: layer.version,
            dependencyhash: this.dependencyhashes[index],
            exacthash: this.exacthashes[index]
        } as VariantInfo;
    }

    getDebug() {
        let debugtext: string[] = [];
        for (let y = 0; y < variantGridSize; y++) {
            for (let x = 0; x < variantGridSize; x++) {
                let variant = this.get(this.basex + x, this.basey + y);
                if (variant) {
                    debugtext.push(`${x},${y}: dep:${variant.dependencyhash.toString(16).padStart(8, "0")} exact:${variant.exacthash.toString(16).padStart(8, "0")} v${variant.savedLayerVersion}/${variant.savedLayerName}`);
                }
            }
        }
        return debugtext;
    }
    pack(includehashes: boolean) {
        let metadata: VariantMetadata = {
            layerfolder: this.layerfolder,
            zoom: this.zoom,
            fileext: this.fileext,
            hasHashes: includehashes,
            basex: this.basex,
            basey: this.basey,
            sizex: this.gridsizex,
            sizey: this.gridsizey,
            variants: this.layers
        }
        let metastring = JSON.stringify(metadata);
        // pad to multiple of 4 for easier parsing
        metastring = metastring.padEnd((metastring.length + 3) & ~3, " ");
        let metabuffer = Buffer.from(metastring, 'utf-8');
        let headerbuf = Buffer.alloc(8);
        headerbuf.write(filemagic, 0, 4, "ascii");
        headerbuf.writeUInt32LE(metabuffer.byteLength, 4);
        let parts = [
            headerbuf,
            metabuffer,
            Buffer.from(this.sourceindices.buffer)
        ];
        if (includehashes) {
            parts.push(Buffer.from(this.dependencyhashes.buffer));
            parts.push(Buffer.from(this.exacthashes.buffer));
        }
        return Buffer.concat(parts);
    }

    static unpack(buffer: Buffer, manager: VariantResolver | null = null) {
        let index = 0;
        let magic = buffer.subarray(index, index + 4).toString("ascii");
        index += 4;
        if (magic != filemagic) { throw new Error("Invalid file format"); }
        let metadataLength = buffer.readUInt32LE(index);
        index += 4;
        let metadata = JSON.parse(buffer.subarray(index, index + metadataLength).toString("utf-8")) as VariantMetadata;
        index += metadataLength;
        let chunk = new VariantGroup(manager, metadata.layerfolder, metadata.zoom, metadata.fileext, metadata.basex, metadata.basey, metadata.sizex, metadata.sizey);
        chunk.layers = metadata.variants;

        chunk.sourceindices.set(new Uint8Array(buffer.buffer, buffer.byteOffset + index, variantGridSize * variantGridSize));
        index += variantGridSize * variantGridSize;
        if (metadata.hasHashes) {
            chunk.dependencyhashes.set(new Uint32Array(buffer.buffer, buffer.byteOffset + index, variantGridSize * variantGridSize));
            index += variantGridSize * variantGridSize * 4;
            chunk.exacthashes.set(new Uint32Array(buffer.buffer, buffer.byteOffset + index, variantGridSize * variantGridSize));
            index += variantGridSize * variantGridSize * 4;
        }
        return chunk;
    }
}

class VariantLayer {
    private chunks: Map<number, VariantGroup | null | Promise<VariantGroup | null>> = new Map();
    layername: string;
    fileext: string;
    zoom: number | null;
    version: number;


    constructor(layername: string, fileext: string, version: number, zoom: number | null) {
        this.layername = layername;
        this.fileext = fileext;
        this.zoom = zoom;
        this.version = version;
    }
    getImageGroup(x: number, y: number) {
        return {
            groupx: Math.floor(x / variantGridSize),
            groupy: Math.floor(y / variantGridSize)
        }
    }
    getkey(x: number, y: number) {
        return (x << 16) | y;
    }
    getOrLoad(manager: VariantResolver, chunkx: number, chunky: number) {
        let chunk = this.getChunk(chunkx, chunky);
        // not loaded yet, try to load it
        if (chunk === undefined) {
            let filename = VariantGroup.makeMetaFilename(manager.render, this.layername, this.zoom, chunkx, chunky, true);
            chunk = (async () => {
                try {
                    let file = await manager.render.getFileResponse(filename, this.version);
                    if (!file.ok) { return null; }
                    let res = VariantGroup.unpack(Buffer.from(await file.arrayBuffer()), manager);
                    this.setChunk(chunkx, chunky, res);
                    return res;
                } catch (e) {
                    return null;
                }
            })();
            this.setChunk(chunkx, chunky, chunk);
        }
        return chunk;
    }
    getLoadOrInit(manager: VariantResolver, groupx: number, groupy: number) {
        let chunk = this.getOrLoad(manager, groupx, groupy);
        if (chunk instanceof Promise) {
            // chain the fallback value into the promise since we might be racing with another load or init
            let newchunk = chunk.then<VariantGroup>(res => {
                if (!res) {
                    res = new VariantGroup(manager, this.layername, this.zoom, this.fileext, groupx * variantGridSize, groupy * variantGridSize, variantGridSize, variantGridSize);
                    this.setChunk(groupx, groupy, res);
                }
                return res;
            });
            this.setChunk(groupx, groupy, newchunk);
            return newchunk;
        }
        if (!chunk) {
            chunk = new VariantGroup(manager, this.layername, this.zoom, this.fileext, groupx * variantGridSize, groupy * variantGridSize, variantGridSize, variantGridSize);
            this.setChunk(groupx, groupy, chunk);
        }
        return chunk;
    }
    getChunk(x: number, y: number) {
        return this.chunks.get(this.getkey(x, y));
    }
    setChunk(x: number, y: number, chunk: VariantGroup | null | Promise<VariantGroup | null>) {
        this.chunks.set(this.getkey(x, y), chunk);
    }
    flush(backend: MapRender, olderthen: number, flushall = false) {
        let promises: Promise<void>[] = [];
        for (let [key, chunk] of this.chunks) {
            if (chunk instanceof Promise) { continue; }
            if (chunk === null) { continue; }
            let evicted = chunk.lastUsed < olderthen;
            if (evicted) {
                this.chunks.delete(key);
            }
            if (chunk.dirty && (evicted || flushall)) {
                if (backend.config.variantsparse) {
                    promises.push(backend.saveFile(chunk.makeMetaFilename(backend, false), chunk.pack(false), backend.version));
                }
                chunk.dirty = false;
                promises.push(backend.saveFile(chunk.makeMetaFilename(backend, true), chunk.pack(true), backend.version));

                // // TODO remove
                // if (true) {
                //     let debugtexts = chunk.getDebug();
                //     let debugfilename = backend.makeFileName(this.layername, this.zoom, chunk.basex / variantGridSize, chunk.basey / variantGridSize, "txt", "debug");
                //     promises.push(backend.saveFile(debugfilename, Buffer.from(debugtexts.join("\n"))));
                // }
            }
        }
        return promises;
    }
}

export class VariantLayerResolver {
    private trackers: Map<string, VariantLayer> = new Map();
    currentlayer: VariantLayer;
    manager: VariantResolver;

    constructor(manager: VariantResolver, mainlayer: VariantLayer) {
        this.manager = manager;
        this.currentlayer = mainlayer;
        this.addLayer(mainlayer);
    }

    layerkey(layerversion: number, layername: string) {
        return `${layerversion}/${layername}`;
    }

    addLayer(layer: VariantLayer) {
        let key = this.layerkey(layer.version, layer.layername);
        this.trackers.set(key, layer);
    }

    async addFile(tilex: number, tiley: number, dependencyhash: number, exacthash: number, savedLayerName = this.currentlayer.layername, savedLayerVersion = this.currentlayer.version) {
        let { groupx, groupy } = this.currentlayer.getImageGroup(tilex, tiley);
        let chunk = await this.currentlayer.getLoadOrInit(this.manager, groupx, groupy);
        chunk.set(tilex, tiley, {
            dependencyhash,
            exacthash,
            savedLayerName,
            savedLayerVersion
        });
    }

    async findCandidate(tilex: number, tiley: number, hashvalue: number, isexacthash: boolean) {
        for (let layer of this.trackers.values()) {
            if (!isexacthash && layer.layername != this.currentlayer.layername) {
                // only allow dependencyhash matching for historic layers with the same name
                // dependencyhash does not include render settings and thus gives false positives
                continue;
            }
            let { groupx, groupy } = layer.getImageGroup(tilex, tiley);
            let chunk = layer.getOrLoad(this.manager, groupx, groupy);
            // chunk loading is in progress
            if (chunk instanceof Promise) { chunk = await chunk; }
            // explicitly empty - doesn't exist
            if (chunk === null) { continue; }
            let variant = chunk.get(tilex, tiley);
            if (variant) {
                if (isexacthash && variant.exacthash == hashvalue) {
                    return variant;
                }
                if (!isexacthash && variant.dependencyhash == hashvalue) {
                    return variant;
                }
            }
        }
    }

    flush(backend: MapRender, olderthen: number, flushall = false) {
        let promises: Promise<void>[] = [];
        for (let tracker of this.trackers.values()) {
            promises.push(...tracker.flush(backend, olderthen, flushall));
        }
        return promises;
    }
}

export class VariantResolver {
    private resolvers = new Map<string, VariantLayerResolver>();
    private layers = new Map<string, VariantLayer>();
    private versions: number[];
    render: MapRender;
    chunkscompleted = 0;

    constructor(render: MapRender, versions: number[]) {
        this.render = render;
        this.versions = versions;
    }

    resolverkey(layername: string, zoom: number | null) {
        return `${layername}/${zoom}`;
    }
    layerkey(layername: string, version: number, zoom: number | null) {
        return `${version}/${layername}/${zoom}`;
    }

    initLayer(layer: LayerConfig, zoom: number | null) {
        let fileext = (layer.format ?? "webp") + (layer.usegzip ? ".gz" : "");
        let newlayer = this.getOrCreateLayer(layer.name, fileext, this.render.version, zoom);
        let resolver = new VariantLayerResolver(this, newlayer);

        for (let parent of layer.subtractlayers ?? []) {
            let parentlayer = this.layers.get(this.layerkey(parent, this.render.version, zoom));
            if (!parentlayer) { throw new Error(`subtractlayer ${parent} not found for layer ${layer.name}. Make sure subtracklayers appear before their dependent layers`); }
            resolver.addLayer(parentlayer);
        }
        for (let version of this.versions) {
            resolver.addLayer(this.getOrCreateLayer(layer.name, fileext, version, zoom));
        }

        this.resolvers.set(this.resolverkey(layer.name, zoom), resolver);
        return resolver;
    }

    getOrCreateResolver(layer: LayerConfig, zoom: number | null) {
        let key = this.resolverkey(layer.name, zoom);
        return this.resolvers.get(key) ?? this.initLayer(layer, zoom);
    }

    getOrCreateLayer(layername: string, fileext: string, version: number, zoom: number | null) {
        let key = this.layerkey(layername, version, zoom);
        let layer = this.layers.get(key);
        if (!layer) {
            layer = new VariantLayer(layername, fileext, version, zoom);
            this.layers.set(key, layer);
        }
        return layer;
    }
    async finishChunk(flushall = false) {
        this.chunkscompleted++;
        let olderthen = this.chunkscompleted - 10;
        let flushpromises: Promise<any>[] = [];
        for (let resolver of this.resolvers.values()) {
            flushpromises.push(...resolver.flush(this.render, olderthen, flushall));
        }
        if (flushpromises.length != 0) {
            console.log(`flushing ${flushpromises.length} variant files`);
        }
        await Promise.all(flushpromises);
    }
}


async function extractVersionSliceFolder(output: ScriptOutput, config: MapRender, layer: LayerConfig, sourceversion: number, targetname: string, zoom: number | null) {
    let layername = layer.name;
    let srcfolder = config.makeFolderName(layername, zoom, "hashes");
    let existingfolder = config.makeFolderName(layername, zoom, "hashes");
    let srchashfiles = await config.readDir(srcfolder, "files", sourceversion);
    let existinghashfiles = await config.readDir(existingfolder, "files", targetname);

    let allmetas = new Set([...srchashfiles, ...existinghashfiles]);
    for (let metaname of allmetas) {
        if (output.state != "running") { break; }
        let srcexists = srchashfiles.includes(metaname);
        let dstexsits = existinghashfiles.includes(metaname);

        let srcmeta: VariantGroup | null = null;
        let dstmeta: VariantGroup | null = null;
        if (srcexists) {
            let srcdata = await config.getFileResponse(`${srcfolder}/${metaname}`, sourceversion);
            srcmeta = VariantGroup.unpack(Buffer.from(await srcdata.arrayBuffer()));
        }
        if (dstexsits) {
            let existingdata = await config.getFileResponse(`${existingfolder}/${metaname}`, targetname);
            dstmeta = VariantGroup.unpack(Buffer.from(await existingdata.arrayBuffer()));
        } else {
            if (!srcmeta) { throw new Error("unexpected"); }
            dstmeta = new VariantGroup(null, layername, zoom, srcmeta.fileext, srcmeta.basex, srcmeta.basey, srcmeta.gridsizex, srcmeta.gridsizey);
        }

        // check if compatible
        if (dstmeta && srcmeta) {
            if (dstmeta.basex != srcmeta.basex || dstmeta.basey != srcmeta.basey) { throw new Error("unexpected mismatch"); }
            if (dstmeta.gridsizex != srcmeta.gridsizex || dstmeta.gridsizey != srcmeta.gridsizey) { throw new Error("unexpected mismatch"); }
        }

        let promises: Promise<any>[] = [];
        for (let y = 0; y < dstmeta.gridsizey; y++) {
            for (let x = 0; x < dstmeta.gridsizex; x++) {
                let src = srcmeta?.get(x, y);
                let dst = dstmeta?.get(x, y);
                if (srcmeta && src && (!dst || dst.exacthash != src.exacthash)) {
                    // src is different
                    let filename = dstmeta.makeFilename(config, srcmeta.basex + x, srcmeta.basey + y);
                    promises.push(config.symlink(filename, targetname, filename, sourceversion));
                    dstmeta.set(x, y, src);
                } else if (dst && !src) {
                    // existing is extra
                    let filename = dstmeta.makeFilename(config, dstmeta.basex + x, dstmeta.basey + y);
                    promises.push(config.delete(filename, targetname));
                    dstmeta.set(x, y, null);
                }
            }
        }

        // flush meta changes
        await Promise.all(promises);
        if (config.config.variantsparse) {
            await config.saveFile(dstmeta.makeMetaFilename(config, false), Buffer.from(dstmeta.pack(false)), targetname);
        }
        await config.saveFile(dstmeta.makeMetaFilename(config, true), Buffer.from(dstmeta.pack(true)), targetname);
    }
}

export async function extractVersionSlice(output: ScriptOutput, config: MapRender, sourceversion: number, targetname: string) {
    let layers = await config.readDir("", "directories", sourceversion);
    // process each layer
    for (let layer of config.config.layers) {
        output.log("snapshot layer", layer.name);
        if (!layers.includes(layer.name)) {
            console.log("skipping unknown layer", layer.name);
            continue;
        }
        let subfolders = await config.readDir(layer.name, "directories", sourceversion);
        if (subfolders.includes("hashes")) {
            await extractVersionSliceFolder(output, config, layer, sourceversion, targetname, null);
        } else if (subfolders.every(q => !isNaN(+q))) {
            for (let zoomfolder of subfolders) {
                await extractVersionSliceFolder(output, config, layer, sourceversion, targetname, +zoomfolder);
            }
        } else {
            throw new Error("unexpected folder structure in version slice, expected either zoom folders or a single hashes folder");
        }
    }
}