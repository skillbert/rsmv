import { interfaces } from "../../generated/interfaces";
import { RSModel } from "../3d/modelnodes";
import { EngineCache, ThreejsSceneCache } from "../3d/modeltothree";
import { expandSprite, parseSprite } from "../3d/sprite";
import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { makeImageData, pixelsToDataUrl } from "../imgutils";
import { parse } from "../opdecoder";
import { escapeHTML, rsmarkupToSafeHtml } from "../utils";
import { UiCameraParams, updateItemCamera } from "../viewer/scenenodes";
import { ThreeJsRenderer } from "../viewer/threejsrender";

type HTMLResult = string;
export type RsInterfaceElement = { el: HTMLElement, dispose: (() => void)[], rootcomps: RsInterfaceComponent[] };

type UiRenderContext = {
    source: CacheFileSource,
    sceneCache: ThreejsSceneCache | null,
    renderer: ThreeJsRenderer | null
}

export async function renderRsInterface<MODE extends "html" | "dom">(ctx: UiRenderContext, id: number, mode: MODE): Promise<MODE extends "html" ? HTMLResult : RsInterfaceElement> {
    let arch = await ctx.source.getArchiveById(cacheMajors.interfaces, id);

    let comps = new Map<number, RsInterfaceComponent>();

    for (let sub of arch) {
        try {
            comps.set(sub.fileid, new RsInterfaceComponent(parse.interfaces.read(sub.buffer, ctx.source), sub.fileid))
        } catch (e) {
            console.log(`failed to parse interface ${id}:${sub.fileid}`);
        }
    }

    for (let [id, comp] of comps) {
        if (comp.data.parentid != 0xffff) {
            let parent = comps.get(comp.data.parentid);
            if (!parent) {
                console.log("missing parent");
                continue;
            }
            parent.children.push(comp);
        }
    }

    let jsmodule = (comps: interfaces[]) => {
        let getcomp = (id: number) => comps[id];
        let click = (event: MouseEvent) => {
            console.log(getcomp(+(event.target as HTMLElement).dataset.compid!));
            event.stopPropagation();
        }
        return { getcomp, click };
    }

    let css = "";
    css += `html{color:white;font-size:12px;}\n`;
    css += ".rs-component{position:absolute;pointer-events:none;}\n";
    css += ".rs-image{width:100%;height:100%;}\n";
    css += ".rs-image--cover{background-size:100% 100%; background-repeat:no-repeat;}";
    css += ".rs-interface-container{position:absolute;top:0px;left:0px;right:0px;bottom:0px;display:flex;align-items:center;justify-content:center;}";
    css += ".rs-interface-container-sub{position:relative;outline:1px solid green;}";
    css += ".rs-model{position:absolute;top:0px;left:0px;width:100%;height:100%;}";
    css += ".rs-componentmeta{}";
    css += ".rs-componentmeta-children{padding-left:15px;}";

    let basewidth = 520;
    let baseheight = 340;

    if (mode == "html") {
        let html = "";
        for (let comp of comps.values()) {
            if (comp.data.parentid == 0xffff) {
                html += await comp.toHtml(ctx, "html");
            }
        }
        let doc = `<!DOCTYPE html>\n`;
        doc += `<html>\n`
        doc += `<head>\n`
        doc += `<style>\n`
        doc += css;
        doc += `</style>\n`
        doc += "<script>\n"
        doc += `var mod=(${jsmodule + ""})(${JSON.stringify(Object.fromEntries([...comps]))});\n`;
        doc += "</script>\n"
        doc += `</head>\n`
        doc += `<body>\n`
        doc += `<div class="rs-interface-container">\n`;
        doc += `<div style="width:${basewidth}px; height:${baseheight}px;">\n`
        doc += html;
        doc += `</div>\n`
        doc += `</div>\n`
        doc += `</body>\n`
        doc += `</html>\n`
        return doc as any;
    } else {
        let root = document.createElement("div");
        root.classList.add("rs-interface-container");
        let style = document.createElement("style");
        style.innerHTML = css;
        let container = document.createElement("div");
        container.classList.add("rs-interface-container-sub");
        container.style.width = basewidth + "px";
        container.style.height = baseheight + "px";
        root.appendChild(style);
        root.appendChild(container);
        let disposelist: (() => void)[] = [];

        let rootcomps: RsInterfaceComponent[] = [];
        for (let comp of comps.values()) {
            if (comp.data.parentid == 0xffff || !comps.has(comp.data.parentid)) {
                let sub = await comp.toHtml(ctx, "dom");
                disposelist.push(...sub.dispose);
                container.appendChild(sub.el);
                rootcomps.push(comp);
            }
        }
        globalThis.comp = rootcomps;//TODO remove
        return { el: root, dispose: disposelist, rootcomps } as RsInterfaceElement as any;
    }
}

