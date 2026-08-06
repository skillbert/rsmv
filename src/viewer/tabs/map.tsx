import classNames from "classnames";
import { highlightModelGroup, ThreeJsRendererEvents, ThreeJsSceneElementSource } from "../threejsrender";
import { EngineCache, ThreejsSceneCache } from "../../3d/modeltothree";
import { RSMapChunk } from "../../3d/scene/mapchunk";
import { LookupModeProps } from "../scenenodes";
import * as React from "react";
import { CacheSelector, openSavedCache, RenderableContext, SavedCacheSource, UIContext, UIEngineContext, UIRootContext } from "../maincomponents";
import { boundMethod } from "autobind-decorator";
import { showModal } from "../jsonsearch";
import { compareFloorDependencies, compareLocDependencies, mapdiffmesh, mapsquareFloorDependencies, mapsquareLocDependencies, mapsquareVisuals, visibleChunkHash } from "../../map/chunksummary";
import { Group, Vector3 } from "three";
import { classicChunkSize, rs2ChunkSize, RSMapChunkData, tiledimensions } from "../../3d/mapsquare";
import { stringToMapArea } from "../../utils";
import { JsonDisplay, StringInput } from "../commoncontrols";


type DiffMesh = {
	a: ThreejsSceneCache,
	b: ThreejsSceneCache,
	info: any,
	floora: number,
	floorb: number,
	visible: boolean,
	mesh: ThreeJsSceneElementSource,
	remove: () => void
}

type SceneMapState = {
	chunkgroups: { chunkx: number, chunkz: number, models: Map<ThreejsSceneCache, RSMapChunk>, diffs: DiffMesh[] }[],
	center: { x: number, z: number },
	toggles: Record<string, boolean>,
	selectionData: any,
	versions: { cache: ThreejsSceneCache, visible: boolean }[],
	extramodels: boolean
};

export function SceneMapModel(p: LookupModeProps) {
	let ctx = React.useContext(UIEngineContext);
	let partial = React.useContext(UIRootContext);
	return <SceneMapModelInner {...p} ctx={ctx as any} partial={partial} />;
}

class SceneMapModelInner extends React.Component<LookupModeProps & { ctx: RenderableContext | null, partial: UIContext }, SceneMapState> {
	selectCleanup: (() => void)[] = [];
	constructor(p) {
		super(p);
		this.state = {
			chunkgroups: [],
			center: { x: 0, z: 0 },
			toggles: Object.create(null),
			selectionData: undefined,
			versions: [],
			extramodels: false
		}
	}

	@boundMethod
	clear() {
		this.selectCleanup.forEach(q => q());
		this.state.chunkgroups.forEach(q => q.models.forEach(q => q.cleanup()));
		this.setState({ chunkgroups: [], toggles: Object.create(null) });
	}

	@boundMethod
	viewmap() {
		showModal({ title: "Map view" }, <Map2dView chunks={this.state.chunkgroups.map(q => q.models.get(this.props.ctx!.sceneCache)!).filter(q => q)} gridsize={512} mapscenes={true} />);
	}

