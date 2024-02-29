
import { mapsquare_locations } from "../../generated/mapsquare_locations";
import { mapsquare_tiles } from "../../generated/mapsquare_tiles";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { objects } from "../../generated/objects";
import { MapRect, TileGrid, TileProps, tileshapes } from "../3d/mapsquare";
import { ClassicConfig, classicGroups } from "../cache/classicloader";
import { combineLegacyTexture } from "../cache/legacycache";
import { crc32 } from "../libs/crc32util";
import { HSL2packHSL, RGB2HSL, Stream } from "../utils";
import { constModelsIds, EngineCache } from "./modeltothree";

const chunkSize = 48;
const chunkTileCount = chunkSize * chunkSize;

const classicLocIdWall = 1000000;
const classicLocIdRoof = 2000000;

type LocPlacementExtra = mapsquare_locations["locations"][number]["uses"][number]["extra"];


function indexToPos(i: number) {
    const last = chunkSize - 1;
    let x = last - (i / chunkSize | 0);
    let z = last - i % chunkSize;
    return { rs2index: x * chunkSize + z, x, z };
}
function posToIndex(x: number, z: number) {
    return (chunkSize - 1 - x) * chunkSize + (chunkSize - 1 - z);
}

type ClassicTileDef = {
    height: number,
    hasbridge: boolean,
    // wall: " " | "|" | "-" | "/" | "\\",
    // loc: number,
    // roof: number,
    overlayobj: ClassicConfig["tiles"][number] | null,
    overlay: number,
    underlay: number,
    locrotation: number
};

export async function getClassicMapData(engine: EngineCache, rs2x: number, rs2z: number) {
    let isunderground = rs2z >= 100;
    let mapfilehash = 0;

    const config = engine.classicData!;
    let chunkx = 100 - rs2x;
    let chunkz = 100 - (isunderground ? rs2z - 100 : rs2z);
    let chunknum = `${chunkx.toString().padStart(2, "0")}${chunkz.toString().padStart(2, "0")}`;

    let leveldatas: { hei: Buffer | undefined, jm: Buffer | undefined, loc: Buffer | undefined, dat: Buffer | undefined, sourcelevel: number }[] = [];
    let nlevels = (isunderground ? 1 : 3);

    for (let level = 0; level < nlevels; level++) {
        let sourcelevel = (isunderground ? 3 : level);
        let heifile = (engine.getBuildNr() <= 115 ? undefined : await engine.findSubfileByName(0, classicGroups.land, `m${sourcelevel}${chunknum}.hei`));
        let jmfile = await engine.findSubfileByName(0, classicGroups.maps, `m${sourcelevel}${chunknum}.jm`);
        if (!heifile && !jmfile && level == 0) {
            //return before allocating all kinda of stuff if chunk doesn't exist
            return null;
        }
        leveldatas.push({ sourcelevel, hei: heifile?.buffer, jm: jmfile?.buffer, loc: undefined, dat: undefined });
    }
    let grid = new ClassicMapBuilder(config, nlevels);
    for (let level = 0; level < nlevels; level++) {
        let leveldata = leveldatas[level];
        if (!leveldata.jm) {
            let datfile = await engine.findSubfileByName(0, classicGroups.maps, `M${leveldata.sourcelevel}${chunknum}.DAT`);
            let locfile = await engine.findSubfileByName(0, classicGroups.maps, `M${leveldata.sourcelevel}${chunknum}.LOC`);
            leveldata.dat = datfile?.buffer;
            leveldata.loc = locfile?.buffer;
        }
    }

    //load all floors
    for (let level = 0; level < nlevels; level++) {
        let leveldata = leveldatas[level];
        if (leveldata.jm) {
            grid.loadJmFile(leveldata.jm, level);
            mapfilehash = crc32(leveldata.jm, mapfilehash);
        } else if (leveldata.hei) {
            grid.loadHeiFile(leveldata.hei, level);
            mapfilehash = crc32(leveldata.hei, mapfilehash);
        }
    }

    //load walls/roofs/locs
    for (let level = 0; level < nlevels; level++) {
        let leveldata = leveldatas[level];
        if (!leveldata.jm) {
            if (leveldata.dat) {
                grid.loadDatfile(leveldata.dat, level);
                mapfilehash = crc32(leveldata.dat, mapfilehash);
            }
            if (leveldata.loc) {
                grid.loadLocFile(leveldata.loc, level);
                mapfilehash = crc32(leveldata.loc, mapfilehash);
            } else {
                let locs = loadLocJsonBuffer(config, chunkx, chunkz, leveldata.sourcelevel);
                mapfilehash = crc32(Buffer.from(locs.buffer), mapfilehash);
                grid.addLocBuffer(locs, level);
            }
        }
    }

    let rect: MapRect = { x: rs2x * chunkSize, z: rs2z * chunkSize, xsize: chunkSize, zsize: chunkSize }

    return {
        rect,
        mapfilehash,
        tiles: grid.convertTiles(),
        locs: grid.locs,
        levels: nlevels
    };
}

