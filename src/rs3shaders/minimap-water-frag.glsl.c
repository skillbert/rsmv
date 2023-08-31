
#version 460

/***************************************************/
/***************** GLSL Header *********************/
/***************************************************/
#ifdef GL_EXT_gpu_shader4
#extension GL_EXT_gpu_shader4 : enable
#endif
#ifdef GL_ARB_gpu_shader5
#extension GL_ARB_gpu_shader5 : enable
#endif
#ifdef GL_ARB_derivative_control
#extension GL_ARB_derivative_control : enable
#endif

#ifdef GL_ARB_texture_gather
#extension GL_ARB_texture_gather : enable
#endif

#define OGL_BACKEND

#undef attribute
#define attribute in

#undef gl_FragColor
#define gl_FragColor FragColor

#define shadow2DCompat texture

#undef textureCube
#define textureCube texture

#undef texture2D
#define texture2D texture

#undef texture3D
#define texture3D texture

#undef texture2DLod
#define texture2DLod textureLod

#undef textureCubeLod
#define textureCubeLod textureLod

#undef texture2DGrad
#define texture2DGrad textureGrad

#define MSAA_AVAILABLE

#define TEXTURE_OFFSET_AVAILABLE
#if !defined(lowp)
#define lowp
#endif
#if !defined(mediump)
#define mediump
#endif
#if !defined(highp)
#define highp
#endif

#define GRAPHICS_QUALITY_LOW 0
#define GRAPHICS_QUALITY_MEDIUM 1
#define GRAPHICS_QUALITY_HIGH 2
#define GRAPHICS_QUALITY_ULTRA 3

#define shadow2DLodCompat texture2DLod

#define texture2DLodCompat texture2DLod

#define textureCubeLodCompat textureCubeLod

#define textureGatherCompat(sampler, texCoord, viewportScale) textureGather(sampler, texCoord).wzxy

#define SHADER_TYPE_PIXEL

out vec4 gl_FragColor;

#define UNIFORM_BUFFER_BEGIN(name) \
    layout(std140) uniform name    \
    {
#define UNIFORM_BUFFER_END \
    }                      \
    ;

mat3 Mat4ToMat3(const mat4 inputMatrix)
{
    return mat3(inputMatrix);
}

#define isNaN isnan

#ifndef GL_ARB_derivative_control
#define dFdxFine dFdx
#define dFdyFine dFdy
#define fwidthFine fwidth
#endif

/***************************************************/

/***************************************************/
/***************** Effect Defines ******************/
/***************************************************/
#define VIEW_TRANSFORMS

/*************************************************/

/***************************************************/
/********** Mandatory Shader Fragments *************/
/***************************************************/

#define GRAPHICS_QUALITY_LOW 0
#define GRAPHICS_QUALITY_MEDIUM 1
#define GRAPHICS_QUALITY_HIGH 2
#define GRAPHICS_QUALITY_ULTRA 3

#define MATERIAL_SETTINGS_SLOT_PIXEL_RESOLUTION_X 3.0
#define MATERIAL_SETTINGS_SLOT_PIXEL_RESOLUTION_Y 4.0
#define MATERIAL_SETTINGS_SLOTS_DIMENSION_COUNT_X 42.0
#define MATERIAL_SETTINGS_SLOTS_DIMENSION_COUNT_Y 32.0
#define MATERIAL_SETTINGS_TEXTURE_RESOLUTION 128.0
#ifndef MATH_UTILS_INC
#define MATH_UTILS_INC
const float PI = 3.14159, INV_PI = .31831, TWOPI = PI * 2., INV_TWOPI = 1. / TWOPI, PI_OVER_4 = PI / 4., PI_OVER_2 = PI / 2., SQRT_2_PI = .797885, INV_EIGHT = .125;
float SpecPowToBeckmannRoughness(float f) { return sqrt(2. / (f + 2.)); }
float PerceptualRoughnessToRoughness(float f) { return f * f; }
float RoughnessToPerceptualRoughness(float f) { return sqrt(f); }
#endif
#ifndef CONVERSION_UTILS_INC
#define CONVERSION_UTILS_INC
vec3 SRGBToLinear(vec3 srgbColour)
{
#if defined(GAMMA_CORRECT_INPUTS)
    return srgbColour * srgbColour;
#else
    return pow(srgbColour, vec3(2.2, 2.2, 2.2));
#endif
}
vec3 LinearToSRGB(vec3 s) { return max(vec3(1.055) * pow(s, vec3(.416667)) - vec3(.055), vec3(0.)); }
float LinearToSRGB(float s)
{
    const float p = 1. / 2.2;
    return pow(s, p);
}
vec3 LinearToSRGBRunescape(vec3 s) { return sqrt(s); }
float LinearToSRGBRunescape(float s) { return sqrt(s); }
vec4 convertRGBtoHSL(vec4 s)
{
    const float p = 1. / 6.;
    float v = s.s, m = s.t, t = s.p, f = min(min(s.s, s.t), s.p), q = max(max(s.s, s.t), s.p), r = q - f, G = (f + q) * .5, i = 0., e = 0.;
    if (G > 0. && G < 1.)
    {
        float L = G < .5 ? G : 1. - G;
        i = r / (L * 2.);
    }
    if (r > 0.)
    {
        vec3 L = vec3(q == v && q != m ? 1. : 0., q == m && q != t ? 1. : 0., q == t && q != v ? 1. : 0.), o = vec3((m - t) / r, 2. + (t - v) / r, 4. + (v - m) / r);
        e += dot(o, L);
        e *= p;
        if (e < 0.)
            e += 1.;
    }
    return vec4(e, i, G, s.q);
}
vec4 convertHSLtoRGB(vec4 s)
{
    const float v = 1. / 3., q = 2. / 3., m = 6.;
    float p = s.s, t = s.t, r = s.p;
    vec3 f = vec3(m * (p - q), 0., m * (1. - p));
    if (p < q)
        f.s = 0., f.t = m * (q - p), f.p = m * (p - v);
    if (p < v)
        f.s = m * (v - p), f.t = m * p, f.p = 0.;
    f = min(f, 1.);
    float L = 2. * t, i = 1. - t, G = 1. - r, e = 2. * r - 1.;
    vec3 c = L * f + i, o;
    if (r >= .5)
        o = G * c + e;
    else
        o = r * c;
    return vec4(o, s.q);
}
#endif
#ifndef PACK_UTILS_INC
#define PACK_UTILS_INC
#ifndef SHADER_LIB_COMMON_INC
#define SHADER_LIB_COMMON_INC
#define USE_MOD_PACK
#endif

vec4 PackFloatToRGBA(highp float valueToPack)
{
#if defined(USE_MOD_PACK) || defined(USE_FRACT_PACK)
    const highp vec4 bitShift = vec4(256 * 256 * 256, 256 * 256, 256, 1.0);
    const highp vec4 bitMask = vec4(0, 1.0 / 256.0, 1.0 / 256.0, 1.0 / 256.0);
    highp vec4 fragColour = mod(valueToPack * bitShift * vec4(255), vec4(256)) / vec4(255);
    return fragColour - fragColour.xxyz * bitMask;
#endif
#ifdef USE_ARAS_PACK
    const highp vec4 bitShift = vec4(1.0, 255.0, 65025.0, 16581375.0);
    const highp vec4 bitMask = vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
    highp vec4 fragColour = fract(valueToPack * bitShift);
    return fragColour - (fragColour.xxyz * bitMask);
#endif
}
vec2 NormalPackSphereMap(vec3 v)
{
    vec2 f = normalize(v.st) * sqrt(-v.p * .5 + .5);
    f = f * .5 + .5;
    return f * 65535.;
}
vec2 PackFloatToVec2(float v)
{
    vec2 f;
    const float b = 1. / 255.;
    vec2 h = vec2(1., 255.), r = fract(h * v);
    r.s -= r.t * b;
    return r.st;
}
#endif
#ifndef UNPACK_UTILS_INC
#define UNPACK_UTILS_INC
#ifndef SHADER_LIB_COMMON_INC
#define SHADER_LIB_COMMON_INC
#define USE_MOD_PACK
#endif

