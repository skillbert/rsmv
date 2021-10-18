import { crc32 } from "crc";
import { decompress } from "./decompress";
import * as downloader from "./downloader";
import fs = require("fs");
import sqlite3 = require("sqlite3");//.verbose();

var cachedir: string;

export type CacheIndex = {
	major: number,
	minor: number,
	crc: number,
	uncompressed_crc: number,
	size: number,
	uncompressed_size: number,
	version: number,
	subindexcount: number,
	subindices: number[],
	isNew?: boolean
}

type DatabaseInst = sqlite3.Database & {
	statements: {
		insert: sqlite3.Statement,
		update: sqlite3.Statement
	}
}

type SaveFileArguments = {
	singular: string,
	plural: string,
	folder: string,
	commitFrequency?: number,
	bufferCallback(staticArguments: SaveFileArguments, persistent: PersistentRecord, record: number, numRecords: number, buffer: Buffer): void
}

type PersistentRecord = {
	initialised: boolean,
	scan: number,
	backScan: number,
	recordSize: number
}

type DatabaseState = { [major: number]: { [minor: number]: { version: number, crc: number } } };

function commit(db: DatabaseInst, major: number, minor: number, version: number, crc: number, isNew?: boolean) {
	if (isNew) db.statements.insert.run(major, minor, version, crc);
	else db.statements.update.run(version, crc, major, minor);
}

function progress(message: string, value: number | null = null, max: number | null = null) {
	if (value !== null || max !== null) events.emit("update-progress", { "message": message, "value": value, "max": max });
	else events.emit("update-progress", { "message": message });
}

function prepareDatabase() {
	var db: DatabaseInst = new sqlite3.Database(`${cachedir}/db.sql`, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (e) => { if (e) throw e; }) as any;
	return new Promise<{ db: DatabaseInst, db_state: DatabaseState }>((resolve, reject) => {
		// Create index if it's missing
		db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='index';", (e, row) => {
			if (e) throw e;
			db.serialize(() => {
				if (!row)
					db.run("CREATE TABLE 'index' (" +
						"major INT NOT NULL, " +
						"minor INT NOT NULL, " +
						"version TIMESTAMP(0) NOT NULL, " +
						"crc INT NOT NULL, " +
						"PRIMARY KEY (major, minor));", (e) => { if (e) throw e; });

				// Create our db_state and resolve the promise
				db.all("SELECT major, minor, version, crc FROM 'index'", (e, rows) => {
					if (e) throw e;

					var db_state: DatabaseState = {};
					for (var i = 0; i < rows.length; ++i) {
						var row = rows[i];
						if (!db_state[row.major]) db_state[row.major] = {};
						db_state[row.major][row.minor] = { "version": row.version, "crc": row.crc };
					}

					db.statements = {
						insert: db.prepare("INSERT INTO 'index' (major, minor, version, crc) VALUES (?, ?, ?, ?);"),
						update: db.prepare("UPDATE 'index' SET version=?, crc=? WHERE major=? AND minor=?;")
					}
					resolve({ db, db_state });
				});
			});
		});
	});
}

function prepareFolder(dir: string) {
	if (!fs.existsSync(`${cachedir}/${dir}`)) {
		fs.mkdirSync(`${cachedir}/${dir}`);
		return true;
	}
	return false;
}

function update(db_state: DatabaseState, indices: CacheIndex[]) {
	var pile: CacheIndex[] = [];

	// Loop through our indices and check the database for updates
	for (var i in indices) {
		var index = indices[i];
		var row = (db_state[index.major] ? db_state[index.major] : {})[index.minor];

		// If row doesn't exist, or the version or crc are incorrect, place it into the pile
		if (row == null || (row.version != index.version || row.crc != index.crc)) {
			index.isNew = (row == null);
			pile.push(index);
		}
	}

	return pile;
}

