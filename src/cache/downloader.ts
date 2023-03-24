import { DirectCacheFileSource } from "./index";
import { decompress } from "./compression";
import * as net from "net";
import fetch from "node-fetch";
import { crc32 } from "../libs/crc32util";
import { FileParser } from "../opdecoder";
import { CallbackPromise, delay } from "../utils";
import { cacheMajors } from "../constants";

const maxblocksize = 102400;

type ClientConfig = {
	[id: string]: string | {}
}

//TODO get rid of this again
const handshake1 = new FileParser<any>(["struct",
	["type", "ubyte"],
	["length", "ubyte"],
	["version1", "uint"],
	["version2", "uint"],
	["key", "string"],
	["lang", "ubyte"]
]);

const handshake2 = new FileParser<any>(["struct",
	["op", "ubyte"],
	["tribyte", "unsigned tribyte"],
	["short1", "ushort"],
	["version", "ushort"],
	["short2", "ushort"]
]);
const filereq1 = new FileParser<any>(["struct",
	["mode", "ubyte"],
	["major", "ubyte"],
	["minor", "uint"],
	["version", "ushort"],
	["short2", "ushort"]
]);

type PendingFile = {
	major: number,
	minor: number,
	totalBytes: number,
	result: Buffer[],
	currentBytes: number,
	pendingsocket: net.Socket | null,
	done: (data: Buffer) => void,
	err: (err: any) => void
}

export type ParsedClientconfig = ReturnType<typeof parseClientConfig>;

export function parseClientConfig(cnf: ClientConfig) {
	var key = Object.values(cnf.param).find(param => param.length == 32);
	if (!key) { throw new Error("client cache key not found in config"); }

	let serverVersionMajor = parseInt(cnf.server_version as any);
	if (!serverVersionMajor) { throw new Error("client cache doesn't have a server_version"); }
	let serverVersionMinor = 1;

	//comes from config but is obfuscated
	const port = 43594;
	const endpoint = "content.runescape.com"
	const unknownshort1 = 0;
	const unknownshort2 = 0;

	return { key, serverVersionMajor, serverVersionMinor, endpoint, port, unknownshort1, unknownshort2 };
}

export async function downloadServerConfig() {
	let body: string = await fetch("http://world3.runescape.com/jav_config.ws?binaryType=2").then(r => r.text());
	let chunks = body.split(/(?:\r\n|\r|\n)/g);

	var config: ClientConfig = {};
	for (var i = 0; i < chunks.length; ++i) {
		let line = chunks[i].split(/(?:=)/g);
		if (line.length == 2) {
			config[line[0]] = line[1];
		} else if (line.length == 3) {
			config[line[0]] = (config[line[0]] || {});
			config[line[0]][line[1]] = line[2];
		}
	}
	if (typeof config.server_version != "string") { throw new Error("server version not found in config"); }
	return config;
}

var downloadedBytes = 0;
function trackDataUsage(len: number) {
	if (Math.floor(downloadedBytes / 100e6) != Math.floor((downloadedBytes + len) / 100e6)) {
		console.info(`loaded ${(downloadedBytes + len) / 1e6 | 0} mb from jagex server`);
	}
	downloadedBytes += len;
}

class DownloadSocket {
	pending: PendingFile[] = [];
	ready = new CallbackPromise();
	socket: net.Socket;
	config: ParsedClientconfig;

	packetPending: Buffer[] = [];
	packetPendingError: any = null;
	packetCallback: (() => void) | null = null;

	constructor(config: ParsedClientconfig) {
		this.config = config;
		this.socket = new net.Socket();
		this.socket.on("connect", () => {
			console.log("downloader connected " + this.socket.remoteAddress);
		});
		this.socket.on("data", (data) => {
			this.packetPending.push(data);
			this.packetCallback?.();
			trackDataUsage(data.byteLength);
		});
		this.socket.on("close", () => {
			console.log("closed");
			this.packetPendingError = new Error("connection closed");
			this.packetCallback?.();
		});
		this.socket.on("error", (err) => {
			this.packetPendingError = err;
			this.packetCallback?.();
		});
	}

	async connect() {
		this.socket.connect(this.config.port, this.config.endpoint);

		this.socket.write(handshake1.write({
			type: 15,
			length: 42,
			version1: this.config.serverVersionMajor,
			version2: this.config.serverVersionMinor,
			key: this.config.key,
			lang: 0//en
		}));

		//0=success,6=outdated,48=badkey
		let res1 = await this.getChunk(1);
		if (res1.readUint8(0) != 0) { throw new Error("unexpected handshake response"); }

		let tribyte = 5;
		this.socket.write(handshake2.write({ op: 6, tribyte, short1: this.config.unknownshort1, short2: this.config.unknownshort2, version: this.config.serverVersionMajor }));
		this.socket.write(handshake2.write({ op: 3, tribyte, short1: this.config.unknownshort1, short2: this.config.unknownshort2, version: this.config.serverVersionMajor }));
	}

