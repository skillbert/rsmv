import { LayerConfig } from ".";
import { MapRender } from "./backends";


const variantGridSize = 32;
const filemagic = "chnk";

type VariantMetadata = {
    layerfolder: string,
    hasHashes: boolean,
    basex: number,
    basey: number,
    sizex: number,
    sizey: number,
    variants: { name: string, version: number }[],
    embeddedjson?: [number, number, number][]
}

export type VariantInfo = {
    dependencyhash: number,
    exacthash: number,
    savedLayerName: string,
    savedLayerVersion: number
}

export class VariantGroup {
    manager: VariantResolver;
    layerfolder: string;
    basex: number;
    basey: number;
    lastUsed = 0;

    private dependencyhashes = new Uint32Array(variantGridSize * variantGridSize);
    private exacthashes = new Uint32Array(variantGridSize * variantGridSize);
    private sourceindices = new Uint8Array(variantGridSize * variantGridSize);
    private layers: { name: string, version: number }[] = [];

    constructor(manager: VariantResolver, layerfolder: string, basex: number, basey: number) {
        this.manager = manager;
        this.layerfolder = layerfolder;
        this.basex = basex;
        this.basey = basey;
        // null variant - doesn't exist
        this.layers.push({ name: "", version: 0 });
    }

    getIndex(x: number, y: number) {
        return (y % variantGridSize) * variantGridSize + (x % variantGridSize);
    }

    set(x: number, y: number, variant: VariantInfo) {
        this.lastUsed = this.manager.chunkscompleted;
        let index = this.getIndex(x, y);
        let layerindex = this.layers.findIndex(l => l.name == variant.savedLayerName && l.version == variant.savedLayerVersion);
        if (layerindex == -1) {
            layerindex = this.layers.length;
            this.layers.push({ name: variant.savedLayerName, version: variant.savedLayerVersion });
        }
        this.sourceindices[index] = layerindex;
        this.dependencyhashes[index] = variant.dependencyhash;
        this.exacthashes[index] = variant.exacthash;
    }

    get(x: number, y: number) {
        this.lastUsed = this.manager.chunkscompleted;
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

    pack(includehashes: boolean, jsonformat = false) {
        let metadata: VariantMetadata = {
            layerfolder: this.layerfolder,
            hasHashes: includehashes,
            basex: this.basex,
            basey: this.basey,
            sizex: variantGridSize,
            sizey: variantGridSize,
            variants: this.layers
        }
        if (jsonformat) {
            metadata.embeddedjson = [];
            for (let i = 0; i < this.sourceindices.length; i++) {
                metadata.embeddedjson.push([
                    this.sourceindices[i],
                    this.dependencyhashes[i],
                    this.exacthashes[i]
                ]);
            }
        }

        let metastring = JSON.stringify(metadata, undefined, jsonformat ? "\t" : undefined);
        // pad to multiple of 4 for easier parsing
        metastring = metastring.padEnd((metastring.length + 3) & ~3, " ");
        let metabuffer = Buffer.from(metastring, 'utf-8');
        let headerbuf = Buffer.alloc(8);
        headerbuf.write(filemagic, 0, 4, "ascii");
        headerbuf.writeUInt32LE(metabuffer.byteLength, 4);
        let parts = [
            headerbuf,
            metabuffer
        ];
        if (!jsonformat) {
            parts.push(Buffer.from(this.sourceindices.buffer));
            if (includehashes) {
                parts.push(Buffer.from(this.dependencyhashes.buffer));
                parts.push(Buffer.from(this.exacthashes.buffer));
            }
        }
        return Buffer.concat(parts);
    }

    static unpack(manager: VariantResolver, buffer: Buffer) {
        let index = 0;
        let magic = buffer.subarray(index, index + 4).toString("ascii");
        index += 4;
        if (magic != filemagic) { throw new Error("Invalid file format"); }
        let metadataLength = buffer.readUInt32LE(index);
        index += 4;
        let metadata = JSON.parse(buffer.subarray(index, index + metadataLength).toString("utf-8")) as VariantMetadata;
        index += metadataLength;
        let chunk = new VariantGroup(manager, metadata.layerfolder, metadata.basex, metadata.basey);
        chunk.layers = metadata.variants;
        if (metadata.embeddedjson) {
            //less efficient storage format for debugging
            for (let [index, entry] of metadata.embeddedjson.entries()) {
                chunk.sourceindices[index] = entry[0];
                chunk.dependencyhashes[index] = entry[1];
                chunk.exacthashes[index] = entry[2];
            }
        } else {
            chunk.sourceindices.set(new Uint8Array(buffer.buffer, buffer.byteOffset + index, variantGridSize * variantGridSize));
            index += variantGridSize * variantGridSize;
            if (metadata.hasHashes) {
                chunk.dependencyhashes.set(new Uint32Array(buffer.buffer, buffer.byteOffset + index, variantGridSize * variantGridSize));
                index += variantGridSize * variantGridSize * 4;
                chunk.exacthashes.set(new Uint32Array(buffer.buffer, buffer.byteOffset + index, variantGridSize * variantGridSize));
                index += variantGridSize * variantGridSize * 4;
            }
        }
        return chunk;
    }
}

class VariantLayer {
    private chunks: Map<number, VariantGroup | null | Promise<VariantGroup | null>> = new Map();
    layername: string;
    zoom: number | null;
    version: number;


