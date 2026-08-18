import React from "react";
import { MapRect, rs2ChunkSize, worldStride } from "../../3d/mapsquare";
import { EngineCache } from "../../3d/modeltothree";
import { UIEngineContext } from "../maincomponents";
import { cacheMajors } from "../../constants";
import { CacheIndexFile } from "../../cache";
import { mapsquare_tiles } from "../../../generated/mapsquare_tiles";
import { delay, taskTrickler } from "../../utils";

export type MapviewMarker = { x: number, z: number };

function rectToChunks(rect: MapRect) {
    let chunksids: [number, number][] = [];
    for (let chunkx = Math.floor(rect.x / rs2ChunkSize); chunkx < Math.ceil((rect.x + rect.xsize) / rs2ChunkSize); chunkx++) {
        for (let chunkz = Math.floor(rect.z / rs2ChunkSize); chunkz < Math.ceil((rect.z + rect.zsize) / rs2ChunkSize); chunkz++) {
            chunksids.push([chunkx, chunkz]);
        }
    }
    return chunksids;
}


export async function renderMapPreview(engine: EngineCache, rect: MapRect, level = 0, scale = 1) {
    let img = new ImageData(rect.xsize * scale, rect.zsize * scale);

    let fillpixels: number[] = [];
    for (let dx = 0; dx < scale; dx++) {
        for (let dz = 0; dz < scale; dz++) {
            fillpixels.push(dx * 4 + dz * img.width * 4);
        }
    }
    let chunkids = rectToChunks(rect);


    let trickler = taskTrickler(16);
    let chunks = await Promise.all(chunkids.map(async q => trickler(() => engine.getObject("maptiles", q).catch(q => null))));

    for (let i = 0; i < chunks.length; i++) {
        let [chunkx, chunkz] = chunkids[i];
        let chunk = chunks[i];
        if (!chunk) continue;

        for (let z = 0; z < rs2ChunkSize; z++) {
            for (let x = 0; x < rs2ChunkSize; x++) {
                let tileindex = level * rs2ChunkSize * rs2ChunkSize + x * rs2ChunkSize + z;
                let tile = chunk.tiles[tileindex];
                if (!tile) { continue; }

                let pixelx = chunkx * rs2ChunkSize + x - rect.x;
                let pixelz = chunkz * rs2ChunkSize + z - rect.z;
                if (pixelx < 0 || pixelx >= rect.xsize || pixelz < 0 || pixelz >= rect.zsize) { continue; }
                let pixelindex = pixelz * img.width * 4 * scale + pixelx * 4 * scale;
                let didrender = false;
                if (tile.overlay !== null) {
                    let overlay = engine.mapOverlays[tile.overlay - 1];
                    let r = overlay?.color?.[0] ?? 0;
                    let g = overlay?.color?.[1] ?? 0;
                    let b = overlay?.color?.[2] ?? 0;
                    if (r == 255 && g == 0 && b == 255) {
                        // overlay is cutout, skip
                    } else {
                        didrender = true;
                        for (let fillindex of fillpixels) {
                            let finalindex = pixelindex + fillindex;
                            img.data[finalindex + 0] = r;
                            img.data[finalindex + 1] = g;
                            img.data[finalindex + 2] = b;
                            img.data[finalindex + 3] = 255;
                        }
                    }
                }
                if (!didrender && tile.underlay !== null) {
                    let underlay = engine.mapUnderlays[tile.underlay - 1];
                    let r = underlay?.color?.[0] ?? 0;
                    let g = underlay?.color?.[1] ?? 0;
                    let b = underlay?.color?.[2] ?? 0;
                    for (let fillindex of fillpixels) {
                        let finalindex = pixelindex + fillindex;
                        img.data[finalindex + 0] = r;
                        img.data[finalindex + 1] = g;
                        img.data[finalindex + 2] = b;
                        img.data[finalindex + 3] = 255;
                    }
                }
            }
        }
    }
    return img;
}

