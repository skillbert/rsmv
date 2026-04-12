import { Camera, Object3D } from "three";
import { chunkrectToOffetWorldRect, MaprenderSquare, RenderMode, RenderTask } from ".";
import { CombinedTileGrid, getTileHeight, tiledimensions } from "../../3d/mapsquare";
import { canvasToImageFile, findImageBounds, pixelsToImageFile, sliceImage } from "../../imgutils";
import prettyJson from "json-stringify-pretty-compact";
import { chunkSummary, visibleChunkHash } from "../chunksummary";
import { svgfloor } from "../svgrender";
import * as zlib from "zlib";
import { crc32addInt } from "../../libs/crc32util";


function setChunkRenderToggles(chunks: MaprenderSquare[], floornr: number, isminimap: boolean, hidelocs: boolean) {
    let toggles: Record<string, boolean> = {};
    for (let i = 0; i < 4; i++) {
        toggles["floor" + i] = !isminimap && i <= floornr;
        toggles["objects" + i] = !hidelocs && !isminimap && i <= floornr;
        toggles["mini_floor" + i] = isminimap && i <= floornr;
        toggles["mini_objects" + i] = !hidelocs && isminimap && i <= floornr;
        toggles["walkmesh" + i] = false;
        toggles["map" + i] = false;
        toggles["mapscenes" + i] = false;
        toggles["walls" + i] = false;
        toggles["floorhidden" + i] = false;
        toggles["collision" + i] = false;
        toggles["collision-raw" + i] = false;
    }
    for (let chunk of chunks) {
        chunk.model?.setToggles(toggles);
    }
}

//TODO test map generation and move it over to mapimagecamera2
export function mapImageCamera(x: number, z: number, ntiles: number, dxdy: number, dzdy: number) {
    let scale = 2 / ntiles;
    let cam = new Camera();
    cam.projectionMatrix.elements = [
        scale, scale * dxdy, 0, -x * scale - 1,
        0, scale * dzdy, -scale, -z * scale - 1,
        0, -0.01, 0, 0,
        0, 0, 0, 1
    ];
    // cam.projectionMatrix.scale(new Vector3(1, -1, 1));
    cam.projectionMatrix.transpose();
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    return cam;
}
// export function mapImageCamera2(x: number, z: number, ntiles: number, dxdy: number, dzdy: number) {
// 	let cam = new SkewOrthographicCamera(ntiles, dxdy, dzdy);
// 	cam.pointDown();
// 	//negative z since the camera is usually in threejs reference frame instead of the flipped rs reference frame
// 	cam.position.set(x + ntiles / 2, 0, -(z + ntiles / 2));
// 	return cam;
// }

