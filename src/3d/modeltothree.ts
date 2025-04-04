import { cacheConfigPages, cacheMajors, lastClassicBuildnr, lastLegacyBuildnr } from "../constants";
import { ParsedTexture } from "./textures";
import { ModelData, parseOb3Model } from '../3d/rt7model';
import { parseRT5Model } from "../3d/rt5model";
import { convertMaterial, defaultMaterial, materialCacheKey, MaterialData } from "./jmat";
import * as THREE from "three";
import { CacheFileSource, CacheIndex, mappedFileIds, oldConfigMaps, SubFile } from "../cache";
import { CachedObject, CachingFileSource } from "../cache/memorycache";
import { Bone, BufferAttribute, BufferGeometry, Matrix4, Mesh, Object3D, Skeleton, SkinnedMesh, Texture } from "three";
import { parse } from "../opdecoder";
import { mapsquare_underlays } from "../../generated/mapsquare_underlays";
import { mapsquare_overlays } from "../../generated/mapsquare_overlays";
import { mapscenes } from "../../generated/mapscenes";
import { cacheFileJsonModes } from "../scripts/filetypes";
import { JSONSchema6Definition } from "json-schema";
import { models } from "../../generated/models";
import { crc32, CrcBuilder } from "../libs/crc32util";
import { makeImageData } from "../imgutils";
import { parseLegacySprite, parseSprite, parseTgaSprite, SubImageData } from "./sprite";
import { combineLegacyTexture, LegacyData, legacyGroups, legacyMajors, legacyPreload, parseLegacyImageFile } from "../cache/legacycache";
import { classicConfig, ClassicConfig, ClassicFileSource, classicGroups } from "../cache/classicloader";
import { parseRT2Model } from "./rt2model";
import { classicRoof14, classicRoof16, classicRoof13, classicRoof10, classicRoof17, classicRoof12, materialPreviewCube, classicWall, classicWallDiag, classicRoof15, getAttributeBackingStore } from "./modelutils";
import { classicOverlays, classicUnderlays } from "./classicmap";
import { HSL2RGB, HSL2RGBfloat, packedHSL2HSL } from "../utils";
import { loadProcTexture } from "./proceduraltexture";
import { maplabels } from "../../generated/maplabels";
import { minimapLocMaterial } from "../rs3shaders";
import { DependencyGraph, getDependencies } from "../scripts/dependencies";

const constModelOffset = 1000000;

export const constModelsIds = {
	materialCube: constModelOffset + 1,
	classicWall: constModelOffset + 2,
	classicWallDiag: constModelOffset + 3,
	classicRoof10: constModelOffset + 10,
	classicRoof12: constModelOffset + 12,
	classicRoof13: constModelOffset + 13,
	classicRoof14: constModelOffset + 14,
	classicRoof15: constModelOffset + 15,
	classicRoof16: constModelOffset + 16,
	classicRoof17: constModelOffset + 17,
}

const constModels = new Map([
	[constModelsIds.materialCube, Promise.resolve(materialPreviewCube)],
	[constModelsIds.classicWall, Promise.resolve(classicWall)],
	[constModelsIds.classicWallDiag, Promise.resolve(classicWallDiag)],
	[constModelsIds.classicRoof10, Promise.resolve(classicRoof10)],
	[constModelsIds.classicRoof12, Promise.resolve(classicRoof12)],
	[constModelsIds.classicRoof13, Promise.resolve(classicRoof13)],
	[constModelsIds.classicRoof14, Promise.resolve(classicRoof14)],
	[constModelsIds.classicRoof15, Promise.resolve(classicRoof15)],
	[constModelsIds.classicRoof16, Promise.resolve(classicRoof16)],
	[constModelsIds.classicRoof17, Promise.resolve(classicRoof17)]
]);

export type ParsedMaterial = {
	//TODO rename
	mat: THREE.Material,
	matmeta: MaterialData
}

export function augmentThreeJsMinimapLocMaterial(mat: THREE.Material) {
	mat.customProgramCacheKey = () => "minimaploc";
	mat.onBeforeCompile = (shader, renderer) => {
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <map_fragment>",
				`#ifdef USE_MAP\n`
				+ `vec4 sampledDiffuseColor = texture2D( map, vUv );\n`
				+ `#ifdef DECODE_VIDEO_TEXTURE\n`
				+ `sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );\n`
				+ `#endif\n`
				+ `sampledDiffuseColor.a = pow(sampledDiffuseColor.a,1.0/2.4);\n`//i don't know i'm lost, this seems to match
				+ `if(sampledDiffuseColor.a < 0.5){discard;}\n`
				// + `sampledDiffuseColor.a = step( 0.05, sampledDiffuseColor.a);\n`
				// + `sampledDiffuseColor.rgb *= 0.1;\n`
				// + `sampledDiffuseColor.rgb = pow(sampledDiffuseColor.rgb,vec3(2.2));\n`
				+ `diffuseColor *= sampledDiffuseColor;\n`
				+ `#endif\n`
			)
			.replace("#include <color_fragment>",
				`#if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR )\n`
				+ `vec3 srgbVColor = pow(vColor.rgb,vec3(1.0/2.4));\n`//convert vertex color from linear to srgb
				+ `#if defined( USE_COLOR_ALPHA )\n`
				+ `diffuseColor *= vec4(srgbVColor,vColor.a);\n`
				+ `#elif defined( USE_COLOR )\n`
				+ `diffuseColor.rgb *= srgbVColor;\n`
				+ `#endif\n`
				+ `#endif\n`
			)
			.replace("#include <colorspace_fragment>",
				"\n"
			);
	}
}

