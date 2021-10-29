import * as opdecoder from "./opdecoder";
import * as sqlite3 from "sqlite3" // Not strictly necessary, but it'll already be loaded and it helps to let the IDE know what class we're using

/**
 * @param {sqlite3.Database} db The database object
 * @param {Buffer} buffer The decompressed buffer of the item
 */
export function handle(db: sqlite3.Database, buffer: Buffer) {
	return opdecoder.decode(__dirname+"/opcodes/npcs.json", buffer);
}