import { BufferGeometry, Camera, CubeCamera, DoubleSide, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, RawShaderMaterial, Renderer, RGBAFormat, Scene, WebGLCubeRenderTarget, WebGLRenderer } from "three";

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
		let gl = parent.getContext();
		this.cubeRenderTarget = new WebGLCubeRenderTarget(size, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			format: RGBAFormat,
			colorSpace: parent.outputColorSpace,
			samples: 0//gl.getParameter(gl.SAMPLES)//three.js crashes if using multisampled here
		});
		//threejs always renders non-default render targets in linear, however they programmed in a 
		//special case for webxr render targets to still render in srgb
		//i'm guessing you would normally want your cubemaps to be linear for correct light calcs in reflection
		//but in this case the cube is the output
		//i could do this without hack by doing srgb in the fragment shader but that would result in big loss
		//of quality since we're in 8bit colors already
		(this.cubeRenderTarget as any).isXRRenderTarget = true;


		this.cubeCamera = new CubeCamera(near, far, this.cubeRenderTarget);
		this.skyCubeCamera = new CubeCamera(near, far, this.cubeRenderTarget);
		this.quad = new Mesh(new PlaneGeometry(2, 2), new EquirectangularMaterial());
		this.quad.frustumCulled = false;
		this.projectCamera = new Camera();
	}

	render(renderer: WebGLRenderer) {
		this.quad.material.uniforms.map.value = this.cubeCamera.renderTarget.texture;
		// renderer.setSize(this.size * 2, this.size);
		renderer.render(this.quad, this.projectCamera);
	}
}

