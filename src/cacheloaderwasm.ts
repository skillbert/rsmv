import * as cache from "./cache";
import type { WorkerPackets } from "./cacheloaderwasmworker";


export class WasmGameCacheLoader extends cache.CacheFileSource {
	cachedir: string;
	writable: boolean;
	indices = new Map<number, Promise<cache.CacheIndexFile>>();
	dbfiles: Record<string, Blob> = {};
	worker: Worker;
	msgidcounter = 1;
	callbacks = new Map<number, { resolve: (res: any) => void, reject: (err: Error) => void }>();
	constructor() {
		super();
		//@ts-ignore this whole line gets consumed by webpack, turns to static string in webpack
		this.worker = new Worker(new URL("./cacheloaderwasmworker.ts", import.meta.url));
		this.worker.onmessage = e => {
			let handler = this.callbacks.get(e.data.id);
			if (e.data.error) { handler?.reject(e.data.error); } 
			else { handler?.resolve(e.data.packet); }
			this.callbacks.delete(e.data.id);
		}
	}

	sendWorker(packet: WorkerPackets) {
		let id = this.msgidcounter++;
		this.worker.postMessage({ id, packet });
		return new Promise((resolve, reject) => this.callbacks.set(id, { resolve, reject }));
	}

	giveBlobs(blobs: Record<string, Blob>) {
		this.sendWorker({ type: "blobs", blobs });
	}

	async getFile(major: number, minor: number, crc?: number) {
		let data = await this.sendWorker({ type: "getfile", major, minor, crc }) as Uint8Array;
		return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	}

	async getFileArchive(index: cache.CacheIndex) {
		let arch = await this.getFile(index.major, index.minor, index.crc);
		return cache.unpackSqliteBufferArchive(arch, index.subindexcount);
	}

	writeFile(major: number, minor: number, file: Buffer) {
		throw new Error("not implemented");
	}

	writeFileArchive(index: cache.CacheIndex, files: Buffer[]) {
		throw new Error("not implemented");
	}

	async getIndexFile(major: number) {
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