class ClassicMapBuilder {
    levels: number;
    tiles: ClassicTileDef[];
    locs: mapsquare_locations["locations"] = [];
    config: ClassicConfig;
    constructor(config: ClassicConfig, maxlevels: number) {
        this.config = config;
        this.levels = maxlevels;
        this.tiles = new Array(chunkTileCount * maxlevels).fill(null).map((q, i) => ({
            height: (i > chunkTileCount ? 96 : 0),//based on wall height 192/128*tilesize=768
            hasbridge: false,
            // loc: 0,
            // wall: " ",
            // roof: 0,
            overlayobj: null,
            overlay: 0,
            underlay: 0,
            locrotation: 0
        }));
    }

    getTile(level: number, x: number, z: number) {
        if (x < 0 || z < 0 || x >= chunkSize || z >= chunkSize) { return undefined; }
        if (level < 0 || level >= this.levels) { return undefined; }
        return this.tiles[level * chunkTileCount + x * chunkSize + z];
    }

    getTileClassic(level: number, index: number) {
        const last = chunkSize - 1;
        let x = last - (index / chunkSize | 0);
        let z = last - index % chunkSize;
        return this.getTile(level, x, z);
    }

    placeLoc(id: number, type: number, rotation: number, level: number, x: number, z: number, extra: LocPlacementExtra = null) {
        let above = this.getTile(level + 1, x, z);
        if (above?.overlayobj?.type.bridge) {
            level++;
        } else if (type == 0) {
            //check other tile if our loc is a wall between two tiles
            let neighbour = (rotation == 2 ? this.getTile(level + 1, x + 1, z) : this.getTile(level + 1, x, z + 1));
            if (neighbour?.overlayobj?.type.bridge) {
                level++;
            }
        }
        this.locs.push({
            id,
            uses: [{ x, y: z, plane: level, rotation, type, extra }]
        });
    }

    convertTiles() {
        return this.tiles.map<mapsquare_tiles["tiles"][number]>((tile, i) => {
            let level = Math.floor(i / chunkTileCount);
            let below = this.tiles[i - chunkTileCount];
            return {
                height: (tile.hasbridge ? (level == 1 && below.hasbridge ? below.height / 4 : 0) : tile.height / 4),
                flags: 0,
                settings: (level == 1 && tile.hasbridge ? 2 : 0),
                overlay: tile.overlay,
                underlay: tile.underlay,
                shape: (tile.overlay ? 0 : null)
            }
        })
    }

