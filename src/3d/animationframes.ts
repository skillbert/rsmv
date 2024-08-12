import { Stream } from "../utils";
import { cacheMajors } from "../constants";
import { parse } from "../opdecoder";
import { AnimationClip, AnimationMixer, Bone, BufferGeometry, Euler, KeyframeTrack, Matrix3, Matrix4, Object3D, Quaternion, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Vector3, VectorKeyframeTrack } from "three";
import { framemaps } from "../../generated/framemaps";
import { ThreejsSceneCache } from "./modeltothree";
import { sequences } from "../../generated/sequences";
import { frames } from "../../generated/frames";
import { BoneCenter, getBoneCenters, ModelData } from "./rt7model";

//test    anim ids
//3577    falling plank
//3567    sawblade
//4013    agi pendulum
//907     wind chimes turning
//28351   pet shop sign
//13655   large orrery
//9101    conveyer belt
//470     ivy shaking
//860     waving flag
//3484    dg door
//114132  weird bugged balloon
//43      fishing spot
//3680    flag

//npc 3324  broken pest drone

//weird animation set 3051 (human skeleton)
//22564,22565,22566,22567,22568 human checking out clothes


export type MountableAnimation = {
	skeleton: Skeleton,
	clip: AnimationClip,
	rootbones: Bone[]
};


export function mountBakedSkeleton(rootnode: Object3D, model: ModelData) {
	let centers = getBoneCenters(model);
	let rootbone = new Bone();
	rootnode.add(rootbone);
	let leafbones: Bone[] = [rootbone];
	let rootbones: Bone[] = [];
	let inverses: Matrix4[] = [new Matrix4()];

	for (let i = 1; i < model.bonecount; i++) {
		let rootbone = new Bone();
		let leafbone = new Bone();
		rootbone.name = `root_${i}`;
		leafbone.name = `bone_${i}`;
		rootbone.add(leafbone);
		rootbones.push(rootbone);
		leafbones.push(leafbone);
		let inverse = new Matrix4();

		let center = centers[i];
		if (center && center.weightsum != 0) {
			rootbone.position.set(center.xsum / center.weightsum, center.ysum / center.weightsum, center.zsum / center.weightsum);
			inverse.setPosition(rootbone.position);
		}
		inverse.invert();
		inverses.push(inverse);
	}
	let skeleton = new Skeleton(leafbones, inverses);
	if (rootbones.length != 0) { rootbone.add(...rootbones); }
	rootbone.updateMatrixWorld(true);
	let childbind = new Matrix4().copy(rootbone.matrixWorld);
	//TODO find out whats wrong with my own inverses
	skeleton.calculateInverses();
	rootnode.traverse(node => {
		if (node instanceof SkinnedMesh) {
			node.bind(skeleton, childbind);
			let geo = node.geometry as BufferGeometry;
			geo.attributes.skinIndex = geo.attributes.RA_skinIndex_bone;
			geo.attributes.skinWeight = geo.attributes.RA_skinWeight_bone;
		}
	});

	let mixer = new AnimationMixer(rootnode);
	return { mixer };
}

