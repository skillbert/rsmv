import { crc32 } from "crc";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";

var server_version: number;
var cachedir: string;

type ClientConfig = {
	[id: string]: string | {}
}

export function prepare(outdir: string) {
	cachedir = outdir;
	return new Promise<void>(resolve => {
		http.get("http://world3.runescape.com/jav_config.ws?binaryType=4", function (response) {
			var body = ""
			response.on("data", data => {
				body += data;
			});
			response.on("end", () => {
				let chunks = body.toString().split(/(?:\r\n|\r|\n)/g);

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
				if (typeof config.server_version != "string") { throw "server version not found in config"; }
				server_version = parseInt(config.server_version);

				state = new ConnectionState(client, config, resolve);
				connect(config);
			});
		});
	});
}
export function download(major: number, minor: number, crc: number | null = null) {
	var attempts = 0;
	var recurse = function (resolve: (b: Buffer) => void, reject: (e: any) => void) {
		new Promise<Buffer>((resolveAttempt, rejectAttempt) => { writedownload(major, minor, resolveAttempt); }).then((buffer: Buffer) => {
			if (!(buffer instanceof Buffer)) reject("Not a buffer");

			if (crc != null) {
				let bufferCrc = crc32(buffer);
				if (bufferCrc == crc) resolve(buffer);
				else if (attempts++ < 5) recurse(resolve, reject);
			} else {
				resolve(buffer);
			}
		});
	};
	return new Promise<Buffer>((resolve, reject) => { recurse(resolve, reject); });
}
export function close() {
	client.destroy();
}

var client = new net.Socket();
var state: State<any>; // Downloader's current state, so we know where to pipe data

function writedownload(major: number, minor: number, resolve: (b: Buffer) => void) {
	state = new DownloadState(client, resolve);

	var packet = Buffer.alloc(1 + 1 + 4 + 4);
	packet.writeUInt8(0x21, 0x0); // Request record
	packet.writeUInt8(major, 0x1); // Index
	packet.writeUInt32BE(minor, 0x2); // Archive
	packet.writeUInt16BE(server_version, 0x6); // Server version
	packet.writeUInt16BE(0x0, 0x8); // Unknown

	client.write(packet);
}

function connect(config: ClientConfig) {
	fs.writeFileSync(`${cachedir}/world_config.log.json`, JSON.stringify(config, undefined, 4));
	var address = "content.runescape.com"; //config.param["8"]; <-- Position of these parameters change, but I can't find the rhyme or reason
	var port = 43594; //config.param["9"];

	// Conntect to content.runescape.com:43594          //(or wherever Jagex points us) ((no longer relevant since we're setting it ourselves))
	client.connect(port, address, function () {
		state.onConnect();
	});

	var _ticket = 0;
	var _worker = 0;
	client.on("data", function (data) {
		//TODO this loop can not be exited if it ever starts in non completed state
		//there is no way for spin locks to work like this in js
		var ticket = _ticket++; // Take a ticket
		while (_worker != ticket); // Wait until our ticket is called
		// ✨⭐🎵 Semaphores With Adam 🎵⭐✨

		state.onData(data);
		_worker++;
	});

	client.on("end", function () {
		//state.onEnd();
	});

	client.on("close", function () {
		state.onClose();
		console.log("Connection closed");
	});

}

class State<T> {
	resolve: (b: T) => void;
	read: number;
	client: net.Socket;
	buffer: Buffer;
	constructor(client: net.Socket) {
		this.client = client;
	}
	onConnect() { }
	onData(data: Buffer) { }
	onEnd() { }
	onClose() { }
}

class ConnectionState extends State<void> {
	config: ClientConfig;
	status: number;
	constructor(client: net.Socket, config: ClientConfig, resolve: () => void) {
		super(client);
		this.config = config;
		this.resolve = resolve;
		this.buffer = Buffer.alloc(1 + 108);
		this.read = 0;
	}

	onConnect() {
		process.stdout.write("\rConnecting...".padEnd(55, " "));
		var key = Object.values(this.config.param).find(param => param.length == 32);
		if (!key) { throw "client cache key not found in config"; }
		var length = 4 + 4 + key.length + 1 + 1;
		var major = parseInt(this.config["server_version"] as any);

		var packet = Buffer.alloc(1 + 1 + length);

		packet.writeUInt8(0xF, 0x0);   // Handshake
		packet.writeUInt8(length, 0x1);   // Length
		packet.writeUInt32BE(major, 0x2);   // Major version
		packet.writeUInt32BE(0x1, 0x6);   // Minor version
		packet.write(key, 0xA);   // Key
		packet.writeUInt8(0x0, 0xA + key.length);  //  Null termination
		packet.writeUInt8(0x0, 0xB + key.length);  // Language code

		process.stdout.write("\rHandshaking...".padEnd(55, " "));
		client.write(packet);
	}

	onData(data: Buffer) {
		var scan = 0;
		if (this.read == 0x0) this.buffer[this.read++] = this.status = data[scan++];
		if (this.status == 6) this.onEnd();

		for (; this.read < this.buffer.length && scan < data.length; ++this.read, ++scan) this.buffer[this.read] = data[scan];

		if (this.buffer.length <= this.read) this.onEnd();
	}

	onEnd() {
		console.log("\rDatabase version", this.config.server_version);

		// Don't understand the difference
		//client.write("\x06\x00\x00\x04\x00\x00\x03\x00\x00\x00\x00\x00"); // Taken from Cook's code
		//client.write("\x06\x00\x00\x04\x38\x34\x03\x00\x00\x04\x38\x34"); // Taken from a Wireshark profile
		//client.write("\x06\x00\x00\x05\x00\x00\x03\x93\x00\x00\x03\x00\x00\x05\x00\x00\x03\x93\x00\x00"); // Taken from a Wireshark profile later on (less wrong)

		var major = parseInt(this.config["server_version"] as any);
		var packet = Buffer.alloc(4 + 4 + 2 + 4 + 4 + 2);
		packet.write("\x06\x00\x00\x05", 0x0);
		packet.writeUInt32BE(major, 0x4);
		packet.write("\x00\x00", 0x8);
		packet.write("\x03\x00\x00\x05", 0xA);
		packet.writeUInt32BE(major, 0xE);
		packet.write("\x00\x00", 0x12);
		client.write(packet);

		this.resolve();
		//fs.writeFileSync(`${cachedir}/debug/handshake.bin`, this.buffer);
	}
}

class DownloadState extends State<Buffer> {
	pre_buffer: Buffer;
	current: { major: number, minor: number };
	offset: number;
	constructor(client: net.Socket, resolve: (b: Buffer) => void) {
		super(client);
		this.resolve = resolve;
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