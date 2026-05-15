import { Box2, BufferAttribute, Camera, Group, Matrix4, Vector2, Vector3 } from "three";
import { objects } from "../../generated/objects";
import { ChunkData, getTileHeight, MapRect, ModelExtras, ModelExtrasLocation, PlacedMesh, PlacedMeshBase, PlacedModel, rs2ChunkSize, RSMapChunkData, tiledimensions, TileGrid, tileshapes, transformVertexPositions, WorldLocation } from "../3d/mapsquare";
import { DependencyGraphObject, EngineCache, ob3ModelToThree, ThreejsSceneCache } from "../3d/modeltothree";
import { ModelBuilder } from "../3d/modelutils";
import { DependencyGraph } from "../scripts/dependencies";
import { KnownMapFile, MapRender } from "./backends";
import { CacheFileSource } from "../cache";
import { RenderedMapMeta } from ".";
import { crc32addInt } from "../libs/crc32util";
import type { RSMapChunk } from "../3d/modelnodes";
import { getOrInsert } from "../utils";
import { ThreeJsRenderer } from "../viewer/threejsrender";
import { MaprenderSquareLoaded } from "./layers";

export function getLocImageHash(grid: TileGrid, info: WorldLocation) {
	let loc = info.location;
	let sizex = (loc.width ?? 1);
	let sizez = (loc.length ?? 1);
	if ((info.rotation % 2) == 1) {
		//flip offsets if we are rotated with 90deg or 270deg
		[sizex, sizez] = [sizez, sizex];
	}

	let subgrid: number[] = [];
	for (let dfloor = 0; dfloor <= 1; dfloor++) {
		for (let dz = 0; dz <= sizex; dz++) {
			for (let dx = 0; dx <= sizex; dx++) {
				subgrid.push(getTileHeight(grid, info.x + dx, info.z + dz, info.plane + dfloor));
			}
		}
	}
	let baseheight = getTileHeight(grid, info.x, info.z, info.plane);

	let hash = modelPlacementHash(info);
	for (let height of subgrid) {
		hash = crc32addInt(height - baseheight, hash);
	}
	return hash;
}
const pointAttribute = new BufferAttribute(new Float32Array(3), 3);

function getLocCenter(grid: TileGrid, model: PlacedMesh[]) {
	let first = model[0];
	let sum = new Vector3();
	let tmp = new Vector3();

	sum.set(0, 0, 0);
	let count = 0;
	for (let mesh of model) {
		for (let i = 0; i < mesh.model.indices.count; i++) {
			let vertindex = mesh.model.indices.getX(i);
			tmp.fromBufferAttribute(mesh.model.attributes.pos, vertindex);
			sum.add(tmp);
		}
		count += mesh.model.indices.count;
	}
	sum.divideScalar(count);
	pointAttribute.setXYZ(0, sum.x, sum.y, sum.z);
	let newpos = transformVertexPositions(pointAttribute, first.morph, grid, first.maxy - first.miny, 0, 0);
	tmp.fromBufferAttribute(newpos, 0);
	tmp.divideScalar(tiledimensions);
	return tmp;
}

export function chunkSummary(grid: TileGrid, locdefs: Map<WorldLocation, PlacedMesh[]>, rect: MapRect) {
	let locids = new Map<number, objects>();
	let locs: { id: number, x: number, z: number, l: number, r: number, h: number, center: number[] }[] = [];
	let hashes = new Map<number, { center: number[], locdata: WorldLocation }>();
	for (let [locdata, model] of locdefs) {
		if (
			locdata.x < rect.x
			|| locdata.z < rect.z
			|| locdata.x >= rect.x + rect.xsize
			|| locdata.z >= rect.z + rect.zsize
		) {
			continue;
		}

		let loc = locids.get(locdata.locid);
		if (!loc) {
			loc = locdata.location;
			locids.set(locdata.locid, loc);
		}
		if (!loc.name) { continue; }

		let center = getLocCenter(grid, model);

		let imghash = getLocImageHash(grid, locdata);
		locs.push({
			id: locdata.locid,
			x: locdata.x,
			z: locdata.z,
			l: locdata.plane,
			r: locdata.rotation,
			h: imghash,
			center: [
				+center.x.toFixed(2),
				+center.y.toFixed(2),
				+center.z.toFixed(2)
			]
		});
		center.x -= locdata.x;
		center.y -= getTileHeight(grid, locdata.x, locdata.z, locdata.plane) / tiledimensions;
		center.z -= locdata.z;
		hashes.set(imghash, {
			center: [
				+center.x.toFixed(2),
				+center.y.toFixed(2),
				+center.z.toFixed(2)
			],
			locdata
		});
	}

	let locdatas = Object.fromEntries([...locids].filter(([id, loc]) => loc.name));

	return {
		locs,
		locdatas,
		hashes
	};
}