    constructor(layername: string, version: number, zoom: number | null) {
        this.layername = layername;
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
            let filename = manager.render.makeFileName(this.layername, this.zoom, chunkx, chunky, "bin", "versions");
            chunk = (async () => {
                try {
                    let file = await manager.render.getFileResponse(filename, this.version);
                    if (!file.ok) { return null; }
                    let res = VariantGroup.unpack(manager, Buffer.from(await file.arrayBuffer()));
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
    async getLoadOrInit(manager: VariantResolver, groupx: number, groupy: number) {
        let chunk = await this.getOrLoad(manager, groupx, groupy);
        if (!chunk) {
            chunk = new VariantGroup(manager, this.layername, groupx * variantGridSize, groupy * variantGridSize);
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
    flush(backend: MapRender, olderthen: number) {
        let promises: Promise<void>[] = [];
        for (let [key, chunk] of this.chunks) {
            if (chunk instanceof Promise) { continue; }
            if (chunk === null) { continue; }
            if (chunk.lastUsed < olderthen) {
                this.chunks.delete(key);
                if (backend.config.variantsparse) {
                    let file = chunk.pack(false, false);
                    let filename = backend.makeFileName(this.layername, this.zoom, chunk.basex / variantGridSize, chunk.basey / variantGridSize, "bin", "hashesv_");
                    promises.push(backend.saveFile(filename, 0, file, backend.version));
                }
                let file = chunk.pack(true, backend.config.variantdebug);
                let filename = backend.makeFileName(this.layername, this.zoom, chunk.basex / variantGridSize, chunk.basey / variantGridSize, "bin", "hashes_");
                promises.push(backend.saveFile(filename, 0, file, backend.version));
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
        let newlayer = this.getOrCreateLayer(layer.name, this.render.version, zoom);
        let resolver = new VariantLayerResolver(this, newlayer);

        for (let parent of layer.subtractlayers ?? []) {
            let parentlayer = this.layers.get(this.layerkey(parent, this.render.version, zoom));
            if (!parentlayer) { throw new Error(`subtractlayer ${parent} not found for layer ${layer.name}. Make sure subtracklayers appear before their dependent layers`); }
            resolver.addLayer(parentlayer);
        }
        for (let version of this.versions) {
            resolver.addLayer(this.getOrCreateLayer(layer.name, version, zoom));
        }

        this.resolvers.set(this.resolverkey(layer.name, zoom), resolver);
        return resolver;
    }

    getOrCreateResolver(layer: LayerConfig, zoom: number | null) {
        let key = this.resolverkey(layer.name, zoom);
        return this.resolvers.get(key) ?? this.initLayer(layer, zoom);
    }

    getOrCreateLayer(layername: string, version: number, zoom: number | null) {
        let key = this.layerkey(layername, version, zoom);
        let layer = this.layers.get(key);
        if (!layer) {
            layer = new VariantLayer(layername, version, zoom);
            this.layers.set(key, layer);
        }
        return layer;
    }
    async finishChunk(flushall = false) {
        this.chunkscompleted++;
        let olderthen = flushall ? 0x3fffffff : this.chunkscompleted - 10;
        let flushpromises: Promise<any>[] = [];
        for (let resolver of this.resolvers.values()) {
            flushpromises.push(...resolver.currentlayer.flush(this.render, olderthen));
        }
        console.log(`Flushing ${flushpromises.length} variant files`);
        await Promise.all(flushpromises);
    }
}