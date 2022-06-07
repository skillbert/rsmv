import { BufferGeometry, Camera, CubeCamera, DoubleSide, LinearFilter, Mesh, OrthographicCamera, PlaneBufferGeometry, RawShaderMaterial, Renderer, RGBAFormat, RGBFormat, Scene, WebGLCubeRenderTarget, WebGLRenderer } from "three";

class EquirectangularMaterial extends RawShaderMaterial {
	transparent = true;
	constructor() {
		super({
			//TODO check if typings are wrong here
			//@ts-ignore
			uniforms: { map: { type: 't', value: null } },
			vertexShader: `
				attribute vec3 position;
				varying vec2 vUv;
				void main()  {
					vUv = vec2(position.x,position.y);
					gl_Position = vec4(position, 1.0);
				}`,
			fragmentShader: `
				precision mediump float;
				uniform samplerCube map;
				varying vec2 vUv;
				#define M_PI 3.1415926535897932384626433832795
				void main() {
					float longitude = vUv.x * M_PI;
					float latitude = vUv.y * 0.5 * M_PI;
					vec3 dir = vec3(sin(longitude) * cos(latitude), sin(latitude), -cos(longitude) * cos(latitude));
					normalize(dir);
					gl_FragColor = textureCube(map, dir);
				}`,
			side: DoubleSide,
			transparent: true
		})
	}
}

export class VR360Render {
	cubeRenderTarget: WebGLCubeRenderTarget;
	cubeCamera: CubeCamera;
	skyCubeCamera: CubeCamera;
	quad: Mesh<BufferGeometry, EquirectangularMaterial>;
	projectCamera: Camera;
	size: number;

	constructor(parent: WebGLRenderer, size: number, near: number, far: number) {
		this.size = size;
		this.cubeRenderTarget = new WebGLCubeRenderTarget(size, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			format: RGBAFormat,
			encoding: parent.outputEncoding
		})
		this.cubeCamera = new CubeCamera(near, far, this.cubeRenderTarget);
		this.skyCubeCamera = new CubeCamera(near, far, this.cubeRenderTarget);
		this.quad = new Mesh(new PlaneBufferGeometry(2, 2), new EquirectangularMaterial());
		this.quad.frustumCulled = false;
		this.projectCamera = new Camera();
	}

	render(renderer: WebGLRenderer) {
		this.quad.material.uniforms.map.value = this.cubeCamera.renderTarget.texture;
		renderer.setSize(this.size * 2, this.size);
		renderer.render(this.quad, this.projectCamera);
	}
}

