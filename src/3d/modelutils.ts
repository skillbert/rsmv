import { BufferAttribute } from "three";
import { ModelData, ModelMeshData } from "./rt7model";

type rgb = [r: number, g: number, b: number];
type xyz = [x: number, y: number, z: number];

const white: rgb = [255, 255, 255];
const red: rgb = [255, 0, 0];
const tile = 512;
const halftile = 256;

export class MeshBuilder {
    pos: number[] = [];
    color: number[] = [];
    uvs: number[] = [];
    index: number[] = [];
    normals: number[] = [];
    vertindex = 0;
    parent: ModelBuilder | null;
    constructor(parent: ModelBuilder | null) {
        this.parent = parent;
    }
    addParallelogram(col: rgb, [x, y, z]: xyz, [dx1, dy1, dz1]: xyz, [dx2, dy2, dz2]: xyz) {
        this.pos.push(
            x, y, z,
            x + dx1, y + dy1, z + dz1,
            x + dx1 + dx2, y + dy1 + dy2, z + dz1 + dz2,
            x + dx2, y + dy2, z + dz2
        );
        this.color.push(
            ...col,
            ...col,
            ...col,
            ...col
        );
        this.uvs.push(
            0, 0,
            1, 0,
            1, 1,
            0, 1
        );
        let normx = dy2 * dz1 - dy1 * dz2;
        let normy = dz2 * dx1 - dz1 * dx2;
        let normz = dx2 * dy1 - dx1 * dy2;
        let len = Math.hypot(normx, normy, normz);
        normx /= len;
        normy /= len;
        normz /= len;
        this.normals.push(
            normx, normy, normz,
            normx, normy, normz,
            normx, normy, normz,
            normx, normy, normz,
        )
        this.index.push(
            this.vertindex + 0, this.vertindex + 2, this.vertindex + 1,
            this.vertindex + 0, this.vertindex + 3, this.vertindex + 2,
        );
        this.vertindex += 4;
        return this;
    }
    addDoubleParallelogram(col: rgb, [x, y, z]: xyz, [dx1, dy1, dz1]: xyz, [dx2, dy2, dz2]: xyz) {
        this.addParallelogram(col, [x, y, z], [dx1, dy1, dz1], [dx2, dy2, dz2]);
        this.addParallelogram(col, [x + dx1, y + dy1, z + dz1], [-dx1, -dy1, -dz1], [dx2, dy2, dz2]);
        return this;
    }
    addCube(col: rgb, [centerx, centery, centerz]: xyz, [sizex, sizey, sizez]: xyz) {
        let x0 = centerx - sizex / 2;
        let y0 = centery - sizey / 2;
        let z0 = centerz - sizez / 2;
        let x1 = x0 + sizex;
        let y1 = y0 + sizey;
        let z1 = z0 + sizez;
        this.addParallelogram(col, [x0, y0, z0], [sizex, 0, 0], [0, sizey, 0]);
        this.addParallelogram(col, [x1, y0, z0], [0, 0, sizez], [0, sizey, 0]);
        this.addParallelogram(col, [x1, y0, z1], [-sizex, 0, 0], [0, sizey, 0]);
        this.addParallelogram(col, [x0, y0, z1], [0, 0, -sizez], [0, sizey, 0]);
        this.addParallelogram(col, [x0, y0, z1], [sizex, 0, 0], [0, 0, -sizez]);
        this.addParallelogram(col, [x0, y1, z0], [sizex, 0, 0], [0, 0, sizez]);
        return this;
    }
    addExtrusion(color: rgb, vector: xyz, points: xyz[]) {
        //side faces
        let prevpoint = points[points.length - 1];
        if (Math.hypot(...vector) != 0) {
            for (let a = 0; a < points.length; a++) {
                let point = points[a];
                this.addParallelogram(color, prevpoint, [point[0] - prevpoint[0], point[1] - prevpoint[1], point[2] - prevpoint[2]], vector);
                prevpoint = point;
            }
        }

        if (points.length > 2) {
            let dx1 = points[2][0] - points[1][0], dy1 = points[2][0] - points[1][0], dz1 = points[2][0] - points[1][0];
            let dx2 = points[0][0] - points[1][0], dy2 = points[0][0] - points[1][0], dz2 = points[0][0] - points[1][0];
            let normx = dy2 * dz1 - dy1 * dz2;
            let normy = dz2 * dx1 - dz1 * dx2;
            let normz = dx2 * dy1 - dx1 * dy2;
            let len = Math.hypot(normx, normy, normz);
            normx /= len;
            normy /= len;
            normz /= len;

            //top polygon
            let zeroindex = -1;
            let previndex = -1;
            for (let a = 0; a < points.length; a++) {
                let point = points[a];
                this.pos.push(...point);
                this.color.push(...color);
                this.uvs.push(0, 0);
                this.normals.push(normx, normy, normz);
                let index = this.vertindex++;
                if (zeroindex == -1) {
                    zeroindex = index;
                } else if (previndex == -1) {
                    previndex = index
                } else {
                    this.index.push(zeroindex, previndex, index);
                    previndex = index;
                }
            }
            //bottom polygon
            zeroindex = -1;
            previndex = -1;
            for (let a = points.length - 1; a >= 0; a--) {
                let point = points[a];
                this.pos.push(...point);
                this.color.push(...color);
                this.uvs.push(0, 0);
                this.normals.push(-normx, -normy, -normz);
                let index = this.vertindex++;
                if (zeroindex == -1) {
                    zeroindex = index;
                } else if (previndex == -1) {
                    previndex = index
                } else {
                    this.index.push(zeroindex, previndex, index);
                    previndex = index;
                }
            }
        }
        return this;
    }
    convertSubmesh(matid: number): ModelData["meshes"][number] {
        return {
            attributes: {
                pos: new BufferAttribute(new Float32Array(this.pos), 3),
                color: new BufferAttribute(new Uint8Array(this.color), 3, true),
                texuvs: new BufferAttribute(new Float32Array(this.uvs), 2),
                normals: new BufferAttribute(new Float32Array(this.normals), 3)
            },
            indices: new BufferAttribute(new Uint16Array(this.index), 1),
            hasVertexAlpha: false,
            materialId: matid,
            needsNormalBlending: false,
        }
    }
    mat(mat: number) {
        return this.parent!.mat(mat);
    }
    convert() {
        return this.parent!.convert();
    }
}

