import * as React from "react";
import { UIContext, UIContextReady } from "./maincomponents";
import { boundMethod } from "autobind-decorator";
import prettyJson from "json-stringify-pretty-compact";
import classNames from "classnames";


export function TabStrip<T extends string>(p: { value: T, tabs: Record<T, string>, onChange: (v: T) => void }) {
	return (
		<div className="sidebar-browser-tab-strip">
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
		<form className="sidebar-browser-search-bar" onSubmit={submit}>
			<input type="button" style={{ width: "25px", height: "25px" }} onClick={decr} value="" className="sub-btn sub-btn-minus" />
			<input type="button" style={{ width: "25px", height: "25px" }} onClick={incr} value="" className="sub-btn sub-btn-plus" />
			<input type="text" className="sidebar-browser-search-bar-input" value={id} onChange={e => { setId(+e.currentTarget.value); stale.current = true; }} />
			<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn sub-btn-search" />
		</form>
	)
}
export function StringInput({ initialid, onChange }: { initialid?: string, onChange: (id: string) => void }) {
	let [idstate, setId] = React.useState(initialid ?? "");
	let stale = React.useRef(false);

	let id = (stale.current || typeof initialid == "undefined" ? idstate : initialid);

	let submit = (e: React.FormEvent) => { onChange(id); e.preventDefault(); stale.current = false; };
	return (
		<form className="sidebar-browser-search-bar" onSubmit={submit}>
			<input type="text" className="sidebar-browser-search-bar-input" value={id} onChange={e => { setId(e.currentTarget.value); stale.current = true; }} />
			<input type="submit" style={{ width: "25px", height: "25px" }} value="" className="sub-btn sub-btn-search" />
		</form>
	)
}

export function LabeledInput(p: { label: string, children: React.ReactNode }) {
	return <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr" }}>
		<div>{p.label}</div>
		{p.children}
	</div>
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