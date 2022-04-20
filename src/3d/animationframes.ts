import { Stream, packedHSL2HSL, HSL2RGB } from "./utils";
import { cacheMajors } from "../constants";
import { CacheFileSource, SubFile } from "../cache";
import { parseFrames, parseFramemaps, parseSequences, parseSkeletalAnim } from "../opdecoder";
import { AnimationClip, AnimationMixer, Bone, Euler, KeyframeTrack, Matrix3, Matrix4, Object3D, Quaternion, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Vector3, VectorKeyframeTrack } from "three";
import { skeletalanim } from "../../generated/skeletalanim";
import { framemaps } from "../../generated/framemaps";
import { ThreejsSceneCache } from "./ob3tothree";
import { sequences } from "../../generated/sequences";
import { frames } from "../../generated/frames";
import { BoneCenter, getBoneCenters, ModelData } from "./ob3togltf";

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

//weird animation set 3051 (human skeleton)
//22564,22565,22566,22567,22568 human checking out clothes


type TransformBase = { type: string, inverse: boolean };
type TransformTranslateConst = TransformBase & { type: "translateconst", data: number[] }
type TransformTranslate = TransformBase & { type: "translate", data: number }
type TransformRotate = TransformBase & { type: "rotate", data: number }
type TransformScale = TransformBase & { type: "scale", data: number }
type TransformBaked = TransformBase & { type: "baked", data: Transform[][] }
type Transform = TransformTranslateConst | TransformTranslate | TransformRotate | TransformScale | TransformBaked;

export type MountableAnimation = {
	skeleton: Skeleton,
	clip: AnimationClip,
	rootbones: Bone[]
};

export type BoneInit = {
	bakedTransform: Transform[] | null,
	translateconst: TransformTranslateConst[],
	translate: TransformTranslate[],
	rotate: TransformRotate[],
	scale: TransformScale[],
	children: BoneInit[],
	boneid: number
}
export type ParsedAnimation = {
	rootboneinits: BoneInit[],
	keyframetimes: Float32Array,
	endtime: number
}

function isEqualTr(a: Transform, b: Transform) {
	return a.type == b.type && a.data == b.data && a.inverse == b.inverse;
}

function isInverseTr(a: Transform, b: Transform) {
	return a.type == b.type && a.data == b.data && a.inverse != b.inverse;
}

class TransformStack {
	boneids: number[];
	lastbaked: TransformBaked | null = null;
	stack: Transform[] = [];
	constructor(boneids: number[]) {
		this.addTransform({ type: "translateconst", data: boneids, inverse: false });
		this.boneids = boneids;
	}
	cleanStack() {
		while (this.stack.length >= 2 && isInverseTr(this.stack[this.stack.length - 1], this.stack[this.stack.length - 2])) {
			this.stack.splice(this.stack.length - 2, 2);
		}
	}
	addTransform(trans: Transform) {
		this.stack.push(trans);
		this.cleanStack();
		if (trans.type == "baked" && !this.lastbaked) {
			this.lastbaked = trans;
		}
	}
	addFromOther(other: Transform[]) {
		for (let i = 0; i < other.length; i++) {
			this.addTransform(other[i]);
		}
	}
	getInverse() {
		let cpy: Transform[] = [];
		for (let i = this.stack.length - 1; i >= 0; i--) {
			cpy.push({ ...this.stack[i], inverse: !this.stack[i].inverse })
		}
		return cpy;
	}
}

