//copy-paste fork of other project, probably releasing this as separate package at some point


type ViewerImageSource = string | TexImageSource | ImageData;

export default class VR360Viewer {
	tex: WebGLTexture | null = null;
	cam = {
		long: 0,
		lat: 0,
		longv: 0,
		latv: 0,
		lastUpdate: 0,
		zoom: 0.6,
		dragging: false
	};
	dragspeed = 0.1 * Math.PI / 180;//deg per pixel

	pendingFrame = 0;
	plane: WebGLBuffer;
	cnv: HTMLCanvasElement;
	gl: WebGL2RenderingContext;
	prog: ReturnType<typeof makeProgram>;
	constructor(imgsrc?: ViewerImageSource) {
		this.cnv = document.createElement("canvas");
		this.cnv.style.position = "absolute";
		this.cnv.style.left = "0";
		this.cnv.style.top = "0";
		this.cnv.style.width = "100%";
		this.cnv.style.height = "100%";
		this.gl = this.cnv.getContext("webgl2")!;
		this.plane = createPlane(this.gl);
		this.prog = makeProgram(this.gl);

		this.cnv.addEventListener("mousedown", this.onMouseDown);
		this.cnv.addEventListener("touchstart", this.onMouseDown);
		this.cnv.addEventListener("wheel", this.onScroll);

		if (imgsrc) {
			this.setImage(imgsrc);
		}
	}

	updateZoom(dz: number) {
		this.cam.zoom = Math.max(0.45, Math.min(1.5, this.cam.zoom + dz));
		this.draw();
	}

	onScroll = (e: WheelEvent) => {
		this.updateZoom(-e.deltaY / 350);
		e.preventDefault();
	}

	onMouseDown = (e: MouseEvent | TouchEvent) => {
		let lastx: number
		let lasty: number;
		let lasttouchgap = -1;
		let averageTouches = (touches: TouchList): [number, number] => {
			let x = 0;
			let y = 0;
			for (let i = 0; i < touches.length; i++) {
				x += touches[i].screenX;
				y += touches[i].screenY;
			}
			return [x / touches.length, y / touches.length];
		}
		if (e instanceof TouchEvent) {
			if (e.touches.length > 1) { return; }
			[lastx, lasty] = averageTouches(e.touches);
		} else {
			lastx = e.screenX;
			lasty = e.screenY;
		}
		let lasttime = performance.now();
		this.cam.dragging = true;
		let update = (screenx: number, screeny: number) => {
			//update long/lat
			let newlong = this.cam.long - (screenx - lastx) * this.dragspeed / this.cam.zoom;
			let newlat = this.cam.lat + (screeny - lasty) * this.dragspeed / this.cam.zoom;

			//update velocity
			let time = performance.now();
			let delta = Math.max(1, time - lasttime);
			let newweight = Math.min(1, delta / 140);
			let oldweight = 1 - newweight;
			this.cam.latv = oldweight * this.cam.latv + newweight * (newlat - this.cam.lat) / delta;
			this.cam.longv = oldweight * this.cam.longv + newweight * (newlong - this.cam.long) / delta;

			//write changes
			this.cam.lat = newlat;
			this.cam.long = newlong;
			this.boundCamera();
			lastx = screenx;
			lasty = screeny;
			lasttime = time;

			this.draw();
		}
		let move = (e2: MouseEvent) => {
			update(e2.screenX, e2.screenY);
		}
		let touchmove = (e2: TouchEvent) => {
			if (e2.touches.length >= 1) {
				update(...averageTouches(e2.touches));
			}
			if (e2.touches.length >= 2) {
				let t1 = e2.touches[0];
				let t2 = e2.touches[1];
				let gap = Math.hypot(t1.screenX - t2.screenX, t1.screenY - t2.screenY);
				if (lasttouchgap > 0) { this.updateZoom((gap - lasttouchgap) / 100); }
				lasttouchgap = gap;
			}
		}
		let end = (e2: MouseEvent) => {
			update(e2.screenX, e2.screenY);
			endlisteners();
		}
		let touchend = (e2: TouchEvent) => {
			lasttouchgap = -1;
			if (e2.touches.length == 0) {
				endlisteners();
			} else {
				[lastx, lasty] = averageTouches(e2.touches);
			}
		}
		let touchstart = (e2: TouchEvent) => {
			[lastx, lasty] = averageTouches(e2.touches);
		}
		let endlisteners = () => {
			this.cam.dragging = false;
			this.cam.lastUpdate = performance.now();
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", end);
			window.removeEventListener("touchmove", touchmove);
			window.removeEventListener("touchend", touchend);
			window.removeEventListener("touchstart", touchstart);
		}

		window.addEventListener("mouseup", end);
		window.addEventListener("mousemove", move);
		window.addEventListener("touchmove", touchmove);
		window.addEventListener("touchend", touchend);
		window.addEventListener("touchstart", touchstart);
		e.preventDefault();
	}

	free() {
		this.cnv.removeEventListener("mousedown", this.onMouseDown);
		this.cnv.removeEventListener("touchstart", this.onMouseDown);
		this.cnv.removeEventListener("wheel", this.onScroll);
	}

	forceFrame() {
		if (!this.pendingFrame) {
			this.pendingFrame = requestAnimationFrame(this.draw);
		}
	}

	boundCamera() {
		this.cam.lat = Math.max(-Math.PI * 0.6, Math.min(Math.PI * 0.6, this.cam.lat));
	}

