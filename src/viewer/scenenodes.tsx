import * as React from "react";
import classNames from "classnames";
import { ThreeJsSceneElement, ThreeJsSceneElementSource, exportThreeJsGltf, exportThreeJsStl, RenderCameraMode } from "./threejsrender";
import { downloadBlob, UIEngineContext } from "./maincomponents";
import { showModal } from "./jsonsearch";
import { findImageBounds, makeImageData } from "../imgutils";
import { TabStrip, CanvasView } from "./commoncontrols";
import { ScriptsUI } from './tabs/scripts';
import { SceneItem, SceneLocation, SceneMaterialIsh, SceneNpc, SceneRawModel, SceneSpotAnim } from './tabs/simplemodes';
import { ScenePlayer } from './tabs/avatar';
import { SceneMapModel } from './tabs/map';
import { SceneScenario } from './tabs/scenario';
import VR360Viewer from "../libs/vr360viewer";
import { BrowseUI } from "./tabs/browse";
import { BlobTS } from "../utils";


export type LookupMode = "model" | "item" | "npc" | "object" | "material" | "map" | "avatar" | "spotanim" | "scenario" | "browse" | "scripts";

type ModelBrowserState = { search: unknown, mode: LookupMode }

export function ModelBrowser(p: {}) {
	let [state, setMode] = React.useReducer((prev: any, v: LookupMode) => {
		localStorage.rsmv_lastmode = v;
		return { search: null, mode: v } as ModelBrowserState;
	}, null, () => {
		let search: unknown = null;
		try { search = JSON.parse(localStorage.rsmv_lastsearch ?? ""); }
		catch (e) { }
		return { search, mode: localStorage.rsmv_lastmode } as ModelBrowserState;
	});

	const tabs: Record<LookupMode, string> = {
		item: "Item",
		npc: "Npc",
		object: "Loc",
		avatar: "Player",
		model: "Model",
		map: "Map",
		material: "Material",
		spotanim: "Spotanim",
		scenario: "Scenario",
		browse: "Browse",
		scripts: "Scripts"
	}

	let ModeComp = LookupModeComponentMap[state.mode];
	return (
		<React.Fragment>
			<TabStrip value={state.mode} tabs={tabs} onChange={setMode} />
			{ModeComp && <ModeComp initialId={state.search} />}
		</React.Fragment>
	);
}


type ExportImgSize = { w: number, h: number, mode: RenderCameraMode, name: string };
const exportimgsizes: ExportImgSize[] = [
	{ w: 0, h: 0, mode: "standard", name: "View" },
	{ w: 1920, h: 1080, mode: "standard", name: "1080p" },
	{ w: 2560, h: 1440, mode: "standard", name: "1440p" },
	{ w: 3840, h: 2160, mode: "standard", name: "4K" },
	{ w: 0, h: 0, mode: "vr360", name: "View" },
	{ w: 2048, h: 1024, mode: "vr360", name: "2:1K" },
	{ w: 4096, h: 2048, mode: "vr360", name: "4:2K" },
	{ w: 0, h: 0, mode: "topdown", name: "View" },
	{ w: 512, h: 512, mode: "topdown", name: "" },
	{ w: 1024, h: 1024, mode: "topdown", name: "" },
	{ w: 2048, h: 2048, mode: "topdown", name: "" },
]

