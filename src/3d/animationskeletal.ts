import { cacheMajors } from "../constants";
import { CacheFileSource, SubFile } from "../cache";
import { parse } from "../opdecoder";
import { AnimationClip, Bone, BufferGeometry, CubicBezierCurve, CubicBezierCurve3, CubicInterpolant, Euler, InterpolateSmooth, InterpolationModes, KeyframeTrack, Matrix3, Matrix4, Object3D, Quaternion, QuaternionKeyframeTrack, Skeleton, SkeletonHelper, SkinnedMesh, Vector3, VectorKeyframeTrack } from "three";
import { skeletalanim } from "../../generated/skeletalanim";
import { framemaps } from "../../generated/framemaps";
import { ThreejsSceneCache } from "./modeltothree";
import { sequences } from "../../generated/sequences";
import { frames } from "../../generated/frames";
import { MountableAnimation } from "./animationframes";


//new anims
//115416  obelisk
//114652  pof totem
//117253  dramatic doors
//115602  stormguard citadel ring, should only have one bone


//npc new anims
//27111   butterfly
//28895   elder egg, currently bugged
//28625   cerberus bones not moving at all
//28485   broken zez achievement pet

function sampleAnimBezier(track: skeletalanim["tracks"][number]["chunks"], t: number) {
	for (let i = 0; i < track.length - 1; i++) {
		let sample = track[i];
		let next = track[i + 1];
		if (sample.time <= t && next.time >= t) {
			let x0 = sample.value[0];
			let x3 = next.value[0];
			let t0 = sample.time;
			let t3 = next.time;
			let x1 = x0 + sample.value[2];
			let t1 = t0 + sample.value[1];
			let x2 = x3 - sample.value[4];
			let t2 = t3 - sample.value[3];

			let a = sampleInverseBezierSection(t0, t1, t2, t3, t);
			let r = sampleBezier(x0, x1, x2, x3, a);
			return r;
		}
	}
	throw new Error("out of track bounds");
}

function debugBezierCurve(x0: number, x1: number, x2: number, x3: number, x: number) {
	let a = 3 * x1 - x0 - 3 * x2 + x3;
	let b = 3 * x0 - 6 * x1 + 3 * x2;
	let c = 3 * x1 - 3 * x0;
	let d = x0;

	let cnv = document.createElement("canvas");
	let ctx = cnv.getContext("2d")!;
	cnv.width = 200;
	cnv.height = 100;
	ctx.strokeStyle = "red";
	ctx.lineWidth = 2;
	ctx.moveTo(0, 0);
	let best = 100;
	let bestt = 0;
	let pxtoy = v => ((1 - (v - x0) / (x3 - x0)) * 0.5 + 0.25) * cnv.height;
	let pxtox = t => (t * 0.5 + 0.25) * cnv.width;
	for (let t = -1; t < 2; t += 0.001) {
		let v = a * t * t * t + b * t * t + c * t + d;
		ctx.lineTo(pxtox(t), pxtoy(v));
		let dif = Math.abs(v - x);
		if (dif < best) {
			best = d;
			bestt = t;
		}
	}
	console.log("best", +bestt.toFixed(3));
	ctx.stroke();
	ctx.lineWidth = 1;
	ctx.moveTo(pxtox(0), pxtoy(x));
	ctx.lineTo(pxtox(1), pxtoy(x));
	ctx.stroke();
	ctx.moveTo(pxtox(0), pxtoy(x0));
	ctx.lineTo(pxtox(0), pxtoy(x3));
	ctx.lineTo(pxtox(1), pxtoy(x3));
	ctx.lineTo(pxtox(1), pxtoy(x0));
	ctx.lineTo(pxtox(0), pxtoy(x0));
	ctx.stroke();
	document.body.append(cnv);
	cnv.style.cssText = "position:absolute; top:0px; left:0px; border:1px solid red; background:white;";
}

function sampleBezier(x0: number, x1: number, x2: number, x3: number, t: number) {
	let a = 3 * x1 - x0 - 3 * x2 + x3;
	let b = 3 * x0 - 6 * x1 + 3 * x2;
	let c = 3 * x1 - 3 * x0;
	let d = x0;
	return t * t * t * a + t * t * b + t * c + d;
}

