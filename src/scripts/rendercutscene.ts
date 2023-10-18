import { cutscenes } from "../../generated/cutscenes";
import { parseSprite } from "../3d/sprite";
import { CacheFileSource } from "../cache";
import { cacheMajors } from "../constants";
import { pixelsToDataUrl } from "../imgutils";
import { crc32 } from "../libs/crc32util";
import { parse } from "../opdecoder";
import { escapeHTML } from "../utils";
import { parseMusic } from "./musictrack";

export async function renderCutscene(engine: CacheFileSource, file: Buffer) {
    let obj = parse.cutscenes.read(file, engine);
    let root = document.createElement("div");
    root.style.width = `${obj.width}px`;
    root.style.height = `${obj.height}px`;
    console.log(obj);

    // let uuid = "";
    // for (let i = 0; i < 8; i++) { uuid += String.fromCharCode("A".charCodeAt(0) + Math.random() * 26 | 0); }
    let uuid = `cutscene-${crc32(file) >>> 0}`;

    let css = "";
    let html = "";

    let endtime = obj.elements.reduce((a, v) => Math.max(a, v.end), 0);

    let timetopercent = (t: number) => `${Math.max(0, t / endtime * 100).toFixed(2)}%`;

    let imgcache = new Map<number, string>();

    let anim = function <T extends number[][]>(el: cutscenes["elements"][number], animname: string, frames: T, stylefn: (v: T[number]) => string) {
        css += `@keyframes ${animname}{\n`
        css += `  from{${stylefn(frames[0])}}\n`;
        css += frames.map(q => `  ${timetopercent(el.start + q[0])}{${stylefn(q)}}\n`).join("");
        css += `  to{${stylefn(frames.at(-1)!)}}\n`;
        css += `}\n`;
        return `${endtime}s infinite ${animname} linear`;
    }

    css += `.subtitle{\n`;
    css += `  position: absolute;\n`
    css += `  font-size: 50px;\n`
    css += `  bottom: 20px;\n`
    css += `  text-align: center;\n`
    css += `  color: white;\n`
    css += `  padding: 5px;\n`
    css += `  left: 20px;\n`
    css += `  right: 20px;\n`
    css += `  font-family: sans-serif;\n`;
    css += `  display:flex;\n`;
    css += `}\n`;
    css += `.subtitle>div{\n`;
    css += `  background:rgba(0,0,0,0.3);\n`;
    css += `  margin:0px auto;\n`;
    css += `  padding:12px;\n`;
    css += `  border-radius:20px;\n`;
    css += `}\n`;

    for (let i = obj.elements.length - 1; i >= 0; i--) {
        let el = obj.elements[i];
        let visibilityanim = `${uuid}-${i}-visibility`;
        css += `@keyframes ${visibilityanim}{\n`
        css += `  0%{visibility:hidden}\n`;
        css += `  ${timetopercent(el.start)}{visibility:visible}\n`
        css += `  ${timetopercent(el.end)}{visibility:hidden}\n`
        css += `}\n`;
        html += `<div style="animation:${endtime}s step-end infinite ${visibilityanim}">\n`;
        if (el.subtitle) {
            html += `<div class="subtitle"><div>${escapeHTML(el.subtitle)}</div></div>\n`;
        }
        if (el.soundid) {
            try {
                let file = await parseMusic(engine, cacheMajors.sounds, el.soundid, null, true);
                html += `<audio src="data:audio/ogg;base64,${file.toString("base64")}" data-timestart="${el.start}" data-timeend="${el.end}"></audio>\n`;
            } catch (e) {
                console.warn(`missing sound ${el.soundid} ${el.sound}`);
            }
        }
        if (el.graphics) {
            if (el.graphics.length != 0) {
                for (let imgindex = el.graphics.length - 1; imgindex >= 0; imgindex--) {
                    let img = el.graphics[imgindex]
                    let pngfile = imgcache.get(img.spriteid);
                    if (!pngfile) {
                        let spritebuf = await engine.getFileById(cacheMajors.sprites, img.spriteid);
                        pngfile = await pixelsToDataUrl(parseSprite(spritebuf)[0].img);
                        imgcache.set(img.spriteid, pngfile);
                    }

                    let anims: string[] = [];

                    if (img.opacityframes.length != 0) {
                        let animname = `${uuid}-${i}-${imgindex}-opacity`;
                        anims.push(anim(el, animname, img.opacityframes, v => `opacity:${v[1].toFixed(2)}`));
                    }
                    if (img.rotateframes.length != 0) {
                        let animname = `${uuid}-${i}-${imgindex}-rotate`;
                        anims.push(anim(el, animname, img.rotateframes, v => `rotate:${v[1].toFixed(2)}deg;`));
                    }
                    if (img.translateframes.length != 0) {
                        let animname = `${uuid}-${i}-${imgindex}-translate`;
                        anims.push(anim(el, animname, img.translateframes, v => `translate:${v[1].toFixed(2)}px ${v[2].toFixed(2)}px`));
                    }
                    if (img.scaleframes.length != 0) {
                        let animname = `${uuid}-${i}-${imgindex}-scale`;
                        anims.push(anim(el, animname, img.scaleframes, v => `scale:${v[1].toFixed(3)} ${v[2].toFixed(2)};`));
                    }

                    let positionstyle = `position:absolute; top:0px; left:0px; transform-origin:center;margin-left:${-img.width / 2}px; margin-top:${-img.height / 2}px;`;
                    html += `<img src="${pngfile}" width="${img.width}" height="${img.height}" style="${positionstyle} animation:${anims.join()};">\n`;
                }
            }
            html += "</div>";
        }
    }

    function embeddedModule(endtime: number) {
        console.log("module init");
        let lastseektime = 0;
        let lastseektimestamp = Date.now();
        let lastplayrate = 1;
        let endtimeout = 0;

        function getTime() {
            return lastseektime + (Date.now() - lastseektimestamp) / 1000 * lastplayrate;
        }

        function onRangeChange(e: InputEvent) {
            let time = (e.currentTarget as HTMLInputElement).valueAsNumber;
            seek(time, 0);
        }

        function play() {
            seek(getTime(), 1);
        }
        function pause() {
            seek(getTime(), 0);
        }

        function seek(time: number, playbackRate = 1) {
            lastseektime = time;
            lastplayrate = playbackRate;
            lastseektimestamp = Date.now();

            if (endtimeout) {
                clearTimeout(endtimeout);
                endtimeout = 0;
            }
            if (playbackRate != 0) {
                let timeleft = (endtime - time / playbackRate) * 1000;
                endtimeout = +setTimeout(() => { seek(0, playbackRate); }, timeleft)
            }

            //fix css anims
            let anims = document.getAnimations();
            for (let anim of anims) {
                anim.currentTime = 1000 * time;
                anim.playbackRate = playbackRate;
                if (playbackRate != 0) {
                    anim.play();
                } else {
                    anim.pause();
                }
            }

            //fix audio
            let audios = Array.from(document.querySelectorAll("audio"));
            for (let audio of audios) {
                let reltime = time - +(audio.dataset.timestart ?? 0);
                if (audio.dataset.delaytimer) {
                    clearTimeout(+audio.dataset.delaytimer);
                    audio.dataset.delaytimer = undefined;
                }
                if (playbackRate != 0) {
                    audio.playbackRate = playbackRate;
                    if (reltime < 0) {
                        audio.dataset.delaytimer = "" + +setTimeout(() => { audio.currentTime = 0; audio.play() }, -reltime / playbackRate * 1000);
                    } else {
                        audio.currentTime = reltime;
                        audio.play();
                    }
                } else {
                    audio.pause();
                }
            }
        }

        return { seek, play, pause, onRangeChange };
    }

    let doc = `<!DOCTYPE html>\n`;
    doc += `<html>\n`
    doc += `<head>\n`
    doc += `<style>\n`
    doc += css;
    doc += `</style>\n`
    doc += `</head>\n`
    doc += `<body>\n`
    doc += `<input type="range" min="0" max="${endtime}" step="0.01" style="width:400px;" oninput="controls.onRangeChange(event)">\n`
    doc += `<input type="button" value="play" onclick="controls.play()">\n`;
    doc += `<input type="button" value="pause" onclick="controls.pause()">\n`;
    doc += `<div style="position:relative; width:${obj.width}px; height:${obj.height}px; overflow:hidden; zoom:0.5;">\n`
    doc += html;
    doc += `</div>\n`
    doc += `<script>\n`
    doc += `var controls=(${embeddedModule})(${endtime});\n`;
    doc += `controls.play()\n`;
    doc += `</script>\n`
    // doc += `<script>initAudio();</script>\n`;
    doc += `</body>\n`
    doc += `</html>\n`

    return { html, css, doc };
}