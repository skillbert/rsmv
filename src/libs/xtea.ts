
const ROUNDS = 32;
const DELTA = 0x9E3779B9;

export function simplexteadecrypt(data: Buffer, key: Uint32Array) {
    let res = Buffer.allocUnsafe(data.length);
    let index = 0;
    for (; index <= data.length - 8; index += 8) {
        let v0 = data.readUInt32BE(index + 0);
        let v1 = data.readUInt32BE(index + 4);
        var sum = (DELTA * ROUNDS) >>> 0;

        while (sum) {
            v1 -= (((v0 << 4) >>> 0 ^ (v0 >>> 5)) + v0) ^ (sum + key[(sum >> 11) & 3]);
            v1 = v1 >>> 0;
            sum = (sum - DELTA) >>> 0;
            v0 -= (((v1 << 4) >>> 0 ^ (v1 >>> 5)) + v1) ^ (sum + key[sum & 3]);
            v0 = v0 >>> 0;
        }
        res.writeUInt32BE(v0, index + 0);
        res.writeUInt32BE(v1, index + 4);
    }
    //any non-aligned footer bytes aren't encrypted
    data.copy(res, index, index, res.length);
    return res;
}