    loadJmFile(jmfile: Buffer, level: number) {
        let jm = new Stream(jmfile);

        let lastTerrain = 0;
        let terrainHeight = Buffer.alloc(chunkTileCount);
        for (let tile = 0; tile < chunkTileCount; tile++) {
            lastTerrain += jm.readUByte();
            terrainHeight[tile] = lastTerrain & 0xff;
        }
        let lastColor = 0;
        let terrainColor = Buffer.alloc(chunkTileCount);
        for (let tile = 0; tile < chunkTileCount; tile++) {
            lastColor += jm.readUByte();
            terrainColor[tile] = lastColor & 0xff;
        }

        let horwalls = jm.readBuffer(chunkTileCount);
        let verwalls = jm.readBuffer(chunkTileCount);

        let diag1walls = Buffer.alloc(chunkTileCount);
        let diag2walls = Buffer.alloc(chunkTileCount);
        let locbuffer = new Uint32Array(chunkTileCount);
        for (let tile = 0; tile < chunkTileCount; tile++) {
            let locint = jm.readUShort(true);
            if (locint != 0) {
                let type = locint / 12000 | 0;
                let objid = locint % 12000;
                let pos = indexToPos(tile);
                if (type == 0) {
                    diag1walls[tile] = objid;
                } else if (type == 1) {
                    diag2walls[tile] = objid;//wtf???
                } else if (type == 2) {
                    //npc
                } else if (type == 3) {
                    //item spawn
                } else if (type == 4) {
                    locbuffer[tile] = objid;
                } else {
                    console.log(pos.x, pos.z, tile, " type" + (locint / 12000 | 0), locint % 12000);
                }
            }
        }

        let roofs = jm.readBuffer(chunkTileCount);
        let overlays = jm.readBuffer(chunkTileCount);
        let locdirections = jm.readBuffer(chunkTileCount);

        if (!jm.eof()) { throw new Error("didn't end reading map.jm at end of file"); }

        if (level == 0) {
            this.addFloorBuffers(terrainHeight, terrainColor, level, false);
        }
        this.addWallBuffers(horwalls, verwalls, diag1walls, diag2walls, roofs, overlays, locdirections, level);
        this.addLocBuffer(locbuffer, level);
    }

    loadHeiFile(heifile: Buffer, level: number) {
        let hei = new Stream(heifile);

        //based on https://github.com/2003scape/rsc-landscape/blob/master/src/sector.js#L138
        let lastVal = 0;
        let terrainHeight = Buffer.alloc(chunkTileCount);
        let terrainColor = Buffer.alloc(chunkTileCount);

        for (let tile = 0; tile < chunkTileCount;) {
            let val = hei.readUByte();
            if (val < 128) {
                terrainHeight[tile++] = val & 0xff;
                lastVal = val;
            }
            if (val >= 128) {
                for (let i = 0; i < val - 128; i++) {
                    terrainHeight[tile++] = lastVal & 0xff;
                }
            }
        }
        for (let tile = 0; tile < chunkTileCount;) {
            let val = hei.readUByte();
            if (val < 128) {
                terrainColor[tile++] = val & 0xff;
                lastVal = val;
            }
            if (val >= 128) {
                for (let i = 0; i < val - 128; i++) {
                    terrainColor[tile++] = lastVal & 0xff;
                }
            }
        }

        if (!hei.eof()) {
            throw new Error("unexpected height file length");
        }

        this.addFloorBuffers(terrainHeight, terrainColor, level, true);
    }

    loadDatfile(datfile: Buffer, level: number) {
        let dat = new Stream(datfile);
        let horbuffer = dat.readBuffer(chunkTileCount);
        let verbuffer = dat.readBuffer(chunkTileCount);
        let diag1buffer = dat.readBuffer(chunkTileCount);
        let diag2buffer = dat.readBuffer(chunkTileCount);

        //decode roofs
        let roofids = Buffer.alloc(chunkTileCount);
        for (let tile = 0; tile < chunkTileCount;) {
            let val = dat.readUByte();
            if (val < 128) {
                roofids[tile] = val;
                tile++;
            } else {
                tile += val - 128;
            }
        }

        //decode and place floor overlays
        let overlaybuffer = Buffer.alloc(chunkTileCount);
        let lastVal = 0;
        for (let tileindex = 0; tileindex < chunkTileCount;) {
            let val = dat.readUByte();
            let iter = 1;
            if (val < 128) {
                lastVal = val;
            } else {
                iter = val - 128;
            }
            for (let i = 0; i < iter; i++) {
                overlaybuffer[tileindex] = lastVal;
                tileindex++;
            }
        }

        //rotation of locs on this tile
        let rotatebuffer = Buffer.alloc(chunkTileCount);
        for (let tileindex = 0; tileindex < chunkTileCount;) {
            let val = dat.readUByte();
            if (val < 128) {
                rotatebuffer[tileindex] = val;
                tileindex++;
            } else {
                tileindex += val - 128;
            }
        }

        if (!dat.eof()) { throw new Error("didn't end reading map.dat at end of file"); }

        this.addWallBuffers(horbuffer, verbuffer, diag1buffer, diag2buffer, roofids, overlaybuffer, rotatebuffer, level);
    }

