//! Taken from runeapps avatar viewer server code
//start of edits made
import { TextEncoderPolyfill, ModelAttribute } from "./gltfutil";
//end of edits made




import * as GlTf from "./gltftype";


namespace GltfExt {
	export type MasterialTextureTransform = GlTf.Material & {
		extensions?: {
			KHR_texture_transform?: {
				offset: [number, number],
				rotation: number,
				scale: [number, number]
			}
		}
	}
}

export class GLTFBuilder {
	json: GlTf.GlTf = {
		asset: { version: "2.0", generator: "RuneApps model viewer" },
		scene: 0,
		scenes: [],
		nodes: [],
		skins: [],
		meshes: [],
		accessors: [],
		bufferViews: [],
		buffers: [],
		materials: [],
		images: [],
		textures: [],
		animations: [],
		samplers: []
	};
	rawviewbuffers: ArrayBufferView[] = [];
	rawimages: (ImageData | Uint8Array)[] = [];

	addBuffer(buf: GlTf.Buffer) { return this.json.buffers!.push(buf) - 1; }
	addBufferView(view: GlTf.BufferView) { return this.json.bufferViews!.push(view) - 1; }
	addAccessor(acc: GlTf.Accessor) { return this.json.accessors!.push(acc) - 1; }
	addMesh(mesh: GlTf.Mesh) { return this.json.meshes!.push(mesh) - 1; }
	addNode(node: GlTf.Node) { return this.json.nodes!.push(node) - 1; }
	addSkin(skin: GlTf.Skin) { return this.json.skins!.push(skin) - 1; }
	addMaterial(mat: GltfExt.MasterialTextureTransform) { return this.json.materials!.push(mat) - 1; }
	addTexture(tex: GlTf.Texture) { return this.json.textures!.push(tex) - 1; }
	addScene(scene: GlTf.Scene) { return this.json.scenes!.push(scene) - 1; }
	addAnimation(anim: GlTf.Animation) { return this.json.animations!.push(anim) - 1; }
	addSampler(sampler: GlTf.Sampler) { return this.json.samplers!.push(sampler) - 1; }

	addExtension(name: string, required: boolean) {
		if (!this.json.extensionsUsed) { this.json.extensionsUsed = []; }
		if (this.json.extensionsUsed.indexOf(name) == -1) { this.json.extensionsUsed.push(name); }
		if (required) {
			if (!this.json.extensionsRequired) { this.json.extensionsRequired = []; }
			if (this.json.extensionsRequired.indexOf(name) == -1) { this.json.extensionsRequired.push(name); }
		}
	}

	addAttributeAccessor(attr: ModelAttribute, view: number, count: number) {
		let r: GlTf.Accessor = {
			count: count,
			bufferView: view,
			min: attr.min,
			max: attr.max,
			componentType: attr.gltype,
			byteOffset: attr.byteoffset,
			type: ["", "SCALAR", "VEC2", "VEC3", "VEC4"][attr.veclength],
			normalized: attr.normalize
		}
		return this.addAccessor(r);
	}
	addBufferWithView(buf: ArrayBufferView, stride: number | undefined, isindices: boolean | undefined) {
		this.rawviewbuffers.push(buf);
		return this.addBufferView({ buffer: -1, byteLength: buf.byteLength, byteStride: stride, byteOffset: 0, target: (isindices === undefined ? undefined : isindices ? 0x8893 : 0x8892) });
	}
	addImage(img: ImageData | Uint8Array) {
		let imgindex = this.rawimages.findIndex(i => i == img);
		if (imgindex != -1) {
			return imgindex;
		}
		imgindex = this.json.images!.push({}) - 1;
		this.rawimages[imgindex] = img;
		return imgindex
	}
	addImageWithTexture(img: ImageData | Uint8Array, sampler?: number) {
		return this.addTexture({ source: this.addImage(img), sampler: sampler });
	}