export type ChunkLocDependencies = {
	id: number,
	dependencyhash: number,
	instances: {
		visualLevel: number,
		placementhash: number,
		plane: number,
		x: number,
		z: number,
		rotation: number,
		type: number,
		//corners of bounding box
		bounds: number[]
	}[]
}

export type ChunkTileDependencies = {
	x: number,
	z: number,
	xzsize: number,
	maxy: number,
	tilehashes: number[],
	dephash: number
}


export function mapsquareFloorDependencies(grid: TileGrid, deps: DependencyGraph, chunk: ChunkData) {
	let groups: ChunkTileDependencies[] = [];
	const groupsize = 2;
	for (let x = 0; x < chunk.tilerect.xsize; x += groupsize) {
		for (let z = 0; z < chunk.tilerect.zsize; z += groupsize) {
			let tilehashes = new Array<number>(grid.levels).fill(0);
			let maxy = 0;
			//can't use Set here since we need determinisitic order
			let overlays: number[] = [];
			let underlays: number[] = [];
			for (let level = 0; level < grid.levels; level++) {
				let minlevel = level;
				for (let dx = 0; dx < groupsize; dx++) {
					for (let dz = 0; dz < groupsize; dz++) {
						let tilehash = 0;
						let tile = grid.getTile(chunk.tilerect.x + x + dx, chunk.tilerect.z + z + dz, level);
						if (!tile || (!tile.underlayVisible && !tile.overlayVisible)) { continue; }
						minlevel = Math.min(minlevel, tile.effectiveVisualLevel);

						let rawtile = tile.debug_raw;
						//TODO make a nxt branch here
						if (!rawtile) { throw new Error("can't calculate chunkhash since rawtile isn't set"); }
						tilehash = crc32addInt(rawtile.height ?? -1, tilehash);
						tilehash = crc32addInt(rawtile.overlay ?? -1, tilehash);
						tilehash = crc32addInt(rawtile.settings ?? -1, tilehash);
						tilehash = crc32addInt(rawtile.shape ?? -1, tilehash);
						tilehash = crc32addInt(rawtile.underlay ?? -1, tilehash);

						tilehash = crc32addInt(tile.effectiveVisualLevel, tilehash);

						if (rawtile.overlay != null && overlays.indexOf(rawtile.overlay) == -1) { overlays.push(rawtile.overlay); }
						if (rawtile.underlay != null && underlays.indexOf(rawtile.underlay) == -1) { underlays.push(rawtile.underlay); }

						maxy = Math.max(maxy, tile.y, tile.y01, tile.y10, tile.y11);

						for (let i = tile.effectiveVisualLevel; i < grid.levels; i++) {
							tilehashes[i] = crc32addInt(tilehash, tilehashes[i]);
						}
					}
				}
			}

			let dephash = 0;
			overlays.forEach(id => dephash = deps.hashDependencies(deps.makeDeptName("overlay", id), dephash));
			underlays.forEach(id => dephash = deps.hashDependencies(deps.makeDeptName("underlay", id), dephash));
			groups.push({
				x, z,
				xzsize: groupsize,
				maxy,
				dephash,
				tilehashes
			});
		}
	}
	return groups;
}

function compareChunkLoc(a: ChunkLocDependencies["instances"][number], b: ChunkLocDependencies["instances"][number]) {
	return a.plane - b.plane || a.x - b.x || a.z - b.z || a.rotation - b.rotation || a.type - b.type;
}