highp float UnpackRGBAToFloat(highp vec4 valueToUnpack)
{
#if defined(USE_MOD_PACK) || defined(USE_FRACT_PACK)
    const highp vec4 bitShifts = vec4(1.0 / (256.0 * 256.0 * 256.0), 1.0 / (256.0 * 256.0), 1.0 / 256.0, 1.0);
    return dot(valueToUnpack, bitShifts);
#endif
#ifdef USE_ARAS_PACK
    const highp vec4 bitShifts = vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0);
    return dot(valueToUnpack, bitShifts);
#endif
}
vec3 ColourUnpack(highp float v)
{
    vec3 f;
    f.s = floor(v / 256. / 256.);
    f.t = floor((v - f.s * 256. * 256.) / 256.);
    f.p = floor(v - f.s * 256. * 256. - f.t * 256.);
    return f / 256.;
}
vec3 NormalUnpackSphereMap(vec2 v)
{
    vec4 f = vec4(v.s / 32767. - 1., v.t / 32767. - 1., 1., -1.);
    float U = dot(f.stp, -f.stq);
    f.st *= sqrt(U);
    f.p = U;
    return f.stp * 2. + vec3(0., 0., -1.);
}
highp float UnpackRGBAToIntegerFloat(highp vec4 f) { return floor(f.s * 255. + .5) * 256. * 256. * 256. + floor(f.t * 255. + .5) * 256. * 256. + floor(f.p * 255. + .5) * 256. + floor(f.q * 255. + .5); }
highp float UnpackRGBAToIntegerFloat16(highp vec2 f) { return floor(f.s * 255. + .5) * 256. + floor(f.t * 255. + .5); }
highp int UnpackRGBAToInt(vec4 f) { return int(UnpackRGBAToIntegerFloat(f)); }
highp vec4 UnpackFloatToRGBA(highp float f)
{
    const highp vec4 v = vec4(1., 255., 65025., 1.65814e+07), s = vec4(vec3(1. / 255.), 0.);
    highp vec4 U = fract(f * v);
    U -= U.sstp * s;
    return U;
}
highp float UnpackVec2ToFloat(highp vec2 f) { return floor(f.s * 255. + .5) * 256. + floor(f.t * 255. + .5); }
#endif
#if defined(MSAA) && defined(MSAA_AVAILABLE)
#define SAMPLER_2D_AUTO_MULTISAMPLE sampler2DMS
#define MSAA_SAMPLERS_ENABLED 1
#define texture2DMultisample(sampler, texCoord, texSize) texelFetch(sampler, ivec2((texCoord)*texSize), 0)
#else
#define SAMPLER_2D_AUTO_MULTISAMPLE sampler2D
#define MSAA_SAMPLERS_ENABLED 0
#define texture2DMultisample(sampler, texCoord, texSize) texture2DLodCompat(sampler, texCoord, 0.0)
#endif
UNIFORM_BUFFER_BEGIN(ViewportLookupScale)
uniform highp vec4 uViewportLookupScale;
uniform highp vec4 uViewportOffsetScale;
uniform highp vec4 uFullScreenLookupScale;
UNIFORM_BUFFER_END

/***************************************************/

UNIFORM_BUFFER_BEGIN(ViewTransforms)
uniform highp vec3 uCameraPosition;
uniform highp mat4 uViewMatrix;
uniform highp mat4 uProjectionMatrix;
uniform highp mat4 uViewProjMatrix;
uniform highp vec4 uZBufferParams;
UNIFORM_BUFFER_END

UNIFORM_BUFFER_BEGIN(Sunlight)
uniform highp vec3 uInvSunDirection;
uniform mediump vec3 uAmbientColour;
uniform mediump vec3 uSunColour;
uniform mediump float uDummy;
UNIFORM_BUFFER_END
uniform lowp vec4 uWaterFeatureFlags;
uniform highp vec4 uWaterNormalMapTextureScales_FlowNoiseScale;
uniform highp vec2 uWaterTickFade;
uniform vec4 uWaterNormalBRDFParams;
uniform vec3 uWaterSpecularColour;
in highp vec4 vPosition_WaterDepth;
in vec4 vColour;
in highp vec4 vFlowControlMask_ViewSpaceDepth;
in highp vec4 vNoisyPatchFlow0_NoisyPatchFlow1;
in highp vec4 vNoisyPatchFlow2_UVPack_NormalsFlow0Map0;
in highp vec4 vUVPack_NormalsFlow0Map1_NormalsFlow0Map2;
in highp vec4 vUVPack_NormalsFlow1Map0_NormalsFlow1Map1;
in highp vec4 vUVPack_NormalsFlow1Map2_NormalsFlow2Map0;
in highp vec4 vUVPack_NormalsFlow2Map1_NormalsFlow2Map2;
in highp vec4 vUVPack_NormalMapMacroUV_EmissiveUV[3];
in highp vec2 vUVPack_FoamUV;
#ifndef CONVERSION_UTILS_INC
#define CONVERSION_UTILS_INC
vec3 SRGBToLinear(vec3 srgbColour)
{
#if defined(GAMMA_CORRECT_INPUTS)
    return srgbColour * srgbColour;
#else
    return pow(srgbColour, vec3(2.2, 2.2, 2.2));
#endif
}
vec3 LinearToSRGB(vec3 s) { return max(vec3(1.055) * pow(s, vec3(.416667)) - vec3(.055), vec3(0.)); }
float LinearToSRGB(float s)
{
    const float p = 1. / 2.2;
    return pow(s, p);
}
vec3 LinearToSRGBRunescape(vec3 s) { return sqrt(s); }
float LinearToSRGBRunescape(float s) { return sqrt(s); }
vec4 convertRGBtoHSL(vec4 s)
{
    const float p = 1. / 6.;
    float v = s.s, m = s.t, t = s.p, f = min(min(s.s, s.t), s.p), q = max(max(s.s, s.t), s.p), r = q - f, G = (f + q) * .5, i = 0., e = 0.;
    if (G > 0. && G < 1.)
    {
        float L = G < .5 ? G : 1. - G;
        i = r / (L * 2.);
    }
    if (r > 0.)
    {
        vec3 L = vec3(q == v && q != m ? 1. : 0., q == m && q != t ? 1. : 0., q == t && q != v ? 1. : 0.), o = vec3((m - t) / r, 2. + (t - v) / r, 4. + (v - m) / r);
        e += dot(o, L);
        e *= p;
        if (e < 0.)
            e += 1.;
    }
    return vec4(e, i, G, s.q);
}
vec4 convertHSLtoRGB(vec4 s)
{
    const float v = 1. / 3., q = 2. / 3., m = 6.;
    float p = s.s, t = s.t, r = s.p;
    vec3 f = vec3(m * (p - q), 0., m * (1. - p));
    if (p < q)
        f.s = 0., f.t = m * (q - p), f.p = m * (p - v);
    if (p < v)
        f.s = m * (v - p), f.t = m * p, f.p = 0.;
    f = min(f, 1.);
    float L = 2. * t, i = 1. - t, G = 1. - r, e = 2. * r - 1.;
    vec3 c = L * f + i, o;
    if (r >= .5)
        o = G * c + e;
    else
        o = r * c;
    return vec4(o, s.q);
}
#endif

