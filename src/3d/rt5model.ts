import { Stream, packedHSL2HSL, HSL2RGBfloat, flipEndian16 } from "../utils";
import * as THREE from "three";
import { parse } from "../opdecoder";
import type { CacheFileSource } from "../cache";
import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, LatheGeometry, Matrix3, Matrix4, Mesh, PlaneGeometry, SphereGeometry, Vector2, Vector3 } from "three";
import { oldmodels } from "../../generated/oldmodels";
import { ModelData, ModelMeshData } from "./rt7model";

type OldTextureMapping = {
    // mode: "flat" | "cylinder" | "cube" | "sphere",
    //projects 3d coords into texmap unit space
    //flat -> xy=uv
    //cylinder -> cylinder along y lon[-pi,pi]->[0,1] u, y=v, 
    //cube -> 1x1x1 cube centered at 0,0,0, each face is covered by a texture
    //sphere -> lonlat [-pi,pi]->[0,1] uv
    texspace: Matrix4,
    //determine center of painted vertices
    vertexsum: Vector3,
    vertexcount: number,
    vertexmin: Vector3,
    vertexmax: Vector3,
    args: oldmodels["texflags"][number]
}

export type WorkingSubmesh = {
    pos: BufferAttribute,
    texuvs: BufferAttribute,
    color: BufferAttribute,
    normals: BufferAttribute,
    index: Uint16Array,
    currentface: number,
    matid: number
}

let nonfiniteWarnCount = 0;

let tmp_rot = [0, 0, 0, 0, 0, 0, 0, 0, 0];
let tmp_normspace = [0, 0, 0, 0, 0, 0, 0, 0, 0];
/**
 * Taken from decompiled java client, there is no way to refactor it further as it's full of math errors.
 * This is a case of implementation defines spec and i'm not touching it
 * 
 * It creates a matrix that somewhat transforms into a space defined by the normal y vector
 */
function jagexOldNormalSpace(normal_x: number, normal_y: number, normal_z: number, rot_int: number, scale_x: number, scale_y: number, scale_z: number) {
    let tex_space = [0, 0, 0, 0, 0, 0, 0, 0, 0];

    let rot_cos = Math.cos(rot_int * 0.024543693);
    let rot_sin = Math.sin(rot_int * 0.024543693);
    tmp_rot[0] = rot_cos;
    tmp_rot[1] = 0.0;
    tmp_rot[2] = rot_sin;
    tmp_rot[3] = 0.0;
    tmp_rot[4] = 1.0;
    tmp_rot[5] = 0.0;
    tmp_rot[6] = -rot_sin;
    tmp_rot[7] = 0.0;
    tmp_rot[8] = rot_cos;

    let map_n_norm_neg = 1.0;
    let map_p_norm = 0.0;
    let map_m_norm = normal_y / 32767.0;
    let map_pn_norm_neg = -(Math.sqrt(1.0 - Math.min(1, map_m_norm * map_m_norm)));
    let map_1_m = 1.0 - map_m_norm;
    let map_pn = Math.sqrt(normal_x * normal_x + normal_z * normal_z);
    if (map_pn == 0.0 && map_m_norm == 0.0) {
        //normal of 0,0,0 means identity transform
        tex_space = tmp_rot;
    } else {
        if (map_pn != 0.0) {
            map_n_norm_neg = -normal_z / map_pn;
            map_p_norm = normal_x / map_pn;
        }
        tmp_normspace[0] = map_m_norm + map_n_norm_neg * map_n_norm_neg * map_1_m;
        tmp_normspace[1] = map_p_norm * map_pn_norm_neg;
        tmp_normspace[2] = map_p_norm * map_n_norm_neg * map_1_m;
        tmp_normspace[3] = -map_p_norm * map_pn_norm_neg;
        tmp_normspace[4] = map_m_norm;
        tmp_normspace[5] = map_n_norm_neg * map_pn_norm_neg;
        tmp_normspace[6] = map_n_norm_neg * map_p_norm * map_1_m;
        tmp_normspace[7] = -map_n_norm_neg * map_pn_norm_neg;
        tmp_normspace[8] = map_m_norm + map_p_norm * map_p_norm * map_1_m;

        tex_space[0] = tmp_rot[0] * tmp_normspace[0] + tmp_rot[1] * tmp_normspace[3] + tmp_rot[2] * tmp_normspace[6];
        tex_space[1] = tmp_rot[0] * tmp_normspace[1] + tmp_rot[1] * tmp_normspace[4] + tmp_rot[2] * tmp_normspace[7];
        tex_space[2] = tmp_rot[0] * tmp_normspace[2] + tmp_rot[1] * tmp_normspace[5] + tmp_rot[2] * tmp_normspace[8];
        tex_space[3] = tmp_rot[3] * tmp_normspace[0] + tmp_rot[4] * tmp_normspace[3] + tmp_rot[5] * tmp_normspace[6];
        tex_space[4] = tmp_rot[3] * tmp_normspace[1] + tmp_rot[4] * tmp_normspace[4] + tmp_rot[5] * tmp_normspace[7];
        tex_space[5] = tmp_rot[3] * tmp_normspace[2] + tmp_rot[4] * tmp_normspace[5] + tmp_rot[5] * tmp_normspace[8];
        tex_space[6] = tmp_rot[6] * tmp_normspace[0] + tmp_rot[7] * tmp_normspace[3] + tmp_rot[8] * tmp_normspace[6];
        tex_space[7] = tmp_rot[6] * tmp_normspace[1] + tmp_rot[7] * tmp_normspace[4] + tmp_rot[8] * tmp_normspace[7];
        tex_space[8] = tmp_rot[6] * tmp_normspace[2] + tmp_rot[7] * tmp_normspace[5] + tmp_rot[8] * tmp_normspace[8];
    }

    tex_space[0] *= scale_x;
    tex_space[1] *= scale_x;
    tex_space[2] *= scale_x;
    tex_space[3] *= scale_y;
    tex_space[4] *= scale_y;
    tex_space[5] *= scale_y;
    tex_space[6] *= scale_z;
    tex_space[7] *= scale_z;
    tex_space[8] *= scale_z;
    return tex_space;
}

