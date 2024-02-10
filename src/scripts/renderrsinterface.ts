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
export type RsInterfaceElement = { el: HTMLElement, rootcomps: RsInterfaceComponent[] };

export class UiRenderContext {
    source: CacheFileSource;
    sceneCache: ThreejsSceneCache | null = null;
    renderer: ThreeJsRenderer | null = null;
    comps = new Map<number, HTMLElement>();
    highlightstack: HTMLElement[] = [];
    constructor(source: CacheFileSource) {
        this.source = source;
    }
    toggleHighLightComp(subid: number, highlight: boolean) {
        let comp = this.comps.get(subid);
        if (comp) {
            if (highlight) {
                if (this.highlightstack.length != 0) {
                    this.highlightstack.at(-1)!.classList.remove("rs-component--highlight");
                }
                comp.classList.add("rs-component--highlight");
                this.highlightstack.push(comp);
            } else {
                comp.classList.remove("rs-component--highlight");
                if (this.highlightstack.pop() != comp) {
                    console.log("wrong unlightlight order");
                }
                if (this.highlightstack.length != 0) {
                    this.highlightstack.at(-1)!.classList.add("rs-component--highlight");
                }
            }
        }
    }
}

function rsInterfaceStyleSheet() {
    let css = "";
    css += `html{color:white;font-size:12px;}\n`;
    css += ".rs-component{position:absolute;pointer-events:none;}\n";
    css += ".rs-component--highlight{outline:1px solid red;}\n";
    css += ".rs-image{width:100%;height:100%;}\n";
    css += ".rs-image--cover{background-size:100% 100%; background-repeat:no-repeat;}";
    css += ".rs-interface-container{position:absolute;top:0px;left:0px;right:0px;bottom:0px;display:flex;align-items:center;justify-content:center;}";
    css += ".rs-interface-container-sub{position:relative;outline:1px solid green;}";
    css += ".rs-model{position:absolute;top:0px;left:0px;width:100%;height:100%;}";
    css += ".rs-componentmeta{}";
    css += ".rs-componentmeta-children{padding-left:15px;}";
    return css;
}

function embeddedjsmodule(comps: interfaces[]) {
    let getcomp = (id: number) => comps[id];
    let click = (event: MouseEvent) => {
        console.log(getcomp(+(event.target as HTMLElement).dataset.compid!));
        event.stopPropagation();
    }
    return { getcomp, click };
}

export async function loadRsInterfaceData(ctx: UiRenderContext, id: number) {

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

    let rootcomps: RsInterfaceComponent[] = [];
    for (let comp of comps.values()) {
        if (comp.data.parentid == 0xffff || !comps.has(comp.data.parentid)) {
            rootcomps.push(comp);
        }
    }
    let basewidth = 520;
    let baseheight = 340;
    return { comps, rootcomps, basewidth, baseheight };
}

export async function renderRsInterfaceHTML(ctx: UiRenderContext, id: number): Promise<HTMLResult> {
    let { comps, rootcomps, basewidth, baseheight } = await loadRsInterfaceData(ctx, id);
    let html = "";
    for (let comp of rootcomps) {
        html += await comp.toHtmlllllll(ctx);
    }
    let doc = `<!DOCTYPE html>\n`;
    doc += `<html>\n`
    doc += `<head>\n`
    doc += `<style>\n`
    doc += rsInterfaceStyleSheet();
    doc += `</style>\n`
    doc += "<script>\n"
    doc += `var mod=(${embeddedjsmodule + ""})(${JSON.stringify(Object.fromEntries([...comps]))});\n`;
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
}

export function renderRsInterfaceDOM(ctx: UiRenderContext, data: Awaited<ReturnType<typeof loadRsInterfaceData>>) {
    let root = document.createElement("div");
    root.classList.add("rs-interface-container");
    let style = document.createElement("style");
    style.innerHTML = rsInterfaceStyleSheet();
    let container = document.createElement("div");
    container.classList.add("rs-interface-container-sub");
    container.style.width = data.basewidth + "px";
    container.style.height = data.baseheight + "px";
    root.appendChild(style);
    root.appendChild(container);

    ctx.comps.clear();//TODO dispose here?
    for (let comp of data.rootcomps) {
        let sub = comp.initDom(ctx);
        container.appendChild(sub);
    }
    globalThis.comp = data.rootcomps;//TODO remove
    globalThis.compctx = ctx;
    let dispose = () => {
        data.rootcomps.forEach(q => q.dispose());
    }
    return { el: root, rootcomps: data.rootcomps, dispose };
}