export function mapsquareLocDependencies(grid: TileGrid, deps: DependencyGraph, locs: Map<WorldLocation, PlacedMesh[]>, chunkx: number, chunkz: number) {
	const boxAttribute = new BufferAttribute(new Float32Array(3 * 8), 3);
	const v0 = new Vector3();
	const v1 = new Vector3();
	const v2 = new Vector3();

	let locgroups = new Map<number, WorldLocation[]>();
	for (let loc of locs.keys()) {
		let group = getOrInsert(locgroups, loc.locid, () => []);
		group.push(loc);
	}

	let outlocgroups: ChunkLocDependencies[] = [];

	for (let [locid, group] of locgroups) {
		let lochash = deps.hashDependencies(deps.makeDeptName("loc", locid));
		let outgroup: ChunkLocDependencies = {
			id: locid,
			dependencyhash: lochash,
			instances: []
		}
		outlocgroups.push(outgroup);
		for (let loc of group) {
			let models = locs.get(loc)!;
			v0.set(0, 0, 0);
			v1.set(0, 0, 0);
			for (let mesh of models) {
				let posattr = mesh.model.attributes.pos;
				for (let i = 0; i < posattr.count; i++) {
					v2.set(posattr.getX(i), posattr.getY(i), posattr.getZ(i));
					v0.min(v2);
					v1.max(v2);
				}
			}

			//8 vertices, one for each bounding box corner
			boxAttribute.setXYZ(0, v0.x, v0.y, v0.z);
			boxAttribute.setXYZ(1, v0.x, v0.y, v1.z);
			boxAttribute.setXYZ(2, v0.x, v1.y, v0.z);
			boxAttribute.setXYZ(3, v0.x, v1.y, v1.z);
			boxAttribute.setXYZ(4, v1.x, v0.y, v0.z);
			boxAttribute.setXYZ(5, v1.x, v0.y, v1.z);
			boxAttribute.setXYZ(6, v1.x, v1.y, v0.z);
			boxAttribute.setXYZ(7, v1.x, v1.y, v1.z);

			let first = models[0];
			let trans = transformVertexPositions(boxAttribute, first.morph, grid, first.maxy, chunkx * rs2ChunkSize * tiledimensions, chunkz * rs2ChunkSize * tiledimensions);
			let bounds = [...trans.array as Float32Array].map(v => v | 0);
			outgroup.instances.push({
				plane: loc.plane,
				x: loc.x,
				z: loc.z,
				rotation: loc.rotation,
				type: loc.type,

				visualLevel: loc.visualLevel,
				placementhash: modelPlacementHash(loc),
				bounds: bounds
			});
		}
		outgroup.instances.sort(compareChunkLoc);
	}
	outlocgroups.sort((a, b) => a.id - b.id);
	return outlocgroups;
}

export function compareFloorDependencies(tilesa: ChunkTileDependencies[], tilesb: ChunkTileDependencies[], levela: number, levelb: number) {
	let vertsets: number[][] = [];
	for (let i = 0; i < tilesa.length; i++) {
		let tilea = tilesa[i];
		let tileb = tilesb[i];
		let maxfloor = Math.max(levela, levelb);
		let mismatch = false;
		if (tilea.dephash != tileb.dephash) {
			mismatch = true;
		} else if (tilea.tilehashes.length <= maxfloor || tileb.tilehashes.length <= maxfloor) {
			mismatch = true;
		} else if (tilea.tilehashes[levela] != tileb.tilehashes[levelb]) {
			mismatch = true
		}
		if (mismatch) {
			vertsets.push(tileSetVertices(tilea.x, tilea.z, tilea.xzsize, 0, tilea.maxy));
			vertsets.push(tileSetVertices(tileb.x, tileb.z, tileb.xzsize, 0, tileb.maxy));
		}
	}
	return vertsets;
}

