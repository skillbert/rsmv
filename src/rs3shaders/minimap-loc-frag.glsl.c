
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
#define AMBIENT_LIGHTING
#define DIFFUSE_LIGHTING
#define ALBEDO_LIGHTING
#define TEXTURE_ALBEDO_GLOBAL
#define SUNLIGHT_DIRECT_LIGHTING
#define TEXTURE_ATLAS
#define ALPHA_ENABLED
#define VIEW_TRANSFORMS
#define TINT

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

uniform highp float uTextureAnimationTime;

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
#ifndef LIGHT_SCATTERING_VS_UNIFORMS
#define LIGHT_SCATTERING_VS_UNIFORMS
UNIFORM_BUFFER_BEGIN(SimpleScattering)
uniform mediump vec3 uOutscatteringAmount;
uniform mediump vec3 uInscatteringAmount;
uniform mediump vec3 uScatteringTintColour;
uniform highp vec4 uScatteringParameters;
UNIFORM_BUFFER_END
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
uniform float uAlphaTestThreshold;
uniform vec4 uAtlasMeta;
uniform sampler2D uTextureAtlas;
uniform sampler2D uTextureAtlasSettings;
uniform samplerCube uGlobalEnvironmentMap;
uniform vec4 uGlobalEnvironmentMappingParams;
uniform vec4 uTint;
in highp vec3 vWorldPosition;
in highp vec3 vNormal;
in mediump vec4 vVertexAlbedo;
in vec2 vTextureUV;
flat in vec3 vMaterialSettingsSlotXY_BatchFlags;
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
#define SRGB_TEXTURES
#define STANDARD_DERIVATIVES
#define TEXTURE_LOD
#define TEXTURE_GRAD
#define TEXTURE_MIP_LIMIT
#define LOOKUP_MODE_DYNAMIC

#define TEXTURE_SETTINGS_USE_TEXEL_OFFSETS
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

float getMipMapLevel(vec2 v, vec2 p)
{
    float d = 0.;
#if defined(STANDARD_DERIVATIVES)
    float L = max(dot(v, v), dot(p, p));
    d = .5 * log2(L);
    d = max(0., d);
#endif
    return d;
}
#if defined(DEBUG_TEXEL_DENSITY)
vec3 GetTexelDensityDebugColour(vec2 v, float p, vec3 d)
{
    float t = length(fwidth(v) * p), s = length(fwidth(d)), L = t / s, h = uDebugTexelDensity.s, f = uDebugTexelDensity.t, o = uDebugTexelDensity.p, T = uDebugTexelDensity.q;
    vec3 c;
    c.s = smoothstep(f / (T + 1.), h, L);
    c.t = 1. - smoothstep(0., f * (T + 1.), abs(L - f));
    c.p = smoothstep(1. - (f + o * T), 1. - o, 1. - L);
    c *= c;
    return c;
}
#endif
#if defined(LOOKUP_MODE_DYNAMIC) && !defined(NO_SAMPLER_WRAP)
flat in mediump float vSamplerWrap;
#endif
#if __VERSION__ <= 120
#ifdef in
#undef in
#endif
#ifdef out
#undef out
#endif
#endif

void getTexelBias_inner(float v, highp vec2 t, highp vec3 d, highp vec3 p, highp vec3 s, vec4 c, vec2 m, vec2 g, float L, sampler2D f, out vec4 i, out vec4 h, out vec4 o)
{
    float T = c.s;
    highp float q = c.t, l = c.p;
    float P = c.q;
    highp vec3 S = vec3(d.s, p.s, s.s), y = vec3(d.t, p.t, s.t), a = vec3(d.p, p.p, s.p);
    const vec2 u = vec2(1.);
    vec3 D = .5 / a;
    highp vec2 r, C, Y;
#if !defined(LOOKUP_MODE_CLAMP) && !defined(LOOKUP_MODE_REPEAT)
    const float G = .5, e = .25, n = .125, E = .0625;
    vec4 O = step(.5, fract(L * vec4(G, e, n, E)));
#endif

#if defined(LOOKUP_MODE_CLAMP)
    r = clamp(t, vec2(D.s), u - vec2(D.s));
#elif defined(LOOKUP_MODE_REPEAT)
    r = mod(t, u);
#else
    const vec2 N = vec2(.5), M = vec2(2.);
    vec2 x = clamp(t, vec2(D.s), u - vec2(D.s)), R = mod(t, u), A = t - M * floor(N * t), U = u - abs(u - A);
    r = O.st * x + O.pq * R + (u - O.st - O.pq) * U;
#endif
    r = r * a.s * l;
    r += vec2(S.s, y.s) * q * l;
    if (v > 1.)
    {
#if defined(LOOKUP_MODE_CLAMP)
        C = clamp(t, vec2(D.t), u - vec2(D.t));
#elif defined(LOOKUP_MODE_REPEAT)
        C = mod(t, u);
#else
        vec2 I = clamp(t, vec2(D.t), u - vec2(D.t)), K = R, B = U;
        C = O.st * I + O.pq * K + (u - O.st - O.pq) * B;
#endif
        C = C * a.t * l;
        C += vec2(S.t, y.t) * q * l;
        if (v > 2.)
        {
#if defined(LOOKUP_MODE_CLAMP)
            Y = clamp(t, vec2(D.p), u - vec2(D.p));
#elif defined(LOOKUP_MODE_REPEAT)
            Y = mod(t, u);
#else
            vec2 b = clamp(t, vec2(D.p), u - vec2(D.p)), X = R, V = U;
            Y = O.st * b + O.pq * X + (u - O.st - O.pq) * V;
#endif
            Y = Y * a.p * l;
            Y += vec2(S.p, y.p) * q * l;
        }
    }
    h = vec4(0.);
    o = vec4(0.);
#if defined(TEXTURE_MIP_LIMIT)

#if defined(TEXTURE_GRAD)
    highp vec2 I = m * l, K = g * l, B = I * a.s, X = K * a.s;
    const vec2 b = vec2(.025);
    B = clamp(B, -b, b);
    X = clamp(X, -b, b);
    i = texture2DGrad(f, r, B, X);
    if (v > 1.)
    {
        B = I * a.t;
        X = K * a.t;
        B = clamp(B, -b, b);
        X = clamp(X, -b, b);
        h = texture2DGrad(f, C, B, X);
        if (v > 2.)
            B = I * a.p, X = K * a.p, B = clamp(B, -b, b), X = clamp(X, -b, b), o = texture2DGrad(f, Y, B, X);
    }
#else
    i = texture2D(f, r);
    if (v > 1.)
    {
        h = texture2D(f, C);
        if (v > 2.)
            o = texture2D(f, Y);
    }
#endif

#else

#if defined(TEXTURE_LOD)
    vec2 V = m * a.s, W = g * a.s;
    float F = getMipMapLevel(V, W);
    F = min(F, P);
    i = texture2DLod(f, r, F);
    if (v > 1.)
    {
        V = m * a.t;
        W = g * a.t;
        F = getMipMapLevel(V, W);
        F = min(F, P);
        h = texture2DLod(f, C, F);
        if (v > 2.)
            V = m * a.p, W = g * a.p, F = getMipMapLevel(V, W), F = min(F, P), o = texture2DLod(f, Y, F);
    }
#else
    i = texture2D(f, r);
    if (v > 1.)
    {
        h = texture2D(f, C);
        if (v > 2.)
            o = texture2D(f, Y);
    }
#endif

#endif
}
void getTexel_inner(float v, vec2 f, highp vec3 d, highp vec3 t, highp vec3 p, vec4 s, vec2 h, vec2 o, float b, sampler2D B, out vec4 D, out vec4 L, out vec4 u)
{
    getTexelBias_inner(v, f, d, t, p, s, h, o, b, B, D, L, u);
#if defined(SRGB_TEXTURES)
    if (v > 1.)
        L = vec4(LinearToSRGB(L.stp), L.q);
    if (v > 2.)
        u = vec4(LinearToSRGB(u.stp), u.q);
#else
    D = vec4(SRGBToLinear(D.stp), D.q);
#endif
}
void getTexel_inner(float v, vec2 f, highp vec3 d, highp vec3 t, highp vec3 p, vec4 s, float h, sampler2D o, out vec4 b, out vec4 B, out vec4 u)
{
    vec2 X = vec2(0.), i = vec2(0.);
#if defined(STANDARD_DERIVATIVES)
    X = dFdx(f);
    i = dFdy(f);
#endif
    getTexel_inner(v, f, d, t, p, s, X, i, h, o, b, B, u);
}
void getTexel(vec2 v, highp vec3 o, vec4 h, vec2 g, vec2 s, float f, sampler2D e, out vec4 c)
{
    vec3 t = vec3(1.), l = vec3(1.);
    vec4 i = vec4(0.), p = vec4(0.);
    getTexel_inner(1., v, o, t, l, h, g, s, f, e, c, i, p);
}
void getTexel(vec2 v, highp vec3 o, vec4 h, float g, sampler2D s, out vec4 f)
{
    vec3 e = vec3(1.), l = vec3(1.);
    vec4 t = vec4(0.), p = vec4(0.);
    getTexel_inner(1., v, o, e, l, h, g, s, f, t, p);
}
void getTexel(vec2 v, highp vec3 o, highp vec3 h, vec4 g, vec2 s, vec2 f, float e, sampler2D t, out vec4 l, out vec4 p)
{
    vec3 i = vec3(1.);
    vec4 c = vec4(0.);
    getTexel_inner(2., v, o, h, i, g, s, f, e, t, l, p, c);
}
void getTexel(vec2 v, highp vec3 o, highp vec3 h, vec4 g, float s, sampler2D f, out vec4 e, out vec4 t)
{
    vec3 l = vec3(1.);
    vec4 p = vec4(0.);
    getTexel_inner(2., v, o, h, l, g, s, f, e, t, p);
}
void getTexel(vec2 v, highp vec3 o, highp vec3 h, highp vec3 g, vec4 s, vec2 f, vec2 e, float t, sampler2D l, out vec4 p, out vec4 i, out vec4 c) { getTexel_inner(3., v, o, h, g, s, f, e, t, l, p, i, c); }
void getTexel(vec2 v, highp vec3 o, highp vec3 h, highp vec3 g, vec4 s, float f, sampler2D e, out vec4 t, out vec4 l, out vec4 p) { getTexel_inner(3., v, o, h, g, s, f, e, t, l, p); }