export function augmentZOffsetMaterial(mat: THREE.Material, zoffset: number) {
	mat.customProgramCacheKey = () => "zoffset" + zoffset;
	mat.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace(/#include <(\w+)>/g, (m, n) => `// == ${n} ==\n${m}`);
		shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `
			#include <project_vertex>
			mvPosition.xyz -= normalize(mvPosition.xyz) * ${zoffset.toExponential()};
			gl_Position = projectionMatrix * mvPosition;
		`);
	};
}

export function augmentThreeJsFloorMaterial(mat: THREE.Material, isminimap: boolean) {
	mat.customProgramCacheKey = () => (isminimap ? "minimaptex" : "floortex");
	mat.onBeforeCompile = (shader, renderer) => {
		shader.vertexShader =
			`#ifdef USE_MAP\n`
			+ `attribute vec2 texcoord_0;\n`
			+ `attribute vec2 texcoord_1;\n`
			+ `attribute vec2 texcoord_2;\n`
			+ `attribute vec3 color_1;\n`
			+ `attribute vec3 color_2;\n`
			+ `varying vec2 v_ra_floortex_0;\n`
			+ `varying vec2 v_ra_floortex_1;\n`
			+ `varying vec2 v_ra_floortex_2;\n`
			+ `varying vec3 v_ra_floortex_weights;\n`
			+ `varying vec3 v_ra_floortex_usescolor;\n`
			+ `#endif\n`
			+ shader.vertexShader.replace("#include <uv_vertex>",
				`#ifdef USE_MAP\n`
				+ `v_ra_floortex_0 = texcoord_0;\n`
				+ `v_ra_floortex_1 = texcoord_1;\n`
				+ `v_ra_floortex_2 = texcoord_2;\n`
				+ `v_ra_floortex_weights = color_1;\n`
				+ `v_ra_floortex_usescolor = color_2;\n`
				+ `#endif\n`
				+ "#include <uv_vertex>"
			);
		shader.fragmentShader =
			`#ifdef USE_MAP\n`
			+ `varying vec2 v_ra_floortex_0;\n`
			+ `varying vec2 v_ra_floortex_1;\n`
			+ `varying vec2 v_ra_floortex_2;\n`
			+ `varying vec3 v_ra_floortex_weights;\n`
			+ `varying vec3 v_ra_floortex_usescolor;\n`
			+ `#endif\n`
			+ `\n`
			+ `highp vec3 runeapps_srgb_to_linear(highp vec3 color,float gamma){\n`
			+ `	return pow(color.rgb,vec3(1.0/gamma));\n`
			+ `}\n`
			+ `highp vec3 runeapps_linear_to_srgb(highp vec3 color,float gamma){\n`
			+ `	return pow(color.rgb,vec3(gamma));\n`
			+ `}\n`
			+ shader.fragmentShader
				.replace("#include <color_fragment>", "")
				.replace("#include <map_fragment>",
					`#include <color_fragment>\n`
					+ `#ifdef USE_MAP\n`
					+ `vec4 texelColor = \n`
					+ (isminimap ?
						`   v_ra_floortex_weights.r * mix(texture2D( map, v_ra_floortex_0 ), diffuseColor * 0.5, v_ra_floortex_usescolor.r)\n`
						+ ` + v_ra_floortex_weights.g * mix(texture2D( map, v_ra_floortex_1 ), diffuseColor * 0.5, v_ra_floortex_usescolor.g)\n`
						+ ` + v_ra_floortex_weights.b * mix(texture2D( map, v_ra_floortex_2 ), diffuseColor * 0.5, v_ra_floortex_usescolor.b);\n`
						// + "texelColor.rgb = sqrt( texelColor.rgb );\n"
						:
						`   texture2D( map, v_ra_floortex_0 ) * v_ra_floortex_weights.r * mix(vec4(1.0), diffuseColor, v_ra_floortex_usescolor.r)\n`
						+ ` + texture2D( map, v_ra_floortex_1 ) * v_ra_floortex_weights.g * mix(vec4(1.0), diffuseColor, v_ra_floortex_usescolor.g)\n`
						+ ` + texture2D( map, v_ra_floortex_2 ) * v_ra_floortex_weights.b * mix(vec4(1.0), diffuseColor, v_ra_floortex_usescolor.b);\n`
					)
					//TODO is this needed?
					+ `texelColor = mix( diffuseColor,texelColor,dot(vec3(1.0),v_ra_floortex_weights));\n`
					+ `#endif\n`
					+ `diffuseColor = texelColor;\n`
				);
		if (isminimap) {
			shader.fragmentShader = shader.fragmentShader
				.replace("#include <colorspace_fragment>",
					"const float outgamma=2.3;\n"
					+ "gl_FragColor.rgb = runeapps_srgb_to_linear(gl_FragColor.rgb,outgamma);\n"//don't blame me for this, this is literally how the minimap is rendered
				)
				.replace("#include <lights_fragment_begin>",
					`#include <lights_fragment_begin>\n`
					+ `irradiance =  runeapps_linear_to_srgb(0.5*getAmbientLightIrradiance( ambientLightColor ),2.4);\n`
					+ `irradiance += runeapps_linear_to_srgb(0.5*getLightProbeIrradiance( lightProbe, geometry.normal ),2.4);\n`
					// + `irradiance *= 0.5;\n`
				)
			// .replace("#include <color_fragment>",
			// 	`#if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR )\n`
			// 	+ `vec3 srgbVColor = runeapps_srgb_to_linear(vColor.rgb,2.4);\n`//convert vertex color from linear to srgb
			// 	+ `#if defined( USE_COLOR_ALPHA )\n`
			// 	+ `diffuseColor *= vec4(srgbVColor,vColor.a);\n`
			// 	+ `#elif defined( USE_COLOR )\n`
			// 	+ `diffuseColor.rgb *= srgbVColor;\n`
			// 	+ `#endif\n`
			// 	+ `#endif\n`
			// )
			// .replace("#include <colorspace_fragment>",
			// 	"\n"
			// );
		}
	}
}


