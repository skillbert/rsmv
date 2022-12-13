import { Downloader, downloadServerConfig } from "./downloader";
import * as fs from "fs";
import * as sqlite3 from "sqlite3";//.verbose();
import { CacheIndex, CacheFileSource, unpackBufferArchive, indexBufferToObject } from "./index";
import { ParsedTexture } from "../3d/textures";
import { cacheMajors } from "../constants";

var cachedir: string;
var progressDelay = 20;

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
	bufferCallback(staticArguments: SaveFileArguments, recordIndex: number, buffer: Buffer): void,
	//converts an fs file back to cache file format
	hydrateFsFile?(staticArguments: SaveFileArguments, recordIndex: number, buffer: Buffer): Buffer
}

type CacheUpdateHook = {
	callback: (downloader: Downloader, index: CacheIndex & { isNew: boolean }, db: DatabaseInst, db_state: DatabaseState, staticArguments: SaveFileArguments) => Promise<void>;
	staticArguments: SaveFileArguments
}

type DatabaseState = { [major: number]: { [minor: number]: { version: number, crc: number } } };

function commit(db: DatabaseInst, major: number, minor: number, version: number, crc: number, isNew?: boolean) {
	if (isNew) db.statements.insert.run(major, minor, version, crc);
	else db.statements.update.run(version, crc, major, minor);
}

//the pogress event was causing about 50% of all cpu usage during update!!
let progressDebounceInterval: any = null;
let queuedProcessMsg: any = null;
function progress(message: string, value: number | null = null, max: number | null = null) {
	let msg: any;
	if (value !== null || max !== null) msg = { "message": message, "value": value, "max": max };
	else msg = { "message": message };

	if (!progressDebounceInterval) {
		progressDebounceInterval = setInterval(progressDebounceTick, progressDelay);
		events.emit("update-progress", msg);
	} else {
		queuedProcessMsg = msg;
	}
}