#if __VERSION__ <= 120
#define in varying
#define out varying
#endif

#ifndef TEXTURE_SETTINGS_INC
#define TEXTURE_SETTINGS_INC
struct TextureSettings
{
    highp vec3 textureMeta1;
    highp vec3 textureMeta2;
    highp vec2 uvAnim;
    float wrapping;
    float specular;
    float normalScale;
#if defined(REFRACTION)
    vec4 refraction;
#endif
#if defined(VIEWPORTMAP)
    vec4 viewportMapUVScaleAndAnim;
#endif
#if defined(DEBUG_MATERIAL_HIGHLIGHT)
    highp float materialID;
#endif
};
#if __VERSION__ <= 120
#ifdef in
#undef in
#endif
#ifdef out
#undef out
#endif
#endif

void getTextureSettings(vec2 s, out TextureSettings v)
{
    const highp float d = 1. / 255., S = 1. / 65535., e = 32767., t = 1. / 32767.;
    const float f = 1. / MATERIAL_SETTINGS_TEXTURE_RESOLUTION;
    vec2 i = (floor(s + .5) * vec2(MATERIAL_SETTINGS_SLOT_PIXEL_RESOLUTION_X, MATERIAL_SETTINGS_SLOT_PIXEL_RESOLUTION_Y) + .5) * f;
    const float u = f;
    vec4 T = texture2DLodCompat(uTextureAtlasSettings, i, 0.), U, n, D, m, a, R;
    float h;
    vec4 r;
#if defined(TEXTURE_SETTINGS_USE_TEXEL_OFFSETS)

#define SAMPLE_OFFSET_SLOTSIZES_AND_WRAPPING ivec2(2, 0)

#define SAMPLE_OFFSET_UV_ANIM ivec2(0, 1)

#define SAMPLE_OFFSET_SPECULAR_NORMAL_SCALE ivec2(1, 1)

#define SAMPLE_OFFSET_REFRACTION ivec2(0, 2)

#define SAMPLE_OFFSET_SLOTETC ivec2(1, 2)

#define SAMPLE_OFFSET_VIEWPORTMAP_UVSCALE ivec2(2, 2)

#define SAMPLE_OFFSET_VIEWPORTMAP_UVANIMATION ivec2(0, 3)

#define SAMPLE_OFFSET_DEBUG ivec2(2, 3)
    U = textureLodOffset(uTextureAtlasSettings, i, 0., SAMPLE_OFFSET_SLOTSIZES_AND_WRAPPING);
    n = textureLodOffset(uTextureAtlasSettings, i, 0., SAMPLE_OFFSET_UV_ANIM);
#if defined(SPECULAR_LIGHTING) || defined(USE_NORMAL_MAP)
    D = textureLodOffset(uTextureAtlasSettings, i, 0., SAMPLE_OFFSET_SPECULAR_NORMAL_SCALE);
#endif

#if defined(REFRACTION)
    m = textureLodOffset(uTextureAtlasSettings, i, 0., SAMPLE_OFFSET_REFRACTION);
#endif
    h = textureLodOffset(uTextureAtlasSettings, i, 0., SAMPLE_OFFSET_SLOTETC).q;
#if defined(VIEWPORTMAP)
    a = textureLodOffset(uTextureAtlasSettings, i, 0., SAMPLE_OFFSET_VIEWPORTMAP_UVSCALE);
    R = textureLodOffset(uTextureAtlasSettings, i, 0., SAMPLE_OFFSET_VIEWPORTMAP_UVANIMATION);
#endif

#if defined(DEBUG_MATERIAL_HIGHLIGHT)
    r = textureLodOffset(uTextureAtlasSettings, i, 0., SAMPLE_OFFSET_DEBUG);
#endif

#else
    vec2 g = vec2(u * 2., 0.), o = vec2(0., u), M = vec2(u, u), p = vec2(0., u * 2.), X = vec2(u, u * 2.), q = vec2(u * 2., u * 2.), E = vec2(0., u * 3.), A = vec2(u * 2., u * 3.);
    U = texture2DLodCompat(uTextureAtlasSettings, i + g, 0.);
    n = texture2DLodCompat(uTextureAtlasSettings, i + o, 0.);
#if defined(SPECULAR_LIGHTING) || defined(USE_NORMAL_MAP)
    D = texture2DLodCompat(uTextureAtlasSettings, i + M, 0.);
#endif

#if defined(REFRACTION)
    m = texture2DLodCompat(uTextureAtlasSettings, i + p, 0.);
#endif
    h = texture2DLodCompat(uTextureAtlasSettings, i + X, 0.).q;
#if defined(VIEWPORTMAP)
    a = texture2DLodCompat(uTextureAtlasSettings, i + q, 0.);
    R = texture2DLodCompat(uTextureAtlasSettings, i + E, 0.);
#endif

#if defined(DEBUG_MATERIAL_HIGHLIGHT)
    r = texture2DLodCompat(uTextureAtlasSettings, i + A, 0.);
#endif

#endif
    T = floor(T * 255. + .5);
    U = floor(U * 255. + .5);
    h = floor(h * 255. + .5);
    const float V = .5, c = .25, L = .125, P = .0625;
    vec4 N = step(.5, fract(h * vec4(V, c, L, P)));
    T += vec4(256.) * N;
    vec2 w = U.st * uAtlasMeta.t;
    v.textureMeta1 = vec3(T.st, w.s);
    v.textureMeta2 = vec3(T.pq, w.t);
    v.wrapping = U.q;
#if defined(SPECULAR_LIGHTING) || defined(USE_NORMAL_MAP)
    v.specular = UnpackVec2ToFloat(D.st) * d;
    v.normalScale = UnpackVec2ToFloat(D.pq) * d;
    v.normalScale = v.normalScale * .1 - 8.;
#else
    v.specular = 0.;
    v.normalScale = 0.;
#endif
    highp vec2 G = vec2(UnpackVec2ToFloat(n.st), UnpackVec2ToFloat(n.pq)) - e;
    G *= step(1.5, abs(G));
    v.uvAnim = G * t * 2.;
#if defined(REFRACTION)
    v.refraction = m;
    v.refraction.t = v.refraction.t * 2. + 1.;
    v.refraction.p = UnpackVec2ToFloat(v.refraction.pq) * S * 10.;
#endif

#if defined(VIEWPORTMAP)
    highp vec2 C = vec2(UnpackVec2ToFloat(a.st), UnpackVec2ToFloat(a.pq)) - e, Y = vec2(UnpackVec2ToFloat(R.st), UnpackVec2ToFloat(R.pq)) - e;
    C *= step(1.5, abs(C));
    Y *= step(1.5, abs(Y));
    v.viewportMapUVScaleAndAnim = vec4(C * t * 2., Y * t * 2.);
#endif

#if defined(DEBUG_MATERIAL_HIGHLIGHT)
    v.materialID = UnpackVec2ToFloat(r.st);
#endif
}
void getTextureSettings1D(float v, out TextureSettings i)
{
    const float d = 1. / MATERIAL_SETTINGS_SLOTS_DIMENSION_COUNT_X;
    float S = floor((v + .5) * d), u = v - S * MATERIAL_SETTINGS_SLOTS_DIMENSION_COUNT_X;
    getTextureSettings(vec2(u, S), i);
}
#if __VERSION__ <= 120
#define in varying
#define out varying
#endif

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