function ExportSceneMenu(p: { renderopts: ThreeJsSceneElement["options"] }) {
	let renderctx = React.useContext(UIEngineContext);
	let [tab, settab] = React.useState<"img" | "gltf" | "stl" | "none">("none");
	let [img, setimg] = React.useState<{ cnv: HTMLCanvasElement, data: ImageData } | null>(null);
	let [imgsize, setimgsize] = React.useState<ExportImgSize>(exportimgsizes.find(q => q.mode == p.renderopts!.camMode) ?? exportimgsizes[0]);
	let [cropimg, setcropimg] = React.useState(true);

	let changeImg = async (instCrop = cropimg, instSize = imgsize) => {
		if (!renderctx) { return; }
		if (p.renderopts!.camMode == "vr360") { instCrop = false; }

		let newpixels = await renderctx.renderer.takeScenePicture(instSize.w || undefined, instSize.h || undefined);
		let newimg = makeImageData(newpixels.data, newpixels.width, newpixels.height);
		let cnv = document.createElement("canvas");
		let ctx = cnv.getContext("2d")!;
		if (instCrop) {
			let bounds = findImageBounds(newimg);
			cnv.width = bounds.width;
			cnv.height = bounds.height;
			ctx.putImageData(newimg, -bounds.x, -bounds.y);
		} else {
			cnv.width = newimg.width;
			cnv.height = newimg.height;
			ctx.putImageData(newimg, 0, 0)
		}
		settab("img");
		setcropimg(instCrop);
		setimgsize(instSize);
		setimg({ cnv, data: newimg });
	}
	if (tab == "img" && p.renderopts!.camMode == "vr360" && cropimg) {
		changeImg();
	}


	let saveimg = async () => {
		if (!img) { return; }
		let blob = await new Promise<Blob | null>(d => img!.cnv.toBlob(d));
		if (!blob) { return; }
		downloadBlob("runeapps_image_export.png", blob);
	}

	let copyimg = async () => {
		//@ts-ignore
		navigator.clipboard.write([
			//@ts-ignore
			new ClipboardItem({ 'image/png': await new Promise<Blob | null>(d => img!.cnv.toBlob(d)) })
		]);
	}

	let saveGltf = async () => {
		if (!renderctx) { return; }
		let file = await exportThreeJsGltf(renderctx.renderer.getModelNode());
		downloadBlob("model.glb", new BlobTS([file]));
	}

	let saveStl = async () => {
		if (!renderctx) { return; }
		let file = await exportThreeJsStl(renderctx.renderer.getModelNode());
		downloadBlob("model.stl", new BlobTS([file]));
	}

	let clicktab = (v: typeof tab) => {
		settab(v);
		if (v == "img") { changeImg(cropimg); }
	}

	let show360modal = () => {
		const src = img!.cnv;
		showModal({ title: "360 preview of render" }, (
			<React.Fragment>
				<VR360View img={src} />
			</React.Fragment>
		));
	}

	return (
		<div className="mv-inset">
			<TabStrip value={tab} tabs={{ gltf: "GLTF", stl: "STL", img: "image" }} onChange={clicktab as any} />
			{tab == "img" && (
				<React.Fragment>
					<div style={{ display: "grid", gridTemplateColumns: "1fr minmax(0,1fr)" }}>
						Export image size
						<select value={exportimgsizes.indexOf(imgsize)} onChange={e => changeImg(undefined, exportimgsizes[e.currentTarget.value])}>
							{exportimgsizes.map((q, i) => (
								q.mode == p.renderopts!.camMode && <option key={i} value={i}>{q.name}{q.w != 0 ? ` ${q.w}x${q.h}` : ""}</option>
							))}
						</select>
					</div>
					{p.renderopts!.camMode != "vr360" && <label><input type="checkbox" checked={cropimg} onChange={e => changeImg(e.currentTarget.checked)} />Crop image</label>}
					{p.renderopts!.camMode == "vr360" && <input type="button" className="sub-btn" onClick={show360modal} value="Preview 360" />}
					{img && <CanvasView canvas={img.cnv} />}
					<div style={{ display: "grid", grid: "'a b' / 1fr 1fr" }}>
						<input type="button" className="sub-btn" value="Save" onClick={saveimg} />
						<input type="button" className="sub-btn" value="Clipboard" onClick={copyimg} />
					</div>
				</React.Fragment>
			)}
			{tab == "gltf" && (
				<React.Fragment>
					<p>GLTF is a lightweight 3d format designed for modern but simple model exports. Colors, textures and animations will be included, but advanced lighting effects are lost.</p>
					<input style={{ width: "100%" }} type="button" className="sub-btn" value="Save" onClick={saveGltf} />
				</React.Fragment>
			)}
			{tab == "stl" && (
				<React.Fragment>
					<p>STL is used mostly for 3d printing, this file format only exports the shape of the model. Colors, textures animations will be lost.</p>
					<input style={{ width: "100%" }} type="button" className="sub-btn" value="Save" onClick={saveStl} />
				</React.Fragment>
			)}
			{tab == "none" && (
				<p>Select an export type</p>
			)}
		</div>
	)
}