function findSharedPivot(bones: TransformStack[]) {
	let len = bones[0].stack.length;
	let passed = true;
	for (let bone of bones) {
		if (bone.stack[0].type != "translateconst") {
			console.log("stack doesn't start with translateconst");
			passed = false;
			break;
		}
		if (bone.stack.length != len) {
			console.log("different stack lengths");
			passed = false;
			break;
		}
	}
	//skip first bone since it's the slightly different translate
	if (passed) {
		outerloop: for (let i = 1; i < len; i++) {
			let tr0 = bones[0].stack[i];
			for (let boneindex = 1; boneindex < bones.length; boneindex++) {
				let tr1 = bones[boneindex].stack[i];
				if (!isEqualTr(tr0, tr1)) {
					console.log("non-equal transform stack")
					passed = false;
					break outerloop;
				}
			}
		}
	}
	if (passed) {
		let ret = new TransformStack(bones.flatMap(q => q.boneids));
		ret.addFromOther(bones[0].stack.slice(1));
		return ret;
	} else {
		let res = new TransformStack([]);
		res.addTransform({ type: "baked", data: bones.map(q => q.stack), inverse: false });
		return res;
	}
}



export async function parseAnimationSequence3(loader: ThreejsSceneCache, sequenceframes: NonNullable<sequences["frames"]>): Promise<(model: ModelData) => MountableAnimation> {

	let secframe0 = sequenceframes[0];
	if (!secframe0) {
		throw new Error("animation has no frames");
	}

	let framearch = await loader.getArchiveById(cacheMajors.frames, secframe0.frameidhi);

	let frames = Object.fromEntries(framearch.map(q => [q.fileid, parseFrames.read(q.buffer)]));

	let orderedframes: frames[] = [];
	for (let seqframe of sequenceframes) {
		if (frames[seqframe.frameidlow]) {
			orderedframes.push(frames[seqframe.frameidlow]);
		} else {
			console.log(`missing animation frame ${seqframe.frameidlow} in sequence ${seqframe.frameidhi}`)
		}
	}

	let framebase = parseFramemaps.read(await loader.getFileById(cacheMajors.framemaps, orderedframes[0].probably_framemap_id));

	let { actions, rootboneinits } = buildFramebaseSkeleton(framebase);
	let clips = getFrameClips(framebase, orderedframes);



	//calculate frame times
	let endtime = 0;
	let keyframetimes = new Float32Array(sequenceframes.length);
	for (let i = 0; i < sequenceframes.length; i++) {
		keyframetimes[i] = endtime;
		endtime += sequenceframes[i].framelength * 0.020;
	}

	return (model: ModelData) => {
		return mountAnimation(rootboneinits, clips, keyframetimes, getBoneCenters(model));
	}
}

