
import * as React from "react";
import { CallbackCacheLoader } from "../../cache";
import { CanvasView, BlobImage, BlobAudio, CopyButton, useAwaited, DomWrap } from "../commoncontrols";
import { DecodeErrorJson } from "../../scripts/testdecode";
import prettyJson from "json-stringify-pretty-compact";
import { findParentElement } from "../../utils";
import { ParsedTexture } from "../../3d/materials/textures";
import { cacheFileJsonModes, parse } from "../../parser/jsondecoders";
import classNames from "classnames";
import { drawTexture } from "../../imgutils";
import { RsUIViewer } from "../viewers/rsuiviewer";
import { ClientScriptViewer } from "../viewers/cs2viewer";
import { RsFontViewer } from "../viewers/fontviewer";
import { StructView } from "../viewers/configview";
import { downloadBlob, UIOpenedFile } from "../maincomponents";


function bufToHexView(buf: Buffer) {
    let resulthex = "";
    let resultchrs = "";

    let linesize = 16;
    let groupsize = 8;

    outer: for (let lineindex = 0; ; lineindex += linesize) {
        if (lineindex != 0) {
            resulthex += "\n";
            resultchrs += "\n";
        }
        for (let groupindex = 0; groupindex < linesize; groupindex += groupsize) {
            if (groupindex != 0) {
                resulthex += "  ";
                resultchrs += " ";
            }
            for (let chrindex = 0; chrindex < groupsize; chrindex++) {
                let i = lineindex + groupindex + chrindex;
                if (i >= buf.length) { break outer; }
                let byte = buf[i];

                if (chrindex != 0) { resulthex += " "; }
                resulthex += byte.toString(16).padStart(2, "0");
                resultchrs += (byte < 0x20 ? "." : String.fromCharCode(byte));
            }
        }
    }
    return { resulthex, resultchrs };
}

function annotatedHexDom(data: Buffer, chunks: DecodeErrorJson["chunks"]) {
    let resulthex = "";
    let resultchrs = "";

    let linesize = 16;
    let groupsize = 8;

    let hexels = document.createDocumentFragment();
    let textels = document.createDocumentFragment();
    let labelel = document.createElement("span");
    let currentchunk: DecodeErrorJson["chunks"][number] | undefined = { offset: 0, len: 0, label: "start" };

    let mappedchunks: { chunk: DecodeErrorJson["chunks"][number], hexel: HTMLElement, textel: HTMLElement }[] = [];

    let hoverenter = (e: MouseEvent) => {
        let index = +(e.currentTarget as HTMLElement).dataset.index!;
        if (isNaN(index)) { return; }
        let chunk = mappedchunks[index];
        chunk.hexel.classList.add("mv-hex--select");
        chunk.textel.classList.add("mv-hex--select");
        labelel.innerText = `0x${chunk.chunk.offset.toString(16)} - ${chunk.chunk.len} ${index}\n${chunk.chunk.label}`;
    }
    let hoverleave = (e: MouseEvent) => {
        let index = +(e.currentTarget as HTMLElement).dataset.index!;
        if (isNaN(index)) { return; }
        let chunk = mappedchunks[index];
        chunk.hexel.classList.remove("mv-hex--select");
        chunk.textel.classList.remove("mv-hex--select");
        labelel.innerText = "";
    }

    let endchunk = () => {
        if (resulthex != "" && resultchrs != "") {
            let hexnode = document.createTextNode(resulthex);
            let textnode = document.createTextNode(resultchrs);
            if (currentchunk) {
                let index = mappedchunks.length;
                let hexspan = document.createElement("span");
                let textspan = document.createElement("span");
                hexspan.dataset.index = "" + index;
                textspan.dataset.index = "" + index;
                hexspan.onmouseenter = hoverenter;
                hexspan.onmouseleave = hoverleave;
                textspan.onmouseenter = hoverenter;
                textspan.onmouseleave = hoverleave;
                hexspan.appendChild(hexnode);
                textspan.appendChild(textnode);
                hexels.appendChild(hexspan);
                textels.appendChild(textspan);
                mappedchunks.push({ chunk: currentchunk, hexel: hexspan, textel: textspan });
            } else {
                hexels.appendChild(hexnode);
                textels.appendChild(textnode);
            }
        }
        currentchunk = undefined;
        resulthex = "";
        resultchrs = "";
    }

    for (let i = 0; i < data.length; i++) {
        let hexsep = (i == 0 ? "" : i % linesize == 0 ? "\n" : i % groupsize == 0 ? "  " : " ");
        let textsep = (i == 0 ? "" : i % linesize == 0 ? "\n" : i % groupsize == 0 ? " " : "");

        if (currentchunk && (i < currentchunk.offset || i >= currentchunk.offset + currentchunk.len)) {
            endchunk();
            //TODO yikes n^2, worst case currently is maptiles ~20k chunks
            currentchunk = chunks.find(q => q.offset <= i && q.offset + q.len > i);
        } else if (!currentchunk) {
            let newchunk = chunks.find(q => q.offset <= i && q.offset + q.len > i);
            if (newchunk) { endchunk() }
            currentchunk = newchunk;
        }

        let byte = data[i];
        resulthex += hexsep + byte.toString(16).padStart(2, "0");
        resultchrs += textsep + (byte < 0x20 ? "." : String.fromCharCode(byte));
    }
    endchunk();

    return { hexels, textels, labelel };
}

