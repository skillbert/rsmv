# Map renderer
The part of the source is used to render the world map used on RuneApps.org. 

## Simple setup

Copy the mapconfig.jsonc file below to a new folder called extract_map, then run the following shell code
```sh
npm run nodegl -- dist/maprender -o openrs2:1720 -c extract_map/mapconfig.jsonc
# the nodegl script opens an electron window and runs the nodejs command in it
#  dist/maprender -> the map render script
#  -o openrs2:1720 -> use cache id 1720 from openrs2.org as cache source
#  -c extract_map/mapconfig.jsonc -> use the config file at the given location
```

### Example config
```jsonc
//extract_map/mapconfig.jsonc
{
    "$schema": "../generated/maprenderconfig.schema.json",
    //test gives a 3x3 area around lumby, "main" for the main world map, "full" for everything, a list of rectangles is also accepted eg: "50.50,20.20-70.70"
    "area": "test",
    //the size of the output images, usually 256 or 512
    "tileimgsize": 512,
    //set to true to keep the output y origin at the bottom left, equal to the game z origin
    "noyflip": false,
    //set to true to keep output chunks aligned with in-game chunks. Incurs performance penalty as more neighbouring chunks have to be loaded
    "nochunkoffset": false,
    //list of layers to render
    "layers": [
        {
            "name": "3d", //name of the layer, this will be the folder name
            "mode": "3d", //3d world render
            "format": "webp", //currently only png and webp. jpeg in theory supported but not implemented or tested
            "level": 0, //floor level of the render, 0 means ground floor and all roofs are hidden, highest level is 3 which makes all roofs visible
            "pxpersquare": 64, //the level of detail for highest zoom level measured in pixels per map tile (1x1 meter). Subject to pxpersquare*64>tileimgsize, because it is currently not possible to render less than one image per mapchunk
            "dxdy": 0.15, //dxdy and dzdy to determine the view angle, 0,0 for straight down, something like 0.15,0.25 for birds eye
            "dzdy": 0.25
        },
        {
            "name": "map",
            "mode": "map", //old style 2d map render
            "format": "png",
            "level": 0,
            "pxpersquare": 64,
            "mapicons": true,
            "wallsonly": false //can be turned on to create a walls overlay layer to use on top of an existing 3d layer
        },
        {
            "name": "collision",
            "mode": "collision", //pathing/line of sight as overlay image layer to use on "map" or "3d"
            "format": "png",
            "level": 0,
            "pxpersquare": 64
        },
        {
            "name": "height",
            "mode": "height", //binary file per chunk containing 16bit height data and 16 bits of collision data in base3 per tile
            "level": 0,
            "pxpersquare": 1, //unused but required
            "usegzip": true //gzips the resulting file, need some server config to serve the compressed file
        },
        {
            "name": "locs",
            "mode": "locs", //json file with locs per chunk
            "level": 0,
            "pxpersquare": 1, //unused but required
            "usegzip": false
        },
        {
            "name": "maplabels",
            "mode": "maplabels", //json file per chunk containing maplabel images and uses
            "level": 0,
            "pxpersquare": 1,
            "usegzip": false
        },
        {
            "name": "rendermeta",
            "mode": "rendermeta", //advanced - json file containing metadata about the chunk render, used to dedupe historic renders
            "level": 0,
            "pxpersquare": 1
        },
        {
            "name": "interactions",
            "mode": "interactions", //json file per offset map chunk with loc info and images for all interactable locs
            "pxpersquare": 64, //same arguments as mode="3d"
            "dxdy": 0.15,
            "dzdy": 0.25,
            "format": "webp",
            "level": 0,
            "usegzip": true
        }
    ],
    //used to determine lowest scaling mip level, should generally always be 100,200 which ensures the lowest mip level contains the entire rs world in one image
    "mapsizex": 100,
    "mapsizez": 200
}
```