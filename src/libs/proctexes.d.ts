export class Texture {
    spriteIds: number[];
    textureIds: number[];
    ops: TextureOp[];
    colorOp: TextureOp;
    alphaOp: TextureOp;

    constructor(buf: Buffer);
    getPixels(width: number, height: number, group: TextureGroup, invgamma: number, columnMajor: boolean, flipHorizontal: boolean): number[];
}

export class Buffer {
    bytes: number[];
    position: number;
    constructor(bytes: number[]);
}

interface TextureGroup {
    getTexture(id: number): ImageData;
    getSprite(id: number): ImageData;
}

interface TextureOp {
    childOps: TextureOp[]
}