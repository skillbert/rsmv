import * as React from "react";
import { boundMethod } from "autobind-decorator";
import prettyJson from "json-stringify-pretty-compact";
import classNames from "classnames";
import { EngineCache } from "3d/modeltothree";
import { cacheFileJsonModes } from "scripts/filetypes";
import { JsonSearch, JsonSearchFilter, useJsonCacheSearch } from "./jsonsearch";


export function CanvasView(p: { canvas: HTMLCanvasElement, fillHeight?: boolean }) {
	let ref = React.useCallback((el: HTMLDivElement | null) => {
		p.canvas.classList.add("mv-image-preview-canvas");
		if (el) { el.appendChild(p.canvas); }
		else { p.canvas.remove(); }
	}, [p.canvas]);

	return (
		<div ref={ref} className="mv-image-preview" style={p.fillHeight ? { height: "100%" } : {}} />
	)
}

export function BlobImage(p: { file: Uint8Array, ext: string, fillHeight?: boolean }) {
	let urlref = React.useRef("");
	let ref = React.useCallback((el: HTMLImageElement | null) => {
		if (el) {
			let blob = new Blob([p.file], { type: `image/${p.ext == "svg" ? "svg+xml" : p.ext}` });
			let url = URL.createObjectURL(blob);
			urlref.current = url;
			el.src = url;
			el.decode().finally(() => URL.revokeObjectURL(url));
		} else {
			URL.revokeObjectURL(urlref.current);
		}
	}, [p.file]);

	return (
		<div className="mv-image-preview" style={p.fillHeight ? { height: "100%" } : {}}>
			<img ref={ref} className="mv-image-preview-canvas" />
		</div>
	)
}

export function BlobAudio(p: { file: Uint8Array, autoplay: boolean }) {
	let urlref = React.useRef("");

	let ref = React.useCallback((el: HTMLAudioElement | null) => {
		if (el) {
			let blob = new Blob([p.file], { type: `audio/ogg` });
			let url = URL.createObjectURL(blob);
			urlref.current = url;
			el.src = url;
		} else {
			URL.revokeObjectURL(urlref.current);
		}
	}, [p.file]);

	return (
		<div className="mv-image-preview">
			<audio ref={ref} controls autoPlay={p.autoplay} />
		</div>
	)
}

export function TabStrip<T extends string>(p: { value: T, tabs: Partial<Record<T, string>>, onChange: (v: T) => void }) {
	const templatecols = `repeat(${Math.min(4, Object.keys(p.tabs).length)},minmax(0,1fr))`;
	return (
		<div className="mv-tab-strip mv-inset" style={{ gridTemplateColumns: templatecols }}>
			{Object.entries(p.tabs).map(([k, v]) => (
				<div key={k} className={classNames("mv-icon-button", { active: p.value == k as any })} onClick={() => p.onChange(k as any)}>{v as string}</div>
			))}
		</div>
	)
}

export function JsonDisplay(p: { obj: any }) {
	return (<pre className="mv-json-block">{prettyJson(p.obj, { maxLength: 32 })}</pre>);
}