	async diffCaches(cachea: ThreejsSceneCache, cacheb: ThreejsSceneCache, floora = 3, floorb = 3) {
		let group = this.state.chunkgroups[0];
		if (!this.props.ctx || !group) {
			return;
		}
		let chunka = await group.models.get(cachea)?.chunkdata;
		let chunkb = await group.models.get(cacheb)?.chunkdata;
		if (!chunka?.chunk || !chunkb?.chunk) { throw new Error("unexpected"); }

		let depsa = await cachea.engine.getDependencyGraph();
		let depsb = await cacheb.engine.getDependencyGraph();

		let floordepsa = mapsquareFloorDependencies(chunka.grid, depsa, chunka.chunk);
		let locdepsa = mapsquareLocDependencies(chunka.grid, depsa, chunka.modeldata, chunka.chunk.mapsquarex, chunka.chunk.mapsquarez);
		let floordepsb = mapsquareFloorDependencies(chunkb.grid, depsb, chunkb.chunk);
		let locdepsb = mapsquareLocDependencies(chunkb.grid, depsb, chunkb.modeldata, chunkb.chunk.mapsquarex, chunkb.chunk.mapsquarez);

		let floordifs = compareFloorDependencies(floordepsa, floordepsb, floora, floorb);
		let locdifs = compareLocDependencies(locdepsa, locdepsb, floora, floorb);

		let difmesh = new Group();
		difmesh.add(await mapdiffmesh(cachea, floordifs, [255, 0, 0]));
		difmesh.add(await mapdiffmesh(cachea, locdifs, [0, 255, 0]));
		// position the mesh
		let offsetx = group.chunkx * tiledimensions * chunka.chunkSize - this.state.center.x;
		let offsetz = group.chunkz * tiledimensions * chunka.chunkSize - this.state.center.z;
		difmesh.position.x = offsetx;
		difmesh.position.z = offsetz;
		difmesh.updateMatrix();
		globalThis.difmesh = difmesh;// TODO remove

		let visualsa = mapsquareVisuals(floordepsa, locdepsa);
		let visualsb = mapsquareVisuals(floordepsb, locdepsb);

		let diffgroup: DiffMesh = {
			a: cachea,
			b: cacheb,
			info: {
				floordepsa,
				floordepsb,
				locdepsa,
				locdepsb
			},
			floora,
			floorb,
			visible: true,
			mesh: {
				getSceneElements() {
					return {
						modelnode: (!diffgroup.visible ? undefined : difmesh),
						projectionChanged(proj) {
							let chunktoscreen = proj.clone().multiply(difmesh.matrixWorld);
							let hasha = visibleChunkHash(visualsa, chunktoscreen, floora);
							let hashb = visibleChunkHash(visualsb, chunktoscreen, floorb);
							console.log("visualhash", hasha == hashb, hasha, hashb);
						}
					}
				}
			},
			remove: () => {
				group.diffs = group.diffs.filter(q => q != diffgroup);
				this.props.ctx?.renderer.removeSceneElement(diffgroup.mesh);
				this.forceUpdate();
			}
		};

		this.props.ctx.renderer.addSceneElement(diffgroup.mesh);

		group.diffs.push(diffgroup);
		this.forceUpdate();
	}

	@boundMethod
	async meshSelected(e: ThreeJsRendererEvents["select"]) {
		this.selectCleanup.forEach(q => q());
		let selectionData: any = undefined;
		if (e) {
			this.selectCleanup = highlightModelGroup(e.vertexgroups);

			//show data about what we clicked
			// console.log(Array.isArray(e.obj.material) ? e.obj.material : e.obj.material.userData);
			let meshdata = e.meshdata;
			if (meshdata.modeltype == "locationgroup") {
				let typedmatch = e.match as typeof meshdata.subobjects[number];
				if (typedmatch.modeltype == "location") {
					selectionData = typedmatch;
				}
			}
			if (meshdata.modeltype == "floor") {
				let typedmatch = e.match as typeof meshdata.subobjects[number];
				selectionData = {
					...e.meshdata,
					x: typedmatch.x,
					z: typedmatch.z,
					subobjects: undefined,//remove (near) circular ref from json
					subranges: undefined,
					tile: { ...typedmatch.tile, next01: undefined, next10: undefined, next11: undefined },
					tilenxt: typedmatch.tilenxt,
					originalcolor: typedmatch.underlaycolor
				};
			}
		};
		this.setState({ selectionData });
		this.props.ctx?.renderer.forceFrame();
	}

	componentDidMount() {
		//TODO this is a leak if ctx changes while mounted
		this.props.partial.renderer?.on("select", this.meshSelected);
	}

	componentWillUnmount() {
		this.clear();
		//TODO this is a leak if ctx changes while mounted
		this.props.partial.renderer?.off("select", this.meshSelected);
	}

	@boundMethod
	async addChunk(chunkx: number, chunkz: number) {
		for (let version of this.state.versions) {
			this.loadChunk(chunkx, chunkz, version.cache);
		}
		this.fixVisibility();
	}

