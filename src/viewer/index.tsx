
import { ThreeJsRenderer } from "./threejsrender";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { ModelBrowser, RendererControls } from "./scenenodes";
import { UIContext, CacheSelector, UIOpenedFile, UIRootContext, UIEngineContext, downloadBlob, BrowsePageId } from "./maincomponents";
import classNames from "classnames";
import { exposeDebugToolsInGlobal } from "../consoletools";
import { DomWrap, useAwaited, useDisposableMemo, useForceUpdate } from "./commoncontrols";
import { FileDisplay } from "./viewers/fileviewer";
import { BrowseDisplay } from "./tabs/browse";
import { BlobTS } from "../utils";
import * as electron from "electron/renderer";

exposeDebugToolsInGlobal();

export function unload(obj: { root: ReactDOM.Root, ctx: UIContext }) {
	obj.root.unmount();
	obj.ctx.close();
	globalThis.uicontext = null;
}

export function start(rootelement: HTMLElement, serviceworker?: boolean) {
	if (electron) {
		// electron doesn't bind these
		window.addEventListener("keydown", e => {
			if (e.altKey && e.key == "ArrowLeft") { navigation.back(); }
			if (e.altKey && e.key == "ArrowRight") { navigation.forward(); }
			if (e.key == "F5") { navigation.reload(); }
			if (e.key == "F12") { electron.ipcRenderer.invoke("toggledevtools"); }
		});
	}

	let ctx = new UIContext(rootelement, serviceworker ?? false);
	let root = ReactDOM.createRoot(rootelement);
	root.render(
		<UIRootContext.Provider value={ctx}>
			<App />
		</UIRootContext.Provider>
	);

	globalThis.uicontext = ctx;
	return { root, ctx };
}


function App(p: {}) {
	let ctx = React.useContext(UIRootContext);

	let redraw = useForceUpdate();
	React.useEffect(() => {
		let resize = () => {
			redraw();
			ctx.renderer.forceFrame();
		}
		ctx.on("statechange", redraw);
		ctx.on("showTab", redraw);
		window.addEventListener("resize", resize);
		return () => {
			ctx.off("statechange", redraw);
			ctx.off("showTab", redraw);
			window.removeEventListener("resize", resize);
		}
	}, [ctx]);

	let width = ctx.rootElement.clientWidth;
	let vertical = width < 550;

	let visibletab = (ctx.source && ctx.activeTabIndex != -1 ? ctx.openedTabs[ctx.activeTabIndex] : null);

	let cachemeta = ctx.source?.getCacheMeta();
	return (
		<UIEngineContext.Provider value={ctx.renderable}>
			<div className={classNames("mv-root", "mv-style", { "mv-root--vertical": vertical })}>
				{visibletab ? null : <DomWrap containerref={ctx.renderer.forceFrame} className="mv-canvas" el={ctx.renderer.canvas} />}
				{visibletab?.type == "file" && <FileViewer file={visibletab} onSelectFile={ctx.openFile} />}
				{visibletab?.type == "browse" && <BrowseViewer browse={visibletab} onSelectFile={ctx.openFile} />}
				<div className="mv-sidebar">
					{!ctx.source && (
						<React.Fragment>
							<CacheSelector onOpen={ctx.openCache} />
							<div style={{ flex: "1" }} />
							<div style={{ textAlign: "center" }}>
								Go to <a href="https://runeapps.org/modelviewer_about">RuneApps</a> for more info. Source code hosted at <a href="https://github.com/skillbert/rsmv" target="_blank">github.com/skillbert/rsmv</a>
							</div>
						</React.Fragment>
					)}
					{cachemeta && (
						<React.Fragment>
							<input type="button" className="sub-btn" onClick={ctx.closeCache} value={`Close ${cachemeta.name}`} title={cachemeta.descr} />
							<RendererControls />
							<ModelBrowser />
						</React.Fragment>
					)}
				</div>
			</div>
		</UIEngineContext.Provider>
	);
}


export function FileViewer(p: { file: UIOpenedFile, onSelectFile: (f: UIOpenedFile | null) => void }) {
	return (
		<div style={{ display: "grid", gridTemplateRows: "auto 1fr" }}>
			<div className="mv-modal-head">
				<span>{p.file.name}</span>
				<span style={{ float: "right", marginLeft: "10px" }} onClick={e => downloadBlob(p.file.name, new BlobTS([p.file.data]))}>download</span>
				<span style={{ float: "right", marginLeft: "10px" }} onClick={e => p.onSelectFile(null)}>x</span>
			</div>
			<div style={{ overflow: "auto", flex: "1", position: "relative" }}>
				<FileDisplay file={p.file} />
			</div>
		</div>
	);
}


export function BrowseViewer(p: { browse: BrowsePageId, onSelectFile: (f: UIOpenedFile | null) => void }) {
	return (
		<div style={{ display: "grid", gridTemplateRows: "auto 1fr" }}>
			<div className="mv-modal-head">
				<span>{p.browse.id}</span>
				<span style={{ float: "right", marginLeft: "10px" }} onClick={e => p.onSelectFile(null)}>x</span>
			</div>
			<div style={{ overflow: "auto", flex: "1", position: "relative" }}>
				<BrowseDisplay browse={p.browse} />
			</div>
		</div>
	);
}

