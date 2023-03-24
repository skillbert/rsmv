import { cacheMajors } from "../constants";
import * as cache from "./index";
import type { WorkerPackets } from "./sqlitewasmworker";


export class WasmGameCacheLoader extends cache.CacheFileSource {
	indices = new Map<number, Promise<cache.CacheIndexFile>>();
	dbfiles: Record<string, Blob> = {};
	worker: Worker;
	msgidcounter = 1;
	callbacks = new Map<number, { resolve: (res: any) => void, reject: (err: Error) => void, reqpacket: WorkerPackets }>();
	timestamp = new Date();
	constructor() {
		super();
		//@ts-ignore this whole line gets consumed by webpack, turns to static string in webpack
		this.worker = new Worker(new URL("./sqlitewasmworker.ts", import.meta.url));
		this.worker.onmessage = e => {
			let handler = this.callbacks.get(e.data.id);
			if (e.data.error) {
				if (handler) {
					let err = e.data.error;
					if (handler.reqpacket.type == "getfile") {
						err += `\n in getfile ${handler.reqpacket.major}.${handler.reqpacket.minor}`;
					} else if (handler.reqpacket.type == "getindex") {
						err += `\n in getindex ${handler.reqpacket.major}`;
					} else {
						err += `\n in other ${handler.reqpacket.type}`;
					}
					handler.reject(new Error(err));
				}
			} else {
				handler?.resolve(e.data.packet);
			}
			this.callbacks.delete(e.data.id);
		}
	}
	getCacheMeta() {
		return {
			name: `sqlitewasm`,
			descr: "Direclty loads NXT cache files from the disk, in browser compatible environment.",
			timestamp: this.timestamp
		}
	}

	async generateRootIndex() {
		console.log("using generated cache index file meta, crc size and version missing");

		let majors: cache.CacheIndex[] = [];
		for (let file of Object.keys(this.dbfiles)) {
			let m = file.match(/js5-(\d+)\.jcache$/);
			if (m) {
				majors[m[1]] = {
					major: cacheMajors.index,
					minor: +m[1],
					crc: 0,
					size: 0,
					subindexcount: 1,
					subindices: [0],
					version: 0,
					uncompressed_crc: 0,
					uncompressed_size: 0
				};
			}
		}

		return majors;
	}

	sendWorker(packet: WorkerPackets) {
		let id = this.msgidcounter++;
		this.worker.postMessage({ id, packet });
		return new Promise((resolve, reject) => this.callbacks.set(id, { resolve, reject, reqpacket: packet }));
	}

	giveBlobs(blobs: Record<string, Blob>) {
		Object.assign(this.dbfiles, blobs);
		this.sendWorker({ type: "blobs", blobs });
	}
	async giveFsDirectory(dir: FileSystemDirectoryHandle) {
		let files: Record<string, Blob> = {};
		if (await dir.queryPermission() != "granted") {
			console.log("tried to open cache without permission");
			return null;
		}
		// await source.handle.requestPermission();
		for await (let file of dir.values()) {
			if (file.kind == "file") {
				files[file.name] = await file.getFile();
			}
		}
		this.giveBlobs(files);
	}

	async getFile(major: number, minor: number, crc?: number) {
		if (major == cacheMajors.index) { return this.getIndexFile(minor); }
		let data = await this.sendWorker({ type: "getfile", major, minor, crc }) as Uint8Array;
		return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	}

	async getFileArchive(index: cache.CacheIndex) {
		let arch = await this.getFile(index.major, index.minor, index.crc);
		return cache.unpackSqliteBufferArchive(arch, index.subindices, index.subnames);
	}

	async getCacheIndex(major: number) {
		if (major == cacheMajors.index) { return this.generateRootIndex(); }
		let index = this.indices.get(major);
		if (!index) {
			index = this.getIndexFile(major).then(file => cache.indexBufferToObject(major, file, this));
			this.indices.set(major, index);
		}
		return index;
	}

	async getIndexFile(major: number) {
		let data = await this.sendWorker({ type: "getindex", major }) as Uint8Array;
		return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	}

	close() {
		//TODO this will break if we are doing writes
		this.worker.terminate();
	}
}