function meshBuildersToModel(builders: Map<number, MeshBuilder>): ModelData {
    let miny = 0;
    let maxy = 0;

    let meshes: ModelMeshData[] = []
    builders.forEach((builder, mat) => {
        let mesh = builder.convertSubmesh(mat);
        meshes.push(mesh);
        let posattr = mesh.attributes.pos;
        for (let i = 0; i < posattr.count; i++) {
            let y = posattr.getY(i);
            miny = Math.min(miny, y);
            maxy = Math.max(maxy, y);
        }
    });

    return {
        miny, maxy,
        bonecount: 0,
        skincount: 0,
        meshes
    }
}

export class ModelBuilder {
    meshes = new Map<number, MeshBuilder>();

    mat(mat: number) {
        let mesh = this.meshes.get(mat);
        if (!mesh) {
            mesh = new MeshBuilder(this);
            this.meshes.set(mat, mesh);
        }
        return mesh;
    }
    convert() {
        return meshBuildersToModel(this.meshes);
    }
}

export const materialPreviewCube = new ModelBuilder()
    .mat(0).addCube(white, [0, 300, 0], [600, 600, 600])
    .convert();

export const paperWall = new ModelBuilder()
    .mat(0).addParallelogram(white, [-halftile, 0, halftile], [0, 2 * tile, 0], [0, 0, -tile])
    .mat(1).addParallelogram(red, [-halftile, 0, -halftile], [0, 2 * tile, 0], [0, 0, tile])
    .convert();

export const paperWallDiag = new ModelBuilder()
    .mat(0).addParallelogram(white, [halftile, 0, halftile], [0, 2 * tile, 0], [-tile, 0, -tile])
    .mat(1).addParallelogram(white, [-halftile, 0, -halftile], [0, 2 * tile, 0], [tile, 0, tile],)
    .convert();

export const paperRoof = new ModelBuilder()
    .mat(0).addParallelogram(white, [-halftile, 2 * tile, -halftile], [tile, 0, 0], [0, 0, tile])
    .convert();

export const topdown2dWallModels = generateTopdown2dWallModels();


function generateTopdown2dWallModels() {
    const thick = tile / 8;
    const height = 0;
    const wallvec: xyz = [0, height, 0];
    return {
        wall: new ModelBuilder().mat(0).addExtrusion(white, wallvec, [
            [-halftile, 0, -halftile],
            [-halftile, 0, halftile],
            [-halftile + thick, 0, halftile],
            [-halftile + thick, 0, -halftile]
        ]).convert(),
        shortcorner: new ModelBuilder().mat(0).addExtrusion(white, wallvec, [
            [-halftile, 0, halftile],
            [-halftile + thick, 0, halftile],
            [-halftile + thick, 0, halftile - thick],
            [-halftile, 0, halftile - thick]
        ]).convert(),
        longcorner: new ModelBuilder().mat(0).addExtrusion(white, wallvec, [
            [-halftile + thick, 0, halftile - thick],
            [-halftile + thick, 0, -halftile],
            [-halftile, 0, -halftile],
            [-halftile, 0, halftile],
            [halftile, 0, halftile],
            [halftile, 0, halftile - thick],
        ]).convert(),
        pillar: new ModelBuilder().mat(0).addExtrusion(white, wallvec, [
            [-halftile + thick, 0, halftile - thick],
            [-halftile + thick, 0, -halftile],
            [-halftile, 0, -halftile],
            [-halftile, 0, halftile],
            [halftile, 0, halftile],
            [halftile, 0, halftile - thick],
        ]).convert(),
        diagonal: new ModelBuilder().mat(0).addExtrusion(white, wallvec, [
            [-halftile, 0, halftile],
            [-halftile + thick, 0, halftile],
            [-halftile + thick, 0, halftile - thick],
            [-halftile, 0, halftile - thick]
        ]).convert(),
    }
}