#if defined(TEXTURE_ATLAS) && defined(NORMAL_MAP)
#define USE_NORMAL_MAP
#endif

#if __VERSION__ <= 120
#ifdef in
#undef in
#endif
#ifdef out
#undef out
#endif
#endif

#if defined(TEXTURE_ATLAS)
void CalculateDerivatives(inout highp vec2 v, inout highp vec2 d, inout highp vec3 g, inout highp vec3 h, highp vec2 S, highp vec3 T)
{
#if defined(STANDARD_DERIVATIVES)
    v = dFdx(S);
    d = dFdy(S);
#if defined(PER_FRAGMENT_TANGENTS)
    g = dFdxFine(T);
    h = dFdyFine(T);
#endif

#endif
}
#if defined(RT7_MATERIAL)
void SampleTexturesRT7(inout vec4 v, inout vec4 d, inout vec4 S, vec2 T, TextureSettings h, float g, vec2 i, vec2 u)
{
#if defined(TEXTURE_ATLAS)

#if !defined(TEXTURE_ALBEDO_GLOBAL)
    if (fract(g * 8.) > .5)
    {
#endif
        getTexel(T, h.textureMeta1, h.textureMeta2, h.textureMeta3, uAtlasMeta, i, u, h.wrapping, uTextureAtlas, v, d, S);
#if defined(ETC_CHANNEL_SWIZZLE)
        d = d.qtps;
        S = S.sqpt;
#endif

#if !defined(TEXTURE_ALBEDO_GLOBAL)
    }
#endif

#endif
}
#else
void SampleTextures(inout vec4 v, inout vec4 d, vec2 T, TextureSettings h, float S, vec2 i, vec2 u)
{
#if defined(TEXTURE_ATLAS)

#if !defined(TEXTURE_ALBEDO_GLOBAL)
    if (fract(S * 8.) > .5)
    {
#endif

#if defined(HDR_SCALE) || defined(USE_NORMAL_MAP)
        getTexel(T, h.textureMeta1, h.textureMeta2, uAtlasMeta, i, u, h.wrapping, uTextureAtlas, v, d);
#if defined(ETC_CHANNEL_SWIZZLE)
        d = d.qtps;
#endif

#else
    getTexel(T, h.textureMeta1, uAtlasMeta, i, u, h.wrapping, uTextureAtlas, v);
#endif

#if !defined(TEXTURE_ALBEDO_GLOBAL)
    }
#endif

#if defined(HDR_SCALE)
    v = HDRScale(v, d.s);
#endif

#endif
}
#endif
#endif
#if __VERSION__ <= 120
#define in varying
#define out varying
#endif

