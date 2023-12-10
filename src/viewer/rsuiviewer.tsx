import * as React from "react";
import { renderRsInterface } from "../scripts/renderrsinterface";
import { DomWrap } from "./scriptsui";
import type { ThreejsSceneCache } from "../3d/modeltothree";
import { ThreeJsRenderer } from "./threejsrender";

export function RsUIViewer(p: { data: string }) {
	let [ui, setui] = React.useState<HTMLElement | null>(null);
	React.useEffect(() => {
		let scene: ThreejsSceneCache = globalThis.sceneCache;//TODO pass this properly using args
		let render: ThreeJsRenderer = globalThis.render;//TODO
		let needed = true;
		let uiinfo = JSON.parse(p.data);
		let cleanup: null | (() => void) = null;
		renderRsInterface({ source: scene.engine, sceneCache: scene, renderer: render }, uiinfo.id, "dom").then(ui => {
			let clean = () => ui.dispose.forEach(q => q());
			if (needed) {
				setui(ui.el);
				cleanup = clean;
			} else {
				clean();
			}
		});
		return () => {
			needed = false;
			cleanup?.();
		}
	}, [p.data]);

	return (
		<div>
			<DomWrap el={ui} />
		</div>
	)
}