export function compareLocDependencies(chunka: ChunkLocDependencies[], chunkb: ChunkLocDependencies[], levela: number, levelb: number) {
	let vertsets: number[][] = [];
	let iloca = 0, ilocb = 0;
	while (true) {
		//explicit bounds check because reading past end is really bad for performance apparently
		let loca = (iloca < chunka.length ? chunka[iloca] : undefined);
		let locb = (ilocb < chunkb.length ? chunkb[ilocb] : undefined);

		if (!loca && !locb) { break }
		else if (loca && locb && loca.id == locb.id) {
			if (loca.dependencyhash == locb.dependencyhash) {
				for (let ia = 0, ib = 0; ;) {
					let insta = loca.instances.at(ia);
					let instb = locb.instances.at(ib);
					//ignore locs that are above current level filter
					if (insta && insta.visualLevel > levela) { insta = undefined; }
					if (instb && instb.visualLevel > levelb) { instb = undefined; }

					if (!insta && !instb) {
						if (ia >= loca.instances.length && ib >= locb.instances.length) {
							break;
						} else {
							ia++;
							ib++;
							continue;
						}
					}

					let cmp = !insta ? -1 : !instb ? 1 : compareChunkLoc(insta, instb);
					if (cmp == 0) {
						if (insta!.placementhash != instb!.placementhash) {
							vertsets.push(insta!.bounds);
							vertsets.push(instb!.bounds);
						}
						ia++;
						ib++;
					} else if (cmp < 0) {
						vertsets.push(instb!.bounds);
						ib++;
					} else {
						vertsets.push(insta!.bounds);
						ia++;
					}
				}
			} else {
				//invalidate all
				vertsets.push(...loca.instances.map(q => q.bounds));
				vertsets.push(...locb.instances.map(q => q.bounds));
			}
			iloca++;
			ilocb++;
		} else if (!loca || locb && locb.id < loca.id) {
			//locb inserted
			vertsets.push(...locb!.instances.map(q => q.bounds));
			ilocb++;
		} else if (!locb || loca && loca.id < locb.id) {
			//locb inserted
			vertsets.push(...loca.instances.map(q => q.bounds));
			iloca++;
		}
	}
	return vertsets;
}

export type VisualHash = {
	// hash of model and placement
	hash: number,
	level: number,
	// corners of bounding box
	bounds: number[]
}

function locVisualHash(loc: ChunkLocDependencies, inst: ChunkLocDependencies["instances"][number]) {
	return crc32addInt(loc.dependencyhash, inst.placementhash);
}

export function mapsquareLocVisuals(locs: ChunkLocDependencies[]) {
	let visuals: VisualHash[] = [];
	for (let group of locs) {
		for (let inst of group.instances) {
			visuals.push({
				hash: locVisualHash(group, inst),
				level: inst.visualLevel,
				bounds: inst.bounds
			});
		}
	}
	return visuals;
}

export function mapsquareFloorVisuals(tiles: ChunkTileDependencies[]) {
	let visuals: VisualHash[] = [];
	for (let tile of tiles) {
		let lastlevelhash = 0;
		for (let level = 0; level < tile.tilehashes.length; level++) {
			let levelhash = tile.tilehashes[level];
			if (levelhash != lastlevelhash) {
				visuals.push({
					hash: crc32addInt(levelhash, tile.dephash),
					level,
					bounds: tileSetVertices(tile.x, tile.z, tile.xzsize, tile.maxy, tile.maxy)
				});
				lastlevelhash = levelhash;
			}
		}
	}
	return visuals;
}

export function mapsquareVisuals(floordeps: ChunkTileDependencies[], locdeps: ChunkLocDependencies[]) {
	let visuals = [
		...mapsquareFloorVisuals(floordeps),
		...mapsquareLocVisuals(locdeps)
	];
	// sort by hash to make sure we get the same result regardless of order of processing
	visuals.sort((a, b) => a.hash - b.hash);

	return visuals;
}

export function visibleChunkHash(visuals: VisualHash[], chunktoscreen: Matrix4, level: number) {
	let hash = 0;
	for (let visual of visuals) {
		if (visual.level <= level && pointsIntersectProjection(chunktoscreen, [visual.bounds])) {
			hash = crc32addInt(visual.hash, hash);
		}
	}
	return hash;
}