export async function parseAnimationSequence4(loader: ThreejsSceneCache, sequenceframes: NonNullable<sequences["frames"]>): Promise<(model: ModelData) => AnimationClip> {

	let secframe0 = sequenceframes[0];
	if (!secframe0) {
		throw new Error("animation has no frames");
	}

	let framearch = await loader.engine.getArchiveById(cacheMajors.frames, secframe0.frameidhi);

	//some animations seem to use index instead of id, this seems to fix anim on npc 182
	// let frames = Object.fromEntries(framearch.map((q, i) => [i + 1, parse.frames.read(q.buffer, loader.engine.rawsource)]));
	let frames = Object.fromEntries(framearch.map((q, i) => [q.fileid, parse.frames.read(q.buffer, loader.engine.rawsource)]));

	//three.js doesn't interpolate from end frame to start, so insert the start frame at the end
	const insertLoopFrame = true;

	//calculate frame times
	let endtime = 0;
	let keyframetimeslist: number[] = [];
	let orderedframes: frames[] = [];
	for (let i = 0; i < sequenceframes.length; i++) {
		let seqframe = sequenceframes[i];
		if (frames[seqframe.frameidlow]) {
			keyframetimeslist.push(endtime);
			endtime += seqframe.framelength * 0.020;
			orderedframes.push(frames[seqframe.frameidlow]);
		} else {
			console.log(`missing animation frame ${seqframe.frameidlow} in sequence ${seqframe.frameidhi}`)
		}
	}

	if (insertLoopFrame) {
		orderedframes.push(orderedframes[0]);
		keyframetimeslist.push(endtime);
	}
	let framebase = parse.framemaps.read(await loader.engine.getFileById(cacheMajors.framemaps, orderedframes[0].probably_framemap_id), loader.engine.rawsource);

	// let { bones } = buildFramebaseSkeleton(framebase);
	let keyframetimes = new Float32Array(keyframetimeslist);
	let clips = getFrameClips(framebase, orderedframes);

	return (model: ModelData) => {
		let centers = getBoneCenters(model);
		let transforms = bakeAnimation(framebase, clips, keyframetimes, centers)
			.map((arr, i) => ({ id: i, trans: arr }));

		let nframes = keyframetimes.length;
		let tracks: KeyframeTrack[] = [];

		//reused holders
		let matrix = new Matrix4();
		let scale = new Vector3();
		let translate = new Vector3();
		let prerotate = new Quaternion();
		let postrotate = new Quaternion();
		let skippedbones = 0;
		for (let trans of transforms) {
			if (trans.id == 0) {
				//don't emit keyframetrack for static root bone, since it is a noop and
				//bone name doesn't match (doing this messes with export)
				continue;
			}
			if (trans.id >= model.bonecount) {
				skippedbones++;
				continue;
			}
			let rootname = `root_${trans.id}`;
			let leafname = `bone_${trans.id}`;
			let scales = new Float32Array(nframes * 3);
			let positions = new Float32Array(nframes * 3);
			let prerotates = new Float32Array(nframes * 4);
			let postrotates = new Float32Array(nframes * 4);
			for (let i = 0; i < nframes; i++) {
				matrix.fromArray(trans.trans, i * 16);
				matrixToDoubleBone(matrix, translate, prerotate, scale, postrotate);
				translate.toArray(positions, i * 3);
				prerotate.toArray(prerotates, i * 4);
				scale.toArray(scales, i * 3);
				postrotate.toArray(postrotates, i * 4);
			}
			tracks.push(new VectorKeyframeTrack(`${rootname}.position`, keyframetimes as any, positions as any));
			tracks.push(new QuaternionKeyframeTrack(`${rootname}.quaternion`, keyframetimes as any, prerotates as any));
			tracks.push(new VectorKeyframeTrack(`${rootname}.scale`, keyframetimes as any, scales as any));
			tracks.push(new QuaternionKeyframeTrack(`${leafname}.quaternion`, keyframetimes as any, postrotates as any));
		}
		if (skippedbones != 0) {
			console.log("skipped " + skippedbones + " bone animations since the model didn't have them");
		}
		let clip = new AnimationClip("anim", undefined, tracks);
		return clip;
	}
}

function matrixToDoubleBone(matrix: Matrix4, translate: Vector3, rotate1: Quaternion, scale: Vector3, rotate2: Quaternion) {
	matrix.decompose(translate, rotate1, scale);
	rotate2.identity();


	// this would have resulted in perfect reconstruction, however SVD is not stable when animated

	// let mat2 = [
	// 	matrix.elements.slice(0, 3),
	// 	matrix.elements.slice(4, 7),
	// 	matrix.elements.slice(8, 11),
	// ]
	// translate.set(matrix.elements[12], matrix.elements[13], matrix.elements[14]);
	// let { q, u, v } = SVD(mat2);

	// let pre = new Matrix4();
	// let post = new Matrix4();
	// pre.set(
	// 	u[0][0], u[0][1], u[0][2], 0,
	// 	u[1][0], u[1][1], u[1][2], 0,
	// 	u[2][0], u[2][1], u[2][2], 0,
	// 	0, 0, 0, 1
	// );
	// post.set(
	// 	v[0][0], v[0][1], v[0][2], 0,
	// 	v[1][0], v[1][1], v[1][2], 0,
	// 	v[2][0], v[2][1], v[2][2], 0,
	// 	0, 0, 0, 1
	// ).transpose();
	// let predet = pre.determinant();
	// let postdet = post.determinant();
	// if (Math.sign(predet) != Math.sign(postdet)) {
	// 	q[0] = -q[0];//flip one of the scales if only one of our rotates has a flip
	// }
	// if (predet < 0) {
	// 	pre.elements[0] *= -1;
	// 	pre.elements[4] *= -1;
	// 	pre.elements[8] *= -1;
	// 	pre.elements[12] *= -1;
	// }
	// if (postdet < 0) {
	// 	post.elements[0] *= -1;
	// 	post.elements[1] *= -1;
	// 	post.elements[2] *= -1;
	// 	post.elements[3] *= -1;
	// }
	// rotate1.setFromRotationMatrix(pre);
	// rotate2.setFromRotationMatrix(post);
	// scale.set(q[0], q[1], q[2]);
}