    addFloorBuffers(terrainHeight: Buffer, terrainColor: Buffer, level: number, doblendything: boolean) {
        let lastHeight = 64;
        let lastColor = 35;
        for (let classicY = 0; classicY < chunkSize; classicY++) {
            for (let classicX = 0; classicX < chunkSize; classicX++) {
                let index = classicX * chunkSize + classicY;

                let height = terrainHeight[index];
                let color = terrainColor[index];
                if (doblendything) {
                    lastHeight = height + (lastHeight & 0x7f);
                    height = (lastHeight * 2) & 0xff;

                    lastColor = terrainColor[index] + lastColor & 0x7f;
                    color = (lastColor * 2) & 0xff;
                }

                let tile = this.getTileClassic(level, index);
                if (!tile) { continue; }
                tile.height = height;
                tile.underlay = color + 1;
            }
        }
    }

    addWallBuffers(horbuffer: Buffer, verbuffer: Buffer, diag1buffer: Buffer, diag2buffer: Buffer, roofids: Buffer, overlaybuffer: Buffer, rotatebuffer: Buffer, level: number) {
        let bridgefytile = (level: number, x: number, z: number) => {
            let tile00 = this.getTile(level, x, z);
            let tile01 = this.getTile(level, x - 1, z);
            let tile10 = this.getTile(level, x, z - 1);
            let tile11 = this.getTile(level, x - 1, z - 1);

            if (tile00) { tile00.hasbridge = true; }
            if (tile01) { tile01.hasbridge = true; }
            if (tile10) { tile10.hasbridge = true; }
            if (tile11) { tile11.hasbridge = true; }
        }
        let tryExtendBridge = (level: number, x: number, z: number, bridgeid: number, waterid: number) => {
            let tile = this.getTile(level, x, z);
            if (tile && tile.overlay != waterid && tile.overlay != bridgeid) {
                let above = this.getTile(level + 1, x, z);
                if (above) {
                    above.overlay = bridgeid;
                    above.overlayobj = this.config.tiles[bridgeid - 1];
                }
                bridgefytile(level + 1, x, z);
            }
        }

        //decode and place floor overlays
        for (let tileindex = 0; tileindex < chunkTileCount; tileindex++) {
            let overlay = overlaybuffer[tileindex];
            let tile = this.getTileClassic(level, tileindex);
            if (tile && overlay != 0) {
                let overlayobj = this.config.tiles[overlay - 1];
                tile.overlay = overlay;
                tile.overlayobj = overlayobj;
            }
        }

        //seperate pass for bridges
        for (let tileindex = 0; tileindex < chunkTileCount; tileindex++) {
            let tile = this.getTileClassic(0, tileindex);
            if (tile?.overlayobj?.type.bridge) {
                //no known place for this in cache
                //the water type under the bridge depends on the bridge itself
                let waterid = (tile.overlay == 12 ? 11 : 2);
                let pos = indexToPos(tileindex);
                let tileabove = this.getTile(level + 1, pos.x, pos.z);
                //force neighbour vertices to 0 height
                tile.hasbridge = true;
                bridgefytile(level, pos.x, pos.z);
                bridgefytile(level + 1, pos.x, pos.z);
                tryExtendBridge(level, pos.x + 1, pos.z, tile.overlay, waterid);
                tryExtendBridge(level, pos.x - 1, pos.z, tile.overlay, waterid);
                tryExtendBridge(level, pos.x, pos.z + 1, tile.overlay, waterid);
                tryExtendBridge(level, pos.x, pos.z - 1, tile.overlay, waterid);

                if (tileabove) {
                    tileabove.height = tile.height;
                    tileabove.overlay = tile.overlay;
                    tileabove.overlayobj = tile.overlayobj;
                }
                let watertype = this.config.tiles[waterid - 1];
                tile.overlay = waterid;
                tile.overlayobj = watertype;
            }
        }

        let wallscale = (wallnr: number): LocPlacementExtra => {
            let wall = this.config.wallobjects[wallnr - 1];
            return { flags: 0, rotation: null, scale: null, scaleX: null, scaleY: wall.height, scaleZ: null, translateX: null, translateY: null, translateZ: null };
        }

        //walls
        for (let i = 0; i < chunkTileCount; i++) {
            let hor = horbuffer[i];
            let ver = verbuffer[i];
            let diag1 = diag1buffer[i];
            let diag2 = diag2buffer[i];
            let pos = indexToPos(i);
            if (hor) { this.placeLoc(classicLocIdWall + (hor - 1), 0, 2, level, pos.x, pos.z, wallscale(hor)); }
            if (ver) { this.placeLoc(classicLocIdWall + (ver - 1), 0, 1, level, pos.x, pos.z, wallscale(ver)); }
            if (diag1) { this.placeLoc(classicLocIdWall + (diag1 - 1), 9, 0, level, pos.x, pos.z, wallscale(diag1)); }
            if (diag2) { this.placeLoc(classicLocIdWall + (diag2 - 1), 9, 1, level, pos.x, pos.z, wallscale(diag2)); }
        }

        //TODO all of this is dumb, just use a buffer
        type RoofTile = "none" | "diagedge" | "full";
        let rooftype = (x: number, z: number): RoofTile => {
            if (x < 0 || x >= chunkSize || z < 0 || z >= chunkSize) { return "none"; }
            let index = posToIndex(x, z);
            if (roofids[index] == 0) { return "none"; }
            if (diag1buffer[index] != 0 || diag2buffer[index] != 0) { return "diagedge"; }
            return "full";
        }
        let findrooftype = (x: number, z: number): { type: number, rot: number } => {
            let neighbours: RoofTile[] = [
                rooftype(x + 1, z),//e
                rooftype(x + 1, z - 1),//se
                rooftype(x, z - 1),//s
                rooftype(x - 1, z - 1),//sw
                rooftype(x - 1, z),//w
                rooftype(x - 1, z + 1),//nw
                rooftype(x, z + 1),//north
                rooftype(x + 1, z + 1),//ne
            ];
            let selftype = rooftype(x, z);

            //high flat
            if (neighbours.every((q, i) => (i % 2 == 0 ? q == "full" : q != "none"))) {
                return { type: 17, rot: 0 };
            }

            for (let rot = 0; rot < 4; rot++) {
                let front = neighbours[(rot * 2 + 0) % 8];
                let right = neighbours[(rot * 2 + 2) % 8];
                let back = neighbours[(rot * 2 + 4) % 8];
                let left = neighbours[(rot * 2 + 6) % 8];
                let frontright = neighbours[(rot * 2 + 1) % 8];
                let backright = neighbours[(rot * 2 + 3) % 8];
                let backleft = neighbours[(rot * 2 + 5) % 8];
                let frontleft = neighbours[(rot * 2 + 7) % 8];
                //corner
                if (front == "none" && right == "none" && left != "none" && back != "none" && backleft != "none") {
                    return { type: (selftype == "diagedge" ? 13 : 16), rot };
                }
                //edge
                if (front == "none" && right != "none" && left != "none" && back != "none") {
                    //super weird inbetween section turns this into a corner (used in fally castle)
                    if (backright == "none") {
                        return { type: 16, rot };
                    }
                    if (backleft == "none") {
                        return { type: 16, rot: (rot + 3) % 4 };
                    }
                    return { type: 12, rot };
                }
                //concave corner
                if (front != "none" && right != "none" && left == "full" && back == "full" && frontright == "none") {
                    return { type: 14, rot };
                }
                //double convex diagonal roof
                if (front != "none" && right != "none" && left != "none" && back != "none" && frontright == "none" && backleft == "none") {
                    return { type: 15, rot };
                }
            }

            //low flat if no other shapes match
            //doesn't really exist in rs2, use loc type 10
            return { type: 10, rot: 0 };
        }

        for (let tile = 0; tile < roofids.length; tile++) {
            let id = roofids[tile];
            if (id != 0) {
                let pos = indexToPos(tile);
                let type = findrooftype(pos.x, pos.z);
                this.placeLoc(classicLocIdRoof + id - 1, type.type, type.rot, level, pos.x, pos.z);
            }
        }

        //rotation of locs on this tile
        for (let tileindex = 0; tileindex < chunkTileCount; tileindex++) {
            let tile = this.getTileClassic(level, tileindex);
            if (tile) {
                tile.locrotation = rotatebuffer[tileindex]
            }
        }
    }