	async run() {
		await this.connect();
		this.ready.done();
		while (true) {
			let bytesread = 0;
			try { var chunk = await this.getChunk(1 + 4); }
			catch (e) { return; }
			bytesread += 1 + 4;
			let major = chunk.readUint8(0);
			let minor = chunk.readUint32BE(1) & 0x7fffffff;//first bit is a flag

			let req = this.pending.find(q => q.major == major && q.minor == minor);
			if (!req) { throw new Error("Received file which wasn't requested"); }

			//first packet
			if (req.totalBytes == -1) {
				let header = await this.getChunk(1 + 4);
				bytesread += 1 + 4;
				let compression = header.readUint8(0);
				let compressedSize = header.readUint32BE(1);
				req.totalBytes = header.byteLength + (compression == 0 ? 0 : 4) + compressedSize;
				req.result.push(header);
				req.currentBytes += header.byteLength;
			}
			let bytesleft = req.totalBytes - req.currentBytes;
			let payloadsize = Math.min(maxblocksize - bytesread, bytesleft)
			let datachunk = await this.getChunk(payloadsize);
			req.result.push(datachunk);
			req.currentBytes += datachunk.byteLength;
			if (req.currentBytes == req.totalBytes) {
				this.pending.splice(this.pending.indexOf(req), 1);
				req.done(Buffer.concat(req.result));
			}
		}
	}

	writeRequest(major: number, minor: number) {
		return new Promise<Buffer>((done, err) => {
			this.socket.write(filereq1.write({
				mode: (major == 255 && minor == 255 ? 0x21 : 0x1),
				version: this.config.serverVersionMajor,
				major,
				minor,
				short2: this.config.unknownshort2
			}));
			this.pending.push({
				major, minor,
				totalBytes: -1,
				pendingsocket: this.socket,
				result: [],
				currentBytes: 0,
				done, err
			})
		});
	}

	async getChunk(bytes: number) {
		let res = Buffer.alloc(bytes);
		let index = 0;
		while (index < bytes) {
			//might be able to use socket.pause and socket.resume here instead
			if (this.packetPending.length == 0 && !this.packetPendingError) {
				await new Promise<void>(done => this.packetCallback = done);
			}
			if (this.packetPending.length == 0 && this.packetPendingError) {
				for (let pend of this.pending) { pend.err(this.packetPendingError); }
				throw this.packetPendingError;
			}

			let chunk = this.packetPending[0];
			let len = Math.min(chunk.byteLength, bytes - index);
			chunk.copy(res, index, 0, len);
			index += len;
			if (len == chunk.byteLength) {
				this.packetPending.shift();
			} else {
				this.packetPending[0] = chunk.slice(len);
			}
		}
		return res;
	}
}


export class CacheDownloader extends DirectCacheFileSource {
	configPromise: Promise<ParsedClientconfig>;
	socket: DownloadSocket | null = null;
	socketPromise: Promise<DownloadSocket> | null = null;
	timestamp = new Date();

	constructor() {
		super(true);
		this.configPromise = downloadServerConfig().then(parseClientConfig);
	}

	getCacheMeta() {
		return { name: "live", descr: "Download live data from jagex server", timestamp: this.timestamp };
	}

	async getSocket(): Promise<DownloadSocket> {
		if (!this.socketPromise) {
			this.socketPromise = (async () => {
				let config = await this.configPromise;
				let sock = new DownloadSocket(config);
				sock.run().catch().finally(() => {
					this.socket = null;
					this.socketPromise = null;
				});
				await sock.ready;
				this.socket = sock;
				return this.socket;
			})();
		}
		return this.socketPromise;
	}

	async getFile(major: number, minor: number, crc?: number | undefined): Promise<Buffer> {
		//music can only be downloaded over http
		if (major == cacheMajors.music) {
			let config = await this.configPromise;
			let indexfiles = await this.getCacheIndex(major);
			let index = indexfiles.find(q => q && q.major == major && q.minor == minor);
			if (!index) { throw new Error("requested file not found"); }
			let res = await fetch(`https://${config.endpoint}/ms?m=0&a=${major}&k=${config.serverVersionMajor}&g=${minor}&c=${index.crc >> 0}&v=${index.version}`);
			if (!res.ok) { throw new Error(`http cache request failed with code ${res.status}`); }
			let data = await res.arrayBuffer();
			trackDataUsage(data.byteLength);
			return decompress(Buffer.from(data));
		}

		let socket = this.socket ?? await this.getSocket();
		for (let attempt = 0; attempt < 10; attempt++) {
			try {
				var file = await socket.writeRequest(major, minor);
			} catch (e) {
				if (attempt >= 5) {
					await delay(500);
				}
				continue;
			}
			if (typeof crc == "number" && (major != 255 || minor != 255)) {
				let filecrc = crc32(file);
				if (filecrc != crc) {
					console.log(`crc fail expected ${crc}, got ${filecrc}`);
					if (attempt >= 5) {
						await delay(500);
					}
					continue;
				}
			}
			// console.log("downloaded", major, minor, crc);
			return decompress(file);
		}
		throw new Error("Failed to download matching crc after 10 attemps");
	}

	close() {
		this.socket?.socket.end();
	}
}