function progressDebounceTick() {
	if (queuedProcessMsg) {
		events.emit("update-progress", queuedProcessMsg);
		queuedProcessMsg = null;
	} else {
		clearInterval(progressDebounceInterval);
		progressDebounceInterval = 0;
	}
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

function findMissingIndices<T extends CacheIndex>(db_state: DatabaseState, indices: T[]) {
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

	var allRecordIndices = indexBufferToObject(index.minor, await downloader.getFile(index.major, index.minor, index.crc));
	var recordIndices = findMissingIndices(db_state, allRecordIndices);

	var newRecords = 0;
	var updatedRecords = 0;
	var n = 0;
	for (var i = 0; i < recordIndices.length; ++i) {
		if ((n % commitFrequency) == 0) db.run("BEGIN TRANSACTION");

		var recordIndex = recordIndices[i];
		var buffer = await downloader.getFile(recordIndex.major, recordIndex.minor, recordIndex.crc);
		var subbuffers = unpackBufferArchive(buffer, recordIndex.subindices);

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


var aysncWriteCount = 0;
function dumpBufferToFile(staticArguments: SaveFileArguments, recordIndex: number, buffer: Buffer) {
	let filename = `${cachedir}/${staticArguments.folder}/${recordIndex}.${staticArguments.fileExtension}`;
	//can actually overload node's async file writer...
	if (aysncWriteCount < 100) {
		aysncWriteCount++;
		fs.promises.writeFile(filename, buffer).finally(() => aysncWriteCount--);
	} else {
		fs.writeFileSync(filename, buffer);
	}
}

export const updateCallbacks: { [major: number]: { [minor: number]: CacheUpdateHook } } = {
	"255": {
		"16": {
			"callback": updateRecords, "staticArguments": {
				"singular": "object", "plural": "objects", "folder": "objects", "commitFrequency": 1,
				"fileExtension": "rsobj",
				"bufferCallback": dumpBufferToFile
			}
		},
		"18": {
			"callback": updateRecords, "staticArguments": {
				"singular": "NPC", "plural": "NPCs", "folder": "npcs", "commitFrequency": 1,
				"fileExtension": "rsnpc",
				"bufferCallback": dumpBufferToFile
			}
		},
		"19": {
			"callback": updateRecords, "staticArguments": {
				"singular": "item", "plural": "items", "folder": "items", "commitFrequency": 1,
				"fileExtension": "rsitem",
				"bufferCallback": dumpBufferToFile
			}
		},
		"26": {
			"callback": updateRecords, "staticArguments": {
				"singular": "material", "plural": "materials", "folder": "materials",
				"fileExtension": "jmat",
				"bufferCallback": dumpBufferToFile
			}
		},
		"47": {
			"callback": updateRecords, "staticArguments": {
				"singular": "model", "plural": "models", "folder": "models",
				"fileExtension": "ob3",
				"bufferCallback": dumpBufferToFile
			}
		},
		"53": {
			"callback": updateRecords, "staticArguments": {
				"singular": "texture", "plural": "textures", "folder": "textures",
				"fileExtension": "png",
				"bufferCallback": (staticArguments, record, buffer) => {
					let texture = new ParsedTexture(buffer, true);//TODO destructive loss of alpha here
					if (texture.type != "png") { throw new Error("png image expected"); }
					//TODO actually extract all subimgs/mipmaps
					fs.writeFile(`${cachedir}/${staticArguments.folder}/${record}.png`, texture.imagefiles[0], () => { });
				},
				hydrateFsFile: (staticarguments, record, buffer) => {
					//TODO read all subimgs/mipmaps
					let texture = ParsedTexture.fromFile([buffer]);
					return texture.fullfile;
				}
			}
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

export async function run(cachedirarg: string, progressDebounceDelay?: number) {
	if (progressDebounceDelay) { progressDelay = progressDebounceDelay; }
	cachedir = cachedirarg;
	fs.mkdirSync(cachedir, { recursive: true });

	progress("Preparing database...");
	var { db, db_state } = await prepareDatabase();

	progress("Connecting to servers...");
	let config = downloadServerConfig();
	var downloader = new Downloader(config);

	progress("Downloading index...");
	let indices = downloader.getCacheIndex(cacheMajors.index);

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
					let hook = updateCallbacks[major][minor] as CacheUpdateHook;
					await hook.callback(downloader, index, db, db_state, hook.staticArguments);
				}
			}
		}
	}

	downloader.close();

	//prevent extra progress events from firing after completion
	if (progressDebounceInterval) {
		clearInterval(progressDebounceInterval);
		progressDebounceInterval = 0;
	}
	queuedProcessMsg = null;

	//not sure if these are necessary
	db.statements.insert.finalize((e) => { if (e) throw e; });
	db.statements.update.finalize((e) => { if (e) throw e; });
	db.close();
}

export function on(event: string, callback) {
	events.add(event, callback);
}

export const fileSource = new class extends CacheFileSource {
	getFile(major, minor) {
		//the original (packed) files are lost, would have to rebuild it completely
		throw new Error("not implemented");
		return null as any;//return to make typescript shut up
	}
	getCacheIndex(major) {
		throw new Error("not implemented");
		return null as any;
	}
	getFileArchive(index) {
		//the updater script already places the subfiles in seperator files
		//would have to find out which subfile belong to which minor from the sqlite database
		throw new Error("not implemented");
		return null as any;
	}
	//TODO not sure if this is still correct
	async getFileById(major, fileid) {
		let meta = updateCallbacks[255][major].staticArguments as SaveFileArguments;
		if (!meta) { throw new Error("this file source does not have this file major index"); }
		let filename = `${cachedir}/${meta.folder}/${fileid}.${meta.fileExtension}`;
		let file = await fs.promises.readFile(filename);
		if (meta.hydrateFsFile) {
			file = meta.hydrateFsFile(meta, fileid, file);
		}
		return file;
	}
};