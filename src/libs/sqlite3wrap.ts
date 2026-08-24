import type * as sqlite3 from "sqlite3";
import type * as sqlitewasm from "@sqlite.org/sqlite-wasm";
import { SharedWorkerPackets } from "./sqlite3worker";
import { installBlobVfs } from "./sqlite3blobfs";
import fs from "fs/promises";
import path from "path";
import { delay } from "../utils";

const nodecachefolder = "./cache";

export abstract class AbstractSQLiteStatement<ARGS extends any[], RESULTS extends any> {
    abstract run(...args: ARGS): Promise<RESULTS[]>;
}

export abstract class AbstractSQLite {
    abstract exec(query: string): Promise<void>;
    abstract prepare<ARGS extends any[], RESULTS extends any>(query: string): Promise<AbstractSQLiteStatement<ARGS, RESULTS>>;
    abstract close(): Promise<void>;
    async transaction(trans: () => Promise<void>) {
        await this.exec("BEGIN TRANSACTION");
        try {
            await trans();
            await this.exec("COMMIT");
        } catch (e) {
            await this.exec("ROLLBACK");
            throw e;
        }
    }
    static createAutoCache(filename: string): Promise<AbstractSQLite> {
        if (!!fs.constants) {
            // nodejs
            return AbstractSQLiteNode.create(filename, { write: true, create: true });
        } else {
            // web
            return AbstractSQLiteWorker.create(filename);
        }
    }
}

export class AbstractSQLiteNode extends AbstractSQLite {
    private db: sqlite3.Database = null!;
    private constructor() {
        super();
    }
    static async create(filename: string, opts: { write?: boolean, create?: boolean }) {
        let db = new AbstractSQLiteNode();
        //only actually load the dependency when used
        let sqlite = __non_webpack_require__("sqlite3") as typeof import("sqlite3");
        let flags = (opts.write ? sqlite.OPEN_READWRITE : sqlite.OPEN_READONLY) | (opts.create ? sqlite.OPEN_CREATE : 0);

        await fs.mkdir(nodecachefolder, { recursive: true });
        let fullfilename = path.join(nodecachefolder, filename);

        db.db = await new Promise<sqlite3.Database>((done, err) => {
            let res = new sqlite.Database(fullfilename, flags, e => e ? err(e) : done(res));
        });
        return db;
    }
    async exec(query: string) {
        return new Promise<void>((done, err) => {
            this.db.exec(query, e => e ? err(e) : done());
        });
    }
    async prepare<ARGS extends any[], RESULTS extends any>(query: string) {
        return new Promise<AbstractSQLiteNodeStatement<ARGS, RESULTS>>((done, err) => {
            let stmt = this.db.prepare(query, e => e ? err(e) : done(new AbstractSQLiteNodeStatement<ARGS, RESULTS>(stmt)));
        });
    }
    async close() {
        return new Promise<void>((done, err) => {
            this.db.close(e => e ? err(e) : done());
        });
    }
}
class AbstractSQLiteNodeStatement<ARGS extends any[], RESULTS extends any> extends AbstractSQLiteStatement<ARGS, RESULTS> {
    private stmt: sqlite3.Statement;
    constructor(stmt: sqlite3.Statement) {
        super();
        this.stmt = stmt;
    }
    async run(...args: ARGS) {
        return new Promise<RESULTS[]>((done, err) => {
            this.stmt.all(args, (e, rows) => e ? err(e) : done(rows as RESULTS[]));
        });
    }
}

// This entire class is needed to support multi-tab access to the same OPFS database.
// There are many experimental ways to support this but as of aug 2026 they all have one flaw or another
// - can't use SharedWorker because it doesn't support synchronous file access
//   - this is a completely arbitrary limitation of the spec, but it is what it is
//   - in theory async wasm now exists, but there are no existing implementations
// - FileSystemHandles in chrome support unsafe-readwrite, but not in firefox, and there are no sqlite implmementations (requires a lot of custom locking)
// - in theory sqlite-wasm has a multi-tab safe implementation, but it requires SharedArrayBuffer and cross-origin isolation, which limits portability
// - could have one tab "own" the database and other tabs orchestrate messagechannels to it
// 
// this implementation simply only lets one tab access the OPFS file at a time
// A tab signals its intent to access the database by "stealing" the stealer lock. This notifies the current holder of
// that lock which will in turn wind down its access, close the database and release the holder lock.
class PausableSqliteWasmBackend {
    sqlite: sqlitewasm.Sqlite3Static;
    name: string;
    lockholdername: string;
    lockstealername: string;
    pool: sqlitewasm.SAHPoolUtil | null = null;
    statements = new Set<sqlitewasm.PreparedStatement>();
    lockState: {
        unlock: PromiseWithResolvers<void>,
        ready: PromiseWithResolvers<sqlitewasm.Database>,
        entrants: Set<Promise<unknown>>,
        db: sqlitewasm.OpfsSAHPoolDatabase | null
    } | null = null;
    constructor(sqlite: sqlitewasm.Sqlite3Static, name: string) {
        this.sqlite = sqlite;
        this.name = name;
        this.lockholdername = `db-hold-${name}`;
        this.lockstealername = `db-steal-${name}`;
    }

