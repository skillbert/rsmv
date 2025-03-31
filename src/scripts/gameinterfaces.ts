import { ScriptFS, ScriptOutput } from "../scriptrunner";
import { CacheFileSource } from "../cache";
import prettyJson from "json-stringify-pretty-compact";
import { getEnumInt, getEnumIntPairs, getEnumString, getStructInt, getStructString, loadEnum, loadParams, loadStruct } from "../clientscript/util";
import { structs } from "../../generated/structs";
import { cacheMajors } from "../constants";
import { expandSprite, parseSprite } from "../3d/sprite";
import { pixelsToImageFile } from "../imgutils";


type PanelSettings = {
    x: number,
    y: number,
    xmode: number,
    ymode: number,
    width: number,
    height: number,
    prevtab: number,
    nexttab: number,
    visible: boolean,
    // transparent?
};
type PanelMeta = {
    id: string,
    fixedwidth: boolean,
    fixedheight: boolean,
    defaultwidth: number,
    defaultheight: number,
    minimumwidth: number,
    minimumheight: number,
    ignorecollision: boolean,
    iconid: number,
    parentcomp: number,
    style: number,
    name: string
};

type GameData = {
    rootdefault: string,
    panelids: string[],
    panelcollisionorder: string[],
    defaultlayouts: Record<string, Record<string, PanelSettings>>,
    panelmeta: Record<string, PanelMeta>
}

export async function getGameInterfaces(output: ScriptOutput, outdir: ScriptFS, source: CacheFileSource) {
    let params = await loadParams(source);
    let imgids: number[] = [];
    // list of interfaces that the game iterates
    let panelids = getEnumIntPairs(await loadEnum(source, 7717)).map(q => "" + q[1]);
    let panelcollisionorder = getEnumIntPairs(await loadEnum(source, 7718)).map(q => "" + q[1]);
    let defaultlayoutsenum = await loadEnum(source, 7709)
    let layoutnames = await loadEnum(source, 7711);

    // hardcoded ref to layout 1 used to load default panel sizes
    let rootdefaultlayoutid = 1;
    let rootdefault: Record<number, PanelSettings> | null = null;
    let defaultlayouts: Record<string, Record<number, PanelSettings>> = {};
    for (let [layoutid, layoutstruct] of getEnumIntPairs(defaultlayoutsenum)) {
        let data: Record<number, PanelSettings> = {};
        let name = getEnumString(layoutnames, layoutid);
        if (!name || name == "null") { name = `default_${layoutid}` }
        defaultlayouts[name] = data;
        if (layoutid == rootdefaultlayoutid) { rootdefault = data; }

        let structs = getEnumIntPairs(await loadEnum(source, layoutstruct));
        for (let [ui, structid] of structs) {
            let struct = await loadStruct(source, structid);
            data[ui] = {
                x: getStructInt(params, struct, 3482),
                y: getStructInt(params, struct, 3483),
                xmode: getStructInt(params, struct, 3380),
                ymode: getStructInt(params, struct, 6832),
                width: getStructInt(params, struct, 3484),
                height: getStructInt(params, struct, 3485),
                prevtab: getStructInt(params, struct, 3486),
                nexttab: getStructInt(params, struct, 3487),
                visible: !!getStructInt(params, struct, 3488)
            }
        }
    }

    let panelstructsenum = await loadEnum(source, 7716);
    let panelmeta: Record<number, PanelMeta> = {};
    for (let panelid of panelids) {
        let def = rootdefault?.[panelid];
        let structid = getEnumInt(panelstructsenum, +panelid);
        if (structid == -1) { continue; }
        let struct: structs | null = await loadStruct(source, structid);
        let limitstructid = getStructInt(params, struct, 3494);
        let limitstruct = (limitstructid != -1 ? await loadStruct(source, limitstructid) : null);
        let sizeable = getStructInt(params, struct, 3527);
        let iconid = getStructInt(params, struct, 3495);
        imgids.push(iconid);
        // nonclosable 3523
        panelmeta[panelid] = {
            id: panelid,
            defaultwidth: def?.width ?? 0,
            defaultheight: def?.height ?? 0,
            minimumwidth: (limitstruct ? getStructInt(params, limitstruct, 3541) : def?.width ?? 0),
            minimumheight: (limitstruct ? getStructInt(params, limitstruct, 3542) : def?.height ?? 0),
            fixedwidth: !(sizeable & 2),
            fixedheight: !(sizeable & 1),
            iconid: iconid,
            parentcomp: getStructInt(params, struct, 3503),
            ignorecollision: !!getStructInt(params, struct, 3529),
            style: getStructInt(params, struct, 3518),
            name: getStructString(params, struct, 3493)
        } satisfies PanelMeta;
    }

    let res: GameData = {
        panelids,
        panelcollisionorder,
        defaultlayouts,
        rootdefault: Object.entries(defaultlayouts).find(q => q[1] == rootdefault)![0],
        panelmeta
    }

    await outdir.writeFile("interfaces.json", JSON.stringify(res));
    output.log("completed json");

    await outdir.mkDir("imgs");
    for (let id of imgids) {
        if ((id | 0) == -1) { continue; }
        let spritebuf = await source.getFileById(cacheMajors.sprites, id);
        let img = expandSprite(parseSprite(spritebuf)[0]);
        let imgfile = await pixelsToImageFile(img, "png", 1);
        await outdir.writeFile(`imgs/${id}.png`, imgfile);
    }
}
