import type * as sqlite3 from "sqlite3";
import type sqlitewasm from "sql.js";
import { SharedWorkerPackets } from "./sqlite3worker";
import { delay } from "../utils";


export abstract class AbstractSQLiteStatement {
    abstract run(args?: any[]): Promise<any[]>;
}

export abstract class AbstractSQLite {
    abstract exec(query: string): Promise<void>;
    abstract prepare(query: string): Promise<AbstractSQLiteStatement>;
    abstract close(): Promise<void>;
}

export class AbstractSQLiteNode extends AbstractSQLite {
    private db: sqlite3.Database = null!;
    private constructor() {
        super();
    }
    static async create(filepath: string, opts: { write?: boolean, create?: boolean }) {
        let db = new AbstractSQLiteNode();
        //only actually load the dependency when used
        let sqlite = __non_webpack_require__("sqlite3") as typeof import("sqlite3");
        let flags = (opts.write ? sqlite.OPEN_READWRITE : sqlite.OPEN_READONLY) | (opts.create ? sqlite.OPEN_CREATE : 0);
        db.db = await new Promise<sqlite3.Database>((done, err) => {
            let res = new sqlite.Database(filepath, flags, e => e ? err(e) : done(res));
        });
        return db;
    }
    async exec(query: string) {
        return new Promise<void>((done, err) => {
            this.db.exec(query, e => e ? err(e) : done());
        });
    }
    async prepare(query: string) {
        return new Promise<AbstractSQLiteNodeStatement>((done, err) => {
            let stmt = this.db.prepare(query, e => e ? err(e) : done(new AbstractSQLiteNodeStatement(stmt)));
        });
    }
    async close() {
        return new Promise<void>((done, err) => {
            this.db.close(e => e ? err(e) : done());
        });
    }
}
class AbstractSQLiteNodeStatement extends AbstractSQLiteStatement {
    private stmt: sqlite3.Statement;
    constructor(stmt: sqlite3.Statement) {
        super();
        this.stmt = stmt;
    }
    async run(args?: any[]) {
        return new Promise<any[]>((done, err) => {
            this.stmt.all(args, (e, rows) => e ? err(e) : done(rows));
        });
    }
}

export class AbstractSQLiteWasm extends AbstractSQLite {
    private db: sqlitewasm.Database = null!;
    private constructor() {
        super();
    }
    static async create(file: Blob | FileSystemFileHandle) {
        let db = new AbstractSQLiteWasm();
        let sqlite = await import("sql.js/dist/sql-wasm-workerfs.js").then((q: typeof import("sql.js")) => q.default());
        db.db = new sqlite.Database(file as any);
        return db;
    }
    async exec(query: string) {
        this.db.exec(query);
    }
    async prepare(query: string) {
        let stmt = this.db.prepare(query);
        return new AbstractSQLiteWasmStatement(stmt);
    }
    async close() {
        this.db.close();
    }
}
class AbstractSQLiteWasmStatement extends AbstractSQLiteStatement {
    private stmt: sqlitewasm.Statement
    constructor(stmt: sqlitewasm.Statement) {
        super();
        this.stmt = stmt;
    }
    async run(args?: any[]) {
        this.stmt.bind(args);
        let rows: any[] = [];
        while (this.stmt.step()) {
            rows.push(this.stmt.getAsObject());
        }
        return rows;
    }
}




export class WasmSQLiteManager {
    callbacks = new Map<number, { resolve: (res: any) => void, reject: (err: Error) => void, reqpacket: SharedWorkerPackets }>();
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
        return new Promise<T>((resolve, reject) => this.callbacks.set(id, { resolve, reject, reqpacket: packet }));
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
    static async create(uniquename: string, file: Blob | FileSystemFileHandle) {
        let db = new AbstractSQLiteWorker();
        await delay(1000);
        db.dbid = await db.worker.call<number>({ type: "sqliteopen", dbname: uniquename, file, write: false, create: false });
        return db;
    }
    async exec(query: string) {
        return this.worker.call<void>({ type: "sqliteexec", dbid: this.dbid, query });
    }
    async prepare(query: string) {
        let stmtid = await this.worker.call<number>({ type: "sqliteprepare", dbid: this.dbid, query });
        return new AbstractSQLiteWorkerStatement(this.worker, stmtid);
    }
    async close() {
        return this.worker.call<void>({ type: "sqliteclose", dbid: this.dbid });
    }
}
class AbstractSQLiteWorkerStatement extends AbstractSQLiteStatement {
    private stmtid: number;
    private worker: WasmSQLiteManager;
    constructor(worker: WasmSQLiteManager, stmtid: number) {
        super();
        this.worker = worker;
        this.stmtid = stmtid;
    }
    async run(args?: any[]) {
        return this.worker.call<any[]>({ type: "sqliterunprepared", queryid: this.stmtid, args });
    }
}