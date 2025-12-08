import { parseSprite, spriteHash } from "../3d/sprite";
import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { pixelsToDataUrl, sliceImage } from "../imgutils";
import { parse } from "../opdecoder";

export type FontCharacterJson = {
    chr: string,
    charcode: number,
    x: number,
    y: number,
    width: number,
    height: number,
    bearingy: number,
    hash: number
}

export type ParsedFontJson = {
    fontid: number,
    spriteid: number,
    characters: (FontCharacterJson | null)[],
    median: number,
    baseline: number,
    maxascent: number,
    maxdescent: number,
    scale: number,
    sheethash: number,
    sheetwidth: number,
    sheetheight: number,
    sheet: string
}

export async function loadFontMetrics(cache: CacheFileSource, buf: Buffer, fontid: number) {
    let fontdata = parse.fontmetrics.read(buf, cache);

    if (!fontdata.sprite) {
        throw new Error("fontmetrics missing sprite data");
    }
    let sprite = await cache.getFileById(cacheMajors.sprites, fontdata.sprite.sourceid);
    let imgs = parseSprite(sprite);
    if (imgs.length != 1) {
        throw new Error("fontmetrics sprite did not contain exactly 1 image");
    }
    let img = imgs[0];
    if (img.fullwidth != fontdata.sprite.sheetwidth || img.fullheight != fontdata.sprite.sheetheight) {
        throw new Error("fontmetrics sprite image dimensions do not match metadata");
    }

    let font: ParsedFontJson = {
        fontid: fontid,
        spriteid: fontdata.sprite.sourceid,
        characters: [],
        median: fontdata.sprite.median,
        baseline: fontdata.sprite.baseline,
        maxascent: fontdata.sprite.maxascent,
        maxdescent: fontdata.sprite.maxdescent,
        scale: fontdata.sprite.scale,
        sheethash: spriteHash(img.img),
        sheetwidth: fontdata.sprite.sheetwidth,
        sheetheight: fontdata.sprite.sheetheight,
        // sheet: await pixelsToDataUrl(img.img)
        sheet: ""
    };
    for (let i = 0; i < fontdata.sprite.positions.length; i++) {
        let pos = fontdata.sprite.positions[i];
        let size = fontdata.sprite.chars[i];
        if (size.width === 0 || size.height === 0) {
            font.characters.push(null);
            continue;
        }
        let subimg = sliceImage(img.img, { x: pos.x, y: pos.y, width: size.width, height: size.height });
        font.characters.push({
            chr: String.fromCharCode(i),
            charcode: i,
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
            bearingy: size.bearingy,
            hash: spriteHash(subimg)
        });
    }
    return font;
}

export function measureFontText(font: ParsedFontJson, text: string) {
    let width = 0;
    let height = font.baseline + font.maxdescent;
    let x = 0;

    for (let i = 0; i < text.length; i++) {
        if (text[i] == "\n") {
            height += font.baseline;
            x = 0;
            continue;
        }
        let fontchar = font.characters[text.charCodeAt(i)];
        if (fontchar) {
            x += fontchar.width;
            width = Math.max(width, x);
        }
    }
    return { width, height };
}

export function fontTextCanvas(font: ParsedFontJson, sheet: HTMLImageElement, text: string, scale: number) {
    let { width, height } = measureFontText(font, text);
    let canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width * scale);
    canvas.height = Math.max(1, height * scale);
    let ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    let x = 0;
    let y = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] == "\n") {
            y += font.baseline;
            x = 0;
            continue;
        }
        let fontchar = font.characters[text.charCodeAt(i)];
        if (fontchar) {
            let dy = fontchar.bearingy;
            ctx.drawImage(sheet, fontchar.x, fontchar.y, fontchar.width, fontchar.height, x, y + dy, fontchar.width, fontchar.height);
            x += fontchar.width;
        }
    }
    return canvas;
}

export function composeTexts(cnv: HTMLCanvasElement, color: string, shadow: boolean) {
    let tmp = document.createElement("canvas");

    tmp.width = cnv.width + (shadow ? 1 : 0);
    tmp.height = cnv.height + (shadow ? 1 : 0);

    // gotto do some sorcery to colorize the font while preserving alpha because canvas "multiply" messes with alpha
    let ctx = tmp.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(cnv, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(cnv, 0, 0);

    if (shadow) {
        ctx.filter = "drop-shadow(1px 1px 0px black)";
        ctx.globalCompositeOperation = "copy";
        ctx.drawImage(tmp, 0, 0);
    }

    return tmp;
}