function sampleInverseBezierSection(x0: number, x1: number, x2: number, x3: number, x: number) {
	let eps = 0.00001;
	//convert bezier to polynomial
	let a = 3 * x1 - x0 - 3 * x2 + x3;
	let b = 3 * x0 - 6 * x1 + 3 * x2;
	let c = 3 * x1 - 3 * x0;
	let d = x0 - x;

	//cubic solutions can't handle a=0
	if (Math.abs(a) < eps) {
		//abc formula, but with bcd so bit confusing
		let det = c * c - 4 * b * d;
		if (det < 0) { throw new Error("no solution for quadratic interpolation"); }
		//alternative form that behaves nicely in the linear case (b=0)
		let sol0 = 2 * d / (-c - Math.sqrt(det));
		let sol1 = 2 * d / (-c + Math.sqrt(det));
		let sol0valid = sol0 >= -eps && sol0 <= 1 + eps;
		let sol1valid = sol1 >= -eps && sol1 <= 1 + eps;
		if (sol0valid && sol1valid) {
			//bad anim, multiple solutions...
		}
		if (!sol0valid && !sol1valid) { throw new Error("no valid solutions for quadratic interpolation"); }
		return sol0valid ? sol0 : sol1;
	}

	//cubic equation solution based on https://math.vanderbilt.edu/schectex/courses/cubic/
	let p = -b / (3 * a);
	let q = p * p * p + (b * c - 3 * a * d) / (6 * a * a);
	let r = c / (3 * a);

	let dd = q * q + Math.pow(r - p * p, 3);

	let ddrootreal = (dd >= 0 ? Math.sqrt(dd) : 0);
	let ddrootimag = (dd >= 0 ? 0 : Math.sqrt(-dd));

	let posreal = q + ddrootreal;
	let posimag = ddrootimag;
	let negreal = q - ddrootreal;
	let negimag = -ddrootimag;

	let magpos = Math.hypot(posreal, posimag);
	let anglepos = Math.atan2(posimag, posreal);
	let magneg = Math.hypot(negreal, negimag);
	let angleneg = Math.atan2(negimag, negreal);

	let magpos2 = Math.pow(magpos, 1 / 3);
	let anglepos2 = anglepos / 3;
	let magneg2 = Math.pow(magneg, 1 / 3);
	let angleneg2 = angleneg / 3;
	let solution = 0;
	let solutioncount = 0;
	// let solstr = "";
	//iterate through all possible cube roots and find a real solution
	for (let k of [0, 1, 2]) {
		for (let j of [0, 1, 2]) {
			let solimag = magpos2 * Math.sin(anglepos2 + k * Math.PI / 3 * 2) + magneg2 * Math.sin(angleneg2 + j * Math.PI / 3 * 2);
			let solreal = magpos2 * Math.cos(anglepos2 + k * Math.PI / 3 * 2) + magneg2 * Math.cos(angleneg2 + j * Math.PI / 3 * 2) + p;
			// solstr += `${solreal.toFixed(3)} ${solimag >= 0 ? "+" : "-"} ${Math.abs(solimag).toFixed(3)}i\n`;
			if (Math.abs(solimag) < eps && solreal >= -eps && solreal <= 1 + eps) {
				let newsolution = magpos2 * Math.cos(anglepos2 + k * Math.PI / 3 * 2) + magneg2 * Math.cos(angleneg2 + j * Math.PI / 3 * 2) + p;
				if (solutioncount != 0 && Math.abs(newsolution - solution) > eps) {
					//bad anim, multiple solutions...
				}
				solution = newsolution;
				solutioncount++;
			}
		}
	}
	// console.log(solstr);
	if (solutioncount == 0) {
		throw new Error("no solution found");
	}
	return solution;
}