vec4 textureCubeSRGB(samplerCube sampler, vec3 reflDir)
{
    vec4 texel = textureCube(sampler, reflDir);
    return texel;
}

vec4 textureCubeSRGB(samplerCube sampler, vec3 reflDir, float lod)
{
    vec4 texel = textureCube(sampler, reflDir, lod);
    return texel;
}

vec4 textureCubeLodSRGB(samplerCube sampler, vec3 reflDir, float lod)
{
    vec4 texel = textureCubeLodCompat(sampler, reflDir, lod);
    return texel;
}
#ifndef FRESNEL_INC
#define FRESNEL_INC
vec3 FresnelSchlick(vec3 F, float f, highp float h)
{
    vec3 c = F + (1. - F) * pow(1. - f, h);
    return c;
}
vec3 FresnelSchlickRoughness(vec3 f, float F, highp float h, float v)
{
    vec3 c = f + (max(vec3(v), f) - f) * pow(1. - F, h);
    return c;
}
float FresnelSchlick(float F, float f, highp float h)
{
    float c = F + (1. - F) * pow(1. - f, h);
    return c;
}
float FresnelSchlickRoughness(float f, float F, highp float h, float v)
{
    float c = f + (max(v, f) - f) * pow(1. - F, h);
    return c;
}
float FresnelSchlick(vec3 F, vec3 f, float c)
{
    float h = max(0., dot(F, f));
    return c + (1. - c) * pow(1. - h, 5.);
}
float Fresnel(vec3 F, vec3 f, float c, float h)
{
    float p = 1. - max(0., dot(F, f)), v = p * p;
    v = v * v;
    v = v * p;
    return clamp(v * (1. - clamp(h, 0., 1.)) + h - c, 0., 1.);
}
#endif

vec3 UnpackCompressedNormal(vec3 U)
{
    vec3 v = vec3(U.ps * 255. / 127. - 1.00787, 0.);
    v.p = sqrt(1. - min(1., dot(v.st, v.st)));
    v.t = -v.t;
    return v;
}
vec3 UnpackNormal(vec3 v, float U)
{
    vec3 t;
#if defined(COMPRESSED_NORMALS)
    t = UnpackCompressedNormal(v);
#else
    t = v.pst * 255. / 127. - 1.00787;
    t.t = -t.t;
#endif
    t.st *= U;
    return t;
}
vec3 UnpackNormal(vec3 U) { return UnpackNormal(U, 1.); }
vec3 UnpackNormal(vec4 v) { return UnpackNormal(v.tpq, 1.); }
vec3 UnpackNormal(vec4 v, float U) { return UnpackNormal(v.tpq, U); }

const highp float CAUSTICS_FIXED_POINT_SCALE = 10000.;
#if defined(CAUSTICS) && !defined(CAUSTICS_COMPUTE) && !defined(CAUSTICS_STENCIL)
float CalculateCausticsTerm(highp vec3 u, float t, vec3 e)
{
    float i = 0., s = 0.;
    if (u.t <= uCausticsPlaneHeight)
        s = step(1., t);
    else
    {
#if defined(CAUSTICS_OVERWATER)
        s = clamp(e.t * -1., 0., 1.);
        float d = smoothstep(uCausticsOverWaterFade.s, uCausticsOverWaterFade.t, u.t - uCausticsPlaneHeight);
        s *= 1. - d;
#else
        return 0.0;
#endif
    }
    if (s > 0.)
    {
        highp vec4 C = uCausticsViewProjMatrix * vec4(u, 1.);
        C.st /= 2. * C.q;
        vec2 f = abs(C.st);
        C.st += .5;
        f = smoothstep(.4, .5, f);
        s *= max(0., 1. - (f.s + f.t));
        if (s > 0.)
            i += textureOffset(uCausticsMap, C.st, ivec2(-1, -1)).s, i += textureOffset(uCausticsMap, C.st, ivec2(-1, 0)).s, i += textureOffset(uCausticsMap, C.st, ivec2(-1, 1)).s, i += textureOffset(uCausticsMap, C.st, ivec2(0, -1)).s, i += texture2D(uCausticsMap, C.st).s * 5., i += textureOffset(uCausticsMap, C.st, ivec2(0, 1)).s, i += textureOffset(uCausticsMap, C.st, ivec2(1, -1)).s, i += textureOffset(uCausticsMap, C.st, ivec2(1, 0)).s, i += textureOffset(uCausticsMap, C.st, ivec2(1, 1)).s, i *= s / 12.;
    }
    return i;
}
#endif
#if defined(CAUSTICS_COMPUTE)
void WriteCausticsRay(vec3 t, float i)
{
    vec2 s = t.sp * i * uCausticsRefractionScale, C = (gl_FragCoord.st + s * 2.) / uCausticsComputeResolution * uCausticsMapSize;
    highp float u = min(uCausticsFade.s / i * uCausticsFade.t, 7. * uCausticsFade.t), f = smoothstep(uCausticsFade.p, uCausticsFade.q, i), E = f * u * CAUSTICS_FIXED_POINT_SCALE;
    if (E >= 1.f)
        imageAtomicAdd(uCausticsIntegerMap, ivec2(C.st), uint(E));
}
#endif

#ifndef DEPTH_UTILS_INC
#define DEPTH_UTILS_INC
highp float GetViewSpaceDepth(highp float v, highp vec3 G)
{
    return G.s / (G.t * v + G.p);
}
highp vec4 GetViewSpaceDepth(highp vec4 v, highp vec3 G) { return G.s / (G.t * v + G.p); }
highp vec3 GetViewSpacePos(vec2 v, highp float G, highp mat4 f)
{
    highp vec4 m = vec4(2. * v - 1., 2. * G - 1., 1.), h = f * m;
    h.stp /= h.q;
    return h.stp;
}
highp vec4 GetWorldSpacePos(vec2 v, highp float G, highp mat4 f)
{
    highp vec4 m = vec4(2. * v - 1., 2. * G - 1., 1.), h = f * m;
    h = h / h.q;
    return h;
}
highp float GetViewSpaceDepthFromPos(vec3 v, mat4 G)
{
    vec3 h = vec3(G[0][2], G[1][2], G[2][2]);
    return dot(v, h);
}
#if defined(SAMPLER_2D_AUTO_MULTISAMPLE)
highp vec3 GetViewSpacePos(vec2 v, SAMPLER_2D_AUTO_MULTISAMPLE G, highp mat4 h)
{
    highp float m;
#if defined(VIEWPORTLOOKUPSCALE)
    m = texture2DMultisample(G, v, uViewportLookupScale.pq).s;
#else
    m = texture2DMultisample(G, v, textureSize(G)).s;
#endif
    return GetViewSpacePos(v, m, h);
}
highp vec3 GetViewSpacePos(vec2 v, vec4 G, vec2 h, SAMPLER_2D_AUTO_MULTISAMPLE f, highp mat4 m)
{
    highp float d = texture2DMultisample(f, v * G.pq + G.st, h).s;
    return GetViewSpacePos(v, d, m);
}
#endif
#endif