    loadLocFile(locfile: Buffer, level: number) {
        let loc = new Stream(locfile);

        let locids = new Uint32Array(chunkTileCount);
        for (let tile = 0; tile < chunkTileCount;) {
            let val = loc.readUByte();
            if (val < 128) {
                locids[tile++] = val;
            } else {
                tile += val - 128;
            }
        }
        if (!loc.eof()) { throw new Error("didn't end reading map.loc at end of file"); }
        this.addLocBuffer(locids, level);
    }
    addLocBuffer(locids: Uint32Array, level: number) {
        for (let tileindex = 0; tileindex < chunkTileCount; tileindex++) {
            let locid = locids[tileindex];
            if (locid) {
                let pos = indexToPos(tileindex);
                let obj = this.config.objects[locid - 1];
                if (!obj) {
                    console.warn(`loc for ${locid - 1} is missing`);
                    continue;
                }
                //make sure we are the calling tile for this loc
                let isoverflow = false;
                for (let dx = 0; dx < obj.xsize; dx++) {
                    for (let dz = 0; dz < obj.zsize; dz++) {
                        if (dx == 0 && dz == 0) { continue; }
                        //TODO are there >1x1 locs in classic accros chunk borders? this will break
                        if (pos.x + dx >= chunkSize || pos.z + dz >= chunkSize) { continue; }
                        let otherindex = posToIndex(pos.x + dx, pos.z + dz);
                        if (locids[otherindex] == locid) {
                            isoverflow = true;
                        }
                    }
                }
                if (!isoverflow) {
                    let tile = this.getTileClassic(level, tileindex);
                    if (tile) {
                        let rotation = (4 + tile.locrotation) % 8;
                        let type = (rotation % 2 == 0 ? 10 : 11);
                        let x = pos.x;
                        let z = pos.z;
                        if (rotation % 4 != 0) {
                            x -= obj.zsize - 1;
                            z -= obj.xsize - 1;
                        } else {
                            x -= obj.xsize - 1;
                            z -= obj.zsize - 1;
                        }
                        this.placeLoc(locid - 1, type, Math.floor(rotation / 2), level, x, z);
                    }
                }
            }
        }
    }
}

