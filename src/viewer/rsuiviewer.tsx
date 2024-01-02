import * as React from "react";
import { RsInterfaceComponent, RsInterfaceElement, renderRsInterface } from "../scripts/renderrsinterface";
import { DomWrap } from "./scriptsui";
import type { ThreejsSceneCache } from "../3d/modeltothree";
import { ThreeJsRenderer } from "./threejsrender";
import { interfaces } from "../../generated/interfaces";
import { renderClientScript } from "../clientscript/ast";
import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";

export function RsUIViewer(p: { data: string }) {
	let [ui, setui] = React.useState<RsInterfaceElement | null>(null);

	let scene: ThreejsSceneCache = globalThis.sceneCache;//TODO pass this properly using args
	let render: ThreeJsRenderer = globalThis.render;//TODO
	React.useEffect(() => {
		let needed = true;
		let uiinfo = JSON.parse(p.data);
		let cleanup: null | (() => void) = null;
		renderRsInterface({ source: scene.engine, sceneCache: scene, renderer: render }, uiinfo.id, "dom").then(ui => {
			let clean = () => ui.dispose.forEach(q => q());
			if (needed) {
				setui(ui);
				cleanup = clean;
			} else {
				clean();
			}
		});
		return () => {
			needed = false;
			cleanup?.();
		}
	}, [p.data, scene, render]);

	return (
		<div style={{ position: "absolute", inset: "0px", display: "grid", gridTemplate: '"a" 1fr "b" 1fr / 1fr' }}>
			<DomWrap style={{ position: "relative" }} el={ui?.el} />
			<div style={{ overflowY: "auto" }}>
				{ui?.rootcomps.map((q, i) => <RsInterfaceDebugger key={i} source={scene.engine} comp={q} />)}
			</div>
		</div>
	)
}

function RsInterfaceDebugger(p: { comp: RsInterfaceComponent, source: CacheFileSource }) {
	let data = p.comp.data;
	return (
		<div className="rs-componentmeta">
			{data.type} {data.textdata?.text ?? "no text"}
			<br />
			{data.spritedata && "spriite: " + data.spritedata.spriteid}
			{data.modeldata && "model: " + data.modeldata.modelid}
			<CallbackDebugger data={data} source={p.source} />
			<hr />
			<div className="rs-componentmeta-children">
				{p.comp.children.map((q, i) => <RsInterfaceDebugger key={i} comp={q} source={p.source} />)}
			</div>
		</div>
	)
}

function CallbackDebugger(p: { data: interfaces, source: CacheFileSource }) {
	return (
		<div>
			{Object.entries(p.data.scripts).filter(q => q[1] && q[1].length != 0).map(([key, v]) => {
				if (!v) { throw new Error("unexpected"); }
				if (typeof v[0] != "number") { throw new Error("unexpected") }
				let callbackid = v[0];
				return (
					<div key={key} className="rs-comonentcallback" onClick={async e => console.log(await renderClientScript(p.source, await p.source.getFileById(cacheMajors.clientscript, callbackid), callbackid))}>
						{key} {callbackid}({v.slice(1).map(q => typeof q == "string" ? `"${q}"` : q).join(",")})
					</div>
				)
			})}
		</div>
	)
}