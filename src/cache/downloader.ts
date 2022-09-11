import { CacheIndex, indexBufferToObject, unpackBufferArchive, CacheFileSource, CacheIndexFile } from "./index";
import { crc32 } from "crc";
import { decompress } from "./compression";
import * as fs from "fs";
import * as net from "net";
import fetch from "node-fetch";
import { cacheMajors } from "../constants";

type ClientConfig = {
	[id: string]: string | {}
}

export async function downloadServerConfig() {
	let body: string = await fetch("http://world3.runescape.com/jav_config.ws?binaryType=4").then(r => r.text());
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

export class Downloader extends CacheFileSource {
	state: State<any>;
	socket: net.Socket;
	server_version: number;
	queuedReqs = 0;
	closed = false;

	ready: Promise<void>;

	constructor(config?: Promise<ClientConfig>) {
		super();
		if (!config) { config = downloadServerConfig(); }
		config.then(cnf => {
			this.server_version = parseInt(cnf["server_version"] as any);
		})
		this.socket = new net.Socket();

		//comes from config but is obfuscated
		var address = "content.runescape.com";
		var port = 43594;

		this.state = new ConnectionState(this.socket, config);

		this.socket.on("connect", () => this.state.onConnect());
		this.socket.on("data", data => this.state.onData(data));
		this.socket.on("close", () => {
			this.closed = true;
			this.state.onClose();
			console.log("Connection closed");
		});

		this.socket.connect(port, address)
		this.ready = this.state.promise;
	}
	getCacheName() {
		return "live";
	}

	async setState(statebuilder: () => State<any>) {
		//oh no...
		//there can be multiple active calls that hook into this promise and only one can be next
		//we have to keep retrying untill we're the first to hook into it
		this.queuedReqs++;
		do {
			var oldstate = this.state;
			await this.state.promise;
		} while (this.state != oldstate)
		this.queuedReqs--;
		this.state = statebuilder();
	}

	async downloadFile(major: number, minor: number, crc?: number) {
		for (let attempts = 0; attempts < 10; attempts++) {
			//console.log(`download queued (${this.queuedReqs}) ${major} ${minor}`);
			await this.setState(() => new DownloadState(this.socket));
			//console.log(`download starting ${major} ${minor}`);

			//this stuff should be in downloadstate instead?
			var packet = Buffer.alloc(1 + 1 + 4 + 4);
			packet.writeUInt8(0x21, 0x0); // Request record
			packet.writeUInt8(major, 0x1); // Index
			packet.writeUInt32BE(minor, 0x2); // Archive
			packet.writeUInt16BE(this.server_version, 0x6); // Server version
			packet.writeUInt16BE(0x0, 0x8); // Unknown
			this.socket.write(packet);

			let res: Buffer = await this.state.promise;
			console.log(`download done ${major} ${minor}`);

			let bufcrc = crc32(res)
			if (typeof crc != "number") {
				console.log(`downloaded a file without crc check ${major} ${minor}`);
			} else if (bufcrc != crc) {
				console.log(`downloaded crc did not match requested data, attempt ${attempts}/5`)
				if (attempts >= 5) {
					await new Promise(d => setTimeout(d, 500));
				}
				continue;
			}
			return res;
		}
		throw new Error("download did not match crc after 5 attempts");
	}


	indexMap = new Map<number, Promise<CacheIndexFile>>();

	async getFile(major: number, minor: number, crc?: number) {
		return decompress(await this.downloadFile(major, minor, (major == 255 && minor == 255 ? undefined : crc)));
	}
	async getFileArchive(meta: CacheIndex) {
		return unpackBufferArchive(await this.getFile(meta.major, meta.minor, meta.crc), meta.subindices);
	}
	getIndexFile(major: number) {
		let index = this.indexMap.get(major);
		if (!index) {
			index = (async () => {
				let crc: number | undefined = undefined;
				if (major != cacheMajors.index) {
					let index = await this.getIndexFile(cacheMajors.index);
					crc = index[major].crc;
				}
				let indexfile = await this.getFile(255, major, crc);
				let decoded = indexBufferToObject(major, indexfile);
				return decoded;
			})();
			this.indexMap.set(major, index);
		}
		return index;
	}

	close() {
		this.closed = true;
		this.socket.destroy();
	}
}

class State<T> {
	resolve: (b: T) => void;
	reject: (e: any) => void;
	promise: Promise<T>;
	read: number;
	client: net.Socket;
	buffer: Buffer;
	constructor(client: net.Socket) {
		this.promise = new Promise<T>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject
		});
		this.client = client;
	}
	onConnect() { }
	onData(data: Buffer) { }
	onEnd() { }
	onClose() { this.reject(new Error("connection closed")); }
}

class ConnectionState extends State<void> {
	config: Promise<ClientConfig>;
	status: number;
	constructor(client: net.Socket, config: Promise<ClientConfig>) {
		super(client);
		this.config = config;
		this.buffer = Buffer.alloc(1 + 108);
		this.read = 0;
	}