export function tileSetVertices(tilex: number, tilez: number, groupsize: number, miny: number, maxy: number) {
	let x0 = tilex * tiledimensions;
	let x1 = x0 + groupsize * tiledimensions;
	let z0 = tilez * tiledimensions;
	let z1 = z0 + groupsize * tiledimensions;
	let y0 = miny;
	let y1 = maxy;
	return [
		x0, y0, z0,
		x0, y0, z1,
		x0, y1, z0,
		x0, y1, z1,
		x1, y0, z0,
		x1, y0, z1,
		x1, y1, z0,
		x1, y1, z1,
	];
}

export async function mapdiffmesh(scene: ThreejsSceneCache, points: number[][], col: [number, number, number] = [255, 0, 0]) {
	let tri = (model: ModelBuilder, verts: number[], a: number, b: number, c: number) => model.mat(-1).addTriangle(col,
		verts.slice(a * 3, a * 3 + 3) as any,
		verts.slice(b * 3, b * 3 + 3) as any,
		verts.slice(c * 3, c * 3 + 3) as any
	);
	let models = new Group();
	models.matrixAutoUpdate = false;
	models.updateMatrix();
	for (let group of points) {
		let model = new ModelBuilder();
		//double-sided box through each vertex
		tri(model, group, 0, 4, 1); tri(model, group, 0, 1, 4);
		tri(model, group, 4, 5, 1); tri(model, group, 4, 1, 5);
		tri(model, group, 1, 5, 3); tri(model, group, 1, 3, 5);
		tri(model, group, 5, 7, 3); tri(model, group, 5, 3, 7);
		tri(model, group, 3, 7, 2); tri(model, group, 3, 2, 7);
		tri(model, group, 7, 6, 2); tri(model, group, 7, 2, 6);
		tri(model, group, 2, 6, 0); tri(model, group, 2, 0, 6);
		tri(model, group, 6, 4, 0); tri(model, group, 6, 0, 4);

		tri(model, group, 0, 1, 2); tri(model, group, 0, 2, 1);
		tri(model, group, 1, 3, 2); tri(model, group, 1, 2, 3);
		tri(model, group, 4, 6, 7); tri(model, group, 4, 7, 6);
		tri(model, group, 4, 7, 5); tri(model, group, 4, 5, 7);

		models.add(await ob3ModelToThree(scene, model.convert()));
	}
	return models;
}

// export async function generateLocationHashBoxes(scene: ThreejsSceneCache, locs: Map<WorldLocation, PlacedMesh[]>, grid: TileGrid, chunkx: number, chunkz: number, level: number) {
// 	let deps = await scene.engine.getDependencyGraph();
// 	await deps.preloadChunkDependencies({ area: { x: chunkx, z: chunkz, xsize: 1, zsize: 1 } });
// 	let visuals = mapsquareLocVisuals(grid, deps, locs, chunkx, chunkz);

// 	let group = new Group();
// 	for (let visual of visuals) {
// 		if (visual.level != level) { continue; }
// 		let color = [(visual.hash >> 16) & 0xff, (visual.hash >> 8) & 0xff, (visual.hash >> 0) & 0xff] as [number, number, number];
// 		group.add(await mapdiffmesh(scene, [visual.bounds], color));
// 	}
// 	group.userData = {
// 		modeltype: "overlay",
// 		isclickable: false,
// 		modelgroup: "hashbox_objects" + level,
// 		level
// 	} satisfies ModelExtras;

// 	return group;
// }

// export async function generateFloorHashBoxes(scene: ThreejsSceneCache, grid: TileGrid, chunk: ChunkData, level: number) {
// 	let deps = await scene.engine.getDependencyGraph();
// 	await deps.preloadChunkDependencies({ area: { x: chunk.mapsquarex, z: chunk.mapsquarez, xsize: 1, zsize: 1 } });
// 	let visuals = mapsquareFloorVisuals(grid, deps, chunk);

// 	let group = new Group();
// 	for (let visual of visuals) {
// 		let color = [(visual.hash >> 16) & 0xff, (visual.hash >> 8) & 0xff, (visual.hash >> 0) & 0xff] as [number, number, number];
// 		group.add(await mapdiffmesh(scene, [visual.bounds], color));
// 	}
// 	group.userData = {
// 		modeltype: "overlay",
// 		isclickable: false,
// 		modelgroup: "hashbox_floor" + level,
// 		level
// 	} satisfies ModelExtras;

