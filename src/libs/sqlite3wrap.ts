import type * as sqlite3 from "sqlite3";


export function sqliteOpenDatabase(filepath: string, opts: { write?: boolean, create?: boolean }) {
    //only actually load the dependency when used
    let sqlite = __non_webpack_require__("sqlite3") as typeof import("sqlite3");
    let flags = (opts.write ? sqlite.OPEN_READWRITE : sqlite.OPEN_READONLY) | (opts.create ? sqlite.OPEN_CREATE : 0);
    return new Promise<sqlite3.Database>((done, err) => {
        let db = new sqlite.Database(filepath, flags, e => e ? err(e) : done(db));
    });
}

export function sqlitePrepare(db: sqlite3.Database, query: string) {
    return new Promise<sqlite3.Statement>((done, err) => {
        let stmt = db.prepare(query, e => e ? err(e) : done(stmt));
    });
}

export function sqliteExec(db: sqlite3.Database, query: string) {
    return new Promise<void>((done, err) => {
        db.exec(query, e => e ? err(e) : done());
    });
}

export function sqliteRunStatement(statement: sqlite3.Statement, args?: any[]) {
    return new Promise<any[]>((done, err) => {
        statement.all(args, (e, rows) => e ? err(e) : done(rows));
    });
}