async function updateRecords(index: CacheIndex, db: DatabaseInst, db_state: DatabaseState, staticArguments: SaveFileArguments) {
	var singular = staticArguments.singular;
	var plural = staticArguments.plural;
	var folder = staticArguments.folder;
	var commitFrequency = (staticArguments.commitFrequency || 128);

	progress(`Finding ${singular} updates...`);

	prepareFolder(folder);

	var recordIndices = indexBufferToObject(index.minor, decompress(await downloader.download(index.major, index.minor, index.crc)));

	recordIndices = await update(db_state, recordIndices);
	var newRecords = 0;
	var updatedRecords = 0;
	var n = 0;
	for (var i = 0; i < recordIndices.length; ++i) {
		if ((n % commitFrequency) == 0) db.run("BEGIN TRANSACTION");

		var recordIndex = recordIndices[i];
		var buffer = decompress(await downloader.download(recordIndex.major, recordIndex.minor, recordIndex.crc));
		var persistent: PersistentRecord = {} as any;

		for (var j = 0; j < recordIndex.subindices.length; ++j, ++n) {
			var recordSubindex = recordIndex.subindices[j];
			progress(`Downloading ${singular} ${recordSubindex}`, i + (j / recordIndex.subindices.length), recordIndices.length);

			staticArguments.bufferCallback(staticArguments, persistent, recordSubindex, recordIndex.subindices.length, buffer);

			if (recordIndex.isNew) newRecords++; else updatedRecords++; // Just verbose so the CLI looks professional af
		}

		// Add it to the index so we know we've processed it
		commit(db, recordIndex.major, recordIndex.minor, recordIndex.version, recordIndex.crc, recordIndex.isNew);
		if ((n % commitFrequency) == commitFrequency - 1) await new Promise<void>((resolve, reject) => { db.run("COMMIT", () => { resolve(); }); });
	}
	//            v
	//if ((n % commitFrequency) != commitFrequency - 1) await new Promise((resolve, reject) => { db.run("COMMIT", () => { resolve(); }); }); // If we have any uncommitted transactions

	process.stdout.write((`\rDownloaded ${newRecords} new ${plural}, updated ${updatedRecords} ${plural}`).padEnd(54, " ") + "\n");

	// Finished updating models, commit to the database
	commit(db, index.major, index.minor, index.version, index.crc, index.isNew);
	await new Promise<void>((resolve, reject) => { db.run("COMMIT", () => { resolve(); }); });
}

const updateCallbacks = {
	"255": {
		"16": {
			"callback": updateRecords, "staticArguments": {
				"singular": "object", "plural": "objects", "folder": "objects", "commitFrequency": 1,
				"bufferCallback": (staticArguments, persistent, record, numRecords, buffer) => {
					if (persistent.initialised !== true) {
						persistent.initialised = true;
						persistent.scan = 0x0;
						persistent.backScan = buffer.length - 0x1 - (0x4 * numRecords);
						persistent.recordSize = 0;
					}
					persistent.recordSize += buffer.readInt32BE(persistent.backScan);
					persistent.backScan += 4;
					var output = buffer.slice(persistent.scan, persistent.scan + persistent.recordSize);
					persistent.scan += persistent.recordSize;
					//TODO make async?
					fs.writeFileSync(`${cachedir}/${staticArguments.folder}/${record}.rsobj`, output);
				}
			} as SaveFileArguments
		},
		"18": {
			"callback": updateRecords, "staticArguments": {
				"singular": "NPC", "plural": "NPCs", "folder": "npcs", "commitFrequency": 1,
				"bufferCallback": (staticArguments, persistent, record, numRecords, buffer) => {
					if (persistent.initialised !== true) {
						persistent.scan = 0x0;
						persistent.backScan = buffer.length - 0x1 - (0x4 * numRecords);
						persistent.recordSize = 0;
						persistent.initialised = true;
					}
					persistent.recordSize += buffer.readInt32BE(persistent.backScan);
					persistent.backScan += 4;
					var output = buffer.slice(persistent.scan, persistent.scan + persistent.recordSize);
					persistent.scan += persistent.recordSize;
					fs.writeFileSync(`${cachedir}/${staticArguments.folder}/${record}.rsnpc`, output);
				}
			} as SaveFileArguments
		},
		"19": {
			"callback": updateRecords, "staticArguments": {
				"singular": "item", "plural": "items", "folder": "items", "commitFrequency": 1,
				"bufferCallback": (staticArguments, persistent, record, numRecords, buffer) => {
					if (persistent.initialised !== true) {
						persistent.scan = 0x0;
						persistent.backScan = buffer.length - 0x1 - (0x4 * numRecords);
						persistent.recordSize = 0;
						persistent.initialised = true;
					}
					persistent.recordSize += buffer.readInt32BE(persistent.backScan);
					persistent.backScan += 4;
					var output = buffer.slice(persistent.scan, persistent.scan + persistent.recordSize);
					persistent.scan += persistent.recordSize;
					fs.writeFileSync(`${cachedir}/${staticArguments.folder}/${record}.rsitem`, output);
				}
			} as SaveFileArguments
		},
		"26": {
			"callback": updateRecords, "staticArguments": {
				"singular": "material", "plural": "materials", "folder": "materials",
				"bufferCallback": (staticArguments, persistent, record, numRecords, buffer) => {
					if (persistent.initialised !== true) {
						persistent.scan = 0x0;
						persistent.backScan = buffer.length - 0x1 - (0x4 * numRecords);
						persistent.recordSize = 0;
						persistent.initialised = true;
					}
					persistent.recordSize += buffer.readInt32BE(persistent.backScan);
					persistent.backScan += 4;
					var output = buffer.slice(persistent.scan, persistent.scan + persistent.recordSize);
					persistent.scan += persistent.recordSize;
					fs.writeFileSync(`${cachedir}/${staticArguments.folder}/${record}.jmat`, output);
				}
			} as SaveFileArguments
		},
		"47": {
			"callback": updateRecords, "staticArguments": {
				"singular": "model", "plural": "models", "folder": "models",
				"bufferCallback": (staticArguments, persistent, record, numRecords, buffer) => {
					fs.writeFile(`${cachedir}/${staticArguments.folder}/${record}.ob3`, buffer, () => { });
				}
			} as SaveFileArguments
		},
		"53": {
			"callback": updateRecords, "staticArguments": {
				"singular": "texture", "plural": "textures", "folder": "textures",
				"bufferCallback": (staticArguments, persistent, record, numRecords, buffer) => {
					fs.writeFile(`${cachedir}/${staticArguments.folder}/${record}.png`, buffer.slice(0x5), () => { });
				}
			} as SaveFileArguments
		}
	}
};

