
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
import { ModelModifications } from '../3d/utils';
import { boundMethod } from 'autobind-decorator';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader';

import { ModelViewerState, ModelSink, MiniCache } from "./index";


export class GltfRenderer implements ModelSink {
	renderer: THREE.WebGLRenderer;
	canvas: HTMLCanvasElement;
	stateChangeCallback: (newstate: ModelViewerState) => void;
	uistate: ModelViewerState = { meta: "", toggles: {} };
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	selectedmodels: THREE.Object3D[] = [];
	controls: InstanceType<typeof OrbitControls>;
	modelnode: THREE.Group | null = null;
	floormesh: THREE.Mesh;
	queuedFrameId = 0;
	automaticFrames = false;

	constructor(canvas: HTMLCanvasElement, stateChangeCallback: (newstate: ModelViewerState) => void) {
		this.canvas = canvas;
		this.stateChangeCallback = stateChangeCallback;
		this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
		const renderer = this.renderer;
		canvas.onclick = this.click;


		const fov = 45;
		const aspect = 2;  // the canvas default
		const near = 0.1;
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
		camera.position.copy(direction.multiplyScalar(distance).add(boxCenter));

		// pick some near and far values for the frustum that
		// will contain the box.
		camera.near = boxSize / 100;
		camera.far = boxSize * 100;

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
	render() {
		this.queuedFrameId = 0;
		if (this.resizeRendererToDisplaySize()) {
			const canvas = this.renderer.domElement;
			this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
			this.camera.updateProjectionMatrix();
		}

		this.renderer.render(this.scene, this.camera);

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

	setValue(prop: string, value: boolean) {
		this.uistate.toggles[prop] = value;

		this.modelnode?.traverse(node => {
			if (node.userData.modelgroup) {
				let newvis = this.uistate.toggles[node.userData.modelgroup];
				node.traverse(child => {
					if (child instanceof THREE.Mesh) { child.visible = newvis; }
				})
			}
		});
		this.forceFrame();
		this.stateChangeCallback(this.uistate);
	}

	async setOb3Models(modelfiles: Buffer[], cache: MiniCache, mods: ModelModifications, metastr: string) {
		let models = await Promise.all(modelfiles.map(file => ob3ModelToGltfFile(cache.get.bind(cache), file, mods)));
		this.setModels(models.map(m => m.buffer), metastr);
	}
	setGltfModels(gltffiles: Buffer[]) {
		this.setModels(gltffiles.map(m => m.buffer));
	}

	async setModels(models: ArrayBuffer[], metastr = "") {
		const loader = new GLTFLoader();

		let combined = new THREE.Group();
		let newmodels = await Promise.all<GLTF>(models.map(m => new Promise((d, e) => loader.parse(m, "", d, e))));
		newmodels.forEach(m => combined.add(m.scene));
		combined.scale.setScalar(1 / 512);
		(window as any).scene = this.scene;

		this.uistate = { meta: metastr, toggles: Object.create(null) };

		//use faster materials
		newmodels.forEach(model => model.scene.traverse(node => {
			node.matrixAutoUpdate = false;
			if (node.userData.modelgroup) {
				this.uistate.toggles[node.userData.modelgroup] = node.userData.modeltype != "floorhidden";
			}
			node.updateMatrix();
			if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial) {
				let transform: any = null;
				let parent: THREE.Object3D | null = node;
				let iswireframe = false;
				let modelgroup = "";
				while (parent) {
					if (parent.userData.modeltype == "floorhidden") {
						iswireframe = true;
					}
					if (parent.userData.modelgroup) {
						modelgroup = parent.userData.modelgroup;
					}
					if (parent.userData.gltfExtensions?.RA_nodes_floortransform) {
						transform = parent.userData.gltfExtensions.RA_nodes_floortransform;
					}
					parent = parent.parent;
				}
				node.visible = !iswireframe;//TODO bad logic
				let mat = new THREE.MeshPhongMaterial({ wireframe: iswireframe });
				if (transform/* &&  (window as any).dotransform*/) {
					mat.customProgramCacheKey = () => "transformed";
					mat.onBeforeCompile = (shader, renderer) => {
						let q = transform!.quadratic;
						shader.uniforms.RA_nodes_matrix_linear = { value: transform!.linear };
						shader.uniforms.RA_nodes_matrix_quadratic = { value: [0, q[0], q[2], 0, 0, q[1], 0, 0, 0] };
						shader.uniforms.RA_nodes_matrix_cubic = { value: transform!.cubic };
						// shader.uniforms.RA_nodes_matrix_linear = { value: [1, 1, 0, 0, 1, 0, 0, 0, 1] };
						//  shader.uniforms.RA_nodes_matrix_quadratic = { value: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
						shader.vertexShader =
							`uniform vec3 RA_nodes_matrix_linear;\n`
							+ `uniform mat3 RA_nodes_matrix_quadratic;\n`
							+ `uniform float RA_nodes_matrix_cubic;\n`
							+ shader.vertexShader.replace("#include <project_vertex>",
								`transformed.y =`
								+ ` + dot(RA_nodes_matrix_linear, transformed)`
								+ ` + dot(transformed,RA_nodes_matrix_quadratic * transformed)`
								+ ` + RA_nodes_matrix_cubic*transformed.x*transformed.y*transformed.z;\n`
								+ `#include <project_vertex>\n`)

					}
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
		}));

		// compute the box that contains all the stuff
		// from root and below
		const box = new THREE.Box3().setFromObject(combined);
		const boxSize = box.getSize(new THREE.Vector3()).length();
		const boxCenter = box.getCenter(new THREE.Vector3());

		// set the camera to frame the box
		//frameArea(boxSize * 0.5, boxSize, boxCenter, camera);

		// update the Trackball controls to handle the new size
		this.controls.maxDistance = boxSize * 10;
		this.controls.target.copy(boxCenter);
		this.controls.update();

		if (this.modelnode) { this.scene.remove(this.modelnode); }
		this.modelnode = combined;
		//floormesh.visible = !box.intersectsPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0),1));
		this.floormesh.position.setY(Math.min(0, box.min.y - 0.005));
		this.floormesh.visible = box.min.y > -1;
		this.scene.add(this.modelnode);

		this.forceFrame();
		this.stateChangeCallback(this.uistate);
	}

	@boundMethod
	click(e: React.MouseEvent | MouseEvent) {
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
			while (obj && obj.userData?.modeltype != "location") {
				obj = obj.parent;
			}
			if (obj) { console.log(obj, obj.userData); }
			//(obj as any).material.color.set(0xff0000);
		}

		this.forceFrame();
	}


}