//basically stores all the config of the game engine
export class EngineCache extends CachingFileSource {
	hasOldModels = false;
	hasNewModels = false;

	materialArchive = new Map<number, Buffer>();
	materialCache = new Map<number, MaterialData>();
	mapUnderlays: (mapsquare_underlays | mapsquare_overlays)[] = [];
	mapOverlays: mapsquare_overlays[] = [];
	mapMapscenes: mapscenes[] = [];
	mapMaplabels: maplabels[] = [];

	legacyData: LegacyData | null = null;
	classicData: ClassicConfig | null = null;

	private jsonSearchCache = new Map<string, { files: Promise<any[]>, schema: JSONSchema6Definition }>();
	private dependencyGraph: Promise<DependencyGraph> | null = null;

	static create(source: CacheFileSource) {
		return new EngineCache(source).preload();
	}

	private constructor(source: CacheFileSource) {
		super(source);
	}

	private async preload() {
		if (this.getBuildNr() > lastLegacyBuildnr) {
			for (let subfile of await this.getArchiveById(cacheMajors.config, cacheConfigPages.mapunderlays)) {
				this.mapUnderlays[subfile.fileid] = parse.mapsquareUnderlays.read(subfile.buffer, this.rawsource);
			}
			for (let subfile of await this.getArchiveById(cacheMajors.config, cacheConfigPages.mapoverlays)) {
				this.mapOverlays[subfile.fileid] = parse.mapsquareOverlays.read(subfile.buffer, this.rawsource);
			}

			if (this.getBuildNr() >= 527) {
				for (let subfile of await this.getArchiveById(cacheMajors.config, cacheConfigPages.mapscenes)) {
					this.mapMapscenes[subfile.fileid] = parse.mapscenes.read(subfile.buffer, this.rawsource);
				}
			}
			if (this.getBuildNr() >= 548) {
				for (let subfile of await this.getArchiveById(cacheMajors.config, cacheConfigPages.maplabels)) {
					this.mapMaplabels[subfile.fileid] = parse.maplabels.read(subfile.buffer, this.rawsource);
				}
			}

			if (this.getBuildNr() <= 471) {
				for (let file of await this.getArchiveById(cacheMajors.texturesOldPng, 0)) {
					this.materialArchive.set(file.fileid, file.buffer);
				}
			} else if (this.getBuildNr() <= 498) {
				//no material data
			} else if (this.getBuildNr() <= 753) {
				let file = await this.getFile(cacheMajors.materials, 0);
				this.materialArchive.set(0, file);
			} else {
				for (let file of await this.getArchiveById(cacheMajors.materials, 0)) {
					this.materialArchive.set(file.fileid, file.buffer);
				}
			}

			let rootindex = await this.getCacheIndex(cacheMajors.index);
			this.hasNewModels = !!rootindex[cacheMajors.models];
			this.hasOldModels = !!rootindex[cacheMajors.oldmodels];
		} else if (this.getBuildNr() > lastClassicBuildnr) {
			this.legacyData = await legacyPreload(this);
			let floors = this.legacyData.overlays.map(q => parse.mapsquareOverlays.read(q, this));
			this.mapOverlays = floors;
			this.mapUnderlays = floors;

			this.hasNewModels = false;
			this.hasOldModels = true;
		} else {
			if (!(this.rawsource instanceof ClassicFileSource)) {
				throw new Error("can only load classic caches from a classic source");
			}
			this.classicData = await classicConfig(this.rawsource, this.getBuildNr());
			this.mapUnderlays = classicUnderlays();
			this.mapOverlays = await classicOverlays(this);
			this.hasNewModels = false;
			this.hasOldModels = true;
		}

		return this;
	}

	async getDependencyGraph() {
		this.dependencyGraph ??= getDependencies(this, { lazyMapChunks: true });
		return this.dependencyGraph;
	}

	async getGameFile(type: keyof LegacyData & keyof typeof cacheMajors, id: number) {
		if (this.legacyData) {
			return this.legacyData[type][id];
		} else {
			return this.getFileById(cacheMajors[type], id);
		}
	}

	getMaterialData(id: number) {
		let cached = this.materialCache.get(id);
		if (!cached) {
			if (id == -1) {
				cached = defaultMaterial();
			} else {
				if (this.getBuildNr() <= lastLegacyBuildnr) {
					cached = defaultMaterial();
					cached.textures.diffuse = id;
					cached.baseColorFraction = 1;
					cached.texmodes = "mirror";
					cached.texmodet = "mirror";
				} else if (this.getBuildNr() <= 471) {
					let file = this.materialArchive.get(id);
					if (!file) { throw new Error("material " + id + " not found"); }
					let matprops = parse.oldproctexture.read(file, this);
					cached = defaultMaterial();
					cached.textures.diffuse = matprops.spriteid;
					cached.baseColorFraction = 1;
				} else if (this.getBuildNr() <= 753) {
					cached = defaultMaterial();
					if (this.getBuildNr() >= 500) {
						let matlist = parse.oldmaterials.read(this.materialArchive.get(0)!, this);
						let matdata = matlist.mats[id];
						//builds 736-759 tecnically do have usable textures, this depends on scenecache.texturemode!="none"
						//textures should be moved to enginecache
						// cached.textures.diffuse = id;
						if (matdata.basecolorfraction != null && matdata.basecolor != null) {
							cached.baseColorFraction = matdata.basecolorfraction / 255;
							cached.baseColor = HSL2RGBfloat(packedHSL2HSL(matdata.basecolor));
						}
						cached.textures.diffuse = matdata.id;
						//TODO other material props
					}
				} else {
					let file = this.materialArchive.get(id);
					if (!file) { throw new Error("material " + id + " not found"); }
					cached = convertMaterial(file, id, this.rawsource);
				}
			}
			this.materialCache.set(id, cached);
		}
		return cached;
	}

