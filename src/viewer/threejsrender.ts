
//yay, three is now using modules so i can no longer use modules myself.....
//requirejs cant load modules since all modules are now promises (in case they want
//to use top level await).
const THREE = require("three/build/three.js") as typeof import("three");
//i have to also put it in the global scope for the other libs...
global.THREE = THREE;
require('three/examples/js/controls/OrbitControls');
require('three/examples/js/loaders/GLTFLoader.js');
require('three/examples/js/loaders/RGBELoader.js');
//this is the dumbest thing i've ever writter and there is no better way, i tried
const GLTFLoader = (THREE as any).GLTFLoader as typeof import('three/examples/jsm/loaders/GLTFLoader').GLTFLoader;
const OrbitControls = (THREE as any).OrbitControls as typeof import('three/examples/jsm/controls/OrbitControls').OrbitControls;
const RGBELoader = (THREE as any).RGBELoader as typeof import('three/examples/jsm/loaders/RGBELoader.js').RGBELoader;

import { ob3ModelToGltfFile } from '../3d/ob3togltf';
import { augmentThreeJsFloorMaterial, ob3ModelToThreejsNode } from '../3d/ob3tothree';
import { ModelModifications } from '../3d/utils';
import { boundMethod } from 'autobind-decorator';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader';
import * as fs from "fs";

import { ModelViewerState, ModelSink, MiniCache } from "./index";
import { CacheFileSource } from '../cache';
import { parseObject } from '../opdecoder';
import { cacheMajors } from '../constants';
import { BufferGeometry, MeshPhongMaterial } from 'three';
import { ModelExtras, MeshTileInfo, ClickableMesh, resolveMorphedObject } from '../3d/mapsquare';


export class ThreeJsRenderer implements ModelSink {
	renderer: THREE.WebGLRenderer;
	canvas: HTMLCanvasElement;
	stateChangeCallback: (newstate: ModelViewerState) => void;
	uistate: ModelViewerState = { meta: "", toggles: {} };
	scene: THREE.Scene;
	camera: THREE.Camera | THREE.PerspectiveCamera;
	selectedmodels: { mesh: THREE.Mesh, unselect: () => void }[] = [];
	controls: InstanceType<typeof OrbitControls>;
	modelnode: THREE.Group | null = null;
	floormesh: THREE.Mesh;
	queuedFrameId = 0;
	automaticFrames = false;
	contextLossCount = 0;
	contextLossCountLastRender = 0;
	unpackOb3WithGltf: boolean;
	filesource: CacheFileSource;

	constructor(canvas: HTMLCanvasElement, stateChangeCallback: (newstate: ModelViewerState) => void, filesource: CacheFileSource, unpackOb3WithGltf = false) {
		(window as any).render = this;//TODO remove
		this.filesource = filesource;
		this.canvas = canvas;
		this.unpackOb3WithGltf = unpackOb3WithGltf;
		this.stateChangeCallback = stateChangeCallback;
		this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
		const renderer = this.renderer;
		canvas.addEventListener("webglcontextlost", () => this.contextLossCount++);
		canvas.onclick = this.click;


		const fov = 45;
		const aspect = 2;  // the canvas default
		const near = 0.1;//TODO revert to 0.1-100
		const far = 1000;
		const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
		camera.position.set(0, 10, 20);
		this.camera = camera;

		const controls = new OrbitControls(camera, canvas);
		controls.target.set(0, 5, 0);
		controls.update();
		controls.addEventListener("change", this.forceFrame);
		this.controls = controls;

		const scene = new THREE.Scene();
		this.scene = scene;
		//scene.background = new THREE.Color('transparent');
		scene.add(camera);


		renderer.physicallyCorrectLights = true;
		renderer.outputEncoding = THREE.sRGBEncoding;
		// const light2 = new THREE.DirectionalLight(0xffffff, 2);
		// light2.position.set(0.5, 0, 0.866); // ~60º
		// light2.name = 'main_light';
		// camera.add(light2);

		// let pmremGenerator = new THREE.PMREMGenerator(renderer);
		// new RGBELoader()
		// 	.setDataType(THREE.UnsignedByteType)
		// 	.load("../assets/venice_sunset_1k.hdr", (texture) => {
		// 		const envMap = pmremGenerator.fromEquirectangular(texture).texture;
		// 		scene.environment = envMap;
		// 		pmremGenerator.dispose();
		// 	}, undefined, (e) => console.log(e));


		const planeSize = 11;

		const loader = new THREE.TextureLoader();
		const texture = loader.load('../assets/checker.png');
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.magFilter = THREE.NearestFilter;
		const repeats = planeSize / 2;
		texture.repeat.set(repeats, repeats);

		const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize);
		const planeMat = new THREE.MeshPhongMaterial({ map: texture, side: THREE.DoubleSide, });
		const floormesh = new THREE.Mesh(planeGeo, planeMat);
		floormesh.rotation.x = Math.PI * -.5;
		scene.add(floormesh);
		this.floormesh = floormesh;

