// somehow this isn't imported passively anymore in typescript 6
import "wicg-file-system-access"

export { };
    
declare global {
    // webpack
    const __non_webpack_require__: NodeRequire;
}