    static async createSAHPoolDb(name: string) {
        // sqlitewasm does NOT return the same instance on multiple inits, need to reuse it to prevent locking issues and multiple wasms
        sqliteWasmPromise ??= import("@sqlite.org/sqlite-wasm").then((q) => q.default())
        let sqlite = await sqliteWasmPromise;
        let db = new PausableSqliteWasmBackend(sqlite, name);
        return db;
    }
    static async createBlobDb(name: string, blob: Blob) {
        // sqlitewasm does NOT return the same instance on multiple inits, need to reuse it to prevent locking issues and multiple wasms
        sqliteWasmPromise ??= import("@sqlite.org/sqlite-wasm").then((q) => q.default())
        let sqlite = await sqliteWasmPromise;
        let vfsname = `${Math.random()}-${name}`;
        let db = new PausableSqliteWasmBackend(sqlite, vfsname);
        let blobfs = installBlobVfs(sqlite, blob, vfsname);
        let dbInstance = blobfs.open();

        db.lockState = {
            unlock: Promise.withResolvers<void>(),
            ready: Promise.withResolvers<sqlitewasm.Database>(),
            entrants: new Set(),
            db: null
        };
        db.lockState.ready.resolve(dbInstance);
        return db;
    }

    obtainAccess() {
        if (this.lockState) {
            return this.lockState;
        }
        // state of out access/request for access
        this.lockState = {
            unlock: Promise.withResolvers<void>(),
            ready: Promise.withResolvers<sqlitewasm.Database>(),
            entrants: new Set(),
            db: null
        };
        let state = this.lockState;

        // post notification to current holder that we want the database
        console.log("requesting lock", this.name);
        let requestlock = navigator.locks.request(this.lockstealername, { mode: "exclusive", steal: true }, () => new Promise(() => null));

        // queue for the actual lock
        navigator.locks.request(this.lockholdername, { mode: "exclusive" }, async () => {
            console.log("obtained lock", this.name);
            let pool = this.pool ??= await this.sqlite.installOpfsSAHPoolVfs({
                name: this.name,
                directory: this.name
            });
            await pool.unpauseVfs();
            console.log("opening database", this.name);
            state.db = new pool.OpfsSAHPoolDb(this.name);
            state.ready.resolve(state.db);
            let timeslice = delay(500);
            // someone else requested the lock, we need to wind down and release it
            requestlock.catch(async () => {
                await timeslice;
                // stop accepting tasks, finish all actions and release the lock
                console.log("release request received for lock", this.name);
                this.lockState = null;
                Promise.all([...state.entrants]).finally(async () => {
                    this.statements.forEach(stmt => stmt.finalize());
                    this.statements.clear();
                    state.db?.close();
                    console.log("closed", this.name, "isopen", state.db?.isOpen());
                    state.db = null;
                    pool.pauseVfs();
                    console.log("releasing lock for", this.name);
                    state.unlock.resolve();
                });
            });

            return state.unlock.promise;
        });
        return this.lockState;
    }

    lockedAction<T>(callback: (db: sqlitewasm.Database) => Promise<T>) {
        let state = this.obtainAccess();
        let prom = state.ready.promise.then(db => {
            let prom = callback(db);
            state.entrants.add(prom);
            prom.finally(() => state.entrants.delete(prom));
            return prom;
        });
        state.entrants.add(prom);
        return prom;
    }

    async free() {
        this.lockState?.db?.close();
        await this.pool?.removeVfs();
    }
}


let sqliteWasmPromise: Promise<sqlitewasm.Sqlite3Static> | null = null;
export class AbstractSQLiteWasm extends AbstractSQLite {
    db: sqlitewasm.OpfsSAHPoolDatabase | null = null;
    manager: PausableSqliteWasmBackend;
    private constructor(manager: PausableSqliteWasmBackend) {
        super();
        this.manager = manager;
    }
    static async create(dbname: string, file?: Blob | undefined) {
        if (file instanceof Blob) {
            let backend = await PausableSqliteWasmBackend.createBlobDb(dbname, file);
            return new AbstractSQLiteWasm(backend)
        } else {
            let backend = await PausableSqliteWasmBackend.createSAHPoolDb(dbname);
            return new AbstractSQLiteWasm(backend);
        }
    }
    async exec(query: string) {
        return this.manager.lockedAction(async (db) => {
            db.exec(query);
        });
    }
    async prepare<ARGS extends any[], RESULTS extends any>(query: string) {
        return new AbstractSQLiteWasmStatement<ARGS, RESULTS>(this, query);
    }
    async transaction(trans: () => Promise<void>) {
        return this.manager.lockedAction(() => super.transaction(trans));
    }
    async close() {
        await this.manager.free();
    }
}

