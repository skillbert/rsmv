import { LayerConfig, Mapconfig, MapRenderer, SimpleHasher } from "..";
import { classicChunkSize, CombinedTileGrid, getTileHeight, MapRect, parseMapsquare, rs2ChunkSize, RSMapChunkData, tiledimensions, TileGrid } from "../../3d/mapsquare";
import { RSMapChunk } from "../../3d/modelnodes";
import { EngineCache } from "../../3d/modeltothree";
import { AsyncReturnType } from "../../utils";
import { KnownMapFile, MapRender } from "../backends";
import { ChunkRenderMeta, chunkSummary } from "../chunksummary";
import { drawCollision } from "../collisionimage";
import * as zlib from "zlib";
import prettyJson from "json-stringify-pretty-compact";
import { jsonIcons, svgfloor } from "../svgrender";
import { rendermode3d, rendermodeInteractions } from "./3d";
import { VariantInfo, VariantResolver } from "../varianttracker";


type MaprenderSquareData = {
    grid: TileGrid,
    chunkdata: RSMapChunkData,
    rendermeta: ChunkRenderMeta
};

export type MaprenderSquare = {
    parseprom: ReturnType<typeof parseMapsquare>,
    parsed: Awaited<ReturnType<typeof parseMapsquare>> | null,
    x: number,
    z: number,
    id: number,
    model: RSMapChunk | null,
    loaded: MaprenderSquareData | null,
    loadprom: Promise<void> | null,
};

export type MaprenderSquareLoaded = MaprenderSquare & {
    model: RSMapChunk,
    loaded: MaprenderSquareData
    parsed: Awaited<ReturnType<typeof parseMapsquare>>,
};

export type RenderResult = {
    file?: Promise<Buffer>,
    storedvariant?: VariantInfo,
    exacthash?: number
}

export type ImgNameInfo = {
    x: number,
    y: number,
    zoom: number | null,
    ext: string
};
export type ImgNameInfoZoom = ImgNameInfo & { zoom: number };

export type RenderTask = {
    layer: LayerConfig,
    nameinfo: ImgNameInfo,
    dependencyhash: number,
    datarect: MapRect,
    dedupeDependencies?: string[],
    mippable?: boolean,
    getExactHash?: (chunks: MaprenderSquareLoaded[]) => number,
    //first callback depends on state and should be series, 2nd is deferred and can be parallel
    run2d?: (chunks: AsyncReturnType<typeof parseMapsquare>[]) => Promise<RenderResult>,
    run?: (chunks: MaprenderSquareLoaded[], renderer: MapRenderer) => Promise<RenderResult>,
}

export type ChunkrenderContext<MODE extends LayerConfig["mode"]> = {
    engine: EngineCache,
    config: MapRender,
    layer: LayerConfig & { mode: MODE },
    deps: SimpleHasher,
    variants: VariantResolver,
    baseoutput: { x: number, y: number },
    maprect: MapRect
}

export type RenderMode<MODE extends LayerConfig["mode"]> = (context: ChunkrenderContext<MODE>) => RenderTask[];

export function chunkrectToOffetWorldRect(engine: EngineCache, config: MapRender, rect: MapRect) {
    const chunksize = (engine.classicData ? classicChunkSize : rs2ChunkSize);
    const offset = (config.config.nochunkoffset ? 0 : Math.round(chunksize / 4));
    let worldrect: MapRect = {
        x: rect.x * chunksize - offset,
        z: rect.z * chunksize - offset,
        xsize: chunksize * rect.xsize,
        zsize: chunksize * rect.zsize
    };
    let loadedchunksrect: MapRect = {
        x: rect.x - 1,
        z: rect.z - 1,
        xsize: rect.xsize + (config.config.nochunkoffset ? 2 : 1),
        zsize: rect.zsize + (config.config.nochunkoffset ? 2 : 1)
    };
    return { worldrect, loadedchunksrect };
}

const rendermodeCollision: RenderMode<"collision"> = function ({ engine, config, layer, deps, baseoutput, maprect }) {
    let zooms = config.getLayerZooms(layer.pxpersquare);
    let { loadedchunksrect, worldrect } = chunkrectToOffetWorldRect(engine, config, maprect);
    let depcrc = deps.recthash(loadedchunksrect);
    let format = getModeOutputInfo(config, layer, null);
    return [{
        layer: layer,
        nameinfo: { ...baseoutput, zoom: zooms.base, ext: format.ext },
        dependencyhash: depcrc,
        datarect: loadedchunksrect,
        mippable: true,
        async run2d(chunks) {
            //TODO try enable 2d map render without loading all the 3d stuff
            let grids = chunks.map(q => q.grid);
            let file = drawCollision(grids, worldrect, layer.level, layer.pxpersquare, 1, format.ext as any);
            return { file: file };
        }
    }];
}

const rendermodeHeight: RenderMode<"height"> = function ({ engine, config, layer, deps, baseoutput, maprect }) {
    let format = getModeOutputInfo(config, layer, null);
    return [{
        layer: layer,
        nameinfo: { x: maprect.x, y: maprect.z, zoom: null, ext: format.ext },
        dependencyhash: deps.recthash(maprect),
        datarect: maprect,
        async run2d(chunks) {
            //TODO what to do with classic 48x48 chunks?
            let file = chunks[0].grid.getHeightCollisionFile(maprect.x * 64, maprect.z * 64, layer.level, 64, 64, layer.allcorners ?? false);
            let buf: Buffer = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
            if (format.gzip) {
                buf = zlib.gzipSync(buf);
            }
            return { file: Promise.resolve(buf) };
        }
    }];
}