	/**
	 * very aggressive caching, do not use for objects which take a lot of memory
	 */
	getJsonSearchData(modename: string) {
		let cached = this.jsonSearchCache.get(modename);
		if (!cached) {
			let mode = cacheFileJsonModes[modename as keyof typeof cacheFileJsonModes];
			if (!mode) { throw new Error("unknown decode mode " + modename); }
			let files = (async () => {
				await mode.prepareDump?.(this);
				let allfiles = await mode.lookup.logicalRangeToFiles(this, [0, 0], [Infinity, Infinity]);
				let lastarchive: null | { index: CacheIndex, subfiles: SubFile[] } = null;
				let files: any[] = [];
				for (let fileid of allfiles) {
					let arch: SubFile[];
					if (lastarchive && lastarchive.index == fileid.index) {
						arch = lastarchive.subfiles;
					} else {
						arch = await this.getFileArchive(fileid.index);
						lastarchive = { index: fileid.index, subfiles: arch };
					}
					let file = arch[fileid.subindex];
					let logicalid = mode.lookup.fileToLogical(this, fileid.index.major, fileid.index.minor, file.fileid);
					let res = mode.parser.read(file.buffer, this.rawsource);
					res.$fileid = (logicalid.length == 1 ? logicalid[0] : logicalid);
					files.push(res);
				}

				return files;
			})();
			cached = { files, schema: mode.parser.parser.getJsonSchema() }
			this.jsonSearchCache.set(modename, cached);
		}
		return cached;
	}
}

export async function* iterateConfigFiles(cache: EngineCache, major: number) {
	if (cache.legacyData) {
		let files: Buffer[] | null = null;
		if (major == cacheMajors.items) { files = cache.legacyData.items; }
		else if (major == cacheMajors.npcs) { files = cache.legacyData.npcs; }
		else if (major == cacheMajors.objects) { files = cache.legacyData.objects; }
		else if (major == cacheMajors.spotanims) { files = cache.legacyData.spotanims; }
		if (!files) { throw new Error(`cache major ${major} can not be iterated`); }
		yield* files.map((file, id) => ({ id, file }));
	} else if (cache.getBuildNr() <= 488) {
		let arch = await cache.getArchiveById(cacheMajors.config, oldConfigMaps[major]);
		yield* arch.map(q => ({ id: q.fileid, file: q.buffer }));
	} else {
		let locindices = await cache.getCacheIndex(major);
		let stride = mappedFileIds[major];
		for (let index of locindices) {
			if (!index) { continue; }
			let arch = await cache.getFileArchive(index);
			yield* arch.map(q => ({ id: index.minor * stride + q.fileid, file: q.buffer }));
		}
	}
}

export async function detectTextureMode(source: CacheFileSource) {
	let detectmajor = async (major: number) => {
		let lastfile = -1;
		try {
			let indexfile = await source.getCacheIndex(major);
			let last = indexfile[indexfile.length - 1];
			await source.getFile(last.major, last.minor, last.crc);
			lastfile = last.minor;
		} catch (e) { }
		return lastfile;
	}

	let textureMode: TextureModes = "none";
	if (source.getBuildNr() <= lastClassicBuildnr) {
		let texindex = await source.findSubfileByName(0, classicGroups.textures, "INDEX.DAT");
		textureMode = (texindex ? "legacy" : "legacytga");
	} else if (source.getBuildNr() <= lastLegacyBuildnr) {
		textureMode = "legacy";
	} else if (source.getBuildNr() <= 471) {
		textureMode = "oldproc";
	} else if (source.getBuildNr() <= 736) {
		textureMode = "fullproc";//uses old procedural textures in index 9
	} else {
		let numbmp = await detectmajor(cacheMajors.texturesBmp);
		let numdds = await detectmajor(cacheMajors.texturesDds);
		if (numbmp > 0 || numdds > 0) {
			textureMode = (numbmp > numdds ? "bmp" : "dds");
		} else {
			let numpng2014 = await detectmajor(cacheMajors.textures2015Png);
			let numdds2014 = await detectmajor(cacheMajors.textures2015Dds);
			if (numpng2014 > 0 || numdds2014 >= 0) {
				textureMode = (numdds2014 > numpng2014 ? "dds2014" : "png2014");
			} else if (await detectmajor(cacheMajors.texturesOldPng) > 0) {
				textureMode = "oldpng";
			} else {
				textureMode = "none";
			}
		}
	}
	console.log(`detectedtexture mode. ${textureMode}`);
	return textureMode;
}

