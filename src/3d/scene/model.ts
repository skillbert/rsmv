import { parse } from "../../opdecoder";
import * as THREE from "three";
import { ThreejsSceneCache, mergeModelDatas, ob3ModelToThree, mergeBoneids } from '../modeltothree';
import { TypedEmitter, CallbackPromise } from '../../utils';
import { boundMethod } from 'autobind-decorator';
import { modifyMesh } from '../mapsquare';
import { AnimationClip, AnimationMixer, Material, Mesh, MeshStandardMaterial, Object3D, Skeleton, SkeletonHelper, SkinnedMesh, Texture, Vector2 } from "three";
import { mountBakedSkeleton, parseAnimationSequence4 } from "../anims/animationframes";
import { cacheMajors } from "../../constants";
import { mountSkeletalSkeleton, parseSkeletalAnimation } from "../anims/animationskeletal";
import { ThreeJsRenderer, ThreeJsSceneElement, ThreeJsSceneElementSource } from "../../viewer/threejsrender";
import { ModelData } from "../modeldata";
import { SimpleModelDef } from ".";

export class RSModel extends TypedEmitter<{ loaded: undefined, animchanged: number }> implements ThreeJsSceneElementSource {
    model: Promise<{ modeldata: ModelData, mesh: Object3D, nullAnim: AnimationClip }>;
    loaded: { modeldata: ModelData, mesh: Object3D, nullAnim: AnimationClip, matUvAnims: { tex: Texture, v: Vector2 }[] } | null = null;
    cache!: ThreejsSceneCache;
    rootnode = new THREE.Group();
    nullAnimPromise = { clip: null as AnimationClip | null, prom: new CallbackPromise<AnimationClip>() };
    anims: Record<number, { clip: AnimationClip | null, prom: Promise<AnimationClip> }> = {
        "-1": this.nullAnimPromise
    };
    mountedanim: AnimationClip | null = null;
    mixer = new AnimationMixer(this.rootnode);
    renderscene: ThreeJsRenderer | null = null;
    targetAnimId = -1;
    skeletontype: "none" | "baked" | "full" = "none";
    skeletonHelper: SkeletonHelper | null = null;

    cleanup() {
        this.listeners = {};
        this.renderscene?.removeSceneElement(this);
        this.skeletonHelper?.removeFromParent();
        this.renderscene = null;
    }

    getSceneElements(): ThreeJsSceneElement {
        return {
            modelnode: this.rootnode,
            updateAnimation: this.updateAnimation
        }
    }

    addToScene(scene: ThreeJsRenderer) {
        this.renderscene = scene;
        scene.addSceneElement(this);
    }

    onModelLoaded() {
        this.emit("loaded", undefined);
        this.renderscene?.forceFrame();
        this.renderscene?.setCameraLimits();
    }

    @boundMethod
    updateAnimation(delta: number, epochtime: number) {
        this.mixer.update(delta);
        this.loaded?.matUvAnims.forEach(q => q.tex.offset.copy(q.v).multiplyScalar(epochtime));
    }

