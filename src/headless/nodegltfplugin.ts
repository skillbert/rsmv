import { PixelFormat } from "three";
import { GLTFExporter, GLTFWriter, GLTFExporterPlugin, GLTFExporterOptions } from "three/examples/jsm/exporters/GLTFExporter";

import sharp from "sharp";
import type { Canvas } from "canvas";

type BlobpartPoly = ArrayBufferView | ArrayBuffer | string | BlobPoly;

class BlobPoly {
	chunks: BlobpartPoly[];
	size = 0;
	type: string;
	constructor(chunks: BlobpartPoly[], options?: BlobPropertyBag) {
		this.chunks = chunks;
		this.type = options?.type ?? "";
	}
	async arrayBuffer() {
		return this._arrayBuffer();
	}
	_arrayBuffer() {
		return Buffer.concat(this.chunks.map(q => {
			if (typeof q == "string") { q = Buffer.from(q, "utf8"); }
			if (q instanceof BlobPoly) { return q._arrayBuffer(); }
			if (q instanceof ArrayBuffer) { return new Uint8Array(q); }
			return new Uint8Array(q.buffer, q.byteOffset, q.byteLength);
		}));
	}
	slice() {
		throw new Error();
	}
	stream() {
		throw new Error();
	}
}

class FileReaderPoly {
	result: any = null;
	readAsArrayBuffer(blob: BlobPoly) {
		setImmediate(() => {
			this.result = blob._arrayBuffer();
			this.onloadend?.(this.result);
		})
	}
	onloadend: Function | undefined = undefined;
}


export function polyfillNode() {
	globalThis.Blob ??= BlobPoly as any;
	globalThis.FileReader ??= FileReaderPoly as any;


	const nodecanvas = __non_webpack_require__("canvas") as typeof import("canvas");

	globalThis.ImageData ??= nodecanvas.ImageData;

	(nodecanvas.Canvas.prototype as any).toBlob = function (this: Canvas, cb: (blob: Blob) => void, format: "image/png" = "image/png", quality = 0.9) {
		this.toBuffer((err, buf) => {
			if (err) {
				console.error(err);
				return;
			}
			cb(new BlobPoly([buf], { type: format }) as any);
		}, format);
	}


	//@ts-ignore
	// GLTFWriter.prototype.processImage = processImage;
	// Patch global scope to imitate browser environment.

	if (typeof globalThis.document == "undefined") {
		globalThis.document = {} as any;
	}
	if (typeof document.createElement == "undefined") {
		document.createElement = (nodeName: string) => {
			if (nodeName !== 'canvas') throw new Error(`Cannot create node ${nodeName}`);
			const canvas = new nodecanvas.Canvas(256, 256);
			// This isn't working — currently need to avoid toBlob(), so export to embedded .gltf not .glb.
			// canvas.toBlob = function () {
			//   return new Blob([this.toBuffer()]);
			// };
			return canvas as any;
		}
	};
}
// export function nodeGltfPlugin(writer: GLTFWriter): GLTFExporterPlugin {

// 	//@ts-ignore
// 	writer.processImage = processImage;

// 	return {
// 		beforeParse(input) {

// 		},
// 	}
// }

type WriterPrivate = {
	plugins: [];

	options: Required<GLTFExporterOptions>;
	pending: Promise<any>[];
	buffers: [];

	byteOffset: 0;
	nodeMap: Map<any, any>;
	skins: [];
	extensionsUsed: {};

	uids: Map<any, any>,
	uid: 0;

	json: Record<string, any>;

	cache: {
		meshes: Map<any, any>,
		attributes: Map<any, any>,
		attributesNormalized: Map<any, any>,
		materials: Map<any, any>,
		textures: Map<any, any>,
		images: Map<any, any>
	};

	processBufferViewImage(blob: Blob): Promise<number>;
}


/**
 * Process image
 * @param  {Image} image to process
 * @param  {Integer} format of the image (RGBAFormat)
 * @param  {Boolean} flipY before writing out the image
 * @param  {String} mimeType export format
 * @return {Integer}     Index of the processed texture in the "images" array
 */
function processImage(this: GLTFWriter & WriterPrivate, image: CanvasImageSource | ImageData, format: PixelFormat, flipY: boolean, mimeType = 'image/png') {

	const writer = this;
	const cache = writer.cache;
	const json = writer.json;
	const options = writer.options;
	const pending = writer.pending;

	if (!cache.images.has(image)) cache.images.set(image, {});

	const cachedImages = cache.images.get(image);

	const key = mimeType + ':flipY/' + flipY.toString();

	if (cachedImages[key] !== undefined) return cachedImages[key];

	if (!json.images) json.images = [];

	const imageDef = { mimeType: mimeType, bufferView: undefined! as number, url: undefined! as string };

	//@ts-ignore
	if (typeof image.data != "undefined") {
		let imgdata = image as ImageData;
		let img = sharp(imgdata.data, { raw: { width: imgdata.width, height: imgdata.height, channels: 4 } });
		pending.push(
			img.png().toBuffer().then(b => {
				if (options.binary) {
					return writer.processBufferViewImage(new Blob([b], { type: "image/png" }))
						.then(bufferViewIndex => {
							imageDef.bufferView = bufferViewIndex;
						});
				}
				else {
					imageDef.url = "data:image/png;base64," + b.toString("base64url");
				}
			})
		);
	} else {
		throw new Error("non imagedata texture not supported in nodejs");
	}

	const index = json.images.push(imageDef) - 1;
	cachedImages[key] = index;
	return index;

}

