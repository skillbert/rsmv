import * as THREE from "three";

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { ModelModifications, FlatImageData, TypedEmitter } from '../utils';
import { boundMethod } from 'autobind-decorator';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';

import { ModelExtras, MeshTileInfo, ClickableMesh } from '../3d/mapsquare';
import { AnimationMixer, Clock, CubeCamera, Group, Material, Mesh, Object3D, PerspectiveCamera } from "three";
import { VR360Render } from "./vr360camera";
import sharp from "sharp";

//TODO remove
globalThis.THREE = THREE;


let lastob3modelcall: { args: any[], inst: ThreeJsRenderer } | null = null;
if (module.hot) {
	module.hot.accept("../3d/ob3tothree", () => {
		console.log("accept module")
		setTimeout(() => {
			if (lastob3modelcall) {
				//@ts-ignore
				lastob3modelcall.inst.setOb3Models(...lastob3modelcall.args);
			}
		}, 1);
	});
}

export type ThreeJsRendererEvents = {
	select: null | { obj: Mesh, meshdata: Extract<ModelExtras, ClickableMesh<any>>, match: unknown, vertexgroups: { start: number, end: number, mesh: THREE.Mesh }[] }
}

export interface ThreeJsSceneElementSource {
	getSceneElements(): ThreeJsSceneElement
}

export type ThreeJsSceneElement = {
	modelnode?: Object3D,
	sky?: { skybox: THREE.Object3D<THREE.Event> | null, fogColor: number[] } | null
	animationMixer?: AnimationMixer,
	options?: {
		opaqueBackground?: boolean,
		hideFloor?: boolean
	}
}

export class ThreeJsRenderer extends TypedEmitter<ThreeJsRendererEvents>{
	private renderer: THREE.WebGLRenderer;
	private canvas: HTMLCanvasElement;
	private skybox: { scene: THREE.Scene, camera: THREE.Camera } | null = null;
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private controls: InstanceType<typeof OrbitControls>;
	private modelnode: THREE.Group;
	private floormesh: THREE.Mesh;
	private queuedFrameId = 0;
	private automaticFrames = false;
	private contextLossCount = 0;
	private contextLossCountLastRender = 0;
	private clock = new Clock(true);

	private sceneElements = new Set<ThreeJsSceneElementSource>();
	private animationMixers = new Set<AnimationMixer>();
	private vr360cam: VR360Render | null = null;