async function convertMaterialToThree(source: ThreejsSceneCache, material: MaterialData, hasVertexAlpha: boolean, minimapVariant: boolean) {
	let mat = new THREE.MeshStandardMaterial();
	mat.alphaTest = (material.alphamode == "cutoff" ? 0.5 : 0.1);//TODO use value from material
	mat.transparent = hasVertexAlpha || material.alphamode == "blend";
	const wraptypes = material.texmodes == "clamp" ? THREE.ClampToEdgeWrapping : material.texmodes == "repeat" ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;
	const wraptypet = material.texmodet == "clamp" ? THREE.ClampToEdgeWrapping : material.texmodet == "repeat" ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;

	if (typeof material.textures.diffuse != "undefined" && source.textureType != "none") {
		let diffuse = await (await source.getTextureFile("diffuse", material.textures.diffuse, material.stripDiffuseAlpha)).toImageData();
		let difftex = new THREE.DataTexture(diffuse.data, diffuse.width, diffuse.height, THREE.RGBAFormat);
		difftex.needsUpdate = true;
		difftex.wrapS = wraptypes;
		difftex.wrapT = wraptypet;
		difftex.colorSpace = THREE.SRGBColorSpace;
		difftex.magFilter = THREE.LinearFilter;
		difftex.minFilter = THREE.NearestMipMapNearestFilter;
		difftex.generateMipmaps = true;

		mat.map = difftex;

		if (material.textures.normal) {
			let parsed = await source.getTextureFile("normal", material.textures.normal, false);
			let raw = await parsed.toImageData();
			let normals = makeImageData(null, raw.width, raw.height);
			let emisive = makeImageData(null, raw.width, raw.height);
			const data = raw.data;
			for (let i = 0; i < data.length; i += 4) {
				//normals
				let dx = data[i + 1] / 127.5 - 1;
				let dy = data[i + 3] / 127.5 - 1;
				normals.data[i + 0] = data[i + 1];
				normals.data[i + 1] = data[i + 3];
				normals.data[i + 2] = (Math.sqrt(Math.max(1 - dx * dx - dy * dy, 0)) + 1) * 127.5;
				normals.data[i + 3] = 255;
				//emisive //TODO check if normals flag always implies emisive
				const emissive = data[i + 0] / 255;
				emisive.data[i + 0] = diffuse.data[i + 0] * emissive;
				emisive.data[i + 1] = diffuse.data[i + 1] * emissive;
				emisive.data[i + 2] = diffuse.data[i + 2] * emissive;
				emisive.data[i + 3] = 255;
			}
			mat.normalMap = new THREE.DataTexture(normals.data, normals.width, normals.height, THREE.RGBAFormat);
			mat.normalMap.needsUpdate = true;
			mat.normalMap.wrapS = wraptypes;
			mat.normalMap.wrapT = wraptypet;
			mat.normalMap.magFilter = THREE.LinearFilter;

			mat.emissiveMap = new THREE.DataTexture(emisive.data, emisive.width, emisive.height, THREE.RGBAFormat);
			mat.emissiveMap.needsUpdate = true;
			mat.emissiveMap.wrapS = wraptypes;
			mat.emissiveMap.wrapT = wraptypet;
			mat.emissiveMap.magFilter = THREE.LinearFilter;
			mat.emissive.setRGB(1, 1, 1);
		}
		if (material.textures.compound) {
			let compound = await (await source.getTextureFile("compound", material.textures.compound, false)).toImageData();
			let compoundmapped = makeImageData(null, compound.width, compound.height);
			//threejs expects g=metal,b=roughness, rs has r=metal,g=roughness
			for (let i = 0; i < compound.data.length; i += 4) {
				compoundmapped.data[i + 1] = compound.data[i + 1];
				compoundmapped.data[i + 2] = compound.data[i + 0];
				compoundmapped.data[i + 3] = 255;
			}
			let tex = new THREE.DataTexture(compoundmapped.data, compoundmapped.width, compoundmapped.height, THREE.RGBAFormat);
			tex.needsUpdate = true;
			tex.wrapS = wraptypes;
			tex.wrapT = wraptypet;
			tex.colorSpace = THREE.SRGBColorSpace;
			tex.magFilter = THREE.LinearFilter;
			mat.metalnessMap = tex;
			mat.roughnessMap = tex;
			mat.metalness = 1;
		}
	}
	mat.vertexColors = material.baseColorFraction != 1 || !material.textures.diffuse || hasVertexAlpha;

	mat.userData = material;
	if (material.uvAnim) {
		(mat.userData.gltfExtensions ??= {}).RA_materials_uvanim = {
			uvAnim: [material.uvAnim.u, material.uvAnim.v]
		};
	}
	if (minimapVariant) {
		// augmentThreeJsMinimapLocMaterial(mat);
		mat = minimapLocMaterial(mat.map!, material.alphamode, material.alphacutoff) as any;
	}

	return { mat, matmeta: material };
}

type ModelModes = "nxt" | "old" | "classic";
type TextureModes = "png" | "dds" | "bmp" | "ktx" | "oldpng" | "png2014" | "dds2014" | "none" | "oldproc" | "fullproc" | "legacy" | "legacytga";
type TextureTypes = keyof MaterialData["textures"];

export class ThreejsSceneCache {
	private modelCache = new Map<number, CachedObject<ModelData>>();
	private threejsTextureCache = new Map<number, CachedObject<ParsedTexture>>();
	private threejsMaterialCache = new Map<number, CachedObject<ParsedMaterial>>();
	engine: EngineCache;
	textureType: TextureModes = "dds";
	modelType: ModelModes = "nxt";

	static textureIndices: Record<TextureTypes, Record<Exclude<TextureModes, "none">, number>> = {
		diffuse: {
			png: cacheMajors.texturesPng,
			dds: cacheMajors.texturesDds,
			bmp: cacheMajors.texturesBmp,
			ktx: cacheMajors.texturesKtx,
			png2014: cacheMajors.textures2015Png,
			dds2014: cacheMajors.textures2015Dds,
			oldpng: cacheMajors.texturesOldPng,
			oldproc: cacheMajors.sprites,
			fullproc: cacheMajors.texturesOldPng,
			legacy: legacyMajors.data,
			legacytga: 0
		},
		normal: {
			png: cacheMajors.texturesPng,
			dds: cacheMajors.texturesDds,
			bmp: cacheMajors.texturesBmp,
			ktx: cacheMajors.texturesKtx,
			//TODO are these normals or compounds?
			png2014: cacheMajors.textures2015CompoundPng,
			dds2014: cacheMajors.textures2015CompoundDds,
			oldpng: cacheMajors.texturesOldCompoundPng,
			oldproc: 0,
			fullproc: 0,
			legacy: 0,
			legacytga: 0
		},
		compound: {
			png: cacheMajors.texturesPng,
			dds: cacheMajors.texturesDds,
			bmp: cacheMajors.texturesBmp,
			ktx: cacheMajors.texturesKtx,
			//TODO are these normals or compounds?
			png2014: cacheMajors.textures2015CompoundPng,
			dds2014: cacheMajors.textures2015CompoundDds,
			oldpng: cacheMajors.texturesOldCompoundPng,
			oldproc: 0,
			fullproc: 0,
			legacy: 0,
			legacytga: 0
		}
	}