var events = {
	"emit": (event: string, ...args: any[]) => {
		if (event in events) {
			var eventList = events[event];
			for (var i = 0; i < eventList.length; ++i)
				eventList[i](args);
		}
	},
	"add": (event: string, callback) => {
		if (!(event in events)) events[event] = [];
		events[event].push(callback);
	}
};

export function run(cachedirarg: string) {
	cachedir = cachedirarg;
	fs.mkdirSync(cachedir, { recursive: true });
	return new Promise<void>(async (resolve, reject) => {
		progress("Preparing database...");
		var { db, db_state } = await prepareDatabase();

		progress("Connecting to servers...");
		await downloader.prepare(cachedir);

		progress("Downloading index...");
		var metaindex = decompress(await downloader.download(255, 255));

		progress("Processing index...");
		var indices: { [key: number]: CacheIndex } = {};
		var offset = 0x0;
		var elements = metaindex.readUInt8(offset++);
		for (var i = 0; i < elements; ++i, offset += 0x50) {
			var element = metaindex.slice(offset, offset + 0x50);
			if (crc32(element) != 2384664806) { // If index definition isn't null (all zeros)
				indices[i] = {
					"major": 255,
					"minor": i,
					"crc": element.readUInt32BE(0),
					"version": element.readUInt32BE(0x4)
				} as any
			}
		}

		progress("Finding updates...");
		for (let i in indices) {
			if (!(i.toString() in updateCallbacks["255"])) continue;

			var pile = update(db_state, [indices[i]]);

			for (let i = 0; i < pile.length; ++i) {
				var index = pile[i];
				var major = index.major.toString();
				var minor = index.minor.toString();
				if (major in updateCallbacks)
					if (minor in updateCallbacks[major])
						await updateCallbacks[major][minor].callback(index, db, db_state, updateCallbacks[major][minor].staticArguments);
			}
		}

		downloader.close();

		db.statements.insert.finalize((e) => { if (e) throw e; });
		db.statements.update.finalize((e) => { if (e) throw e; });
		db.close((e) => { try { if (e) throw e; } finally { resolve(); } });
	});
}
export function on(event: string, callback) {
	events.add(event, callback);
}

export function indexBufferToObject(major: number, buffer: Buffer) {
	var count = 0;
	var scan = 0x6;
	if ((buffer.readUInt8(0x6) & 0x80) == 0x80)
		count = (buffer.readUInt32BE(scan) & 0x7FFFFFFF), scan += 4;
	else
		count = buffer.readUInt16BE(scan), scan += 2;

	var index: CacheIndex[] = []
	var minor = 0;
	var biggestCount = -1;
	for (var i = 0; i < count; ++i) {
		minor += buffer.readUInt16BE(scan), scan += 2;
		index[i] = { "major": major, "minor": minor } as any;
	}
	for (var i = 0; i < count; ++i)
		index[i].crc = buffer.readUInt32BE(scan), scan += 4;
	for (var i = 0; i < count; ++i)
		index[i].uncompressed_crc = buffer.readUInt32BE(scan), scan += 4;
	for (var i = 0; i < count; ++i) {
		index[i].size = buffer.readUInt32BE(scan), scan += 4;
		index[i].uncompressed_size = buffer.readUInt32BE(scan), scan += 4;
	}
	for (var i = 0; i < count; ++i)
		index[i].version = buffer.readUInt32BE(scan), scan += 4;
	for (var i = 0; i < count; ++i) {
		index[i].subindexcount = buffer.readUInt16BE(scan), scan += 2;
		if (index[i].subindexcount > biggestCount)
			biggestCount = index[i].subindexcount;
	}
	for (var i = 0; i < count; ++i) {
		index[i].subindices = [];
		let subindex = index[i].minor * biggestCount;
		for (var j = 0; j < index[i].subindexcount; ++j) {
			subindex += buffer.readUInt16BE(scan), scan += 2;
			index[i].subindices.push(subindex);
		}
	}
	//fs.writeFileSync(`${cachedir}/test_index.json`, JSON.stringify(index, null, 4));
	//console.log(index);

	return index;
}