// 	return group;
// }

export function pointsIntersectProjection(projection: Matrix4, points: number[][]) {
	const min = new Vector3();
	const max = new Vector3();
	const tmp = new Vector3();
	for (let group of points) {
		for (let i = 0; i < group.length; i += 3) {
			tmp.set(group[i + 0], group[i + 1], group[i + 2]);
			tmp.applyMatrix4(projection);
			if (i == 0) {
				min.copy(tmp);
				max.copy(tmp);
			} else {
				min.min(tmp);
				max.max(tmp);
			}
		}
		if (min.x < 1 && max.x > -1 && min.y < 1 && max.y > -1 && min.z < 1 && max.z > -1) {
			return true;
		}
	}
	return false;
}

function modelPlacementHash(loc: WorldLocation) {
	let hash = 0;
	hash = crc32addInt(loc.resolvedlocid, hash);
	hash = crc32addInt(loc.rotation, hash);
	hash = crc32addInt(loc.type, hash);
	if (loc.placement) {
		if (loc.placement.rotation) {
			hash = crc32addInt(loc.placement.rotation[0], hash);
			hash = crc32addInt(loc.placement.rotation[1], hash);
			hash = crc32addInt(loc.placement.rotation[2], hash);
			hash = crc32addInt(loc.placement.rotation[3], hash);
		}
		hash = crc32addInt(loc.placement.translateX ?? 0, hash);
		hash = crc32addInt(loc.placement.translateY ?? 0, hash);
		hash = crc32addInt(loc.placement.translateZ ?? 0, hash);
		hash = crc32addInt(loc.placement.scale ?? 0, hash);
		hash = crc32addInt(loc.placement.scaleX ?? 0, hash);
		hash = crc32addInt(loc.placement.scaleY ?? 0, hash);
		hash = crc32addInt(loc.placement.scaleZ ?? 0, hash);
	}
	return hash;
}

export type ChunkRenderMeta = {
	x: number,
	z: number,
	version: number,
	floor: ChunkTileDependencies[],
	locs: ChunkLocDependencies[],
	visuals: VisualHash[]
}

type RenderDepsEntry = {
	x: number,
	z: number,
	metas: Promise<{ buildnr: number, firstbuildnr: number, meta: ChunkRenderMeta }[]>
}

export type RenderDepsVersionInstance = Awaited<ReturnType<RenderDepsTracker["forkDeps"]>>;

export class RenderDepsTracker {
	config: MapRender;
	deps: DependencyGraph;
	targetversions: number[];

	cachedMetas: RenderDepsEntry[] = [];
	readonly cacheSize = 15;

	constructor(config: MapRender, deps: DependencyGraph, targetversions: number[]) {
		this.config = config;
		this.deps = deps;
		this.targetversions = targetversions;
	}

	getEntry(x: number, z: number) {
		let match = this.cachedMetas.find(q => q.x == x && q.z == z);
		if (!match) {
			let metas = (async () => {
				return [];
				// if (!this.config.rendermetaLayer || !this.config.getRelatedFiles) {
				// 	return [];
				// }
				// let filename = `${this.config.rendermetaLayer.name}/${x}-${z}.${this.config.rendermetaLayer.usegzip ? "json.gz" : "json"}`;
				// let urls = await this.config.getRelatedFiles([filename], this.targetversions);
				// urls = urls.filter(q => q.buildnr != this.config.version);
				// let fetches = urls.map(q => this.config.getFileResponse(q.file, q.buildnr).then(async w => ({
				// 	buildnr: q.buildnr,
				// 	firstbuildnr: q.firstbuildnr,
				// 	meta: await w.json() as ChunkRenderMeta
				// })));
				// return Promise.all(fetches)
			})();

			match = { x, z, metas };
			this.cachedMetas.push(match);

			//remove first item if cache is full
			while (this.cachedMetas.length > this.cacheSize) {
				this.cachedMetas.shift();
			}
		}
		return match;
	}

	getRect(rect: MapRect) {
		let entries: RenderDepsEntry[] = [];
		for (let z = rect.z; z < rect.z + rect.zsize; z++) {
			for (let x = rect.x; x < rect.x + rect.xsize; x++) {
				entries.push(this.getEntry(x, z));
			}
		}
		return entries;
	}