export async function mountSkeletalSkeleton(rootnode: Object3D, cache: ThreejsSceneCache, framebaseid: number) {
	let base = parse.framemaps.read(await cache.engine.getFileById(cacheMajors.framemaps, framebaseid), cache.engine.rawsource);
	if (!base.skeleton) {
		throw new Error("framebase does not have skeleton");
	}

	let bones: Bone[] = [];
	// let binds: Matrix4[] = [];
	let rootbones: Bone[] = [];
	let tmp = new Matrix4();
	let prematrix = new Matrix4().makeScale(1, 1, -1);
	for (let [id, entry] of base.skeleton.entries()) {
		let bone = new Bone();
		let matrix = new Matrix4().fromArray(entry.bonematrix);

		bone.name = "bone_" + id;
		if (entry.nonskinboneid == 65535) {
			rootbones.push(bone);
			matrix.multiply(prematrix);
		} else {
			bones[entry.nonskinboneid].add(bone);
		}

		tmp.copy(matrix).decompose(bone.position, bone.quaternion, bone.scale);
		// console.log(id,
		// 	"TRS", +bone.position.x.toFixed(2), +bone.position.y.toFixed(2), +bone.position.z.toFixed(2),
		// 	"", +bone.quaternion.x.toFixed(2), +bone.quaternion.y.toFixed(2), +bone.quaternion.z.toFixed(2), +bone.quaternion.w.toFixed(2),
		// 	"", +bone.scale.x.toFixed(2), +bone.scale.y.toFixed(2), +bone.scale.z.toFixed(2));
		bone.updateMatrixWorld();
		bones[id] = bone;
		// binds[id] = matrix;
	}
	// prematrix.invert();
	// binds.forEach(q => q.multiply(prematrix));

	let skeleton = new Skeleton(bones);

	if (rootbones.length != 0) { rootnode.add(...rootbones); }
	rootnode.updateMatrixWorld(true);
	let childbind = new Matrix4().copy(rootnode.matrixWorld);
	//TODO find out whats wrong with my own inverses
	skeleton.calculateInverses();
	rootnode.traverse(node => {
		if (node instanceof SkinnedMesh) {
			node.bind(skeleton, childbind);
			let geo = node.geometry as BufferGeometry;
			geo.attributes.skinIndex = geo.attributes.RA_skinIndex_skin;
			geo.attributes.skinWeight = geo.attributes.RA_skinWeight_skin;
		}
	});
}

function debugkeyframes(data: number[], times: number[], axis: number) {
	let duration = times.at(-1)!;
	let max = Math.max.apply(null, data);
	let min = 0;

	let cnv = document.createElement("canvas");
	let ctx = cnv.getContext("2d")!;
	cnv.width = 200;
	cnv.height = 100;
	ctx.strokeStyle = "red";
	ctx.lineWidth = 2;
	let pxtoy = v => ((1 - (v - min) / (max - min)) * 0.8 + 0.1) * cnv.height;
	let pxtox = t => (t / duration) * cnv.width;
	for (let i = 0; i < times.length; i++) {
		let t = times[i];
		let v = data[i * 3 + axis];
		ctx.lineTo(pxtox(t), pxtoy(v));
	}
	ctx.stroke();
	ctx.lineWidth = 1;
	ctx.moveTo(pxtox(0), pxtoy(min));
	ctx.lineTo(pxtox(0), pxtoy(max));
	ctx.lineTo(pxtox(duration), pxtoy(max));
	ctx.lineTo(pxtox(duration), pxtoy(min));
	ctx.lineTo(pxtox(0), pxtoy(min));
	ctx.stroke();
	document.body.append(cnv);
	cnv.style.cssText = "position:absolute; top:0px; left:0px; border:1px solid red; background:white;";
}

