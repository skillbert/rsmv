import { TypedEmitter } from "../utils";
import * as fs from "fs";
import * as path from "path";
import { useEffect } from "react";
import * as React from "react";
import { boundMethod } from "autobind-decorator";
import classNames from "classnames";
import { UIContext } from "viewer";

type ScriptState = "running" | "canceled" | "error" | "done";

export interface ScriptOutput {
	state: ScriptState;
	log(...args: any[]): void;
	writeFile(name: string, data: Buffer | string, type?: string): Promise<void>;
	setState(state: ScriptState): void;
	run<ARGS extends any[], RET extends any>(fn: (output: ScriptOutput, ...args: [...ARGS]) => Promise<RET>, ...args: ARGS): Promise<RET | null>;
}

export class CLIScriptOutput implements ScriptOutput {
	state: ScriptState = "running";
	dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	log(...args: any[]) {
		console.log(...args);
	}

	writeFile(name: string, data: Buffer, type?: string) {
		return fs.promises.writeFile(path.resolve(this.dir, name), data);
	}

	setState(state: ScriptState) {
		this.state = state;
	}

	async run<ARGS extends any[], RET extends any>(fn: (output: ScriptOutput, ...args: ARGS) => Promise<RET>, ...args: ARGS): Promise<RET | null> {
		try {
			return await fn(this, ...args);
		} catch (e) {
			if (this.state != "canceled") {
				this.log(e);
				this.setState("error");
			}
			return null;
		} finally {
			if (this.state == "running") {
				this.setState("done");
			}
		}
	}
}

export type UIScriptFile = { name: string, data: Buffer, type: string };
export class UIScriptOutput extends TypedEmitter<{ log: string, writefile: undefined, statechange: undefined }> implements ScriptOutput {
	state: ScriptState = "running";
	logs: string[] = [];
	files: UIScriptFile[] = [];
	outdirhandles: Map<string, FileSystemDirectoryHandle> | null = null;

	log(...args: any[]) {
		let str = args.join(" ");
		this.logs.push(str);
		this.emit("log", str);
	}

	async writeFile(name: string, data: Buffer, type?: string) {
		this.files.push({ name, data, type: type ?? "" });
		if (this.outdirhandles) { await this.saveLocalFile(name, data); }
		this.emit("writefile", undefined);
	}
	setState(state: ScriptState) {
		this.state = state;
		this.emit("statechange", undefined);
	}

	async setSaveDirHandle(dir: FileSystemDirectoryHandle) {
		if (await dir.requestPermission() != "granted") { throw new Error("no permission"); }
		let retroactive = !this.outdirhandles;
		this.outdirhandles = new Map();
		this.outdirhandles.set("", dir);
		if (retroactive) {
			await Promise.all(this.files.map(q => this.saveLocalFile(q.name, q.data)));
		}
		this.emit("statechange", undefined);
	}

	async saveLocalFile(filename: string, file: Buffer) {
		if (!this.outdirhandles) { throw new Error("tried to save without dir handle"); }
		let parts = filename.split("/");
		let name = parts.splice(-1, 1)[0];
		let dirname = parts.join("/");
		let dir = this.outdirhandles.get(dirname)
		if (!dir) {
			dir = this.outdirhandles.get("")!;
			for (let part of parts) {
				dir = await dir.getDirectoryHandle(part, { create: true });
			}
			this.outdirhandles.set(dirname, dir);
		}
		let filehandle = await dir.getFileHandle(name, { create: true });
		let writable = await filehandle.createWritable({ keepExistingData: false });
		await writable.write(file);
		await writable.close();
	}

	async run<ARGS extends any[], RET extends any>(fn: (output: ScriptOutput, ...args: [...ARGS]) => Promise<RET>, ...args: ARGS): Promise<RET | null> {
		try {
			return await fn(this, ...args);
		} catch (e) {
			if (this.state != "canceled") {
				this.log(e);
				this.setState("error");
			}
			return null;
		} finally {
			if (this.state == "running") {
				this.setState("done");
			}
		}
	}
}

function forceUpdateReducer(i: number) { return i + 1; }
function useForceUpdate() {
	const [, forceUpdate] = React.useReducer(forceUpdateReducer, 0);
	return forceUpdate;
}

export function OutputUI(p: { output?: UIScriptOutput | null, ctx: UIContext }) {
	let [tab, setTab] = React.useState<"console" | "files">("console");

	let forceUpdate = useForceUpdate();
	React.useLayoutEffect(() => {
		p.output?.on("statechange", forceUpdate);
		p.output?.on("writefile", forceUpdate);
		() => {
			p.output?.off("statechange", forceUpdate);
			p.output?.off("writefile", forceUpdate);
		}
	}, [p.output]);

	return (
		<div>
			<div>
				{p.output?.state}
				{p.output?.state == "running" && <input type="button" className="sub-btn" value="cancel" onClick={e => p.output?.setState("canceled")} />}
			</div>
			{p.output && !p.output.outdirhandles && <input type="button" className="sub-btn" value={"Save files " + p.output?.files.length} onClick={async e => p.output?.setSaveDirHandle(await showDirectoryPicker({}))} />}
			{p.output?.outdirhandles && <div>Saved files to disk: {p.output.files.length}</div>}
			<div className="sidebar-browser-tab-strip">
				<div className={classNames("rsmv-icon-button", { active: tab == "console" })} onClick={e => setTab("console")}>Console</div>
				<div className={classNames("rsmv-icon-button", { active: tab == "files" })} onClick={e => setTab("files")}>Files</div>
			</div>
			{tab == "console" && <UIScriptConsole output={p.output} />}
			{tab == "files" && <UIScriptFiles output={p.output} onSelect={p.ctx.openFile} />}
		</div>
	)

}

export function UIScriptFiles(p: { output?: UIScriptOutput | null, onSelect: (file: UIScriptFile | null) => void }) {
	let [files, setFiles] = React.useState(p.output?.files);

	useEffect(() => {
		if (p.output) {
			let onchange = () => setFiles(p.output!.files);
			p.output.on("writefile", onchange);
			return () => p.output?.off("writefile", onchange);
		}
	}, [p.output]);

	if (!files) {
		return <div />;
	}
	else {
		const maxlist = 100;
		return (
			<div>
				{files.length > maxlist && <div>Only showing first {maxlist} files</div>}
				{files.slice(0, maxlist).map(q => (<div key={q.name} onClick={e => p.onSelect(q)}>{q.name}</div>))}
			</div>
		);
	}
}

export function UIScriptConsole(p: { output?: UIScriptOutput | null }) {
	let [el, setEl] = React.useState<HTMLDivElement | null>(null);

	useEffect(() => {
		if (el && p.output) {
			let onlog = (e: string) => {
				let line = document.createElement("div");
				line.innerText = e;
				el!.appendChild(line);
			}
			p.output.on("log", onlog);
			p.output.logs.forEach(onlog);
			return () => {
				p.output!.off("log", onlog);
				el!.innerHTML = "";
			}
		}
	}, [p.output, el]);

	return (
		<div ref={setEl} />
	);
}
