import { SRGBColorSpace, ShaderMaterial, Texture } from "three";
import { MaterialData } from "../3d/jmat";

let inputreplace: InputReplacer = {
    //camera matrices, slightly different
    uModelMatrix: "#define uModelMatrix modelMatrix",
    uViewProjMatrix: "#define uViewProjMatrix (projectionMatrix*viewMatrix)",
    uViewMatrix: "#define uViewMatrix viewMatrix",//used for shadow stuff
    uProjectionMatrix: "#define uProjectionMatrix projectionMatrix",
    uCameraPosition: "#define uCameraPosition cameraPosition",

    aWaterPosition_Depth: "#define aWaterPosition_Depth vec4(position,10.0)",
    aVertexPosition: "#define aVertexPosition position",
    aVertexPosition_BoneLabel: "#define aVertexPosition_BoneLabel vec4(position,0.0)",
    aTextureUV: "#define aTextureUV uv",
    aVertexColour: "#define aVertexColour vec4(color.rgb,1.0)",
    aTextureWeight: [
        "attribute vec3 color_1;",
        "#define aTextureWeight vec4(color_1,1.0)"
        // "#define aTextureWeight vec4(1.0,0.0,0.0,1.0)"
    ],
    aMaterialProperties: [
        "attribute vec3 color_2;",
        "#define aMaterialProperties vec4(256.0-color_2*256.0,0.0)"
        // "#define aMaterialProperties vec4(256.0,256.0,256.0,0.0)"
    ],
    aVertexNormal_FogProportion: "#define aVertexNormal_FogProportion vec4(normal,0.0)",
    gl_FragColor: ""
};

let definereplace: InputReplacer = {
    UNIFORM_BUFFER_BEGIN: "#define UNIFORM_BUFFER_BEGIN(name)",
    UNIFORM_BUFFER_END: "#define UNIFORM_BUFFER_END",
    TEXTURE_GRAD: "",
    gl_FragColor: "",
}
let definereplaceloc: InputReplacer = {
    UNIFORM_BUFFER_BEGIN: "#define UNIFORM_BUFFER_BEGIN(name)",
    UNIFORM_BUFFER_END: "#define UNIFORM_BUFFER_END",
    TEXTURE_GRAD: "",
    gl_FragColor: "",
    // SRGB_TEXTURES: ""
}