void ComputeTangentBitangentFromDerivatives(inout vec3 v, inout vec3 p, highp vec3 h, highp vec3 d, highp vec3 A, highp vec2 r, highp vec2 S)
{
    highp vec3 q = cross(h, d), c = cross(A, h), n = c * r.s + q * S.s, s = c * r.t + q * S.t;
    highp float D = dot(n, n), a = dot(s, s), i = max(D, a), t = inversesqrt(i);
    n *= t;
    s *= t;
    if (isNaN(D + a) || i <= 0.)
        n = s = h;
    v = n;
    p = s;
}
vec3 ComputeBitangent(vec3 v, vec4 h)
{
    highp vec3 p = cross(v, h.stp);
    p *= h.q;
    return p;
}
vec3 ApplyNormalMap(highp vec3 v, highp vec3 h, highp vec3 d, highp vec3 A, highp vec2 p, highp vec2 S)
{
    highp vec3 D, s;
    ComputeTangentBitangentFromDerivatives(D, s, h, d, A, p, S);
#if defined(DEBUG_TANGENTS)
    gl_FragColor.stp = normalize(D) * .5 + .5;
    gl_FragColor.q = 1.;
#endif

#if defined(DEBUG_BITANGENTS)
    gl_FragColor.stp = normalize(s) * .5 + .5;
    gl_FragColor.q = 1.;
#endif
    highp vec3 r = v.s * D + v.t * s + v.p * h;
    r = normalize(r);
    return abs(r.s) + abs(r.t) + abs(r.p) < .5 ? h : r;
}
vec3 ApplyNormalMap(vec3 v, vec3 A, vec3 s, vec3 S)
{
#if defined(DEBUG_TANGENTS)
    gl_FragColor.stp = s * .5 + .5;
    gl_FragColor.q = 1.;
#endif

#if defined(DEBUG_BITANGENTS)
    gl_FragColor.stp = S * .5 + .5;
    gl_FragColor.q = 1.;
#endif
    highp vec3 p = v.s * s + v.t * S + v.p * A;
    p = normalize(p);
    return p;
}
vec3 ApplyNormalMap(vec3 v, vec3 h, vec4 r)
{
    vec3 p = ComputeBitangent(h, r);
    return ApplyNormalMap(v, h, r.stp, p);
}
vec3 ApplyNormalMapTerrain(vec3 v, highp vec3 h, highp vec3 r, highp vec3 S)
{
    highp vec3 p = cross(h, r), s = cross(S, h), D = s * r.s + p * S.s, n = s * r.p + p * S.p;
    highp float A = inversesqrt(max(dot(D, D), dot(n, n)));
    D *= A;
    n *= A;
#if defined(DEBUG_TANGENTS)
    gl_FragColor.stp = normalize(D) * .5 + .5;
    gl_FragColor.q = 1.;
#endif

#if defined(DEBUG_BITANGENTS)
    gl_FragColor.stp = normalize(n) * .5 + .5;
    gl_FragColor.q = 1.;
#endif
    highp vec3 d = v.s * D + v.t * n + v.p * h;
    d = normalize(d);
    return isNaN(d.s) ? h : d;
}
vec3 ApplyNormalMapTerrain(vec3 v, vec3 h)
{
    const vec3 p = vec3(0., 0., 1.);
    vec3 D = cross(p, h), s = cross(D, h);
    return ApplyNormalMap(v, h, D, s);
}

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

#if defined(VIEWPORTMAP)
vec3 SampleViewportMapColour(highp vec2 v, highp vec4 e)
{
    v = v * uViewportLookupScale.st;
    vec2 t;
#if defined(OGLES2_BACKEND)
    t = uViewportMapTextureSize.st;
#else
    t = vec2(textureSize(uViewportMap, 0));
#endif
    v.s *= uViewportLookupScale.p * uViewportLookupScale.t / (t.s / t.t);
    v *= e.st;
    highp float u = uTextureAnimationTime;
    v += e.pq * u;
    return texture2DLodCompat(uViewportMap, v, 0.).stp;
}
#endif