#ifndef NOISE_UTILS_INC
#define NOISE_UTILS_INC
vec4 permute(vec4 t)
{
    return mod((t * 34. + 1.) * t, 289.);
}
vec2 fade(vec2 t) { return t * t * t * (t * (t * 6. - 15.) + 10.); }
float cnoise(highp vec2 t)
{
    highp vec4 v = floor(t.stst) + vec4(0., 0., 1., 1.), d = fract(t.stst) - vec4(0., 0., 1., 1.);
    v = mod(v, 289.);
    vec4 p = v.spsp, s = v.ttqq, h = d.spsp, e = d.ttqq, f = permute(permute(p) + s), m = 2. * fract(f * .0243902) - 1., c = abs(m) - .5, q = floor(m + .5);
    m = m - q;
    vec2 N = vec2(m.s, c.s), r = vec2(m.t, c.t), o = vec2(m.p, c.p), a = vec2(m.q, c.q);
    vec4 G = 1.79284 - .853735 * vec4(dot(N, N), dot(o, o), dot(r, r), dot(a, a));
    N *= G.s;
    o *= G.t;
    r *= G.p;
    a *= G.q;
    float i = dot(N, vec2(h.s, e.s)), n = dot(r, vec2(h.t, e.t)), l = dot(o, vec2(h.p, e.p)), I = dot(a, vec2(h.q, e.q));
    vec2 u = fade(d.st), S = mix(vec2(i, l), vec2(n, I), u.s);
    float g = mix(S.s, S.t, u.t);
    return 2.3 * g;
}
highp float GetInterleavedGradientNoise(highp vec2 t) { return clamp(fract(52.9829 * fract(.0671106 * t.s + .00583715 * t.t)), 0., .999); }
#endif

#ifndef LIGHTING_UTILS_H
#define LIGHTING_UTILS_H
#ifndef LIGHTING_INC
#define LIGHTING_INC
#if __VERSION__ <= 120
#ifdef in
#undef in
#endif
#ifdef out
#undef out
#endif
#endif

#ifndef FRESNEL_INC
#define FRESNEL_INC
vec3 FresnelSchlick(vec3 F, float f, highp float h)
{
    vec3 c = F + (1. - F) * pow(1. - f, h);
    return c;
}
vec3 FresnelSchlickRoughness(vec3 f, float F, highp float h, float v)
{
    vec3 c = f + (max(vec3(v), f) - f) * pow(1. - F, h);
    return c;
}
float FresnelSchlick(float F, float f, highp float h)
{
    float c = F + (1. - F) * pow(1. - f, h);
    return c;
}
float FresnelSchlickRoughness(float f, float F, highp float h, float v)
{
    float c = f + (max(v, f) - f) * pow(1. - F, h);
    return c;
}
float FresnelSchlick(vec3 F, vec3 f, float c)
{
    float h = max(0., dot(F, f));
    return c + (1. - c) * pow(1. - h, 5.);
}
float Fresnel(vec3 F, vec3 f, float c, float h)
{
    float p = 1. - max(0., dot(F, f)), v = p * p;
    v = v * v;
    v = v * p;
    return clamp(v * (1. - clamp(h, 0., 1.)) + h - c, 0., 1.);
}
#endif

#ifndef BRDF_INC
#define BRDF_INC
#ifndef NDF_INC
#define NDF_INC
#ifndef MATH_UTILS_INC
#define MATH_UTILS_INC
const float PI = 3.14159, INV_PI = .31831, TWOPI = PI * 2., INV_TWOPI = 1. / TWOPI, PI_OVER_4 = PI / 4., PI_OVER_2 = PI / 2., SQRT_2_PI = .797885, INV_EIGHT = .125;
float SpecPowToBeckmannRoughness(float f) { return sqrt(2. / (f + 2.)); }
float PerceptualRoughnessToRoughness(float f) { return f * f; }
float RoughnessToPerceptualRoughness(float f) { return sqrt(f); }
#endif

float BlinnPhongNDF(float f, float N)
{
    return (f + 2.) * INV_EIGHT * pow(N, f);
}
float GGXTrowbridgeReitzNDF(float N, float f)
{
    float P = N * N, I = f * f, T = I * (P - 1.) + 1.;
    return P / (PI * (T * T + .0001));
}
float BeckmannNDF(float N, float f)
{
    float P = N * N, I = f * f;
    return exp((I - 1.) / (P * I)) / (PI * P * (I * I));
}
#endif

#ifndef VISIBILITY_FUNC_INC
#define VISIBILITY_FUNC_INC
#ifndef MATH_UTILS_INC
#define MATH_UTILS_INC
const float PI = 3.14159, INV_PI = .31831, TWOPI = PI * 2., INV_TWOPI = 1. / TWOPI, PI_OVER_4 = PI / 4., PI_OVER_2 = PI / 2., SQRT_2_PI = .797885, INV_EIGHT = .125;
float SpecPowToBeckmannRoughness(float f) { return sqrt(2. / (f + 2.)); }
float PerceptualRoughnessToRoughness(float f) { return f * f; }
float RoughnessToPerceptualRoughness(float f) { return sqrt(f); }
#endif

float SchlickSmithVis(float V, float f, float S)
{
    float P = 1. / sqrt(PI_OVER_4 * V + PI_OVER_2), d = 1. - P, v = (f * d + P) * (S * d + P);
    return 1. / (v + .0001);
}
float KelemenSzirmayKalosVis(vec3 V, vec3 P)
{
    vec3 f = V + P;
    return 4. / max(0., dot(f, f));
}
#endif

#define GGX_NDF
#define SCHLICK_SMITH_VIS
vec3 CookTorranceBRDF(float d, float S, vec3 n, vec3 v, vec3 f, vec3 B, vec3 R, float F)
{
    float m = max(0., dot(v, f)), r = 1.;
#if defined(BLINN_PHONG_NDF)
    r = BlinnPhongNDF(d, m);
#elif defined(GGX_NDF)
    r = GGXTrowbridgeReitzNDF(PerceptualRoughnessToRoughness(S), m);
#elif defined(BECKMANN_NDF)
    r = max(0.f, BeckmannNDF(SpecPowToBeckmannRoughness(d), m));
#else

#error CookTorranceBRDF normal distribution function not specified

#endif
    float C = 1.;
#if defined(SCHLICK_SMITH_VIS)
    C = SchlickSmithVis(d, F, max(0., dot(v, B)));
#elif defined(KELEMEN_SZIRMAY_KALOS_VIS)
    C = KelemenSzirmayKalosVis(R, B);
#endif
    return n * (r * C);
}
float RunescapeLegacyBRDF(vec3 d, vec3 v, vec3 f, float B, float S)
{
    vec3 n = reflect(-d, f);
    float C = pow(max(0., dot(n, v)), B);
    return C * S;
}
float RunescapeRT5BRDF(vec3 d, vec3 v, float S) { return BlinnPhongNDF(S, max(0., dot(d, v))); }
vec3 ShiftTangent(vec3 d, vec3 S, float B) { return normalize(d + B * S); }
vec3 AnisotropicBRDF(vec3 v, vec3 d, vec3 S, vec3 f, vec3 B, float n, float m, float R, float C)
{
    const float F = 7.5, r = 1., e = .5, o = 1.;
    float s = R - .5;
    S = ShiftTangent(S, d, e + (C * 2. - 1.) * o + s);
    float p = abs(dot(S, f)), a = 1. - p, t = 1. - abs(dot(S, B)), K = p * dot(d, B);
    K += a * t;
    K = pow(K, F) * n;
    K = mix(K, K * C, o);
    float G = pow(dot(d, v), m), P = mix(G, K, r);
    return vec3(P, P, P);
}
#endif