	loadChunk(chunkx: number, chunkz: number, sceneCache: ThreejsSceneCache | undefined) {
		this.setState(prevstate => {
			const renderer = this.props.ctx?.renderer;
			if (!sceneCache || !renderer) { return; }

			let chunk = RSMapChunk.create(sceneCache, chunkx, chunkz, { skybox: true, map2d: this.state.extramodels, hashboxes: this.state.extramodels, minimap: this.state.extramodels });
			chunk.on("changed", () => {
				let toggles = this.state.toggles;
				let changed = false;
				let groups = new Set<string>();
				chunk.rootnode.traverse(node => {
					if (node.userData.modelgroup) {
						groups.add(node.userData.modelgroup);
					}
				});
				[...groups].sort((a, b) => a.localeCompare(b)).forEach(q => {
					if (typeof toggles[q] != "boolean") {
						toggles[q] = !!q.match(/^(floor|objects)\d+/);
						// toggles[q] = !!q.match(/^mini_(floor|objects)0/);
						// toggles[q] = !!q.match(/^mini_(objects)0/);
						// toggles[q] = !!q.match(/^mini_(floor)0/);
						changed = true;
					}
				});
				let match = this.state.versions.find(q => q.cache == sceneCache);
				chunk.setToggles(toggles, match && !match.visible);
				if (changed) {
					this.setState({ toggles });
					this.fixVisibility(toggles);
				}
			})
			let center = prevstate.center;
			if (prevstate.chunkgroups.length == 0) {
				let chunksize = (sceneCache.engine.classicData ? classicChunkSize : rs2ChunkSize);
				center = {
					x: (chunkx + 0.5) * chunksize * 512,
					z: (chunkz + 0.5) * chunksize * 512,
				}
			}
			let combined = chunk.rootnode;
			combined.position.add(new Vector3(-center.x, 0, -center.z));
			chunk.addToScene(renderer);

			let group = prevstate.chunkgroups.find(q => q.chunkx == chunkx && q.chunkz == chunkz);
			let newstate: Partial<SceneMapState> = {};
			newstate.center = center;
			if (!group) {
				group = { chunkx, chunkz, models: new Map(), diffs: [] };
				newstate.chunkgroups = [...prevstate.chunkgroups, group];
			}
			group.models.set(sceneCache, chunk);
			return newstate as any;//react typings fail?
		});
	}

	@boundMethod
	onSubmit(searchtext: string) {
		localStorage.rsmv_lastsearch = JSON.stringify(searchtext);
		let rect = stringToMapArea(searchtext);
		if (!rect) {
			//TODO some sort of warning?
			return;
		}
		for (let z = rect.z; z < rect.z + rect.zsize; z++) {
			for (let x = rect.x; x < rect.x + rect.xsize; x++) {
				this.addChunk(x, z);
			}
		}
	}

	fixVisibility(newtoggles = this.state.toggles) {
		this.state.chunkgroups.forEach(group => group.models.forEach((q, key) => {
			let match = this.state.versions.find(q => q.cache == key);
			q.setToggles(newtoggles, match && !match.visible);
		}));
	}

	setToggle(toggle: string, value: boolean) {
		this.setState(old => {
			let newtoggles = Object.create(null);
			for (let key in old.toggles) {
				newtoggles[key] = (key == toggle ? value : old.toggles[key]);
			}
			this.fixVisibility(newtoggles);
			return { toggles: newtoggles };
		})
	}

	@boundMethod
	selectSecondCache() {
		let onselect = async (source: SavedCacheSource) => {
			frame.close();
			let cache = await openSavedCache(source, false);
			if (!cache) { return; }
			let engine = await EngineCache.create(cache);
			let scene = await ThreejsSceneCache.create(engine);
			for (let area of this.state.chunkgroups) {
				this.loadChunk(area.chunkx, area.chunkz, scene);
			}
			this.setState({ versions: [...this.state.versions, { cache: scene, visible: true }] });
		}

		let frame = showModal({ title: "Select a cache" }, (
			<CacheSelector onOpen={onselect} noReopen={true} />
		));
	}

	removeCache(cache: ThreejsSceneCache) {
		for (let group of this.state.chunkgroups) {
			let model = group.models.get(cache);
			if (!model) { continue; }
			this.props.ctx?.renderer.removeSceneElement(model);
		}
		this.setState({ versions: this.state.versions.filter(q => q.cache != cache) });
	}

	@boundMethod
	toggleCache() {
		let currentindex = this.state.versions.findIndex(q => q.visible);
		let newindex = (currentindex + 1) % this.state.versions.length;
		this.state.versions.forEach((q, i) => this.toggleVisible(q.cache, i == newindex));
	}

	toggleVisible(cache: ThreejsSceneCache, visible: boolean) {
		let entry = this.state.versions.find(q => q.cache == cache);
		if (!entry) { return; }
		entry.visible = visible;
		this.forceUpdate();
		this.fixVisibility();
	}

	static getDerivedStateFromProps(props: LookupModeProps & { ctx: RenderableContext | null, partial: UIContext }, state: SceneMapState): Partial<SceneMapState> | null {
		if (props.ctx && !state.versions.find(q => q.cache == props.ctx?.sceneCache)) {
			return { versions: [{ cache: props.ctx.sceneCache, visible: true }, ...state.versions] };
		}
		return null;
	}