function UnknownFileViewer(p: { data: Buffer, ext: string }) {
    let finalext = p.ext.split(".").at(-1)!;
    let istext = ["json", "jsonc", "ts", "js", "txt"].includes(finalext);

    let [override, setoverride] = React.useState<{ ext: string, istext: boolean } | null>(null);

    if (override?.ext == p.ext) {
        istext = override.istext;
    }

    return (
        <React.Fragment>
            <input type="button" className="sub-btn" value={istext ? "View hex" : "View text"} onClick={e => setoverride({ ext: p.ext, istext: !istext })} />
            <CopyButton getText={() => istext ? p.data.toString("utf8") : p.data.toString("hex")} />
            {istext && <SimpleTextViewer file={p.data.toString("utf8")} />}
            {!istext && <TrivialHexViewer data={p.data} />}
        </React.Fragment>
    )
}

export function JsonViewer(p: { data?: string, json?: object, jsonmode: string }) {
    let [rawjson, setrawjson] = React.useState(false);

    let filetext = React.useMemo(() => {
        if (p.data) { return p.data; }
        if (p.json) { return JSON.stringify(p.json, null, 2); }
        return "";
    }, [p.data, p.json]);
    let parsed = React.useMemo(() => {
        if (rawjson) { return null; }
        let schema = cacheFileJsonModes[p.jsonmode as keyof typeof cacheFileJsonModes]?.parser.parser.getJsonSchema();
        let obj: any = null;
        let err = "";
        if (p.json) {
            obj = p.json;
        } else if (p.data) {
            try {
                obj = JSON.parse(p.data);
            } catch (e) {
                err = "" + e;
            }
        } else {
            err = "no data";
        }
        return { obj, err, schema }
    }, [p.data, p.json, p.jsonmode, rawjson]);

    React.useEffect(() => {
        globalThis.filejson = parsed?.obj;
        return () => { globalThis.filejson = null; }
    }, [parsed?.obj]);

    return (
        <React.Fragment>
            <input type="button" className="sub-btn" value={rawjson ? "View parsed" : "View raw"} onClick={e => setrawjson(!rawjson)} />
            <CopyButton text={filetext} />
            {!rawjson && <StructView data={parsed?.obj} meta={parsed?.schema} />}
            {rawjson && <SimpleTextViewer file={filetext} />}
        </React.Fragment>
    )
}


function TrivialHexViewer(p: { data: Buffer }) {
    let { resulthex, resultchrs } = bufToHexView(p.data);

    return (
        <table>
            <tbody>
                <tr>
                    <td className="mv-hexrow">{resulthex}</td>
                    <td className="mv-hexrow">{resultchrs}</td>
                </tr>
            </tbody>
        </table>
    )
}

function AnnotatedHexViewer(p: { data: Buffer, chunks: DecodeErrorJson["chunks"] }) {
    let { hexels, textels, labelel } = React.useMemo(() => annotatedHexDom(p.data, p.chunks), [p.data, p.chunks]);

    return (
        <table>
            <tbody>
                <tr>
                    <DomWrap tagName="td" el={hexels} className="mv-hexrow" />
                    <DomWrap tagName="td" el={textels} className="mv-hexrow" />
                    <td>
                        <DomWrap el={labelel} className="mv-hexlabel" />
                    </td>
                </tr>
            </tbody>
        </table>
    )
}