function cssColor(col: number) {
    return `#${(col & 0xffffff).toString(16).padStart(6, "0")}`;
}

function cssPosition(data: interfaces) {
    let css = "";
    const defaulttranslate = "0px";
    let translatex = defaulttranslate;
    let translatey = defaulttranslate;

    if (data.aspectxtype == 0) {
        css += `left:${data.baseposx}px;`;
    } else if (data.aspectxtype == 1) {
        css += `left:50%;margin-left:${data.baseposx}px;`;
        translatex = "-50%";
    } else if (data.aspectxtype == 2) {
        css += `right:${data.baseposx}px;`;
    } else if (data.aspectxtype == 3) {
        css += `left:${data.baseposx * 100 / (1 << 14)};`;
    } else if (data.aspectxtype == 4) {
        css += `left:${50 + data.baseposx * 100 / (1 << 14)}%;`;
        translatex = "-50%";
    } else if (data.aspectxtype == 5) {
        css += `right:${data.baseposx * 100 / (1 << 14)}%;`;
    }

    if (data.aspectytype == 0) {
        css += `top:${data.baseposy}px;`;
    } else if (data.aspectytype == 1) {
        css += `top:50%;margin-top:${data.baseposy}px;`;
        translatey = "-50%";
    } else if (data.aspectytype == 2) {
        css += `bottom:${data.baseposy}px;`;
    } else if (data.aspectytype == 3) {
        css += `top:${data.baseposy * 100 / (1 << 14)};`;
    } else if (data.aspectytype == 4) {
        css += `top:${50 + data.baseposy * 100 / (1 << 14)}%;`;
        translatey = "-50%";
    } else if (data.aspectytype == 5) {
        css += `bottom:${data.baseposy * 100 / (1 << 14)}%;`;
    }

    if (translatex != defaulttranslate || translatey != defaulttranslate) {
        css += `translate:${translatex} ${translatey};`
    }

    //TODO components are bounded to their parents bounds
    return css;
}


function cssSize(data: interfaces) {
    let css = "";
    if (data.aspectwidthtype == 0) {
        css += `width:${data.basewidth}px;`;
    } else if (data.aspectwidthtype == 1) {
        css += `width:calc(100% - ${data.basewidth}px);`;
    } else if (data.aspectwidthtype == 2) {
        css += `width:${data.basewidth * 100 / (1 << 14)}%;`;
    }

    if (data.aspectheighttype == 0) {
        css += `height:${data.baseheight}px;`;
    } else if (data.aspectheighttype == 1) {
        css += `height:calc(100% - ${data.baseheight}px);`;
    } else if (data.aspectheighttype == 2) {
        css += `height:${data.baseheight * 100 / (1 << 14)}%;`;
    }

    return css;
}

export class RsInterfaceComponent {
    data: interfaces;
    parent: RsInterfaceComponent | null = null;
    children: RsInterfaceComponent[] = [];
    subid: number;
    constructor(interfacedata: interfaces, subid: number) {
        this.data = interfacedata;
        this.subid = subid;
    }

