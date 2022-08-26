import { parseObject } from "../opdecoder";
import { BufferAttribute, Vector3 } from "three";
import { objects } from "../../generated/objects";
import { PlacedMesh, TileGrid, transformVertexPositions } from "../3d/mapsquare";
import { EngineCache } from "../3d/ob3tothree";
import { cacheMajors } from "../constants";


export async function chunksummary(engine: EngineCache, grid: TileGrid, models: PlacedMesh[][]) {
	let sum = new Vector3();
	let tmp = new Vector3();

	let locids = new Map<number, objects>();
	let locs: { id: number, x: number, z: number, l: number, center: number[] }[] = [];
	for (let model of models) {
		let first = model[0];
		if (first.extras.modeltype != "location") { continue; }
		let loc = locids.get(first.extras.locationid);
		if (!loc) {
			let buf = await engine.getFileById(cacheMajors.objects, first.extras.locationid)
			loc = parseObject.read(buf);
			locids.set(first.extras.locationid, loc);
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
			id: first.extras.locationid,
			x: first.extras.worldx,
			z: first.extras.worldz,
			l: first.extras.level,
			center: [
				Math.round(newpos.getX(0) / 512 * 100) / 100,
				Math.round(newpos.getY(0) / 512 * 100) / 100,
				Math.round(newpos.getZ(0) / 512 * 100) / 100
			]
		});
	}

	let locdatas = Object.fromEntries([...locids]);

	return { locs, locdatas };
}