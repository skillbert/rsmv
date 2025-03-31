import * as React from "react";
import { clientscript } from "../../generated/clientscript";
import { ClientScriptInterpreter } from "../clientscript/interpreter";
import { getOpName } from "../clientscript/definitions";
import { useForceUpdate } from "./scriptsui";
import { ThreejsSceneCache } from "../3d/modeltothree";
import { prepareClientScript } from "../clientscript";
import { ClientscriptObfuscation } from "../clientscript/callibrator";

export function ClientScriptViewer(p: { data: string }) {
    let redraw = useForceUpdate();
    let [resetcounter, reset] = React.useReducer(c => c + 1, 0);
    let [calli, setcalli] = React.useState<ClientscriptObfuscation | null>(null);
    let scene: ThreejsSceneCache = globalThis.sceneCache;//TODO pass this properly using args
    React.useEffect(() => {
        let current = true;
        prepareClientScript(scene.engine).then(calli => current && setcalli(calli));
        return () => { current = false; }
    }, [resetcounter, calli]);
    let inter = React.useMemo(() => {
        if (!calli) { return null!; }//force non-null here to make typescript shut up about it being null in non-reachable callbacks
        let script: clientscript = JSON.parse(p.data);
        let inter = new ClientScriptInterpreter(calli);
        try {
            inter.callscript(script, -1);
        } catch (e) {
            console.log(e);
        }
        return inter;
    }, [calli, resetcounter, p.data]);

    if (!calli || !inter) {
        return (<div>Callibrating...</div>);
    }
    globalThis.inter = inter;

    let index = inter.scope?.index ?? 0
    let offset = Math.max(0, index - 10);
    let relevantops = inter.scope?.ops.slice(offset, inter.scope.index + 600) ?? [];

    return (
        <div style={{ position: "absolute", inset: "0px", display: "grid", gridTemplate: '"a" fit-content "b" 1fr / 1fr' }}>
            <div style={{ display: "grid", gridTemplate: '"a b c" / min-content 1fr 1fr' }}>
                <div>
                    <input type="button" className="sub-btn" value="restart" onClick={e => reset()} />
                    <input type="button" className="sub-btn" value="next" onClick={e => { inter.next(); redraw(); }} />
                </div>
                <div className="cs-valuegroup">
                    <div>{inter.intstack.map((q, i) => <IntValue key={i} index={i} inter={inter} type="stack" />)}</div>
                    <div>{inter.longstack.map((q, i) => <LongValue key={i} index={i} inter={inter} type="stack" />)}</div>
                    <div>{inter.stringstack.map((q, i) => <StringValue key={i} index={i} inter={inter} type="stack" />)}</div>
                </div>
                <div className="cs-valuegroup">
                    <div>{inter.scope?.localints.map((q, i) => <IntValue key={i} index={i} inter={inter} type="local" />)}</div>
                    <div>{inter.scope?.locallongs.map((q, i) => <LongValue key={i} index={i} inter={inter} type="local" />)}</div>
                    <div>{inter.scope?.localstrings.map((q, i) => <StringValue key={i} index={i} inter={inter} type="local" />)}</div>
                </div>
            </div>
            <div style={{ overflowY: "auto", whiteSpace: "pre" }}>
                {relevantops.map((q, i) => <div key={i + offset}>{i + offset == index ? ">>" : "  "}{i + offset} {getOpName(q.opcode)} {q.imm} {(q.imm_obj ?? "") + ""}</div>)}
            </div>
        </div>
    )
}

type ValueSlot = {
    inter: ClientScriptInterpreter,
    index: number,
    type: "stack" | "local"
}

function IntValue(p: ValueSlot) {
    let val = (p.type == "stack" ? p.inter.intstack[p.index] : p.inter.scope?.localints[p.index] ?? 0);
    return (
        <div className="cs2-value">
            int{p.index} = {val}
        </div>
    )
}
function LongValue(p: ValueSlot) {
    let val = (p.type == "stack" ? p.inter.longstack[p.index] : p.inter.scope?.locallongs[p.index] ?? 0n);
    return (
        <div className="cs2-value">
            long{p.index} = {val.toString()}
        </div>
    )
}
function StringValue(p: ValueSlot) {
    let val = (p.type == "stack" ? p.inter.stringstack[p.index] : p.inter.scope?.localstrings[p.index] ?? "");
    return (
        <div className="cs2-value">
            string{p.index} = &quot;{val}&quot;
        </div>
    )
}