	async onConnect() {
		let cnf = await this.config;
		console.log("Connecting...");
		var key = Object.values(cnf.param).find(param => param.length == 32);
		if (!key) { throw new Error("client cache key not found in config"); }
		var length = 4 + 4 + key.length + 1 + 1;
		var major = parseInt(cnf["server_version"] as any);

		var packet = Buffer.alloc(1 + 1 + length);

		packet.writeUInt8(0xF, 0x0);   // Handshake
		packet.writeUInt8(length, 0x1);   // Length
		packet.writeUInt32BE(major, 0x2);   // Major version
		packet.writeUInt32BE(0x1, 0x6);   // Minor version
		packet.write(key, 0xA);   // Key
		packet.writeUInt8(0x0, 0xA + key.length);  //  Null termination
		packet.writeUInt8(0x0, 0xB + key.length);  // Language code

		console.log("Handshaking...");
		this.client.write(packet);
	}

	onData(data: Buffer) {
		var scan = 0;
		if (this.read == 0x0) this.buffer[this.read++] = this.status = data[scan++];
		if (this.status == 6) this.onEnd();

		//server no longer sends this
		// for (; this.read < this.buffer.length && scan < data.length; ++this.read, ++scan) this.buffer[this.read] = data[scan];
		// if (this.buffer.length <= this.read) this.onEnd();
		this.onEnd();
	}

	async onEnd() {
		let config = await this.config;
		console.log("\rDatabase version", config.server_version);

		// Don't understand the difference
		//client.write("\x06\x00\x00\x04\x00\x00\x03\x00\x00\x00\x00\x00"); // Taken from Cook's code
		//client.write("\x06\x00\x00\x04\x38\x34\x03\x00\x00\x04\x38\x34"); // Taken from a Wireshark profile
		//client.write("\x06\x00\x00\x05\x00\x00\x03\x93\x00\x00\x03\x00\x00\x05\x00\x00\x03\x93\x00\x00"); // Taken from a Wireshark profile later on (less wrong)

		var major = parseInt(config["server_version"] as any);
		var packet = Buffer.alloc(4 + 4 + 2 + 4 + 4 + 2);
		packet.write("\x06\x00\x00\x05", 0x0);
		packet.writeUInt32BE(major, 0x4);
		packet.write("\x00\x00", 0x8);
		packet.write("\x03\x00\x00\x05", 0xA);
		packet.writeUInt32BE(major, 0xE);
		packet.write("\x00\x00", 0x12);
		this.client.write(packet);

		this.resolve();
		//fs.writeFileSync(`${cachedir}/debug/handshake.bin`, this.buffer);
	}
}

class DownloadState extends State<Buffer> {
	pre_buffer: Buffer;
	current: { major: number, minor: number };
	offset: number;

	constructor(client: net.Socket) {
		super(client);
		this.pre_buffer = Buffer.alloc(1 + 4 + 1 + 4 + (4));
		this.current = { "major": -1, "minor": -1 };

		this.read = 0;
		this.offset = 1 + 4;
	}

	onData(data: Buffer) {
		var scan = 0;

		// Read identifier
		for (; this.read < 0x5 && scan < data.length; ++this.read, ++scan)
			this.pre_buffer[this.read] = data[scan];

		if (this.read == 0x5) {
			this.current.major = this.pre_buffer.readUInt8(0);
			this.current.minor = this.pre_buffer.readUInt32BE(0x1);
		}

		// Read compression data
		for (; this.read < 0x5 + 0x5 && scan < data.length; ++this.read, ++scan)
			this.pre_buffer[this.read] = data[scan];

		if (this.read >= 0x5 + 0x5) {
			var compression = this.pre_buffer.readUInt8(0x5);
			if (compression == 0) {
				if (this.read == 0x5 + 0x5) {
					this.buffer = Buffer.alloc(this.pre_buffer.readUInt32BE(0x6) + 1 + 4);
					this.pre_buffer.copy(this.buffer, 0x0, 0x5, 0x5 + 1 + 4);
				}
			} else {
				if (this.read == 0x5 + 0x5) {
					var length = this.pre_buffer.readUInt32BE(0x6) + 1 + 4 + 4;
					this.buffer = Buffer.alloc(length);
				}

				for (; this.read < 0x5 + 0x5 + 0x4 && scan < data.length; ++this.read, ++scan)
					this.pre_buffer[this.read] = data[scan];

				if (this.read == 0x5 + 0x5 + 0x4)
					this.pre_buffer.copy(this.buffer, 0x0, 0x5, 0x5 + 1 + 4 + 4);
			}

			// Read data
			for (; scan < data.length; ++this.read, ++scan) {
				// Data header is re-sent once every 0x19000 bytes. Just skip it since we're downloading files in series
				for (; (this.read % 0x19000) < 0x5 && scan < data.length; ++this.read, ++scan) this.offset++;

				this.buffer[this.read - this.offset] = data[scan];
			}

			if (this.read - this.offset >= this.buffer.length)
				//fs.writeFileSync(`${cachedir}/debug/index/255.${scope.current[1].toString()}.912.bin`, scope.buffer);
				this.onEnd();
		}
	}
	onEnd() {
		this.resolve(this.buffer);
	}
}