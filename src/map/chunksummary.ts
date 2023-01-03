import { parse } from "../opdecoder";
import { BufferAttribute, Vector3 } from "three";
import { objects } from "../../generated/objects";
import { MapRect, PlacedMesh, TileGrid, transformVertexPositions } from "../3d/mapsquare";
import { EngineCache } from "../3d/ob3tothree";
import { cacheMajors } from "../constants";


export async function chunkSummary(engine: EngineCache, grid: TileGrid, models: PlacedMesh[][], rect: MapRect) {
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
			let buf = await engine.getFileById(cacheMajors.objects, info.locationid)
			loc = parse.object.read(buf, engine.rawsource);
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
		let pos = new BufferAttribute(new Float32Array([sum.x, sum.y, sum.z]), 3);
		let { newpos } = transformVertexPositions(pos, first.morph, grid, first.maxy - first.miny, 0, 0);

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