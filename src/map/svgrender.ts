import { TileGridSource, ChunkData, squareLevels, squareSize, TileVertex, WorldLocation, MapRect, TileProps } from "../3d/mapsquare";
import { parseSprite } from "../3d/sprite";
import { cacheMajors } from "../constants";
import { EngineCache } from "../3d/ob3tothree";
import { pixelsToDataUrl } from "../imgutils";

let similarangle = (a1: number, a2: number) => {
	const PI2 = Math.PI * 2;
	const EPS = 0.0001;
	//different in angle, positive mod to range (-PI,PI)
	let d = ((a1 - a2 + Math.PI) % PI2 + PI2) % PI2 - Math.PI;
	return Math.abs(d) < EPS;
}


export async function svgfloor(engine: EngineCache, grid: TileGridSource, locs: WorldLocation[], rect: MapRect, maplevel: number, pxpertile: number, wallsonly: boolean) {
	let drawground = !wallsonly;
	let drawwalls = true;
	let drawmapscenes = !wallsonly;

	let underlay = "";
	let mapscenes = new Map<number, { src: string, width: number, height: number, uses: { x: number, z: number }[] }>();
	let overlays: Map<number, Set<{ x: number, z: number }[]>>[] = [new Map(), new Map(), new Map(), new Map()];
	let whitelines: { x: number, z: number }[][] = [];
	let redlines: { x: number, z: number }[][] = [];

	let transparent = 0xff00ff;

	let coltoint = (col: number[] | undefined | null) => {
		if (!col) { return transparent; }
		return col[0] << 16 | col[1] << 8 | col[2];
	}

	let getOverlayColor = (tile: TileProps) => {
		let colint = coltoint(tile.rawOverlay?.secondary_colour);
		if (colint == transparent) { colint = coltoint(tile.overlayprops.color); }
		return colint;
	}

	if (drawground) {
		let underlaybitmap = new Uint8Array(rect.xsize * rect.zsize * 4);
		//make this 4x as large as needed so we can use the same indices
		// let tiledepthbuffer = new Uint8Array(rect.xsize * rect.zsize * 4);
		//fill with solid black, no transparency jokes here
		for (let i = 0; i < underlaybitmap.length; i += 4) {
			underlaybitmap[i + 0] = 0;
			underlaybitmap[i + 1] = 0;
			underlaybitmap[i + 2] = 0;
			underlaybitmap[i + 3] = 255;
		}

		for (let dz = 0; dz < rect.zsize; dz++) {
			for (let dx = 0; dx < rect.xsize; dx++) {
				let underlaycolor = [0, 0, 0];
				let occluded = false;
				for (let level = squareLevels - 1; !occluded && level >= 0; level--) {
					let tile = grid.getTile(rect.x + dx, rect.z + dz, level);
					if (!tile || tile.effectiveLevel > maplevel) {
						continue;
					}
					if (tile.visible) {
						underlaycolor = tile.underlayprops.color;
						occluded = true;
					}

					if (tile.raw.overlay) {
						let vertices = tile.shape.overlay;
						let colint = getOverlayColor(tile);
						if (colint == transparent) {
							if (tile.visible) {
								vertices = tile.shape.underlay;
								colint = coltoint(tile.underlayprops.color);
								underlaycolor = [0, 0, 0];
								occluded = false;
							} else {
								vertices = [];
							}
						}

						if (vertices.length != 0) {
							let corners = vertices.map(q => ({ x: dx + q.subx, z: dz + q.subz }));
							let set = overlays[level].get(colint);
							if (!set) {
								set = new Set();
								overlays[level].set(colint, set);
							}
							let merged = false;
							//find a polygon that has an edge with equal nodes but in oposite order to merge with
							//this is like o(n^3) don't tell anyone
							merger: for (let group of set) {
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
								set.add(corners);
							}
						}
					}
				}

				let underlayindex = dx * 4 + dz * 4 * rect.xsize;
				underlaybitmap[underlayindex + 0] = underlaycolor[0];
				underlaybitmap[underlayindex + 1] = underlaycolor[1];
				underlaybitmap[underlayindex + 2] = underlaycolor[2];
				underlaybitmap[underlayindex + 3] = 255;
			}
		}

		underlay = await pixelsToDataUrl({ data: underlaybitmap, width: rect.xsize, height: rect.zsize, channels: 4 });
	}

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

	//number of tiles outside bounds to draw
	const overdraw = 2;
	for (let loc of locs) {
		if (loc.x < rect.x - overdraw || loc.z < rect.z - overdraw) { continue; }
		if (loc.x >= rect.x + rect.xsize + overdraw || loc.z >= rect.z + rect.zsize + overdraw) { continue; }
		if (loc.effectiveLevel > maplevel) { continue; }

		let linegroup = (loc.location.deletable || loc.location.actions_0 ? redlines : whitelines);

		//don't draw walls if there is a layer of the same floor above us
		let occluded = false;
		for (let level = loc.plane + 1; level < squareLevels; level++) {
			let tile = grid.getTile(loc.x, loc.z, level);
			if (!tile || tile?.effectiveLevel != loc.effectiveLevel) { break; }
			if (tile.effectiveLevel == maplevel && (getOverlayColor(tile) != transparent || tile.visible)) { occluded = true; }
		}
		if (loc.location.mapscene == undefined) {
			if (drawwalls && !occluded) {
				if (loc.type == 0) {
					addline(linegroup, loc.x - rect.x, loc.z - rect.z, 3, 0, loc.rotation);
				} else if (loc.type == 2) {
					addline(linegroup, loc.x - rect.x, loc.z - rect.z, 3, 0, loc.rotation);
					addline(linegroup, loc.x - rect.x, loc.z - rect.z, 0, 1, loc.rotation);
				} else if (loc.type == 9) {
					addline(linegroup, loc.x - rect.x, loc.z - rect.z, 3, 1, loc.rotation);
				}
			}
		} else {
			if (drawmapscenes) {
				let group = mapscenes.get(loc.location.mapscene);
				if (!group) {
					let mapscene = engine.mapMapscenes[loc.location.mapscene];
					let src = "";
					let width = 0;
					let height = 0;
					if (mapscene.sprite_id != undefined) {
						let spritefile = await engine.source.getFileById(cacheMajors.sprites, mapscene.sprite_id);
						let sprite = parseSprite(spritefile);
						src = await pixelsToDataUrl(sprite[0]);
						width = sprite[0].width;
						height = sprite[0].height;
					}
					group = { src: src, width, height, uses: [] };
					mapscenes.set(loc.location.mapscene, group);
				}
				group.uses.push({ x: loc.x - rect.x, z: loc.z - rect.z });
			}
		}
	}

	//start assembling the svg
	let r = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rect.xsize} ${rect.zsize}" width="${rect.xsize * pxpertile}" height="${rect.zsize * pxpertile}">\n`;
	r += `<g transform="scale(1,-1) translate(0,-${rect.zsize})">\n`;
	r += `<defs>\n`;
	for (let [id, scene] of mapscenes) {
		r += `<image id="mapscene-${id}" width="${scene.width / 4}" height="${scene.height / 4}" href="${scene.src}" style="image-rendering: pixelated;" transform="scale(1,-1)"/>\n`;
	}
	r += `</defs>\n`;

	//background underlays
	if (underlay) {
		r += `<image href="${underlay}" style="image-rendering: pixelated;" width="${rect.xsize}" height="${rect.zsize}"/>\n`;
	}

	//tile overlays
	if (overlays.reduce((a, q) => q.size + a, 0) != 0) {
		r += `<g shape-rendering="crispEdges">\n`;
		for (let overlaylayer of overlays) {
			for (let [col, overlay] of overlaylayer.entries()) {
				for (let poly of overlay) {
					for (let i = 0; i < poly.length; i++) {
						let a = poly[i];
						let b = poly[(i + 1) % poly.length];
						let c = poly[(i + 2) % poly.length];
						if (a.x == b.x && a.z == b.z) {
							//two adjacent equal vertices
							poly.splice((i + 1) % poly.length, 1);
							i = Math.max(-1, i - 2);
							continue;
						}
						let dx1 = b.x - a.x, dz1 = b.z - a.z
						let dx2 = c.x - b.x, dz2 = c.z - b.z;
						let angle1 = Math.atan2(dz1, dx1);
						let angle2 = Math.atan2(dz2, dx2);
						if (similarangle(angle1, angle2) || similarangle(angle1 + Math.PI, angle2)) {
							//all 3 vertices are on a line, vertex b is either in between a and c,
							//other vertex b forms a 0 width polygon, it is redundant either way
							poly.splice((i + 1) % poly.length, 1);
							i = Math.max(-1, i - 2);
						}
					}
					let colstr = col.toString(16).padStart(6, "0");
					r += `<polygon fill="#${colstr}" points="${poly.map(q => `${q.x},${q.z}`).join(" ")}"/>\n`
				}
			}
		}
		r += `</g>`;
	}

	//wall lines
	const linewidth = 0.2;
	if (whitelines.length != 0) {
		r += `<g stroke="white" stroke-width="${linewidth}" fill="none">`;
		for (let line of whitelines) {
			r += `<polyline points="${line.map(q => `${q.x},${q.z}`).join(" ")}"/>\n`;
		}
		r += `</g>`;
	}
	if (redlines.length != 0) {
		r += `<g stroke="red" stroke-width="${linewidth}" fill="none">`;
		for (let line of redlines) {
			r += `<polyline points="${line.map(q => `${q.x},${q.z}`).join(" ")}"/>\n`;
		}
		r += `</g>`;
	}

	//mapscenes
	for (let [id, scene] of mapscenes) {
		for (let use of scene.uses) {
			r += `<use href="#mapscene-${id}" x="${use.x}" y="${use.z + scene.height / 4}"/>\n`;
		}
	}

	r += `</g>\n`;
	r += `</svg>`;
	return r;
}