import React from "react";
import { UIEngineContext } from "../maincomponents";
import { hex2hsl, hsl2hex, HSL2packHSL, HSL2RGB, packedHSL2HSL, RGB2HSL } from "../../utils";
import { LookupModeProps } from "../scenenodes";
import { appearanceUrl, avatarStringToBytes, bytesToAvatarString, EquipCustomization, EquipSlot, slotNames, slotToKitFemale, slotToKitMale, writeAvatar } from "../../3d/scene/avatar";
import { playerDataToModel } from "../../3d/scene";
import { avataroverrides } from "../../../generated/avataroverrides";
import { CopyButton, InputCommitted, LabeledInput, StringInput, useForceUpdate } from "../commoncontrols";
import classNames from "classnames";
import { selectEntity } from "../jsonsearch";
import { useAsyncModelData } from "./simplemodes";

export function ScenePlayer(p: LookupModeProps) {
    const ctx = React.useContext(UIEngineContext);
    const [data, model, id, setId] = useAsyncModelData(ctx, playerDataToModel);
    const [errtext, seterrtext] = React.useState("");
    const forceUpdate = useForceUpdate();

    const player = id?.player ?? (p.initialId && typeof p.initialId == "object" && typeof (p.initialId as any).player == "string" ? (p.initialId as any).player : "");
    const head = id?.head ?? (p.initialId && typeof p.initialId == "object" && typeof (p.initialId as any).head == "boolean" ? (p.initialId as any).head : false);

    const oncheck = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (id) { setId({ player: id.player, data: id.data, head: e.currentTarget.checked }); }
    }
    const nameChange = async (v: string) => {
        if (v.length <= 20) {
            let url = appearanceUrl(v);
            let data = await fetch(url).then(q => q.text());
            if (data.indexOf("404 - Page not found") != -1) {
                seterrtext(`Player avatar not found for '${v}'.`)
                return;
            }
            let buf = avatarStringToBytes(data);
            setId({ player: v, data: buf, head });
            seterrtext("");
        } else {
            try {
                let buf = avatarStringToBytes(v);
                setId({ player: "", data: buf, head: head });
                seterrtext("");
            } catch (e) {
                seterrtext("invalid avatar base64 string");
            }
        }
    }

    const equipChanged = (index: number, type: "item" | "kit" | "none", equipid: number) => {
        let oldava = data?.info.avatar;
        if (!oldava) { console.trace("unexpected"); return; }
        let newava = { ...oldava };
        newava.slots = oldava.slots.slice() as any;
        if (type == "none") {
            newava.slots[index] = { slot: null, cust: null };
        } else {
            newava.slots[index] = { slot: { type, id: equipid } as EquipSlot, cust: null };
        }
        let avabuf = writeAvatar(newava, data?.info.gender ?? 0, null);
        setId({ player, data: avabuf, head });
    }

    const customizationChanged = (index: number, cust: EquipCustomization) => {
        let oldava = data?.info.avatar;
        if (!oldava) { console.trace("unexpected"); return; }
        let newava = { ...oldava };
        newava.slots = oldava.slots.slice() as any;
        newava.slots[index] = { ...oldava.slots[index], cust };
        let avabuf = writeAvatar(newava, data?.info.gender ?? 0, null);
        setId({ player, data: avabuf, head });
    }

    const setGender = (gender: number) => {
        if (!data?.info.avatar) { console.trace("unexpected"); return; }
        let avabuf = writeAvatar(data.info.avatar, gender, null);
        setId({ player, data: avabuf, head });
    }

    const changeColor = (colid: keyof avataroverrides, index: number) => {
        let oldava = data?.info.avatar;
        if (!oldava) { console.trace("unexpected"); return; }
        let newava = { ...oldava };
        newava[colid] = index as any;
        let avabuf = writeAvatar(newava, data?.info.gender ?? 0, null);
        setId({ player, data: avabuf, head });
    }

    const colorDropdown = (id: keyof avataroverrides, v: number, opts: Record<number, number>) => {
        return (
            <LabeledInput label={id}>
                <select value={v} onChange={e => changeColor(id, +e.currentTarget.value)} style={{ backgroundColor: hsl2hex(opts[v]) }}>
                    {Object.entries(opts).map(([i, v]) => <option key={i} value={i} style={{ backgroundColor: hsl2hex(v) }}>{i}</option>)}
                </select>
            </LabeledInput>
        )
    }

    return (
        <React.Fragment>
            <StringInput onChange={nameChange} initialid={player} />
            {errtext && (<div className="mv-errortext" onClick={e => seterrtext("")}>{errtext}</div>)}
            {id == null && (
                <React.Fragment>
                    <p>Type a player name to view their 3d avatar. You can then customize the avatar appearance.</p>
                    <p>You can update your avatar by going to the photo booth southwest of falador in-game</p>
                </React.Fragment>
            )}
            {data && (
                <LabeledInput label="Animation">
                    <select onChange={e => { model?.setAnimation(+e.currentTarget.value); forceUpdate() }} value={model?.targetAnimId ?? -1}>
                        {Object.entries(data.anims).map(([k, v]) => <option key={k} value={v}>{k}</option>)}
                    </select>
                </LabeledInput>
            )}
            {data && <label><input type="checkbox" checked={head} onChange={oncheck} />Head</label>}
            <div className="mv-sidebar-scroll">
                {data && <h2>Slots</h2>}
                <div style={{ userSelect: "text" }}>
                    {ctx && data?.info.avatar?.slots.map((q, i) => {
                        return (
                            <AvatarSlot key={i} index={i} slot={q.slot} cust={q.cust} custChanged={customizationChanged} female={data.info.gender == 1} equipChanged={equipChanged} />
                        );
                    })}
                </div>
                {data && <h2>Settings</h2>}
                {data && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                        <input type="button" className={classNames("sub-btn", { active: data.info.gender == 0 })} onClick={e => setGender(0)} value="Male" />
                        <input type="button" className={classNames("sub-btn", { active: data.info.gender == 1 })} onClick={e => setGender(1)} value="Female" />
                    </div>
                )}
                {data?.info.avatar && colorDropdown("haircol0", data.info.avatar.haircol0, data.info.kitcolors.hair)}
                {data?.info.avatar && colorDropdown("haircol1", data.info.avatar.haircol1, data.info.kitcolors.hair)}
                {data?.info.avatar && colorDropdown("bodycol", data.info.avatar.bodycol, data.info.kitcolors.clothes)}
                {data?.info.avatar && colorDropdown("legscol", data.info.avatar.legscol, data.info.kitcolors.clothes)}
                {data?.info.avatar && colorDropdown("bootscol", data.info.avatar.bootscol, data.info.kitcolors.feet)}
                {data?.info.avatar && colorDropdown("skincol0", data.info.avatar.skincol0, data.info.kitcolors.skin)}
                {data?.info.avatar && colorDropdown("skincol1", data.info.avatar.skincol1, data.info.kitcolors.skin)}
                {data && (
                    <React.Fragment>
                        <h2>Export</h2>
                        <p>Use the export button at the top of the sidebar to export the model.</p>
                        <p>Use this button to copy the customized avatar for later use. You can paste it in the name field</p>
                        <CopyButton text={bytesToAvatarString(data.info.buffer)} />
                    </React.Fragment>
                )}
            </div>
        </React.Fragment>
    );
}

