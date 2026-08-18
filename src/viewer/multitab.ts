import { WasmGameCacheLoader } from "../cache/sqlitewasm";
import { delay } from "../utils";
import { UIContext } from "./maincomponents";



type MultitabMessage = {
    type: "getblobs",
    sourceIdentifier: string
} | {
    type: "return",
    channelid: number,
    reqid: number,
    data: any
}

export function multitabManager(ctx: UIContext) {

    let channel = new BroadcastChannel("rsmv-multitab");

    let callbacks = new Map<number, PromiseWithResolvers<any>>();

    let packetidcounter = 1;
    let channelid = Math.floor(Math.random() * 1000000);

    channel.addEventListener("message", e => {
        let packetid = e.data.id as number;
        let fromchannel = e.data.channelid as number;
        let packet = e.data.data as MultitabMessage;
        if (packet.type == "getblobs") {
            console.log("multitab: request for blobs from sourceIdentifier", packet.sourceIdentifier);
            if (ctx.source instanceof WasmGameCacheLoader && ctx.sourceIdentifier == packet.sourceIdentifier) {
                broadcast({
                    type: "return",
                    channelid: fromchannel,
                    reqid: packetid,
                    data: Object.fromEntries(ctx.source.dbfiles.values().map(q => [q.file.name, q.file]))
                });
            }
        }
        if (packet.type == "return") {
            if (packet.channelid == channelid) {
                let prom = callbacks.get(packet.reqid);
                if (prom) {
                    prom.resolve(packet.data);
                    callbacks.delete(packet.reqid);
                }
                //there might be multiple responses, let them race for now
            }
        }
    });

    let broadcast = (msg: MultitabMessage) => {
        let packetid = packetidcounter++;
        channel.postMessage({ id: packetid, channelid: channelid, data: msg });
        return packetid;
    }

    let makeReq = <T>(msg: MultitabMessage, timeout = 200) => {
        let prom = Promise.withResolvers<T>();
        let packetid = broadcast(msg);
        callbacks.set(packetid, prom);
        return Promise.race([
            prom.promise,
            delay(timeout).then(q => null)
        ]);
    };

    let close = () => {
        channel.close();
    }

    let findblobs = async (sourceIdentifier: string) => {
        console.log("multitab: requesting blobs for sourceIdentifier", sourceIdentifier);
        return makeReq<Record<string, File>>({ type: "getblobs", sourceIdentifier });
    }

    return { close, findblobs };
}