struct LightingTerms
{
    vec3 Diffuse;
    vec3 Specular;
};
void ClearLightingTerms(inout LightingTerms v) { v.Diffuse = vec3(0., 0., 0.), v.Specular = vec3(0., 0., 0.); }
void AddLightingTerms(inout LightingTerms v, LightingTerms L) { v.Diffuse += L.Diffuse, v.Specular += L.Specular; }
void EvaluateDirLightRT5(inout LightingTerms v, vec3 f, vec3 L, vec3 d, vec3 i, float S, float c, float F, float e, float E, vec3 A)
{
    v.Diffuse += A * e;
#if defined(SPECULAR_LIGHTING)
    vec3 G = normalize(d + i);
    float r = FresnelSchlick(S, clamp(dot(i, G), 0., 1.), F);
#if defined(ANISOTROPY_BRDF)
    vec3 D = AnisotropicBRDF(G, f, L, i, d, E, c, .5, .5);
#else
    vec3 n = vec3(r) * vec3(RunescapeRT5BRDF(G, f, c));
#endif
    n *= A * e;
    v.Specular += n;
#endif
}
void EvaluateDirLightRT7(inout LightingTerms v, vec3 f, vec3 L, vec3 d, vec3 i, vec3 S, float c, float E, float G, float e, float F, vec3 A)
{
    v.Diffuse += A * e;
#if defined(SPECULAR_LIGHTING)
    vec3 r = normalize(d + i), n = FresnelSchlick(S, clamp(dot(i, r), 0., 1.), G);
#if defined(ANISOTROPY_BRDF)
    vec3 D = AnisotropicBRDF(r, f, L, i, d, F, c, .5, .5);
#else
    vec3 C = CookTorranceBRDF(c, E, n, f, r, d, i, F);
#endif
    C *= A * e;
    v.Specular += C;
#endif
}
float SpecularHorizonOcclusion(float L, vec3 i, vec3 v)
{
    vec3 d = reflect(i, v);
    float A = clamp(1. + L * dot(d, v), 0., 1.);
    A *= A;
    return A;
}
#if __VERSION__ <= 120
#define in varying
#define out varying
#endif

#endif

#if !defined(DEFERRED_SHADOWS)
LightingTerms EvaluateSunlightRT5(inout int i, inout float E, highp vec4 v, vec3 u, vec3 f, float d, vec3 n, float p, float S, float r)
{
    float t = max(0., dot(u, uInvSunDirection)), L = t;
    E = 1.;
#if defined(SUNLIGHT_SHADOWS)
    if (S == 0. && uMappingParams.p != 0.)
    {
        if (L > 0.)
        {
            highp vec4 h = uSunlightViewMatrix * v, e = vec4(u.st, 0., 0.) * 32.;
            E = DirLightShadowAtten(i, v + e, h + e, d, uSunlightShadowMap, uSunlightShadowTranslucencyMap, r);
        }
    }
#endif
    L *= E;
    float h = .65;
    LightingTerms D;
    ClearLightingTerms(D);
    EvaluateDirLightRT5(D, u, f, n, uInvSunDirection, h, p, 5., L, t, uSunColour);
    return D;
}
#else
LightingTerms EvaluateSunlightRT5(inout float E, vec3 u, vec3 v, vec3 f, vec2 d, float n, float S)
{
    float t = max(0., dot(u, uInvSunDirection)), L = t;
    E = 1.;
#if defined(SUNLIGHT_SHADOWS) && defined(DEFERRED_SHADOWS)
    if (S == 0. && uMappingParams.p != 0.)
        E = texture2DLod(uShadowBuffer, d, 0.).s;
#endif
    L *= E;
    float h = .65;
    LightingTerms D;
    ClearLightingTerms(D);
    EvaluateDirLightRT5(D, u, v, f, uInvSunDirection, h, n, 5., L, uSunColour);
    return D;
}
#endif
#if !defined(DEFERRED_SHADOWS)
LightingTerms EvaluateSunlightRT7(inout int u, inout float E, highp vec4 v, vec3 f, vec3 d, float n, vec3 h, vec3 L, float p, float i, float t, float S)
{
    float D = max(0., dot(f, uInvSunDirection)), e = D;
    E = 1.;
#if defined(SUNLIGHT_SHADOWS)
    if (uMappingParams.p != 0.)
    {
        if (D > 0.)
        {
            highp vec4 r = uSunlightViewMatrix * v, a = vec4(f.st, 0., 0.) * 32.;
            E = DirLightShadowAtten(u, v + a, r + a, n, uSunlightShadowMap, uSunlightShadowTranslucencyMap, S);
        }
    }
#endif
    e *= E;
    LightingTerms r;
    ClearLightingTerms(r);
    EvaluateDirLightRT7(r, f, d, h, uInvSunDirection, L, p, i, t, e, D, uSunColour);
    return r;
}
#else
LightingTerms EvaluateSunlightRT7(inout float E, vec3 u, vec3 v, vec3 f, vec2 d, vec3 n, float h, float L, float r)
{
    float t = max(0., dot(u, uInvSunDirection)), p = t;
    E = 1.;
#if defined(SUNLIGHT_SHADOWS) && defined(DEFERRED_SHADOWS)
    if (uMappingParams.p != 0.)
        E = texture2DLod(uShadowBuffer, d, 0.).s;
#endif
    LightingTerms D;
    ClearLightingTerms(D);
    EvaluateDirLightRT7(D, u, v, f, uInvSunDirection, n, h, L, r, t, p, uSunColour);
    return D;
}
#endif
#endif

#ifndef DISTANCE_FOG_UNIFORMS
#define DISTANCE_FOG_UNIFORMS
#if defined(FOG_DISTANCE)
UNIFORM_BUFFER_BEGIN(DistanceFog)
uniform mediump vec4 uFogColour;
uniform highp vec4 uFogParams;
UNIFORM_BUFFER_END
#endif
#endif

#ifndef DISTANCE_FOG_FUNCTIONS
#define DISTANCE_FOG_FUNCTIONS
#if defined(FOG_DISTANCE)
float FogBasedOnDistance(highp float f)
{
    highp float F = (uFogParams.t - f) * uFogParams.s;
    return 1. - clamp(F, 0., 1.);
}
float FogBasedOnAngle(highp vec3 f)
{
    highp float F = 1. - clamp(f.t + uFogParams.q, 0., 1.);
    F = pow(F, uFogParams.p);
    return clamp(F, 0., 1.);
}
#endif
#endif

#if __VERSION__ <= 120
#ifdef in
#undef in
#endif
#ifdef out
#undef out
#endif
#endif

