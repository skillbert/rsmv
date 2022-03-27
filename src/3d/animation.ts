import { Stream, packedHSL2HSL, HSL2RGB } from "./utils";
import { cacheMajors } from "../constants";
import { CacheFileSource } from "../cache";
import { parseFrames, parseFramemaps, parseSequences } from "../opdecoder";
import { AnimationClip, Bone, Euler, KeyframeTrack, Matrix4, Object3D, Quaternion, QuaternionKeyframeTrack, Skeleton, Vector3, VectorKeyframeTrack } from "three";

//test  anim ids
//3577  falling plank
//3567  sawblade
//4013  agi pendulum
//907   wind chimes turning
//28351 pet shop sign
//13655 large orrery
//9101  conveyer belt

const framemapCache = new Map<number, ReturnType<typeof parseFramemaps["read"]>>();
let loaded = false;
async function getFramemap(loader: CacheFileSource, id: number) {
	// if (!loaded) {
	// 	let indices = await loader.getIndexFile(cacheMajors.framemaps);
	// 	for (let index of indices) {
	// 		let arch = await loader.getFileArchive(index);
	// 		for (let i = 0; i < index.subindexcount; i++) {
	// 			framemapCache.set(index.minor * 128 + index.subindices[i], parseFramemaps.read(arch[i].buffer));
	// 		}
	// 	}
	// 	loaded = true;
	// }
	// return framemapCache.get(id);
	return loader.getFileById(cacheMajors.framemaps, id);
}

export type ParsedAnimation = {
	rootbones: Bone[],
	clip: AnimationClip,
	skeleton: Skeleton
}

