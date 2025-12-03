import * as React from "react";
import { composeTexts, fontTextCanvas, ParsedFontJson } from "../scripts/fontmetrics";
import { CanvasView, CopyButton } from "./commoncontrols";

export function RsFontViewer(p: { data: ParsedFontJson }) {
    let [text, settext] = React.useState("The quick brown fox jumps over the lazy dog.");
    let [color, setcolor] = React.useState("#ffffff");
    let [shadow, setshadow] = React.useState(true);
    let [loaded, setloaded] = React.useState(false);
    //cache the sheet image
    let sheetimg = React.useMemo(() => {
        let img = new Image();
        img.src = p.data.sheet;
        setloaded(img.complete);
        img.decode().then(() => setloaded(true));
        return img;
    }, [p.data]);
    let [canvas, setcanvas] = React.useState<HTMLCanvasElement | null>(null);

    React.useEffect(() => {
        if (!loaded) { return; }
        let textcnv = fontTextCanvas(p.data, sheetimg, text, 1 / p.data.scale)
        // let textcnv = fontTextCanvas(p.data, sheetimg, text, 1)
        let composed = composeTexts(textcnv, color, shadow);
        setcanvas(composed);
    }, [p.data, text, color, shadow, loaded]);

    let ref = (el: HTMLDivElement) => {
        if (el) {
            el.replaceChildren(sheetimg);
        }
    }

    return (
        <div>
            <div style={{ marginBottom: "8px" }}>
                <textarea style={{ width: "100%", height: "80px", resize: "vertical" }} value={text} onChange={e => settext(e.currentTarget.value)} />
            </div>
            <div>
                Text Color
                <input type="color" value={color} onChange={e => setcolor(e.currentTarget.value)} style={{ width: "100px" }} />
            </div>
            <div>
                <label>
                    <input type="checkbox" checked={shadow} onChange={e => setshadow(e.currentTarget.checked)} />
                    Drop Shadow
                </label>
            </div>
            <CopyButton canvas={canvas ?? undefined} />
            <div style={{ maxWidth: "100%", overflow: "auto", display: "block" }}>
                <CanvasView canvas={canvas} fillHeight={true} />
            </div>
            <div ref={ref} />
        </div>
    )
}

