import { Stream, packedHSL2HSL, HSL2RGB } from "./utils";
import { cacheMajors } from "../constants";
import { CacheFileSource, SubFile } from "../cache";
import { parseFrames, parseFramemaps, parseSequences, parseSkeletalAnim } from "../opdecoder";
import { AnimationClip, Bone, Euler, KeyframeTrack, Matrix3, Matrix4, Object3D, Quaternion, QuaternionKeyframeTrack, Skeleton, Vector3, VectorKeyframeTrack } from "three";
import { skeletalanim } from "../../generated/skeletalanim";
import { framemaps } from "../../generated/framemaps";
import { ThreejsSceneCache } from "./ob3tothree";
import { sequences } from "../../generated/sequences";
import { frames } from "../../generated/frames";
import { MountableAnimation } from "./animationframes";


//new anims
//115416  obelisk
//114652  pof totem
//117253  dramatic doors

//npc new anims
//27111   butterfly


export async function parseSkeletalAnimation(cache: ThreejsSceneCache, animid: number): Promise<MountableAnimation> {
	let anim = parseSkeletalAnim.read(await cache.getFileById(cacheMajors.skeletalAnims, animid));
	let base = parseFramemaps.read(await cache.getFileById(cacheMajors.framemaps, anim.framebase));
	if (!base.skeleton) {
		throw new Error("framebase does not have skeleton");
	}

	let convertedtracks: KeyframeTrack[] = [];

	let animtracks = anim.tracks.sort((a, b) => {
		if (a.boneid != b.boneid) { return a.boneid - b.boneid; }
		return a.type_0to9 - b.type_0to9;
	});

	let bones: Bone[] = [];
	let binds: Matrix4[] = [];
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
		binds[id] = matrix;
	}
	prematrix.invert();
	binds.forEach(q => q.multiply(prematrix));
	let skeleton = new Skeleton(bones);

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
		{ t: "unknown", a: 0 },
		{ t: "unknown", a: 0 },
		{ t: "unknown", a: 0 },
		{ t: "unknown", a: 0 },
		{ t: "unknown", a: 0 },
		{ t: "unknown", a: 0 },
		{ t: "unknown", a: 0 },
	]


	for (let index = 0; index < animtracks.length;) {
		let track = animtracks[index];

		let xvalues: skeletalanim["tracks"][number]["chunks"] | null = null;
		let yvalues: skeletalanim["tracks"][number]["chunks"] | null = null;
		let zvalues: skeletalanim["tracks"][number]["chunks"] | null = null;

		let tracktype = actiontypemap[track.type_0to9];
		//no clue what these offsets are about
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

		let bone = bones[boneid];
		if (!bone) {
			console.log("animation track without bone", boneid, track.boneid);
			continue;
		}
		let bonename = bone.name;

		let defaultvalue = (tracktype.t == "scale" ? 1 : 9);
		let intp = (v: { time: number, value: number[] }[] | null, i: number, t: number) => {
			let v1 = v?.[i]?.value[0] ?? defaultvalue;
			let v2 = v?.[i + 1]?.value[0] ?? defaultvalue;
			let t1 = v?.[i]?.time ?? 0;
			let t2 = v?.[i + 1]?.time ?? t1;
			let a = (t1 == t2 ? 0 : (t - t1) / (t2 - t1));
			return v1 * (1 - a) + v2 * a;
		}
		let timearray: number[] = [];
		let data: number[] = [];
		let euler = new Euler();
		let quat = new Quaternion();
		// let time = new Float32Array(timearray.map(q => q * 0.020));
		for (let ix = 0, iy = 0, iz = 0, idata = 0; ;) {
			let tx = xvalues?.[ix]?.time ?? Infinity;
			let ty = yvalues?.[iy]?.time ?? Infinity;
			let tz = zvalues?.[iz]?.time ?? Infinity;

			let t = Math.min(tx, ty, tz);
			if (!isFinite(t)) { break; }

			data[idata++] = intp(xvalues, ix, t);
			data[idata++] = intp(yvalues, iy, t);
			data[idata++] = intp(zvalues, iz, t);

			timearray.push(t);
			if (tx == t) { ix++; }
			if (ty == t) { iy++; }
			if (tz == t) { iz++; }
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
	//TODO remove
	// convertedtracks = [];
	let clip = new AnimationClip("anim_" + (Math.random() * 1000 | 0), undefined, convertedtracks);


	return { skeleton, clip, rootbones };
}
