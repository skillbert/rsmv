import { BufferAttribute, Mesh } from "three"

export type ModelMeshData = {
    indices: BufferAttribute,
    vertexstart: number,//used when merging partial meshes
    vertexend: number,//used when merging partial meshes
    indexLODs: BufferAttribute[],
    materialId: number,
    hasVertexAlpha: boolean,
    needsNormalBlending: boolean,
    attributes: {
        pos: BufferAttribute,
        normals?: BufferAttribute,
        color?: BufferAttribute,
        texuvs?: BufferAttribute,
        //new skeletal animations
        skinids?: BufferAttribute,
        skinweights?: BufferAttribute,
        //old transform based animations
        boneids?: BufferAttribute,
        boneweights?: BufferAttribute
    }
}

export type ModelData = {
    maxy: number,
    miny: number,
    skincount: number,
    bonecount: number,
    meshes: ModelMeshData[],
    debugmeshes?: Mesh[]
}
