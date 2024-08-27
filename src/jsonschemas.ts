import { JSONSchema6, validate, mustBeValid } from "json-schema";

export function assertSchema(v: unknown, schema: JSONSchema6) {
    mustBeValid(validate(v as any, schema));
}

export function parseJsonOrDefault<T extends number | string | object | boolean>(str: unknown, schema: JSONSchema6, defaultvalue: (T | (() => T))): T {
    try {
        if (typeof str != "string") { throw new Error("json string expected"); }
        let v = JSON.parse(str);
        assertSchema(v, schema);
        return v as T;
    } catch {
        return (typeof defaultvalue == "function" ? defaultvalue() : defaultvalue);
    }
}

const int: JSONSchema6 = { type: "integer" };
const number: JSONSchema6 = { type: "number" };
const string: JSONSchema6 = { type: "string" };
const boolean: JSONSchema6 = { type: "boolean" };

const mapRectSchema: JSONSchema6 = {
    properties: {
        x: int,
        z: int,
        xsize: int,
        zsize: int
    },
    required: ["x", "z", "xsize", "zsize"]
};

const modelModsSchema: JSONSchema6 = {
    properties: {
        replaceMaterials: { type: "array", minLength: 2, maxLength: 2, items: int },
        replaceColors: { type: "array", minLength: 2, maxLength: 2, items: int }
    }
};

const simpleModelDefSchema: JSONSchema6 = {
    type: "array",
    items: {
        properties:
        {
            modelid: int,
            mods: modelModsSchema,
        },
        required: ["modelid", "mods"]
    }
};

export const customModelDefSchema = {
    properties: {
        type: { const: "custom" },
        modelkey: string,
        name: string,
        simpleModel: simpleModelDefSchema,
        globalMods: modelModsSchema,
        basecomp: string
    },
    required: ["type", "modelkey", "name", "simplemodel", "globalMods", "basecomp"]
};

const scenarioModelSchema: JSONSchema6 = {
    oneOf: [
        {
            properties: {
                type: { const: "simple" },
                modelkey: string,
                name: string,
                simpleModel: simpleModelDefSchema
            },
            required: ["type", "modelkey", "name", "simplemodel"]
        },
        {
            properties: {
                type: { const: "map" },
                modelkey: string,
                name: string,
                mapRect: mapRectSchema
            },
            required: ["type", "modelkey", "name", "mapRect"]
        },
        customModelDefSchema
    ]
};

const scenarioActionSchema: JSONSchema6 = {
    oneOf: [
        {
            properties: {
                type: { const: "location" },
                target: int,
                x: number,
                z: number,
                level: int,
                dy: number,
                rotation: number,
            },
            required: ["type", "target", "x", "z", "level", "dy"]
        },
        {
            properties: {
                type: { const: "transform" },
                target: int,
                flip: boolean,
                scalex: number,
                scaley: number,
                scalez: number
            },
            required: ["type", "target", "flip", "scalex", "scaley", "scalez"]
        },
        {
            properties: {
                type: { const: "anim" },
                target: int,
                animid: int
            },
            required: ["type", "target", "animid"]
        },
        {
            properties: {
                type: { const: "animset" },
                target: int,
                animid: int,
                anims: {
                    type: "object",
                    additionalProperties: int
                }
            },
            required: ["type", "target", "animid", "anims"]
        },
        {
            properties: {
                type: { const: "delay" },
                target: { const: -1 },
                duration: number
            },
            required: ["type", "target", "duration"]
        },
        {
            properties: {
                type: { const: "visibility" },
                target: int,
                visibility: boolean
            },
            required: ["type", "target", "visibility"]
        },
        {
            properties: {
                type: { const: "scale" },
                target: int,
                scalex: number,
                scaley: number,
                scalez: number
            },
            required: ["type", "target", "scalex", "scaley", "scalez"]
        }
    ]
}

export const scenarioStateSchema: JSONSchema6 = {
    properties: {
        components: {
            type: "object",
            additionalProperties: scenarioModelSchema
        },
        actions: {
            type: "array",
            items: scenarioActionSchema
        }
    }
}


export const maprenderConfigSchema: JSONSchema6 = {
    properties: {
        tileimgsize: number,
        mapsizex: number,
        mapsizez: number,
        area: {
            default: "full",
            description: "A string representing the the map area to render. Either one of the named presets (main, full, test ...), or one or more chunk ranges. eg: 50.50,20.20-70.70",
            anyOf: [
                { type: "string", pattern: /^\d+\.\d+(-\d+\.\d+)?(,\d+\.\d+(-\d+\.\d+)?)*$/.source },
                { type: "string", enum: ["main", "full", "test"] },
                { type: "string", pattern: /^\w+$/.source },
            ]
        },
        layers: {
            items: {
                properties: {
                    mode: string,
                    pxpersquare: number,
                    name: string,
                    level: number,
                    usegzip: boolean,
                    subtractlayers: { items: string },
                    format: { type: "string", enum: ["png", "webp"] },
                    mipmode: { enum: ["default", "avg"] }
                },
                required: ["mode", "name", "pxpersquare", "level"],
                oneOf: [{
                    properties: {
                        mode: { enum: ["3d", "minimap", "interactions"] },
                        dxdy: number,
                        dzdy: number,
                        hidelocs: boolean,
                        overlaywalls: boolean,
                        overlayicons: boolean
                    },
                    required: ["mode", "dxdy", "dzdy"]
                }, {
                    properties: {
                        mode: { const: "map" },
                        wallsonly: boolean,
                        mapicons: boolean,
                        thicklines: boolean
                    },
                    required: ["mode"]
                }, {
                    properties: {
                        mode: { enum: ["height", "collision", "locs", "maplabels", "rendermeta"] }
                    },
                    required: ["mode"]
                }]
            }
        }
    },
    required: ["layers", "tileimgsize", "mapsizex", "mapsizez", "area"]
}