class AbstractSQLiteWasmStatement<ARGS extends any[], RESULTS extends any> extends AbstractSQLiteStatement<ARGS, RESULTS> {
    private db: AbstractSQLiteWasm;
    private sqltext: string;
    private implementation: {
        db: sqlitewasm.Database,
        stmt: sqlitewasm.PreparedStatement,
        columns: string[]
    } | null = null;
    constructor(db: AbstractSQLiteWasm, sqltext: string) {
        super();
        this.db = db;
        this.sqltext = sqltext;
    }
    run(...args: ARGS) {
        return this.db.manager.lockedAction(async (db) => {
            // the database might have been reopened since the last time
            if (!this.implementation || this.implementation.db !== db) {
                let stmt = db.prepare(this.sqltext);
                this.db.manager.statements.add(stmt);
                // bug in sqlite-wasm: stmt.getColumnNames() throws if columnCount=0
                let columns = (stmt.columnCount == 0 ? [] : stmt.getColumnNames());
                this.implementation = { db, stmt, columns };
            }
            let imp = this.implementation;
            let rows: any[] = [];
            try {
                if (imp.stmt.parameterCount != 0) {
                    imp.stmt.bind(args);
                }
                while (imp.stmt.step()) {
                    let obj: any = {};
                    for (let i = 0; i < imp.columns.length; i++) {
                        obj[imp.columns[i]] = imp.stmt.get(i);
                    }
                    rows.push(obj);
                }
            } finally {
                imp.stmt.reset();
            }
            return rows as RESULTS[];
        });
    }
}


export class WasmSQLiteManager {
    callbacks = new Map<number, PromiseWithResolvers<any>>();
    worker: Worker;
    msgidcounter = 1;
    refcount = 0;

    private constructor() {
        this.worker = new Worker(new URL("./sqlite3worker.ts", import.meta.url));
        this.worker.onmessage = e => {
            let handler = this.callbacks.get(e.data.id);
            if (e.data.error) {
                if (handler) {
                    let err = e.data.error;
                    handler.reject(new Error(err));
                }
            } else {
                handler?.resolve(e.data.data);
            }
            this.callbacks.delete(e.data.id);
        }
    }
    static instance: WasmSQLiteManager | null = null;
    static getInstance() {
        if (!this.instance) {
            this.instance = new WasmSQLiteManager();
        }
        this.instance.refcount++;
        return this.instance;
    }

    call<T>(packet: SharedWorkerPackets) {
        let id = this.msgidcounter++;
        this.worker.postMessage({ id, packet });
        let prom = Promise.withResolvers<T>();
        this.callbacks.set(id, prom);
        return prom.promise;
    }

    deref() {
        this.refcount--;
        if (this.refcount <= 0) {
            this.worker.terminate();
            WasmSQLiteManager.instance = null;
        }
    }
}
export class AbstractSQLiteWorker extends AbstractSQLite {
    private worker = WasmSQLiteManager.getInstance();
    private dbid = -1;
    private constructor() {
        super();
    }
    static async create(uniquename: string, file?: Blob) {
        let db = new AbstractSQLiteWorker();
        db.dbid = await db.worker.call<number>({ type: "sqliteopen", dbname: uniquename, file, write: false, create: false });
        return db;
    }
    async exec(query: string) {
        return this.worker.call<void>({ type: "sqliteexec", dbid: this.dbid, query });
    }
    async prepare<ARGS extends any[], RESULTS extends any>(query: string) {
        let stmtid = await this.worker.call<number>({ type: "sqliteprepare", dbid: this.dbid, query });
        return new AbstractSQLiteWorkerStatement<ARGS, RESULTS>(this.worker, stmtid);
    }
    async close() {
        return this.worker.call<void>({ type: "sqliteclose", dbid: this.dbid });
    }
}
class AbstractSQLiteWorkerStatement<ARGS extends any[], RESULTS extends any> extends AbstractSQLiteStatement<ARGS, RESULTS> {
    private stmtid: number;
    private worker: WasmSQLiteManager;
    constructor(worker: WasmSQLiteManager, stmtid: number) {
        super();
        this.worker = worker;
        this.stmtid = stmtid;
    }
    async run(...args: ARGS) {
        return this.worker.call<RESULTS[]>({ type: "sqliterunprepared", queryid: this.stmtid, args });
    }
}