function VR360View(p: { img: string | ImageData | TexImageSource }) {
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


export function RendererControls(p: {}) {
	const ctx = React.useContext(UIEngineContext);
	const elconfig = React.useRef<ThreeJsSceneElement>({ options: {} });
	const sceneEl = React.useRef<ThreeJsSceneElementSource>({ getSceneElements() { return elconfig.current } });

	let [showsettings, setshowsettings] = React.useState(localStorage.rsmv_showsettings == "true");
	let [showexport, setshowexport] = React.useState(false);
	let [hideFog, sethidefog] = React.useState(true);
	let [hideFloor, sethidefloor] = React.useState(false);
	let [camMode, setcammode] = React.useState<"standard" | "vr360" | "topdown">("standard");
	let [camControls, setcamcontrols] = React.useState<"free" | "world">("free");

	const render = ctx?.renderer;

	let newopts: ThreeJsSceneElement["options"] = { hideFog, hideFloor, camMode, camControls };
	let oldopts = elconfig.current.options;
	elconfig.current.options = newopts;

	//I wont tell anyone if you dont tell anyone
	//TODO actually fix this tho
	if (JSON.stringify(oldopts) != JSON.stringify(newopts)) {
		render?.sceneElementsChanged();
	}

	React.useEffect(() => {
		if (render) {
			render.addSceneElement(sceneEl.current);
			return () => { render.removeSceneElement(sceneEl.current); }
		}
	}, [render]);

	const toggleSettings = React.useCallback(() => {
		localStorage.rsmv_showsettings = "" + !showsettings;
		setshowsettings(!showsettings);
	}, [showsettings]);

	return (
		<React.Fragment>
			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
				<input type="button" className={classNames("sub-btn", { "active": showexport })} onClick={e => setshowexport(!showexport)} value="Export" />
				<input type="button" className={classNames("sub-btn", { "active": showsettings })} onClick={toggleSettings} value="Settings" />
			</div>
			{showsettings && (
				<div className="mv-inset" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
					<label><input type="checkbox" checked={hideFog} onChange={e => sethidefog(e.currentTarget.checked)} />Hide fog</label>
					<label><input type="checkbox" checked={hideFloor} onChange={e => sethidefloor(e.currentTarget.checked)} />Hide floor</label>
					<label><input type="checkbox" checked={camControls == "world"} onChange={e => setcamcontrols(e.currentTarget.checked ? "world" : "free")} />Flat panning</label>
					<label>
						<select value={camMode} onChange={e => setcammode(e.currentTarget.value as any)}>
							<option value="standard">Standard camera</option>
							<option value="topdown">Orthogonal camera</option>
							<option value="vr360">360 Camera</option>
						</select>
					</label>
				</div>
			)}
			{showexport && ctx && <ExportSceneMenu renderopts={newopts} />}
		</React.Fragment>
	)
}

export type LookupModeProps = {
	initialId: unknown
}

const LookupModeComponentMap: Record<LookupMode, React.ComponentType<LookupModeProps>> = {
	browse: BrowseUI,
	model: SceneRawModel,
	item: SceneItem,
	avatar: ScenePlayer,
	material: SceneMaterialIsh,
	npc: SceneNpc,
	object: SceneLocation,
	spotanim: SceneSpotAnim,
	map: SceneMapModel,
	scenario: SceneScenario,
	scripts: ScriptsUI
}
