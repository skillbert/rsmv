import { MapRect, worldStride } from "../3d/mapsquare";
import { EngineCache } from "../3d/modeltothree";
import { ScriptFS, ScriptOutput } from "../scriptrunner";
import { depClasses, DepMeta } from "./dependencies";

export async function diffFileDependencyHash(output: ScriptOutput, outdir: ScriptFS, sourcea: EngineCache, sourceb: EngineCache, rootdepformat: string, depstring: string) {
    output.log("Loading dependency graphs...");
    let [depa, depb] = await Promise.all([
        sourcea.getDependencyGraph(),
        sourceb.getDependencyGraph(),
    ]);
    output.log("Dependency graphs loaded");


    let rootdeptype: string;
    let rootdepid: number | string;
    if (rootdepformat == "map") {
        let [xstr, zstr] = depstring.split(".");
        let x = parseInt(xstr);
        let z = parseInt(zstr);
        if (!isFinite(x) || !isFinite(z)) {
            throw new Error("Invalid map coordinate");
        }

        output.log(`Preloading dependencies for map square ${x}.${z}...`);
        let maprect: MapRect = { x, z, xsize: 1, zsize: 1 };
        await Promise.all([
            depa.preloadChunkDependencies({ area: maprect }),
            depb.preloadChunkDependencies({ area: maprect }),
        ]);
        output.log(`Dependencies for map square ${x}.${z} loaded`);
        rootdeptype = "mapsquare";
        rootdepid = z * worldStride + x;
    } else if (depClasses.includes(rootdepformat as any)) {
        rootdeptype = rootdepformat;
        rootdepid = parseInt(depstring);
    } else if (rootdepformat == "raw") {
        [rootdeptype, rootdepid] = depstring.split(":");
    } else {
        throw new Error("Invalid root dependency format");
    }

    let rootdep = `${rootdeptype}-${rootdepid}`;
    output.log(`Calculating dependency hashes for ${rootdep}...`);
    let hasha = depa.debugDependencyTree(rootdep);
    let hashb = depb.debugDependencyTree(rootdep);


    let comparedepkey = (a: DepMeta, b: DepMeta) => {
        let [atype, aid] = a.key.split("-");
        let [btype, bid] = b.key.split("-");
        return atype < btype ? -1 : atype > btype ? 1 : parseInt(aid) - parseInt(bid);
    }

    let expand = (left: DepMeta, right: DepMeta, indent: string, changesonly: boolean, outputlines: string[] = []) => {
        let treematch = left.treehash == right.treehash;
        let ownmatch = left.ownhash == right.ownhash;
        if (changesonly && treematch) { return outputlines; }
        outputlines.push(`${indent}${treematch ? " " : ownmatch ? "*" : "x"} ${left.key} (${left.ownhash} vs ${right.ownhash})`);
        let leftsorted = left.children.slice().sort(comparedepkey);
        let rightsorted = right.children.slice().sort(comparedepkey);
        for (let ileft = 0, iright = 0; ;) {
            let leftchild = leftsorted[ileft];
            let rightchild = rightsorted[iright];
            if (leftchild && rightchild && leftchild.key == rightchild.key) {
                expand(leftchild, rightchild, indent + "  ", changesonly, outputlines);
                ileft++;
                iright++;
            } else if (leftchild && (!rightchild || comparedepkey(leftchild, rightchild) < 0)) {
                outputlines.push(`${indent}  - ${leftchild.key} (${leftchild.ownhash})`);
                ileft++;
            } else if (rightchild && (!leftchild || comparedepkey(leftchild, rightchild) > 0)) {
                outputlines.push(`${indent}  + ${rightchild.key} (${rightchild.ownhash})`);
                iright++;
            } else {
                break;
            }
        }
        return outputlines;
    }
    let full = expand(hasha.root, hashb.root, "", false);
    let sparse = expand(hasha.root, hashb.root, "", true);

    await outdir.writeFile("tree.txt", full.join("\n"));
    await outdir.writeFile("diff.txt", sparse.join("\n"));

    output.log(`Done ${hasha.root.treehash == hashb.root.treehash ? "no differences found" : "differences found"} (${hasha.root.treehash}, ${hashb.root.treehash})`);
}