export const rendermode3d: RenderMode<"3d" | "minimap"> = function ({ engine, config, layer, deps, baseoutput, maprect, variants }) {
    let zooms = config.getLayerZooms(layer);
    let { loadedchunksrect, worldrect } = chunkrectToOffetWorldRect(engine, config, maprect);
    let tasks: RenderTask[] = [];
    let overlayimg: HTMLImageElement | null = null;

    for (let zoom = zooms.base; zoom <= zooms.max; zoom++) {
        let subslices = 1 << (zoom - zooms.base);
        let pxpersquare = layer.pxpersquare >> (zooms.max - zoom);
        let tiles = worldrect.xsize / subslices;
        for (let subx = 0; subx < subslices; subx++) {
            for (let subz = 0; subz < subslices; subz++) {
                let suby = (config.config.noyflip ? subz : subslices - 1 - subz);
                let imgtilex = baseoutput.x * subslices + subx;
                let imgtiley = baseoutput.y * subslices + suby;
                let filename = config.makeFileName(layer.name, zoom, imgtilex, imgtiley, layer.format ?? "webp");

                // let parentCandidates: { name: string, level: number }[] = [
                //     { name: filename, level: layer.level }
                // ];
                // for (let sub of layer.subtractlayers ?? []) {
                //     let other = config.config.layers.find(q => q.name == sub);
                //     if (!other) {
                //         console.warn("subtrack layer " + sub + "missing");
                //         continue;
                //     }
                //     parentCandidates.push({
                //         name: config.makeFileName(other.name, zoom, baseoutput.x * subslices + subx, baseoutput.y * subslices + suby, other.format ?? "webp"),
                //         level: other.level
                //     });
                // }

                let cam = mapImageCamera(worldrect.x + tiles * subx, worldrect.z + tiles * subz, tiles, layer.dxdy, layer.dzdy);
                let depcrc = deps.recthash(loadedchunksrect);
                tasks.push({
                    layer: layer,
                    nameinfo: { x: imgtilex, y: imgtiley, zoom: zoom, ext: layer.format ?? "webp" },
                    dependencyhash: depcrc,
                    datarect: loadedchunksrect,
                    // dedupeDependencies: parentCandidates.map(q => q.name),
                    mippable: zoom == zooms.base,
                    getExactHash(chunks) {
                        let hash = 0;
                        for (let chunk of chunks) {
                            chunk.model.loaded!.chunkroot.updateWorldMatrix(true, false);
                            let modelmatrix = chunk.model.loaded!.chunkroot.matrixWorld;

                            let chunktoscreen = cam.projectionMatrix.clone()
                                .multiply(cam.matrixWorldInverse)
                                .multiply(modelmatrix);
                            let subhash = visibleChunkHash(chunk.loaded.rendermeta.visuals, chunktoscreen, layer.level);
                            hash = crc32addInt(subhash, hash);
                        }
                        return hash;
                    },
                    async run(chunks, renderer) {
                        setChunkRenderToggles(chunks, layer.level, layer.mode == "minimap", !!layer.hidelocs);

                        // // check if any other layer has the same render already
                        // for (let parentoption of parentCandidates) {
                        //     let parentfile = await parentinfo.checkMatches(parentoption.name, this.datarect, chunks, cam, layer.level, parentoption.level);
                        //     if (parentfile) {
                        //         return {
                        //             file: undefined,
                        //             symlink: parentfile
                        //         };
                        //     }
                        // }


                        // svg overlay to draw walls/icons need to be rendered for this chunk
                        if (!overlayimg && (layer.overlayicons || layer.overlaywalls)) {
                            if (layer.overlayicons && !layer.overlaywalls) {
                                //need to refarctor svgfloor a bit for this to work without breaking other stuff
                                throw new Error("overlayicons without overlaywalls currently not supported");
                            }
                            let grid = new CombinedTileGrid(chunks.map(ch => ({
                                src: ch.loaded.grid,
                                rect: {
                                    x: ch.model.chunkx * ch.loaded.chunkdata.chunkSize,
                                    z: ch.model.chunkz * ch.loaded.chunkdata.chunkSize,
                                    xsize: ch.loaded.chunkdata.chunkSize,
                                    zsize: ch.loaded.chunkdata.chunkSize,
                                }
                            })));
                            let locs = chunks.flatMap(ch => ch.model.loaded!.chunk?.locs ?? []);
                            let svg = await svgfloor(engine, grid, locs, worldrect, layer.level, layer.pxpersquare, !!layer.overlaywalls, !!layer.overlayicons, true);
                            overlayimg = new Image();
                            overlayimg.src = `data:image/svg+xml;base64,${btoa(svg)}`;
                            await overlayimg.decode();
                        }

                        // the actual render
                        let img = await renderer.renderer.takeMapPicture(cam, tiles * pxpersquare, tiles * pxpersquare, layer.mode == "minimap");

                        // //keep reference to dedupe similar renders
                        // chunks.forEach(chunk => parentinfo.addLocalSquare(chunk.loaded.rendermeta));
                        // parentinfo.addLocalFile({
                        //     file: this.name,
                        //     fshash: depcrc,
                        //     buildnr: config.version,
                        //     firstbuildnr: config.version,
                        //     hash: depcrc,
                        //     time: Date.now()
                        // });

                        if (overlayimg) {
                            let mergecnv = document.createElement("canvas");
                            mergecnv.width = img.width;
                            mergecnv.height = img.height;
                            let ctx = mergecnv.getContext("2d")!;
                            ctx.putImageData(img, 0, 0);

                            ctx.drawImage(overlayimg,
                                overlayimg.width * subx / subslices,
                                overlayimg.height * (subslices - 1 - subz) / subslices,
                                overlayimg.width / subslices,
                                overlayimg.height / subslices,
                                0, 0, img.width, img.height
                            );
                            return {
                                file: canvasToImageFile(mergecnv, layer.format ?? "webp", 0.9)
                            };
                        } else {
                            return {
                                file: pixelsToImageFile(img, layer.format ?? "webp", 0.9)
                            };
                        }
                    }
                });
            }
        }
    }
    return tasks;
}