function cssColor(col: number) {
    return `#${(col & 0xffffff).toString(16).padStart(6, "0")}`;
}

//TODO move this to customm css vars with container filters
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
        css += `left:${data.baseposx * 100 / (1 << 14)}%;`;
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

function uiModelRenderer(renderer: ThreeJsRenderer, sceneCache: ThreejsSceneCache, camdata: (interfaces["modeldata"] & {})["positiondata"] & {}) {
    let camconfig: UiCameraParams = {
        rotx: camdata.rotate_x,
        roty: camdata.rotate_y,
        rotz: camdata.rotate_z,
        translatex: camdata.translate_x / 4,
        translatey: camdata.translate_y / 4,
        zoom: camdata.zoom * 8
    };
    let canvas = document.createElement("canvas");
    canvas.classList.add("rs-model");
    let modelrender = renderer.makeUIRenderer();
    let model: RSModel | null = null;
    let setmodel = (modelid: number) => {
        model = new RSModel(sceneCache, [{ modelid, mods: {} }], `model_${modelid}`);
        modelrender.setmodel(model.getSceneElements(), 0);
        model.model.then(render);
    }
    let render = () => {
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
    let setanim = (animid: number) => {
        if (animid == 0x7fff || animid == 0xffff) {
            animid = -1;//TODO move this check up somewhere into the json reader
        }
        model?.setAnimation(animid);
        animated = animid != -1;
        render();
    }

    let observer = new ResizeObserver(render);
    observer.observe(canvas);
    let dispose = () => {
        cancelAnimationFrame(animcb);
        animcb = 0;
        observer.disconnect();
        modelrender.dispose();
        canvas.remove();
    };
    (canvas as any).render = render;

    return { dispose, canvas, setmodel, setanim };
}

function spriteCss(spritedata: interfaces["spritedata"] & {}) {
    let imgstyle = "";
    if (spritedata.hflip || spritedata.vflip) {
        //TODO this doesn't handle the alpha channel correctly
        imgstyle += `scale:${spritedata.hflip ? -1 : 1} ${spritedata.vflip ? -1 : 1};`;
    }
    if ((spritedata.color & 0xffffff) != 0xffffff) {
        imgstyle += `background-color:${cssColor(spritedata.color)};background-blend-mode:multiply;`;
    }
    return imgstyle;
}

async function spritePromise(ctx: UiRenderContext, spriteid: number) {
    let actualid = spriteid & 0xffffff;
    let flags = spriteid >> 24;
    let imgcss = "none";
    if (actualid != -1) {
        if (flags != 0) { console.log("sprite flags", flags); }
        let spritebuf = await ctx.source.getFileById(cacheMajors.sprites, actualid);
        let img = expandSprite(parseSprite(spritebuf)[0]);
        let pngfile = await pixelsToDataUrl(img);
        imgcss = `url('${pngfile}')`;
    }
    return { imgcss, spriteid };
}

export class RsInterfaceComponent {
    data: interfaces;
    parent: RsInterfaceComponent | null = null;
    children: RsInterfaceComponent[] = [];
    subid: number;
    modelrenderer: ReturnType<typeof uiModelRenderer> | null = null;
    spriteChild: HTMLDivElement | null = null;
    loadingSprite = -1;
    element: HTMLElement | null = null;
    constructor(interfacedata: interfaces, subid: number) {
        this.data = interfacedata;
        this.subid = subid;
    }

    async toHtmlllllll(ctx: UiRenderContext) {
        let { style, title } = this.getStyle();
        let childhtml = "";
        for (let child of this.children) {
            childhtml += await child.toHtmlllllll(ctx);
        }
        if (this.data.textdata) {
            childhtml += rsmarkupToSafeHtml(this.data.textdata.text);
        }
        if (this.data.modeldata) {
            let isplaceholder = this.data.modeldata.modelid == 0x7fff || this.data.modeldata.modelid == 0xffff;
            style += "background:rgba(0,255,0,0.5);outline:blue;";
            childhtml += (isplaceholder ? "placeholder" : this.data.modeldata.modelid);
        }
        if (this.data.spritedata) {
            let spritecss = spriteCss(this.data.spritedata);
            let sprite = await spritePromise(ctx, this.data.spritedata.spriteid);
            spritecss += `background-image:${sprite.imgcss};`;
            childhtml += `<div class="rs-image${!this.data.spritedata.flag2 ? " rs-image--cover" : ""}" style="${escapeHTML(spritecss)}"></div>`;
        }
        let html = "";
        html += `<div class="rs-component" data-compid=${this.subid} style="${escapeHTML(style)}" onclick="mod.click(event)" title="${escapeHTML(title)}">\n`;
        html += childhtml;
        html += "</div>\n";
        return html as HTMLResult as any;
    }

    dispose() {
        this.modelrenderer?.dispose();
        this.element?.remove();
        this.children.forEach(q => q.dispose());
    }

    initDom(ctx: UiRenderContext) {
        let el = document.createElement("div");
        this.updateDom(ctx, el);
        this.children.forEach(child => {
            el.appendChild(child.initDom(ctx));
        });
        (el as any).ui = this.data;
        el.classList.add("rs-component");
        ctx.comps.set(this.subid, el);
        this.element = el;
        return el;
    }

    updateDom(ctx: UiRenderContext, el: HTMLDivElement) {
        let { style, title } = this.getStyle();
        if (this.data.modeldata) {
            let isplaceholder = this.data.modeldata.modelid == 0x7fff || this.data.modeldata.modelid == 0xffff;
            if (!isplaceholder && ctx.renderer && ctx.sceneCache) {
                this.modelrenderer ??= uiModelRenderer(ctx.renderer, ctx.sceneCache, this.data.modeldata.positiondata!);
                this.modelrenderer.setmodel(this.data.modeldata.modelid);
                this.modelrenderer.setanim(this.data.modeldata.animid);
                el.appendChild(this.modelrenderer.canvas);
            } else if (this.modelrenderer) {
                this.modelrenderer.dispose();
                this.modelrenderer = null;
                style += "background:rgba(0,255,0,0.5);outline:blue;";
                el.innerText = (isplaceholder ? "placeholder" : "");
            }
        }
        if (this.data.textdata) {
            el.insertAdjacentHTML("beforeend", rsmarkupToSafeHtml(this.data.textdata.text));
        }
        if (this.data.spritedata) {
            if (this.loadingSprite != this.data.spritedata.spriteid) {
                if (!this.spriteChild) {
                    this.spriteChild = document.createElement("div");
                    el.appendChild(this.spriteChild);
                    this.spriteChild.classList.add("rs-image");
                }
                this.spriteChild.style.cssText = spriteCss(this.data.spritedata);
                this.spriteChild.classList.toggle("rs-image--cover", !this.data.spritedata.flag2);
                spritePromise(ctx, this.data.spritedata.spriteid).then(({ imgcss, spriteid }) => {
                    if (this.spriteChild && spriteid == this.data.spritedata?.spriteid) {
                        this.spriteChild.style.backgroundImage = imgcss;
                    }
                });
                this.loadingSprite = this.data.spritedata.spriteid;
            }
        } else if (this.spriteChild) {
            this.spriteChild.remove();
            this.spriteChild = null;
        }
        el.style.cssText = style;
        el.title = title;
    }

    getStyle() {
        let style = "";
        let childhtml = "";
        style += cssPosition(this.data);
        style += cssSize(this.data);
        let clickable = false;

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
            clickable = true;
        } else if (this.data.containerdata) {
            //nothing
        } else if (this.data.spritedata) {
        } else if (this.data.modeldata) {
            clickable = true;
        } else {
            style += "background:rgba(0,128,128,0.5);outline:red;";
            clickable = true;
        }
        if (clickable) {
            style += "pointer-events:initial;";
        }
        let title = this.data.rightclickopts.filter(q => q).join("\n");

        return { title, style };
    }
}