	private constructor(scenecache: EngineCache, modeltype: ModelModes | "auto") {
		this.engine = scenecache;
		if (modeltype != "auto") {
			this.modelType = modeltype;
		} else if (scenecache.getBuildNr() <= lastClassicBuildnr) {
			this.modelType = "classic";
		} else if (scenecache.hasOldModels && !scenecache.hasNewModels) {
			this.modelType = "old";
		} else {
			this.modelType = "nxt";
		}
	}
	static async create(engine: EngineCache, texturemode: TextureModes | "auto" = "auto", modelmode: ModelModes | "auto" = "auto") {
		let scene = new ThreejsSceneCache(engine, modelmode);
		scene.textureType = (texturemode == "auto" ? await detectTextureMode(engine.rawsource) : texturemode);
		return scene;
	}

	getTextureFile(type: TextureTypes, texid: number, stripAlpha: boolean) {
		let cacheindex = ThreejsSceneCache.textureIndices[type][this.textureType];
		let cachekey = ((cacheindex | 0xff) << 23) | texid;
		let texmode = this.textureType;

		return this.engine.fetchCachedObject(this.threejsTextureCache, cachekey, async () => {
			if (texmode == "fullproc") {
				let tex = await loadProcTexture(this.engine, texid);
				let parsed = new ParsedTexture(tex.img, false, false);
				parsed.filesize = tex.filesize;
				return parsed;
			} else if (texmode == "legacytga" || texmode == "legacy") {
				let img: SubImageData;
				if (this.engine.classicData) {
					let texmeta = this.engine.classicData.textures[texid - 1];
					img = await combineLegacyTexture(this.engine, texmeta.name, texmeta.subname, texmode == "legacytga");
				} else {
					let imgfile = await this.engine.getArchiveById(legacyMajors.data, legacyGroups.textures);
					img = await parseLegacyImageFile(this.engine, imgfile[texid].buffer)
				}
				return new ParsedTexture(img.img, stripAlpha, false);
			} else {
				let file = await this.engine.getFileById(cacheindex, texid);
				if (texmode == "oldproc") {
					let sprite = parseSprite(file);
					return new ParsedTexture(sprite[0].img, stripAlpha, false);
				} else {
					return new ParsedTexture(file, stripAlpha, true);
				}
			}
		}, obj => obj.filesize * 2);
	}

	getModelData(id: number) {
		if (id >= constModelOffset) {
			let res = constModels.get(id);
			if (!res) { throw new Error(`constmodel ${id} does not exist`); }
			return res;
		}

		return this.engine.fetchCachedObject(this.modelCache, id, async () => {
			if (this.modelType == "nxt") {
				let file = await this.engine.getFileById(cacheMajors.models, id);
				return parseOb3Model(file, this.engine);
			} else if (this.modelType == "old") {
				let major = (this.engine.legacyData ? legacyMajors.oldmodels : cacheMajors.oldmodels);
				let file = await this.engine.getFileById(major, id);
				return parseRT5Model(file, this.engine.rawsource);
			} else if (this.modelType == "classic") {
				let arch = await this.engine.getArchiveById(0, classicGroups.models);
				return parseRT2Model(arch[id].buffer, this.engine);
			} else {
				throw new Error("unexpected");
			}
		}, obj => obj.meshes.reduce((a, m) => m.indices.count, 0) * 30);
	}

	getMaterial(matid: number, hasVertexAlpha: boolean, minimapVariant: boolean) {
		//TODO the material should have this data, not the mesh
		let matcacheid = materialCacheKey(matid, hasVertexAlpha, minimapVariant);
		return this.engine.fetchCachedObject(this.threejsMaterialCache, matcacheid, async () => {
			let material = this.engine.getMaterialData(matid);
			return convertMaterialToThree(this, material, hasVertexAlpha, minimapVariant);
		}, mat => 256 * 256 * 4 * 2);
	}
}

function clamp(num: number) {
	return (num > 255 ? 255 : num < 0 ? 0 : num);
}

