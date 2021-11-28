
declare var L: typeof import("leaflet");

var chunkoffsetx = 16;
var chunkoffsetz = 48;

var mapsizex = 100;
var mapsizez = 200;

var chunksize = 64;
var lowestmip = 10;
var pxpertile = 32;

var mip0pxpertile = 1;

var crs = L.CRS.Simple;
//@ts-ignore
crs.transformation = L.transformation(
	mip0pxpertile, chunkoffsetx * mip0pxpertile,
	-mip0pxpertile, (mapsizez * chunksize + chunkoffsetz) * mip0pxpertile
);

var mymap = L.map('map', {
	crs: crs,
	minZoom: -5,
	maxZoom: 7,
	//maxBounds: [[0, 0], [mapsizez * chunksize * mip0pxpertile, mapsizex * chunksize * mip0pxpertile]]
});
//@ts-ignore
mymap.on("click", e => console.log(e.latlen));
const tilebase = "../../cache/map5";
L.tileLayer(tilebase + "/full/{z}/{x}-{y}.png", {
	attribution: 'Skillbert',
	tileSize: 512,
	maxNativeZoom: 5,
	minZoom: -5
}).addTo(mymap);
let layers: Record<string, any> = {};
for (let floor = 2; floor >=0; floor--) {
	layers["indoors-" + floor] = L.tileLayer(tilebase + "/indoors-" + floor + "/{z}/{x}-{y}.png", {
		attribution: 'Skillbert',
		tileSize: 512,
		maxNativeZoom: 5,
		minZoom: -5
	});
}
mymap.setView([3200, 3000], 4);
L.control.layers(undefined, layers).addTo(mymap);

// export { };