function AvatarSlot({ index, slot, cust, custChanged, equipChanged, female }: { index: number, slot: EquipSlot | null, female: boolean, cust: EquipCustomization, equipChanged: (index: number, type: "kit" | "item" | "none", id: number) => void, custChanged: (index: number, v: EquipCustomization) => void }) {
    let ctx = React.useContext(UIEngineContext);
    let editcust = (ch?: (cust: NonNullable<EquipCustomization>) => {}) => {
        if (!ch) { custChanged(index, null); }
        else {
            let newcust = { color: null, flag2: null, material: null, model: null, ...cust };
            ch(newcust);
            if (!newcust.color && !newcust.flag2 && !newcust.material && !newcust.model) { custChanged(index, null); }
            else { custChanged(index, newcust); }
        }
    }

    let searchItem = () => {
        selectEntity(ctx?.sceneCache.engine, "items", i => equipChanged(index, "item", i), [{ path: ["equipSlotId"], search: index + "" }, { path: ["name"], search: "" }]);
    }
    let searchKit = () => {
        let kitid = (female ? slotToKitFemale : slotToKitMale)[index] ?? -1;
        selectEntity(ctx?.sceneCache.engine, "identitykit", i => equipChanged(index, "kit", i), [{ path: ["bodypart"], search: kitid + "" }]);
    }

    return (
        <div>
            {slot && (
                <div style={{ display: "grid", gridTemplateColumns: "auto repeat(10,min-content)" }}>
                    <span>{slot.name}</span>
                    {!cust?.color?.col2 && !cust?.color?.col4 && slot.replaceColors.length != 0 && (
                        <input type="button" className="sub-btn" value="C" title="Recolor using predefined recolor slots" onClick={e => editcust(c => c.color = { col4: null, col2: slot.replaceColors.map(q => q[1]) })} />
                    )}
                    {!cust?.color?.col2 && !cust?.color?.col4 && (
                        <input type="button" className="sub-btn" value="C4" title="Force recolor 4 colors" onClick={e => editcust(c => c.color = { col4: [[0, 0], [0, 0], [0, 0], [0, 0]], col2: null })} />
                    )}
                    {!cust?.material && slot.replaceMaterials.length != 0 && (
                        <input type="button" className="sub-btn" value="T" title="Replace material in predefined material slots" onClick={e => editcust(c => c.material = { header: 0, materials: slot.replaceMaterials.map(q => q[1]) })} />
                    )}
                    {!cust?.model && (
                        <input type="button" className="sub-btn" value="M" title="Replace models" onClick={e => editcust(c => c.model = slot.models.slice())} />
                    )}
                    <input type="button" className="sub-btn" value="x" onClick={e => equipChanged(index, "none", 0)} />
                </div>
            )}
            {!slot && (
                <div style={{ display: "grid", gridTemplateColumns: "auto repeat(10,min-content)" }}>
                    {slotNames[index]}
                    <input type="button" className="sub-btn" value="Item" onClick={searchItem} />
                    <input type="button" className="sub-btn" value="Kit" onClick={searchKit} />
                </div>
            )}


            {slot && cust?.color?.col2 && (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${slot.replaceColors.length},1fr) min-content` }}>
                    {slot.replaceColors.map((q, i) => (
                        <InputCommitted key={i} type="color" value={hsl2hex(cust.color!.col2![i])} onChange={e => editcust(c => c.color!.col2![i] = hex2hsl(e.currentTarget.value))} />
                    ))}
                    <input type="button" className="sub-btn" value="x" onClick={e => editcust(c => c.color = null!)} />
                </div>
            )}
            {slot && cust?.color?.col4 && (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(4,minmax(0,1fr)) min-content`, gridTemplateRows: "auto auto", gridAutoFlow: "column" }}>
                    {cust.color.col4.map(([from, to], i) => (
                        <React.Fragment key={i}>
                            <InputCommitted type="number" value={from} onChange={e => editcust(c => c.color!.col4![i][0] = +e.currentTarget.value)} />
                            <InputCommitted type="color" value={hsl2hex(to)} onChange={e => editcust(c => c.color!.col4![i][1] = hex2hsl(e.currentTarget.value))} />
                        </React.Fragment>
                    ))}
                    <input type="button" style={{ gridRow: "1/span 2" }} className="sub-btn" value="x" onClick={e => editcust(c => c.color = null!)} />
                </div>
            )}
            {slot && cust?.material && (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${slot.replaceMaterials.length},1fr) min-content` }}>
                    {slot.replaceMaterials.map((q, i) => (
                        <InputCommitted key={i} type="number" value={cust.material!.materials![i]} onChange={e => editcust(c => c.material!.materials[i] = +e.currentTarget.value)} />
                    ))}
                    <input type="button" className="sub-btn" value="x" onClick={e => editcust(c => c.material = null!)} />
                </div>
            )}
            {slot && cust?.model && (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${slot.models.length},1fr) min-content` }}>
                    {slot.models.map((modelid, i) => (
                        <InputCommitted key={i} type="number" value={modelid} onChange={e => editcust(c => c.model![i] = +e.currentTarget.value)} />
                    ))}
                    <input type="button" className="sub-btn" value="x" onClick={e => editcust(c => c.model = null!)} />
                </div>
            )}
        </div>
    )
}

