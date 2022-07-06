import { TypedEmitter } from "../utils";
import * as fs from "fs";
import * as path from "path";
import { useEffect } from "react";
import * as React from "react";
import classNames from "classnames";
import { UIContext } from "./maincomponents";
import { TabStrip } from "./commoncontrols";
import { showModal } from "./jsonsearch";
import VR360Viewer from "../libs/vr360viewer";

type ScriptState = "running" | "canceled" | "error" | "done";

export interface ScriptOutput {
	state: ScriptState;
	log(...args: any[]): void;
	setUI(ui: HTMLElement | null): void;
	mkDir(name: string): Promise<any>;
	writeFile(name: string, data: Buffer | string): Promise<void>;
	setState(state: ScriptState): void;
	run<ARGS extends any[], RET extends any>(fn: (output: ScriptOutput, ...args: [...ARGS]) => Promise<RET>, ...args: ARGS): Promise<RET | null>;
}

export class CLIScriptOutput implements ScriptOutput {
	state: ScriptState = "running";
	dir: string;

	constructor(dir: string) {
		this.dir = dir;
		if (dir) { fs.mkdirSync(dir, { recursive: true }); }
	}

	log(...args: any[]) {
		console.log(...args);
	}

	setUI(ui: HTMLElement | null) {
		if (ui && typeof document != "undefined") {
			document.body.appendChild(ui)
		}
	}

	mkDir(name: string) {
		return fs.promises.mkdir(path.resolve(this.dir, name), { recursive: true });
	}
	writeFile(name: string, data: Buffer | string) {
		return fs.promises.writeFile(path.resolve(this.dir, name), data);
	}

	setState(state: ScriptState) {
		this.state = state;
	}

	async run<ARGS extends any[], RET extends any>(fn: (output: ScriptOutput, ...args: ARGS) => Promise<RET>, ...args: ARGS): Promise<RET | null> {
		try {
			return await fn(this, ...args);
		} catch (e) {
			console.warn(e);
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

export type UIScriptFile = { name: string, data: Buffer | string };
export class UIScriptOutput extends TypedEmitter<{ log: string, writefile: undefined, statechange: undefined }> implements ScriptOutput {
	state: ScriptState = "running";
	logs: string[] = [];
	files: UIScriptFile[] = [];
	rootdirhandle: FileSystemDirectoryHandle | null = null;
	outdirhandles = new Map<string, FileSystemDirectoryHandle | null>();
	outputui: HTMLElement | null = null;

	log(...args: any[]) {
		let str = args.join(" ");
		this.logs.push(str);
		this.emit("log", str);
	}

	async mkDir(name: string) {
		this.outdirhandles.set(name, null);
		this.emit("writefile", undefined);
	}
	async writeFile(name: string, data: Buffer | string) {
		this.files.push({ name, data });
		if (this.rootdirhandle) { await this.saveLocalFile(name, data); }
		this.emit("writefile", undefined);
	}
	setState(state: ScriptState) {
		this.state = state;
		this.emit("statechange", undefined);
	}
	setUI(el: HTMLElement | null) {
		this.outputui = el;
		this.emit("statechange", undefined);
	}

	async setSaveDirHandle(dir: FileSystemDirectoryHandle) {
		if (await dir.requestPermission() != "granted") { throw new Error("no permission"); }
		let retroactive = !this.outdirhandles;
		this.outdirhandles = new Map();
		this.outdirhandles.set("", dir);
		if (retroactive) {
			for (let [dir, handle] of this.outdirhandles.entries()) {
				if (!handle) { await this.mkdirLocal(dir.split("/")); }
			}
			await Promise.all(this.files.map(q => this.saveLocalFile(q.name, q.data)));
		}
		this.emit("statechange", undefined);
	}

	async mkdirLocal(path: string[]) {
		let dirname = path.join("/");
		let dir = this.outdirhandles.get(dirname);
		if (!dir) {
			dir = this.rootdirhandle!;
			for (let part of path) {
				dir = await dir.getDirectoryHandle(part, { create: true });
			}
			this.outdirhandles.set(dirname, dir);
		}
		return dir;
	}

	async saveLocalFile(filename: string, file: Buffer | string) {
		if (!this.outdirhandles) { throw new Error("tried to save without dir handle"); }
		let parts = filename.split("/");
		let name = parts.splice(-1, 1)[0];
		let dir = await this.mkdirLocal(parts);
		let filehandle = await dir.getFileHandle(name, { create: true });
		let writable = await filehandle.createWritable({ keepExistingData: false });
		await writable.write(file);
		await writable.close();
	}

	async run<ARGS extends any[], RET extends any>(fn: (output: ScriptOutput, ...args: [...ARGS]) => Promise<RET>, ...args: ARGS): Promise<RET | null> {
		try {
			return await fn(this, ...args);
		} catch (e) {
			console.warn(e);
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
export function useForceUpdate() {
	const [, forceUpdate] = React.useReducer(forceUpdateReducer, 0);
	return forceUpdate;
}

export function VR360View(p: { img: string | ImageData | TexImageSource }) {
	let viewer = React.useRef<VR360Viewer | null>(null);
	if (!viewer.current) {
		viewer.current = new VR360Viewer(p.img);
		viewer.current.cnv.style.width = "100%";
		viewer.current.cnv.style.height = "100%";
	}

	let currentimg = React.useRef(p.img);
	if (p.img != currentimg.current) {
		viewer.current.setImage(p.img);
		currentimg.current = p.img;
	}

	React.useEffect(() => () => viewer.current?.free(), []);

	let wrapper = React.useRef<HTMLElement | null>(null);
	let ref = (el: HTMLElement | null) => {
		viewer.current?.cnv && el && el.appendChild(viewer.current?.cnv);
		wrapper.current = el;
	}

	return (
		<React.Fragment>
			<div>
				<input type="button" className="sub-btn" value="Fullscreen" onClick={() => wrapper.current?.requestFullscreen()} />
			</div>
			<div ref={ref} style={{ position: "relative", paddingBottom: "60%" }} />
		</React.Fragment>
	)
}

export function DomWrap(p: { el: HTMLElement | null | undefined, style?: React.CSSProperties }) {
	let ref = (el: HTMLElement | null) => {
		p.el && el && el.appendChild(p.el);
	}
	return <div ref={ref} style={p.style}></div>;
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
			{p.output && !p.output.rootdirhandle && <input type="button" className="sub-btn" value={"Save files " + p.output?.files.length} onClick={async e => p.output?.setSaveDirHandle(await showDirectoryPicker({}))} />}
			{p.output?.rootdirhandle && <div>Saved files to disk: {p.output.files.length}</div>}
			{p.output?.outputui && <input type="button" className="sub-btn" value="Script ui" onClick={e => showModal({ title: "Script output" }, <DomWrap el={p.output?.outputui} />)} />}
			<TabStrip value={tab} onChange={setTab as any} tabs={{ console: "Console", files: "Files" }} />
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
		const maxlist = 1000;
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