export function IdInput({ initialid, onChange }: { initialid?: number, onChange: (id: number) => void }) {
	let [idstate, setId] = React.useState(initialid ?? 0);
	let stale = React.useRef(false);

	let id = (stale.current || typeof initialid == "undefined" ? idstate : initialid);

	let incr = () => { setId(id + 1); onChange(id + 1); stale.current = false; };
	let decr = () => { setId(id - 1); onChange(id - 1); stale.current = false; };
	let submit = (e: React.FormEvent) => { onChange(id); e.preventDefault(); stale.current = false; };
	return (
		<form className="mv-searchbar" onSubmit={submit}>
			<input type="button" style={{ width: "25px", height: "25px" }} onClick={decr} value="" className="sub-btn sub-btn-minus" />
			<input type="button" style={{ width: "25px", height: "25px" }} onClick={incr} value="" className="sub-btn sub-btn-plus" />
			<input type="text" className="mv-searchbar-input" spellCheck="false" value={id} onChange={e => { setId(+e.currentTarget.value); stale.current = true; }} />
			<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn sub-btn-search" />
		</form>
	)
}
export function IdInputSearch(p: { cache: EngineCache, mode: keyof typeof cacheFileJsonModes, initialid?: number, onChange: (id: number) => void }) {
	let [search, setSearch] = React.useState("" + (p.initialid ?? ""));
	let [id, setidstate] = React.useState(p.initialid ?? 0);
	let [searchopen, setSearchopen] = React.useState(false);
	const filters: JsonSearchFilter[] = [{ path: ["name"], search: search }];
	let { loaded, filtered, getprop } = useJsonCacheSearch(p.cache, p.mode, filters, !searchopen);

	const submitid = (v: number) => {
		setidstate(v);
		p.onChange(v);
	}

	let incr = () => { submitid(id + 1); setSearchText(id + 1 + "") }
	let decr = () => { submitid(id - 1); setSearchText(id - 1 + ""); }
	let submit = (e: React.FormEvent) => { e.preventDefault(); submitid(id) };

	const setSearchText = (v: string) => {
		let n = +v;
		let isNumber = !isNaN(n);
		setSearch(v);
		setSearchopen(!isNumber);
		if (isNumber) { setidstate(n); }
	}

	return (
		<React.Fragment>
			<form className="mv-searchbar" onSubmit={submit}>
				<input type="button" style={{ width: "25px", height: "25px" }} onClick={decr} value="" className="sub-btn sub-btn-minus" />
				<input type="button" style={{ width: "25px", height: "25px" }} onClick={incr} value="" className="sub-btn sub-btn-plus" />
				<input type="text" className="mv-searchbar-input" spellCheck="false" value={search} onChange={e => setSearchText(e.currentTarget.value)} />
				<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn sub-btn-search" />
			</form>
			{searchopen && !loaded && (
				<div>Loading...</div>
			)}
			{searchopen && loaded && (
				<div className="mv-sidebar-scroll">
					{filtered.slice(0, 100).map((q, i) => (
						<div key={q.$fileid} onClick={e => submitid(q.$fileid)}>{q.$fileid} - {getprop(q, ["name"], 0).next().value}</div>
					))}
				</div>
			)}
			{searchopen && <input type="button" className="sub-btn" value="Close" onClick={e => setSearchText(id + "")} />}
		</React.Fragment>
	)
}
export function StringInput({ initialid, onChange }: { initialid?: string, onChange: (id: string) => void }) {
	let [idstate, setId] = React.useState(initialid ?? "");
	let stale = React.useRef(false);

	let id = (stale.current || typeof initialid == "undefined" ? idstate : initialid);

	let submit = (e: React.FormEvent) => { onChange(id); e.preventDefault(); stale.current = false; };
	return (
		<form className="mv-searchbar" onSubmit={submit}>
			<input type="text" className="mv-searchbar-input" spellCheck="false" value={id} onChange={e => { setId(e.currentTarget.value); stale.current = true; }} />
			<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn sub-btn-search" />
		</form>
	)
}

export function LabeledInput(p: { label: string, children: React.ReactNode }) {
	return (
		<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
			<div>{p.label}</div>
			{p.children}
		</div>
	);
}

export function CopyButton(p: ({ text: string } | { getText: () => string }) & { onCopy?: () => void }) {
	let [didcopy, setdidcopy] = React.useState(false);

	let copy = async () => {
		await navigator.clipboard.writeText("text" in p ? p.text : p.getText());
		setdidcopy(true);
		setTimeout(() => setdidcopy(false), 2000);
	}

	return (
		<input type="button" className="sub-btn" onClick={copy} value={didcopy ? "copied!" : "copy"} />
	);
}

export function PasteButton(p: { onPaste: (str: string) => void }) {
	let [didcopy, setdidcopy] = React.useState(false);

	let paste = async () => {
		let v = await navigator.clipboard.readText();
		setdidcopy(true);
		setTimeout(() => setdidcopy(false), 2000);
		p.onPaste(v);
	}

	return (
		<input type="button" className="sub-btn" onClick={paste} value={didcopy ? "pasted!" : "paste"} />
	);
}

export class InputCommitted extends React.Component<React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>>{
	el: HTMLInputElement | null = null;
	stale = false;

	@boundMethod
	onInput() {
		this.stale = true;
	}

	@boundMethod
	onChange(e: Event) {
		this.props.onChange?.(e as any);
		this.stale = false;
	}

	@boundMethod
	ref(el: HTMLInputElement | null) {
		if (this.el) {
			this.el.removeEventListener("change", this.onChange);
			this.el.removeEventListener("input", this.onInput);
		}
		if (el) {
			el.addEventListener("change", this.onChange);
			el.addEventListener("input", this.onInput);
			this.el = el;
		}
	}

	render() {
		if (!this.stale && this.el && this.props.value) {
			this.el.value = this.props.value as string;
		}
		let newp = { ...this.props, onChange: undefined, value: undefined, defaultValue: this.props.value };
		return <input ref={this.ref} {...newp} />;
	}
}