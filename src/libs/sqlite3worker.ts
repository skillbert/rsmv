import { AbstractSQLite, AbstractSQLiteStatement, AbstractSQLiteWasm } from "./sqlite3wrap";

export type SharedWorkerPackets = {
	type: "sqliteopen", dbname: string, file: Blob | undefined, write: boolean, create: boolean
} | {
	type: "sqliteexec", dbid: number, query: string
} | {
	type: "sqliteprepare", dbid: number, query: string
} | {
	type: "sqliterunprepared", queryid: number, args?: any[]
} | {
	type: "sqliteclose", dbid: number
};

let idcounter = 1;
let opentables = new Map<number, { id: number, refs: number, name: string, backend: AbstractSQLite }>();
let openstatements = new Map<number, { id: number, dbid: number, originalquery: string, backend: AbstractSQLiteStatement }>();



async function onMessage(e: MessageEvent) {
	let id = e.data.id;
	let packet: SharedWorkerPackets = e.data.packet;
	try {
		if (packet.type == "sqliteopen") {
			postMessage({ id, data: await sqliteOpen(packet) });
		} else if (packet.type == "sqliteexec") {
			postMessage({ id, data: await sqliteExec(packet) });
		} else if (packet.type == "sqliteprepare") {
			postMessage({ id, data: await sqlitePrepare(packet) });
		} else if (packet.type == "sqliterunprepared") {
			postMessage({ id, data: await sqliteRunPrepared(packet) });
		} else if (packet.type == "sqliteclose") {
			postMessage({ id, data: await sqliteClose(packet) });
		} else {
			throw new Error(`unknown packet type ${(packet as any).type}`);
		}
	} catch (e) {
		postMessage({ id, error: e.message });
	}
}
// if used as dedicated worker
self.addEventListener("message", onMessage);
console.log("worker started");

async function sqliteOpen(packet: SharedWorkerPackets & { type: "sqliteopen" }) {
	let entry = opentables.values().find(q => q.name == packet.dbname);
	if (!entry) {
		entry = {
			refs: 0,
			name: packet.dbname,
			id: idcounter++,
			backend: await AbstractSQLiteWasm.create(packet.file)
		}
		opentables.set(entry.id, entry);
	}
	entry.refs++;
	return entry.id;
}

async function sqliteExec(packet: SharedWorkerPackets & { type: "sqliteexec" }) {
	let entry = opentables.get(packet.dbid);
	if (!entry) { throw new Error(`no such dbid ${packet.dbid}`); }
	await entry.backend.exec(packet.query);
}

async function sqlitePrepare(packet: SharedWorkerPackets & { type: "sqliteprepare" }) {
	let entry = opentables.get(packet.dbid);
	if (!entry) { throw new Error(`no such dbid ${packet.dbid}`); }
	let stmt = await entry.backend.prepare(packet.query);
	let stmtid = idcounter++;
	openstatements.set(stmtid, { id: stmtid, dbid: packet.dbid, originalquery: packet.query, backend: stmt });
	return stmtid;
}

async function sqliteRunPrepared(packet: SharedWorkerPackets & { type: "sqliterunprepared" }) {
	let entry = openstatements.get(packet.queryid);
	if (!entry) { throw new Error(`no such queryid ${packet.queryid}`); }
	return entry.backend.run(packet.args);
}

async function sqliteClose(packet: SharedWorkerPackets & { type: "sqliteclose" }) {
	let entry = opentables.get(packet.dbid);
	if (!entry) { throw new Error(`no such dbid ${packet.dbid}`); }
	entry.refs--;
	if (entry.refs <= 0) {
		await entry.backend.close();
		opentables.delete(packet.dbid);
	}
}