    constructor(cache: ThreejsSceneCache, models: SimpleModelDef, name = "") {
        super();
        this.cache = cache;
        this.model = (async () => {
            let meshdatas = await Promise.all(models.map(async modelinit => {
                let meshdata = await cache.getModelData(modelinit.modelid);
                let modified = {
                    ...meshdata,
                    meshes: meshdata.meshes.map(q => modifyMesh(q, modelinit.mods))
                };
                return modified;
            }));
            let modeldata = mergeModelDatas(meshdatas);
            mergeBoneids(modeldata);
            let mesh = await ob3ModelToThree(this.cache, modeldata);
            mesh.name = name;

            let nullbones: Object3D[] = [];
            for (let i = 0; i < Math.max(modeldata.bonecount, modeldata.skincount); i++) { nullbones.push(mesh); }
            let nullskel = new Skeleton(nullbones as any);
            let matUvAnims: { tex: Texture, v: Vector2 }[] = [];
            mesh.traverse(node => {
                if (node instanceof SkinnedMesh) {
                    node.bind(nullskel);
                }
                if (node instanceof Mesh && node.material instanceof Material) {
                    let uvExt = node.material.userData.gltfExtensions?.RA_materials_uvanim;
                    if (uvExt) {
                        let mat = (node.material as MeshStandardMaterial);
                        let animvec = new Vector2(uvExt.uvAnim[0], uvExt.uvAnim[1]);
                        if (mat.map) { matUvAnims.push({ tex: mat.map, v: animvec }); }
                        if (mat.normalMap) { matUvAnims.push({ tex: mat.normalMap, v: animvec }); }
                        if (mat.emissiveMap) { matUvAnims.push({ tex: mat.emissiveMap, v: animvec }); }
                        if (mat.metalnessMap) { matUvAnims.push({ tex: mat.metalnessMap, v: animvec }); }
                        if (mat.roughnessMap) { matUvAnims.push({ tex: mat.roughnessMap, v: animvec }); }
                    }
                }
            });
            let nullAnim = new AnimationClip(undefined, undefined, []);
            this.nullAnimPromise.clip = nullAnim;
            this.nullAnimPromise.prom.done(nullAnim);

            this.rootnode.add(mesh);
            this.loaded = { mesh, modeldata, nullAnim, matUvAnims };
            if (this.targetAnimId == -1) { this.setAnimation(-1); }
            this.onModelLoaded();
            return this.loaded;
        })();
    }

    private mountAnim(clip: AnimationClip) {
        if (!this.loaded) { throw new Error("attempting to mount anim before model is loaded"); }
        if (this.mountedanim == clip) { return; }
        //TODO is this required?
        if (this.loaded.modeldata.bonecount == 0 && this.loaded.modeldata.skincount == 0) { return; }

        let mesh = this.loaded.mesh;
        if (mesh.animations.indexOf(clip) == -1) { mesh.animations.push(clip); }
        this.mixer.stopAllAction();
        let action = this.mixer.clipAction(clip, mesh);
        action.play();
        // this.skeletonHelper?.removeFromParent();
        // this.skeletonHelper = new SkeletonHelper(mesh);
        // (this.renderscene as any)?.scene.add(this.skeletonHelper);
        this.mountedanim = clip;
    }

    loadAnimation(animid: number) {
        if (this.anims[animid]) { return this.anims[animid]; }
        this.anims[animid] = {
            clip: null,
            prom: (async () => {
                let seqfile = await this.cache.engine.getFileById(cacheMajors.sequences, animid);

                let seq = parse.sequences.read(seqfile, this.cache.engine.rawsource);

                let clip: AnimationClip;
                if (seq.skeletal_animation) {
                    let anim = await parseSkeletalAnimation(this.cache, seq.skeletal_animation);
                    clip = anim.clip;
                    let loaded = this.loaded ?? await this.model;
                    if (this.skeletontype != "full") {
                        if (this.skeletontype != "none") { throw new Error("wrong skeleton type already mounted to model"); }
                        await mountSkeletalSkeleton(loaded.mesh, this.cache, anim.framebaseid);
                        this.skeletontype = "full";
                    }
                } else if (seq.frames) {
                    let frameanim = await parseAnimationSequence4(this.cache, seq.frames);
                    let loaded = this.loaded ?? await this.model;
                    if (this.skeletontype != "baked") {
                        if (this.skeletontype != "none") { throw new Error("wrong skeleton type already mounted to model"); }
                        mountBakedSkeleton(loaded.mesh, loaded.modeldata);
                        this.skeletontype = "baked";
                    }
                    clip = frameanim(loaded.modeldata);
                } else {
                    throw new Error("animation has no frames");
                }
                this.anims[animid] = { clip, prom: Promise.resolve(clip) };

                if (!this.loaded?.modeldata) { await this.model; }
                this.anims[animid].clip = clip;
                return clip;
            })()
        }
        return this.anims[animid];
    }

    async setAnimation(animid: number) {
        this.targetAnimId = animid;
        const mount = this.loadAnimation(animid);
        return this.mountAnim(mount.clip ?? await mount.prom);
    }
}