export async function parseAnimationSequence2(loader: CacheFileSource, id: number): Promise<ParsedAnimation> {

	let seqfile = await loader.getFileById(cacheMajors.sequences, id);

	let seq = parseSequences.read(seqfile);

	let sequenceframes = seq.frames!;
	let secframe0 = sequenceframes[0];
	if (!secframe0) {
		throw new Error("animation has no frames");
	}

	let frameindices = await loader.getIndexFile(cacheMajors.frames);
	let frameindex = frameindices.find(q => q.minor == secframe0!.frameidhi);
	if (!frameindex) {
		throw new Error("frame not found " + secframe0.frameidhi);
	}

	let framearch = await loader.getFileArchive(frameindex);

	let frames = framearch.map(file => {
		let framedata = parseFrames.read(file.buffer);
		return {
			flags: framedata.flags,
			animdata: framedata.animdata,
			dataindex: 0,
			baseid: framedata.probably_framemap_id,
			stream: new Stream(Buffer.from(framedata.animdata))
		};
	})

	let framebase = parseFramemaps.read(await loader.getFileById(cacheMajors.framemaps, frames[0].baseid));


	//calculate frame times
	let endtime = 0;
	let times = new Float32Array(sequenceframes.length);
	for (let i = 0; i < sequenceframes.length; i++) {
		times[i] = endtime;
		endtime += sequenceframes[i].framelength * 0.020;
	}

	let maxbone = Math.max(...framebase.data.flatMap(q => q.data));


	type Joint = { posbind: number, transform: number };

	let bones: Joint[][] = [];
	let combinedbases: number[][] = [];
	for (let i = 0; i <= maxbone + 1; i++) {
		bones.push([]);
		combinedbases.push([i]);
	}


	type RsTransform = { base: number, type: number, originalindex: number, nodes: number[] };
	let base = -1;
	let actions: RsTransform[] = [];
	for (let [index, op] of framebase.data.entries()) {
		if (op.type == 0) {
			if (op.data.length == 1) {
				base = op.data[0] + 1;
			} else {
				//assign an id to each encountered combination of bases
				//bit of extra effort here but saves a lot of trouble later
				let found = false;
				for (let [i, other] of combinedbases.entries()) {
					if (other.length == op.data.length && other.every((v, i) => v == op.data[i] + 1)) {
						found = true;
						base = i;
						break;
					}
				}
				if (!found) {
					base = combinedbases.push(op.data.sort((a, b) => a - b).map(q => q + 1)) - 1;
				}
			}
			continue;
		}
		actions.push({ base, nodes: op.data, type: op.type, originalindex: index });
	}
	console.log(actions.slice());
	actions.sort((a, b) => {
		if (a.type == b.type) { return b.nodes.length - a.nodes.length; }
		if (a.type == 1) { return 1; }
		if (b.type == 1) { return -1; }
		return 0;
	});
	console.log(actions);

	for (let op of actions) {
		for (let boneid of op.nodes) {
			let boneactions = bones[boneid + 1];
			if (op.type == 1) {
				boneactions.unshift({ posbind: -1, transform: op.originalindex });
			} else {
				boneactions.push({ posbind: op.base, transform: op.originalindex });
			}
		}
	}

	console.log(bones);

	//make sure translation actions have a 0 original trasnlate
	for (let bone of bones) {
		let lastbound = -1;
		let bindfree = false;
		for (let i = 0; i < bone.length; i++) {
			let action = bone[i];
			if (action.posbind == lastbound) {
				bindfree = true;
			} else {
				lastbound = action.posbind;
				bindfree = false;
			}
			if (action.transform != -1 && !bindfree) {
				let type = framebase.data[action.transform].type;
				if (type == 1) {
					bone.splice(i, 0, { posbind: action.posbind, transform: -1 });
				}
			}
		}
	}

	type ParsedJoint = Joint & { boneid: number, children: ParsedJoint[] };


	function iter(joint: ParsedJoint, bones: { joints: Joint[], id: number }[], depth: number) {
		for (let i = 0; i < bones.length; i++) {
			let bone1 = bones[i];
			let action1 = bone1.joints[depth];
			if (!action1) {
				joint.children.push({ posbind: -1, transform: -1, boneid: bone1.id, children: [] });
				continue;
			}
			let subbones = [bone1];
			for (let j = i + 1; j < bones.length; j++) {
				let bone2 = bones[j];
				let action2 = bone2.joints[depth];
				if (action2 && action1.posbind == action2.posbind && action1.transform == action2.transform) {
					subbones.push(bone2);
					bones.splice(j, 1);
					j--;
				}
			}
			let childjoint: ParsedJoint = { posbind: action1.posbind, transform: action1.transform, boneid: -1, children: [] };
			joint.children.push(childjoint);
			iter(childjoint, subbones, depth + 1);
		}
	}

	let rootJoint: ParsedJoint = { posbind: -1, transform: -1, boneid: -1, children: [] };
	iter(rootJoint, bones.map((v, i) => ({ joints: v, id: i })), 0);
	let logiter = (joint: ParsedJoint, depth: number) => {
		let transnames = ["anchor", "translate", "rotate", "scale?", "anim5", "anim6", "anim7", "anim8", "anim9"];
		console.log(`${"  ".repeat(depth)} = ${joint.boneid}${joint.transform == -1 ? "" : ` ${joint.posbind}.${joint.transform} ${transnames[framebase.data[joint.transform].type]}`}`);
		for (let sub of joint.children) { logiter(sub, depth + 1); }
	}
	// logiter(rootJoint, 0);

	let tracksTemplates: ((name: string) => KeyframeTrack)[] = [];

	for (let [i, base] of framebase.data.entries()) {

		//type 0 unknown, usually on root
		//type 1 probably translate
		//type 2 probably rotation
		//type 5 defaults to 64?

		let nfields = [3, 3, 4, 3, 3, 3, 3][base.type];
		let rawclip = new Float32Array(nfields * frames.length);
		let clipindex = 0;
		let tempquat = new Quaternion();
		let tempEuler = new Euler();
		for (let frame of frames) {
			let flag = frame?.flags[i] ?? 0;

			//TODO probly remove
			//???
			if (base.type == 0) {
				rawclip[clipindex++] = (flag & 1 ? frame.stream.readUShortSmart() : 0);
				rawclip[clipindex++] = (flag & 2 ? frame.stream.readUShortSmart() : 0);
				rawclip[clipindex++] = (flag & 4 ? frame.stream.readUShortSmart() : 0);
			}
			//translate
			if (base.type == 1) {
				rawclip[clipindex++] = (flag & 1 ? readAnimTranslate(frame?.stream) : 0);
				rawclip[clipindex++] = -(flag & 2 ? readAnimTranslate(frame?.stream) : 0);
				rawclip[clipindex++] = (flag & 4 ? readAnimTranslate(frame?.stream) : 0);
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
				tempEuler.set(rotx, roty, rotz, "XYZ");
				tempquat.setFromEuler(tempEuler);
				tempquat.toArray(rawclip, clipindex);
				clipindex += 4;
			}
			//scale?
			if (base.type == 3) {
				rawclip[clipindex++] = (flag & 1 ? frame.stream.readUShortSmart() : 0);
				rawclip[clipindex++] = (flag & 2 ? frame.stream.readUShortSmart() : 0);
				rawclip[clipindex++] = (flag & 4 ? frame.stream.readUShortSmart() : 0);
			}
			//others todo
			if (base.type >= 4) {
				rawclip[clipindex++] = (flag & 1 ? frame.stream.readUShortSmart() : 0);
				rawclip[clipindex++] = (flag & 2 ? frame.stream.readUShortSmart() : 0);
				rawclip[clipindex++] = (flag & 4 ? frame.stream.readUShortSmart() : 0);
			}
		}

		//need to copy and reorder the clip since the frame might be out of order/reused
		let clip = new Float32Array(nfields * sequenceframes.length);
		for (let i = 0; i < sequenceframes.length; i++) {
			let frameid = frameindex.subindices.indexOf(sequenceframes[i].frameidlow);
			for (let j = 0; j < nfields; j++) {
				clip[i * nfields + j] = rawclip[frameid * nfields + j];
			}
		}
		if (base.type == 0) {
			// tracks.push(new VectorKeyframeTrack(`bone_${base.data[0] + 1}.scale`, times as any, clip as any));
		}
		if (base.type == 1) {
			tracksTemplates[i] = (name => new VectorKeyframeTrack(`${name}.position`, times as any, clip as any));
		}
		if (base.type == 2) {
			tracksTemplates[i] = (name => new QuaternionKeyframeTrack(`${name}.quaternion`, times as any, clip as any));
		}
		if (base.type == 3) {
			// console.log("type3", (Math.max(...clip) == Math.min(...clip) ? Math.min(...clip) : [...clip]));
		}
		if (base.type == 5) {
			// console.log("type5", (Math.max(...clip) == Math.min(...clip) ? Math.min(...clip) : [...clip]));
		}
	}
	// for (let frame of frames) {
	// 	console.log(frames.indexOf(frame), framebase.data.map(q => q.type), frame.flags, [...frame.stream.getData()].map(q => q.toString(16).padStart(2, "0")).join(","));
	// }


	frames.forEach((q, i) => {
		// if (q.dataindex != q.animdata.length) {
		// 	throw new Error("ints left in anim decode: " + (q.animdata.length - q.dataindex));
		// }
		if (!q.stream.eof()) {
			console.warn("ints left in anim decode: " + (q.stream.getData().byteLength - q.stream.scanloc()), i);
		}
	});


	let resultbones: Bone[] = [];
	let extraboneCounter = 0;
	let tracks: KeyframeTrack[] = [];
	let iterskel = (parsed: ParsedJoint) => {
		let bone = new Bone();
		if (parsed.boneid != -1) {
			resultbones[parsed.boneid] = bone;
			bone.name = "bone_" + parsed.boneid;
		} else {
			bone.name = "extrabone_" + (extraboneCounter++);
		}
		if (parsed.posbind != -1) { bone.userData.boneposids = combinedbases[parsed.posbind]; }
		if (parsed.transform != -1) {
			if (!tracksTemplates[parsed.transform]) {
				//TODO
				// console.log("animation index", parsed.transform, "missing");
			} else {
				tracks.push(tracksTemplates[parsed.transform](bone.name));
			}
		}
		for (let child of parsed.children) {
			bone.add(iterskel(child));
		}
		return bone;
	}
	let rootbones = rootJoint.children.map(iterskel);
	let skeleton = new Skeleton(resultbones);
	let clip = new AnimationClip(`sequence_${id}`, endtime, tracks);


	// console.log("sequence id:", id, "framebase id:", frames[0].baseid, "framesid:", sequenceframes[0].frameidhi, "framecount:", sequenceframes.length);

	// // let clip = new AnimationClip(`sequence_${id}`, endtime, tracks);

	console.log(framebase.data.map(q => [q.type, "", ...q.data.map(q => q + 1)]));

	//TODO remove mockup
	// let rootbone = new Bone();
	// let skeleton = new Skeleton([rootbone]);
	// let clip = new AnimationClip(`sequence_${id}`, endtime, []);

	return { clip, skeleton, rootbones };
}

function readAnimTranslate(str: Stream) {
	let val = str.readUShortSmart();
	//one more bit seems to be reserved, unclear if this also happens for 1byte values
	return (val > 0x2000 ? val - 0x4000 : val);
}
function readAnimFraction(str: Stream) {
	let byte0 = str.readUByte();
	if ((byte0 & 0x80) == 0) {
		return byte0 - 0x40;
	}
	let byte1 = str.readUByte();
	return (((byte0 & 0x7f) << 8) | byte1) - 0x4000;
}