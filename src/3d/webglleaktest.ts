import { dumpTexture } from "../imgutils";
import { delay } from "../utils";

//copied from lib.es5, not sure why vscode understands but webpack doesn't
interface WeakKeyTypes { object: object; }
type WeakKey = WeakKeyTypes[keyof WeakKeyTypes];

class IterableWeakMap<K extends WeakKey, V> {
	weakMap = new WeakMap<K, { value: V, ref: WeakRef<K> }>();
	refSet = new Set<WeakRef<K>>();
	finalizationGroup = new FinalizationRegistry(IterableWeakMap.cleanup);

	static cleanup({ set, ref }) {
		set.delete(ref);
	}

	constructor() {
	}

	set(key: K, value: V) {
		const ref = new WeakRef(key);
		let prev = this.weakMap.get(key);
		if (prev) { this.refSet.delete(prev.ref); }
		this.weakMap.set(key, { value, ref });
		this.refSet.add(ref);
		this.finalizationGroup.register(key, {
			set: this.refSet,
			ref
		}, ref);
	}

	get(key: K) {
		const entry = this.weakMap.get(key);
		return entry && entry.value;
	}

	delete(key: K) {
		const entry = this.weakMap.get(key);
		if (!entry) {
			return false;
		}

		this.weakMap.delete(key);
		this.refSet.delete(entry.ref);
		this.finalizationGroup.unregister(entry.ref);
		return true;
	}

	*[Symbol.iterator]() {
		for (const ref of this.refSet) {
			const key = ref.deref();
			if (!key) continue;
			const { value } = this.weakMap.get(key)!;
			yield [key, value] as [K, V];
		}
	}

	entries() {
		return this[Symbol.iterator]();
	}

	*keys() {
		for (const [key, value] of this) {
			yield key;
		}
	}

	*values() {
		for (const [key, value] of this) {
			yield value;
		}
	}
}

export function hookgltextures() {
	console.log("hooking global gl texture code, this should be turned off in production!");

	let texes = new IterableWeakMap<WebGLTexture, WebGL2RenderingContext>();
	let oldbind = WebGL2RenderingContext.prototype.bindTexture;
	WebGL2RenderingContext.prototype.bindTexture = function (target, tex) {
		if (tex) { texes.set(tex, this); }
		oldbind.call(this, target, tex);
	}
	function texlist() {
		return [...texes];
	}

	let drawtex: HTMLElement[] = [];
	function alltex(size = 64) {
		cleartex();
		let texes = texlist();
		let cols = Math.ceil(1000 / size);
		for (let [i, tex] of texes.entries()) {
			let v = dumptexx(tex, size, size);
			v.style.left = `${(i % cols) * size}px`;
			v.style.top = `${Math.floor(i / cols) * size}px`;
			drawtex.push(v);
		}
	}

	function cleartex() {
		drawtex.forEach(q => q.remove());
		drawtex.length = 0;
	}
	function dumptexx(tex: [WebGLTexture, WebGL2RenderingContext], width = 128, height = 128) {
		return dumpTexture(readTextureToImageData(tex[1], tex[0], width, height));
	}
	globalThis.texlist = texlist;
	globalThis.dumptexx = dumptexx;
	globalThis.alltex = alltex;
	globalThis.cleartex = cleartex;

	function readTextureToImageData(gl: WebGL2RenderingContext, texture: WebGLTexture, width: number, height: number) {
		let boundFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
		let boundTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);

		// Get the texture size
		var level = 0;
		// var width = 128;//gl.getTexParameter(gl.TEXTURE_2D, level, gl.);
		// var height = 128;//gl.getTexParameter(gl.TEXTURE_2D, level, gl.TEXTURE_HEIGHT);

		// Create a framebuffer
		var framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

		// Attach the texture to the framebuffer
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, level);

		// Read pixels from the framebuffer
		var pixels = new Uint8Array(width * height * 4); // 4 channels (RGBA)
		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

		// Restore the initial WebGL state
		gl.bindFramebuffer(gl.FRAMEBUFFER, boundFramebuffer);
		gl.bindTexture(gl.TEXTURE_2D, boundTexture);

		// Cleanup
		gl.deleteFramebuffer(framebuffer);

		// Create ImageData from the pixels
		var imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);

		return imageData;
	}
}