function simpleMapRenderer(engine: EngineCache | undefined, initialx?: number, initialz?: number, initialpxpertile?: number) {
    let scroll = (e: WheelEvent) => {
        res.pxpertile *= (1 - e.deltaY / 200);
        res.pxpertile = Math.max(1 / 16, Math.min(16, res.pxpertile));
        queuerender();
    }

    let mousedown = (e: MouseEvent) => {
        let lastx = e.clientX;
        let lasty = e.clientY;
        let move = (e: MouseEvent) => {
            res.centerx -= (e.clientX - lastx) / res.pxpertile;
            res.centerz -= -(e.clientY - lasty) / res.pxpertile;
            lastx = e.clientX;
            lasty = e.clientY;
            queuerender();
        }
        let up = (e: MouseEvent) => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        }

        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    }

    let ref = (canvas: HTMLCanvasElement | null) => {
        if (!canvas) {
            res.cnv?.removeEventListener("mousedown", mousedown);
            res.cnv?.removeEventListener("wheel", scroll);
            res.cnv = null;
            res.ctx = null;
            return;
        }
        canvas.addEventListener("mousedown", mousedown);
        canvas.addEventListener("wheel", scroll);
        res.ctx = canvas.getContext("2d")!;
        res.cnv = canvas;
        queuerender();
    }

    let tiletopx = (tilex: number, tilez: number) => {
        let x = (tilex - res.centerx) * res.pxpertile + res.cnv!.width / 2;
        let z = -(tilez - res.centerz) * res.pxpertile + res.cnv!.height / 2;
        return [x, z];
    }

    let chunkindex: CacheIndexFile | null = null;
    let chunkcache = new Map<number, ImageBitmap | Promise<ImageBitmap>>();
    engine?.getCacheIndex(cacheMajors.mapsquares).then(q => { chunkindex = q; queuerender(); });

    let framereq = 0;
    let queuerender = () => {
        if (framereq) { return; }
        framereq = requestAnimationFrame(() => {
            framereq = 0;
            render();
        });
    }

    let tricklerender = taskTrickler(10);
    let render = () => {
        if (!res.cnv || !res.ctx || !engine) { return; }
        res.cnv.width = res.cnv.clientWidth;
        res.cnv.height = res.cnv.clientHeight;
        res.ctx.imageSmoothingEnabled = false;

        let toosmall = res.pxpertile < 0.9;

        let xsize = res.cnv.width / res.pxpertile;
        let zsize = res.cnv.height / res.pxpertile;
        let rect: MapRect = { x: res.centerx - xsize / 2, z: res.centerz - zsize / 2, xsize, zsize }
        let chunks = rectToChunks(rect);
        for (let [chunkx, chunkz] of chunks) {
            if (chunkx < 0 || chunkz < 0 || chunkx >= 100 || chunkz >= 200) { continue; }
            let key = chunkz * worldStride + chunkx;
            if (!chunkindex?.[key]) {
                continue; //doesn't exist
            }
            let didrender = false;
            let chunkimg = chunkcache.get(key);
            if (!chunkimg && !toosmall) {
                chunkcache.set(key, tricklerender(async () => {
                    let img = await renderMapPreview(engine, { x: chunkx * rs2ChunkSize, z: chunkz * rs2ChunkSize, xsize: rs2ChunkSize, zsize: rs2ChunkSize }, 0, 1);
                    let bmp = await createImageBitmap(img, { imageOrientation: "flipY" });
                    chunkcache.set(key, bmp);
                    render();
                    return bmp;
                }));
            }
            if (chunkimg instanceof ImageBitmap) {
                let [px, pz] = tiletopx(chunkx * rs2ChunkSize, (chunkz + 1) * rs2ChunkSize);
                res.ctx.drawImage(chunkimg, px, pz, rs2ChunkSize * res.pxpertile, rs2ChunkSize * res.pxpertile);
                didrender = true;
            }
            if (!didrender) {
                res.ctx.fillStyle = "rgba(160,160,160,1)";
                let [px, pz] = tiletopx(chunkx * rs2ChunkSize, (chunkz + 1) * rs2ChunkSize);
                res.ctx.fillRect(px, pz, rs2ChunkSize * res.pxpertile, rs2ChunkSize * res.pxpertile);
            }
        }
        res.ctx.strokeStyle = "rgba(255,255,255,0.5)";
        let [px, pz] = tiletopx(0, 0);
        res.ctx.strokeRect(px, pz, 100 * rs2ChunkSize * res.pxpertile, -200 * rs2ChunkSize * res.pxpertile);

        for (let marker of res.markers) {
            let [px, pz] = tiletopx(marker.x + 0.5, marker.z + 0.5);
            res.ctx.fillStyle = "rgba(255,0,0,1)";
            res.ctx.beginPath();
            res.ctx.moveTo(px, pz);
            res.ctx.arc(px, pz - 20, 10, Math.PI * 3 / 4, Math.PI * 1 / 4);
            res.ctx.closePath();
            res.ctx.fill();
            res.ctx.fillStyle = "rgba(255,255,255,1)";
            res.ctx.beginPath();
            res.ctx.ellipse(px, pz - 20, 6, 6, 0, 0, Math.PI * 2);
            res.ctx.fill();
            if (res.pxpertile > 4) {
                res.ctx.strokeRect(px - res.pxpertile / 2, pz - res.pxpertile / 2, res.pxpertile, res.pxpertile);
            }
        }
    }
    let res = {
        cnv: null as HTMLCanvasElement | null,
        ctx: null as CanvasRenderingContext2D | null,
        ref,
        render: queuerender,
        pxpertile: initialpxpertile ?? 2,
        centerx: initialx ?? 50 * rs2ChunkSize,
        centerz: initialz ?? 50 * rs2ChunkSize,
        markers: [] as MapviewMarker[],
    };

    return res;
}

export function CheapMapView(p: { level?: number, centerx?: number, centerz?: number, pxpertile?: number, markers?: MapviewMarker[] }) {
    let ctx = React.useContext(UIEngineContext);
    let engine = ctx?.sceneCache.engine;

    let renderer = React.useMemo(() => simpleMapRenderer(engine, p.centerx, p.centerz, p.pxpertile), [engine]);

    renderer.markers = p.markers ?? [];

    return <canvas className="mv-canvas" ref={renderer.ref} />
}