float GenerateNoise()
{
    const float d = 512., v = .125;
    return clamp(cnoise(vPosition_WaterDepth.sp / d) * v, 0., 1.);
}
vec2 GetCombinedFlow() { return vNoisyPatchFlow0_NoisyPatchFlow1.st * vFlowControlMask_ViewSpaceDepth.s + vNoisyPatchFlow0_NoisyPatchFlow1.pq * vFlowControlMask_ViewSpaceDepth.t + vNoisyPatchFlow2_UVPack_NormalsFlow0Map0.st * vFlowControlMask_ViewSpaceDepth.p; }
#if defined(WATER_NORMAL_MAPS)
vec4 WeightedNormalMap_XY_DXDY(highp float v, sampler2D d, vec2 f, vec2 p, float E)
{
    if (v <= 0.)
        return vec4(0.);
    vec3 u = UnpackNormal(texture2D(d, f));
    vec2 t = u.st / u.p;
    const float W = 6.;
    float q = clamp(length(p) * W + uWaterStillWaterNormalStrength_spareyzw.s, 0., 1.);
    return vec4(u.st, t * q) * v * E;
}
vec2 GetNormalDXDYWeightedSum(highp vec4 d, highp vec4 v, highp vec4 u, vec2 f, vec2 p, vec2 t, vec2 W, float E)
{
    vec4 h = vec4(0.);
    h += WeightedNormalMap_XY_DXDY(d.s, uWaterNormalMapTexture0, f, W, 1.);
    p += h.st * v.t * E;
    h += WeightedNormalMap_XY_DXDY(v.s, uWaterNormalMapTexture1, p, W, 1.);
    t += h.st * u.t * E;
    h += WeightedNormalMap_XY_DXDY(u.s, uWaterNormalMapTexture2, t, W, 1.);
    return h.pq;
}
vec3 WaterDetailNormalWeightedSum(vec2 v, vec2 p, vec2 d, vec2 f, vec3 h)
{
    const float u = .5;
    vec2 t = v + h.st * u * uSampleWeight_uvDistortion_sparezw[0].t, q = p + h.st * u * uSampleWeight_uvDistortion_sparezw[1].t, s = d + h.st * u * uSampleWeight_uvDistortion_sparezw[2].t;
    const float E = .8;
    vec2 W = GetNormalDXDYWeightedSum(uSampleWeight_uvDistortion_sparezw[0], uSampleWeight_uvDistortion_sparezw[1], uSampleWeight_uvDistortion_sparezw[2], t, q, s, f, E);
    return normalize(vec3(W, 1.));
}
#if !defined(GLES2_COMPAT_MODE)
vec3 WaterMacroNormalWeightedSum()
{
    const float d = .25;
    const vec2 v = vec2(.1, -.13) * d;
    const float f = .1;
    vec2 p = GetNormalDXDYWeightedSum(uMacroSampleWeight_uvDistortion_sparezw[0], uMacroSampleWeight_uvDistortion_sparezw[1], uMacroSampleWeight_uvDistortion_sparezw[2], vUVPack_NormalMapMacroUV_EmissiveUV[0].st, vUVPack_NormalMapMacroUV_EmissiveUV[1].st, vUVPack_NormalMapMacroUV_EmissiveUV[2].st, v, f);
    return normalize(vec3(p, 1.));
}
#else
vec3 WaterMacroNormalWeightedSum()
{
    const float d = .25;
    const vec2 v = vec2(.1, -.13) * d;
    const float f = .1, p = .1;
    vec2 W = vPosition_WaterDepth.sp * uWaterNormalMapTextureScales_FlowNoiseScale.s * p, u = vPosition_WaterDepth.sp * uWaterNormalMapTextureScales_FlowNoiseScale.t * p, t = vPosition_WaterDepth.sp * uWaterNormalMapTextureScales_FlowNoiseScale.p * p;
    const float E = .01;
    vec2 q = vec2(.1, -.13), s = vec2(-.08, .1), r = vec2(.11, -.9);
    const float n = .5;
    highp float m = uWaterTickFade.s * n;
    vec2 h = W + q * d * m, e = u + s * d * m, c = t + r * d * m, G = GetNormalDXDYWeightedSum(uMacroSampleWeight_uvDistortion_sparezw[0], uMacroSampleWeight_uvDistortion_sparezw[1], uMacroSampleWeight_uvDistortion_sparezw[2], h, e, c, v, f);
    return normalize(vec3(G, 1.));
}
#endif
vec3 WaterNormal()
{
    vec3 v = WaterMacroNormalWeightedSum(), u = vec3(0.);
    vec2 f = vNoisyPatchFlow0_NoisyPatchFlow1.pq - vNoisyPatchFlow0_NoisyPatchFlow1.st, p = vNoisyPatchFlow2_UVPack_NormalsFlow0Map0.st - vNoisyPatchFlow0_NoisyPatchFlow1.st, t = vec2(0., 0.), q = vec2(0., 0.), s = vec2(0., 0.), W = vec2(0., 0.), r = vec2(0., 0.), c = vec2(0., 0.), i = vec2(0., 0.), h = vec2(0., 0.), e = vec2(0., 0.);
#if !defined(GLES2_COMPAT_MODE)
    t = vNoisyPatchFlow2_UVPack_NormalsFlow0Map0.pq;
    q = vUVPack_NormalsFlow0Map1_NormalsFlow0Map2.st;
    s = vUVPack_NormalsFlow0Map1_NormalsFlow0Map2.pq;
    W = vUVPack_NormalsFlow1Map0_NormalsFlow1Map1.st;
    r = vUVPack_NormalsFlow1Map0_NormalsFlow1Map1.pq;
    c = vUVPack_NormalsFlow1Map2_NormalsFlow2Map0.st;
    i = vUVPack_NormalsFlow1Map2_NormalsFlow2Map0.pq;
    h = vUVPack_NormalsFlow2Map1_NormalsFlow2Map2.st;
    e = vUVPack_NormalsFlow2Map1_NormalsFlow2Map2.pq;
#else
    vec2 d = vNoisyPatchFlow2_UVPack_NormalsFlow0Map0.pq, m = vUVPack_NormalsFlow1Map0_NormalsFlow2Map0.st, E = vUVPack_NormalsFlow1Map0_NormalsFlow2Map0.pq;
    t = d;
    q = d * vec2(-.96, .95);
    s = d * vec2(.97, -.94);
    W = m;
    r = m * vec2(-.96, .95);
    c = m * vec2(.97, -.94);
    i = E;
    h = E * vec2(-.96, .95);
    e = E * vec2(.97, -.94);
#endif
    const float G = 1e-07;
    if (dot(f, f) <= G && dot(p, p) <= G)
        u = WaterDetailNormalWeightedSum(t, q, s, vNoisyPatchFlow0_NoisyPatchFlow1.st, v) + v;
    else
        u += (WaterDetailNormalWeightedSum(t, q, s, vNoisyPatchFlow0_NoisyPatchFlow1.st, v) + v) * vFlowControlMask_ViewSpaceDepth.s, u += (WaterDetailNormalWeightedSum(W, r, c, vNoisyPatchFlow0_NoisyPatchFlow1.pq, v) + v) * vFlowControlMask_ViewSpaceDepth.t, u += (WaterDetailNormalWeightedSum(i, h, e, vNoisyPatchFlow2_UVPack_NormalsFlow0Map0.st, v) + v) * vFlowControlMask_ViewSpaceDepth.p;
    return normalize(u).spt;
}
#else
vec3 WaterNormal()
{
    return vec3(0., 1., 0.);
}
#endif
vec3 WaterAlbedo(float v, float d, float E)
{
    vec3 f = vColour.stp;
#if defined(WATER_FOAM_MAP)
    float p = uWaterFoamScaleFoamDepth.t, u = clamp((1. - step(p, 0.)) * min(1., 1. - min(v / p, 1.)), 0., 1.), q = uWaterTickFade.s + vPosition_WaterDepth.s * .0001 + vPosition_WaterDepth.p * .0001, t = pow(max(0., cos(abs(v) * .005 + q + E * 4.)), 8.), s = pow(max(0., cos(abs(v) * .005 - q + E * 8.)), 4.), r = min(1., t + s * u) * max(.2 - d, 0.);
#if !defined(GLES2_COMPAT_MODE)
    vec4 h = texture2D(uWaterTextureFoam, vUVPack_FoamUV.st) * uWaterFoamScaleFoamDepth.s;
    vec3 W = h.stp * h.q;
    f = mix(vColour.stp, W, r * u);
#else
    f = vColour.stp;
#endif

#endif
    return f;
}
float WaterSoftEdgeAlpha(float v)
{
    const float p = .004, u = 1.;
    float f;
#if defined(WATER_EXTINCTION)
    const float d = .002;
    float W = uWaterExtinctionVisibilityMetres / d, t = p + 1. / (W + .001), s = pow(v * t, u);
    f = clamp(s, 0., 1.);
#else
    float q = pow(v * p, u);
    f = clamp(q, 0., 1.);
#endif
    return f;
}
float SunLightShadowAttenuation(vec3 d, vec3 p, vec2 v, vec3 f, float E)
{
    float W = 1.;
#if defined(SUNLIGHT_SHADOWS)
    int u = -1;
    vec4 t = uSunlightViewMatrix * vec4(vPosition_WaterDepth.stp, 1.);
    W = DirLightShadowAtten(u, vec4(vPosition_WaterDepth.stp, 1.) + vec4(v, 0., 0.), t + vec4(v, 0., 0.), vFlowControlMask_ViewSpaceDepth.q, uSunlightShadowMap, uSunlightShadowTranslucencyMap, 1.);
#endif
    return W;
}
vec3 SunLightDiffuseContribution(vec3 v, vec3 d, vec2 p, vec3 f, float E, float u)
{
    vec3 r = vec3(0.);
#if defined(SUNLIGHT_DIRECT_LIGHTING)
    r = v * (dot(d, uInvSunDirection) * .5 + .5) * (1. - E) * uSunColour;
#else
    const float W = 2.;
    r = v * W;
#endif
    return r * u;
}
vec3 SunLightSpecularContribution(vec3 d, vec3 v, vec2 p, vec3 f, float t, float E)
{
    vec3 W = vec3(0.);
#if defined(SPECULAR_LIGHTING)
    vec3 u = normalize(uInvSunDirection - f);
    float q = clamp(dot(u, v), 0., 1.);
    W = uSunColour * uSunColour * t * clamp(uInvSunDirection.t, 0., 1.) * pow(q, uWaterNormalBRDFParams.p * .25) * (uWaterNormalBRDFParams.q * 1.8 + .2) * clamp(uWaterNormalBRDFParams.q - .05, 0., 1.) * 25.;
#endif
    return W * E;
}
#if defined(GLOBAL_ENVIRONMENTMAPPING)
vec3 GetEnvironmentMapReflection(vec3 v, vec3 f)
{
    vec3 u = reflect(v, f);
    u.p = -u.p;
    u.t = abs(u.t);
    vec3 d = textureCubeSRGB(uGlobalEnvironmentMap, u).stp;
#if defined(FOG_DISTANCE)
    float E = FogBasedOnAngle(normalize(reflect(v, f)));
    d = mix(d.stp, uFogColour.stp, E);
#endif
    return d;
}
#endif
vec3 EnvMapContribution(vec3 v, vec3 f, vec3 d, float E)
{
    vec3 W = vec3(0.);
    float u = 1.;
#if defined(GLOBAL_ENVIRONMENTMAPPING)

#if defined(REFLECTION)
    u = uWaterReflectionStrength;
    if (uWaterReflectionMapContribution < 1.)
#endif
    {
        vec3 t = GetEnvironmentMapReflection(d, f);
#if defined(REFLECTION)
        t *= 1. - uWaterReflectionMapContribution;
#endif
        W = t * mix(v, vec3(1., 1., 1.), E);
    }
#endif
    return W * u;
}
vec3 WaterReflection(vec3 v, vec3 f, vec2 d, vec3 p, float E)
{
    vec3 W = vec3(0.);
#if defined(REFLECTION)
    vec2 u = uViewportOffsetScale.st * uFullScreenLookupScale.pq, h = gl_FragCoord.st + d;
    h = (h - u) * uViewportLookupScale.st;
    vec4 r = texture2DLodCompat(uReflectionMap, vec2(1. - h.s, h.t), 0.);
    if (r.q < 1.)
    {
        h = gl_FragCoord.st;
        h = (h - u) * uViewportLookupScale.st;
        r = texture2DLodCompat(uReflectionMap, vec2(1. - h.s, h.t), 0.);
#if defined(GLOBAL_ENVIRONMENTMAPPING)
        if (r.q == 0.)
            r.stp = GetEnvironmentMapReflection(p, f), r.q = 1.;
#endif
    }
    W = r.stp * mix(v, vec3(1.), E) * uWaterReflectionMapContribution * uWaterReflectionStrength;
#endif
    return W;
}
vec3 WaterExtinction(vec3 v, vec3 d, float f, vec2 p, vec3 W, float E)
{
    vec3 t = d;
#if defined(WATER_EXTINCTION) && defined(REFRACTION)
    const float u = .002;
    if (uWaterFeatureFlags.t >= 1.)
    {
        vec3 h = GetWorldSpacePos(p, f, uSceneInvViewProjMatrix).stp;
        float r = length(h - vPosition_WaterDepth.stp) * u;
        highp float q = abs(h.t - vPosition_WaterDepth.t) * u, s = mix(.04, 1., clamp(uWaterExtinctionVisibilityMetres, 0., 1.));
        vec3 m = W / v, c = v / max(max(v.s, v.t), v.p), n = m * c, e = uWaterExtinctionOpaqueWaterColour * n;
        float G = clamp(r / uWaterExtinctionVisibilityMetres, 0., 1.), S = pow(G, s);
        vec3 i = mix(d, e, S);
        const float N = .25;
        vec3 C = clamp(q / (uWaterExtinctionRGBDepthMetres * c), 0., 1.), P = pow(C, vec3(N));
        t = i * (1. - P);
        t = mix(d, t, E);
    }
#endif
    return t;
}
vec3 WaterRefractionWithExtinction(vec3 v, vec3 d, float p, float t, vec3 f, float u)
{
    vec3 W = vec3(0.);
#if defined(REFRACTION)
    vec2 E = uViewportOffsetScale.st * uFullScreenLookupScale.pq;
    vec3 q = vec3(0.);
    float r = 0.;
    highp vec2 h = d.sp * min(sqrt(p) * u * 2., 128.);
    vec2 s = gl_FragCoord.st + h * t * 2.;
    s = (s - E) * uViewportLookupScale.st;
    if (uWaterFeatureFlags.s >= 1.)
    {
#if !defined(NXT_MOBILE)
        r = texture2DLodCompat(uRefractionDepth, s, 0.).s;
        if (r < gl_FragCoord.p || r >= 1.)
            s = gl_FragCoord.st, s = (s - E) * uViewportLookupScale.st;
#endif
        q = texture2DLodCompat(uRefractionMap, vec3(s, 0.), 0.).stp;
    }
    W = WaterExtinction(v, q, r, s, f, u);
#endif
    return W;
}
#if defined(WATER_EMISSIVE) && !defined(GLES2_COMPAT_MODE)
#define EMISSIVE_MAP_MASK (0)
#define EMISSIVE_MAP_RGBMAP_MASK (1)
vec4 SampleEmissiveMap(sampler2D v, vec2 E)
{
    vec2 u = vUVPack_NormalMapMacroUV_EmissiveUV[1].pq - vUVPack_NormalMapMacroUV_EmissiveUV[0].pq, p = vUVPack_NormalMapMacroUV_EmissiveUV[2].pq - vUVPack_NormalMapMacroUV_EmissiveUV[0].pq;
    const float W = 1e-07;
    if (dot(u, u) <= W && dot(p, p) <= W)
        return texture2D(v, vUVPack_NormalMapMacroUV_EmissiveUV[0].pq + E);
    else
    {
        vec4 f = texture2D(v, vUVPack_NormalMapMacroUV_EmissiveUV[0].pq + E) * vFlowControlMask_ViewSpaceDepth.s;
        f += texture2D(v, vUVPack_NormalMapMacroUV_EmissiveUV[1].pq + E) * vFlowControlMask_ViewSpaceDepth.t;
        f += texture2D(v, vUVPack_NormalMapMacroUV_EmissiveUV[2].pq + E) * vFlowControlMask_ViewSpaceDepth.p;
        return f;
    }
}
vec4 EmissiveContribution_Mask(vec3 v, vec2 f)
{
    float E = SampleEmissiveMap(uWaterEmissiveMapTexture, f).s;
    vec3 d = mix(v, uWaterEmissiveColourEmissiveSource.stp, uWaterEmissiveColourEmissiveSource.q);
    float W = uEmissiveScale_MapRefractionDepth_EmissiveMapMode_EmissiveMapExists.s;
    return vec4(d * (1. + W), E);
}
vec4 EmissiveContribution_RGBMapMask(vec3 v, vec2 f)
{
    vec4 h = SampleEmissiveMap(uWaterEmissiveMapTexture, f);
    vec3 d = mix(v, h.stp * uWaterEmissiveColourEmissiveSource.stp, uWaterEmissiveColourEmissiveSource.q);
    float E = uEmissiveScale_MapRefractionDepth_EmissiveMapMode_EmissiveMapExists.s;
    return vec4(d * (1. + E), h.q);
}
vec4 EmissiveContribution_NoMap(vec3 v)
{
    vec3 d = mix(v, uWaterEmissiveColourEmissiveSource.stp, uWaterEmissiveColourEmissiveSource.q);
    float E = uEmissiveScale_MapRefractionDepth_EmissiveMapMode_EmissiveMapExists.s;
    return vec4(d * (1. + E), 1.);
}
vec4 EmissiveContribution(vec3 v, vec3 d, float E)
{
    int W = int(uEmissiveScale_MapRefractionDepth_EmissiveMapMode_EmissiveMapExists.q);
    if (W == 0)
        return EmissiveContribution_NoMap(v);
    vec2 f = d.sp * uEmissiveScale_MapRefractionDepth_EmissiveMapMode_EmissiveMapExists.t * E * 2.;
    int u = int(uEmissiveScale_MapRefractionDepth_EmissiveMapMode_EmissiveMapExists.p);
    if (u == EMISSIVE_MAP_MASK)
        return EmissiveContribution_Mask(v, f);
    else
        return EmissiveContribution_RGBMapMask(v, f);
}
#endif
#if (defined(SUNLIGHT_SHADOWS) && defined(DEBUG_SUNLIGHT_SHADOW_CASCADE) && !defined(DEFERRED_SHADOWS)) || defined(DEBUG_ALBEDO) || defined(DEBUG_NORMALS)
#define WATER_DEBUG_OUTPUT
#endif
#if defined(WATER_DEBUG_OUTPUT)
void WaterWriteDebugColour(vec3 v, vec3 d)
{
#if defined(DEBUG_ALBEDO)
    gl_FragColor = vec4(v, 1.);
    if (uDebugReturn != 0.)
    {
        return;
    }
#endif

#if defined(DEBUG_NORMALS)
    gl_FragColor = vec4(d * .5 + .5, 1.);
    if (uDebugReturn != 0.)
    {
        return;
    }
#endif

#if defined(SUNLIGHT_SHADOWS) && defined(DEBUG_SUNLIGHT_SHADOW_CASCADE) && !defined(DEFERRED_SHADOWS)
    gl_FragColor = vec4(ShadowMapCascadeColour(iCascade, int(uMappingParams.q)).stp, 1.);
    if (uDebugReturn != 0.)
    {
        return;
    }
#endif
}
#endif
void WaterFragment()
{
    vec3 v = vPosition_WaterDepth.stp - uCameraPosition;
    float d = length(v);
    vec3 f = v / d;
    vec2 u = GetCombinedFlow();
    float p = length(u), E = GenerateNoise();
    vec3 W = WaterAlbedo(vPosition_WaterDepth.q, p, E), h = WaterNormal();
    vec2 t = h.sp * min(vPosition_WaterDepth.q, 32.);
    float q = WaterSoftEdgeAlpha(vPosition_WaterDepth.q);
    vec4 r = vec4(0.);
    r.q = q;
    const float s = .28, e = 0., c = .6;
    float G = clamp(FresnelSchlick(h, -f, s), e, c), S = clamp(G + uWaterNormalBRDFParams.s, e, c);
    r.q *= G;
    r.stp += WaterReflection(W, h, t, f, S);
    r.stp += EnvMapContribution(W, h, f, S);
    float N = SunLightShadowAttenuation(W, h, t, f, G);
    vec3 m = SunLightDiffuseContribution(W, h, t, f, G, N), n = SunLightSpecularContribution(W, h, t, f, S, N);
    r.stp += n;
#if defined(SUNLIGHT_DIRECT_LIGHTING) && (defined(LIGHT_SCATTERING) || defined(FOG_DISTANCE))
    vec3 i = vOutScattering, P = vInScattering;
    r.stp = ApplyInOutScattering(r.stp, i, P);
    r.q = mix(r.q, 1., vColour.q);
#endif

#if !defined(REFRACTION)
    r.stp += m;
#if defined(WATER_EMISSIVE) && !defined(GLES2_COMPAT_MODE)
    vec4 C = EmissiveContribution(W, h, G);
    r.stp = mix(r.stp, C.stp, C.q * q * uEmissiveBlend);
#endif

#else
    vec3 D = WaterRefractionWithExtinction(W, h, vPosition_WaterDepth.q, G, m, q);
#if defined(WATER_EMISSIVE) && !defined(GLES2_COMPAT_MODE)
    r.stp = mix(D, r.stp, G);
    vec4 g = EmissiveContribution(W, h, G);
    r.stp = mix(r.stp, g.stp, g.q * uEmissiveBlend);
    r.stp = mix(D, r.stp, q);
#else
    r.stp = mix(D, r.stp, r.q);
#endif

#endif

#if !defined(SUNLIGHT_DIRECT_LIGHTING)
    r.q = 1.;
#endif
    gl_FragColor = r;
#if defined(WATER_DEBUG_OUTPUT)
    WaterWriteDebugColour(W, h);
#endif
}
#if defined(CAUSTICS_STENCIL)
void CausticsStencil()
{
    gl_FragColor.s = float(texture2D(uCausticsMap, gl_FragCoord.st / uCausticsMapSize).s) * uCausticsScale / CAUSTICS_FIXED_POINT_SCALE;
}
#endif
#if defined(CAUSTICS_COMPUTE)
void CausticsCompute()
{
    vec3 v = WaterNormal();
    WriteCausticsRay(v, vPosition_WaterDepth.q);
    discard;
    return;
}
#endif
#if defined(CLIP_PLANE_CLAMP)
void ClipPlaneClamp()
{
    const float E = 200.;
    if (abs(vPosition_WaterDepth.t + uClipPlane.q) < E)
        gl_FragDepth = 1., gl_FragColor = vec4(uFogColour.stp, 1.);
    else
    {
        discard;
    }
}
#endif
void main()
{
#if defined(CLIP_PLANE_CLAMP)
    ClipPlaneClamp();
#elif defined(CAUSTICS_STENCIL)
    CausticsStencil();
#elif defined(CAUSTICS_COMPUTE)
    CausticsCompute();
#else
    WaterFragment();
#endif
}