export function classicModifyTileGrid(grid: TileGrid) {
    //rs classic defines the origin of a tile as being at the northeast corner, however all later
    //versions (and this viewer) have it at the southwest, move over all tile colors and heights
    //to simulate this and howfully don't break too much
    for (let level = 0; level < grid.levels; level++) {
        for (let z = grid.zsize - 1; z >= 1; z--) {
            for (let x = grid.xsize - 1; x >= 1; x--) {
                let tile = grid.getTile(grid.xoffset + x, grid.zoffset + z, level);
                let targettile = grid.getTile(grid.xoffset + x - 1, grid.zoffset + z - 1, level);
                if (!tile || !targettile) { continue; }
                tile.y = targettile.y;
                tile.underlayprops = targettile.underlayprops;

                //no fancy partial roof stuff
                tile.effectiveLevel = level;
                tile.effectiveVisualLevel = level;
            }
        }
    }

    let getoverlay = (tile: TileProps | undefined) => (tile?.debug_raw?.overlay ? grid.engine.classicData!.tiles[tile.debug_raw?.overlay! - 1] : undefined);

    for (let level = 0; level < grid.levels; level++) {
        for (let z = grid.zsize - 1; z >= 1; z--) {
            for (let x = grid.xsize - 1; x >= 1; x--) {
                let tile = grid.getTile(grid.xoffset + x, grid.zoffset + z, level);
                let overlay = getoverlay(tile);
                if (tile && (overlay?.type.autoconnect || overlay?.type.indoors)) {
                    //TODO indoors only merges if there is a diagonal wall on it
                    //this logic needs to be in the classic mapbuild, which in turn needs acces to neighbouring chunks
                    if (overlay.blocked) {
                        if (tile.rawCollision) { tile.rawCollision.walk[0] = true; }
                        if (tile.effectiveCollision) { tile.effectiveCollision.walk[0] = true; }
                    }

                    let top = getoverlay(grid.getTile(grid.xoffset + x, grid.zoffset + z + 1, level));
                    let left = getoverlay(grid.getTile(grid.xoffset + x - 1, grid.zoffset + z, level));
                    let right = getoverlay(grid.getTile(grid.xoffset + x + 1, grid.zoffset + z, level));
                    let bot = getoverlay(grid.getTile(grid.xoffset + x, grid.zoffset + z - 1, level));

                    let hastop = (overlay.type.indoors ? top?.type.indoors : top?.type.autoconnect);
                    let hasleft = (overlay.type.indoors ? left?.type.indoors : left?.type.autoconnect);
                    let hasright = (overlay.type.indoors ? right?.type.indoors : right?.type.autoconnect);
                    let hasbot = (overlay.type.indoors ? bot?.type.indoors : bot?.type.autoconnect);

                    if (hastop && hasleft && !hasbot && !hasright) { tile.shape = tileshapes[5]; }
                    if (hastop && !hasleft && !hasbot && hasright) { tile.shape = tileshapes[6]; }
                    if (!hastop && !hasleft && hasbot && hasright) { tile.shape = tileshapes[7]; }
                    if (!hastop && hasleft && hasbot && !hasright) { tile.shape = tileshapes[4]; }
                }
            }
        }
    }
}

