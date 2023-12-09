import { interfaces } from "../../generated/interfaces";
import { RSModel } from "../3d/modelnodes";
import { EngineCache, ThreejsSceneCache } from "../3d/modeltothree";
import { expandSprite, parseSprite } from "../3d/sprite";
import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { makeImageData, pixelsToDataUrl } from "../imgutils";
import { parse } from "../opdecoder";
import { escapeHTML, rsmarkupToSafeHtml } from "../utils";
import { updateItemCamera } from "../viewer/scenenodes";
import { ThreeJsRenderer } from "../viewer/threejsrender";

type HTMLResult = string;
export type RsInterfaceElement = { el: HTMLElement, dispose: (() => void)[] };


export async function renderRsInterface<MODE extends "html" | "dom">(source: CacheFileSource, scene: ThreejsSceneCache | null, id: number, mode: MODE): Promise<MODE extends "html" ? HTMLResult : RsInterfaceElement> {
    let arch = await source.getArchiveById(cacheMajors.interfaces, id);

    let comps = arch.map(q => new RsInterfaceComponent(parse.interfaces.read(q.buffer, source), q.fileid));

    for (let comp of comps) {
        if (comp.data.parentid != 0xffff) {
            let parent = comps[comp.data.parentid];
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

    let basewidth = 520;
    let baseheight = 340;

    if (mode == "html") {
        let html = "";
        for (let comp of comps) {
            if (comp.data.parentid == 0xffff) {
                html += await comp.toHtml(source, scene, "html");
            }
        }
        let doc = `<!DOCTYPE html>\n`;
        doc += `<html>\n`
        doc += `<head>\n`
        doc += `<style>\n`
        doc += css;
        doc += `</style>\n`
        doc += "<script>\n"
        doc += `var mod=(${jsmodule + ""})(${JSON.stringify(comps.map(q => q.data))});\n`;
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

        for (let comp of comps) {
            if (comp.data.parentid == 0xffff) {
                let sub = await comp.toHtml(source, scene, "dom");
                disposelist.push(...sub.dispose);
                container.appendChild(sub.el);
            }
        }
        return { el: root, dispose: disposelist } as RsInterfaceElement as any;
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

class RsInterfaceComponent {
    data: interfaces;
    parent: RsInterfaceComponent | null = null;
    children: RsInterfaceComponent[] = [];
    subid: number;
    constructor(interfacedata: interfaces, subid: number) {
        this.data = interfacedata;
        this.subid = subid;
    }

    async toHtml<MODE extends "dom" | "html">(source: CacheFileSource, scene: ThreejsSceneCache | null, mode: MODE): Promise<MODE extends "html" ? HTMLResult : RsInterfaceElement> {
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
                    childhtml += await child.toHtml(source, scene, "html");
                } else {
                    let sub = await child.toHtml(source, scene, "dom")
                    el!.appendChild(sub.el);
                    disposelist.push(...sub.dispose);
                }
            }
        } else if (this.data.spritedata) {
            if (this.data.spritedata.spriteid != -1) {
                let flags = this.data.spritedata.spriteid >> 24;
                if (flags != 0) { console.log("sprite flags", flags); }
                let spriteid = this.data.spritedata.spriteid & 0xffffff;
                let spritebuf = await source.getFileById(cacheMajors.sprites, spriteid);
                let img = expandSprite(parseSprite(spritebuf)[0]);
                let imgstyle = "";
                let pngfile = await pixelsToDataUrl(img);
                imgstyle += `background-image:url('${pngfile}');`;
                if (this.data.spritedata.hflip || this.data.spritedata.vflip) {
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
            if (mode == "html" || !scene) {
                style += "background:rgba(0,255,0,0.5);outline:blue;";
                childhtml += this.data.modeldata.modelid;
            } else {
                let canvas = document.createElement("canvas");
                canvas.classList.add("rs-model");
                canvas.dataset.modelid = "" + this.data.modeldata.modelid;
                canvas.dataset.animid = "" + this.data.modeldata.animid;
                let render = new ThreeJsRenderer(canvas, { alpha: true, antialias: true });
                let model = new RSModel(scene, [{ modelid: this.data.modeldata.modelid, mods: {} }], `model_${this.data.modeldata.modelid}`);
                //TODO proper -1 conversion in perser
                if (this.data.modeldata.animid != 0xffff && this.data.modeldata.animid != 0x7fff) {
                    model.setAnimation(this.data.modeldata.animid);
                }
                render.addSceneElement(model);
                render.addSceneElement({ getSceneElements() { return { options: { hideFloor: true, camMode: "item" } } } });
                let camdata = this.data.modeldata.positiondata!;
                updateItemCamera(render, 0, camdata.translate_x / 4, camdata.translate_y / 4, camdata.rotate_x, camdata.rotate_y, camdata.rotate_z, camdata.zoom * 8);
                el!.appendChild(canvas);
                disposelist.push(() => render.dispose());
            }
            clickable = true;
        } else {
            style += "background:rgba(0,128,128,0.5);outline:red;";
            clickable = true;
        }
        if (clickable) {
            style += "pointer-events:initial;";
        }
        let title = this.data.rightclickopts.join("\n");

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
            } as RsInterfaceElement as any;
        }
    }
}