function bakeAnimation(base: framemaps, clips: ReturnType<typeof getFrameClips>, frametimes: Float32Array, bonecenters: BoneCenter[]) {
	let nframes = frametimes.length;
	let matrix = new Matrix4();
	let transform = new Matrix4();
	let quat = new Quaternion();
	let pivotmatrixright = new Matrix4();
	let pivotmatrixleft = new Matrix4();

	let nbones = Math.max(...base.data.flatMap(q => q.data)) + 1 + 1;//len, so max+1, 1 extra for root bone
	let bonestates: Float32Array[] = [];
	for (let i = 0; i < nbones; i++) {
		let bonematrices = new Float32Array(16 * nframes);
		let center = bonecenters[i];
		let x = (!center || center.weightsum == 0 ? 0 : center.xsum / center.weightsum);
		let y = (!center || center.weightsum == 0 ? 0 : center.ysum / center.weightsum);
		let z = (!center || center.weightsum == 0 ? 0 : center.zsum / center.weightsum);
		for (let j = 0; j < nframes; j++) {
			bonematrices[j * 16 + 0] = 1;
			bonematrices[j * 16 + 5] = 1;
			bonematrices[j * 16 + 10] = 1;
			bonematrices[j * 16 + 15] = 1;
			bonematrices[j * 16 + 12] = x;
			bonematrices[j * 16 + 13] = y;
			bonematrices[j * 16 + 14] = z;
		}
		bonestates.push(bonematrices);
	}

	let pivot = new Vector3();
	for (let framenr = 0; framenr < nframes; framenr++) {
		pivot.set(0, 0, 0);
		let matrixoffset = framenr * 16;
		for (let [stepnr, step] of base.data.entries()) {
			let clip = clips[stepnr];
			if (step.type == 0) {
				pivot.fromArray(clip, framenr * 3);
				let sumx = 0, sumy = 0, sumz = 0;
				let weight = 0;
				for (let boneid of step.data) {
					let center = bonecenters[boneid + 1];
					let matrices = bonestates[boneid + 1];
					if (center) {
						sumx += matrices[matrixoffset + 12] * center.weightsum;
						sumy += matrices[matrixoffset + 13] * center.weightsum;
						sumz += matrices[matrixoffset + 14] * center.weightsum;
						weight += center.weightsum;
					}
				}
				if (weight != 0) {
					pivot.set(
						pivot.x + sumx / weight,
						pivot.y + sumy / weight,
						pivot.z + sumz / weight
					)
				}
				pivotmatrixright.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
				pivotmatrixleft.makeTranslation(pivot.x, pivot.y, pivot.z);
			}
			if (step.type == 1) {
				for (let boneid of step.data) {
					let bone = bonestates[boneid + 1];
					bone[matrixoffset + 12] += clip[framenr * 3 + 0];
					bone[matrixoffset + 13] += clip[framenr * 3 + 1];
					bone[matrixoffset + 14] += clip[framenr * 3 + 2];
				}
			}
			if (step.type == 2) {
				quat.fromArray(clip, framenr * 4);
				transform.makeRotationFromQuaternion(quat);
				transform.multiply(pivotmatrixright);
				transform.premultiply(pivotmatrixleft);

				for (let boneid of step.data) {
					let bone = bonestates[boneid + 1];
					matrix.fromArray(bone, matrixoffset);
					matrix.premultiply(transform);
					matrix.toArray(bone, matrixoffset);
				}
			}
			if (step.type == 3) {
				transform.makeScale(clip[framenr * 3 + 0], clip[framenr * 3 + 1], clip[framenr * 3 + 2]);
				transform.multiply(pivotmatrixright);
				transform.premultiply(pivotmatrixleft);
				for (let boneid of step.data) {
					let bone = bonestates[boneid + 1];
					matrix.fromArray(bone, matrixoffset);
					matrix.premultiply(transform);
					matrix.toArray(bone, matrixoffset);
				}
			}
		}
	}
	return bonestates;
}

