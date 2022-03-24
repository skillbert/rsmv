import { Stream, packedHSL2HSL, HSL2RGB } from "./utils";
import { cacheMajors } from "../constants";
import { CacheFileSource } from "../cache";
import { parseFrames, parseFramemaps, parseSequences } from "../opdecoder";
import { AnimationClip, Euler, KeyframeTrack, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from "three";

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

export async function parseAnimationSequence2(loader: CacheFileSource, id: number) {

	let seqfile = await loader.getFileById(cacheMajors.sequences, id);

	let seq = parseSequences.read(seqfile);

	let secframe0 = seq.unknown_01?.[0];
	if (!secframe0) {
		console.log("sequence has no frames");
		return null;
	}

	let frameindices = await loader.getIndexFile(cacheMajors.frames);
	let frameindex = frameindices.find(q => q.minor == secframe0!.frameidhi);
	if (!frameindex) {
		console.log("frame not found " + secframe0.frameidhi);
		return null;
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

	let maxboneid = framebase.data.reduce((a, v) => Math.max(a, ...v.data), 0);
	let bonepositions: Matrix4[] = [];
	for (let i = 0; i <= maxboneid; i++) { bonepositions.push(new Matrix4()); }
	let animtracks: { bones: number[], unknownbool: boolean, type: number, data1: [number, number, number][], data2?: [number, number, number][] }[] = [];


	let sequenceframes = seq.unknown_01!;

	//calculate frame times
	let endtime = 0;
	let times = new Float32Array(sequenceframes.length);
	for (let i = 0; i < sequenceframes.length; i++) {
		times[i] = endtime;
		endtime += sequenceframes[i].framelength * 0.020;
	}

	let tracks: KeyframeTrack[] = [];
	for (let i = 0; i < framebase.data.length; i++) {
		let base = framebase.data[i];

		let has2ndint = (base.type == 2);
		let track: typeof animtracks[number] = {
			bones: base.data,
			type: base.type,
			unknownbool: base.unknown,
			data1: [],
		}
		if (has2ndint) { track.data2 = []; }
		animtracks.push(track);

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
			//scale?
			if (base.type == 5) {
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
			console.log("type0", (Math.max(...clip) == Math.min(...clip) ? Math.min(...clip) : [...clip]));
			// tracks.push(new VectorKeyframeTrack(`bone_${base.data[0] + 1}.scale`, times as any, clip as any));
		}
		if (base.type == 1) {
			for (let bone of base.data) {
				tracks.push(new VectorKeyframeTrack(`.bones[${bone + 1}].position`, times as any, clip as any));
			}
		}
		if (base.type == 2) {
			for (let bone of base.data) {
				tracks.push(new QuaternionKeyframeTrack(`.bones[${bone + 1}].quaternion`, times as any, clip as any));
			}
		}
		if (base.type == 3) {
			console.log("type3", (Math.max(...clip) == Math.min(...clip) ? Math.min(...clip) : [...clip]));
		}
		if (base.type == 5) {
			console.log("type5", (Math.max(...clip) == Math.min(...clip) ? Math.min(...clip) : [...clip]));
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
	console.log(seq);
	console.log(framebase.data.map(q => [q.type, "", ...q.data]));

	console.log("sequence id:", id, "framebase id:", frames[0].baseid, "framesid:", sequenceframes[0].frameidhi, "framecount:", sequenceframes.length);

	let clip = new AnimationClip(`sequence_${id}`, endtime, tracks);
	return clip;
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