		//TODO figure out which lights work or not
		scene.add(new THREE.AmbientLight(0xffffff, 0.7));

		var dirLight = new THREE.DirectionalLight(0xffffff);
		dirLight.position.set(75, 300, -75);
		scene.add(dirLight);

		let hemilight = new THREE.HemisphereLight(0xffffff, 0x888844);
		scene.add(hemilight);
	}

	frameArea(sizeToFitOnScreen: number, boxSize: number, boxCenter: THREE.Vector3, camera: THREE.PerspectiveCamera) {
		const halfSizeToFitOnScreen = sizeToFitOnScreen * 0.5;
		const halfFovY = THREE.MathUtils.degToRad(camera.fov * .5);
		const distance = halfSizeToFitOnScreen / Math.tan(halfFovY);
		// compute a unit vector that points in the direction the camera is now
		// in the xz plane from the center of the box
		const direction = (new THREE.Vector3())
			.subVectors(camera.position, boxCenter)
			.multiply(new THREE.Vector3(1, 0, 1))
			.normalize();

		// move the camera to a position distance units way from the center
		// in whatever direction the camera was from the center already
		// camera.position.copy(direction.multiplyScalar(distance).add(boxCenter));

		// pick some near and far values for the frustum that
		// will contain the box.
		// camera.near = boxSize / 100;
		// camera.far = boxSize * 100;

		camera.updateProjectionMatrix();

		// point the camera to look at the center of the box
		camera.lookAt(boxCenter.x, boxCenter.y, boxCenter.z);
	}

	resizeRendererToDisplaySize() {
		const canvas = this.renderer.domElement;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		const needResize = canvas.width !== width || canvas.height !== height;
		if (needResize) {
			this.renderer.setSize(width, height, false);
		}
		return needResize;
	}


	@boundMethod
	async guaranteeRender() {
		let waitContext = () => {
			if (!this.renderer.getContext().isContextLost()) {
				return;
			}
			console.log("frame stalled since context is lost");
			return new Promise<boolean>(resolve => {
				this.renderer.domElement.addEventListener("webglcontextrestored", () => {
					console.log("context restored");
					//make sure three.js handles the event before we retry
					setTimeout(resolve, 1);
				}, { once: true });
			})
		}

		let success = false;
		for (let retry = 0; retry < 5; retry++) {
			await waitContext();
			//it seems like the first render after a context loss is always failed, force 2 renders this way
			let prerenderlosses = this.contextLossCountLastRender;
			this.render();
			await new Promise(d => setTimeout(d, 1));

			if (this.renderer.getContext().isContextLost()) {
				console.log("lost context during render");
				continue;
			} else if (prerenderlosses != this.contextLossCount) {
				console.log("lost and regained context during render");
				continue;
			}
			success = true;
			break;
		}
		if (!success) {
			throw new Error("Failed to render frame after 5 retries");
		}
	}

	@boundMethod
	render() {
		cancelAnimationFrame(this.queuedFrameId);
		this.queuedFrameId = 0;
		if (this.camera instanceof THREE.PerspectiveCamera && this.resizeRendererToDisplaySize()) {
			const canvas = this.renderer.domElement;
			this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
			this.camera.updateProjectionMatrix();
		}

		this.renderer.render(this.scene, this.camera);
		this.contextLossCountLastRender = this.contextLossCount;

		if (this.automaticFrames) {
			this.forceFrame();
		}
	}

	@boundMethod
	forceFrame() {
		if (!this.queuedFrameId) {
			this.queuedFrameId = requestAnimationFrame(this.render);
		}
	}

	@boundMethod
	fixVisisbleMeshes() {
		this.modelnode?.traverse(node => {
			if (node.userData.modelgroup) {
				let newvis = this.uistate.toggles[node.userData.modelgroup] ?? true;
				node.traverse(child => {
					if (child instanceof THREE.Mesh) { child.visible = newvis; }
				})
			}
		});
	}

	setValue(prop: string, value: boolean) {
		this.uistate.toggles[prop] = value;
		this.fixVisisbleMeshes();
		this.forceFrame();
		this.stateChangeCallback(this.uistate);
	}

	async setOb3Models(modelfiles: Buffer[], cache: MiniCache, mods: ModelModifications, metastr: string) {
		if (this.unpackOb3WithGltf) {
			//TODO
			// let models = await Promise.all(modelfiles.map(file => ob3ModelToGltfFile(cache.get.bind(cache), file, mods)));
			// return this.setGltfModels(models, metastr);
		} else {
			return this.setModels(
				await Promise.all(modelfiles.map(m => ob3ModelToThreejsNode(cache.get.bind(cache), m, mods))), metastr);
		}
	}
	async setGltfModels(modelfiles: Uint8Array[], metastr = "") {
		let newmodels = await Promise.all(modelfiles.map(file => this.parseGltfFile(file)));
		this.setModels(newmodels.map(q => q.rootnode), metastr);
	}

	async takePicture(x: number, z: number, ntiles: number, framesize = 2048) {
		let scale = 2 / ntiles;
		let cam = new THREE.Camera();
		cam.projectionMatrix.elements = [
			scale, scale / 5, 0, -x * scale - 1,
			0, scale / 2, -scale, -z * scale - 1,
			0, -0.001, 0, 0,
			0, 0, 0, 1
		];
		this.renderer.setSize(framesize, framesize);
		cam.projectionMatrix.transpose();
		cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
		this.camera = cam;
		let img: Blob | null = null;
		for (let retry = 0; retry < 5; retry++) {
			await this.guaranteeRender();
			img = await new Promise<Blob | null>(resolve => this.canvas.toBlob(resolve, "image/png"));
			if (this.contextLossCountLastRender != this.contextLossCount) {
				console.log("context loss during capture");
				img = null;
				continue;
			}
			break;
		}
		if (!img) { throw new Error("capture failed"); }
		return new Uint8Array(await img.arrayBuffer());
	}

	async parseGltfFile(modelfile: Uint8Array) {

		//Threejs expects a raw memory slice (ArrayBuffer), however most nodejs api's use a view into
		//such slice (TypedArray). some node modules go as far as reusing these and combining the raw buffers
		//and returning only a correct view into a large slice if this is the case we have to copy it to a new
		//slice to guarantee no other junk is in the same slice
		let modelbuffer: ArrayBuffer;
		if (modelfile.byteOffset != 0 || modelfile.byteLength != modelfile.buffer.byteLength) {
			modelbuffer = Uint8Array.prototype.slice.call(modelfile).buffer;
		} else {
			modelbuffer = modelfile.buffer;
		}

		const loader = new GLTFLoader();

		let model = await new Promise<GLTF>((d, e) => loader.parse(modelbuffer, "", d, e));

		//use faster materials
		let rootnode = model.scene;
		rootnode.traverse(node => {
			node.matrixAutoUpdate = false;
			node.updateMatrix();
			if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial) {
				let floortex = node.userData.gltfExtensions?.RA_FLOORTEX;
				let mat = new THREE.MeshPhongMaterial();
				if (floortex) {
					augmentThreeJsFloorMaterial(mat);
				}
				mat.map = node.material.map;
				mat.vertexColors = node.material.vertexColors;
				mat.transparent = node.material.transparent;
				mat.alphaTest = 0.1;
				mat.shininess = 0;
				mat.userData = node.material.userData;
				mat.flatShading = true;
				node.material = mat;
			}
		});
		return { rootnode };
	}

	async setModels(models: THREE.Object3D[], metastr = "") {
		let combined = new THREE.Group();
		let groups = new Set<string>();
		models.forEach(m => combined.add(m));
		combined.scale.setScalar(1 / 512);
		(window as any).scene = this.scene;

		combined.traverse(node => {
			if (node.userData.modelgroup) {
				groups.add(node.userData.modelgroup);
			}
			if (node instanceof THREE.Mesh) {
				let parent: THREE.Object3D | null = node;
				let iswireframe = false;
				//TODO this data should be on the mesh it concerns instead of a parent
				while (parent) {
					if (parent.userData.modeltype == "floorhidden") {
						iswireframe = true;
					}
					parent = parent.parent;
				}
				if (iswireframe && node.material instanceof MeshPhongMaterial) {
					node.material.wireframe = true;
				}
			}
		});

		// compute the box that contains all the stuff
		// from root and below
		const box = new THREE.Box3().setFromObject(combined);
		const boxSize = box.getSize(new THREE.Vector3()).length();
		const boxCenter = box.getCenter(new THREE.Vector3());

		// set the camera to frame the box
		//frameArea(boxSize * 0.5, boxSize, boxCenter, camera);

		// update the Trackball controls to handle the new size
		this.controls.maxDistance = Math.min(500, boxSize * 10 + 10);
		this.controls.target.copy(boxCenter);
		this.controls.update();
		this.controls.screenSpacePanning = true;

		if (this.modelnode) { this.scene.remove(this.modelnode); }
		this.modelnode = combined;
		//floormesh.visible = !box.intersectsPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0),1));
		this.floormesh.position.setY(Math.min(0, box.min.y - 0.005));
		this.floormesh.visible = box.min.y > -1;
		this.scene.add(this.modelnode);

		this.uistate = { meta: metastr, toggles: Object.create(null) };
		[...groups].sort((a, b) => a.localeCompare(b)).forEach(q => {
			this.uistate.toggles[q] = !q.match(/(floorhidden|collision)/);
		});
		this.fixVisisbleMeshes();

		this.forceFrame();
		this.stateChangeCallback(this.uistate);
	}

	@boundMethod
	async click(e: React.MouseEvent | MouseEvent) {
		//reset previous selection
		for (let model of this.selectedmodels) {
			model.unselect();
		}

		this.selectedmodels = [];
		let raycaster = new THREE.Raycaster();
		let cnvrect = this.canvas.getBoundingClientRect();
		let mousepos = new THREE.Vector2(
			(e.clientX - cnvrect.x) / cnvrect.width * 2 - 1,
			-(e.clientY - cnvrect.y) / cnvrect.height * 2 + 1,
		);

		raycaster.setFromCamera(mousepos, this.camera);
		let intersects = raycaster.intersectObjects(this.scene.children);
		for (let isct of intersects) {
			let obj: THREE.Object3D | null = isct.object;
			if (!obj.visible) { continue; }
			if (!(obj instanceof THREE.Mesh) || !obj.userData.isclickable) { continue; }
			let meshdata = obj.userData as ModelExtras;
			if (!meshdata.isclickable) { continue; }

			//find out what we clicked
			let match: unknown = undefined;
			let endindex: number = obj.geometry.index?.count ?? obj.geometry.attributes.position.count;
			let startindex = 0;
			let clickindex = isct.faceIndex;
			if (typeof clickindex == "undefined") { throw new Error("???") }
			for (let i = 0; i < meshdata.subranges.length; i++) {
				if (clickindex * 3 < meshdata.subranges[i]) {
					endindex = meshdata.subranges[i];
					break;
				}
				startindex = meshdata.subranges[i];
				match = meshdata.subobjects[i];
			}
			if (!match) { continue; }

			//find all the meshes and vertex ranges that are part of this obejct
			let matches: { start: number, end: number, mesh: THREE.Mesh }[] = [];
			if (!meshdata.searchPeers) {
				matches.push({ start: startindex, end: endindex, mesh: obj });
			} else {
				let root: THREE.Object3D = obj;
				while (root.parent) { root = root.parent; }

				root.traverseVisible(obj => {
					let meshdata = obj.userData as ModelExtras;
					if (obj instanceof THREE.Mesh && meshdata.isclickable && meshdata.searchPeers) {
						for (let i = 0; i < meshdata.subobjects.length; i++) {
							if (meshdata.subobjects[i] == match) {
								matches.push({
									start: meshdata.subranges[i],
									end: meshdata.subranges[i + 1] ?? obj.geometry.index.count,
									mesh: obj
								});
							}
						}
					}
				});
			}

			console.log(matches);

			//update the affected meshes
			let undos: (() => void)[] = [];
			for (let submatch of matches) {
				let color = submatch.mesh.geometry.getAttribute("color");
				let usecolor = submatch.mesh.geometry.getAttribute("_ra_floortex_usescolor");
				let oldindices: number[] = [];
				let oldcols: [number, number, number][] = [];
				let oldusecols: [number, number, number, number][] = [];
				//remember old atribute values
				for (let i = submatch.start; i < submatch.end; i++) {
					let index = submatch.mesh.geometry.index?.getX(i) ?? i;
					oldindices.push(index);
					oldcols.push([color.getX(index), color.getY(index), color.getZ(index)]);
					if (usecolor) {
						oldusecols.push([usecolor.getX(index), usecolor.getY(index), usecolor.getZ(index), usecolor.getW(index)]);
					}
				}
				//update the value in a seperate loop since we'll be writing some multiple times
				for (let i = submatch.start; i < submatch.end; i++) {
					let index = submatch.mesh.geometry.index?.getX(i) ?? i;
					oldindices.push(index);
					color.setXYZ(index, 255, 0, 0);
					if (usecolor) {
						usecolor.setXYZW(index, 255, 255, 255, 255);
					}
				}
				undos.push(() => {
					for (let i = submatch.start; i < submatch.end; i++) {
						let index = oldindices[i - submatch.start];
						color.setXYZ(index, ...oldcols[i - submatch.start]);
						color.needsUpdate = true;
						if (usecolor) {
							usecolor.setXYZW(index, ...oldusecols[i - submatch.start]);
							usecolor.needsUpdate = true;
						}
					}
				});
				this.selectedmodels.push({
					mesh: submatch.mesh,
					unselect() { undos.forEach(undo => undo()); }
				});
				color.needsUpdate = true;
				if (usecolor) { usecolor.needsUpdate = true; }
			}

			//show data about what we clicked
			console.log(match);
			if (meshdata.modeltype == "locationgroup") {
				let typedmatch = match as typeof meshdata.subobjects[number];
				let object = resolveMorphedObject(this.filesource, typedmatch.locationid);
				this.uistate.meta = JSON.stringify({ ...typedmatch, object }, undefined, "\t");
			}
			if (meshdata.modeltype == "floor") {
				let typedmatch = match as typeof meshdata.subobjects[number];
				this.uistate.meta = JSON.stringify({
					...meshdata,
					x: typedmatch.x,
					z: typedmatch.z,
					subobjects: undefined,//remove (near) circular ref from json
					subranges: undefined,
					tile: { ...typedmatch.tile, next01: undefined, next10: undefined, next11: undefined }
				}, undefined, "\t");
			}
			break;
		}

		this.stateChangeCallback(this.uistate);
		this.forceFrame();
	}


}
