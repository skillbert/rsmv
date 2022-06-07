import { cacheMajors } from "../constants";
import * as cache from "./index";
import type { WorkerPackets } from "./sqlitewasmworker";


export class WasmGameCacheLoader extends cache.CacheFileSource {
	cachedir: string;
	writable: boolean;
	indices = new Map<number, Promise<cache.CacheIndexFile>>();
	dbfiles: Record<string, Blob> = {};
	worker: Worker;
	msgidcounter = 1;
	callbacks = new Map<number, { resolve: (res: any) => void, reject: (err: Error) => void, reqpacket: WorkerPackets }>();
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
	getCacheName() {
		return `sqlitewasm`;
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

	async getFile(major: number, minor: number, crc?: number) {
		if (major == cacheMajors.index) { return this.getIndex(minor); }
		let data = await this.sendWorker({ type: "getfile", major, minor, crc }) as Uint8Array;
		return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	}

	async getFileArchive(index: cache.CacheIndex) {
		let arch = await this.getFile(index.major, index.minor, index.crc);
		return cache.unpackSqliteBufferArchive(arch, index.subindices);
	}

	async getIndexFile(major: number) {
		if (major == 255) { return this.generateRootIndex(); }
		let index = this.indices.get(major);
		if (!index) {
			index = this.getIndex(major).then(file => cache.indexBufferToObject(major, file));
			this.indices.set(major, index);
		}
		return index;
	}

	async getIndex(major: number) {
		let data = await this.sendWorker({ type: "getindex", major }) as Uint8Array;
		return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	}

	close() {
		//TODO this will break if we are doing writes
		this.worker.terminate();
	}
}