export function applyMaterial(mesh: Mesh, parsedmat: ParsedMaterial, minimapVariant: boolean, inplace = false) {
	let oldcol = mesh.geometry.getAttribute("color");
	let hasVertexAlpha = !!oldcol && oldcol.itemSize == 4;
	mesh.material = parsedmat.mat;
	//TODO what does the minimap do when basecolorfraction!=1, eg:0.8
	let basecolor = (minimapVariant && parsedmat.matmeta.baseColorFraction == 1 ? [0.5, 0.5, 0.5] : parsedmat.matmeta.baseColor);
	let nonwhiteverts = parsedmat.matmeta.baseColorFraction != 1 || basecolor.some(q => q != 1) || minimapVariant
	let needsvertexcolors = nonwhiteverts || !parsedmat.matmeta.textures.diffuse || hasVertexAlpha;
	if (needsvertexcolors) {
		if (parsedmat.matmeta.baseColorFraction != 0) {
			let vertcount = mesh.geometry.getAttribute("position").count;
			let oldcol = mesh.geometry.getAttribute("color");
			let oldfrac = 1 - parsedmat.matmeta.baseColorFraction;
			let newrcomp = parsedmat.matmeta.baseColorFraction * basecolor[0] * 255;
			let newgcomp = parsedmat.matmeta.baseColorFraction * basecolor[1] * 255;
			let newbcomp = parsedmat.matmeta.baseColorFraction * basecolor[2] * 255;
			let itemsize = hasVertexAlpha ? 4 : 3;
			let newcol = (inplace && oldcol ? oldcol : new BufferAttribute(new Uint8Array(itemsize * vertcount), itemsize, true));
			if (hasVertexAlpha && !oldcol) {
				throw new Error("material has vertex alpha, but mesh doesn't have vertex colors");
			}

			let [oldbuf, oldoffset, oldstride] = getAttributeBackingStore(oldcol);
			let [newbuf, newoffset, newstride] = getAttributeBackingStore(newcol);
			let hasoldcol = !!oldcol;

			for (let i = 0; i < vertcount; i++) {
				let ii = newoffset + newstride * i;
				let jj = oldoffset + oldstride * i;
				let oldr = (hasoldcol ? oldbuf[jj + 0] : 255);
				let oldg = (hasoldcol ? oldbuf[jj + 1] : 255);
				let oldb = (hasoldcol ? oldbuf[jj + 2] : 255);
				newbuf[ii + 0] = clamp(oldr * oldfrac + newrcomp);
				newbuf[ii + 1] = clamp(oldg * oldfrac + newgcomp);
				newbuf[ii + 2] = clamp(oldb * oldfrac + newbcomp);
				if (hasVertexAlpha) {
					newbuf[ii + 3] = (hasoldcol ? oldbuf[jj + 3] : 255);
				}
			}
			mesh.geometry.setAttribute("color", newcol);
		}
	} else if (mesh.geometry.getAttribute("color")) {
		mesh.geometry.deleteAttribute("color");
	}
}

/**
 * When merging player npc models the client incorrectly merge vertices which
 * have the same position+color+material, but with different bone ids. The second
 * vertex will be merged and its bone id is lost. This bug is so entrenched in
 * the game that player models will have detached arms and waist if not replicated
 */
export function mergeBoneids(model: ModelData) {
	let totalverts = model.meshes.reduce((a, v) => a + v.vertexend - v.vertexstart, 0);
	let order = new Uint32Array(totalverts);
	let orderindex = 0;
	for (let meshindex = 0; meshindex < model.meshes.length; meshindex++) {
		let mesh = model.meshes[meshindex];
		for (let i = mesh.vertexstart; i < mesh.vertexend; i++) {
			order[orderindex++] = (meshindex << 23) | i;
		}
	}

	function compareVertkeys(model: ModelData, a: number, b: number) {
		const mesha = model.meshes[a >> 23];
		const meshb = model.meshes[b >> 23];
		const ia = a & 0x7fffff;
		const ib = b & 0x7fffff;
		const posa = mesha.attributes.pos;
		const posb = meshb.attributes.pos;
		return posa.getX(ia) - posb.getX(ib)
			|| posa.getY(ia) - posb.getY(ib)
			|| posa.getZ(ia) - posb.getZ(ib);
	}

	let tmp1 = new THREE.Vector3();
	let normsum = new THREE.Vector3();
	let mergecount = 0;
	order.sort((a, b) => compareVertkeys(model, a, b));
	for (let i = 0; i < order.length;) {
		let start = i;
		while (i < order.length && compareVertkeys(model, order[start], order[++i]) == 0);
		if (i > start + 1) {
			const mesh1 = model.meshes[order[start] >> 23];
			const i1 = order[start] & 0x7fffff;

			//calculate blended normal
			normsum.set(0, 0, 0);
			for (let j = start; j < i; j++) {
				const mesh2 = model.meshes[order[j] >> 23];
				const i2 = order[j] & 0x7fffff;

				if (mesh2.needsNormalBlending && mesh2.attributes.normals) {
					tmp1.fromBufferAttribute(mesh2.attributes.normals, i2);
					normsum.add(tmp1);
				}
			}
			normsum.normalize();

			for (let j = start; j < i; j++) {
				const mesh2 = model.meshes[order[j] >> 23];
				const i2 = order[j] & 0x7fffff;

				//copy bone id and weights from first vertex
				if (j != start && mesh1.attributes.boneids && mesh1.attributes.boneweights && mesh2.attributes.boneids && mesh2.attributes.boneweights) {
					if (mesh1.attributes.boneids.getX(i1) != mesh2.attributes.boneids.getX(i2)) {
						mergecount++;
					}
					mesh2.attributes.boneids.copyAt(i2, mesh1.attributes.boneids, i1);
					mesh2.attributes.boneweights.copyAt(i2, mesh1.attributes.boneweights, i1);
				}

				//write blended normal
				if (mesh2.needsNormalBlending && mesh2.attributes.normals) {
					//ignore faces with oposite normals
					if (normsum.lengthSq() > 0.001) {
						mesh2.attributes.normals.setXYZ(i2, normsum.x, normsum.y, normsum.z);
					}
				}
			}
		}
	}
	console.log("merged bones:", mergecount);
}

export function mergeModelDatas(models: ModelData[]) {
	let r: ModelData = {
		bonecount: Math.max(...models.map(q => q.bonecount)),
		skincount: Math.max(...models.map(q => q.skincount)),
		maxy: Math.max(...models.map(q => q.maxy)),
		miny: Math.max(...models.map(q => q.miny)),
		meshes: models.flatMap(q => q.meshes),
		debugmeshes: models.flatMap(q => q.debugmeshes ?? [])
	}
	return r;
}

