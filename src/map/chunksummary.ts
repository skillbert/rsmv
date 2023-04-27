import { Box2, BufferAttribute, Camera, Group, Matrix4, Vector2, Vector3 } from "three";
import { objects } from "../../generated/objects";
import { ChunkData, MapRect, ModelExtrasLocation, PlacedMesh, PlacedMeshBase, rs2ChunkSize, tiledimensions, TileGrid, transformVertexPositions, WorldLocation } from "../3d/mapsquare";
import { ob3ModelToThree, ThreejsSceneCache } from "../3d/modeltothree";
import { ModelBuilder } from "../3d/modelutils";
import { crc32addInt, DependencyGraph } from "../scripts/dependencies";

//reuse same buffers
const pointAttribute = new BufferAttribute(new Float32Array(3), 3);
const boxAttribute = new BufferAttribute(new Float32Array(3 * 8), 3);
const boxtemp = new Box2();
const v0 = new Vector3();
const v1 = new Vector3();
const v2 = new Vector3();

const d0 = new Vector2();
const d1 = new Vector2();
const d2 = new Vector2();

export function chunkSummary(grid: TileGrid, models: PlacedMesh[][], rect: MapRect) {
	let sum = new Vector3();
	let tmp = new Vector3();

	let locids = new Map<number, objects>();
	let locs: { id: number, x: number, z: number, l: number, r: number, center: number[] }[] = [];
	for (let model of models) {
		let first = model[0];
		let info = first.extras;
		if (info.modeltype != "location") { continue; }
		if (
			info.worldx < rect.x
			|| info.worldz < rect.z
			|| info.worldx >= rect.x + rect.xsize
			|| info.worldz >= rect.z + rect.zsize
		) {
			continue;
		}

		let loc = locids.get(info.locationid);
		if (!loc) {
			loc = info.locationInstance.location;
			locids.set(info.locationid, loc);
		}
		if (!loc.name) { continue; }

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
		let { newpos } = transformVertexPositions(pointAttribute, first.morph, grid, first.maxy - first.miny, 0, 0);

		locs.push({
			id: info.locationid,
			x: info.worldx,
			z: info.worldz,
			l: info.level,
			r: info.rotation,
			center: [
				Math.round(newpos.getX(0) / 512 * 100) / 100,
				Math.round(newpos.getY(0) / 512 * 100) / 100,
				Math.round(newpos.getZ(0) / 512 * 100) / 100
			]
		});
	}

	let locdatas = Object.fromEntries([...locids].filter(([id, loc]) => loc.name));

	return {
		locs,
		locdatas,
		rect
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
			let tilehashes = new Array(grid.levels).fill(0);
			let maxy = 0;
			//can't use Set here since we need determinisitic order
			let overlays: number[] = [];
			let underlays: number[] = [];
			for (let dx = 0; dx < groupsize; dx++) {
				for (let dz = 0; dz < groupsize; dz++) {
					for (let level = 0; level < grid.levels; level++) {
						let tile = grid.getTile(chunk.tilerect.x + x + dx, chunk.tilerect.z + z + dz, level);
						if (!tile) { throw new Error("missing tile"); }
						if (!tile.underlayVisible && !tile.overlayVisible) { continue; }
						let tilehash = tilehashes[tile.effectiveVisualLevel];

						tilehash = crc32addInt(tile.raw.flags, tilehash);
						tilehash = crc32addInt(tile.raw.height ?? -1, tilehash);
						tilehash = crc32addInt(tile.raw.overlay ?? -1, tilehash);
						tilehash = crc32addInt(tile.raw.settings ?? -1, tilehash);
						tilehash = crc32addInt(tile.raw.shape ?? -1, tilehash);
						tilehash = crc32addInt(tile.raw.underlay ?? -1, tilehash);

						if (tile.raw.overlay != null && overlays.indexOf(tile.raw.overlay) == -1) { overlays.push(tile.raw.overlay); }
						if (tile.raw.underlay != null && underlays.indexOf(tile.raw.underlay) == -1) { underlays.push(tile.raw.underlay); }

						maxy = Math.max(maxy, tile.y, tile.y01, tile.y10, tile.y11);
						tilehashes[tile.effectiveVisualLevel] = tilehash;
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

export function mapsquareLocDependencies(grid: TileGrid, deps: DependencyGraph, locs: PlacedMesh[][], rect: MapRect) {
	let locgroups = new Map<number, PlacedMeshBase<ModelExtrasLocation>[][]>();
	for (let models of locs) {
		let first = models[0]
		if (first.extras.modeltype == "location") {
			let group = locgroups.get(first.extras.locationid);
			if (!group) {
				group = [];
				locgroups.set(first.extras.locationid, group);
			}
			group.push(models as PlacedMeshBase<ModelExtrasLocation>[]);
		}
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
			let first = loc[0];
			v0.set(0, 0, 0);
			v1.set(0, 0, 0);
			for (let mesh of loc) {
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

			let trans = transformVertexPositions(boxAttribute, first.morph, grid, first.maxy, rect.x * tiledimensions * rs2ChunkSize, rect.z * tiledimensions * rs2ChunkSize);
			// trans.newpos.applyMatrix4(trans.matrix);
			let bounds = [...trans.newpos.array as Float32Array].map(v => v | 0);
			outgroup.instances.push({
				plane: first.extras.locationInstance.plane,
				x: first.extras.locationInstance.x,
				z: first.extras.locationInstance.z,
				rotation: first.extras.locationInstance.rotation,
				type: first.extras.locationInstance.type,

				visualLevel: first.extras.locationInstance.visualLevel,
				placementhash: modelPlacementHash(first.extras.locationInstance),
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
	let addtile = (tile: ChunkTileDependencies) => {
		let x0 = tile.x * tiledimensions;
		let x1 = x0 + tile.xzsize * tiledimensions;
		let z0 = tile.z * tiledimensions;
		let z1 = z0 + tile.xzsize * tiledimensions;
		let y0 = 0;
		let y1 = tile.maxy;
		vertsets.push([
			x0, y0, z0,
			x0, y0, z1,
			x0, y1, z0,
			x0, y1, z1,
			x1, y0, z0,
			x1, y0, z1,
			x1, y1, z0,
			x1, y1, z1,
		]);
	}
	for (let i = 0; i < tilesa.length; i++) {
		let tilea = tilesa[i];
		let tileb = tilesb[i];
		let maxfloor = Math.max(levela, levelb);
		let mismatch = false;
		if (tilea.dephash != tileb.dephash) {
			mismatch = true;
		} else if (tilea.tilehashes.length <= maxfloor || tileb.tilehashes.length <= maxfloor) {
			mismatch = true;
		} else {
			for (let level = 0; level <= maxfloor; level++) {
				let hasha = level <= levela ? tilea.tilehashes[level] : 0;
				let hashb = level <= levelb ? tileb.tilehashes[level] : 0;
				if (hasha != hashb) {
					mismatch = true
				}
			}
		}
		if (mismatch) {
			addtile(tilea);
			addtile(tileb);
		}
	}
	return vertsets;
}

export function compareLocDependencies(chunka: ChunkLocDependencies[], chunkb: ChunkLocDependencies[], levela: number, levelb: number) {
	let vertsets: number[][] = [];
	let iloca = 0, ilocb = 0;
	while (true) {
		let loca = chunka[iloca];
		let locb = chunkb[ilocb];

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
			vertsets.push(...locb.instances.map(q => q.bounds));
			ilocb++;
		} else if (!locb || loca && loca.id < locb.id) {
			//locb inserted
			vertsets.push(...loca.instances.map(q => q.bounds));
			iloca++;
		}
	}
	return vertsets;
}

export async function mapdiffmesh(scene: ThreejsSceneCache, points: number[][]) {
	let col = [255, 0, 0] as [number, number, number];
	let tri = (model: ModelBuilder, verts: number[], a: number, b: number, c: number) => model.mat(-1).addTriangle(col,
		verts.slice(a * 3, a * 3 + 3) as any,
		verts.slice(b * 3, b * 3 + 3) as any,
		verts.slice(c * 3, c * 3 + 3) as any
	);
	let models = new Group();
	models.position.x -= tiledimensions * rs2ChunkSize / 2;
	models.position.z -= tiledimensions * rs2ChunkSize / 2;
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


type KMeansBucket = {
	center: THREE.Vector2,
	bounds: THREE.Box2,
	sum: THREE.Vector2,
	runningbounds: THREE.Box2,
	samples: number
};


/**
 * this class is wayyy overkill for what is currently used
 */
export class ImageDiffGrid {
	gridsize = 64;
	grid = new Uint8Array(this.gridsize * this.gridsize);

	anyInside(projection: Matrix4, points: number[][]) {
		//make them local vars to prevent writing into old space
		const v0 = new Vector3();
		const v1 = new Vector3();
		const v2 = new Vector3();
		for (let group of points) {
			for (let i = 0; i < group.length; i += 3) {
				v2.set(group[i + 0], group[i + 1], group[i + 2]);
				v2.applyMatrix4(projection);
				if (i == 0) {
					v0.copy(v2);
					v1.copy(v2);
				} else {
					v0.min(v2);
					v1.max(v2);
				}
			}
			if (v0.x < 1 && v1.x > -1 && v0.y > -1 && v1.y < 1) {
				return true;
			}
		}
		return false;
	}

	addPolygons(projection: Matrix4, points: number[][]) {
		for (let group of points) {
			for (let i = 0; i < group.length; i += 3) {
				v2.set(group[i + 0], group[i + 1], group[i + 2]);
				v2.applyMatrix4(projection);
				if (i == 0) {
					v0.copy(v2);
					v1.copy(v2);
				} else {
					v0.min(v2);
					v1.max(v2);
				}
			}
			// if (v0.z < 0 && v1.z < 0) {
			// 	//fully behind camera
			// 	continue;
			// }

			let x1 = Math.max(0, Math.floor((v0.x + 1) / 2 * this.gridsize));
			let y1 = Math.max(0, Math.floor((v0.y + 1) / 2 * this.gridsize));
			let x2 = Math.min(this.gridsize, Math.ceil((v1.x + 1) / 2 * this.gridsize));
			let y2 = Math.min(this.gridsize, Math.ceil((v1.y + 1) / 2 * this.gridsize));
			for (let y = y1; y < y2; y++) {
				for (let x = x1; x < x2; x++) {
					this.grid[x + y * this.gridsize] = 1;
				}
			}
		}
	}

	coverage() {
		let count = 0;
		for (let i = 0; i < this.grid.length; i++) {
			count += this.grid[i];
		}
		return count / this.gridsize / this.gridsize;
	}

	calculateDiffArea(imgwidth: number, imgheight: number) {
		const gridsize = this.gridsize;
		const grid = this.grid;

		//K-means algo to group rects
		let nmeans = 4;
		let filteriters = 2;
		let niter = globalThis.itercount ?? 10;//TODO remove
		let buckets: KMeansBucket[] = [];
		for (let y = 0; y < nmeans; y++) {
			for (let x = 0; x < nmeans; x++) {
				let center = new Vector2(
					(x + 0.5) / nmeans * gridsize,
					(y + 0.5) / nmeans * gridsize
				);
				buckets.push({
					center: center,
					bounds: new Box2(center.clone(), center.clone()),
					sum: new Vector2(),
					runningbounds: new Box2(),
					samples: 0
				});
			}
		}
		for (let iter = 0; iter < niter; iter++) {
			for (let y = 0; y < gridsize; y++) {
				for (let x = 0; x < gridsize; x++) {
					if (!grid[x + y * gridsize]) { continue; }
					let mindist = 0;
					d0.set(x + 0.5, y + 0.5);
					boxtemp.min.set(x, y);
					boxtemp.max.set(x + 1, y + 1);
					let bestbucket: typeof buckets[number] | null = null;
					for (let mean of buckets) {
						let dist = mean.bounds.distanceToPoint(d0);
						if (!bestbucket || dist < mindist) {
							mindist = dist;
							bestbucket = mean;
						}
					}
					if (!bestbucket) { throw new Error("unexpected"); }
					if (bestbucket.samples == 0) {
						bestbucket.runningbounds.copy(boxtemp);
					} else {
						bestbucket.runningbounds.union(boxtemp);
					}
					bestbucket.sum.add(d0);
					bestbucket.samples++;
				}
			}
			buckets = buckets.filter(q => q.samples != 0);

			if (iter >= niter - filteriters && !globalThis.nofilter) {
				for (let ia = 0; ia < buckets.length; ia++) {
					for (let ib = ia + 1; ib < buckets.length;) {
						let bucketa = buckets[ia];
						let bucketb = buckets[ib];

						bucketa.runningbounds.getSize(d0);
						bucketb.runningbounds.getSize(d1);
						boxtemp.copy(bucketa.runningbounds).union(bucketb.runningbounds).getSize(d2);

						let area_a = d0.x * d0.y;
						let area_b = d1.x * d1.y;
						let area_c = d2.x * d2.y;

						if (area_a + area_b > area_c * 0.9) {
							bucketa.runningbounds.union(bucketb.runningbounds);
							bucketa.sum.add(bucketb.sum);
							bucketa.samples += bucketb.samples;

							buckets.splice(ib, 1);
							ib = ia + 1;
							iter = niter - filteriters;
						} else {
							ib++;
						}
					}
				}
			}
			for (let bucket of buckets) {
				bucket.center.copy(bucket.sum).multiplyScalar(1 / bucket.samples);
				let area = bucket.samples;
				let prevsize = bucket.runningbounds.getSize(d0);
				let prevarea = prevsize.x * prevsize.y;
				bucket.bounds.setFromCenterAndSize(bucket.center, prevsize.multiplyScalar(area / prevarea));
				bucket.samples = 0;
				bucket.sum.set(0, 0);
			}
		}

		let rects = buckets.map(q => ({
			x: q.runningbounds.min.x / this.gridsize * imgwidth,
			y: q.runningbounds.min.y / this.gridsize * imgheight,
			width: (q.runningbounds.max.x - q.runningbounds.min.x) / this.gridsize * imgwidth,
			height: (q.runningbounds.max.y - q.runningbounds.min.y) / this.gridsize * imgheight
		}));
		//TODO remove buckets from res
		return { rects, buckets };
	}
}


function rendermeans(rects: Box2[], buckets: KMeansBucket[]) {
	let cnv = globalThis.cnv as HTMLCanvasElement;
	if (!cnv) {
		cnv = document.createElement("canvas");
		globalThis.cnv = cnv;
		document.body.append(cnv);
		cnv.style.cssText = `position:absolute;pointer-events:none;`;
	}

	let parentrect = globalThis.render.canvas.getBoundingClientRect() as DOMRect;
	cnv.width = parentrect.width;
	cnv.height = parentrect.height;
	cnv.style.left = parentrect.x + "px";
	cnv.style.top = parentrect.y + "px";
	let ctx = cnv.getContext("2d")!;
	ctx.translate(cnv.width / 2, cnv.height / 2);
	ctx.scale(cnv.width / 2, -cnv.height / 2);

	let dot = 2 / cnv.height;
	ctx.fillStyle = "rgba(255,0,0,0.3)";
	ctx.strokeStyle = "black";
	ctx.lineWidth = dot;
	for (let rect of rects) {
		ctx.fillRect(rect.min.x, rect.min.y, rect.max.x - rect.min.x, rect.max.y - rect.min.y);
		ctx.strokeRect(rect.min.x, rect.min.y, rect.max.x - rect.min.x, rect.max.y - rect.min.y);
	}

	const gridsize = 64;
	ctx.resetTransform();
	ctx.translate(0, cnv.height)
	ctx.scale(cnv.width / gridsize, -cnv.height / gridsize);;
	dot = gridsize / cnv.height;
	ctx.lineWidth = dot;

	for (let bucket of buckets) {
		ctx.fillStyle = "rgba(0,255,0,0.4)";
		ctx.fillRect(bucket.runningbounds.min.x, bucket.runningbounds.min.y, bucket.runningbounds.max.x - bucket.runningbounds.min.x, bucket.runningbounds.max.y - bucket.runningbounds.min.y);
		ctx.strokeRect(bucket.runningbounds.min.x, bucket.runningbounds.min.y, bucket.runningbounds.max.x - bucket.runningbounds.min.x, bucket.runningbounds.max.y - bucket.runningbounds.min.y);
		ctx.strokeRect(bucket.bounds.min.x, bucket.bounds.min.y, bucket.bounds.max.x - bucket.bounds.min.x, bucket.bounds.max.y - bucket.bounds.min.y);
		ctx.fillStyle = "black";
		ctx.fillRect(bucket.center.x - 5 * dot, bucket.center.y - 5 * dot, dot * 10, dot * 10);
	}
}

//TODO remove
globalThis.lochash = mapsquareLocDependencies;
globalThis.floorhash = mapsquareFloorDependencies;
globalThis.comparehash = compareLocDependencies;
globalThis.diffmodel = mapdiffmesh;
globalThis.test = async (low: number, high: number) => {
	globalThis.deps ??= await globalThis.getdeps(globalThis.engine, { area: { x: 49, z: 49, xsize: 3, zsize: 3 } });

	let locdeps = mapsquareLocDependencies(globalThis.chunk.loaded.grid, globalThis.deps, globalThis.chunk.loaded.modeldata, globalThis.chunk.rect);
	let locdifs = compareLocDependencies(locdeps, locdeps, low, high);
	let locdifmesh = await mapdiffmesh(globalThis.sceneCache, locdifs);
	globalThis.render.modelnode.add(locdifmesh);

	let floordeps = mapsquareFloorDependencies(globalThis.chunk.loaded.grid, globalThis.deps, globalThis.chunk.loaded.chunks[0]);
	let floordifs = compareFloorDependencies(floordeps, floordeps, low, high);
	let floordifmesh = await mapdiffmesh(globalThis.sceneCache, floordifs);
	globalThis.render.modelnode.add(floordifmesh);

	let frame = () => {
		let floorproj = globalThis.render.camera.projectionMatrix.clone().multiply(globalThis.render.camera.matrixWorldInverse).multiply(floordifmesh.matrixWorld);
		let locproj = globalThis.render.camera.projectionMatrix.clone().multiply(globalThis.render.camera.matrixWorldInverse).multiply(locdifmesh.matrixWorld);

		let grid = new ImageDiffGrid();
		grid.addPolygons(floorproj, floordifs);
		grid.addPolygons(locproj, locdifs);
		// let { grid, gridsize, buckets } = calculateDiffArea(locproj, locdifs);
		let res = grid.calculateDiffArea(512, 512);
		//TODO remove
		let rects: Box2[] = [];
		for (let i = 0; i < grid.grid.length; i++) {
			if (grid.grid[i]) {
				let x = i % grid.gridsize;
				let y = Math.floor(i / grid.gridsize);
				rects.push(new Box2(new Vector2(
					-1 + 2 * x / grid.gridsize,
					-1 + 2 * y / grid.gridsize
				), new Vector2(
					-1 + 2 * (x + 1) / grid.gridsize,
					-1 + 2 * (y + 1) / grid.gridsize
				)));
			}
		}

		rendermeans(rects, res.buckets);
		requestAnimationFrame(frame);
	}
	frame();
}

function modelPlacementHash(loc: WorldLocation) {
	let hash = 0;
	hash = crc32addInt(loc.x, hash);
	hash = crc32addInt(loc.z, hash);
	hash = crc32addInt(loc.plane, hash);
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