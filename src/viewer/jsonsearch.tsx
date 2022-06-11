import * as React from "react";
import * as ReactDOM from "react-dom";
import { EngineCache, ob3ModelToThreejsNode, ThreejsSceneCache } from "../3d/ob3tothree";
import { ModelBrowser, StringInput, InputCommitted, JsonDisplay } from "./scenenodes";

import { JSONSchema6Definition, JSONSchema6, JSONSchema6TypeName } from "json-schema";
import { cacheFileDecodeModes } from "../scripts/extractfiles";
import { UIContext, UIContextReady } from "./maincomponents";

function ModalFrame(p: { children: React.ReactNode, title: React.ReactNode, onClose: () => void }) {
	return (
		<div className="mv-modal-container">
			<div className="mv-modal">
				<div className="mv-modal-head">
					<span>{p.title}</span>
					<span onClick={p.onClose}>X</span>
				</div>
				<div className="mv-modal-body">
					{p.children}
				</div>
			</div>
		</div>
	)
}

export function selectEntity(ctx: UIContextReady, mode: keyof typeof cacheFileDecodeModes, callback: (id: number) => void, initialFilters: JsonSearchFilter[] = []) {
	let rootel = document.createElement("div");
	rootel.classList.add("mv-style");
	document.body.appendChild(rootel);
	let removed = false;

	let close = () => {
		if (!removed) {
			removed = true;
			ReactDOM.unmountComponentAtNode(rootel);
			rootel.remove();
		}
	}

	let onselect = (id: number, obj: object) => {
		close();
		callback(id);
	}

	ReactDOM.render((
		<ModalFrame onClose={close} title="Select item">
			<JsonSearchPreview cache={ctx.sceneCache.cache} mode={mode} onSelect={onselect} initialFilters={initialFilters} />
		</ModalFrame>
	), rootel);

	return close;
}

export function JsonSearchPreview(p: { mode: keyof typeof cacheFileDecodeModes, cache: EngineCache, onSelect: (id: number, obj: object) => void, initialFilters: JsonSearchFilter[] }) {
	let [selid, setSelid] = React.useState(-1);
	let [selobj, setSelobj] = React.useState<object | null>(null);

	const onchange = (id: number, obj: object) => {
		setSelid(id);
		setSelobj(obj);
	}

	return (
		<div style={{ display: "grid", gridTemplateColumns: "40% 60%", height: "100%" }}>
			<div>
				<JsonSearch cache={p.cache} mode={p.mode} onSelect={onchange} initialFilters={p.initialFilters} />
			</div>
			<div>
				{selobj && <input type="button" className="sub-btn" value="Select" onClick={e => p.onSelect(selid, selobj!)} />}
				<JsonDisplay obj={selobj} />
			</div>
		</div>
	)
}

type JsonSearchFilter = { path: string[], search: string };

export function JsonSearch(p: { mode: keyof typeof cacheFileDecodeModes, cache: EngineCache, onSelect: (id: number, obj: object) => void, initialFilters: JsonSearchFilter[] }) {
	const { schema, files: filesprom } = p.cache.getJsonData(p.mode);
	let initfilters = p.initialFilters
	if (p.initialFilters.length == 0 && typeof schema == "object") {
		if (schema.properties?.name) { initfilters = [{ path: ["name"], search: "" }] }
	}
	const [filters, setFilters] = React.useState<JsonSearchFilter[]>(initfilters);
	const [files, setFiles] = React.useState<any[]>([]);

	const editFilters = (index: number, cb?: (f: JsonSearchFilter) => void) => {
		let newfilters = filters.map(q => ({ path: q.path.slice(), search: q.search }));
		if (!cb) { newfilters.splice(index, 1); }
		else {
			let filter = newfilters[index];
			if (!filter) {
				filter = { path: [], search: "" };
				newfilters[index] = filter;
			}
			cb(filter);
		}
		setFilters(newfilters);
	}

	React.useEffect(() => { filesprom.then(setFiles) }, [filesprom]);

	const hasprop = (o: object, p: string) => Object.prototype.hasOwnProperty.call(o, p);
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

	let filtered = files;
	let actualfilters: { filter: JsonSearchFilter, searchtype: JSONSchema6TypeName, optsthree: string[][] }[] = [];
	for (let filter of filters) {
		let optsthree: string[][] = [];
		let def = schema;
		let searchtype: JSONSchema6TypeName = "any";
		let partindex = 0;
		let lastdef: typeof def | null = null;
		while (lastdef != def) {
			let part = filter.path[partindex] as string | undefined;
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
		actualfilters.push({ filter, optsthree, searchtype })

		const searchstring = filter.search.toLowerCase();
		const searchnum = +filter.search;
		const searchbool = filter.search == "true";

		filtered = filtered.filter(file => {
			for (let prop of getprop(file, filter.path, 0)) {
				let match = false;

				if (searchtype == "string" && typeof prop == "string" && prop.toLowerCase().indexOf(searchstring) != -1) { match = true; }
				if ((searchtype == "integer" || searchtype == "number") && typeof prop == "number" && prop == searchnum) { match = true; }
				if (searchtype == "boolean" && typeof prop == "boolean" && prop == searchbool) { match = true; }
				if (match) {
					return true;
				}
			}
			return false;
		});
	}


	const displayprop = filters[filters.length - 1]?.path ?? [];
	return (
		<React.Fragment>
			<div style={{ flex: "1" }}>
				{actualfilters.map((q, i) => <JsonFilterUI key={i} index={i} filter={q.filter} editFilters={editFilters} optsthree={q.optsthree} searchtype={q.searchtype} />)}
				<input type="button" className="sub-btn" value="extra filter" onClick={e => editFilters(actualfilters.length, () => { })} />
				<div>{filtered.length} Matches</div>
				{filtered.slice(0, 100).map((q, i) => (
					<div key={q.$fileid} onClick={e => p.onSelect(q.$fileid, q)}>{q.$fileid} - {filters.map(f => getprop(q, f.path, 0).next().value + "").join(", ")}</div>
				))}
			</div>
		</React.Fragment>
	)
}

function JsonFilterUI(p: { index: number, filter: JsonSearchFilter, optsthree: string[][], searchtype: JSONSchema6TypeName, editFilters: (index: number, cb?: (f: JsonSearchFilter) => void) => void }) {
	return (
		<div style={{ display: "grid", gridTemplateColumns: "repeat(5,auto)" }}>
			{p.optsthree.map((opts, i) => (
				<select key={i} value={p.filter.path[i]} onChange={e => p.editFilters(p.index, f => f.path.splice(i, 100, e.currentTarget.value))}>
					{opts.map((opt, j) => (<option key={opt} value={opt}>{opt}</option>))}
				</select>
			))}
			{p.searchtype == "string" && (
				<input value={p.filter.search} onChange={e => p.editFilters(p.index, f => f.search = e.currentTarget.value)} type="text" />
			)}
			{(p.searchtype == "number" || p.searchtype == "integer") && (
				<input value={p.filter.search} onChange={e => p.editFilters(p.index, f => f.search = e.currentTarget.value)} type="number" />
			)}
			{p.searchtype == "boolean" && (
				<label>
					<input checked={p.filter.search == "true"} onChange={e => p.editFilters(p.index, f => f.search = e.currentTarget.checked + "")} type="checkbox" />
					True
				</label>
			)}
			<input type="button" className="sub-btn" value="x" onClick={e => p.editFilters(p.index)} />
		</div>
	)
}