export function getFrameClips(framebase: framemaps, framesparsed: frames[]) {
	let frames = framesparsed.map(framedata => {
		//for some reason when using live/openrs2 source this file has internal chunking into header/flags/animdata
		return {
			flags: framedata.flags,
			animdata: framedata.animdata,
			dataindex: 0,
			baseid: framedata.probably_framemap_id,
			stream: new Stream(Buffer.from(framedata.animdata))
		};
	});

	let clips: Float32Array[] = [];

	for (let [index, base] of framebase.data.entries()) {
		let nfields = [3, 3, 4, 3, 3, 4, 3, 3, 3, 3, 3][base.type];
		let rawclip = new Float32Array(nfields * frames.length);
		let clipindex = 0;
		let tempquat = new Quaternion();
		let tempEuler = new Euler();
		for (let frame of frames) {
			let flag = frame?.flags[index] ?? 0;
			if (flag & ~7) {
				console.log("unexpexted frame data flag " + (flag & ~7));
			}
			//there seems to actually be data here
			if (base.type == 0) {
				rawclip[clipindex++] = (flag & 1 ? frame.stream.readShortSmartBias() : 0);
				rawclip[clipindex++] = (flag & 2 ? frame.stream.readShortSmartBias() : 0);
				rawclip[clipindex++] = (flag & 4 ? frame.stream.readShortSmartBias() : 0);
				if (flag & 7) {
					console.log("type 0 data", flag, [...rawclip.slice(clipindex - 3, clipindex)]);
				}
			}
			//translate
			if (base.type == 1) {
				rawclip[clipindex++] = (flag & 1 ? frame.stream.readShortSmartBias() : 0);
				rawclip[clipindex++] = -(flag & 2 ? frame.stream.readShortSmartBias() : 0);
				rawclip[clipindex++] = (flag & 4 ? frame.stream.readShortSmartBias() : 0);
			}
			//rotate
			if (base.type == 2) {
				let rotx = 0;
				if (flag & 1) {
					let comp1 = frame.stream.readShortSmartBias();
					let comp2 = frame.stream.readShortSmartBias();
					rotx = Math.atan2(comp1, comp2);
					// console.log(rotx);
				}
				let roty = 0;
				if (flag & 2) {
					let comp1 = frame.stream.readShortSmartBias();
					let comp2 = frame.stream.readShortSmartBias();
					roty = Math.atan2(comp1, comp2);
					// console.log(rotx);
				}
				let rotz = 0;
				if (flag & 4) {
					let comp1 = frame.stream.readShortSmartBias();
					let comp2 = frame.stream.readShortSmartBias();
					rotz = Math.atan2(comp1, comp2);
					// console.log(rotx);
				}
				// let rotx = (flag & 1 ? Math.atan2(frame.stream.readShortSmartBias(),frame.stream.readShortSmartBias()) : 0);
				// let roty = (flag & 2 ? Math.atan2(frame.stream.readShortSmartBias(),frame.stream.readShortSmartBias()) : 0);
				// let rotz = (flag & 4 ? Math.atan2(frame.stream.readShortSmartBias(),frame.stream.readShortSmartBias()) : 0);
				tempEuler.set(rotx, roty, rotz, "YXZ");
				tempquat.setFromEuler(tempEuler);
				tempquat.toArray(rawclip, clipindex);
				clipindex += 4;
			}
			//scale?
			if (base.type == 3) {
				rawclip[clipindex++] = (flag & 1 ? frame.stream.readShortSmartBias() : 128) / 128;
				rawclip[clipindex++] = (flag & 2 ? frame.stream.readShortSmartBias() : 128) / 128;
				rawclip[clipindex++] = (flag & 4 ? frame.stream.readShortSmartBias() : 128) / 128;
			}
			//others todo
			if (base.type == 5) {
				rawclip[clipindex++] = (flag & 1 ? frame.stream.readUShortSmart() : 0);
				rawclip[clipindex++] = (flag & 2 ? frame.stream.readUShortSmart() : 0);
				rawclip[clipindex++] = (flag & 4 ? frame.stream.readUShortSmart() : 0);
			} else if (base.type >= 4) {
				rawclip[clipindex++] = (flag & 1 ? frame.stream.readUShortSmart() : 0);
				rawclip[clipindex++] = (flag & 2 ? frame.stream.readUShortSmart() : 0);
				rawclip[clipindex++] = (flag & 4 ? frame.stream.readUShortSmart() : 0);
			}
		}
		clips.push(rawclip);
	}

	frames.forEach((q, i) => {
		let bytes = q.stream.bytesLeft();
		if (bytes != 0) {
			console.warn("ints left in anim decode: " + bytes, i);
			let counts: Record<number, number> = {};
			framebase.data.map((fr, i) => {
				// if ([0, 1, 2, 3].indexOf(fr.type) == -1 && (q.flags[i] ?? 0) != 0) {
				// console.log(fr.type, q.flags[i]);
				counts[fr.type] = (counts[fr.type] ?? 0) + (q.flags[i] ?? 0).toString(2).replaceAll("0", "").length;
				// }
			});
			console.log(counts);
		}
	});

	return clips;
}