function FileDecodeErrorViewer(p: { file: string }) {
    let [mode, setmode] = React.useState("split" as "split" | "full");
    let [err, buffer] = React.useMemo(() => {
        let err: DecodeErrorJson = JSON.parse(p.file);
        let buffer = Buffer.from(err.originalFile, "hex");
        return [err, buffer];
    }, [p.file]);

    let clickstickylabel = (e: React.MouseEvent<HTMLElement>) => {
        let target = findParentElement(e.currentTarget, el => el.tagName == "TR");
        let scrollparent = findParentElement(e.currentTarget, el => ["auto", "scroll"].includes(window.getComputedStyle(el).overflowY));
        if (!target || !scrollparent) { return; }
        let scrollbounds = scrollparent.getBoundingClientRect();
        let bounds = target.getBoundingClientRect();
        let isbelow = (bounds.top + bounds.bottom) / 2 > (scrollbounds.top + scrollbounds.bottom) / 2;
        let margin = scrollbounds.height / 4
        scrollparent.scrollTop += (isbelow ? bounds.bottom - margin : bounds.top - scrollbounds.height + margin);
    }

    return (
        <div className="mv-hexrow">
            <div>
                <input type="button" className={classNames("sub-btn", { "active": mode == "split" })} onClick={e => setmode("split")} value="split" />
                <input type="button" className={classNames("sub-btn", { "active": mode == "full" })} onClick={e => setmode("full")} value="full" />
                <input type="button" className="sub-btn" onClick={e => downloadBlob("file.bin", new Blob([buffer], { type: "application/octet-stream" }))} value="download original" />
                <CopyButton getText={() => bufToHexView(buffer).resulthex} />
            </div>
            {err.error}
            {mode == "full" && (
                <AnnotatedHexViewer data={buffer} chunks={err.chunks} />
            )}
            {mode == "split" && (
                <React.Fragment>
                    <div>Chunks</div>
                    <table>
                        <tbody>
                            {err.chunks.map((q, i) => {
                                let hexview = bufToHexView(buffer.slice(q.offset, q.offset + q.len));
                                return (
                                    <tr key={q.offset + "-" + i}>
                                        <td>{hexview.resulthex}</td>
                                        <td>{hexview.resultchrs}</td>
                                        <td>{q.len > 16 * 20 ? <span className="mv-hexstickylabel" onClick={clickstickylabel}>{q.label}</span> : q.label}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </React.Fragment>
            )}
            <div>State</div>
            {prettyJson(err.state)}
        </div>
    );
}

function SimpleTextViewer(p: { file: string }) {
    return (
        <div className="mv-hexrow">
            {p.file}
        </div>
    );
}

export function FileDisplay(p: { file: UIOpenedFile }) {
    let el: React.ReactNode = null;
    let cnvref = React.useRef<HTMLCanvasElement | null>(null);
    let ext = (p.file.name.match(/\.([\w\.]+)$/i)?.[1] ?? "").toLowerCase();
    let fileBuffer = () => {
        return (typeof p.file.data == "string" ? Buffer.from(p.file.data, "utf8") : p.file.data);
    }
    let fileText = () => {
        return (typeof p.file.data == "string" ? p.file.data : p.file.data.toString("utf8"));
    }

    if (ext == "hexerr.json") {
        el = <FileDecodeErrorViewer file={fileText()} />;
    } else if (ext == "ui.json") {
        let uiinfo = JSON.parse(fileText());
        el = <RsUIViewer interfaceid={uiinfo.id} />
    } else if (ext == "font.json") {
        el = <RsFontViewer data={JSON.parse(fileText())} />
    } else if (ext == "cs2.json") {
        el = <ClientScriptViewer data={fileText()} />
    } else if (ext == "json") {
        let jsonmode = p.file.name.match(/^(\w+)\-/);
        el = <JsonViewer data={fileText()} jsonmode={jsonmode?.[1] ?? ""} />
    } else if (ext == "html") {
        el = <iframe srcDoc={fileText()} sandbox="allow-scripts" style={{ width: "95%", height: "95%" }} />;
    } else if (ext == "rstex") {
        let tex = new ParsedTexture(fileBuffer(), false, false);
        cnvref.current ??= document.createElement("canvas");
        const cnv = cnvref.current;
        tex.toWebgl().then(img => drawTexture(cnv.getContext("2d")!, img));
        el = <CanvasView canvas={cnvref.current} fillHeight={true} />;
    } else if (["png", "jpg", "jpeg", "webp", "svg"].includes(ext)) {
        el = <BlobImage file={fileBuffer()} ext={ext} fillHeight={true} />
    } else if (ext == "jaga" || ext == "ogg") {
        let buf = fileBuffer();
        let header = buf.readUint32BE(0);
        if (header == 0x4a414741) {//"JAGA"
            let parts = parse.audio.read(buf, new CallbackCacheLoader(() => { throw new Error("dummy cache") }, false));
            el = (
                <React.Fragment>
                    {parts.chunks.map((q, i) => (q.data ? <BlobAudio key={i} file={q.data} autoplay={i == 0} /> : <div key={i}>{q.fileid}</div>))}
                </React.Fragment>
            )
        } else if (header == 0x4f676753) {//"OggS"
            el = <BlobAudio file={fileBuffer()} autoplay={true} />
        } else {
            console.log("unexpected header", header, header.toString(16));
        }
    } else {
        el = <UnknownFileViewer data={fileBuffer()} ext={ext} />
    }
    return el;
}