export function parseRT5Model(modelfile: Buffer, source: CacheFileSource) {
    const enabletextures = false;//TODO fix this flag
    let modeldata = parse.oldmodels.read(modelfile, source);

    let maxy = 0;
    let miny = 0;
    let bonecount = 0;
    let skincount = 0;

    let debugmeshes: THREE.Mesh[] = [];
    let debugmat = new THREE.MeshBasicMaterial({ wireframe: true });
    let debugmat2 = new THREE.MeshBasicMaterial({ color: 0xff0000 });

    //position attribute
    let decodedx = new Int16Array(modeldata.vertcount);
    let decodedy = new Int16Array(modeldata.vertcount);
    let decodedz = new Int16Array(modeldata.vertcount);
    let xvalue = 0;
    let yvalue = 0;
    let zvalue = 0;
    let xstream = new Stream(modeldata.posx);
    let ystream = new Stream(modeldata.posy);
    let zstream = new Stream(modeldata.posz);
    for (let i = 0; i < modeldata.vertcount; i++) {
        let flag = modeldata.vertflags[i];
        if (flag & 0x1) { xvalue += xstream.readShortSmartBias(); }
        //no clue why y is inverted everywhere
        if (flag & 0x2) { yvalue += -ystream.readShortSmartBias(); }
        if (flag & 0x4) { zvalue += zstream.readShortSmartBias(); }
        decodedx[i] = xvalue;
        decodedy[i] = yvalue;
        decodedz[i] = zvalue;
        if (yvalue > maxy) { maxy = yvalue; }
        if (yvalue < miny) { miny = yvalue; }
    }
    if (!xstream.eof()) { throw new Error("stream not used to completion"); }
    if (!ystream.eof()) { throw new Error("stream not used to completion"); }
    if (!zstream.eof()) { throw new Error("stream not used to completion"); }


    //texture mappings
    let textureMappings: OldTextureMapping[] = [];
    for (let i = 0; i < modeldata.texmapcount; i++) {
        let flag = modeldata.texflags[i];
        textureMappings.push({
            texspace: new Matrix4(),
            vertexsum: new Vector3(),
            vertexcount: 0,
            vertexmin: new Vector3(10e6, 10e6, 10e6),
            vertexmax: new Vector3(-10e6, -10e6, -10e6),
            args: flag
        });
    }

    let matusecount = new Map<number, number>();
    let matmesh = new Map<number, WorkingSubmesh>();
    let materialbuffer: Uint16Array | null = modeldata.material;
    let colorbuffer = modeldata.colors;
    let uvids: number[] = [];

    let usenewuvkey: number;
    if (modeldata.modelversion >= 16) {
        usenewuvkey = 0x7fff
        let uvstream = new Stream(modeldata.uvs);
        while (!uvstream.eof()) {
            uvids.push(uvstream.readUShortSmart());
        }
        if (!uvstream.eof()) { throw new Error("stream not used to completion"); }
    } else {
        usenewuvkey = 0xff;
        uvids = Array.from(modeldata.uvs);
    }
    if (modeldata.mode_2) {
        materialbuffer = new Uint16Array(modeldata.facecount);
        colorbuffer = colorbuffer.slice();
        for (let i = 0; i < modeldata.facecount; i++) {
            let op = modeldata.mode_2[i];

            if (op & 2) {
                materialbuffer[i] = flipEndian16(flipEndian16(colorbuffer[i]) + 1);//TODO fix the endian thing at the other spot
                colorbuffer[i] = flipEndian16(127);//hsl for white//TODO unflip endianness
                uvids.push((op >> 2) + 1);
            }
        }
    }
    if (materialbuffer) {
        for (let matid of materialbuffer) {
            matusecount.set(matid, (matusecount.get(matid) ?? 0) + 1);
        }
    } else {
        matusecount.set(0, modeldata.facecount);
    }
    for (let [matid, facecount] of matusecount) {
        let finalvertcount = facecount * 3;
        let colstride = (colorbuffer ? modeldata.alpha ? 4 : 3 : 0);
        let mesh: WorkingSubmesh = {
            pos: new BufferAttribute(new Float32Array(finalvertcount * 3), 3),
            normals: new BufferAttribute(new Float32Array(finalvertcount * 3), 3),
            color: new BufferAttribute(new Uint8Array(finalvertcount * colstride), colstride, true),
            texuvs: new BufferAttribute(new Float32Array(finalvertcount * 2), 2),
            index: new Uint16Array(facecount * 3),
            currentface: 0,
            matid: flipEndian16(matid) - 1//TODO fix endianness elsewhere
        };
        matmesh.set(matid, mesh);
    }

    let vertexindex = new Uint16Array(modeldata.facecount * 3);

    let srcindex0 = 0, srcindex1 = 0, srcindex2 = 0, srcindexlast = 0;
    let stream = new Stream(modeldata.indexbuffer);
    for (let i = 0; i < modeldata.facecount; i++) {
        let typedata = modeldata.tritype[i];
        let type = typedata & 0x7;
        if (type == 1) {
            srcindex0 = srcindexlast + stream.readShortSmartBias();
            srcindex1 = srcindex0 + stream.readShortSmartBias();
            srcindex2 = srcindex1 + stream.readShortSmartBias();
            srcindexlast = srcindex2;
        } else if (type == 2) {
            srcindex1 = srcindex2;
            srcindex2 = srcindexlast + stream.readShortSmartBias();
            srcindexlast = srcindex2;
        } else if (type == 3) {
            srcindex0 = srcindex2;
            srcindex2 = srcindexlast + stream.readShortSmartBias();
            srcindexlast = srcindex2;
        } else if (type == 4) {
            let srctmp = srcindex0;
            srcindex0 = srcindex1;
            srcindex1 = srctmp;
            srcindex2 = srcindexlast + stream.readShortSmartBias();
            srcindexlast = srcindex2;
        } else {
            throw new Error("unkown face type");
        }
        vertexindex[i * 3 + 0] = srcindex0;
        vertexindex[i * 3 + 1] = srcindex1;
        vertexindex[i * 3 + 2] = srcindex2;
    }
    if (!stream.eof()) { throw new Error("stream not used to completion"); }

    //calculate centers of material maps
    if (materialbuffer) {
        let posa = new Vector3();
        let posb = new Vector3();
        let posc = new Vector3();
        let texindex = 0;
        for (let i = 0; i < modeldata.facecount; i++) {
            let matarg = materialbuffer[i];
            if (matarg == 0) { continue; }//TODO is this now obsolete?
            let mapid = (texindex < uvids.length ? uvids[texindex++] : 0);
            if (mapid != 0 && mapid != usenewuvkey) {
                let mapping = textureMappings[mapid - 1];
                srcindex0 = vertexindex[i * 3 + 0];
                srcindex1 = vertexindex[i * 3 + 1];
                srcindex2 = vertexindex[i * 3 + 2];
                posa.set(decodedx[srcindex0], decodedy[srcindex0], decodedz[srcindex0]);
                posb.set(decodedx[srcindex1], decodedy[srcindex1], decodedz[srcindex1]);
                posc.set(decodedx[srcindex2], decodedy[srcindex2], decodedz[srcindex2]);

                mapping.vertexsum.add(posa).add(posb).add(posc);
                mapping.vertexmin.min(posa).min(posb).min(posc);
                mapping.vertexmax.max(posa).max(posb).max(posc);
                mapping.vertexcount += 3;
            }
        }
    }


    let hadbaduvscale = false;
    //build material maps
    if (modeldata.texflags) {
        let mtmp = new Matrix4();
        let v0 = new Vector3();
        let v1 = new Vector3();
        let v2 = new Vector3();
        let vtmp = new Vector3();
        //different prop name depending on model version
        let texmap_verts = (modeldata.texmap_verts_1 ?? modeldata.texmap_verts_2)!;

        //parse texmaps
        for (let i = 0; i < modeldata.texflags.length; i++) {
            let mapping = textureMappings[i];
            if (mapping.args.type == 0) {
                let [i0, i1, i2] = texmap_verts[mapping.args.vertindex];

                v0.set(decodedx[i0], decodedy[i0], decodedz[i0]);
                v1.set(decodedx[i1], decodedy[i1], decodedz[i1]);
                v2.set(decodedx[i2], decodedy[i2], decodedz[i2]);

                v1.sub(v0);
                v2.sub(v0);
                vtmp.copy(v1).cross(v2);//null space

                mapping.texspace.set(
                    v1.x, v2.x, vtmp.x, v0.x,
                    v1.y, v2.y, vtmp.y, v0.y,
                    v1.z, v2.z, vtmp.z, v0.z,
                    0, 0, 0, 1
                );
                mapping.texspace.invert();
            } else if (mapping.args.type >= 1) {
                let proj = modeldata.texmap_projections[mapping.args.projection];

                let scalex = 1, scaley = 1, scalez = 1;
                if (mapping.args.type == 1) {
                    //no clue why this works this way
                    let scale = proj.scale[0];
                    if (scale > 0) {
                        scalex = 1;
                        scalez = scale / 1024;
                    } else if (scale < 0) {
                        scalex = -scale / 1024;
                        scalez = 1;
                    }
                    scalex *= 512;
                    scalez *= 512;
                    scaley = 64 / (proj.scale[1] & 0xffff);
                } else if (mapping.args.type == 2) {
                    scalex = 64 / (proj.scale[0] & 0xffff);
                    scaley = 64 / (proj.scale[1] & 0xffff);
                    scalez = 64 / (proj.scale[2] & 0xffff);
                } else {
                    scalex = proj.scale[0] / 1024;
                    scaley = proj.scale[1] / 1024;
                    scalez = proj.scale[2] / 1024;
                }

                if (!isFinite(scalex)) { scalex = 1; hadbaduvscale = true; }
                if (!isFinite(scaley)) { scaley = 1; hadbaduvscale = true; }
                if (!isFinite(scalez)) { scalez = 1; hadbaduvscale = true; }

                let space = jagexOldNormalSpace(proj.normal[0], proj.normal[1], proj.normal[2], proj.rotation, scalex, scaley, scalez);
                // if (space.some(q => isNaN(q)) || isNaN(v0.x) || isNaN(v0.y) || isNaN(v0.z)) {
                //     debugger;
                // }
                mapping.texspace.set(
                    space[0], -space[1], space[2], 0,
                    space[3], -space[4], space[5], 0,
                    space[6], -space[7], space[8], 0,
                    0, 0, 0, 1
                );
                v0.copy(mapping.vertexmax).add(mapping.vertexmin).divideScalar(-2);
                mtmp.makeTranslation(v0.x, v0.y, v0.z);
                mapping.texspace.multiply(mtmp);
            }

            if (globalThis.testmat >= 0 && globalThis.testmat == i) {
                let geo2 = new LatheGeometry([new Vector2(0.05, 0), new Vector2(0.05, 1), new Vector2(0.15, 1), new Vector2(0, 1.15)]);
                let geo: BufferGeometry;
                if (mapping.args.type == 0) {
                    geo = new PlaneGeometry(1, 1);
                } else if (mapping.args.type == 1) {
                    geo = new CylinderGeometry(0.5, 0.5, 1, 10);
                } else if (mapping.args.type == 2) {
                    geo = new BoxGeometry(1, 1, 1);
                } else if (mapping.args.type == 3) {
                    geo = new SphereGeometry(1);
                }
                let mesh = new Mesh(geo!, debugmat);
                let arrowmesh = new Mesh(geo2, debugmat2);
                mesh.matrixAutoUpdate = false;
                mesh.matrix.copy(mapping.texspace).invert();
                arrowmesh.matrixAutoUpdate = false;
                arrowmesh.matrix.copy(mapping.texspace).invert();
                debugmeshes.push(mesh, arrowmesh);
            }
        }
    }
    if (hadbaduvscale && nonfiniteWarnCount++ < 20) {
        console.warn("nonfinite texture scale");
    }

    let vertexuvids: Uint16Array | null = null;
    if (modeldata.texuvs) {
        vertexuvids = new Uint16Array(modeldata.vertcount);
        let vertexuvcount = 0;
        for (let i = 0; i < modeldata.texuvs.vertex.length; i++) {
            vertexuvids[i] = vertexuvcount;
            vertexuvcount += modeldata.texuvs.vertex[i];
        }
    }

    let texmapindex = 0;
    let v0 = new Vector3();
    let v1 = new Vector3();
    let v2 = new Vector3();
    let vnormal = new Vector3();
    let vtmp0 = new Vector3();
    let vtmp1 = new Vector3();
    let vtmp2 = new Vector3();
    let m3tmp = new Matrix3();
    for (let i = 0; i < modeldata.facecount; i++) {
        srcindex0 = vertexindex[i * 3 + 0];
        srcindex1 = vertexindex[i * 3 + 1];
        srcindex2 = vertexindex[i * 3 + 2];
        v0.set(decodedx[srcindex0], decodedy[srcindex0], decodedz[srcindex0]);
        v1.set(decodedx[srcindex1], decodedy[srcindex1], decodedz[srcindex1]);
        v2.set(decodedx[srcindex2], decodedy[srcindex2], decodedz[srcindex2]);

        vtmp0.copy(v1).sub(v0);
        vnormal.copy(v2).sub(v0).cross(vtmp0).normalize();

        if (materialbuffer && materialbuffer[i] == 0 && !colorbuffer || colorbuffer[i] == 0) { continue; }

        let matargument = (materialbuffer ? materialbuffer[i] : 0);
        let submesh = matmesh.get(matargument)!;
        let dstfaceindex = submesh.currentface++;
        let vertbase = dstfaceindex * 3;
        let posattr = submesh.pos;
        let uvattr = submesh.texuvs;
        let normalattr = submesh.normals;
        let indexbuf = submesh.index;
        if (!(Math.abs(1 - vnormal.length()) < 0.01)) {
            //some models have degenerate triangles, not sure what the rs engine does about them
            // debugger;
        }
        posattr.setXYZ(vertbase + 0, v0.x, v0.y, v0.z);
        posattr.setXYZ(vertbase + 1, v1.x, v1.y, v1.z);
        posattr.setXYZ(vertbase + 2, v2.x, v2.y, v2.z);
        normalattr.setXYZ(vertbase + 0, vnormal.x, vnormal.y, vnormal.z);
        normalattr.setXYZ(vertbase + 1, vnormal.x, vnormal.y, vnormal.z);
        normalattr.setXYZ(vertbase + 2, vnormal.x, vnormal.y, vnormal.z);

        if (colorbuffer) {
            let colorattr = submesh.color;
            //TODO force new triangle vertices of last color wasn't equal
            let colint = colorbuffer[i];
            //TODO fix endianness elsewhere
            let [r, g, b] = HSL2RGBfloat(packedHSL2HSL(flipEndian16(colint)));
            if (!modeldata.alpha) {
                colorattr.setXYZ(vertbase + 0, r, g, b);
                colorattr.setXYZ(vertbase + 1, r, g, b);
                colorattr.setXYZ(vertbase + 2, r, g, b);
            } else {
                let alpha = (255 - modeldata.alpha[i]) / 255;
                colorattr.setXYZW(vertbase + 0, r, g, b, alpha);
                colorattr.setXYZW(vertbase + 1, r, g, b, alpha);
                colorattr.setXYZW(vertbase + 2, r, g, b, alpha);
            }
        }

        if (matargument) {
            //calculate the center of each mapping
            let mapid = (texmapindex < uvids.length ? uvids[texmapindex++] : 0);
            if (mapid == 0) {
                // debugger;
                //TODO just default [0,1] uvs?
            } else if (mapid == usenewuvkey) {
                //TODO still missing something
                uvattr.setXY(vertbase + 0, modeldata.texuvs!.udata[vertexuvids![srcindex0]] / 4096, modeldata.texuvs!.vdata[vertexuvids![srcindex0]] / 4096);
                uvattr.setXY(vertbase + 1, modeldata.texuvs!.udata[vertexuvids![srcindex1]] / 4096, modeldata.texuvs!.vdata[vertexuvids![srcindex1]] / 4096);
                uvattr.setXY(vertbase + 2, modeldata.texuvs!.udata[vertexuvids![srcindex2]] / 4096, modeldata.texuvs!.vdata[vertexuvids![srcindex2]] / 4096);
            } else {
                let mapping = textureMappings[mapid - 1];
                v0.applyMatrix4(mapping.texspace);
                v1.applyMatrix4(mapping.texspace);
                v2.applyMatrix4(mapping.texspace);
                if (mapping.args.type == 0) {
                    uvattr.setXY(vertbase + 0, v0.x, v0.y);
                    uvattr.setXY(vertbase + 1, v1.x, v1.y);
                    uvattr.setXY(vertbase + 2, v2.x, v2.y);
                } else if (mapping.args.type == 1) {
                    let u0 = Math.atan2(v0.z, v0.x) / Math.PI / 2 * 3;
                    let u1 = Math.atan2(v1.z, v1.x) / Math.PI / 2 * 3;
                    let u2 = Math.atan2(v2.z, v2.x) / Math.PI / 2 * 3;
                    //TODO fix wrapping
                    uvattr.setXY(vertbase + 0, u0 - 0.5, v0.y - 0.5);
                    uvattr.setXY(vertbase + 1, u1 - 0.5, v1.y - 0.5);
                    uvattr.setXY(vertbase + 2, u2 - 0.5, v2.y - 0.5);
                } else if (mapping.args.type == 2) {

                    vtmp0.copy(v1).sub(v0);
                    //face normal
                    vtmp1.copy(v2).sub(v0).cross(vtmp0);
                    m3tmp.setFromMatrix4(mapping.texspace);
                    //face normal in texture space
                    vtmp1.applyMatrix3(m3tmp);
                    let max = Math.max(vtmp1.x, -vtmp1.x, vtmp1.y, -vtmp1.y, vtmp1.z, -vtmp1.z);
                    //find texture cube face most close to face normal
                    //and project from texture space into face space
                    if (vtmp1.x == max) {
                        m3tmp.set(0, 0, 1, 0, -1, 0, 0, 0, 0);
                    } else if (vtmp1.x == -max) {
                        m3tmp.set(0, 0, -1, 0, -1, 0, 0, 0, 0);
                    } else if (vtmp1.z == max) {
                        m3tmp.set(1, 0, 0, 0, -1, 0, 0, 0, 0);
                    } else if (vtmp1.z == -max) {
                        m3tmp.set(-1, 0, 0, 0, -1, 0, 0, 0, 0);
                    } else if (vtmp1.y == max) {
                        m3tmp.set(1, 0, 0, 0, 0, 1, 0, 0, 0);
                    } else if (vtmp1.y == -max) {
                        m3tmp.set(1, 0, 0, 0, 0, 1, 0, 0, 0);
                    } else {
                        throw new Error("unexpected");
                    }

                    vtmp0.copy(v0).applyMatrix3(m3tmp).subScalar(0.5);
                    vtmp1.copy(v1).applyMatrix3(m3tmp).subScalar(0.5);
                    vtmp2.copy(v2).applyMatrix3(m3tmp).subScalar(0.5);
                    uvattr.setXY(vertbase + 0, vtmp0.x, vtmp0.y);
                    uvattr.setXY(vertbase + 1, vtmp1.x, vtmp1.y);
                    uvattr.setXY(vertbase + 2, vtmp2.x, vtmp2.y);
                } else if (mapping.args.type == 3) {
                    let u0 = Math.atan2(v0.z, v0.x) / Math.PI / 2;
                    let u1 = Math.atan2(v1.z, v1.x) / Math.PI / 2;
                    let u2 = Math.atan2(v2.z, v2.x) / Math.PI / 2;
                    let vv0 = Math.atan2(v0.y, Math.sqrt(v0.x * v0.x + v0.z * v0.z)) / Math.PI / 2;
                    let vv1 = Math.atan2(v1.y, Math.sqrt(v1.x * v1.x + v1.z * v1.z)) / Math.PI / 2;
                    let vv2 = Math.atan2(v2.y, Math.sqrt(v2.x * v2.x + v2.z * v2.z)) / Math.PI / 2;
                    //TODO fix wrapping
                    uvattr.setXY(vertbase + 0, u0, vv0);
                    uvattr.setXY(vertbase + 1, u1, vv1);
                    uvattr.setXY(vertbase + 2, u2, vv2);
                }
            }
            if (globalThis.testmat >= 0 && globalThis.testmat != mapid - 1) {
                uvattr.setXY(vertbase + 0, 0, 0);
                uvattr.setXY(vertbase + 1, 0, 0);
                uvattr.setXY(vertbase + 2, 0, 0);
                let colorattr = submesh.color;
                colorattr.setXYZ(vertbase + 0, 0, 0, 0);
                colorattr.setXYZ(vertbase + 1, 0, 0, 0);
                colorattr.setXYZ(vertbase + 2, 0, 0, 0);
            }
        }

        //could use non-indexed in this case but it doesn't really matter
        indexbuf[dstfaceindex * 3 + 0] = vertbase + 0;
        indexbuf[dstfaceindex * 3 + 1] = vertbase + 2;//flip 1 and 2, opengl uses oposite notation
        indexbuf[dstfaceindex * 3 + 2] = vertbase + 1;
    }

    let meshes = [...matmesh.values()].map<ModelMeshData>(m => {
        let indices = new BufferAttribute(m.index, 1);
        return {
            indices: indices,
            vertexstart: 0,
            vertexend: m.pos.count,
            indexLODs: [indices],
            materialId: m.matid,
            hasVertexAlpha: !!modeldata.alpha,
            needsNormalBlending: true,
            attributes: {
                pos: m.pos,
                color: m.color,
                texuvs: m.texuvs,
                normals: m.normals
            },
        };
    });

    if (modeldata.modelversion <= 7) {//possibly also 8 and 9, not 10
        const scale = 4;
        maxy *= scale;
        miny *= scale;
        for (let mesh of meshes) {
            let arr = mesh.attributes.pos.array;
            for (let i = 0; i < arr.length; i++) {
                arr[i] *= scale;
            }
        }
    }

    let r: ModelData = { maxy, miny, meshes, bonecount: bonecount, skincount: skincount, debugmeshes };

    return r;
}