export function classicDecodeMaterialInt(int: number) {
    let material = 0;
    let invisible = false;
    let color: [number, number, number] = [255, 255, 255];
    if (int > 99999999) {
        //??????????????? ask mr gower
        int = 99999999 - int;
    }
    if (int == 12345678) {
        //TODO should be transparent/hidden
        invisible = true;
    } else if (int < 0) {
        let col = -int - 1;
        let r = (col >> 10) & 0x1f;
        let g = (col >> 5) & 0x1f;
        let b = (col >> 0) & 0x1f;
        color = [r, g, b];
    } else {
        material = int + 1;
    }
    return {
        color,
        colorint: HSL2packHSL(...RGB2HSL(...color)),
        material,
        invisible
    };
}

export function getClassicLoc(engine: EngineCache, id: number) {
    const config = engine.classicData!;
    let locdata: objects = {};
    if (id >= classicLocIdRoof) {
        let rawloc = config.roofs[id - classicLocIdRoof];
        locdata = {
            name: `roof_${id - classicLocIdRoof}`,
            // probably_morphFloor: true,
            models: [
                { type: 10, values: [constModelsIds.classicRoof10] },
                { type: 12, values: [constModelsIds.classicRoof12] },
                { type: 13, values: [constModelsIds.classicRoof13] },
                { type: 14, values: [constModelsIds.classicRoof14] },
                { type: 15, values: [constModelsIds.classicRoof15] },
                { type: 16, values: [constModelsIds.classicRoof16] },
                { type: 17, values: [constModelsIds.classicRoof17] }
            ],
            //sets replace_colors/mats and if invisible sets models to null
            ...classicIntsToModelMods(rawloc.texture)
        }
    } else if (id >= classicLocIdWall) {
        let rawloc = config.wallobjects[id - classicLocIdWall];
        locdata = {
            name: rawloc.name,
            probably_morphFloor: true,
            models: [
                { type: 0, values: [constModelsIds.classicWall] },
                { type: 9, values: [constModelsIds.classicWallDiag] }
            ],
            //sets replace_colors/mats and if invisible sets models to null
            ...classicIntsToModelMods(rawloc.frontdecor, rawloc.backdecor)
        }
    } else {
        let loc = config.objects[id];
        if (loc.model.id == undefined) { console.warn(`model for ${loc.name} is missing`); }
        locdata = {
            name: loc.name,
            width: loc.xsize,
            length: loc.zsize,
            // probably_morphFloor: true,
            models: [
                { type: 10, values: (loc.model.id == undefined ? [] : [loc.model.id]) }
            ]
        }
    }
    return locdata;
}

