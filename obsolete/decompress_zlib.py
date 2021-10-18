import sys
import zlib

with open(sys.argv[1], "rb") as f:
    data = f.read()
    data = zlib.decompress(data)
    #data = zlib.decompressobj(32 + zlib.MAX_WBITS).decompress(data)
    with open(sys.argv[1] + ".bin", "wb") as output:
        output.write(data)