export function createGCTracker<T extends object>(changecb: () => void) {
	let inv = new Map<number, WeakRef<T>>();
	let map = new WeakMap<T, number>();
	let idcount = 0;

	let deleteid = (id: number) => {
		inv.delete(id);
		changecb();
	}

	let notifier = new FinalizationRegistry<number>(deleteid);
	let add = (obj: T) => {
		let id = idcount++;
		inv.set(id, new WeakRef(obj));
		notifier.register(obj, id);
		map.set(obj, id);
		changecb();
	}
	let remove = (obj: T) => {
		deleteid(map.get(obj)!);
	}

	let checkempty = async () => {
		if (!globalThis.gc) {
			console.warn("can't ensure that GC has ran since the last reference was lost since GC is not exposed in v8");
		} else {
			globalThis.gc?.();
			//ensure that we are on a new call stack
			await delay(100);
		}
		for (let entry of inv.values()) {
			if (entry.deref()) {
				return false;
			}
		}
		return true;
	}

	return { add, remove, checkempty, inv };
}



export function registerWebglTracker() {
	console.warn("tracking webgl resource usage");

	let actioncount = 0;
	let lastprint = 0;
	function anyaction() {
		actioncount++;
		if (actioncount % 20 == 0) {
			printstats();
		}
	}
	let printstats = function () {
		if (Date.now() < lastprint + 1000) { return; }
		lastprint = Date.now();
		console.log("textures", texs.inv.size, "buffers", bufs.inv.size, "varrays", varrays.inv.size);
	}

	let texs = createGCTracker<WebGLTexture>(anyaction);
	let bufs = createGCTracker<WebGLBuffer>(anyaction);
	let varrays = createGCTracker<WebGLVertexArrayObject>(anyaction);

	let createTextureOld = WebGL2RenderingContext.prototype.createTexture;
	WebGL2RenderingContext.prototype.createTexture = function (this: WebGL2RenderingContext) {
		let tex = createTextureOld.call(this);
		texs.add(tex);
		return tex;
	}
	let deleteTextureOld = WebGL2RenderingContext.prototype.deleteTexture;
	WebGL2RenderingContext.prototype.deleteTexture = function (this: WebGL2RenderingContext, tex: WebGLTexture | null) {
		deleteTextureOld.call(this, tex);
		if (tex) { texs.remove(tex); }
	}


	let createBufferOld = WebGL2RenderingContext.prototype.createBuffer;
	WebGL2RenderingContext.prototype.createBuffer = function (this: WebGL2RenderingContext) {
		let buf = createBufferOld.call(this);
		bufs.add(buf);
		return buf;
	}
	let deleteBufferOld = WebGL2RenderingContext.prototype.deleteBuffer;
	WebGL2RenderingContext.prototype.deleteBuffer = function (this: WebGL2RenderingContext, buf: WebGLBuffer | null) {
		deleteBufferOld.call(this, buf);
		if (buf) { bufs.remove(buf); }
	}

	let createVertexArrayOld = WebGL2RenderingContext.prototype.createVertexArray;
	WebGL2RenderingContext.prototype.createVertexArray = function (this: WebGL2RenderingContext) {
		let varray = createVertexArrayOld.call(this);
		varrays.add(varray);
		return varray;
	}
	let deleteVertexArrayOld = WebGL2RenderingContext.prototype.deleteVertexArray;
	WebGL2RenderingContext.prototype.deleteVertexArray = function (this: WebGL2RenderingContext, varray: WebGLVertexArrayObject | null) {
		deleteVertexArrayOld.call(this, varray);
		if (varray) { varrays.remove(varray); }
	}

	return { printstats };
}