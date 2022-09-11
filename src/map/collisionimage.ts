import { canvasToImageFile } from "../imgutils";
import { MapRect, tiledimensions, TileGridSource, TileProps } from "../3d/mapsquare";


export function drawCollision(grid: TileGridSource, rect: MapRect, maplevel: number, pxpertile: number, wallpx: number) {
	let cnv = document.createElement("canvas");
	let ctx = cnv.getContext("2d")!;
	cnv.width = rect.xsize * pxpertile;
	cnv.height = rect.zsize * pxpertile;
	ctx.scale(1, -1);
	ctx.translate(0, -rect.zsize * pxpertile);
	ctx.translate(-rect.x * pxpertile, -rect.z * pxpertile);

	let wallcol = "red";
	let walkcol = "orange";

	let colcheck = (tile: TileProps, index: number, lowx: boolean, lowz: boolean, highx: boolean, highz: boolean) => {
		let col = tile.effectiveCollision;
		if (col && col.walk[index]) {
			ctx.fillStyle = (col.sight[index] ? wallcol : walkcol);
			ctx.fillRect(
				tile.x / tiledimensions * pxpertile + (lowx ? 0 : pxpertile - wallpx),
				tile.z / tiledimensions * pxpertile + (lowz ? 0 : pxpertile - wallpx),
				(lowx && highx ? pxpertile : wallpx),
				(lowz && highz ? pxpertile : wallpx)
			);
		}
	}

	for (let z = rect.z; z < rect.z + rect.zsize; z++) {
		for (let x = rect.x; x < rect.x + rect.xsize; x++) {
			let tile = grid.getTile(x, z, maplevel);
			if (!tile || !tile.effectiveCollision) { continue; }
			//center
			colcheck(tile, 0, true, true, true, true);

			//walls
			colcheck(tile, 1, true, true, false, true);
			colcheck(tile, 2, true, false, true, true);
			colcheck(tile, 3, false, true, true, true);
			colcheck(tile, 4, true, true, true, false);

			//corners
			colcheck(tile, 5, true, false, false, true);
			colcheck(tile, 6, false, false, true, true);
			colcheck(tile, 7, false, true, true, false);
			colcheck(tile, 8, true, true, false, false);
		}
	}

	return canvasToImageFile(cnv, "png", 1);
}