#ifndef VOLUMETRIC_FUNCTIONS_INC
#define VOLUMETRIC_FUNCTIONS_INC
#if defined(SUNLIGHT_SHADOWS) && defined(VOLUMETRIC_SCATTERING) && defined(SUNLIGHT_DIRECT_LIGHTING)
#define VOLUMETRIC_SCATTERING_SUPPORTED
uniform vec4 uMieG, uVolumetricScatteringParameters;
#if defined(VOLUMETRIC_GROUND_FOG)
uniform vec4 uGroundFogHeight_Falloff;
#endif
#if defined(VOLUMETRIC_SCATTERING_NOISE)
uniform sampler3D sNoiseTex;
uniform vec4 u3DNoiseFrequency_Strength, u3DNoiseWind_Power;
#endif
uniform float uTime;
float ShadowSample(vec4 u, vec4 v, float s)
{
    int d = int(uMappingParams.q);
    vec4 f;
    int G;
#if defined(CASCADE_SPLIT_SELECTION)
    G = ShadowMapSelectCascadeBySplit(s, uCascadeFrustumViewDepths, uCascadeSplitSelectionFlags);
#if defined(USE_LIGHT_VIEW_PROJ_TEX_MATRIX)
    f = uSunlightViewProjTexMatrix[G] * u;
#else
    f = v * uSunlightProjTexMatScale[G] + uSunlightProjTexMatOffset[G];
#endif

#else

#if defined(USE_LIGHT_VIEW_PROJ_TEX_MATRIX)
    G = ShadowMapSelectCascadeByMap(f, u, uSunlightViewProjTexMatrix, uCascadeMinAtlasExtents);
#else
    G = ShadowMapSelectCascadeByMap(f, v, uSunlightProjTexMatScale, uSunlightProjTexMatOffset, uCascadeMinAtlasExtents);
#endif

#endif
    return G >= d ? 1. : ShadowDepthMapFilter1x1(uSunlightShadowMap, f);
}
float PhaseFunction(float v, vec4 s) { return s.q * (s.s / pow(s.t - s.p * v, 1.5)); }
vec4 GetScatteredInRay(int s, vec3 u, float v, float d, vec4 f)
{
    float G = uSunlightFadeAttenParams.t * 1.4, m = min(G, v);
    vec3 V = uCameraPosition, t = V + u * m;
    vec4 x = uSunlightViewMatrix * vec4(V, 1.), e = uSunlightViewMatrix * vec4(t, 1.), i = uSunlightViewMatrix * vec4(V, 0.), n = uSunlightViewMatrix * vec4(t, 0.);
    vec3 E = vec3(uViewMatrix[0][2], uViewMatrix[1][2], uViewMatrix[2][2]);
    int S = int(uMappingParams.q);
    float q = 0., p = 1. / float(s), N = d * p, h = m * p;
    vec2 r = vec2(0., 0.);
#if defined(VOLUMETRIC_SCATTERING_NOISE)
    vec3 P = vec3(.05 * uTime), a = u3DNoiseWind_Power.stp * uTime;
    const float o = .31;
    float c = u3DNoiseFrequency_Strength.s * o;
    vec3 l = a * u3DNoiseFrequency_Strength.s, T = a * c;
#endif
    for (int X = 0; X < s; ++X)
    {
        vec3 U = mix(V, t, N);
        vec4 I = mix(x, e, N);
#if defined(VOLUMETRIC_SCATTERING_NOISE)
        vec4 M = mix(i, n, N);
        vec3 C = M.sts * vec3(.001) + P, g = M.sts * vec3(.001) - P;
        I.sp += vec2(texture3D(sNoiseTex, g).s, texture3D(sNoiseTex, g).s) * 128. - 64.;
#endif
        float R = 0.;
#if defined(USE_CASCADE_SPLIT_SELECTION)
        vec3 O = U.stp - uCameraPosition;
        R = abs(dot(O, E));
#endif
        float F = ShadowSample(vec4(U, 1.f), I, R), D = 1., w = 1.;
#if defined(VOLUMETRIC_GROUND_FOG)
        if (uGroundFogHeight_Falloff.t != 0.)
        {
            float L = max(0., (U.t - uGroundFogHeight_Falloff.s) * uGroundFogHeight_Falloff.t);
            w = exp(-L) * 100.;
        }
#endif

#if defined(VOLUMETRIC_SCATTERING_NOISE)
        if (u3DNoiseFrequency_Strength.t != 0.)
        {
            vec3 L = U * u3DNoiseFrequency_Strength.s + l;
            float y = float(texture3D(sNoiseTex, L));
            vec3 A = U * c + T;
            float H = float(texture3D(sNoiseTex, A)), W = pow(mix(y, H, .8) + .5, u3DNoiseWind_Power.q);
            w *= max(0, mix(1., W, u3DNoiseFrequency_Strength.t));
        }
#endif
        D += w;
        float L = D * h, W = uVolumetricScatteringParameters.s * L;
        q += uVolumetricScatteringParameters.t * L;
        r += W * exp(-q) * vec2(F, 1. - F);
        N += p;
    }
    if (v > G)
    {
        float L = v - G, U = uVolumetricScatteringParameters.s * L;
        q += uVolumetricScatteringParameters.t * L;
        r += vec2(U * exp(-q), 0.);
    }
    float U = r.s + r.t;
    if (U > 0.)
    {
        float L = r.s / U, g = uVolumetricScatteringParameters.q;
        L = pow(L, g);
        r.st = U * vec2(L, 1. - L);
        r.s = r.s * PhaseFunction(dot(u, uInvSunDirection), f);
    }
    return vec4(r.s, q, r.t, 1.);
}
vec4 GetScatteredInRay2(int s, vec3 u, float v, float f) { return GetScatteredInRay(s, u, v, f, uMieG); }
vec4 GetScatteredInRayLine(int s, vec3 u, float v, vec3 f, float d, float G)
{
    vec4 L = GetScatteredInRay2(s, u, v, G), t = GetScatteredInRay2(s, mix(u, f, .33), mix(v, d, .33), G), m = GetScatteredInRay2(s, mix(u, f, .66), mix(v, d, .66), G), U = GetScatteredInRay2(s, f, d, G);
    return L * .15 + t * .2 + m * .3 + U * .35;
}
#endif
#endif

#ifndef APPLY_VOLUMETRICS_INC
#define APPLY_VOLUMETRICS_INC
#ifndef VOLUMETRIC_FUNCTIONS_INC
#define VOLUMETRIC_FUNCTIONS_INC
#if defined(SUNLIGHT_SHADOWS) && defined(VOLUMETRIC_SCATTERING) && defined(SUNLIGHT_DIRECT_LIGHTING)
#define VOLUMETRIC_SCATTERING_SUPPORTED
uniform vec4 uMieG, uVolumetricScatteringParameters;
#if defined(VOLUMETRIC_GROUND_FOG)
uniform vec4 uGroundFogHeight_Falloff;
#endif
#if defined(VOLUMETRIC_SCATTERING_NOISE)
uniform sampler3D sNoiseTex;
uniform vec4 u3DNoiseFrequency_Strength, u3DNoiseWind_Power;
#endif
uniform float uTime;
float ShadowSample(vec4 u, vec4 v, float s)
{
    int d = int(uMappingParams.q);
    vec4 f;
    int G;
#if defined(CASCADE_SPLIT_SELECTION)
    G = ShadowMapSelectCascadeBySplit(s, uCascadeFrustumViewDepths, uCascadeSplitSelectionFlags);
#if defined(USE_LIGHT_VIEW_PROJ_TEX_MATRIX)
    f = uSunlightViewProjTexMatrix[G] * u;
#else
    f = v * uSunlightProjTexMatScale[G] + uSunlightProjTexMatOffset[G];
#endif

#else

#if defined(USE_LIGHT_VIEW_PROJ_TEX_MATRIX)
    G = ShadowMapSelectCascadeByMap(f, u, uSunlightViewProjTexMatrix, uCascadeMinAtlasExtents);
#else
    G = ShadowMapSelectCascadeByMap(f, v, uSunlightProjTexMatScale, uSunlightProjTexMatOffset, uCascadeMinAtlasExtents);
#endif

#endif
    return G >= d ? 1. : ShadowDepthMapFilter1x1(uSunlightShadowMap, f);
}
float PhaseFunction(float v, vec4 s) { return s.q * (s.s / pow(s.t - s.p * v, 1.5)); }
vec4 GetScatteredInRay(int s, vec3 u, float v, float d, vec4 f)
{
    float G = uSunlightFadeAttenParams.t * 1.4, m = min(G, v);
    vec3 V = uCameraPosition, t = V + u * m;
    vec4 x = uSunlightViewMatrix * vec4(V, 1.), e = uSunlightViewMatrix * vec4(t, 1.), i = uSunlightViewMatrix * vec4(V, 0.), n = uSunlightViewMatrix * vec4(t, 0.);
    vec3 E = vec3(uViewMatrix[0][2], uViewMatrix[1][2], uViewMatrix[2][2]);
    int S = int(uMappingParams.q);
    float q = 0., p = 1. / float(s), N = d * p, h = m * p;
    vec2 r = vec2(0., 0.);
#if defined(VOLUMETRIC_SCATTERING_NOISE)
    vec3 P = vec3(.05 * uTime), a = u3DNoiseWind_Power.stp * uTime;
    const float o = .31;
    float c = u3DNoiseFrequency_Strength.s * o;
    vec3 l = a * u3DNoiseFrequency_Strength.s, T = a * c;
#endif
    for (int X = 0; X < s; ++X)
    {
        vec3 U = mix(V, t, N);
        vec4 I = mix(x, e, N);
#if defined(VOLUMETRIC_SCATTERING_NOISE)
        vec4 M = mix(i, n, N);
        vec3 C = M.sts * vec3(.001) + P, g = M.sts * vec3(.001) - P;
        I.sp += vec2(texture3D(sNoiseTex, g).s, texture3D(sNoiseTex, g).s) * 128. - 64.;
#endif
        float R = 0.;
#if defined(USE_CASCADE_SPLIT_SELECTION)
        vec3 O = U.stp - uCameraPosition;
        R = abs(dot(O, E));
#endif
        float F = ShadowSample(vec4(U, 1.f), I, R), D = 1., w = 1.;
#if defined(VOLUMETRIC_GROUND_FOG)
        if (uGroundFogHeight_Falloff.t != 0.)
        {
            float L = max(0., (U.t - uGroundFogHeight_Falloff.s) * uGroundFogHeight_Falloff.t);
            w = exp(-L) * 100.;
        }
#endif

#if defined(VOLUMETRIC_SCATTERING_NOISE)
        if (u3DNoiseFrequency_Strength.t != 0.)
        {
            vec3 L = U * u3DNoiseFrequency_Strength.s + l;
            float y = float(texture3D(sNoiseTex, L));
            vec3 A = U * c + T;
            float H = float(texture3D(sNoiseTex, A)), W = pow(mix(y, H, .8) + .5, u3DNoiseWind_Power.q);
            w *= max(0, mix(1., W, u3DNoiseFrequency_Strength.t));
        }
#endif
        D += w;
        float L = D * h, W = uVolumetricScatteringParameters.s * L;
        q += uVolumetricScatteringParameters.t * L;
        r += W * exp(-q) * vec2(F, 1. - F);
        N += p;
    }
    if (v > G)
    {
        float L = v - G, U = uVolumetricScatteringParameters.s * L;
        q += uVolumetricScatteringParameters.t * L;
        r += vec2(U * exp(-q), 0.);
    }
    float U = r.s + r.t;
    if (U > 0.)
    {
        float L = r.s / U, g = uVolumetricScatteringParameters.q;
        L = pow(L, g);
        r.st = U * vec2(L, 1. - L);
        r.s = r.s * PhaseFunction(dot(u, uInvSunDirection), f);
    }
    return vec4(r.s, q, r.t, 1.);
}
vec4 GetScatteredInRay2(int s, vec3 u, float v, float f) { return GetScatteredInRay(s, u, v, f, uMieG); }
vec4 GetScatteredInRayLine(int s, vec3 u, float v, vec3 f, float d, float G)
{
    vec4 L = GetScatteredInRay2(s, u, v, G), t = GetScatteredInRay2(s, mix(u, f, .33), mix(v, d, .33), G), m = GetScatteredInRay2(s, mix(u, f, .66), mix(v, d, .66), G), U = GetScatteredInRay2(s, f, d, G);
    return L * .15 + t * .2 + m * .3 + U * .35;
}
#endif
#endif

