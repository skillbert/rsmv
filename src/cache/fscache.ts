import * as fs from "fs/promises";
import * as path from "path";
import { AbstractSQLite, AbstractSQLiteNode, AbstractSQLiteStatement, AbstractSQLiteWorker } from "../libs/sqlite3wrap";

const cachefile = "fscache.sqlite3";

export class FileSourceFsCache {
    ready: Promise<void>;
    isready: boolean;
    database!: AbstractSQLite;
    getstatement!: AbstractSQLiteStatement;
    setstatement!: AbstractSQLiteStatement;

    static tryCreate() {
        try {
            return new FileSourceFsCache(cachefile);
        } catch {
            return null;
        }
    }

    constructor(filename: string) {
        this.isready = false;
        this.ready = (async () => {
            if (!!fs.constants) {
                // nodejs
                this.database = await AbstractSQLiteNode.create(filename, { create: true, write: true });
            } else {
                // web
                this.database = await AbstractSQLiteWorker.create(filename);
            }
            await this.database.exec(`CREATE TABLE IF NOT EXISTS groupcache (major INT, minor INT, crc UNSIGNED INT, file BLOB);`);
            await this.database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS mainindex ON groupcache(major,minor,crc)`);

            this.getstatement = await this.database.prepare(`SELECT major, minor, crc, file FROM groupcache WHERE major=? AND minor=? AND crc=?`);
            this.setstatement = await this.database.prepare(`INSERT INTO groupcache(major,minor,crc,file) VALUES (?,?,?,?)`);

            this.isready = true;
        })()
    }

    async addFile(major: number, minor: number, crc: number, file: Buffer) {
        if (!this.isready) {
            await this.ready;
        }
        console.log("saving", major, minor, crc, "len", file.length);
        await this.setstatement.run([major, minor, crc, file]);
    }

    async getFile(major: number, minor: number, crc: number): Promise<Buffer | null> {
        if (!this.isready) {
            await this.ready;
        }
        let cached = await this.getstatement.run([major, minor, crc]);
        if (cached.length > 1) {
            throw new Error("more than one match for fs cached file");
        }
        if (cached.length == 1) {
            let file = cached[0].file;
            if (!file) {
                throw new Error(`file ${major}.${minor} not found (explicitly missing in cache)`);
            }
            // Buffer doesn't survive the trip from worker
            if (!(file instanceof Buffer)) {
                file = Buffer.from(file);
            }
            return file;
        }
        return null;
    }
}
