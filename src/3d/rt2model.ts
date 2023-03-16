import { BufferAttribute } from "three";
import { CacheFileSource } from "../cache";
import { parse } from "../opdecoder";
import { WorkingSubmesh } from "./rt5model";
import { ModelData } from "./rt7model";

export function parseRT2Model(modelfile: Buffer, source: CacheFileSource) {
    let parsed = parse.classicmodels.read(modelfile, source);

    let matusecount = new Map<number, { verts: number, tris: number }>();
    let allocmat = (colorid: number, nverts: number) => {
        if (colorid == 0x7fff) { return; }
        if (nverts < 3) { return; }
        let matid = (colorid & 0x8000 ? 0 : colorid);
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
        if (group.matid == 0) {
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
            parsed.xpos[posindex],
            -parsed.ypos[posindex],
            parsed.zpos[posindex]
        );
        group.texuvs.setXY(
            group.currentface,
            (polyindex <= 1 ? 0 : 1),
            (polyindex % 2 == 0 ? 0 : 1)
        )
        return group.currentface++;
    }

    for (let face of parsed.faces) {
        if (face.verts.length < 3) { continue; }
        if (face.color != 0x7fff) {
            //convert n-poly to tris
            //reverse iteration
            let group = matmeshes.get(face.color & 0x8000 ? 0 : face.color)!;
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
            let group = matmeshes.get(face.backcolor & 0x8000 ? 0 : face.backcolor)!;
            let firstvert = addvert(group, face.verts, 0, face.backcolor);
            let lastvert = addvert(group, face.verts, 1, face.backcolor);
            for (let i = 0; i < face.verts.length; i++) {
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
        meshes: [...matmeshes.values()].map(q => ({
            attributes: {
                pos: q.pos,
                color: q.color,
                texuvs: q.texuvs
            },
            hasVertexAlpha: false,
            indices: new BufferAttribute(q.index, 1),
            materialId: q.matid,
            needsNormalBlending: false
        }))
    }

    return r;
}

globalThis.parseRT2Model = parseRT2Model;