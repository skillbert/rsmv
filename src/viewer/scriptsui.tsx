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
	setState(state: ScriptState): void;
	run<ARGS extends any[], RET extends any>(fn: (output: ScriptOutput, ...args: [...ARGS]) => Promise<RET>, ...args: ARGS): Promise<RET | null>;
}

export interface ScriptFS {
	mkDir(name: string): Promise<any>;
	writeFile(name: string, data: Buffer | string): Promise<void>;
	readFileText(name: string): Promise<string>,
	readFileBuffer(name: string): Promise<Buffer>,
	readDir(name: string): Promise<string[]>,
	unlink(name: string): Promise<void>
}

export class CLIScriptFS implements ScriptFS {
	dir: string;
	constructor(dir: string) {
		this.dir = path.resolve(dir);
		if (dir) { fs.mkdirSync(dir, { recursive: true }); }
	}
	mkDir(name: string) {
		return fs.promises.mkdir(path.resolve(this.dir, name), { recursive: true });
	}
	writeFile(name: string, data: Buffer | string) {
		return fs.promises.writeFile(path.resolve(this.dir, name), data);
	}
	readFileBuffer(name: string) {
		return fs.promises.readFile(path.resolve(this.dir, name));
	}
	readFileText(name: string) {
		return fs.promises.readFile(path.resolve(this.dir, name), "utf-8");
	}
	readDir(name: string): Promise<string[]> {
		return fs.promises.readdir(path.resolve(this.dir, name));
	}
	unlink(name: string) {
		return fs.promises.unlink(path.resolve(this.dir, name));
	}
}

export class CLIScriptOutput implements ScriptOutput {
	state: ScriptState = "running";

	//bind instead of call so the original call site is retained while debugging
	log = console.log.bind(console);

	setUI(ui: HTMLElement | null) {
		if (ui && typeof document != "undefined") {
			document.body.appendChild(ui)
		}
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

export class UIScriptFS extends TypedEmitter<{ writefile: undefined }> implements ScriptFS {
	files: UIScriptFile[] = [];
	rootdirhandle: FileSystemDirectoryHandle | null = null;
	outdirhandles = new Map<string, FileSystemDirectoryHandle | null>();
	output: UIScriptOutput;

	constructor(output: UIScriptOutput) {
		super();
		this.output = output;
	}

	async mkDir(name: string) {
		this.outdirhandles.set(name, null);
		this.emit("writefile", undefined);
		this.output.emit("writefile", undefined);
	}
	async writeFile(name: string, data: Buffer | string) {
		this.files.push({ name, data });
		if (this.rootdirhandle) { await this.saveLocalFile(name, data); }
		this.emit("writefile", undefined);
		this.output.emit("writefile", undefined);
	}
	readFileBuffer(name: string): Promise<Buffer> {
		throw new Error("not implemented");
	}
	readFileText(name: string): Promise<string> {
		throw new Error("not implemented");
	}
	readDir(name: string): Promise<string[]> {
		throw new Error("not implemented");
	}
	unlink(name: string): Promise<void> {
		throw new Error("not implemented");
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
		this.output.emit("statechange", undefined);
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
}

export class UIScriptOutput extends TypedEmitter<{ log: string, statechange: undefined, writefile: undefined }> implements ScriptOutput {
	state: ScriptState = "running";
	logs: string[] = [];
	outputui: HTMLElement | null = null;
	fs: Record<string, UIScriptFS>;

	log(...args: any[]) {
		let str = args.join(" ");
		this.logs.push(str);
		this.emit("log", str);
	}

	setState(state: ScriptState) {
		this.state = state;
		this.emit("statechange", undefined);
	}
	setUI(el: HTMLElement | null) {
		this.outputui = el;
		this.emit("statechange", undefined);
	}

	constructor() {
		super();
		this.fs = {};
	}

	makefs(name: string) {
		let fs = new UIScriptFS(this);
		this.fs[name] = fs;
		this.emit("statechange", undefined);
		return fs;
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
	let [tab, setTab] = React.useState<"console" | string>("console");

	let forceUpdate = useForceUpdate();
	React.useLayoutEffect(() => {
		p.output?.on("statechange", forceUpdate);
		p.output?.on("writefile", forceUpdate);
		() => {
			p.output?.off("statechange", forceUpdate);
			p.output?.off("writefile", forceUpdate);
		}
	}, [p.output]);

	if (!p.output) {
		return (
			<div>Waiting</div>
		);
	}

	let fstabmatch = tab.match(/^fs-(.*)$/);
	let selectedfs = fstabmatch && p.output && p.output.fs[fstabmatch[1]];

	let tabs = { console: "Console" };
	for (let fsname in p.output?.fs) { tabs["fs-" + fsname] = fsname; }

	return (
		<div>
			<div>
				Script state: {p.output.state}
				{p.output.state == "running" && <input type="button" className="sub-btn" value="cancel" onClick={e => p.output?.setState("canceled")} />}
			</div>
			{p.output.outputui && <input type="button" className="sub-btn" value="Script ui" onClick={e => showModal({ title: "Script output" }, <DomWrap el={p.output?.outputui} />)} />}
			<TabStrip value={tab} onChange={setTab as any} tabs={tabs} />
			{tab == "console" && <UIScriptConsole output={p.output} />}
			{selectedfs && <UIScriptFiles fs={selectedfs} onSelect={p.ctx.openFile} />}
		</div>
	)

}

export function UIScriptFiles(p: { fs?: UIScriptFS | null, onSelect: (file: UIScriptFile | null) => void }) {
	let [files, setFiles] = React.useState(p.fs?.files);

	useEffect(() => {
		if (p.fs) {
			let onchange = () => setFiles(p.fs!.files);
			p.fs.on("writefile", onchange);
			return () => p.fs?.off("writefile", onchange);
		}
	}, [p.fs]);

	if (!files) {
		return <div />;
	}
	else {
		const maxlist = 1000;
		return (
			<div>
				{p.fs && !p.fs.rootdirhandle && <input type="button" className="sub-btn" value={"Save files " + p.fs.files.length} onClick={async e => p.fs?.setSaveDirHandle(await showDirectoryPicker({}))} />}
				{p.fs?.rootdirhandle && <div>Saved files to disk: {p.fs.files.length}</div>}
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