export const rendermodeInteractions: RenderMode<"interactions"> = function ({ config, layer, deps, maprect }) {
    return [{
        layer: layer,
        nameinfo: { x: maprect.x, y: maprect.z, zoom: null, ext: layer.usegzip ? "json.gz" : "json" },
        dependencyhash: deps.recthash(maprect),
        datarect: maprect,
        async run(chunks, renderer) {
            let loaded = chunks[0].loaded.chunkdata;
            if (!loaded) { throw new Error("unexpected"); }
            let rect = { x: maprect.x * loaded.chunkSize, z: maprect.z * loaded.chunkSize, xsize: loaded.chunkSize, zsize: loaded.chunkSize };
            let { hashes, locdatas, locs } = chunkSummary(loaded.grid, loaded.modeldata, rect);
            let emptyimagecount = 0;
            let hashimgs: Record<number, { img: string, center: number[], loc: number, dx: number, dy: number, w: number, h: number }> = {};
            for (let [hash, { center, locdata }] of hashes) {
                let ops = [locdata.location.actions_0, locdata.location.actions_1, locdata.location.actions_2, locdata.location.actions_3, locdata.location.actions_4].filter((q): q is string => !!q);
                let model = loaded.locRenders.get(locdata);
                if (!model) { continue; }
                // if (ops.length == 0) { continue; }
                setChunkRenderToggles(chunks, locdata.plane, false, true);

                let sections = model.map(q => q.mesh.cloneSection(q));
                model.map(q => q.mesh.setSectionHide(q, true));
                let group = new Object3D();
                group.add(...sections.map(q => q.mesh));
                group.traverse(q => q.layers.set(1));
                loaded.chunkroot.add(group);

                let ntiles = 16;
                let baseheight = getTileHeight(loaded.grid, locdata.x, locdata.z, locdata.plane);
                let ypos = baseheight / tiledimensions + center[1];
                let cam = mapImageCamera(locdata.x + center[0] + ypos * layer.dxdy - ntiles / 2, locdata.z + center[2] + ypos * layer.dzdy - ntiles / 2, ntiles, layer.dxdy, layer.dzdy);
                let img = await renderer.renderer.takeMapPicture(cam, ntiles * layer.pxpersquare, ntiles * layer.pxpersquare, false, group);
                group.removeFromParent();

                model.map(q => q.mesh.setSectionHide(q, false));

                let bounds = findImageBounds(img);
                if (bounds.width == 0 || bounds.height == 0) {
                    emptyimagecount++;
                    continue;
                }

                let format = layer.format ?? "webp";
                let subimg = sliceImage(img, bounds);
                let imgfile = await pixelsToImageFile(subimg, format, 0.9);
                hashimgs[hash] = {
                    loc: locdata.locid,
                    dx: bounds.x - img.width / 2,
                    dy: bounds.y - img.height / 2,
                    w: bounds.width,
                    h: bounds.height,
                    center,
                    img: `data:image/${format};base64,${imgfile.toString("base64")}`
                };
            }
            let textual = prettyJson({ locs, locdatas, rect, hashimgs, pxpertile: layer.pxpersquare, dxdy: layer.dxdy, dzdy: layer.dzdy }, { indent: "\t" });
            let buf: Buffer = Buffer.from(textual, "utf8");
            if (layer.usegzip) {
                buf = zlib.gzipSync(buf);
            }
            return { file: Promise.resolve(buf) };
        }
    }];
}