#if defined(VOLUMETRIC_SCATTERING) && defined(SUNLIGHT_DIRECT_LIGHTING)
uniform vec3 uVolumetricLitFogColour, uVolumetricUnlitFogColour;
uniform mat4 uVolumetricDitherMat;
#if __VERSION__ <= 120
#ifdef in
#undef in
#endif
#ifdef out
#undef out
#endif
#endif

void GetInAndOutScattering(vec4 v, out vec3 u, out vec3 G)
{
    vec3 A = uSunColour * uVolumetricLitFogColour, o = uAmbientColour * uVolumetricUnlitFogColour;
    u = vec3(exp(-v.t));
    G = v.s * A + v.p * o;
}
#if __VERSION__ <= 120
#define in varying
#define out varying
#endif

vec4 ApplyVolumetricScattering(vec4 v, vec4 u)
{
    vec3 A = vec3(1.), o = vec3(0.);
    GetInAndOutScattering(u, A, o);
    return vec4(v.stp * A + o, v.q);
}
float CalculateScatteringOffset(vec2 v)
{
    vec2 u = vec2(floor(mod(v.st, 4.)));
    return uVolumetricDitherMat[int(u.s)][int(u.t)];
}
#endif
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

#ifndef STIPPLE_TRANSPARENCY_UTILS_INC
#define STIPPLE_TRANSPARENCY_UTILS_INC
#if defined(STIPPLE_TRANSPARENCY_CLIP_NEAR) || defined(STIPPLE_TRANSPARENCY_CLIP_FAR) || defined(STIPPLE_TRANSPARENCY_ALPHA)
#ifndef STIPPLE_COMMON_INC
#define STIPPLE_COMMON_INC
highp float GetStippleViewSpaceDepthFromPos(vec3 S)
{
    vec3 u = vec3(uViewMatrix[0][2], uViewMatrix[1][2], uViewMatrix[2][2]);
    return dot(S, u);
}
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

#define STIPPLE_TRANSPARENCY_ENABLED
#if defined(STIPPLE_TRANSPARENCY_CLIP_NEAR) || defined(STIPPLE_TRANSPARENCY_CLIP_FAR)
uniform vec4 uStippleTransparencyClipParams;
#endif
#if __VERSION__ <= 120
#ifdef in
#undef in
#endif
#ifdef out
#undef out
#endif
#endif

float GetStippleTransparencyAlpha(float S, inout float R)
{
    float f = 1.;
#if defined(STIPPLE_TRANSPARENCY_CLIP_NEAR)
    float d = (S - (uZBufferParams.q + uStippleTransparencyClipParams.s)) * uStippleTransparencyClipParams.t;
    f *= clamp(d, 0., 1.);
#endif

#if defined(STIPPLE_TRANSPARENCY_CLIP_FAR)
    float u = 1. - (S - (abs(uZBufferParams.p) - uStippleTransparencyClipParams.p)) * uStippleTransparencyClipParams.q;
    f *= clamp(u, 0., 1.);
#endif

#if defined(STIPPLE_TRANSPARENCY_ALPHA)
    f *= clamp(R + .005, 0., 1.);
    R = 1.;
#endif
    return f;
}
bool IsStipplePixelVisible(highp vec3 S, highp vec2 R, inout float d)
{
    float u = GetStippleViewSpaceDepthFromPos(S);
    return GetStippleTransparencyAlpha(u, d) > GetInterleavedGradientNoise(R);
}
#if __VERSION__ <= 120
#define in varying
#define out varying
#endif

#endif
#endif

#ifndef STIPPLE_CUTOUT_UTILS_INC
#define STIPPLE_CUTOUT_UTILS_INC
#if defined(STIPPLE_TRANSPARENCY_CUTOUT)
#ifndef STIPPLE_COMMON_INC
#define STIPPLE_COMMON_INC
highp float GetStippleViewSpaceDepthFromPos(vec3 S)
{
    vec3 u = vec3(uViewMatrix[0][2], uViewMatrix[1][2], uViewMatrix[2][2]);
    return dot(S, u);
}
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