	async forkDeps(names: string[]) {
		// let allFiles = await this.config.getRelatedFiles?.(names, this.targetversions) ?? [];
		let allFiles: KnownMapFile[] = [];
		let localmetas: ChunkRenderMeta[] = [];
		let localfiles: KnownMapFile[] = [];

		let addLocalFile = (file: KnownMapFile) => {
			// allFiles.push(file);
			localfiles.push(file);
		}

		let addLocalSquare = (rendermeta: ChunkRenderMeta) => {
			if (!localmetas.some(q => q.x == rendermeta.x && q.z == rendermeta.z)) {
				localmetas.push(rendermeta);
			}
		}

		let findMatches = async (chunkRect: MapRect, name: string) => {
			let matches: { file: KnownMapFile, metas: ChunkRenderMeta[] }[] = [];

			//try find match in current render
			let localfile = localfiles.find(q => q.file == name);
			if (localfile) {
				let haslocalchunks = true;
				let localchunks: ChunkRenderMeta[] = []
				for (let z = chunkRect.z; z < chunkRect.z + chunkRect.zsize; z++) {
					for (let x = chunkRect.x; x < chunkRect.x + chunkRect.xsize; x++) {
						let meta = localmetas.find(q => q.x == x && q.z == z);
						if (!meta) {
							haslocalchunks = false;
						} else {
							localchunks.push(meta);
						}
					}
				}
				if (haslocalchunks && localfiles.some(q => q.file == name)) {
					matches.push({ file: localfile, metas: localchunks });
				}
			}

			//search nearby build renders
			let chunks = this.getRect(chunkRect);
			let chunkmetas = await Promise.all(chunks.map(ch => ch.metas));
			let namedversions = allFiles.filter(q => q.file == name);
			matchloop: for (let file of namedversions) {
				let metas: ChunkRenderMeta[] = [];
				for (let chunk of chunkmetas) {
					let meta = chunk.find(q => q.buildnr >= file.firstbuildnr && q.firstbuildnr <= file.buildnr);
					if (!meta) {
						continue matchloop;
					} else {
						metas.push(meta.meta);
					}
				}
				matches.push({ file, metas });
			}
			return matches;
		}

		//TODO remove this entirely
		let checkMatches = async (name: string, datarect: MapRect, chunks: MaprenderSquareLoaded[], cam: Camera, level: number, parentlevel: number) => {
			console.warn("calling obsolete diff API, returning null");
			return null;
			// for (let versionMatch of await findMatches(datarect, name)) {
			// 	let isdirty = false;
			// 	for (let chunk of chunks) {
			// 		let other = versionMatch.metas.find(q => q.x == chunk.x && q.z == chunk.z);
			// 		if (!other) { throw new Error("unexpected"); }

			// 		chunk.model.rootnode.updateWorldMatrix(true, false);
			// 		let modelmatrix = new Matrix4()
			// 			.makeTranslation(
			// 				chunk.model.chunkx * tiledimensions * chunk.model.loaded!.chunkSize,
			// 				0,
			// 				chunk.model.chunkz * tiledimensions * chunk.model.loaded!.chunkSize)
			// 			.premultiply(chunk.model.rootnode.matrixWorld);

			// 		let proj = cam.projectionMatrix.clone()
			// 			.multiply(cam.matrixWorldInverse)
			// 			.multiply(modelmatrix);

			// 		let locs = compareLocDependencies(chunk.loaded.rendermeta.locs, other.locs, level, parentlevel);
			// 		let floor = compareFloorDependencies(chunk.loaded.rendermeta.floor, other.floor, level, parentlevel);

			// 		isdirty ||= pointsIntersectProjection(proj, locs);
			// 		isdirty ||= pointsIntersectProjection(proj, floor);
			// 		if (isdirty) {
			// 			break;
			// 		}
			// 	}

			// 	if (!isdirty) {
			// 		return versionMatch.file;
			// 	}
			// }
			// return null;
		}

		return {
			allFiles,
			findMatches,
			checkMatches,
			addLocalFile,
			addLocalSquare
		};
	}
}
