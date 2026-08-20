import type * as sqlite3 from "sqlite3";
import type * as sqlitewasm from "@sqlite.org/sqlite-wasm";
import { SharedWorkerPackets } from "./sqlite3worker";
import { installBlobVfs } from "./sqlite3blobfs";
import fs from "fs/promises";
import path from "path";

const nodecachefolder = "./cache";

export abstract class AbstractSQLiteStatement<ARGS extends any[], RESULTS extends any> {
    abstract run(...args: ARGS): Promise<RESULTS[]>;
}

export abstract class AbstractSQLite {
    abstract exec(query: string): Promise<void>;
    abstract prepare<ARGS extends any[], RESULTS extends any>(query: string): Promise<AbstractSQLiteStatement<ARGS, RESULTS>>;
    abstract close(): Promise<void>;
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

export class AbstractSQLiteWasm extends AbstractSQLite {
    private db: sqlitewasm.Database = null!;
    private constructor() {
        super();
    }
    static async create(file: Blob | undefined) {
        let db = new AbstractSQLiteWasm();
        let sqlite = await import("@sqlite.org/sqlite-wasm").then((q) => q.default());
        sqlite.client ??= {};
        if (file instanceof Blob) {
            let vfsname = "" + Math.random()
            let blobfs = installBlobVfs(sqlite, file, vfsname);
            db.db = blobfs.open();
        } else {
            sqlite.client.opfsSAHPool ??= await sqlite.installOpfsSAHPoolVfs({});
            db.db = new sqlite.client.opfsSAHPool.OpfsSAHPoolDb(file);
        }
        return db;
    }
    async exec(query: string) {
        this.db.exec(query);
    }
    async prepare<ARGS extends any[], RESULTS extends any>(query: string) {
        let stmt = this.db.prepare(query);
        return new AbstractSQLiteWasmStatement<ARGS, RESULTS>(stmt);
    }
    async close() {
        this.db.close();
    }
}
class AbstractSQLiteWasmStatement<ARGS extends any[], RESULTS extends any> extends AbstractSQLiteStatement<ARGS, RESULTS> {
    private stmt: sqlitewasm.PreparedStatement
    private columns: string[]
    constructor(stmt: sqlitewasm.PreparedStatement) {
        super();
        this.stmt = stmt;
        // bug in sqlite-wasm: stmt.getColumnNames() throws if columnCount=0
        this.columns = (stmt.columnCount == 0 ? [] : stmt.getColumnNames());
    }
    async run(...args: ARGS) {
        let rows: any[] = [];
        try {
            if (this.stmt.parameterCount != 0) {
                this.stmt.bind(args);
            }
            while (this.stmt.step()) {
                let obj: any = {};
                for (let i = 0; i < this.columns.length; i++) {
                    obj[this.columns[i]] = this.stmt.get(i);
                }
                rows.push(obj);
            }
        } finally {
            this.stmt.reset();
        }
        return rows as RESULTS[];
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