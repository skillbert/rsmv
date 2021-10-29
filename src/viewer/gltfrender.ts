
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

import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader';


export function init(canvas: HTMLCanvasElement) {
	const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });

	const fov = 45;
	const aspect = 2;  // the canvas default
	const near = 0.1;
	const far = 100;
	const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
	camera.position.set(0, 10, 20);

	const controls = new OrbitControls(camera, canvas);
	controls.target.set(0, 5, 0);
	controls.update();

	const scene = new THREE.Scene();
	//scene.background = new THREE.Color('transparent');
	let modelnode: THREE.Group | null = null;
	scene.add(camera);


	renderer.physicallyCorrectLights = true;
	renderer.outputEncoding = THREE.sRGBEncoding;
	const light2 = new THREE.DirectionalLight(0xffffff, 2);
	light2.position.set(0.5, 0, 0.866); // ~60º
	light2.name = 'main_light';
	camera.add(light2);

	let pmremGenerator = new THREE.PMREMGenerator(renderer);
	new RGBELoader()
		.setDataType(THREE.UnsignedByteType)
		.load("../assets/venice_sunset_1k.hdr", (texture) => {
			const envMap = pmremGenerator.fromEquirectangular(texture).texture;
			scene.environment = envMap;
			pmremGenerator.dispose();
		}, undefined, (e) => console.log(e));

	var dirLight = new THREE.DirectionalLight(0xffffff);
	dirLight.position.set(75, 300, -75);
	scene.add(dirLight);

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


	function frameArea(sizeToFitOnScreen: number, boxSize: number, boxCenter: THREE.Vector3, camera: THREE.PerspectiveCamera) {
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

	function resizeRendererToDisplaySize(renderer) {
		const canvas = renderer.domElement;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		const needResize = canvas.width !== width || canvas.height !== height;
		if (needResize) {
			renderer.setSize(width, height, false);
		}
		return needResize;
	}

	function render() {
		if (resizeRendererToDisplaySize(renderer)) {
			const canvas = renderer.domElement;
			camera.aspect = canvas.clientWidth / canvas.clientHeight;
			camera.updateProjectionMatrix();
		}

		renderer.render(scene, camera);

		requestAnimationFrame(render);
	}

	requestAnimationFrame(render);

	async function setModels(models: ArrayBuffer[]) {
		const loader = new GLTFLoader();

		let combined = new THREE.Group();
		let newmodels = await Promise.all<GLTF>(models.map(m => new Promise((d, e) => loader.parse(m, "", d, e))));
		newmodels.forEach(m => combined.add(m.scene));
		combined.scale.setScalar(1 / 512);


		// compute the box that contains all the stuff
		// from root and below
		const box = new THREE.Box3().setFromObject(combined);

		const boxSize = box.getSize(new THREE.Vector3()).length();
		const boxCenter = box.getCenter(new THREE.Vector3());

		// set the camera to frame the box
		//frameArea(boxSize * 0.5, boxSize, boxCenter, camera);

		// update the Trackball controls to handle the new size
		controls.maxDistance = boxSize * 10;
		controls.target.copy(boxCenter);
		controls.update();

		if (modelnode) { scene.remove(modelnode); }
		modelnode = combined;
		//floormesh.visible = !box.intersectsPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0),1));
		floormesh.position.setY(Math.min(0, box.min.y - 0.005));
		floormesh.visible = box.min.y > -1;
		scene.add(modelnode);
	}

	return { setModels };
}
