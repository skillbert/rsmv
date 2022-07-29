import { delay } from "../utils";



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