#define STIPPLE_CUTOUT_STIPPLED_ALPHA_MULTIPLIER 2.0
float GetStippleCutoutAdjustedAlpha(vec3 S, vec2 u, float G)
{
    float v = uStippleCutoutPosDepthVisibility.p, p = GetStippleViewSpaceDepthFromPos(S);
    const float T = 500., f = 500., t = 1. / f;
    float i = 0.f;
    if (p < v + T)
    {
        float l = abs(p - (v + T));
        l = clamp(l * t, 0., 1.);
        vec2 c = u * 2. - vec2(1.), a = c - uStippleCutoutPosDepthVisibility.st;
        a = a;
        float d = uProjectionMatrix[1][1] / uProjectionMatrix[0][0];
        a.s *= d;
        float I = uStippleCutoutPosDepthVisibility.q, R = uStippleCutoutStartRangeAndMinAlpha.s, s = uStippleCutoutStartRangeAndMinAlpha.t, e = uStippleCutoutStartRangeAndMinAlpha.p, o = clamp((length(a) - R) * s, 0., 1.);
        i = mix(pow(l * (1. - o), 2.), 0., I) - e;
    }
    return i;
}
bool IsStippleCutoutVisible(vec3 S, vec2 v, vec2 l) { return GetStippleCutoutAdjustedAlpha(S, v, STIPPLE_CUTOUT_STIPPLED_ALPHA_MULTIPLIER) > GetInterleavedGradientNoise(l); }
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