	animateCamera() {
		let time = performance.now();
		let delta = Math.max(1, time - this.cam.lastUpdate);
		if (!this.cam.dragging) {
			this.cam.lat += this.cam.latv * delta;
			this.cam.long += this.cam.longv * delta;
		}
		let vmag = Math.hypot(this.cam.latv, this.cam.longv);
		if (vmag != 0) {
			let latdir = this.cam.latv / vmag;
			let longdir = this.cam.longv / vmag;
			vmag *= Math.pow(0.5, delta / 200);//200ms halftime
			vmag -= 0.000001 * delta;
			if (vmag < 0.00001) { vmag = 0; }
			this.cam.latv = latdir * vmag;
			this.cam.longv = longdir * vmag;
			this.boundCamera();
		}

		this.cam.lastUpdate = time;
	}



	async setImage(src: ViewerImageSource) {
		let oldtex = this.tex;
		this.tex = await createTexture(this.gl, src);
		if (oldtex) { this.gl.deleteTexture(oldtex); }
		this.forceFrame();
	}

	draw = () => {
		if (this.pendingFrame) {
			cancelAnimationFrame(this.pendingFrame);
			this.pendingFrame = 0;
		}
		this.animateCamera();
		const gl = this.gl;
		const prog = this.prog;

		let newwidth = (gl.canvas as HTMLCanvasElement).clientWidth;
		let newheight = (gl.canvas as HTMLCanvasElement).clientHeight;
		if (gl.canvas.width != newwidth || gl.canvas.height != newheight) {
			//only update if changed since calling the setters has special behavior
			gl.canvas.width = newwidth;
			gl.canvas.height = newheight;
			gl.viewport(0, 0, newwidth, newheight);
		}

		gl.useProgram(prog.prog);

		//select our plane mesh
		gl.bindBuffer(gl.ARRAY_BUFFER, this.plane);
		gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 12, 0);
		gl.enableVertexAttribArray(prog.aPos);

		//select texture
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.tex);

		const c1 = Math.cos(this.cam.long);
		const s1 = Math.sin(this.cam.long);
		const c2 = Math.cos(this.cam.lat);
		const s2 = Math.sin(this.cam.lat);
		const xfactor = gl.canvas.width;
		const yfactor = gl.canvas.height;
		const zfactor = this.cam.zoom * Math.hypot(xfactor, yfactor);
		//matrix=roty(long)*rotx(lat)*diag(x,y,z)
		let matrix = [
			xfactor * c1, yfactor * -s1 * s2, zfactor * s1 * c2,
			xfactor * 0, yfactor * c2, zfactor * s2,
			xfactor * -s1, yfactor * -c1 * s2, zfactor * c1 * c2
		];

		//config 
		gl.uniformMatrix3fv(prog.uViewmatrix, true, matrix);
		gl.uniform1i(prog.uMap, 0);

		//draw
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		if (this.cam.latv != 0 || this.cam.longv != 0) {
			this.forceFrame();
		}
	}
}

function createPlane(gl: WebGL2RenderingContext) {
	let vertex = gl.createBuffer()!;
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, 1, 1, 0, -1, 1, 0, -1, -1, 0]), gl.STATIC_DRAW);
	return vertex;
}

async function createTexture(gl: WebGL2RenderingContext, src: string | TexImageSource | ImageData) {
	let img: TexImageSource;
	let flip: boolean;
	if (typeof src == "string") {
		img = new Image();
		img.src = src;
		await img.decode();
		flip = true;
	} else if (src instanceof ImageData) {
		img = await createImageBitmap(src);
		flip = false;
	} else {
		img = src;
		flip = true;
	}

	let tex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

	//disable all the wrapping/mipping because we might not have power of 2 texture
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return tex;
}

function makeProgram(gl: WebGL2RenderingContext) {
	let prog = gl.createProgram()!;
	let vertex = loadShader(gl, gl.VERTEX_SHADER, `
		attribute vec3 position;
		varying vec2 vUv;
		void main()  {
			vUv = vec2(position.x,position.y);
			gl_Position = vec4(position, 1.0);
		}`
	);
	let fragment = loadShader(gl, gl.FRAGMENT_SHADER, `
		precision mediump float;
		uniform sampler2D map;
		uniform mat3 viewmatrix;
		varying vec2 vUv;
		#define M_PI 3.1415926535897932384626433832795
		void main() {
			vec3 norm=viewmatrix*vec3(vUv,1.0);
			norm=normalize(norm);
			float lat=asin(norm.y);
			float lon=atan(norm.x,norm.z);
			vec2 sample=vec2(lon/2.0/M_PI+0.5,lat/M_PI+0.5);
			gl_FragColor = texture2D(map,sample);
		}`
	);
	gl.attachShader(prog, vertex!);
	gl.attachShader(prog, fragment!);
	gl.linkProgram(prog);

	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		throw new Error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(prog));
	}

	let aPos = gl.getAttribLocation(prog, "position");
	let uViewmatrix = gl.getUniformLocation(prog, "viewmatrix");
	let uMap = gl.getUniformLocation(prog, "map");

	return { prog, aPos, uViewmatrix, uMap };
}

function loadShader(gl: WebGL2RenderingContext, type: GLenum, source: string) {
	const shader = gl.createShader(type)!;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);

	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		throw new Error("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader));
	}

	return shader;
}