export async function ob3ModelToThree(scene: ThreejsSceneCache, model: ModelData) {
	let rootnode = new Object3D();
	let nullskeleton: Skeleton = null!;
	if (model.bonecount != 0 || model.skincount != 0) {
		let nullbones: Object3D[] = [];
		let maxbones = Math.max(model.bonecount, model.skincount);
		let rootbone = new Bone();
		rootnode.add(rootbone);
		//TODO just need 2 skeletons here?
		for (let i = 0; i < maxbones; i++) { nullbones.push(rootbone); }
		nullskeleton = new Skeleton(nullbones as any);
	}

	for (let meshdata of model.meshes) {
		let attrs = meshdata.attributes;
		let geo = new THREE.BufferGeometry();
		geo.setAttribute("position", attrs.pos);
		if (attrs.color) { geo.setAttribute("color", attrs.color); }
		if (attrs.normals) { geo.setAttribute("normal", attrs.normals); }
		if (attrs.texuvs) { geo.setAttribute("uv", attrs.texuvs); }
		if (attrs.skinids) { geo.setAttribute("RA_skinIndex_skin", attrs.skinids); }
		if (attrs.skinweights) { geo.setAttribute("RA_skinWeight_skin", attrs.skinweights); }
		if (attrs.boneids) { geo.setAttribute("RA_skinIndex_bone", attrs.boneids); }
		if (attrs.boneweights) { geo.setAttribute("RA_skinWeight_bone", attrs.boneweights); }
		geo.index = meshdata.indices;
		let mesh: THREE.Mesh | THREE.SkinnedMesh;
		if (attrs.skinids || attrs.boneids) {
			mesh = new THREE.SkinnedMesh(geo);
			let oldbones = !!geo.attributes.RA_skinIndex_bone;
			if (!geo.attributes.skinIndex) {
				geo.attributes.skinIndex = (oldbones ? geo.attributes.RA_skinIndex_bone : geo.attributes.RA_skinIndex_skin);
				geo.attributes.skinWeight = (oldbones ? geo.attributes.RA_skinWeight_bone : geo.attributes.RA_skinWeight_skin);
			}
			(mesh as SkinnedMesh).bind(nullskeleton);
		} else {
			mesh = new THREE.Mesh(geo);
		}
		applyMaterial(mesh, await scene.getMaterial(meshdata.materialId, meshdata.hasVertexAlpha, false), false);
		rootnode.add(mesh);
	}
	if (model.debugmeshes && model.debugmeshes.length != 0) {
		rootnode.add(...model.debugmeshes);
	}
	return rootnode;
}

export function getModelHashes(model: models, id: number) {
	let meshhashes: {
		id: number,
		sub: number,
		uvshead: number,
		uvsfull: number,
		normalshead: number,
		normalsfull: number,
		poshead: number,
		posfull: number,
		verts: number,
		indexpos: {
			id: number,
			head: number,
			full: number,
			count: number
		}[]
	}[] = [];
	const matchvertices = 20;
	const maxfullvertices = 1000;
	const bufsize = matchvertices * 2 * 2;
	const normalssize = matchvertices * 3;
	const possize = matchvertices * 3 * 2;
	if (!model.meshes) { throw new Error("model hash not supported for new model format"); }
	for (let [sub, mesh] of model.meshes.entries()) {
		let uvshead = 0;
		let uvsfull = 0;
		let normalshead = 0;
		let normalsfull = 0;
		let poshead = 0;
		let posfull = 0;
		if (mesh.uvBuffer && mesh.uvBuffer.length >= bufsize) {
			let hasnonnull = false;
			for (let i = 0; i < bufsize; i++) {
				if (mesh.uvBuffer[i] != 0) {
					hasnonnull = true;
					break;
				}
			}
			if (hasnonnull) {
				uvshead = crc32(Buffer.from(mesh.uvBuffer.buffer, mesh.uvBuffer.byteOffset, bufsize));
				uvsfull = crc32(Buffer.from(mesh.uvBuffer.buffer, mesh.uvBuffer.byteOffset, Math.min(maxfullvertices * 2 * 2, mesh.uvBuffer.byteLength)));
			}
		}
		if (mesh.normalBuffer && mesh.normalBuffer.length >= normalssize) {
			normalshead = crc32(Buffer.from(mesh.normalBuffer.buffer, mesh.normalBuffer.byteOffset, normalssize));
			normalsfull = crc32(Buffer.from(mesh.normalBuffer.buffer, mesh.normalBuffer.byteOffset, Math.min(maxfullvertices * 3, mesh.normalBuffer.byteLength)));
		}
		if (mesh.positionBuffer && mesh.positionBuffer.length >= possize) {
			poshead = crc32(Buffer.from(mesh.positionBuffer.buffer, mesh.positionBuffer.byteOffset, possize));
			posfull = crc32(Buffer.from(mesh.positionBuffer.buffer, mesh.positionBuffer.byteOffset, Math.min(maxfullvertices * 3 * 2, mesh.positionBuffer.byteLength)));
		}
		let indexedposcrcs: { id: number, head: number, full: number, count: number }[] = [];
		if (mesh.positionBuffer) {
			for (let indices of mesh.indexBuffers) {
				let primcount = indices.length / 3 | 0;
				if (primcount >= matchvertices) {
					let crc = new CrcBuilder();
					let head = 0;
					for (let i = 0; i < primcount; i++) {
						for (let j = 0; j < 3; j++) {
							let index = indices[i * 3 + j];
							crc.addUint16(mesh.positionBuffer[index * 3 + 0]);
							crc.addUint16(mesh.positionBuffer[index * 3 + 1]);
							crc.addUint16(mesh.positionBuffer[index * 3 + 2]);
						}
						if (i == matchvertices - 1) {
							head = crc.get();
						}
					}
					indexedposcrcs.push({
						id,
						head,
						full: crc.get(),
						count: primcount
					});
				}
			}
		}
		if (uvshead || poshead || normalshead || indexedposcrcs.length != 0) {
			meshhashes.push({
				id,
				sub,
				uvshead, uvsfull,
				normalshead, normalsfull,
				poshead, posfull,
				verts: mesh.vertexCount!,
				indexpos: indexedposcrcs
			});
		}
	}
}