export function mountBakedSkeleton(rootnode: Object3D, model: ModelData) {
	let centers = getBoneCenters(model);
	let leafbones: Bone[] = [rootnode as Bone];
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
	if (rootbones.length != 0) { rootnode.add(...rootbones); }
	rootnode.updateMatrixWorld(true);
	let childbind = new Matrix4().copy(rootnode.matrixWorld);
	//TODO find out whats wrong with my own inverses
	skeleton.calculateInverses();
	rootnode.traverse(node => {
		if (node instanceof SkinnedMesh) {
			node.bind(skeleton, childbind);
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

	let framearch = await loader.getArchiveById(cacheMajors.frames, secframe0.frameidhi);

	let frames = Object.fromEntries(framearch.map(q => [q.fileid, parseFrames.read(q.buffer)]));

	let orderedframes: frames[] = [];
	for (let seqframe of sequenceframes) {
		if (frames[seqframe.frameidlow]) {
			orderedframes.push(frames[seqframe.frameidlow]);
		} else {
			console.log(`missing animation frame ${seqframe.frameidlow} in sequence ${seqframe.frameidhi}`)
		}
	}

	let framebase = parseFramemaps.read(await loader.getFileById(cacheMajors.framemaps, orderedframes[0].probably_framemap_id));

	// let { bones } = buildFramebaseSkeleton(framebase);
	let clips = getFrameClips(framebase, orderedframes);

	//calculate frame times
	let endtime = 0;
	let keyframetimes = new Float32Array(sequenceframes.length);
	for (let i = 0; i < sequenceframes.length; i++) {
		keyframetimes[i] = endtime;
		endtime += sequenceframes[i].framelength * 0.020;
	}

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
		let clip = new AnimationClip("anim", undefined, tracks);;
		return clip;
	}
}

function matrixToDoubleBone(matrix: Matrix4, translate: Vector3, rotate1: Quaternion, scale: Vector3, rotate2: Quaternion) {
	matrix.decompose(translate, rotate1, scale);
	rotate2.identity();
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
function bakeTransformStack(stack: Transform[], clips: ReturnType<typeof getFrameClips>, frametimes: Float32Array, bonecenters: BoneCenter[]) {
	let nframes = frametimes.length;
	let matrix = new Matrix4();
	let transform = new Matrix4();
	let rotateinverse = new Matrix4();
	let rotate = new Matrix4();
	let quat = new Quaternion();

	//one identity matrix per frame
	let matrices = new Float32Array(nframes * 16);
	for (let i = 0; i < nframes; i++) {
		for (let j = 0; j < 16; j += 5) {
			matrices[i * 16 + j] = 1;
		}
	}
	for (let stacki = stack.length - 1; stacki >= 0; stacki--) {
		let action = stack[stacki];
		let bakeddata: Float32Array | null = null;
		if (action.type == "baked") {
			let stacks = action.data.map(q => bakeTransformStack(q, clips, frametimes, bonecenters));
			bakeddata = new Float32Array(nframes * 16);
			let stackweight = 1 / stacks.length
			for (let stack of stacks) {
				for (let j = 0; j < nframes * 16; j++) {
					bakeddata[j] += stack[j] * stackweight
				}
			}
		}
		for (let i = 0; i < nframes; i++) {
			matrix.fromArray(matrices, i * 16);
			if (action.type == "baked") {
				transform.fromArray(bakeddata!);
				if (action.inverse) { transform.invert(); }
				matrix.multiply(transform);
			}
			if (action.type == "translateconst") {
				let totalweight = 0;
				let xsum = 0, ysum = 0, zsum = 0;
				for (let boneid of action.data) {
					let center = bonecenters[boneid];
					if (!center) {
						continue;
					}
					let factor = (action.inverse ? -1 : 1);
					xsum += center.xsum * factor;
					ysum += center.ysum * factor;
					zsum += center.zsum * factor;
					totalweight += center.weightsum;
				}
				transform.makeTranslation(
					(totalweight == 0 ? 0 : xsum / totalweight),
					(totalweight == 0 ? 0 : ysum / totalweight),
					(totalweight == 0 ? 0 : zsum / totalweight),
				);
				matrix.multiply(transform);
			}
			if (action.type == "translate") {
				let clip = clips[action.data];
				let factor = (action.inverse ? -1 : 1);
				transform.makeTranslation(factor * clip[i * 3 + 0], factor * clip[i * 3 + 1], factor * clip[i * 3 + 2]);
				//translate is always in global frame so take current rotation/scale into account
				//have to actually invert instead of transpose becasue there can be shear
				rotateinverse.copy(matrix).setPosition(0, 0, 0).invert();
				transform.premultiply(rotateinverse);
				// matrix.multiply(transform);
			}
			if (action.type == "rotate") {
				let clip = clips[action.data];
				quat.fromArray(clip, i * 4);
				if (action.inverse) { quat.invert(); }
				transform.makeRotationFromQuaternion(quat);
				matrix.multiply(transform);
			}
			if (action.type == "scale") {
				let clip = clips[action.data];
				transform.makeScale(clip[i * 3 + 0], clip[i * 3 + 1], clip[i + 3 + 2]);
				if (action.inverse) { transform.invert(); }


				//scale always has it's direction in global frame, but its position around local
				//rotate the scale into local coords
				rotate.copy(matrix).setPosition(0, 0, 0)
				rotateinverse.copy(rotate).invert();
				transform.premultiply(rotateinverse).multiply(rotate);
				// matrix.multiply(transform);
			}
			matrix.toArray(matrices, i * 16);
		}
	}
	return matrices;
}

function mountAnimation(rootboneinits: BoneInit[], clips: ReturnType<typeof getFrameClips>, frametimes: Float32Array, bonecenters: BoneCenter[]): MountableAnimation {
	let nframes = frametimes.length;
	let keyframetracks: KeyframeTrack[] = [];
	let extrabonecounter = 0;
	let indexedbones: Bone[] = [];
	let missingpivots = 0;
	function iter(init: BoneInit, parentbonestates: Float32Array) {
		let bonestates = parentbonestates.slice();//TODO move responsibility for this copy up?

		let bone = new Bone();
		let translate = (init.translate.length != 0 ? new Float32Array(nframes * 3) : null);
		let rotate = (init.rotate.length != 0 ? new Float32Array(nframes * 4) : null);
		let scale = (init.scale.length != 0 ? new Float32Array(nframes * 3) : null);
		if (init.boneid != -1) {
			indexedbones[init.boneid] = bone;
			bone.name = "bone_" + init.boneid;
		} else {
			bone.name = "extra_" + (extrabonecounter++);
		}

		for (let tr of init.translateconst) {
			let totalweight = 0;
			let xsum = 0, ysum = 0, zsum = 0;
			for (let boneid of tr.data) {
				let center = bonecenters[boneid];
				if (!center) {
					continue;
				}
				let factor = (tr.inverse ? -1 : 1);
				xsum += center.xsum * factor;
				ysum += center.ysum * factor;
				zsum += center.zsum * factor;
				totalweight += center.weightsum;
			}
			if (totalweight != 0) {
				bone.position.set(
					bone.position.x + xsum / totalweight,
					bone.position.y + ysum / totalweight,
					bone.position.z + zsum / totalweight
				)
			} else {
				missingpivots++;
			}
			bone.updateMatrix();
		}

		let quatsum = new Quaternion();
		let quattmp = new Quaternion();
		let sum = new Vector3();
		let tmp = new Vector3();
		let matrixboneinv = new Matrix4();
		let matrixbone = new Matrix4();
		let matrixtmp = new Matrix4();

		for (let i = 0; i < nframes; i++) {
			matrixbone.fromArray(bonestates, i * 16);
			matrixbone.multiply(bone.matrix);
			if (init.translate.length != 0) {
				sum.set(0, 0, 0);
				//add all translations of this bone in the global frame
				for (let track of init.translate) {
					let clip = clips[track.data];
					tmp.fromArray(clip, i * 3);
					if (track.inverse) { sum.sub(tmp); }
					else { sum.add(tmp); }
				}
				matrixboneinv.copy(matrixbone).invert();//can't just transpose since it might have shear

				//do the translation in global reference frame as the client does
				//i could simplify this by hand...
				matrixtmp.makeTranslation(sum.x, sum.y, sum.z)
					.premultiply(matrixboneinv)
					.multiply(matrixbone);

				//matrixtmp should be a pure translate at this point (could simplify for perf)
				matrixbone.multiply(matrixtmp);

				//add the translations of the bone in bone frame
				sum.set(bone.position.x + matrixtmp.elements[12], bone.position.y + matrixtmp.elements[13], bone.position.z + matrixtmp.elements[14]);

				//save the baked translation
				sum.toArray(translate!, i * 3);

			}

			if (init.rotate.length != 0) {
				quatsum.identity();
				for (let track of init.rotate) {
					let clip = clips[track.data];
					quattmp.fromArray(clip, i * 4);
					if (track.inverse) { quattmp.invert(); }
					quatsum.multiply(quattmp);
				}
				quatsum.toArray(rotate!, i * 4);

				matrixtmp.makeRotationFromQuaternion(quatsum);
				matrixbone.multiply(matrixtmp);
			}

			if (init.scale.length != 0) {
				sum.set(1, 1, 1);
				for (let track of init.scale) {
					let clip = clips[track.data];
					tmp.fromArray(clip, i * 3);
					sum.multiply(tmp);
				}
				sum.toArray(scale!, i * 3);
				matrixbone.scale(sum);
			}

			matrixbone.toArray(bonestates, i * 16);
		}
		if (init.children.length != 0) {
			bone.add(...init.children.map(q => iter(q, bonestates)));
		}

		if (translate) { keyframetracks.push(new VectorKeyframeTrack(`${bone.name}.position`, frametimes as any, translate as any)); }
		if (rotate) { keyframetracks.push(new QuaternionKeyframeTrack(`${bone.name}.quaternion`, frametimes as any, rotate as any)); }
		if (scale) { keyframetracks.push(new VectorKeyframeTrack(`${bone.name}.scale`, frametimes as any, scale as any)); }

		return bone;
	}

	//bone worldmatrix for every frame
	let bonestates = new Float32Array(16 * nframes);
	for (let i = 0; i < nframes; i++) {
		for (let j = 0; j < 4; j++) { bonestates[i * 16 + 5 * j] = 1; }
	}
	let rootbones = rootboneinits.map(b => iter(b, bonestates));

	let skeleton = new Skeleton(indexedbones);
	globalThis.skeleton = skeleton;//TODO remove
	globalThis.rootbones = rootbones;

	let clip = new AnimationClip(`sequence_${Math.random() * 1000 | 0}`, undefined, keyframetracks);

	if (missingpivots != 0) {
		console.log("missing pivots during mountanimation", missingpivots);
	}

	return { skeleton, clip, rootbones };
}

export function getFrameClips(framebase: framemaps, framesparsed: frames[]) {
	let frames = framesparsed.map(framedata => {
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

			//there seems to actually be data here
			if (base.type == 0) {
				rawclip[clipindex++] = (flag & 1 ? readAnimFraction(frame?.stream) : 0);
				rawclip[clipindex++] = (flag & 2 ? readAnimFraction(frame?.stream) : 0);
				rawclip[clipindex++] = (flag & 4 ? readAnimFraction(frame?.stream) : 0);
				if (flag != 0) {
					console.log("type 0 data", flag, [...rawclip.slice(clipindex - 3, clipindex)]);
				}
			}
			//translate
			if (base.type == 1) {
				rawclip[clipindex++] = (flag & 1 ? readAnimFraction(frame?.stream) : 0);
				rawclip[clipindex++] = -(flag & 2 ? readAnimFraction(frame?.stream) : 0);
				rawclip[clipindex++] = (flag & 4 ? readAnimFraction(frame?.stream) : 0);
			}
			//rotate
			if (base.type == 2) {
				let rotx = 0;
				if (flag & 1) {
					let comp1 = readAnimFraction(frame.stream);
					let comp2 = readAnimFraction(frame.stream);
					rotx = Math.atan2(comp1, comp2);
					// console.log(rotx);
				}
				let roty = 0;
				if (flag & 2) {
					let comp1 = readAnimFraction(frame.stream);
					let comp2 = readAnimFraction(frame.stream);
					roty = Math.atan2(comp1, comp2);
					// console.log(rotx);
				}
				let rotz = 0;
				if (flag & 4) {
					let comp1 = readAnimFraction(frame.stream);
					let comp2 = readAnimFraction(frame.stream);
					rotz = Math.atan2(comp1, comp2);
					// console.log(rotx);
				}
				// let rotx = (flag & 1 ? Math.atan2(readAnimFraction(frame.stream), readAnimFraction(frame.stream)) : 0);
				// let roty = (flag & 2 ? Math.atan2(readAnimFraction(frame.stream), readAnimFraction(frame.stream)) : 0);
				// let rotz = (flag & 4 ? Math.atan2(readAnimFraction(frame.stream), readAnimFraction(frame.stream)) : 0);
				tempEuler.set(rotx, roty, rotz, "YXZ");
				tempquat.setFromEuler(tempEuler);
				tempquat.toArray(rawclip, clipindex);
				clipindex += 4;
			}
			//scale?
			if (base.type == 3) {
				rawclip[clipindex++] = (flag & 1 ? readAnimFraction(frame.stream) : 128) / 128;
				rawclip[clipindex++] = (flag & 2 ? readAnimFraction(frame.stream) : 128) / 128;
				rawclip[clipindex++] = (flag & 4 ? readAnimFraction(frame.stream) : 128) / 128;
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

export function buildFramebaseSkeleton(framebase: framemaps) {

	let maxbone = Math.max(...framebase.data.flatMap(q => q.data));


	let bones: TransformStack[] = [];
	for (let i = 0; i <= maxbone + 1; i++) {
		bones.push(new TransformStack([i]));
	}

	type RsTransform = { index: number, type: number, nodes: number[] };
	let pivot = bones[0];
	let actions: RsTransform[] = [];//TODO remove

	for (let [index, base] of framebase.data.entries()) {
		if (base.type == 0) {
			if (base.data.length == 0) {
				pivot = new TransformStack([]);
			} else if (base.data.length == 1) {
				pivot = bones[base.data[0] + 1]
			} else {
				pivot = findSharedPivot(base.data.map(q => bones[q + 1]));
				if (!pivot) { throw new Error("no shared pivot found"); }
			}
		}

		actions.push({
			index,
			nodes: base.data.map(q => q + 1),
			type: base.type
		});


		let inverse = pivot.getInverse();
		let forward = pivot.stack.slice();
		for (let boneid of base.data) {
			let stack = bones[boneid + 1];
			if (base.type == 1) {
				stack.addTransform({ type: "translate", data: index, inverse: false });
			} else if (base.type == 2) {
				stack.addFromOther(inverse);
				stack.addTransform({ type: "rotate", data: index, inverse: false });
				stack.addFromOther(forward);
			} else if (base.type == 3) {
				stack.addFromOther(inverse);
				stack.addTransform({ type: "scale", data: index, inverse: false });
				stack.addFromOther(forward);
			}
		}
	}

	let buildskeleton = function (bones: Set<TransformStack>, transSkip: number) {
		let children: BoneInit[] = [];
		//direct children for bones that have no more transforms left
		for (let bone of bones) {
			if (bone.stack.length == transSkip) {
				bones.delete(bone);
				if (bone.boneids.length != 1) { throw new Error("single owner bone expected"); }
				children.push({
					bakedTransform: null,
					translateconst: [],
					translate: [],
					rotate: [],
					scale: [],
					children: [],
					boneid: bone.boneids[0]
				});
			}
		}

		//resolve the possible baked portion of the transformstack
		if (transSkip == 0) {
			for (let bone of bones) {
				if (!bone.lastbaked) { continue; }
				let bake = bone.lastbaked;
				let index = bone.stack.indexOf(bake);
				if (index == -1) { throw new Error("bake not found"); }
				let bakedstack = bone.stack.slice(index);
				let friends = new Set<TransformStack>();
				boneloop: for (let bone of bones) {
					if (bone.lastbaked != bake) { continue; }
					if (bone.stack.length < bakedstack.length) { continue; }
					for (let i = 0; i < bakedstack.length; i++) {
						if (!isEqualTr(bone.stack[bone.stack.length - 1 - i], bakedstack[i])) {
							continue boneloop;
						}
					}
					friends.add(bone);
					bones.delete(bone);
				}
				children.push({
					bakedTransform: bakedstack,
					translateconst: [],
					translate: [],
					rotate: [],
					scale: [],
					children: buildskeleton(friends, bakedstack.length),
					boneid: -1
				})
			}
		}

		//try to find a common subset of transforms and combine them into a bone
		while (bones.size != 0) {
			let friends = new Set(bones);
			let hadnonconst = false;
			let newskip = transSkip;
			let resultbone: BoneInit = {
				bakedTransform: null,
				translateconst: [],
				translate: [],
				rotate: [],
				scale: [],
				children: [],
				boneid: -1
			}
			let ownerbone: TransformStack | null = null;
			digloop: for (; !ownerbone; newskip++) {
				let tr: Transform | null = null;

				for (let friend of friends) {
					let actionindex = friend.stack.length - 1 - newskip;
					if (actionindex < 0) {
						debugger;
					}
					if (actionindex == 0) {
						if (!hadnonconst && friends.size > 1) {
							friends.delete(friend);
							continue;
						} else {
							ownerbone = friend;
						}
					}
					if (!tr) {
						tr = friend.stack[actionindex];
						//can only stack transforms into the same bone when in compatible order
						if (resultbone.bakedTransform) { break digloop; }
						if (tr.type == "translate" && (resultbone.rotate.length != 0 || resultbone.scale.length != 0)) { break digloop }
						if (tr.type == "translateconst" && (resultbone.rotate.length != 0 || resultbone.scale.length != 0)) { break digloop; }
						if (tr.type == "rotate" && resultbone.scale.length != 0) { break digloop; }
					} else {
						let match = isEqualTr(tr, friend.stack[actionindex]);
						if (!match) {
							if (!hadnonconst) {
								friends.delete(friend);
							} else {
								break digloop;
							}
						}
					}
				}

				if (tr) {
					if (tr.type == "translateconst") { resultbone.translateconst.push(tr); }
					if (tr.type == "translate") { resultbone.translate.push(tr); }
					if (tr.type == "rotate") { resultbone.rotate.push(tr); }
					if (tr.type == "scale") { resultbone.scale.push(tr); }

					if (tr.type != "translateconst") { hadnonconst = true; }
				}
			}
			if (resultbone.translateconst.length == 0 && resultbone.translate.length == 0 && resultbone.rotate.length == 0 && resultbone.scale.length == 0) {
				console.log("useless bone");
				debugger;
			}
			friends.forEach(q => bones.delete(q));
			if (ownerbone) {
				if (ownerbone.boneids.length != 1) { throw new Error("ownerbone with id length 1 expected"); }
				resultbone.boneid = ownerbone.boneids[0];
				friends.delete(ownerbone);
			}
			resultbone.children = buildskeleton(friends, newskip);

			//skip const translate if we are a passive bone
			//this cleans up the skeleton a lot, mostly because of bones that can't find their vertices going to the origin
			if (resultbone.children.length == 0 && resultbone.rotate.length == 0 && resultbone.scale.length == 0 && resultbone.translate.length == 0) {
				resultbone.translateconst = [];
			}
			children.push(resultbone);
		}
		return children;
	}

	let rootboneinits = buildskeleton(new Set(bones), 0);

	let logboneinit = (bone: BoneInit, indent: number) => {
		//TODO i don't think this .find is correct
		let actionmap = (tr: Transform[]) => tr.map(q => actions.find(w => w.index == q.data)?.index + (q.inverse ? "!" : ""));
		let str = "  ".repeat(indent);
		str += (bone.boneid != -1 ? bone.boneid : "x");
		str += ") " + bone.translateconst.map(q => q.data + (q.inverse ? "!" : ""));
		str += " - " + actionmap(bone.translate);
		str += " - " + actionmap(bone.rotate);
		str += " - " + actionmap(bone.scale);
		console.log(str);
		bone.children.forEach(q => logboneinit(q, indent + 1));
	}
	console.log(bones);
	rootboneinits.forEach(q => logboneinit(q, 0));
	console.log(framebase.data.map(q => [q.type, "", ...q.data.map(q => q + 1)]));
	return { rootboneinits, actions, bones };
}

function readAnimFraction(str: Stream) {
	let byte0 = str.readUByte();
	if ((byte0 & 0x80) == 0) {
		return byte0 - 0x40;
	}
	let byte1 = str.readUByte();
	return (((byte0 & 0x7f) << 8) | byte1) - 0x4000;
}