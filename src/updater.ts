import { decompress } from "./decompress";
import { Downloader, downloadServerConfig } from "./downloader";
import * as fs from "fs";
import * as sqlite3 from "sqlite3";//.verbose();
import { CacheIndex, CacheIndexStub, unpackBufferArchive, rootIndexBufferToObject, indexBufferToObject } from "./cache";
import { CacheFileSource } from "main";

var cachedir: string;

type DatabaseInst = sqlite3.Database & {
	statements: {
		insert: sqlite3.Statement,
		update: sqlite3.Statement
	}
}

export type SaveFileArguments = {
	singular: string,
	plural: string,
	folder: string,
	commitFrequency?: number,
	fileExtension: string,
	bufferCallback(staticArguments: SaveFileArguments, recordIndex: number, buffer: Buffer): void
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

function findMissingIndices<T extends CacheIndexStub>(db_state: DatabaseState, indices: T[]) {
	var pile: (T & { isNew: boolean })[] = [];

	// Loop through our indices and check the database for updates
	for (var i in indices) {
		var index = indices[i];
		var row = (db_state[index.major] ? db_state[index.major] : {})[index.minor];

		// If row doesn't exist, or the version or crc are incorrect, place it into the pile
		if (row == null || row.version != index.version || row.crc != index.crc) {
			pile.push({ ...index, isNew: (row == null) });
		}
	}

	return pile;
}

async function updateRecords(downloader: Downloader, index: CacheIndex & { isNew: boolean }, db: DatabaseInst, db_state: DatabaseState, staticArguments: SaveFileArguments) {
	var singular = staticArguments.singular;
	var plural = staticArguments.plural;
	var folder = staticArguments.folder;
	var commitFrequency = (staticArguments.commitFrequency || 128);

	progress(`Finding ${singular} updates...`);

	prepareFolder(folder);

	var allRecordIndices = indexBufferToObject(index.major, await downloader.getFile(index.major, index.minor, index.crc));

	var recordIndices = findMissingIndices(db_state, allRecordIndices);
	//TODO remove, cap for testing
	recordIndices = recordIndices.slice(0, 10);
	var newRecords = 0;
	var updatedRecords = 0;
	var n = 0;
	for (var i = 0; i < recordIndices.length; ++i) {
		if ((n % commitFrequency) == 0) db.run("BEGIN TRANSACTION");

		var recordIndex = recordIndices[i];
		var buffer = decompress(await downloader.getFile(recordIndex.major, recordIndex.minor, recordIndex.crc));
		var subbuffers = unpackBufferArchive(buffer, recordIndex.subindices.length);
		if (subbuffers.length == 1) { debugger; }

		for (var j = 0; j < recordIndex.subindices.length; ++j, ++n) {
			var recordSubindex = recordIndex.subindices[j];
			progress(`Downloading ${singular} ${recordSubindex}`, i + (j / recordIndex.subindices.length), recordIndices.length);
			staticArguments.bufferCallback(staticArguments, recordSubindex, subbuffers[j].buffer);

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


function dumpBufferToFile(staticArguments: SaveFileArguments, recordIndex: number, buffer: Buffer) {
	//TODO make async?
	fs.writeFileSync(`${cachedir}/${staticArguments.folder}/${recordIndex}.${staticArguments.fileExtension}`, buffer);
}

export const updateCallbacks = {
	"255": {
		"16": {
			"callback": updateRecords, "staticArguments": {
				"singular": "object", "plural": "objects", "folder": "objects", "commitFrequency": 1,
				"fileExtension": "rsobj",
				"bufferCallback": dumpBufferToFile
			} as SaveFileArguments
		},
		"18": {
			"callback": updateRecords, "staticArguments": {
				"singular": "NPC", "plural": "NPCs", "folder": "npcs", "commitFrequency": 1,
				"fileExtension": "rsnpc",
				"bufferCallback": dumpBufferToFile
			} as SaveFileArguments
		},
		"19": {
			"callback": updateRecords, "staticArguments": {
				"singular": "item", "plural": "items", "folder": "items", "commitFrequency": 1,
				"fileExtension": "rsitem",
				"bufferCallback": dumpBufferToFile
			} as SaveFileArguments
		},
		"26": {
			"callback": updateRecords, "staticArguments": {
				"singular": "material", "plural": "materials", "folder": "materials",
				"fileExtension": "jmat",
				"bufferCallback": dumpBufferToFile
			} as SaveFileArguments
		},
		"47": {
			"callback": updateRecords, "staticArguments": {
				"singular": "model", "plural": "models", "folder": "models",
				"fileExtension": "ob3",
				"bufferCallback": dumpBufferToFile
			} as SaveFileArguments
		},
		"53": {
			"callback": updateRecords, "staticArguments": {
				"singular": "texture", "plural": "textures", "folder": "textures",
				"fileExtension": "png",
				"bufferCallback": (staticArguments, record, buffer) => {
					//TODO where does this buffer.slice come from? missing some header logic?
					//i'm guessing there is an image type header (png/jpeg/etc)
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

export async function run(cachedirarg: string) {
	cachedir = cachedirarg;
	fs.mkdirSync(cachedir, { recursive: true });

	progress("Preparing database...");
	var { db, db_state } = await prepareDatabase();

	progress("Connecting to servers...");
	let config = downloadServerConfig();
	var downloader = new Downloader(cachedir, config);
	await new Promise(d => setTimeout(d, 5000));

	progress("Downloading index...");
	var metaindex = await downloader.getFile(255, 255);

	progress("Processing index...");
	var indices = rootIndexBufferToObject(metaindex);

	progress("Finding updates...");
	for (let i in indices) {
		if (!(i.toString() in updateCallbacks["255"])) continue;

		var pile = findMissingIndices(db_state, [indices[i]]);

		for (let i = 0; i < pile.length; ++i) {
			var index = pile[i];
			var major = index.major.toString();
			var minor = index.minor.toString();
			if (major in updateCallbacks) {
				if (minor in updateCallbacks[major]) {
					await updateCallbacks[major][minor].callback(index, db, db_state, updateCallbacks[major][minor].staticArguments);
				}
			}
		}
	}

	downloader.close();

	//not sure if these are necessary
	db.statements.insert.finalize((e) => { if (e) throw e; });
	db.statements.update.finalize((e) => { if (e) throw e; });
	db.close();
}

export function on(event: string, callback) {
	events.add(event, callback);
}

export const fileSource: CacheFileSource = {
	getFile(major, minor) {
		throw new Error("not implemented");
		//the original (packed) files are lost, would have to rebuild it completely
	},
	async getFileArchive(major, minor, nfiles) {
		throw new Error("not implemented");
		//the updater script already places the subfiles in seperator files
		//would have to find out which subfile belong to which minor from the sqlite database
	},
	async getFileById(major, fileid) {
		let meta = updateCallbacks[255][major].staticArguments as SaveFileArguments;
		if (!meta) { throw new Error("this file source does not have this file major index"); }
		let filename = `${cachedir}/${meta.folder}/${fileid}.${meta.fileExtension}`;
		return fs.promises.readFile(filename);
	},
	close() { }
};