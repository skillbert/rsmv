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
    variants: { name: string, version: number }[]
}

type FileMeta = {
    dependencyhash: number,
    exacthash: number,
    savedLayerName: string,
    savedLayerVersion: number
}

export class VariantChunk {
    layerfolder: string;
    filled = 0;
    basex: number;
    basey: number;

    private dependencyhashes = new Uint32Array(variantGridSize * variantGridSize);
    private exacthashes = new Uint32Array(variantGridSize * variantGridSize);
    private sourceindices = new Uint8Array(variantGridSize * variantGridSize);
    private layers: { name: string, version: number }[] = [];

    constructor(layerfolder: string, basex: number, basey: number) {
        this.layerfolder = layerfolder;
        this.basex = basex;
        this.basey = basey;
        // null variant - doesn't exist
        this.layers.push({ name: "", version: 0 });
    }

    getIndex(x: number, y: number) {
        return (y % variantGridSize) * variantGridSize + (x % variantGridSize);
    }

    set(x: number, y: number, variant: FileMeta) {
        let index = this.getIndex(x, y);
        if (this.sourceindices[index] == 0) {
            this.filled++;
        }

        let layerindex = this.layers.findIndex(l => l.name == variant.savedLayerName && l.version == variant.savedLayerVersion);
        if (layerindex == -1) {
            layerindex = this.layers.length;
            this.layers.push({ name: variant.savedLayerName, version: variant.savedLayerVersion });
        }
        this.sourceindices[index] = layerindex;
        this.dependencyhashes[index] = variant.dependencyhash;
        this.exacthashes[index] = variant.exacthash;

        if (this.filled == variantGridSize * variantGridSize) {
            //TODO trigger event to notify layer that this chunk is full and can be packed and cache can be purged
        }
    }

    get(x: number, y: number) {
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
        };
    }

    pack(includehashes: boolean) {
        let metadata: VariantMetadata = {
            layerfolder: this.layerfolder,
            hasHashes: includehashes,
            basex: this.basex,
            basey: this.basey,
            sizex: variantGridSize,
            sizey: variantGridSize,
            variants: this.layers
        }

        let metastring = JSON.stringify(metadata);
        // pad to multiple of 4 for easier parsing
        metastring = metastring.padEnd((metastring.length + 3) & ~3, " ");
        let metabuffer = Buffer.from(metastring, 'utf-8');
        let headerbuf = Buffer.alloc(8);
        headerbuf.write(filemagic, 0, 4, "ascii");
        headerbuf.writeUInt32LE(metabuffer.byteLength, 4);
        return Buffer.concat([
            headerbuf,
            metabuffer,
            Buffer.from(this.sourceindices.buffer),
            Buffer.from(this.dependencyhashes.buffer),
            Buffer.from(this.exacthashes.buffer)
        ]);
    }

    static unpack(buffer: Buffer) {
        let index = 0;
        let magic = buffer.subarray(index, index + 4).toString("ascii");
        index += 4;
        if (magic != filemagic) { throw new Error("Invalid file format"); }
        let metadataLength = buffer.readUInt32LE(index);
        index += 4;
        let metadata = JSON.parse(buffer.subarray(index, index + metadataLength).toString("utf-8")) as VariantMetadata;
        index += metadataLength;
        let chunk = new VariantChunk(metadata.layerfolder, metadata.basex, metadata.basey);
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
    private chunks: Map<number, VariantChunk | null | Promise<VariantChunk | null>> = new Map();
    layername: string;
    zoom: number | null;
    version: number;

    constructor(layername: string, zoom: number | null, version: number) {
        this.layername = layername;
        this.zoom = zoom;
        this.version = version;
    }
    getChunkCoords(x: number, y: number) {
        return {
            chunkx: Math.floor(x / variantGridSize),
            chunky: Math.floor(y / variantGridSize)
        }
    }
    getkey(x: number, y: number) {
        return (x << 16) | y;
    }
    getOrLoad(backend: MapRender, chunkx: number, chunky: number) {
        let chunk = this.getChunk(chunkx, chunky);
        // not loaded yet, try to load it
        if (chunk === undefined) {
            let filename = backend.makeFileName(this.layername, this.zoom, chunkx, chunky, "bin", "versions");
            chunk = (async () => {
                try {
                    let file = await backend.getFileResponse(filename, this.version);
                    if (!file.ok) { return null; }
                    let res = VariantChunk.unpack(Buffer.from(await file.arrayBuffer()));
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
    getChunk(x: number, y: number) {
        return this.chunks.get(this.getkey(x, y));
    }
    setChunk(x: number, y: number, chunk: VariantChunk | null | Promise<VariantChunk | null>) {
        this.chunks.set(this.getkey(x, y), chunk);
    }
}

export class VariantLayerResolver {
    private trackers: Map<string, VariantLayer> = new Map();
    private currentlayer: VariantLayer;

    constructor(mainlayer: VariantLayer) {
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

    async addFile(tilex: number, tiley: number, dependencyhash: number, exacthash: number) {
        let { chunkx, chunky } = this.currentlayer.getChunkCoords(tilex, tiley);
        let chunk = await this.currentlayer.getOrLoad(null as any, chunkx, chunky);
        if (!chunk) {
            chunk = new VariantChunk(this.currentlayer.layername, chunkx * variantGridSize, chunky * variantGridSize);
            this.currentlayer.setChunk(chunkx, chunky, chunk);
        }
        chunk.set(tilex, tiley, {
            dependencyhash,
            exacthash,
            savedLayerName: this.currentlayer.layername,
            savedLayerVersion: this.currentlayer.version
        });
    }

    async findCandidate(backend: MapRender, tilex: number, tiley: number, dependencyhash: number, exacthash: number) {
        for (let layer of this.trackers.values()) {
            let { chunkx, chunky } = layer.getChunkCoords(tilex, tiley);
            let chunk = layer.getOrLoad(backend, chunkx, chunky);
            // chunk loading is in progress
            if (chunk instanceof Promise) { chunk = await chunk; }
            // explicitly empty - doesn't exist
            if (chunk === null) { continue; }
            let variant = chunk.get(tilex, tiley);
            if (variant && variant.dependencyhash == dependencyhash) {
                return variant;
            }
            if (variant && exacthash != 0 && variant.exacthash == exacthash) {
                return variant;
            }
        }
    }
}

export class VariantResolver {
    private layers: Map<string, VariantLayerResolver> = new Map();
    private render: MapRender;

    constructor(render: MapRender) {
        this.render = render;
        for (let layer of render.config.layers) {
            this.initLayer(layer);
        }
    }

    layerkey(layername: string, zoom: number | null) {
        return `${layername}/${zoom}`;
    }

    initLayer(layer: LayerConfig) {
        let zooms = this.render.getLayerZooms(layer);
        for (let zoom = zooms.min; zoom <= zooms.max; zoom++) {
            let newlayer = new VariantLayer(layer.name, zoom, this.render.version);
            let resolver = new VariantLayerResolver(newlayer);
            this.layers.set(this.layerkey(layer.name, zoom), resolver);
        }
    }

    async finishChunk(chunkx: number, chunkz: number) {
        // TODO purge caches for obsolete chunks and write completed current chunks to backend
    }

    getLayerLevel(layername: string, zoom: number | null) {
        let key = this.layerkey(layername, zoom);
        let res = this.layers.get(key);
        if (!res) { throw new Error(`Layer ${layername} zoom ${zoom} not found in variant resolver`); }
        return res;
    }
}