	render() {
		this.props.ctx?.renderer.forceFrame();
		let toggles: Record<string, string[]> = {};
		for (let toggle of Object.keys(this.state.toggles)) {
			let m = toggle.match(/^(\D+?)(\d.*)?$/);
			if (!m) { throw new Error("???"); }
			toggles[m[1]] = toggles[m[1]] ?? [];
			toggles[m[1]].push(m[2] ?? "");
		}

		let xmin = Infinity, xmax = -Infinity;
		let zmin = Infinity, zmax = -Infinity;
		for (let chunk of this.state.chunkgroups) {
			xmin = Math.min(xmin, chunk.chunkx); xmax = Math.max(xmax, chunk.chunkx + 1);
			zmin = Math.min(zmin, chunk.chunkz); zmax = Math.max(zmax, chunk.chunkz + 1);
		}
		let xsize = xmax - xmin + 2;
		let zsize = zmax - zmin + 2;
		xmin--;
		zmin--;

		let addgrid: (JSX.Element | null)[] = [];
		for (let x = xmin; x < xmin + xsize; x++) {
			for (let z = zmin; z < zmin + zsize; z++) {
				let style: React.CSSProperties = {
					gridColumn: "" + (x - xmin + 1),
					gridRow: "" + (zmin + zsize - z),
					border: "1px solid rgba(255,255,255,0.2)"
				}
				addgrid.push(<div key={`${x}-${z}`} onClick={() => this.addChunk(x, z)} style={style}></div>);
			}
		}

		let initid = (typeof this.props.initialId == "string" ? this.props.initialId : "50,50,1,1");

		//find the last skybox
		let skysettings = this.state.chunkgroups.reduceRight((a, q) => a ?? q.models.get(this.props.ctx!.sceneCache)?.loaded?.sky, undefined as undefined | RSMapChunkData["sky"]);

		return (
			<React.Fragment>
				{this.state.chunkgroups.length == 0 && (
					<React.Fragment>
						<StringInput onChange={this.onSubmit} initialid={initid} />
						<label><input type="checkbox" checked={this.state.extramodels} onChange={e => this.setState({ extramodels: e.currentTarget.checked })} />Load extra modes</label>
						<p>Input format: x,z[,xsize=1,[zsize=xsize]]</p>
						<p>Coordinates are in so-called mapsquare coordinates, each mapsquare is 64x64 tiles in size. The entire RuneScape map is laid out in one plane and is 100x200 mapsquares in size.</p>
					</React.Fragment>
				)}
				{this.state.chunkgroups.length != 0 && (
					<div className="mv-sidebar-scroll">
						<Map2dView chunks={this.state.chunkgroups.map(q => q.models.get(this.props.ctx!.sceneCache)!).filter(q => q)} addArea={this.addChunk} gridsize={40} mapscenes={false} />

						<input type="button" className="sub-btn" onClick={this.clear} value="Clear" />
						<input type="button" className="sub-btn" onClick={this.viewmap} value="View Map" />
						<input type="button" className="sub-btn" value="Add other version" onClick={this.selectSecondCache} />
						{skysettings && (<div>
							Skybox model: <span className="mv-copy-text">{skysettings.skyboxModelid}</span>,
							fog: <span className="mv-copy-text">{skysettings.fogColor[0]},{skysettings.fogColor[1]},{skysettings.fogColor[2]}</span>
						</div>)}
						<div style={{ display: "grid", gridTemplateColumns: "repeat(5,max-content)" }}>
							{Object.entries(toggles).map(([base, subs]) => {
								let all = true;
								let none = true;
								subs.forEach(s => {
									let v = this.state.toggles[base + s];
									all &&= v;
									none &&= !v;
								})
								return (
									<React.Fragment key={base}>
										<label style={{ gridColumn: 1 }}><input type="checkbox" checked={all} onChange={e => subs.forEach(s => this.setToggle(base + s, e.currentTarget.checked))} ref={v => v && (v.indeterminate = !all && !none)} />{base}</label>
										{subs.map((sub, i) => {
											let name = base + sub;
											let value = this.state.toggles[name];
											return (
												<label key={sub} style={{ gridColumn: 2 + i }}>
													<input type="checkbox" checked={value} onChange={e => this.setToggle(name, e.currentTarget.checked)} />
													{sub}
												</label>
											);
										})}
									</React.Fragment>
								)
							})}
						</div>
						{(this.state.versions.length > 1 || !this.state.versions[0].visible) && "Versions"}
						{(this.state.versions.length > 1 || !this.state.versions[0].visible) && this.state.versions.map((q, i) => (
							<div key={i} style={{ clear: "both" }}>
								<label title={q.cache.engine.getCacheMeta().descr}>
									<input type="checkbox" checked={q.visible} onChange={e => this.toggleVisible(q.cache, e.currentTarget.checked)} />
									{q.cache.engine.getCacheMeta().name}
								</label>
								<input type="button" className="sub-btn" value="x" style={{ float: "right" }} onClick={e => this.removeCache(q.cache)} />
							</div>
						))}
						{this.state.versions.length > 1 && <input type="button" className="sub-btn" value="Toggle" onClick={this.toggleCache} />}
						{this.state.versions.length == 1 && <input type="button" className="sub-btn" value="Diff roofs" onClick={() => this.diffCaches(this.state.versions[0].cache, this.state.versions[0].cache, 0, 3)} />}
						{this.state.versions.length == 2 && <input type="button" className="sub-btn" value="Diff" onClick={() => this.diffCaches(this.state.versions[0].cache, this.state.versions[1].cache, 3, 3)} />}
						{this.state.chunkgroups.flatMap((group, groupi) => group.diffs.map((diff, i) => {
							let metaa = diff.a.engine.getCacheMeta();
							let metab = diff.a == diff.b ? metaa : diff.b.engine.getCacheMeta();
							return (
								<div key={groupi + "-" + i} style={{ clear: "both" }}>
									<label title={diff.a == diff.b ? metaa.descr : `cache a:${metaa.descr}\n\n${metab.descr}`}>
										<input type="checkbox" checked={diff.visible} onChange={e => { diff.visible = e.currentTarget.checked; this.props.ctx?.renderer.sceneElementsChanged(); this.forceUpdate(); }} />
										{diff.a.engine.getBuildNr()}, floor: {diff.floora}
										{" - "}
										{diff.b.engine.getBuildNr()}, floor: {diff.floorb}
									</label>
									<input type="button" className="sub-btn" onClick={diff.remove} style={{ float: "right" }} value="x" />
								</div>
							)
						}))}
						<JsonDisplay obj={this.state.selectionData} />
					</div>
				)}
			</React.Fragment>
		)
	}
}

