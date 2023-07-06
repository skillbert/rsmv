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
                target: { type: "number" },
                x: int,
                z: int,
                level: int,
                dy: int
            },
            required: ["type", "target", "x", "z", "level", "dy"]
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
        layers: {
            items: {
                properties: {
                    mode: { type: "string", enum: ["3d", "map", "height", "collision", "locs", "maplabels", "rendermeta", "minimap"] },
                    name: string,
                    pxpersquare: number,
                    level: number,
                    format: { type: "string", enum: ["png", "webp"] },
                    usegzip: boolean,
                    subtractlayers: { items: string },
                    dxdy: number,
                    dzdy: number,
                    wallsonly: boolean
                },
                required: ["mode", "name", "level", "pxpersquare"]
            }
        },
        tileimgsize: number,
        mapsizex: number,
        mapsizez: number,
        area: string
    },
    required: ["layers", "tileimgsize", "mapsizex", "mapsizez", "area"]
}