export function minimapLocMaterial(texture: Texture, alphamode: MaterialData["alphamode"], alphathreshold: number) {
    let mat = new ShaderMaterial();
    mat.uniforms = {
        uAlphaTestThreshold: { value: [-1] },
        uAmbientColour: { value: [0.6059895753860474, 0.5648590922355652, 0.5127604007720947] },
        uAtlasMeta: { value: [512, 16, 0.0001220703125, 4] },
        uCameraPosition: { value: [1638400, 17248, 1671168] },
        uDummy: { value: [1] },
        uFade: { value: [0] },
        uFullScreenLookupScale: { value: [0, 5.960465188081798e-8, 1, 0] },
        uInscatteringAmount: { value: [1, 0, 0] },
        uInvSunDirection: { value: [-0.5391638875007629, 0.6469966173171997, -0.5391638875007629] },
        uModelMatrix: { value: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1630208, 0, 1654784, 1] },
        uOutscatteringAmount: { value: [1638400, 17248, 1671168] },
        uProjectionMatrix: { value: [0.0000152587890625, 0, 0, 0, 0, -0.0000152587890625, 0, 0, 0, 0, -0.00006200397183420137, 0, 0, 0, -1.0317461490631104, 1] },
        uScatteringParameters: { value: [0, -1, 5.960465188081798e-8, 0] },
        uScatteringTintColour: { value: [0, 5.960465188081798e-8, 1] },
        uSunColour: { value: [0.8666666746139526, 0.8078431487083435, 0.7333333492279053] },
        uTextureAnimationTime: { value: [459.7019958496094] },
        uTextureAtlas: { value: [5] },
        uTextureAtlasSettings: { value: [6] },
        uTint: { value: [0, 0, 0, 0] },
        uVertexScale: { value: [1] },
        uViewMatrix: { value: [1, 0, 0, 0, 0, 5.960465188081798e-8, 1, 0, 0, -1, 5.960465188081798e-8, 0, -1638400, 1671168, -17248.099609375, 1] },
        uViewProjMatrix: { value: [0.0000152587890625, 0, 0, 0, 0, -9.094948101931455e-13, -0.00006200397183420137, 0, 0, 0.0000152587890625, -3.695725149521767e-12, 0, -25, -25.5, 0.03770458698272705, 1] },
        uViewportLookupScale: { value: [1638400, 17248, 1671168, 0] },
        uViewportOffsetScale: { value: [1, 0, 0, 0] },
        uZBufferParams: { value: [16777248, 32256, -32768, -512.0009765625] }
    };

    mat.vertexColors = true;

    let vert: string = require("./minimap-loc-vert.glsl.c");
    vert = fixShader(vert);
    vert = replaceUniforms(vert, inputreplace);
    vert = replaceDefines(vert, definereplaceloc);

    let frag: string = require("./minimap-loc-frag.glsl.c");
    frag = fixShader(frag);
    frag = replaceUniforms(frag, inputreplace);
    frag = replaceDefines(frag, definereplaceloc);
    frag = frag.replace(/#undef gl_FragColor/, "// $&");
    frag = frag.replace(/void getTextureSettings\(/,
        "void getTextureSettings(vec2 s, out TextureSettings settings){\n"
        + "settings.textureMeta1 = vec3(0.0,0.0,8196.0);\n"// [x,y,size] first texture, albedo x*uAtlasMeta.y*uAtlasMeta.z
        + "settings.textureMeta2 = vec3(0.0,0.0,8196.0);\n"// [x,y,size] second texture normals??
        + "settings.uvAnim = vec2(0.0,0.0);\n"
        + "settings.wrapping = 0.0;\n"
        + "settings.specular = 0.0;\n"
        + "settings.normalScale = 0.0;\n"
        + "}\n"
        + "void getTextureSettingsOld("
    );

    frag = frag.replace(/(?<!void )getTexel\(\w+,/gm, () => `getTexel(vTextureUV,`);

    frag = wrapMain(frag, `
        void main(){
            super();
            //pre-multiply alpha
            // gl_FragColor.rgb *= gl_FragColor.a;
            // gl_FragColor.rgb = vec3( gl_FragColor.a);
            gl_FragColor.a=1.0;
            
        }
    `);

    mat.vertexShader = vert;
    mat.fragmentShader = frag;

    mat.uniforms.uTextureAtlas = { value: texture };
    mat.uniforms.uInvSunDirection.value[2] *= -1;//z flip
    mat.uniforms.uAlphaTestThreshold = { value: [alphathreshold] };

    mat.uniformsNeedUpdate = true;
    if (alphamode == "blend") {
        mat.transparent = true;
    }

    if (texture) {
        texture.colorSpace = SRGBColorSpace;
    }
    return mat;
}

export function minimapFloorMaterial(texture: Texture) {
    let mat = new ShaderMaterial();
    mat.uniforms = {
        uAmbientColour: { value: [0.6059895753860474, 0.5648590922355652, 0.5127604007720947] },
        uAtlasMeta: { value: [512, 16, 0.0001220703125, 4] },
        uCameraPosition: { value: [1638400, 17632, 1769472] },
        uDummy: { value: [1] },
        uFade: { value: [0] },
        uFullScreenLookupScale: { value: [0, 5.960465188081798e-8, 1, 0] },
        uGridSize: { value: [512] },
        uInscatteringAmount: { value: [1, 0, 0] },
        uInvSunDirection: { value: [-0.5391638875007629, 0.6469966173171997, -0.5391638875007629] },
        uModelMatrix: { value: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1622015, 100, 1753087, 1] },
        uOutscatteringAmount: { value: [1638400, 17632, 1769472] },
        uProjectionMatrix: { value: [0.0000152587890625, 0, 0, 0, 0, -0.0000152587890625, 0, 0, 0, 0, -0.00006200397183420137, 0, 0, 0, -1.0317461490631104, 1] },
        uScatteringParameters: { value: [0, -1, 5.960465188081798e-8, 0] },
        uScatteringTintColour: { value: [0, 5.960465188081798e-8, 1] },
        uSunColour: { value: [0.8666666746139526, 0.8078431487083435, 0.7333333492279053] },
        uTextureAtlas: { value: [5] },
        uTextureAtlasSettings: { value: [6] },
        uViewMatrix: { value: [1, 0, 0, 0, 0, 5.960465188081798e-8, 1, 0, 0, -1, 5.960465188081798e-8, 0, -1638400, 1769472, -17632.10546875, 1] },
        uViewProjMatrix: { value: [0.0000152587890625, 0, 0, 0, 0, -9.094948101931455e-13, -0.00006200397183420137, 0, 0, 0.0000152587890625, -3.695725149521767e-12, 0, -25, -27, 0.06151437759399414, 1] },
        uViewportLookupScale: { value: [1638400, 17632, 1769472, 0] },
        uViewportOffsetScale: { value: [1, 0, 0, 0] },
        uZBufferParams: { value: [16777248, 32256, -32768, -512.0009765625] }
    };



    mat.vertexColors = true;

    let vert: string = require("./minimap-floor-vert.glsl.c");
    vert = fixShader(vert);
    vert = replaceUniforms(vert, inputreplace);
    vert = replaceDefines(vert, definereplace);

    let frag: string = require("./minimap-floor-frag.glsl.c");
    frag = fixShader(frag);
    frag = replaceUniforms(frag, inputreplace);
    frag = replaceDefines(frag, definereplace);
    frag = frag.replace(/#undef gl_FragColor/, "// $&");
    frag = frag.replace(/void getTextureSettings\(/,
        "void getTextureSettings(vec2 s, out TextureSettings settings){\n"
        + "settings.textureMeta1 = vec3(0.0,0.0,8196.0);\n"// [x,y,size] first texture, albedo x*uAtlasMeta.y*uAtlasMeta.z
        + "settings.textureMeta2 = vec3(0.0,0.0,8196.0);\n"// [x,y,size] second texture normals??
        + "settings.uvAnim = vec2(0.0,0.0);\n"
        + "settings.wrapping = 0.0;\n"
        + "settings.specular = 0.0;\n"
        + "settings.normalScale = 0.0;\n"
        + "}\n"
        + "void getTextureSettingsOld("
    );

    //inject floor uv from mesh instead of derived from world position
    let gettexelcount = 0;
    frag = injectheader(frag, "in highp vec2 v_texcoord_0;\nin highp vec2 v_texcoord_1;\nin highp vec2 v_texcoord_2;");
    vert = injectheader(vert, "in highp vec2 texcoord_0;\nin highp vec2 texcoord_1;\nin highp vec2 texcoord_2;");
    vert = injectheader(vert, "out highp vec2 v_texcoord_0;\nout highp vec2 v_texcoord_1;\nout highp vec2 v_texcoord_2;");
    vert = injectmain(vert, "v_texcoord_0=texcoord_0;\nv_texcoord_1=texcoord_1;\nv_texcoord_2=texcoord_2;\n");
    frag = frag.replace(/(?<!void )getTexel\(\w+,/gm, () => `getTexel(v_texcoord_${gettexelcount++ % 3},`);

    mat.vertexShader = vert;
    mat.fragmentShader = frag;

    mat.uniforms.uTextureAtlas = { value: texture };
    mat.uniforms.uInvSunDirection.value[2] *= -1;//z flip

    mat.uniformsNeedUpdate = true;

    return mat;
}
export function minimapWaterMaterial(texture: Texture) {
    let mat = new ShaderMaterial();
    mat.customProgramCacheKey = () => "water";
    mat.uniforms = {
        uAmbientColour: { value: [1, 0, 0] },
        uCameraPosition: { value: [1671168, 17344, 1638400] },
        uDummy: { value: [0] },
        uFullScreenLookupScale: { value: [0, 5.960465188081798e-8, 1, 0] },
        uInvSunDirection: { value: [1671168, 17344, 1638400] },
        uModelMatrix: { value: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1654783, 100, 1622015, 1] },
        uProjectionMatrix: { value: [0.0000152587890625, 0, 0, 0, 0, -0.0000152587890625, 0, 0, 0, 0, -0.00006200397183420137, 0, 0, 0, -1.0317461490631104, 1] },
        uSunColour: { value: [0, 5.960465188081798e-8, 1] },
        uViewMatrix: { value: [1, 0, 0, 0, 0, 5.960465188081798e-8, 1, 0, 0, -1, 5.960465188081798e-8, 0, -1671168, 1638400, -17344.09765625, 1] },
        uViewProjMatrix: { value: [0.0000152587890625, 0, 0, 0, 0, -9.094948101931455e-13, -0.00006200397183420137, 0, 0, 0.0000152587890625, -3.695725149521767e-12, 0, -25.5, -25, 0.04365682601928711, 1] },
        uViewportLookupScale: { value: [1671168, 17344, 1638400, 1.0947093356943706e+27] },
        uViewportOffsetScale: { value: [1, 0, 0, 0] },
        uZBufferParams: { value: [16777248, 32256, -32768, -512.0009765625] }
    }

    mat.vertexColors = true;

    let vert: string = require("./minimap-water-vert.glsl.c");
    vert = fixShader(vert);
    vert = replaceUniforms(vert, inputreplace);
    vert = replaceDefines(vert, definereplace);

    let frag: string = require("./minimap-water-frag.glsl.c");
    frag = fixShader(frag);
    frag = replaceUniforms(frag, inputreplace);
    frag = replaceDefines(frag, definereplace);
    frag = frag.replace(/#undef gl_FragColor/, "// $&");
    frag = frag.replace(/void getTextureSettings\(/,
        "void getTextureSettings(vec2 s, out TextureSettings settings){\n"
        + "settings.textureMeta1 = vec3(0.0,0.0,8196.0);\n"// [x,y,size] first texture, albedo x*uAtlasMeta.y*uAtlasMeta.z
        + "settings.textureMeta2 = vec3(0.0,0.0,8196.0);\n"// [x,y,size] second texture normals??
        + "settings.uvAnim = vec2(0.0,0.0);\n"
        + "settings.wrapping = 0.0;\n"
        + "settings.specular = 0.0;\n"
        + "settings.normalScale = 0.0;\n"
        + "}\n"
        + "void getTextureSettingsOld("
    );

    //inject floor uv from mesh instead of derived from world position
    let gettexelcount = 0;
    frag = injectheader(frag, "in highp vec2 v_texcoord_0;\nin highp vec2 v_texcoord_1;\nin highp vec2 v_texcoord_2;");
    vert = injectheader(vert, "in highp vec2 texcoord_0;\nin highp vec2 texcoord_1;\nin highp vec2 texcoord_2;");
    vert = injectheader(vert, "out highp vec2 v_texcoord_0;\nout highp vec2 v_texcoord_1;\nout highp vec2 v_texcoord_2;");
    vert = injectmain(vert, "v_texcoord_0=texcoord_0;\nv_texcoord_1=texcoord_1;\nv_texcoord_2=texcoord_2;\n");
    frag = frag.replace(/(?<!void )getTexel\(\w+,/gm, () => `getTexel(v_texcoord_${gettexelcount++ % 3},`);

    mat.vertexShader = vert;
    mat.fragmentShader = frag;

    mat.uniforms.uTextureAtlas = { value: texture };
    mat.uniforms.uInvSunDirection.value[2] *= -1;//z flip

    mat.uniformsNeedUpdate = true;

    return mat;
}

type InputReplacer = Record<string, string | string[] | (() => string | string[])>;

function injectmain(source: string, injected: string) {
    return source.replace(/void main\(\)[\s\r\n]*\{/, "$&\n" + injected);
}

function injectheader(source: string, injected: string) {
    return injected + "\n" + source;
}

function replaceUniforms(source: string, unis: InputReplacer) {
    return source.replace(/^((flat) )*(in|out|uniform|attribute|varying) ((highp|mediump|lowp) )*(float|vec\d|mat\d) ((\w|,\s*)+);$/mg, (m, mods, mod, vartype, precs, prec, datatype, varnames: string) => {
        return varnames.split(/,\s*/g).map(varname => {
            let repl = unis[varname];
            if (repl != undefined) {
                let value = (typeof repl == "function" ? repl() : repl);
                value = (Array.isArray(value) ? value.join("\n") : value + "\n");
                // console.log("replacing", varname, value);
                return m.split("\n").map(q => `// ${q}`).join("\n") + "\n" + value;
            }
            return `${mods ?? ""}${vartype} ${precs ?? ""}${datatype ?? ""} ${varname};`;
        }).join("\n");
    })
}

function replaceDefines(source: string, defs: InputReplacer) {
    return source.replace(/^#define (\w+)(\(.*?\))?($| (\\\r?\n|.)*$)/mg, (m, defname) => {
        let repl = defs[defname];
        if (repl != undefined) {
            let value = (typeof repl == "function" ? repl() : repl);
            value = (Array.isArray(value) ? value.join("\n") : value + "\n");
            // console.log("replacing", defname, value);
            return m.split("\n").map(q => `// ${q}`).join("\n") + "\n" + value;
        }
        return m;
    })
}

function wrapMain(source: string, newmain: string) {
    source = source.replace(/\bvoid main\(/, "void originalMain(");
    source = source + "\n" + newmain.replace(/super\(/, "originalMain(");
    return source;
}

function fixShader(source: string) {
    let header = [
        // `#version 300 es`,//highest version we can choose in webgl2
        `precision highp float;`,
        `precision mediump sampler3D;`,
        `#define fma(a,b,c) ((a)*(b)+(c))`,//fma doesn't exist
    ].join("\n") + "\n\n";

    return header + source
        .replace(/^#version ([\w ]+)$/m, "//original version $1")//replaced in new header
        .replace(/\bprecise\b/g, "highp")//doesn't exist in webgl
}