export async function parseSkeletalAnimation(cache: ThreejsSceneCache, animid: number) {
	let anim = parse.skeletalAnim.read(await cache.engine.getFileById(cacheMajors.skeletalAnims, animid), cache.engine.rawsource);

	let convertedtracks: KeyframeTrack[] = [];

	//make sure that tracks that should be combined into vectors are adjacent for later
	let animtracks = anim.tracks.sort((a, b) => {
		if (a.boneid != b.boneid) { return a.boneid - b.boneid; }
		return a.type_0to9 - b.type_0to9;
	});

	let actiontypemap: { t: "unknown" | "rotate" | "translate" | "scale", a: number }[] = [
		{ t: "unknown", a: 0 },

		//1-9
		{ t: "rotate", a: 0 },
		{ t: "rotate", a: 1 },
		{ t: "rotate", a: 2 },
		{ t: "translate", a: 0 },
		{ t: "translate", a: 1 },
		{ t: "translate", a: 2 },
		{ t: "scale", a: 0 },
		{ t: "scale", a: 1 },
		{ t: "scale", a: 2 },

		//10-16 unknown
		{ t: "unknown", a: 0 },//109 hits, -1 3x, 0 103x, 1 3x
		{ t: "unknown", a: 0 },//109 hits, -1 6x, 0 103x
		{ t: "unknown", a: 0 },//109 hits, -1 4x, 0 94x, 1 15x
		{ t: "unknown", a: 0 },//4k hits, 0x 3400, 42 600x
		{ t: "unknown", a: 0 },//4k hits, sort of spread between 0-0.015, most at bounderies
		{ t: "unknown", a: 0 },//4k hits, spread between -0.3-0.1, most at bounderies
		{ t: "unknown", a: 0 },//2k hits, spread between -1-1, most at bounderies or 0
	]

	for (let index = 0; index < animtracks.length;) {
		let track = animtracks[index];

		let xvalues: skeletalanim["tracks"][number]["chunks"] | null = null;
		let yvalues: skeletalanim["tracks"][number]["chunks"] | null = null;
		let zvalues: skeletalanim["tracks"][number]["chunks"] | null = null;

		let tracktype = actiontypemap[track.type_0to9];
		//no clue what these offsets are about
		//(related to variable size encoding of the integers)
		let boneid = (track.boneid < 16000 ? track.boneid - 64 : track.boneid - 16384);

		while (index < animtracks.length) {
			let track2 = animtracks[index];
			let t2 = actiontypemap[track2.type_0to9];
			if (track2.boneid != track.boneid || t2.t != tracktype.t) { break; }
			if (t2.a == 0) { xvalues = track2.chunks; }
			if (t2.a == 1) { yvalues = track2.chunks; }
			if (t2.a == 2) { zvalues = track2.chunks; }
			index++;
		}
		// if (track.bonetype_01or3 == 3) { continue; }
		// if (boneid >= 6 && boneid <= 8) { continue; }
		let bonename = "bone_" + boneid;

		let defaultvalue = (tracktype.t == "scale" ? 1 : 0);
		// let intp = (v: { time: number, value: number[] }[] | null, i: number, t: number) => {
		// 	let v1 = v?.[i]?.value[0] ?? defaultvalue;
		// 	let v2 = v?.[i + 1]?.value[0] ?? defaultvalue;
		// 	let t1 = v?.[i]?.time ?? 0;
		// 	let t2 = v?.[i + 1]?.time ?? t1;
		// 	let a = (t1 == t2 ? 0 : (t - t1) / (t2 - t1));
		// 	return v1 * (1 - a) + v2 * a;
		// }
		let timearray: number[] = [];
		let data: number[] = [];
		let euler = new Euler();
		let quat = new Quaternion();
		// if (tracktype.t == "scale") {
		// 	console.log(xvalues, yvalues, zvalues);
		// }
		// let time = new Float32Array(timearray.map(q => q * 0.020));
		// for (let ix = 0, iy = 0, iz = 0, idata = 0; ;) {
		// 	let tx = xvalues?.[ix]?.time ?? Infinity;
		// 	let ty = yvalues?.[iy]?.time ?? Infinity;
		// 	let tz = zvalues?.[iz]?.time ?? Infinity;

		// 	let t = Math.min(tx, ty, tz);
		// 	if (!isFinite(t)) { break; }

		// 	data[idata++] = intp(xvalues, ix, t);
		// 	data[idata++] = intp(yvalues, iy, t);
		// 	data[idata++] = intp(zvalues, iz, t);
		// 	timearray.push(t);
		// 	if (tx == t) { ix++; }
		// 	if (ty == t) { iy++; }
		// 	if (tz == t) { iz++; }
		// }

		let endtime = xvalues?.at(-1)?.time ?? yvalues?.at(-1)?.time ?? zvalues?.at(-1)?.time ?? 0;
		let idata = 0;
		for (let t = 0; t < endtime; t += 5) {
			data[idata++] = (xvalues ? sampleAnimBezier(xvalues, t) : defaultvalue);
			data[idata++] = (yvalues ? sampleAnimBezier(yvalues, t) : defaultvalue);
			data[idata++] = (zvalues ? sampleAnimBezier(zvalues, t) : defaultvalue);
			timearray.push(t);
		}

		let times = new Float32Array(timearray.map(q => q * 0.020));
		if (tracktype.t == "translate") {
			convertedtracks.push(new VectorKeyframeTrack(`${bonename}.position`, times as any, data));
		}
		if (tracktype.t == "scale") {
			//flip the root bone in z direction
			if (boneid == 0) {
				for (let i = 0; i < data.length; i += 3) { data[i + 2] *= -1; }
			}
			convertedtracks.push(new VectorKeyframeTrack(`${bonename}.scale`, times as any, data));
		}
		if (tracktype.t == "rotate") {
			let quatdata = new Float32Array(timearray.length * 4);
			for (let i = 0; i * 3 < data.length; i++) {
				euler.set(data[i * 3 + 0], data[i * 3 + 1], data[i * 3 + 2], "YXZ");
				quat.setFromEuler(euler);
				quat.toArray(quatdata, i * 4);
			}
			convertedtracks.push(new QuaternionKeyframeTrack(`${bonename}.quaternion`, times as any, quatdata as any));
		}
	}

	let clip = new AnimationClip("anim_" + (Math.random() * 1000 | 0), undefined, convertedtracks);

	return { clip, framebaseid: anim.framebase };
}