const rendermodeLocs: RenderMode<"locs"> = function ({ engine, config, layer, deps, baseoutput, maprect }) {
    let format = getModeOutputInfo(config, layer, null);
    return [{
        layer: layer,
        nameinfo: { x: maprect.x, y: maprect.z, zoom: null, ext: format.ext },
        dependencyhash: deps.recthash(maprect),
        datarect: maprect,
        async run(chunks) {
            let { grid, modeldata, chunkSize } = chunks[0].loaded.chunkdata;
            let rect = { x: maprect.x * chunkSize, z: maprect.z * chunkSize, xsize: chunkSize, zsize: chunkSize };
            let { locdatas, locs } = chunkSummary(grid, modeldata, rect);
            let textual = prettyJson({ locdatas, locs, rect }, { indent: "\t" });
            let buf: Buffer = Buffer.from(textual, "utf8");
            if (format.gzip) {
                buf = zlib.gzipSync(buf);
            }
            return { file: Promise.resolve(buf) };
        }
    }];
}

const rendermodeMaplabels: RenderMode<"maplabels"> = function ({ engine, config, layer, deps, maprect }) {
    let format = getModeOutputInfo(config, layer, null);
    return [{
        layer: layer,
        nameinfo: { x: maprect.x, y: maprect.z, zoom: null, ext: format.ext },
        dependencyhash: deps.recthash(maprect),
        datarect: maprect,
        async run2d(chunks) {
            let chunkSize = chunks[0].chunkSize;
            let rawarea = { x: maprect.x * chunkSize, z: maprect.z * chunkSize, xsize: chunkSize, zsize: chunkSize };
            let locs = chunks.flatMap(ch => ch.chunk?.locs ?? []);
            let iconjson = await jsonIcons(engine, locs, rawarea, layer.level);
            let textual = prettyJson(iconjson, { indent: "\t" });
            let buf: Buffer = Buffer.from(textual, "utf8");
            if (format.gzip) {
                buf = zlib.gzipSync(buf);
            }
            return { file: Promise.resolve(buf) };
        }
    }];
}

const rendermodeRenderMeta: RenderMode<"rendermeta"> = function ({ engine, config, layer, deps, baseoutput, maprect }) {
    return [{
        layer: layer,
        nameinfo: { x: maprect.x, y: maprect.z, zoom: null, ext: layer.usegzip ? "json.gz" : "json" },
        dependencyhash: deps.recthash(maprect),
        datarect: maprect,
        async run(chunks) {
            let obj = chunks[0].loaded.rendermeta;
            let file = Buffer.from(JSON.stringify(obj), "utf8");
            if (layer.usegzip) {
                file = zlib.gzipSync(file) as any;
            }
            return { file: Promise.resolve(file) };
        }
    }];
}

const rendermodeMap: RenderMode<"map"> = function ({ engine, config, layer, deps, baseoutput, maprect }) {
    let { loadedchunksrect, worldrect } = chunkrectToOffetWorldRect(engine, config, maprect);
    let dummypxpersquare = 256; //svg is arbitrary resolution so this only matters for default view
    let zooms = config.getLayerZooms(dummypxpersquare);
    let depcrc = deps.recthash(loadedchunksrect);
    return [{
        layer: layer,
        nameinfo: { ...baseoutput, zoom: zooms.base, ext: "svg" },
        dependencyhash: depcrc,
        datarect: loadedchunksrect,
        mippable: true,
        async run2d(parsedata) {
            let grid = new CombinedTileGrid(parsedata.map(pp => ({
                src: pp.grid,
                rect: {
                    x: pp.chunkx * pp.chunkSize,
                    z: pp.chunkz * pp.chunkSize,
                    xsize: pp.chunkSize,
                    zsize: pp.chunkSize,
                }
            })));
            let locs = parsedata.flatMap(ch => ch.chunk?.locs ?? []);
            let svg = await svgfloor(engine, grid, locs, worldrect, layer.level, dummypxpersquare, !!layer.wallsonly, !!layer.mapicons, !!layer.thicklines);
            return {
                file: Promise.resolve(Buffer.from(svg, "utf8"))
            };
        }
    }];
}


export const rendermodes: Record<LayerConfig["mode"], RenderMode<any>> = {
    "3d": rendermode3d,
    minimap: rendermode3d,
    interactions: rendermodeInteractions,
    collision: rendermodeCollision,
    map: rendermodeMap,
    height: rendermodeHeight,
    locs: rendermodeLocs,
    maplabels: rendermodeMaplabels,
    rendermeta: rendermodeRenderMeta
}

export function getModeOutputInfo(config: MapRender, layer: LayerConfig, zoom: number | null) {
    switch (layer.mode) {
        case "3d":
        case "minimap":
        case "collision":
            return { ext: layer.format ?? "webp", gzip: false };
        case "map": {
            let zoominfo = config.getLayerZooms(config.config.tileimgsize / rs2ChunkSize);
            if (zoom == zoominfo.base) {
                return { ext: "svg", gzip: false };
            } else {
                return { ext: layer.format ?? "webp", gzip: false };
            }
        }
        case "height":
            return { ext: layer.usegzip ? "bin.gz" : "bin", gzip: !!layer.usegzip };
        case "locs":
        case "maplabels":
        case "rendermeta":
        case "interactions":
            return { ext: layer.usegzip ? "json.gz" : "json", gzip: !!layer.usegzip };
        default:
            throw new Error("Unknown layer mode");
    }
}