	async convert(options?: { singlefile?: boolean, baseurl?: string, glb?: boolean, imgmimetype?: "image/png" | "image/webp" } | undefined) {
		let baseurl = options?.baseurl ?? "";
		let mergebuffers = !!options?.glb;
		let inlinedata = !!options?.singlefile;
		let json = this.json;
		const imgmimetype = options?.imgmimetype ?? "image/png";

		if (imgmimetype as string == "image/webp") {
			this.addExtension("EXT_texture_webp", true);
			json.textures!.forEach(tex => {
				tex.extensions = { EXT_texture_webp: { source: tex.source } }
				// tex.source = undefined;
			});
		}

		let files: { [id: string]: ArrayBufferView } = {};
		if (json.animations!.length == 0) { delete json.animations; }
		if (json.skins!.length == 0) { delete json.skins; }
		for (let i in json.images!) {
			let img = json.images![i];
			let imgdata = this.rawimages[i];
			let imgfile = imgdata instanceof Uint8Array ? imgdata : await imgdata.toFileBytes(imgmimetype);
			if (mergebuffers) {
				img.bufferView = this.addBufferWithView(imgfile, undefined, undefined);
				img.mimeType = imgmimetype;
			} else if (inlinedata) {
				img.uri = "data:" + imgmimetype + ";base64," + Buffer.from(imgfile).toString("base64");
			} else {
				let name = `${baseurl}img-${i}.${imgmimetype.match(/^image\/(\w+)$/)![1]}`;
				files[name] = imgfile;
			}
		}
		var buffers: ArrayBufferView[] = [];
		for (let i in json.bufferViews!) {
			let view = json.bufferViews![i];
			let buf = this.rawviewbuffers[i];
			let bufferindex = buffers.findIndex(b => b == buf);
			if (bufferindex == -1) { bufferindex = buffers.push(buf) - 1; }
			if (mergebuffers) {
				view.buffer = 0;
				let offset = 0;
				for (let j = 0; j < bufferindex; j++) { offset += align4bytes(buffers[j].byteLength); }
				view.byteOffset = (view.byteOffset ?? 0) + offset;
			} else {
				view.buffer = bufferindex;
			}
		}
		if (!mergebuffers) {
			for (let i = 0; i < buffers.length; i++) {
				let url = "";
				if (inlinedata) {
					url = await bufferToDataUrl(buffers[i]);
				}
				else {
					let url = `${baseurl}data-${i}.bin`;
					files[url] = buffers[i];
				}
				this.addBuffer({ byteLength: buffers[i].byteLength, uri: url });
			}
		}
		if (json.textures?.length == 0) { delete json.textures }
		if (json.images?.length == 0) { delete json.images; }


		let mainfile: Uint8Array;

		if (mergebuffers) {
			let datasize = align4bytes(buffers.reduce((s, b) => s + align4bytes(b.byteLength), 0));
			this.addBuffer({ byteLength: datasize });
			let jsonfile = new TextEncoderPolyfill().encode(JSON.stringify(json));
			let jsonsize = align4bytes(jsonfile.byteLength);
			let totsize = 12 + 8 + jsonsize + 8 + datasize;
			let fullbuf = new Uint8Array(totsize);
			let uintbuf = new Uint32Array(fullbuf.buffer);
			uintbuf[0] = 0x46546C67;//magic "glTF";
			uintbuf[1] = 2;//gltf version
			uintbuf[2] = totsize;
			let offset = 12;

			//write json chunk
			uintbuf[offset / 4 | 0] = jsonsize;
			offset += 4;
			uintbuf[offset / 4 | 0] = 0x4E4F534A;//"JSON" chunk
			offset += 4;
			fullbuf.set(jsonfile, offset);
			offset += jsonfile.byteLength;
			for (let pad = jsonsize - jsonfile.byteLength; pad > 0; pad--) {
				fullbuf[offset] = 0x20;//pad with space
				offset++;
			}

			//write binary chunk
			uintbuf[offset / 4 | 0] = datasize;
			offset += 4;
			uintbuf[offset / 4 | 0] = 0x004E4942;//"BIN\0" chunk
			offset += 4;
			for (let i = 0; i < buffers.length; i++) {
				fullbuf.set(new Uint8Array(buffers[i].buffer, buffers[i].byteOffset, buffers[i].byteLength), offset);
				offset += align4bytes(buffers[i].byteLength);
			}
			files["model.glb"] = fullbuf;
			mainfile = fullbuf;
		} else {
			mainfile = new TextEncoderPolyfill().encode(JSON.stringify(json, undefined, "\t"));;
			files["model.gltf"] = mainfile;
		}

		return { json, files, mainfile };
	}
}

function align4bytes(len: number) {
	return Math.ceil(len / 4) * 4;
}

function bufferToDataUrl(buf: ArrayBufferView, mime = "application/octet-stream"): Promise<string> {
	if (typeof Buffer != "undefined") {
		return Promise.resolve("data:" + mime + ";base64," + Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString("base64"));
	}
	return new Promise((done, err) => {
		let reader = new FileReader();
		reader.onload = () => done(reader.result as string);
		reader.onerror = err;
		reader.readAsDataURL(new Blob([buf], { type: mime }));
	});
}
