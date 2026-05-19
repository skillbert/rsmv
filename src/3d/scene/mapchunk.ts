
import * as THREE from "three";
import { ThreejsSceneCache } from '../modeltothree';
import { TypedEmitter } from '../../utils';
import { MapRect, ParsemapOpts, RSMapChunkData, renderMapSquare, WorldLocation, ThreeJsRenderSection, parseMapsquare } from '../mapsquare';
import { AnimationMixer, Mesh, Object3D } from "three";
import { svgfloor } from "../../map/svgrender";
import { ThreeJsRenderer, ThreeJsSceneElement, ThreeJsSceneElementSource } from "../../viewer/threejsrender";

export class RSMapChunkGroup extends TypedEmitter<{ loaded: undefined, changed: undefined }> implements ThreeJsSceneElementSource {
    chunks: RSMapChunk[];
    rootnode = new THREE.Group();
    renderscene: ThreeJsRenderer | null = null;
    mixer = new AnimationMixer(this.rootnode);
    getSceneElements() {
        return this.chunks.map(q => q.getSceneElements())
    }
    addToScene(scene: ThreeJsRenderer) {
        this.renderscene = scene;
        scene.addSceneElement(this);
    }
    cleanup() {
        this.listeners = {};
        this.chunks.forEach(q => q.cleanup());
        this.renderscene?.removeSceneElement(this);
        this.renderscene = null;
    }
    constructor(cache: ThreejsSceneCache, rect: MapRect, extraopts?: ParsemapOpts) {
        super();
        this.chunks = [];
        for (let z = rect.z; z < rect.z + rect.zsize; z++) {
            for (let x = rect.x; x < rect.x + rect.xsize; x++) {
                let sub = RSMapChunk.create(cache, x, z, extraopts);
                this.chunks.push(sub);
            }
        }
        Promise.all(this.chunks.map(q => q.chunkdata)).then(q => {
            this.emit("loaded", undefined);
        });
    }
}


export class RSMapChunk extends TypedEmitter<{ loaded: RSMapChunkData, changed: undefined }> implements ThreeJsSceneElementSource {
    chunkdata: Promise<RSMapChunkData>;
    loaded: RSMapChunkData | null = null;
    cache: ThreejsSceneCache;
    rootnode = new THREE.Group();
    mixer = new AnimationMixer(this.rootnode);
    renderscene: ThreeJsRenderer | null = null;
    toggles: Record<string, boolean> = {};
    chunkx: number;
    chunkz: number;
    globalname = "";

    constructor(cache: ThreejsSceneCache, preparsed: ReturnType<typeof parseMapsquare>, chunkx: number, chunkz: number, opts: ParsemapOpts) {
        super();
        this.cache = cache;
        this.chunkx = chunkx;
        this.chunkz = chunkz;
        this.chunkdata = (async () => {
            this.loaded = await renderMapSquare(cache, preparsed, chunkx, chunkz, opts);
            this.rootnode.add(this.loaded.chunkroot);
            this.onModelLoaded();
            return this.loaded;
        })();
    }

    static defaultopts(extraopts?: ParsemapOpts) {
        let opts: ParsemapOpts = { invisibleLayers: true, collision: true, map2d: false, padfloor: true, skybox: false, minimap: false, ...extraopts };
        return opts;
    }

    static create(cache: ThreejsSceneCache, chunkx: number, chunkz: number, extraopts?: ParsemapOpts) {
        let opts = this.defaultopts(extraopts);
        let preparsed = parseMapsquare(cache.engine, chunkx, chunkz, opts);
        return new RSMapChunk(cache, preparsed, chunkx, chunkz, opts);
    }

    //TODO remove
    async testLocImg(loc: WorldLocation) {
        if (!this.loaded) { throw new Error("not loaded") }
        let model = this.loaded?.locRenders.get(loc) ?? [];

        let sections = model.map(q => q.mesh.cloneSection(q));
        model.map(q => q.mesh.setSectionHide(q, true));
        let group = new Object3D();
        group.add(...sections.map(q => q.mesh));
        group.traverse(q => q.layers.set(1));
        this.loaded.chunkroot.add(group);

        // let cam = mapImageCamera(loc.x + this.rootnode.position.x / tiledimensions - 16, loc.z + this.rootnode.position.z / tiledimensions - 16, 32, 0.15, 0.25);
        let cam = this.renderscene!.getCurrent2dCamera()!;
        let img = await this.renderscene!.takeMapPicture(cam, 256, 256, false, group);
        group.removeFromParent();
        model.map(q => q.mesh.setSectionHide(q, false));
        return img;
    }

    cloneLocModel(entry: ThreeJsRenderSection[]) {
        return entry.map(q => q.mesh.cloneSection(q));
    }

    replaceLocModel(loc: WorldLocation, newmodels?: ThreeJsRenderSection[]) {
        let entry = this.loaded?.locRenders.get(loc) ?? [];
        entry.forEach(q => q.mesh.setSectionHide(q, true));
        if (!newmodels) {
            this.loaded?.locRenders.delete(loc);
        } else {
            this.loaded?.locRenders.set(loc, newmodels);
            newmodels.forEach(q => q.mesh.setSectionHide(q, false));
        }
        return entry;
    }

    cleanup() {
        this.listeners = {};
        if (this.globalname) {
            delete globalThis[this.globalname];
            this.globalname = "";
        }
        //only clear vertex memory for now, materials might be reused and are up to the scenecache
        this.chunkdata.then(q => q.chunkroot.traverse(obj => {
            if (obj instanceof Mesh) { obj.geometry.dispose(); }
        }));
        this.renderscene?.removeSceneElement(this);
        this.renderscene = null;
    }

    async renderSvg(level = 0, wallsonly = false, pxpersquare = 1) {
        let { chunk, grid, chunkSize, chunkx, chunkz } = await this.chunkdata;
        let rect: MapRect = { x: chunkx * chunkSize, z: chunkz * chunkSize, xsize: chunkSize, zsize: chunkSize };
        return svgfloor(this.cache.engine, grid, chunk?.locs ?? [], rect, level, pxpersquare, wallsonly, false);
    }

    getSceneElements(): ThreeJsSceneElement {
        return {
            modelnode: this.rootnode,
            sky: this.loaded?.sky,
            options: { hideFloor: true }
        };
    }

    addToScene(scene: ThreeJsRenderer) {
        //still leaks memory when using multiple renderers
        if (this.renderscene == null && globalThis.debugchunks) {
            for (let i = 0; i < 10; i++) {
                let name = `chunk_${this.chunkx}_${this.chunkz}${i == 0 ? "" : `_${i}`}`;
                if (!globalThis[name]) {
                    globalThis[name] = this;
                    this.globalname = name;
                    break;
                }
            }
        }
        this.renderscene = scene;
        scene.addSceneElement(this);
    }

    onModelLoaded() {
        this.setToggles(this.toggles);
        this.emit("loaded", this.loaded!);
        this.emit("changed", undefined);
        this.renderscene?.sceneElementsChanged();
        // this.renderscene?.setCameraLimits();//TODO fix this, current bounding box calc is too large
    }

    setToggles(toggles: Record<string, boolean>, hideall = false) {
        this.toggles = toggles;
        this.rootnode.traverse(node => {
            if (node.userData.modelgroup) {
                let newvis = (hideall ? false : toggles[node.userData.modelgroup] ?? true);
                node.traverse(child => {
                    if (child instanceof THREE.Mesh) {
                        child.visible = newvis;
                    }
                });
            }
        });
    }
}