	constructor(canvas: HTMLCanvasElement, params?: THREE.WebGLRendererParameters) {
		super();
		globalThis.render = this;//TODO remove
		this.canvas = canvas;
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			alpha: true,
			powerPreference: "high-performance",
			antialias: true,
			preserveDrawingBuffer: true,
			...params
		});
		this.renderer.autoClear = false;
		const renderer = this.renderer;
		canvas.addEventListener("webglcontextlost", () => this.contextLossCount++);
		canvas.onclick = this.click;

		const fov = 45;
		const aspect = 2;
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
		globalThis.scene = this.scene;
		//scene.background = new THREE.Color('transparent');
		scene.add(camera);

		renderer.physicallyCorrectLights = true;
		renderer.outputEncoding = THREE.sRGBEncoding;

		const planeSize = 11;

		const loader = new THREE.TextureLoader();
		const texture = loader.load('../assets/checker.png');
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.magFilter = THREE.NearestFilter;
		const repeats = planeSize / 2;
		texture.repeat.set(repeats, repeats);

		//floor mesh
		const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize);
		const planeMat = new THREE.MeshPhongMaterial({ map: texture, side: THREE.DoubleSide, });
		const floormesh = new THREE.Mesh(planeGeo, planeMat);
		floormesh.rotation.x = Math.PI * -.5;
		scene.add(floormesh);
		this.floormesh = floormesh;

		//model viewer root
		this.modelnode = new THREE.Group();
		this.modelnode.scale.set(1 / 512, 1 / 512, -1 / 512);
		this.scene.add(this.modelnode);

		//TODO figure out which lights work or not
		scene.add(new THREE.AmbientLight(0xffffff, 0.7));

		var dirLight = new THREE.DirectionalLight(0xffffff);
		dirLight.position.set(75, 300, -75);
		scene.add(dirLight);

		let hemilight = new THREE.HemisphereLight(0xffffff, 0x888844);
		scene.add(hemilight);

		this.sceneElementsChanged();
	}

	addSceneElement(el: ThreeJsSceneElementSource) {
		this.sceneElements.add(el);
		this.sceneElementsChanged();
	}

	removeSceneElement(el: ThreeJsSceneElementSource) {
		this.sceneElements.delete(el);
		this.sceneElementsChanged();
	}

	sceneElementsChanged() {
		let sky: ThreeJsSceneElement["sky"] = null;
		let animated = false;
		let opaqueBackground = false;
		let showfloor = true;
		let nodeDeleteList = new Set(this.modelnode.children);
		this.animationMixers.clear();
		for (let source of this.sceneElements) {
			let el = source.getSceneElements();
			if (el.sky) { sky = el.sky; }
			if (el.animationMixer) { this.animationMixers.add(el.animationMixer); }
			if (el.options?.opaqueBackground) { opaqueBackground = true; }
			if (el.options?.hideFloor) { showfloor = false; }
			if (el.modelnode) {
				nodeDeleteList.delete(el.modelnode);
				if (el.modelnode.parent != this.modelnode) {
					this.modelnode.add(el.modelnode);
				}
			}
		}
		nodeDeleteList.forEach(q => this.modelnode.remove(q));

		this.renderer.setClearColor(new THREE.Color(0, 0, 0), (opaqueBackground ? 255 : 0));
		this.scene.background = (opaqueBackground ? new THREE.Color(0, 0, 0) : null);
		this.automaticFrames = animated;
		this.floormesh.visible = showfloor;

		//fog/skybox
		let fogcolobj = (sky?.fogColor ? new THREE.Color(sky.fogColor[0] / 255, sky.fogColor[1] / 255, sky.fogColor[2] / 255) : null);
		this.scene.fog = (fogcolobj ? new THREE.Fog("#" + fogcolobj.getHexString(), 80, 250) : null);
		if (sky?.skybox) {
			let scene = this.skybox?.scene ?? new THREE.Scene();
			let camera = this.skybox?.camera ?? this.camera.clone();
			let obj = new THREE.Object3D();
			obj.scale.set(1 / 512, 1 / 512, -1 / 512);
			obj.add(sky.skybox);
			scene.clear();
			scene.add(obj, camera, new THREE.AmbientLight(0xffffff));
			scene.background = fogcolobj;
			this.skybox = { scene, camera };
		} else {
			this.skybox = null;
		}

		this.forceFrame();
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
	async guaranteeRender(cam: THREE.Camera = this.camera) {
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
			this.render(cam);
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

	// renderSVG() {
	// 	let renderer = new SVGRenderer();
	// 	this.scene.traverse(q => {
	// 		if (q instanceof THREE.Mesh) {
	// 			let geo = q.geometry as THREE.BufferGeometry;
	// 			let mat = q.material as THREE.MeshBasicMaterial;
	// 			//svgrender doesn't deal with mirrored faces properly (det(proj)<0)
	// 			mat.side = THREE.DoubleSide;
	// 			for (let attr in geo.attributes) {
	// 				//de-interleave attributes since it doesn't understand
	// 				if (geo.attributes[attr] instanceof THREE.InterleavedBufferAttribute) {
	// 					geo.attributes[attr] = geo.attributes[attr].clone();
	// 				}
	// 				//it also doesn't understand normalized attrs (color)
	// 				if (geo.attributes[attr].normalized) {
	// 					let buf = geo.attributes[attr].array;
	// 					if (geo.attributes[attr].count * geo.attributes[attr].itemSize != buf.length) {
	// 						throw new Error("simple copy not possible");
	// 					}
	// 					let newbuf = new Float32Array(buf.length);
	// 					let factor = 1;
	// 					if (buf instanceof Uint8Array) {
	// 						factor = 1 / ((1 << 8) - 1);
	// 					} else if (buf instanceof Uint16Array) {
	// 						factor = 1 / ((1 << 16) - 1);
	// 					} else if (buf instanceof Int16Array) {
	// 						factor = 1 / ((1 << 15) - 1);
	// 					} else {
	// 						throw new Error("buffer type not supported");
	// 					}
	// 					for (let i = 0; i < buf.length; i++) {
	// 						newbuf[i] = buf[i] * factor;
	// 					}

	// 					geo.attributes[attr] = new THREE.BufferAttribute(newbuf, geo.attributes[attr].itemSize);
	// 				}
	// 			}
	// 			//vertex alpha also messes it up...
	// 			if (geo.getAttribute("color")?.itemSize == 4) {
	// 				let oldvalue = geo.getAttribute("color").array;
	// 				let arr = new Float32Array(oldvalue.length / 4 * 3);
	// 				for (let i = 0; i < oldvalue.length / 4; i++) {
	// 					arr[i * 3 + 0] = oldvalue[i * 4 + 0];
	// 					arr[i * 3 + 1] = oldvalue[i * 4 + 1];
	// 					arr[i * 3 + 2] = oldvalue[i * 4 + 2];
	// 				}
	// 				geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
	// 			}
	// 			//non indexed geometries are bugged...
	// 			if (!geo.index) {
	// 				let index = new Uint32Array(geo.getAttribute("position").count);
	// 				for (let i = 0; i < index.length; i++) {
	// 					index[i] = i;
	// 				}
	// 				geo.index = new THREE.BufferAttribute(index, 1);
	// 			}
	// 			mat.needsUpdate = true;
	// 		}
	// 	})
	// 	renderer.setSize(this.canvas.width, this.canvas.height);
	// 	renderer.setPrecision(3);
	// 	renderer.setClearColor(new THREE.Color(0, 0, 0), 255);
	// 	renderer.render(this.scene, this.camera);
	// 	return renderer.domElement;
	// }

	@boundMethod
	render(cam: THREE.Camera = this.camera) {
		cancelAnimationFrame(this.queuedFrameId);
		this.queuedFrameId = 0;

		let delta = this.clock.getDelta();
		delta *= (globalThis.speed ?? 100) / 100;//TODO remove
		this.animationMixers.forEach(q => q.update(delta));

		if (cam == this.camera && this.resizeRendererToDisplaySize()) {
			const canvas = this.renderer.domElement;
			this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
			this.camera.updateProjectionMatrix();
		}

		this.renderer.clearColor();
		this.renderer.clearDepth();
		if (!globalThis.vr360) {
			if (cam == this.camera && this.skybox) {
				this.skybox.camera.matrixAutoUpdate = false;
				this.camera.updateWorldMatrix(true, true);
				this.skybox.camera.matrix.copy(this.camera.matrixWorld);
				this.skybox.camera.matrix.setPosition(0, 0, 0);
				this.skybox.camera.projectionMatrix.copy(this.camera.projectionMatrix);
				this.renderer.render(this.skybox.scene, this.skybox.camera);
				this.renderer.clearDepth();
			}
			this.renderer.render(this.scene, cam);
			this.contextLossCountLastRender = this.contextLossCount;
		} else {
			if (!this.vr360cam) {
				this.vr360cam = new VR360Render(this.renderer, 512, 0.1, 1000);
				this.camera.add(this.vr360cam.cubeCamera);
				globalThis.cube = this.vr360cam.cubeCamera;
			}
			this.renderCube(this.vr360cam);
			this.vr360cam.render(this.renderer);
		}
		if (this.automaticFrames) {
			this.forceFrame();
		}
	}

	renderCube(render: VR360Render) {
		render.cubeRenderTarget.clear(this.renderer, true, true, false);
		if (this.skybox) {
			render.skyCubeCamera.matrixAutoUpdate = false;
			render.cubeCamera.updateWorldMatrix(true, true);
			render.skyCubeCamera.matrix.copy(render.cubeCamera.matrixWorld);
			render.skyCubeCamera.matrix.setPosition(0, 0, 0);
			render.skyCubeCamera.updateMatrixWorld(true);
			render.skyCubeCamera.update(this.renderer, this.skybox.scene);
			render.cubeRenderTarget.clear(this.renderer, false, true, false);
		}
		render.cubeCamera.update(this.renderer, this.scene);
	}

	@boundMethod
	forceFrame() {
		if (!this.queuedFrameId) {
			this.queuedFrameId = requestAnimationFrame(() => this.render());
		}
	}

	async takePicture(x: number, z: number, ntiles: number, pxpertile = 32, dxdy: number, dzdy: number) {
		let framesize = ntiles * pxpertile;
		let scale = 2 / ntiles;
		let cam = new THREE.Camera();
		cam.projectionMatrix.elements = [
			scale, scale * dxdy, 0, -x * scale - 1,
			0, scale * dzdy, -scale, -z * scale - 1,
			0, -0.001, 0, 0,
			0, 0, 0, 1
		];
		this.renderer.setSize(framesize, framesize);
		cam.projectionMatrix.transpose();
		cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
		for (let retry = 0; retry < 5; retry++) {
			await this.guaranteeRender(cam);
			let ctx = this.renderer.getContext();
			let pixelbuffer = new Uint8Array(ctx.canvas.width * ctx.canvas.height * 4);
			ctx.readPixels(0, 0, ctx.canvas.width, ctx.canvas.height, ctx.RGBA, ctx.UNSIGNED_BYTE, pixelbuffer);
			// img = await new Promise<Blob | null>(resolve => this.canvas.toBlob(resolve, "image/png"));
			if (this.contextLossCountLastRender != this.contextLossCount) {
				console.log("context loss during capture");
				continue;
			}
			let r: FlatImageData = { data: pixelbuffer, width: ctx.canvas.width, height: ctx.canvas.height, channels: 4 };
			return r;
			// break;
		}
		throw new Error("capture failed");
		// if (!img) { throw new Error("capture failed"); }
		// return new Uint8Array(await img.arrayBuffer());
	}

	// async parseGltfFile(modelfile: Uint8Array) {

	// 	//Threejs expects a raw memory slice (ArrayBuffer), however most nodejs api's use a view into
	// 	//such slice (TypedArray). some node modules go as far as reusing these and combining the raw buffers
	// 	//and returning only a correct view into a large slice if this is the case we have to copy it to a new
	// 	//slice to guarantee no other junk is in the same slice
	// 	let modelbuffer: ArrayBuffer;
	// 	if (modelfile.byteOffset != 0 || modelfile.byteLength != modelfile.buffer.byteLength) {
	// 		modelbuffer = Uint8Array.prototype.slice.call(modelfile).buffer;
	// 	} else {
	// 		modelbuffer = modelfile.buffer;
	// 	}

	// 	const loader = new GLTFLoader();

	// 	let model = await new Promise<GLTF>((d, e) => loader.parse(modelbuffer, "", d, e));

	// 	//use faster materials
	// 	let rootnode = model.scene;
	// 	rootnode.traverse(node => {
	// 		node.matrixAutoUpdate = false;
	// 		node.updateMatrix();
	// 		if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial) {
	// 			let floortex = node.userData.gltfExtensions?.RA_FLOORTEX;
	// 			let mat = new THREE.MeshPhongMaterial();
	// 			if (floortex) {
	// 				augmentThreeJsFloorMaterial(mat);
	// 			}
	// 			mat.map = node.material.map;
	// 			mat.vertexColors = node.material.vertexColors;
	// 			mat.transparent = node.material.transparent;
	// 			mat.alphaTest = 0.1;
	// 			mat.shininess = 0;
	// 			mat.userData = node.material.userData;
	// 			// mat.flatShading = true;//TODO remove
	// 			node.material = mat;
	// 		}
	// 	});
	// 	return { rootnode };
	// }

	setCameraLimits() {
		// compute the box that contains all the stuff
		// from root and below
		const box = new THREE.Box3().setFromObject(this.modelnode);
		const boxSize = box.getSize(new THREE.Vector3()).length();
		const boxCenter = box.getCenter(new THREE.Vector3());

		// update the Trackball controls to handle the new size
		this.controls.maxDistance = Math.min(500, boxSize * 10 + 10);
		this.controls.target.copy(boxCenter);
		this.controls.update();
		this.controls.screenSpacePanning = true;

		this.floormesh.position.setY(Math.min(0, box.min.y - 0.005));
	}

	@boundMethod
	async click(e: React.MouseEvent | MouseEvent) {
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
			this.emit("select", { obj, meshdata, match, vertexgroups: matches });
			return;
		}

		this.emit("select", null);
	}

	toggleFloorMesh(val?: boolean) {
		if (val === undefined) {
			this.floormesh.visible = !this.floormesh.visible;
		} else {
			this.floormesh.visible = val;
		}
		this.forceFrame();
	}

	saveImage() {
		if (this.canvas) {
			this.canvas.toBlob((blob) => {
				if (blob === null ) {
					return;
				}
				blob.arrayBuffer().then((ab) => {
					sharp(Buffer.from(ab)).trim().toBuffer((e,d,i) => {
						let url = URL.createObjectURL(
							new Blob([d], { type: 'image/png' })
						);
						//URL.revokeObjectURL(url);

						const link = document.createElement('a');
						link.href = url;
						link.setAttribute(
							'download',
							localStorage.rsmv_lastsearch + '.png',
						);

						// Append to html link element page
						document.body.appendChild(link);

						// Start download
						link.click();

						// Clean up and remove the link
						link.parentNode!.removeChild(link);
					});
				});
			});
		}
	}
}

export async function saveGltf(node: THREE.Object3D) {
	let savehandle = await showSaveFilePicker({
		//@ts-ignore
		id: "savegltf",
		startIn: "downloads",
		suggestedName: "model.glb",
		types: [
			{ description: 'GLTF model', accept: { 'application/gltf': ['.glb', '.gltf'] } },
		]
	});
	let modelexprt = await exportThreeJsGltf(node);
	let str = await savehandle.createWritable();
	await str.write(modelexprt);
	await str.close();
}

export function exportThreeJsGltf(node: THREE.Object3D) {
	return new Promise<Buffer>(resolve => {
		let exporter = new GLTFExporter();
		exporter.parse(node, gltf => resolve(gltf as any), {
			binary: true,
			embedImages: true,
			animations: node.animations
		});
	});
}

export function highlightModelGroup(vertexgroups: { start: number, end: number, mesh: THREE.Mesh }[]) {

	//update the affected meshes
	let undos: (() => void)[] = [];
	for (let submatch of vertexgroups) {
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
		color.needsUpdate = true;
		if (usecolor) { usecolor.needsUpdate = true; }
	}
	return undos;
}
