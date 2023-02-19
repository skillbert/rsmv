import { buildReference, ChunkParser, ChunkParserContainer, DecodeState, EncodeState, ResolvedReference, TypeDef } from "./opcode_reader";

type NewChunkParserContainer = ChunkParser & {
    resolveReference(name: string, childresolve: ResolvedReference): ResolvedReference,
}

type ChunkParserBuilder = (args: unknown[], refparent: NewChunkParserContainer, typedef: TypeDef) => ChunkParser




const numberTypes: Record<string, { read: (s: DecodeState) => number, write: (s: EncodeState, v: number) => void, min: number, max: number }> = {
    ubyte: {
        read(s) { let r = s.buffer.readUInt8(s.scan); s.scan += 1; return r; },
        write(s, v) { s.buffer.writeUInt8(v, s.scan); s.scan += 1; },
        min: 0, max: 255
    },
    byte: {
        read(s) { let r = s.buffer.readInt8(s.scan); s.scan += 1; return r; },
        write(s, v) { s.buffer.writeInt8(v, s.scan); s.scan += 1; },
        min: -128, max: 127
    },
    ushort: {
        read(s) { let r = s.buffer.readUInt16BE(s.scan); s.scan += 2; return r; },
        write(s, v) { s.buffer.writeUInt16BE(v, s.scan); s.scan += 2; },
        min: 0, max: 2 ** 16 - 1
    },
    short: {
        read(s) { let r = s.buffer.readInt16BE(s.scan); s.scan += 2; return r; },
        write(s, v) { s.buffer.writeInt16BE(v, s.scan); s.scan += 2; },
        min: -(2 ** 15), max: 2 ** 15 - 1
    },
    uint: {
        read(s) { let r = s.buffer.readUInt32BE(s.scan); s.scan += 4; return r; },
        write(s, v) { s.buffer.writeUInt32BE(v, s.scan); s.scan += 4; },
        min: 0, max: 2 ** 32 - 1
    },
    int: {
        read(s) { let r = s.buffer.readInt32BE(s.scan); s.scan += 4; return r; },
        write(s, v) { s.buffer.writeInt32BE(v, s.scan); s.scan += 4; },
        min: -(2 ** 31), max: 2 ** 31 - 1
    },
    varushort: {
        read(s) {
            let firstByte = s.buffer.readUInt8(s.scan++);
            if ((firstByte & 0x80) == 0) {
                return firstByte;
            }
            let secondByte = s.buffer.readUInt8(s.scan++);
            return ((firstByte & ~0x80) << 8) | secondByte;
        },
        write(s, v) {
            if (v < 0x80) {
                s.buffer.writeUInt8(v, s.scan);
                s.scan += 1;
            } else {
                s.buffer.writeUint16BE(v | 0x8000, s.scan);
                s.scan += 2;
            }
        },
        min: 0, max: 2 ** 15 - 1
    },
    varshort: {
        read(s) {
            let firstByte = s.buffer.readUInt8(s.scan++);
            if ((firstByte & 0x80) == 0) {
                //sign extend from 7nth bit (>> fills using 32th bit)
                return (firstByte << (32 - 7)) >> (32 - 7);
            }
            let secondByte = s.buffer.readUInt8(s.scan++);
            return ((((firstByte & ~0x80) << 8) | secondByte) << (32 - 15)) >> (32 - 15);
        },
        write(s, v) {
            if (v < 0x40 && v >= -0x40) {
                //zero-fill left most bits 31-7 by using unsigned right shift (>>>)
                s.buffer.writeUInt8((v << (32 - 7)) >>> (32 - 7), s.scan);
                s.scan += 1;
            } else {
                s.buffer.writeInt16BE(v | 0x8000, s.scan);
                s.scan += 2;
            }
        },
        min: -(2 ** 14), max: 2 ** 14 - 1
    },
    varuint: {
        read(s) {
            let firstWord = s.buffer.readUInt16BE(s.scan);
            s.scan += 2;
            if ((firstWord & 0x8000) == 0) {
                return firstWord;
            } else {
                let secondWord = s.buffer.readUInt8(s.scan);
                s.scan += 2;
                return ((firstWord & ~0x8000) << 16) | secondWord;
            }
        },
        write(s, v) {
            if (v < 0x8000) {
                s.buffer.writeUInt16BE(v, s.scan);
                s.scan += 2;
            } else {
                s.buffer.writeUint32BE(v | 0x80000000, s.scan);
                s.scan += 4;
            }
        },
        min: 0, max: 2 ** 31 - 1
    },
    varint: {
        read(s) {
            let firstWord = s.buffer.readUInt16BE(s.scan);
            s.scan += 2;
            if ((firstWord & 0x8000) == 0) {
                //sign extend from 7nth bit (>> fills using 32th bit)
                return (firstWord << (32 - 15)) >> (32 - 15);
            }
            let secondWord = s.buffer.readUInt16BE(s.scan);
            s.scan += 2;
            return ((((firstWord & ~0x8000) << 16) | secondWord) << (32 - 31)) >> (32 - 31);
        },
        write(s, v) {
            if (v < 0x4000 && v >= -0x4000) {
                //zero-fill leftmost bits 31-17
                s.buffer.writeUInt16BE((v << (32 - 17) >>> (32 - 17)), s.scan);
                s.scan += 2;
            } else {
                s.buffer.writeInt16BE(v | 0x800000, s.scan);
                s.scan += 4;
            }
        },
        min: -(2 ** 30), max: 2 ** 30 - 1
    }
}