export function classicIntsToModelMods(...matints: number[]) {
    let r: objects = {
        color_replacements: [],
        material_replacements: []
    };
    for (let [i, matint] of matints.entries()) {
        let mods = classicDecodeMaterialInt(matint);
        r.color_replacements!.push([i, mods.colorint]);
        r.material_replacements!.push([i, mods.material]);
        if (mods.invisible) { r.models = null; }
    }
    return r;
}

export async function classicOverlays(engine: EngineCache) {
    let config = engine.classicData!;
    let texindex = await engine.findSubfileByName(0, classicGroups.textures, "INDEX.DAT");
    let usetga = !texindex;
    return Promise.all(config.tiles.map(async q => {
        let mods = classicDecodeMaterialInt(q.decor);
        let color = mods.color;
        if (mods.material) {
            let texmeta = config.textures[mods.material - 1];
            let img = await combineLegacyTexture(engine, texmeta.name, texmeta.subname, usetga);
            let r = 0, g = 0, b = 0;
            for (let i = 0; i < img.img.data.length; i += 4) {
                r += img.img.data[i + 0];
                g += img.img.data[i + 1];
                b += img.img.data[i + 2];
            }
            let npix = img.img.width * img.img.height;
            color = [r / npix | 0, g / npix | 0, b / npix | 0];
        }
        return {
            color: (q.type.type == 5 ? [255, 0, 255] : color),
            material: mods.material
        };
    }));
}

export function classicUnderlays() {
    let underlays: mapsquare_underlays[] = [];

    for (let i = 0; i < 64; i += 1) {
        const r = 255 - i * 4;
        const g = 255 - ((i * 1.75) | 0);
        const b = 255 - i * 4;

        underlays.push({ color: [r, g, b] });
    }

    for (let i = 0; i < 64; i += 1) {
        const r = i * 3;
        const g = 144;
        const b = 0;

        underlays.push({ color: [r, g, b] });
    }

    for (let i = 0; i < 64; i += 1) {
        const r = 192 - ((i * 1.5) | 0);
        const g = 144 - ((i * 1.5) | 0);
        const b = 0;

        underlays.push({ color: [r, g, b] });
    }

    for (let l = 0; l < 64; l++) {
        const r = 96 - ((l * 1.5) | 0);
        const g = 48 + ((l * 1.5) | 0);
        const b = 0;

        underlays.push({ color: [r, g, b] });
    }

    //something something rsc engine darkens it a lot with lighting
    underlays.forEach(q => { q.color![0] /= 2; q.color![1] /= 2; q.color![2] /= 2 })

    return underlays;
}

function loadLocJsonBuffer(config: ClassicConfig, chunkx: number, chunkz: number, level: number) {
    let minx = chunkx * chunkSize, minz = chunkz * chunkSize;
    let maxx = minx + chunkSize, maxz = minz + chunkSize;

    let locids = new Uint32Array(chunkTileCount);
    let locs = config.jsonlocs.filter(q => q.level == level && q.x >= minx && q.x < maxx && q.z >= minz && q.z < maxz);
    for (let loc of locs) {
        let x = loc.x - minx;
        let z = loc.z - minz;
        locids[x * chunkSize + z] = loc.id + 1;
    }
    return locids;
}