void main()
{
#if defined(DEBUG_VERTEX_BONE_COLOUR)
    gl_FragColor = vec4(vVertexAlbedo);
    if (uDebugReturn != 0.)
    {
        return;
    }
#endif

#if defined(ALPHA_ENABLED)
    if (vVertexAlbedo.q == 0.)
    {
        discard;
    }
#endif
    highp vec4 d = vec4(vWorldPosition.stp, 1.);
#if defined(CLIP_PLANE) && !defined(PUSH_TO_FARPLANE)
    if (dot(d, uClipPlane) < 0.)
    {
        discard;
        return;
    }
#endif

#if defined(TEXTURE_ATLAS)
    TextureSettings D;
    getTextureSettings(vMaterialSettingsSlotXY_BatchFlags.st, D);
#endif
    highp vec2 v = vec2(0.), p = vec2(0.);
    highp vec3 r = vec3(0.), q = vec3(0.);
    vec4 u = vec4(1.), s;
#if defined(COMPRESSED_NORMALS)
    s = vec4(0., .5, 0., .5);
#else
    s = vec4(0., .5, 1., .5);
#endif
    highp vec3 S = d.stp - uCameraPosition;
#if defined(TEXTURE_ATLAS)
    highp float G = uTextureAnimationTime;
    vec2 t = vTextureUV + fract(D.uvAnim * G);
    CalculateDerivatives(v, p, r, q, t, S);
    SampleTextures(u, s, t, D, vMaterialSettingsSlotXY_BatchFlags.p, v, p);
#endif
    float i = 1., g = 0., C = 0.;
    vec3 n = step(.5, fract(vMaterialSettingsSlotXY_BatchFlags.p * vec3(64., 32., 16.)));
#if !defined(TEXTURE_ALBEDO_GLOBAL)
    n.sp *= step(.5, fract(vMaterialSettingsSlotXY_BatchFlags.p * 8.));
#endif
    i += n.s * u.q * 4.;
    g = n.t;
    C = n.p * u.q;
    u.q = min(u.q + n.s + n.p, 1.);
    vec4 f = u * vVertexAlbedo;
#if defined(DEBUG_GEOMETRY_INSTANCE_COLOUR)
    gl_FragColor = vec4(uDebugInstanceColour.stp, f.q);
    if (uDebugReturn != 0.)
    {
        return;
    }
#endif

#if defined(ALPHA_ENABLED)
    if (f.q <= uAlphaTestThreshold)
    {
        discard;
    }
#endif

#if defined(STIPPLE_TRANSPARENCY_CUTOUT) && defined(VIEWPORTLOOKUPSCALE)
    if (fract(vMaterialSettingsSlotXY_BatchFlags.p * 4.) > .5)
    {
#if defined(ALPHA_ENABLED)
        if (uAlphaTestThreshold > .01)
        {
            if (IsStippleCutoutVisible(S, gl_FragCoord.st * uViewportLookupScale.st, gl_FragCoord.st))
            {
                discard;
            }
        }
        else
            f.q *= 1.f - GetStippleCutoutAdjustedAlpha(S, gl_FragCoord.st * uViewportLookupScale.st, 1.);
#else
        if (IsStippleCutoutVisible(S, gl_FragCoord.st * uViewportLookupScale.st, gl_FragCoord.st))
        {
            discard;
        }
#endif
    }
#endif

#if defined(STIPPLE_TRANSPARENCY_ENABLED)
    if (!IsStipplePixelVisible(S, gl_FragCoord.st, f.q))
    {
        discard;
    }
#endif

#if defined(GOURAUD_SHADING)
    gl_FragColor = f;
    return;
#endif
    highp vec3 e = normalize(vNormal), T = vec3(0., 1., 0.), P = vec3(0., 1., 0.);
#if defined(PER_FRAGMENT_TANGENTS)
    ComputeTangentBitangentFromDerivatives(T, P, e, r, q, v, p);
#endif

#if defined(USE_NORMAL_MAP)

#if !defined(PER_FRAGMENT_TANGENTS)
    T = normalize(vTangent.stp);
    P = ComputeBitangent(e, vTangent);
#endif
    vec3 A = UnpackNormal(s.tpq, D.normalScale);
    e = ApplyNormalMap(A, e, T, P);
#endif

#if defined(DEBUG_TANGENTS) || defined(DEBUG_BITANGENTS)

#if defined(DEBUG_TANGENTS)
    gl_FragColor.stp = normalize(T) * .5 + .5;
    gl_FragColor.q = 1.;
#endif

#if defined(DEBUG_BITANGENTS)
    gl_FragColor.stp = normalize(P) * .5 + .5;
    gl_FragColor.q = 1.;
#endif
    if (uDebugReturn != 0.)
    {
        return;
    }
#endif

#if defined(VIEWPORTMAP)
    f.stp = SampleViewportMapColour(gl_FragCoord.st, D.viewportMapUVScaleAndAnim);
#endif

#if defined(DEBUG_TEXEL_DENSITY)

#if defined(TEXTURE_ATLAS)
    gl_FragColor = vec4(GetTexelDensityDebugColour(vTextureUV, D.textureMeta1.p, S), 1.);
#else
    gl_FragColor = vec4(1.);
#endif
    if (uDebugReturn != 0.)
    {
        return;
    }
#endif

#if defined(VIEWPORTLOOKUPSCALE)
    vec2 E = gl_FragCoord.st * uFullScreenLookupScale.st;
#endif
    float h = 1.;
#if defined(SSAO) && !defined(REFRACTION)
    h = texture2D(uSSAOMap, E).s;
#endif
    LightingTerms m;
    ClearLightingTerms(m);
    m.Diffuse = uAmbientColour;
    vec3 l = vec3(1., 1., 1.);
#if defined(IRRADIANCE_LIGHTING)
    l = EvaluateSHLighting2ndOrder(e, uIrradianceSHCoefs);
    m.Diffuse *= l;
#endif

#if defined(SSAO)
    m.Diffuse *= h;
#endif
    highp float V = length(S);
    highp vec3 a = S / V;
    LightingTerms R;
    ClearLightingTerms(R);
#if defined(SUNLIGHT_DIRECT_LIGHTING)
    int I = -1;
    float F = 0.;
#if defined(DEFERRED_SHADOWS)
    R = EvaluateSunlightRT5(F, e, P, -a, E, D.specular, g);
#else
    highp vec3 O = vec3(uViewMatrix[0][2], uViewMatrix[1][2], uViewMatrix[2][2]);
    highp float o = abs(dot(S, O));
    float L = step(.5, fract(vMaterialSettingsSlotXY_BatchFlags.p * 2.));
    R = EvaluateSunlightRT5(I, F, d, e, P, o, -a, D.specular, g, L);
#endif

#else
    R.Diffuse = vec3(1.);
#endif

#if defined(TEXTURE_ATLAS) && defined(DEBUG_MATERIAL_HIGHLIGHT)
    if (uDebugMaterialHighlight != -1.)
    {
        float c = mix(.1, .5, length(R.Diffuse)), N = .1;
        vec3 U = mix(vec3(N) * c, vec3(0, 1, 0), D.materialID == uDebugMaterialHighlight ? 1 : 0);
        gl_FragColor = vec4(U, 1);
        if (uDebugReturn != 0.)
        {
            return;
        }
    }
#endif
    float N = FresnelSchlick(.8, max(0., dot(-a, e)), 5.);
#if defined(TEXTURE_ATLAS) && defined(GLOBAL_ENVIRONMENTMAPPING)
    if (C > 0.)
    {
        vec3 c = reflect(-a, e);
        c.s = -c.s;
        c.t = -c.t;
        m.Specular = textureCubeSRGB(uGlobalEnvironmentMap, c).stp * h;
#if defined(NORMALIZED_ENVIRONMENTMAPPING)
        m.Specular *= l * uGlobalEnvironmentMappingParams.q;
#endif
        f.stp = mix(f.stp, m.Specular, C * N);
    }
#endif
    vec4 c = vec4(0., 0., 0., f.q);
#if defined(POINT_LIGHTING)
    vec3 U = vec3(0., 0., 0.), M = vec3(0., 0., 0.);
    const vec3 B = vec3(.65, .65, .65);
    const float H = 1., b = 5.;
    EvaluatePointLights(U, M, B, D.specular, H, b, -a, vWorldPosition.stp, e, o, vTilePosition);
#if defined(DEBUG_POINTLIGHTS)
    gl_FragColor = vec4(U, f.q);
    if (uDebugReturn != 0.)
    {
        return;
    }
#endif

#if defined(DEBUG_POINTLIGHTS_SPECULAR)
    gl_FragColor = vec4(M, f.q);
    if (uDebugReturn != 0.)
    {
        return;
    }
#endif

#if defined(DIFFUSE_LIGHTING)
    R.Diffuse += U;
#else
    R.Diffuse = U;
#endif

#if defined(POINT_LIGHTING_SPECULAR)
    R.Specular += M;
#endif

#else

#if defined(DEBUG_POINTLIGHTS)
    gl_FragColor = vec4(0., 0., 0., 1.);
    if (uDebugReturn != 0.)
    {
        return;
    }
#endif

#if defined(DEBUG_POINTLIGHTS_SPECULAR)
    gl_FragColor = vec4(0., 0., 0., 1.);
    if (uDebugReturn != 0.)
    {
        return;
    }
#endif

#if !defined(DIFFUSE_LIGHTING)
    R.Diffuse = vec3(0.);
#endif

#endif
    float x = 0.;
#if defined(CAUSTICS)
    x = CalculateCausticsTerm(vWorldPosition.stp, F, e);
#endif

#if defined(AMBIENT_LIGHTING)
    c.stp += m.Diffuse;
#endif
    c.stp += R.Diffuse;
#if defined(SPECULAR_LIGHTING)
    c.stp += R.Specular * i;
#endif

#if defined(CAUSTICS)
    c.stp += uSunColour * x;
#endif

#if defined(ALBEDO_LIGHTING)
    c.stp *= f.stp;
#endif

#if defined(DEBUG_EMISSIVE_MAP)
    c.stp = vec3(g);
#else
    if (g > 0.)
        c.q *= c.q;
    c.stp = mix(c.stp, f.stp, g);
#endif

#if defined(REFRACTION)
    if (D.refraction.s > 0. || D.refraction.p > 0.)
        c.stp = CalculateRefractionColour(vWorldPosition.stp, e, -a, D.specular, D.refraction, e.sp, c);
#endif

#if defined(LIGHT_SCATTERING) || defined(FOG_DISTANCE)
    c.stp = ApplyInOutScattering(c.stp, vOutScattering, vInScattering);
#endif

#if defined(VOLUMETRIC_SCATTERING_SUPPORTED)
    vec4 Y = GetScatteredInRay2(8, a, V, CalculateScatteringOffset(gl_FragCoord.st));
    c = ApplyVolumetricScattering(c, Y);
#endif

#if defined(TINT) && defined(PUSH_TO_FARPLANE)
    c.stp += uTint.stp;
#endif

#if defined(DEBUG_ALBEDO)
    c = f;
#endif

#if defined(DEBUG_NORMALS)
    c.stp = e * .5 + .5;
    c.q = 1.;
#endif

#if defined(DEBUG_FRESNEL)
    c.stp = vec3(N, N, N);
    c.q = 1.;
#endif

#if defined(DEBUG_SPECULAR_MAP)
    c.stp = vec3(max(0., (i - .5) / 4.));
#endif

#if defined(SUNLIGHT_SHADOWS) && defined(DEBUG_SUNLIGHT_SHADOW_CASCADE) && !defined(DEFERRED_SHADOWS)
    c.stp = ShadowMapCascadeColour(I, int(uMappingParams.q)).stp;
#endif

#if defined(DEBUG_RT7_EMISSIVE) || defined(DEBUG_RT7_METALNESS) || defined(DEBUG_RT7_ROUGHNESS)
    c = vec4(1., 0., 1., 1.);
#endif

#if defined(FORCE_OPAQUE)
    c.q = 1.;
#endif

#if defined(PREMULTIPLY_ALPHA)
    c.stp *= c.q;
#endif
    gl_FragColor = c;
}
