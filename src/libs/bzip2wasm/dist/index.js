const BZ_OK = 0;
const DEFAULT_STREAM_OUTPUT_CHUNK_SIZE = 256 * 1024;

import createCore from "./core.js";
import wasmBinary from "./core.wasm.js";

let mod;
let oneShotInputPtr = 0;
let oneShotInputCapacity = 0;
let oneShotOutPtrPtr = 0;
let oneShotOutLenPtr = 0;

export function initBzip2() {
    if (mod) {
        return;
    }

    mod = createCore({ wasmBinary });

    if (!mod || !mod._malloc || !mod._free || !mod._bz2_decompress_alloc || !mod._bz2_free || !mod.HEAPU8) {
        throw new Error("WASM runtime exports are incomplete");
    }
}

function ensureUint8Array(data) {
    if (!(data instanceof Uint8Array)) {
        throw new TypeError("data must be a Uint8Array");
    }
}

function readU32(ptr) {
    return (
        mod.HEAPU8[ptr] |
        (mod.HEAPU8[ptr + 1] << 8) |
        (mod.HEAPU8[ptr + 2] << 16) |
        (mod.HEAPU8[ptr + 3] << 24)
    ) >>> 0;
}

function concatChunks(chunks, totalLength) {
    const out = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function ensureOneShotInputCapacity(byteLength) {
    if (byteLength === 0) {
        return 0;
    }
    if (byteLength <= oneShotInputCapacity) {
        return oneShotInputPtr;
    }

    const nextCapacity = Math.max(byteLength, oneShotInputCapacity ? oneShotInputCapacity * 2 : 4096);
    const nextPtr = mod._malloc(nextCapacity);
    if (!nextPtr) {
        throw new Error("malloc failed for one-shot input buffer");
    }

    if (oneShotInputPtr) {
        mod._free(oneShotInputPtr);
    }

    oneShotInputPtr = nextPtr;
    oneShotInputCapacity = nextCapacity;
    return oneShotInputPtr;
}

function ensureOneShotScratch() {
    if (!oneShotOutPtrPtr) {
        oneShotOutPtrPtr = mod._malloc(4);
    }
    if (!oneShotOutLenPtr) {
        oneShotOutLenPtr = mod._malloc(4);
    }
    if (!oneShotOutPtrPtr || !oneShotOutLenPtr) {
        throw new Error("malloc failed for one-shot scratch buffers");
    }
}

export function createBzip2Stream(options = {}) {
    initBzip2();

    const outputChunkSize = options.outputChunkSize ?? DEFAULT_STREAM_OUTPUT_CHUNK_SIZE;
    if (!Number.isInteger(outputChunkSize) || outputChunkSize <= 0) {
        throw new TypeError("outputChunkSize must be a positive integer");
    }

    const statePtr = mod._bz2_stream_create();
    if (!statePtr) {
        throw new Error("failed to create bzip2 stream state");
    }

    const outputPtr = mod._malloc(outputChunkSize);
    const consumedPtr = mod._malloc(4);
    const writtenPtr = mod._malloc(4);
    const finishedPtr = mod._malloc(4);

    if (!outputPtr || !consumedPtr || !writtenPtr || !finishedPtr) {
        if (outputPtr) mod._free(outputPtr);
        if (consumedPtr) mod._free(consumedPtr);
        if (writtenPtr) mod._free(writtenPtr);
        if (finishedPtr) mod._free(finishedPtr);
        mod._bz2_stream_destroy(statePtr);
        throw new Error("malloc failed for stream buffers");
    }

    let closed = false;
    let done = false;
    let inputPtr = 0;
    let inputCapacity = 0;

    function ensureOpen() {
        if (closed) {
            throw new Error("stream is closed");
        }
    }

    function ensureInput(data) {
        if (!(data instanceof Uint8Array)) {
            throw new TypeError("data must be a Uint8Array");
        }
    }

    function close() {
        if (closed) {
            return;
        }
        closed = true;
        if (inputPtr) {
            mod._free(inputPtr);
            inputPtr = 0;
            inputCapacity = 0;
        }
        mod._free(outputPtr);
        mod._free(consumedPtr);
        mod._free(writtenPtr);
        mod._free(finishedPtr);
        mod._bz2_stream_destroy(statePtr);
    }

    function ensureInputBuffer(byteLength) {
        if (byteLength === 0) {
            return 0;
        }
        if (byteLength <= inputCapacity) {
            return inputPtr;
        }

        const nextCapacity = Math.max(byteLength, inputCapacity ? inputCapacity * 2 : 4096);
        const nextPtr = mod._malloc(nextCapacity);
        if (!nextPtr) {
            throw new Error("malloc failed for input chunk");
        }

        if (inputPtr) {
            mod._free(inputPtr);
        }

        inputPtr = nextPtr;
        inputCapacity = nextCapacity;
        return inputPtr;
    }

    function processChunk(data, onOutput) {
        ensureOpen();
        ensureInput(data);
        if (done) {
            throw new Error("stream already finished");
        }

        const inPtr = ensureInputBuffer(data.byteLength);
        if (data.byteLength > 0) {
            mod.HEAPU8.set(data, inPtr);
        }
        {
            let offset = 0;

            while (true) {
                const remaining = data.byteLength - offset;
                const rc = mod._bz2_stream_decompress(
                    statePtr,
                    inPtr ? inPtr + offset : 0,
                    remaining,
                    outputPtr,
                    outputChunkSize,
                    consumedPtr,
                    writtenPtr,
                    finishedPtr
                );

                if (rc !== BZ_OK) {
                    throw new Error(`bzip2 stream decompression failed: ${rc}`);
                }

                const consumed = readU32(consumedPtr);
                const written = readU32(writtenPtr);
                const finished = readU32(finishedPtr) === 1;

                if (written > 0) {
                    onOutput(mod.HEAPU8.subarray(outputPtr, outputPtr + written));
                }

                offset += consumed;
                if (finished) {
                    done = true;
                }

                const outputFull = written === outputChunkSize;
                if (finished) {
                    break;
                }
                if (offset >= data.byteLength && !outputFull) {
                    break;
                }
                if (consumed === 0 && !outputFull) {
                    break;
                }
            }
        }

    }

    function push(data) {
        const chunks = [];
        let total = 0;
        processChunk(data, (chunk) => {
            const outChunk = new Uint8Array(chunk.length);
            outChunk.set(chunk);
            chunks.push(outChunk);
            total += outChunk.length;
        });

        if (chunks.length === 0) {
            return new Uint8Array(0);
        }
        return concatChunks(chunks, total);
    }

    function pushTo(data, onOutput) {
        if (typeof onOutput !== "function") {
            throw new TypeError("onOutput must be a function");
        }
        processChunk(data, onOutput);
    }

    function finish() {
        ensureOpen();
        if (!done) {
            const out = push(new Uint8Array(0));
            if (!done) {
                throw new Error("stream did not reach BZ_STREAM_END");
            }
            return out;
        }
        return new Uint8Array(0);
    }

    function finishTo(onOutput) {
        if (typeof onOutput !== "function") {
            throw new TypeError("onOutput must be a function");
        }
        ensureOpen();
        if (!done) {
            pushTo(new Uint8Array(0), onOutput);
            if (!done) {
                throw new Error("stream did not reach BZ_STREAM_END");
            }
        }
    }

    return {
        push,
        pushTo,
        finish,
        finishTo,
        close,
        get done() {
            return done;
        }
    };
}

export function bzip2decompress(data) {
    ensureUint8Array(data);
    initBzip2();

    const inPtr = ensureOneShotInputCapacity(data.byteLength);
    ensureOneShotScratch();

    let outPtr = 0;
    try {
        if (data.byteLength > 0) {
            mod.HEAPU8.set(data, inPtr);
        }

        const rc = mod._bz2_decompress_alloc(inPtr, data.byteLength, oneShotOutPtrPtr, oneShotOutLenPtr);
        if (rc !== BZ_OK) {
            throw new Error(`bzip2 decompression failed: ${rc}`);
        }

        outPtr = readU32(oneShotOutPtrPtr);
        const outLen = readU32(oneShotOutLenPtr);
        const out = new Uint8Array(outLen);
        if (outLen > 0) {
            out.set(mod.HEAPU8.subarray(outPtr, outPtr + outLen));
        }
        return out;
    } finally {
        if (outPtr) {
            mod._bz2_free(outPtr);
        }
    }
}