    async toHtml<MODE extends "dom" | "html">(ctx: UiRenderContext, mode: MODE): Promise<MODE extends "html" ? HTMLResult : RsInterfaceElement> {
        let style = "";
        let childhtml = "";
        let el = mode == "dom" ? document.createElement("div") : null;
        style += cssPosition(this.data);
        style += cssSize(this.data);
        let clickable = false;
        let disposelist: (() => void)[] = [];

        if (this.data.figuredata) {
            if (this.data.figuredata.filled) {
                style += `background:${cssColor(this.data.figuredata.color)};`;
                clickable = true;
            } else {
                style += `border:1px solid ${cssColor(this.data.figuredata.color)};`;
            }
        } else if (this.data.textdata) {
            clickable = true;
            style += "display:flex;";
            style += `color:${cssColor(this.data.textdata.color)};`;
            if (this.data.textdata.alignhor == 1) {
                style += `justify-content:center;`;
                style += `text-align:center;`;//need both here to support multi-line
            } else if (this.data.textdata.alignhor) {
                style += `justify-content:right;`;
                style += `text-align:right;`;
            }
            if (this.data.textdata.alignver == 1) {
                style += `align-items:center;`;
            } else if (this.data.textdata.alignver) {
                style += `align-items:bottom;`;
            }
            childhtml += rsmarkupToSafeHtml(this.data.textdata.text);
            clickable = true;
        } else if (this.data.containerdata) {
            for (let child of this.children) {
                if (mode == "html") {
                    childhtml += await child.toHtml(ctx, "html");
                } else {
                    let sub = await child.toHtml(ctx, "dom");
                    el!.appendChild(sub.el);
                    disposelist.push(...sub.dispose);
                }
            }
        } else if (this.data.spritedata) {
            if (this.data.spritedata.spriteid != -1) {
                let flags = this.data.spritedata.spriteid >> 24;
                if (flags != 0) { console.log("sprite flags", flags); }
                let spriteid = this.data.spritedata.spriteid & 0xffffff;
                let spritebuf = await ctx.source.getFileById(cacheMajors.sprites, spriteid);
                let img = expandSprite(parseSprite(spritebuf)[0]);
                let imgstyle = "";
                let pngfile = await pixelsToDataUrl(img);
                imgstyle += `background-image:url('${pngfile}');`;
                if ((this.data.spritedata.color & 0xffffff) != 0xffffff) {
                    imgstyle += `background-color:${cssColor(this.data.spritedata.color)};background-blend-mode:multiply;`;
                }
                if (this.data.spritedata.hflip || this.data.spritedata.vflip) {
                    //TODO this doesn't handle the alpha channel correctly
                    imgstyle += `scale:${this.data.spritedata.hflip ? -1 : 1} ${this.data.spritedata.vflip ? -1 : 1};`;
                }
                if (mode == "html") {
                    childhtml += `<div class="rs-image ${this.data.spritedata.flag2 ? "" : "rs-image--cover"}" style="${imgstyle}"></div>\n`;
                } else {
                    let img = document.createElement("div");
                    img.classList.add("rs-image");
                    if (!this.data.spritedata.flag2) { img.classList.add("rs-image--cover"); }
                    img.style.cssText = imgstyle;
                    el!.appendChild(img);
                }
                clickable = true;
            }
        } else if (this.data.modeldata) {
            let isplaceholder = this.data.modeldata.modelid == 0x7fff || this.data.modeldata.modelid == 0xffff;
            if (mode == "html" || isplaceholder || !ctx.sceneCache || !ctx.renderer) {
                style += "background:rgba(0,255,0,0.5);outline:blue;";
                childhtml += (isplaceholder ? "placeholder" : this.data.modeldata.modelid);
            } else {
                let camdata = this.data.modeldata.positiondata!;
                let camconfig: UiCameraParams = {
                    rotx: camdata.rotate_x,
                    roty: camdata.rotate_y,
                    rotz: camdata.rotate_z,
                    translatex: camdata.translate_x / 4,
                    translatey: camdata.translate_y / 4,
                    zoom: camdata.zoom * 8
                };
                let model = new RSModel(ctx.sceneCache, [{ modelid: this.data.modeldata.modelid, mods: {} }], `model_${this.data.modeldata.modelid}`);
                let canvas = document.createElement("canvas");
                canvas.classList.add("rs-model");
                let modelrender = ctx.renderer.makeUIRenderer(model.getSceneElements(), 0);
                let render = async () => {
                    let width = canvas.clientWidth;
                    let height = canvas.clientHeight;
                    if (width == 0 || height == 0) { return; }
                    let img = modelrender.takePicture(width, height, camconfig);
                    canvas.width = img.width;
                    canvas.height = img.height;
                    let ctx2d = canvas.getContext("2d")!;
                    ctx2d.putImageData(img, 0, 0);
                    if (animated && !animcb) {
                        requestAnimationFrame(render);
                    }
                }
                let animcb = 0;
                let animated = false;
                if (this.data.modeldata.animid != 0x7fff && this.data.modeldata.animid != 0xffff) {
                    model.setAnimation(this.data.modeldata.animid);
                    animated = true;
                }
                let observer = new ResizeObserver(render);
                observer.observe(canvas);
                disposelist.push(() => {
                    cancelAnimationFrame(animcb);
                    observer.disconnect();
                    modelrender.dispose();
                });
                model.model.then(render);
                el!.appendChild(canvas);
                (canvas as any).render = render;
            }
            clickable = true;
        } else {
            style += "background:rgba(0,128,128,0.5);outline:red;";
            clickable = true;
        }
        if (clickable) {
            style += "pointer-events:initial;";
        }
        let title = this.data.rightclickopts.filter(q => q).join("\n");

        if (mode == "html") {
            let html = "";
            html += `<div class="rs-component" data-compid=${this.subid} style="${style}" onclick="mod.click(event)" title="${escapeHTML(title)}">\n`;
            html += childhtml;
            html += "</div>\n";
            return html as HTMLResult as any;
        } else {
            (el as any).ui = this.data;
            el!.style.cssText = style;
            el!.insertAdjacentHTML("beforeend", childhtml);
            el!.classList.add("rs-component");
            if (title) { el!.title = title; }
            return {
                el,
                dispose: disposelist,
                rootcomps: [this]
            } as RsInterfaceElement as any;
        }
    }
}