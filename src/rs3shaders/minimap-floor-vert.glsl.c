
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
#define SUNLIGHT_DIRECT_LIGHTING
#define TEXTURE_ATLAS
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

attribute vec3 aVertexPosition;
attribute vec4 aVertexNormal_FogProportion;
attribute vec4 aMaterialSettingsSlotXY_MaterialSettingsSlotXY2;
attribute vec2 aMaterialSettingsSlotXY3;
attribute vec4 aTextureScale;
attribute vec4 aVertexColour;
attribute vec4 aTextureWeight;
attribute vec4 aMaterialProperties;
uniform mat4 uModelMatrix;

UNIFORM_BUFFER_BEGIN(ViewTransforms)
uniform highp vec3 uCameraPosition;
uniform highp mat4 uViewMatrix;
uniform highp mat4 uProjectionMatrix;
uniform highp mat4 uViewProjMatrix;
uniform highp vec4 uZBufferParams;
UNIFORM_BUFFER_END
uniform mediump vec4 uAtlasMeta;
uniform float uFade;
out highp vec4 vWorldPos_ViewSpaceDepth;
out vec4 vVertexAlbedo;
out vec3 vWorldNormal;
flat out highp vec4 vMaterialSettingsSlots1D;
flat out highp vec4 vTextureScale;
out vec4 vTextureWeight;
flat out vec4 vMaterialProperties;
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

void main()
{
    vec4 d = uModelMatrix * vec4(aVertexPosition, 1.);
    gl_Position = uViewProjMatrix * d;
    vWorldPos_ViewSpaceDepth.stp = d.stp;
    vVertexAlbedo = aVertexColour;
#if defined(GAMMA_CORRECT_INPUTS) && !defined(TEXTURE_ATLAS)
    vVertexAlbedo.stp = SRGBToLinear(vVertexAlbedo.stp);
#endif
    vVertexAlbedo.q += uFade;
#if defined(SUNLIGHT_DIRECT_LIGHTING) || defined(DEBUG_NORMALS)
    vWorldNormal = normalize(Mat4ToMat3(uModelMatrix) * aVertexNormal_FogProportion.stp);
#endif

#if defined(IRRADIANCE_LIGHTING) && !defined(NORMAL_MAP)
    vAmbientColour = uAmbientColour * EvaluateSHLighting2ndOrder(vWorldNormal, uIrradianceSHCoefs);
#endif

#if defined(TEXTURE_ATLAS)
    vMaterialSettingsSlots1D = vec4(aMaterialSettingsSlotXY_MaterialSettingsSlotXY2.s + aMaterialSettingsSlotXY_MaterialSettingsSlotXY2.t * MATERIAL_SETTINGS_SLOTS_DIMENSION_COUNT_X, aMaterialSettingsSlotXY_MaterialSettingsSlotXY2.p + aMaterialSettingsSlotXY_MaterialSettingsSlotXY2.q * MATERIAL_SETTINGS_SLOTS_DIMENSION_COUNT_X, aMaterialSettingsSlotXY3.s + aMaterialSettingsSlotXY3.t * MATERIAL_SETTINGS_SLOTS_DIMENSION_COUNT_X, 0.);
    vTextureScale = aTextureScale;
    vTextureWeight = aTextureWeight;
#endif
    vMaterialProperties = aMaterialProperties + vec4(.25);
#if defined(LIGHT_SCATTERING) || defined(SUNLIGHT_SHADOWS) || defined(FOG_DISTANCE)
    vec3 S = d.stp - uCameraPosition;
    float G = length(S);
    vec3 g = S / G;
#endif

#if defined(SUNLIGHT_SHADOWS)
    vec3 u = vec3(uViewMatrix[0][2], uViewMatrix[1][2], uViewMatrix[2][2]);
    vWorldPos_ViewSpaceDepth.q = abs(dot(S.stp, u));
#endif

#if (defined(FOG_DISTANCE) || (defined(SUNLIGHT_DIRECT_LIGHTING) && defined(LIGHT_SCATTERING))) && !defined(OGLES2_BACKEND)

#if defined(LIGHT_SCATTERING) && defined(SUNLIGHT_DIRECT_LIGHTING)
    ComputeInOutScattering(g, G, uInvSunDirection, vOutScattering, vInScattering);
#else
    vOutScattering = vec3(1.);
    vInScattering = vec3(0.);
#endif

#if defined(FOG_DISTANCE)
    float p = FogBasedOnDistance(G);
    vInScattering = mix(vInScattering, uFogColour.stp, p);
    vOutScattering *= 1. - p;
#endif

#endif
}
