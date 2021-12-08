import { TileGrid, ChunkData, squareLevels, squareHeight, squareWidth, TileVertex, WorldLocation } from "../3d/mapsquare";
import sharp from "sharp";
import { parseSprite } from "../3d/sprite";
import { cacheMajors } from "../constants";
import { CacheFileSource } from "../cache";

export async function svgfloor(source: CacheFileSource, grid: TileGrid, locs: WorldLocation[], rect: { x: number, z: number, xsize: number, zsize: number }, maplevel: number) {

	let underlaybitmap = new Uint8Array(rect.xsize * rect.zsize * 4);
	//fill with solid black, no transparency jokes here
	for (let i = 0; i < underlaybitmap.length; i += 4) {
		underlaybitmap[i + 0] = 0;
		underlaybitmap[i + 1] = 0;
		underlaybitmap[i + 2] = 0;
		underlaybitmap[i + 3] = 255;
	}

	let overlays = new Map<number, { color: number[], polygons: Set<{ x: number, z: number }[]> }>();

	let transparent = 0xff00ff;

	for (let dz = 0; dz < rect.zsize; dz++) {
		for (let dx = 0; dx < rect.xsize; dx++) {
			for (let level = 0; level < squareLevels; level++) {
				let tile = grid.getTile(rect.x + dx, rect.z + dz, level);
				if (!tile || tile.effectiveLevel > maplevel) {
					continue;
				}
				let underlayindex = dx * 4 + dz * 4 * rect.xsize;

				if (tile.visible) {
					underlaybitmap[underlayindex + 0] = tile.underlayprops.color[0];
					underlaybitmap[underlayindex + 1] = tile.underlayprops.color[1];
					underlaybitmap[underlayindex + 2] = tile.underlayprops.color[2];
					underlaybitmap[underlayindex + 3] = 255;
				}

				if (typeof tile.raw.overlay != "undefined") {
					let corners = tile.shape.overlay.map(q => ({ x: dx + q.subx, z: dz + q.subz }));

					let col = (tile.visible ? tile.overlayprops.color : tile.rawOverlay?.secondary_colour ?? [255, 0, 255]);
					let colint = col[0] << 16 | col[1] << 8 | col[2];
					if (colint == transparent) { continue; }

					let set = overlays.get(colint);
					if (!set) {
						set = { color: col, polygons: new Set() };
						overlays.set(colint, set);
					}
					let merged = false;
					//find a polygon that has a edge with equal nodes but in oposite order to merge with
					//this is like o(n^3) don't tell anyone
					merger: for (let group of set.polygons) {
						for (let a = 0; a < group.length; a++) {
							let a1 = group[a];
							let a2 = group[(a + 1) % group.length];
							for (let b = 0; b < corners.length; b++) {
								let b1 = corners[b];
								let b2 = corners[(b + 1) % corners.length];
								if (a1.x == b2.x && a1.z == b2.z && a2.x == b1.x && a2.z == b1.z) {
									//found overlapping nodes!
									if (b == corners.length - 1) {
										group.splice(a + 1, 0, ...corners.slice(1, b));
									} else {
										group.splice(a + 1, 0, ...corners.slice(b + 2, corners.length), ...corners.slice(0, b));
									}
									merged = true;
									break merger;
								}
							}
						}
					}
					if (!merged) {
						set.polygons.add(corners);
					}
				}
			}
		}
	}

	let underlay = await sharp(underlaybitmap, { raw: { width: rect.xsize, height: rect.zsize, channels: 4 } })
		.png()
		.toBuffer();

	let mapscenes = new Map<number, { src: string, width: number, height: number, uses: { x: number, z: number }[] }>();
	let whitelines: { x: number, z: number }[][] = [];
	let redlines: { x: number, z: number }[][] = [];

	let addline = (group: typeof whitelines, tilex: number, tilez: number, corner1: number, corner2: number, rotation: number) => {
		let x1 = tilex + ((corner1 + rotation + 1) % 4 < 2 ? 0 : 1);
		let z1 = tilez + ((corner1 + rotation + 2) % 4 < 2 ? 0 : 1);
		let x2 = tilex + ((corner2 + rotation + 1) % 4 < 2 ? 0 : 1);
		let z2 = tilez + ((corner2 + rotation + 2) % 4 < 2 ? 0 : 1);

		for (let line of group) {
			let xv1 = line[0].x;
			let zv1 = line[0].z;
			let xv2 = line[line.length - 1].x;
			let zv2 = line[line.length - 1].z;
			if (xv1 == x1 && zv1 == z1) { line.unshift({ x: x2, z: z2 }); return; }
			if (xv1 == x2 && zv1 == z2) { line.unshift({ x: x1, z: z1 }); return; }
			if (xv2 == x1 && zv2 == z1) { line.push({ x: x2, z: z2 }); return; }
			if (xv2 == x2 && zv2 == z2) { line.push({ x: x1, z: z1 }); return; }
		}
		group.push([{ x: x1, z: z1 }, { x: x2, z: z2 }]);
	}

	const overdraw = 2;
	for (let loc of locs) {
		if (loc.x < rect.x - overdraw || loc.z < rect.z - overdraw) { continue; }
		if (loc.x >= rect.x + rect.xsize + overdraw || loc.z >= rect.z + rect.zsize + overdraw) { continue; }
		if (loc.effectiveLevel > maplevel) { continue; }

		let linegroup = (loc.location.deletable ? redlines : whitelines);

		if (typeof loc.location.mapscene == "undefined") {
			if (loc.type == 0) {
				addline(linegroup, loc.x - rect.x, loc.z - rect.z, 3, 0, loc.rotation);
			} else if (loc.type == 2) {
				addline(linegroup, loc.x - rect.x, loc.z - rect.z, 3, 0, loc.rotation);
				addline(linegroup, loc.x - rect.x, loc.z - rect.z, 0, 1, loc.rotation);
			} else if (loc.type == 9) {
				addline(linegroup, loc.x - rect.x, loc.z - rect.z, 3, 1, loc.rotation);
			}
		} else {
			let group = mapscenes.get(loc.location.mapscene);
			if (!group) {
				let mapscene = grid.mapconfig.mapscenes[loc.location.mapscene];
				let src = "";
				let width = 0;
				let height = 0;
				if (typeof mapscene.sprite_id != "undefined") {
					let spritefile = await source.getFileById(cacheMajors.sprites, mapscene.sprite_id);
					let sprite = parseSprite(spritefile);
					let pngfile = await sharp(sprite[0].data, { raw: { width: sprite[0].width, height: sprite[0].height, channels: 4 } }).png().toBuffer();
					src = "data:image/png;base64," + pngfile.toString("base64");
					width = sprite[0].width;
					height = sprite[0].height;
				}
				group = { src: src, width, height, uses: [] };
				mapscenes.set(loc.location.mapscene, group);
			}
			group.uses.push({ x: loc.x - rect.x, z: loc.z - rect.z });
		}
	}

	//start assembling the svg
	let r = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rect.xsize} ${rect.zsize}" width="${rect.xsize * 4}" height="${rect.zsize * 4}">\n`;
	r += `<g transform="scale(1,-1) translate(0,-${rect.zsize})">\n`;
	r += `<defs>\n`;
	for (let [id, scene] of mapscenes) {
		r += `<image id="mapscene-${id}" width="${scene.width / 4}" height="${scene.height / 4}" href="${scene.src}" style="image-rendering: pixelated;" transform="scale(1,-1)"/>\n`;
	}
	r += `</defs>\n`;

	//background underlays
	r += `<image href="data:image/png;base64,${underlay.toString("base64")}" style="image-rendering: pixelated;" width="${rect.xsize}" height="${rect.zsize}"/>\n`;

	//tile overlays
	r += `<g shape-rendering="crispEdges">\n`;
	for (let [col, overlay] of overlays.entries()) {
		for (let poly of overlay.polygons) {
			for (let i = 0; i < poly.length; i++) {
				let a = poly[i];
				let b = poly[(i + 2) % poly.length];
				if (a.x == b.x && a.z == b.z) {
					poly.splice((i + 1) % poly.length, 1);
					i--;
				}
			}
			let colstr = col.toString(16).padStart(6, "0");
			r += `<polygon fill="#${colstr}" points="${poly.map(q => `${q.x},${q.z}`).join(" ")}"/>\n`
		}
	}
	r += `</g>`;

	//wall lines
	r += `<g stroke="white" stroke-width="0.1" fill="none">`;
	for (let line of whitelines) {
		r += `<polyline points="${line.map(q => `${q.x},${q.z}`).join(" ")}"/>\n`;
	}
	r += `</g>`;
	r += `<g stroke="red" stroke-width="0.1" fill="none">`;
	for (let line of redlines) {
		r += `<polyline points="${line.map(q => `${q.x},${q.z}`).join(" ")}"/>\n`;
	}
	r += `</g>`;

	//mapscenes
	for (let [id, scene] of mapscenes) {
		for (let use of scene.uses) {
			r += `<use href="#mapscene-${id}" x="${use.x}" y="${use.z + scene.height / 4}"/>`;
		}
	}

	r += `</g>`;
	r += `</svg>`;
	return r;
}