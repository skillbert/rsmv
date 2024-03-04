import { BufferAttribute, Vector3 } from "three";
import { CacheFileSource } from "../cache";
import { parse } from "../opdecoder";
import { WorkingSubmesh } from "./rt5model";
import { ModelData, ModelMeshData } from "./rt7model";

export function parseRT2Model(modelfile: Buffer, source: CacheFileSource) {
    let parsed = parse.classicmodels.read(modelfile, source);
    const posscale = 4;

    let matusecount = new Map<number, { verts: number, tris: number }>();
    let allocmat = (colorid: number, nverts: number) => {
        if (colorid == 0x7fff) { return; }
        if (nverts < 3) { return; }
        let matid = (colorid & 0x8000 ? -1 : colorid + 1);
        let count = matusecount.get(matid);
        if (!count) {
            count = { tris: 0, verts: 0 };
            matusecount.set(matid, count);
        }
        count.verts += nverts;
        count.tris += nverts - 2;
    }

    for (let face of parsed.faces) {
        allocmat(face.color, face.verts.length);
        allocmat(face.backcolor, face.verts.length);
    }

    let matmeshes = new Map<number, WorkingSubmesh & { currentindex: number }>();
    for (let [matid, count] of matusecount.entries()) {
        matmeshes.set(matid, {
            pos: new BufferAttribute(new Float32Array(count.verts * 3), 3),
            normals: new BufferAttribute(new Float32Array(count.verts * 3), 3),
            color: new BufferAttribute(new Uint8Array(count.verts * 3), 3, true),
            texuvs: new BufferAttribute(new Float32Array(count.verts * 2), 2),
            index: new Uint16Array(count.tris * 3),
            currentface: 0,
            currentindex: 0,
            matid: matid
        });
    }

    let addvert = (group: WorkingSubmesh, verts: number[], polyindex: number, color: number) => {
        let posindex = verts[polyindex];
        if (group.matid == -1) {
            group.color.setXYZ(
                group.currentface,
                ((~color >> 10) & 0x1f) / 31,
                ((~color >> 5) & 0x1f) / 31,
                ((~color >> 0) & 0x1f) / 31
            );
        } else {
            group.color.setXYZ(group.currentface, 1, 1, 1);
        }
        group.pos.setXYZ(
            group.currentface,
            parsed.xpos[posindex] * posscale,
            -parsed.ypos[posindex] * posscale,
            parsed.zpos[posindex] * posscale
        );
        group.normals.setXYZ(
            group.currentface,
            currentNormal.x,
            currentNormal.y,
            currentNormal.z
        )

        group.texuvs.setXY(
            group.currentface,
            (polyindex == 0 || polyindex == 3 ? 0 : 1),
            (polyindex == 0 || polyindex == 1 ? 0 : 1)
        )
        return group.currentface++;
    }

    let currentNormal = new Vector3();
    let v0 = new Vector3();
    let v1 = new Vector3();
    let v2 = new Vector3();
    for (let face of parsed.faces) {
        if (face.verts.length < 3) { continue; }
        if (face.color != 0x7fff) {

            let i0 = face.verts.at(-1)!;
            let i1 = face.verts.at(-2)!;
            let i2 = face.verts.at(-3)!;

            v0.set(parsed.xpos[i0], -parsed.ypos[i0], parsed.zpos[i0]);
            v1.set(parsed.xpos[i1], -parsed.ypos[i1], parsed.zpos[i1]);
            v2.set(parsed.xpos[i2], -parsed.ypos[i2], parsed.zpos[i2]);

            v1.sub(v0);
            v2.sub(v0);
            currentNormal.copy(v1).cross(v2).normalize();

            //convert n-poly to tris
            //reverse iteration
            let group = matmeshes.get(face.color & 0x8000 ? -1 : face.color + 1)!;
            let firstvert = addvert(group, face.verts, face.verts.length - 1, face.color);
            let lastvert = addvert(group, face.verts, face.verts.length - 2, face.color);

            for (let i = face.verts.length - 3; i >= 0; i--) {
                let newvert = addvert(group, face.verts, i, face.color);
                group.index[group.currentindex++] = firstvert;
                group.index[group.currentindex++] = lastvert;
                group.index[group.currentindex++] = newvert;
                lastvert = newvert;
            }
        }
        if (face.backcolor != 0x7fff) {
            let i0 = face.verts[0];
            let i1 = face.verts[1];
            let i2 = face.verts[2];

            v0.set(parsed.xpos[i0], -parsed.ypos[i0], parsed.zpos[i0]);
            v1.set(parsed.xpos[i1], -parsed.ypos[i1], parsed.zpos[i1]);
            v2.set(parsed.xpos[i2], -parsed.ypos[i2], parsed.zpos[i2]);

            v1.sub(v0);
            v2.sub(v0);
            currentNormal.copy(v1).cross(v2).normalize();

            let group = matmeshes.get(face.backcolor & 0x8000 ? -1 : face.backcolor + 1)!;
            let firstvert = addvert(group, face.verts, 0, face.backcolor);
            let lastvert = addvert(group, face.verts, 1, face.backcolor);
            for (let i = 2; i < face.verts.length; i++) {
                let newvert = addvert(group, face.verts, i, face.backcolor);
                group.index[group.currentindex++] = firstvert;
                group.index[group.currentindex++] = lastvert;
                group.index[group.currentindex++] = newvert;
                lastvert = newvert;
            }
        }
    }

    let maxy = 0;
    let miny = 0;

    let r: ModelData = {
        bonecount: 0,
        miny, maxy,
        skincount: 0,
        meshes: [...matmeshes.values()].map(q => {
            let indices = new BufferAttribute(q.index, 1);
            return {
                indices: indices,
                vertexstart: 0,
                vertexend: q.pos.count,
                attributes: {
                    pos: q.pos,
                    color: q.color,
                    texuvs: q.texuvs,
                    normals: q.normals
                },
                hasVertexAlpha: false,
                indexLODs: [indices],
                materialId: q.matid,
                needsNormalBlending: true
            } satisfies ModelMeshData;
        })
    }

    return r;
}
