import * as React from "react";
import { RsInterfaceComponent, RsInterfaceDomTree, UiRenderContext, loadRsInterfaceData, renderRsInterfaceDOM } from "../scripts/renderrsinterface";
import { DomWrap } from "./scriptsui";
import type { ThreejsSceneCache } from "../3d/modeltothree";
import { ThreeJsRenderer } from "./threejsrender";
import { CacheFileSource } from "../cache";

export function RsUIViewer(p: { data: string }) {
	let [ui, setui] = React.useState<RsInterfaceDomTree | null>(null);
	let [refreshcount, refresh] = React.useReducer((v: number) => v + 1, 0);
	let scene: ThreejsSceneCache = globalThis.sceneCache;//TODO pass this properly using args
	let render: ThreeJsRenderer = globalThis.render;//TODO
	let ctx = React.useMemo(() => {
		let res = new UiRenderContext(scene.engine);
		res.sceneCache = scene;
		res.renderer = render;
		return res;
	}, [scene, render]);

	React.useEffect(() => {
		let needed = true;
		let uiinfo = JSON.parse(p.data);
		let cleanup = () => { };
		loadRsInterfaceData(ctx, uiinfo.id).then(ui => {
			if (!needed) { return; }
			let res = renderRsInterfaceDOM(ctx, ui);
			cleanup = res.dispose;
			setui(res);
		});
		return () => {
			needed = false;
			cleanup();
		}
	}, [ctx, p.data, refreshcount, ctx.runOnloadScripts]);

	return (
		<div style={{ position: "absolute", inset: "0px", display: "grid", gridTemplate: '"a" 1fr "b" auto "c" 1fr / 1fr' }}>
			<DomWrap style={{ position: "relative" }} el={ui?.el} />
			<div>
				<label><input type="checkbox" checked={ctx.runOnloadScripts} onChange={e => { ctx.runOnloadScripts = e.currentTarget.checked; refresh(); }} />Run load scripts</label>
				<input type="button" className="sub-btn" onClick={refresh} value="reload" />
			</div>
			<div style={{ overflowY: "auto" }}>
				{ui?.rootcomps.map((q, i) => <RsInterfaceDebugger ctx={ctx} key={i} source={scene.engine} comp={q} />)}
			</div>
		</div>
	)
}

function RsInterfaceDebugger(p: { ctx: UiRenderContext, comp: RsInterfaceComponent, source: CacheFileSource }) {
	let data = p.comp.data;
	let mouseevent = React.useCallback((e: React.MouseEvent) => {
		p.ctx.toggleHighLightComp(p.comp.compid, e.type == "mouseenter");
	}, [p.ctx, p.comp]);

	return (
		<div className="rs-componentmeta" onMouseEnter={mouseevent} onMouseLeave={mouseevent} onClick={e => e.target == e.currentTarget && console.log(p.comp)}>
			id={p.comp.compid & 0xffff} t={data.type} {data.textdata?.text ?? "no text"}
			<br />
			{data.spritedata && "sprite: " + data.spritedata.spriteid}
			{data.modeldata && "model: " + data.modeldata.modelid}
			<CallbackDebugger ctx={p.ctx} comp={p.comp} source={p.source} />
			<hr />
			<div className="rs-componentmeta-children">
				{p.comp.children.map((q, i) => <RsInterfaceDebugger ctx={p.ctx} key={i} comp={q} source={p.source} />)}
			</div>
		</div>
	)
}

function CallbackDebugger(p: { ctx: UiRenderContext, comp: RsInterfaceComponent, source: CacheFileSource }) {
	return (
		<div>
			{Object.entries(p.comp.data.scripts).filter(q => q[1] && q[1].length != 0).map(([key, v]) => {
				if (!v) { throw new Error("unexpected"); }
				if (typeof v[0] != "number") { throw new Error("unexpected") }
				let callbackid = v[0];
				return (
					<div key={key} className="rs-comonentcallback" onClick={e => p.ctx.runClientScriptCallback(p.comp.compid, v)}>
						{key} {callbackid}({v.slice(1).map(q => typeof q == "string" ? `"${q}"` : q).join(",")})
					</div>
				)
			})}
		</div>
	)
}