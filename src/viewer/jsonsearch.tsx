import * as React from "react";
import { EngineCache, ob3ModelToThreejsNode, ThreejsSceneCache } from "../3d/ob3tothree";
import { ModelBrowser, StringInput, InputCommitted } from "./scenenodes";

import { JSONSchema6Definition, JSONSchema6, JSONSchema6TypeName } from "json-schema";
import { cacheFileDecodeModes } from "../scripts/extractfiles";


export function JsonSearch(p: { mode: keyof typeof cacheFileDecodeModes, cache: EngineCache, onSelect: (id: number) => void }) {
	let [path, setPath] = React.useReducer((prev: string[], action: { depth: number, value: string }) => {
		return prev.slice(0, action.depth).concat(action.value);
	}, []);
	let [search, setsearch] = React.useState("");
	let [files, setFiles] = React.useState<any[]>([]);
	let { schema, files: filesprom } = p.cache.getJsonData(p.mode);
	React.useEffect(() => { filesprom.then(setFiles) }, [filesprom]);

	let optsthree: string[][] = [];
	let def = schema;
	let searchtype: JSONSchema6TypeName = "any";
	let partindex = 0;
	let lastdef: typeof def | null = null;
	while (lastdef != def) {
		let part = path[partindex] as string | undefined;
		lastdef = def;
		if (typeof def != "object") { break; }
		if (def.oneOf) {
			if (def.oneOf.length == 2 && typeof def.oneOf[1] == "object" && def.oneOf[1].type == "null") {
				def = def.oneOf[part == "null" ? 1 : 0];
			}
		} else if (def.type == "object") {
			if (def.properties) {
				optsthree.push(Object.keys(def.properties));
				if (part) {
					def = def.properties![part];
					partindex++;
				}
			}
		} else if (def.type == "array") {
			if (def.items) {
				if (typeof def.items != "object") { throw new Error("only standard array props supported") }
				if (Array.isArray(def.items)) {
					optsthree.push(Object.keys(def.items));
					if (part) {
						def = def.items[part];
						partindex++;
					}
				} else {
					def = def.items;
				}
			}
		} else if (typeof def.type == "string") {
			searchtype = def.type;
		} else {
			console.log("unknown jsonschema type");
		}
	}

	const searchstring = search.toLowerCase();
	const searchnum = +search;
	const searchbool = search == "true";
	const hasprop = (o: object, p: string) => Object.prototype.hasOwnProperty.call(o, p);
	const filtered: { file: any, val: any }[] = [];
	let totalmatches = 0;

	const getprop = function* (prop: any, path: string[], depth: number) {
		if (Array.isArray(prop)) {
			for (let sub of prop) {
				yield* getprop(sub, path, depth);
			}
			return false;
		} else if (depth < path.length) {
			let part = path[depth];
			if (typeof prop != "object" || !hasprop(prop, part)) { return false; }
			yield* getprop(prop[part], path, depth + 1);
		} else {
			yield prop;
		}
	}
	for (let file of files) {
		for (let prop of getprop(file, path, 0)) {
			let match = false;

			if (searchtype == "string" && typeof prop == "string" && prop.toLowerCase().indexOf(searchstring) != -1) { match = true; }
			if ((searchtype == "integer" || searchtype == "number") && typeof prop == "number" && prop == searchnum) { match = true; }
			if ((searchtype == "integer" || searchtype == "number") && typeof prop == "number" && prop == searchnum) { match = true; }
			if (searchtype == "boolean" && typeof prop == "boolean" && prop == searchbool) { match = true; }
			if (match) {
				if (filtered.length < 100) {
					filtered.push({ file, val: prop });
				}
				totalmatches++;
				break;
			}
		}
	}

	return (
		<React.Fragment>
			{optsthree.map((opts, i) => (
				<select key={i} value={path[i]} onChange={e => setPath({ depth: i, value: e.currentTarget.value })}>
					{opts.map((opt, j) => (<option key={opt} value={opt}>{opt}</option>))}
				</select>
			))}
			{searchtype == "string" && <input value={search} onChange={e => setsearch(e.currentTarget.value)} type="text" />}
			{(searchtype == "number" || searchtype == "integer") && <input value={search} onChange={e => setsearch(e.currentTarget.value)} type="number" />}
			{searchtype == "boolean" && <label><input checked={search == "true"} onChange={e => setsearch(e.currentTarget.checked + "")} type="checkbox" />True</label>}
			<div style={{ flex: "1" }}>
				<div>{totalmatches} Matches</div>
				{filtered.map((q, i) => (
					<div key={q.file.$fileid} onClick={e => p.onSelect(q.file.$fileid)}>{q.file.$fileid} - {q.val + ""}</div>
				))}
			</div>
		</React.Fragment>
	)
}