type Map2dState = {
	cache: Map<RSMapChunk, { render: Promise<string>, src: string | null }>,
};
export class Map2dView extends React.Component<{ addArea?: (x: number, z: number) => void, chunks: RSMapChunk[], gridsize: number, mapscenes: boolean }, Map2dState> {
	constructor(p) {
		super(p);

		this.state = {
			cache: new Map()
		}
	}

	render() {
		let xmin = Infinity, xmax = -Infinity;
		let zmin = Infinity, zmax = -Infinity;
		for (let chunk of this.props.chunks) {
			xmin = Math.min(xmin, chunk.chunkx); xmax = Math.max(xmax, chunk.chunkx + 1);
			zmin = Math.min(zmin, chunk.chunkz); zmax = Math.max(zmax, chunk.chunkz + 1);
		}
		let xsize = xmax - xmin + 2;
		let zsize = zmax - zmin + 2;
		xmin--;
		zmin--;

		let addgrid: (JSX.Element | null)[] = [];
		for (let x = xmin; x < xmin + xsize; x++) {
			for (let z = zmin; z < zmin + zsize; z++) {
				let style: React.CSSProperties = {
					gridColumn: "" + (x - xmin + 1),
					gridRow: "" + (zmin + zsize - z),
					border: "1px solid rgba(255,255,255,0.2)"
				}
				addgrid.push(<div key={`${x}-${z}`} className="map-grid-placeholder" onClick={() => this.props.addArea?.(x, z)} style={style}></div>);
			}
		}


		let gridsize = this.props.gridsize;
		let pad = 20;
		return (
			<div className="map-grid-container">
				<div className="map-grid-root" style={{ gridTemplateColumns: `${pad}px repeat(${xsize - 2},${gridsize}px) ${pad}px`, gridTemplateRows: `${pad}px repeat(${zsize - 2},${gridsize}px) ${pad}px` }}>
					{this.props.chunks.flatMap((chunk, i) => {
						let style: React.CSSProperties = {
							gridColumn: `${chunk.chunkx - xmin + 1}/span ${1}`,
							gridRow: `${zsize - (chunk.chunkz - zmin)}/span ${1}`
						}
						let cached = this.state.cache.get(chunk);
						if (cached?.src) {
							style.backgroundImage = cached.src;
						} else if (!cached) {
							let prom = chunk.renderSvg(0, false);
							cached = { render: prom, src: null as null | string };
							this.state.cache.set(chunk, cached);
							prom.then(svg => {
								cached!.src = `url("data:image/svg+xml;base64,${btoa(svg)}")`;
								this.forceUpdate();
							});
						}
						addgrid[(chunk.chunkx - xmin) * zsize + (chunk.chunkz - zmin)] = null;
						return (
							<div key={i} className={classNames("map-grid-area", { "map-grid-area-loading": !cached?.src })} style={style}>
								{chunk.chunkx},{chunk.chunkz}
							</div>
						);
					})}
					{addgrid}
				</div>
			</div>
		);
	}
}