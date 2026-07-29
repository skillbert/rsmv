export declare function initBzip2(): void;
export declare function createBzip2Stream(options?: {
    outputChunkSize?: number;
}): {
    push(data: Uint8Array): Uint8Array;
    pushTo(data: Uint8Array, onOutput: (chunk: Uint8Array) => void): void;
    finish(): Uint8Array;
    finishTo(onOutput: (chunk: Uint8Array) => void): void;
    close(): void;
    readonly done: boolean;
};
export declare function bzip2decompress(data: Uint8Array): Uint8Array;
