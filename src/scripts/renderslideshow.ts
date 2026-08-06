import { cutscenes } from "../../generated/cutscenes";
import { dbrows } from "../../generated/dbrows";
import { CacheFileSource } from "../cache";
import { renderCutscene } from "./rendercutscene";


export async function renderSlideshow(source: CacheFileSource, dbrow: dbrows) {
    let imagetable = dbrow.rows?.columndata.find(q => q.columnid == 3)!;

    let scenes: cutscenes["elements"] = [];

    let framewidth = 1920;
    let frameheight = 1080;

    let duration = 0;
    for (let row of imagetable.rows) {
        let spriteid = row[0] as number;
        let text = row[1] as string;
        let soundid = row[2] as number;
        let durationticks = row[3] as number;

        let frameduration = durationticks / 50;

        scenes.push({
            name: text,
            start: duration,
            end: duration + frameduration,
            flag1: 0,
            graphics: [{
                unk: 0,
                spritename: `sprite-${spriteid}`,
                width: framewidth,
                height: frameheight,
                opacityframes: [],
                rotateframes: [],
                translateframes: [[0, framewidth / 2, frameheight / 2]],
                scaleframes: [],
                spriteid: spriteid,
            }],
            hassubtitle: 1,
            subtitle: text,
            sound: `sound_${soundid}`,
            numgraphics: 1,
            soundid: soundid,
            subtitleid: 0,
            subtitletimes: {
                start: duration,
                end: duration + frameduration,
            },
            unkbyte: 0,
        });
        duration += frameduration;
    }

    let res: cutscenes = {
        version: 1,
        width: framewidth,
        height: frameheight,
        elements: scenes,
        unkhead: 0,
        paddingbytes: new Uint8Array(0),
    };


    return renderCutscene(source, res, Math.floor(Math.random() * 0xFFFFFF));
}