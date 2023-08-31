
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
#define VIEW_TRANSFORMS
#define WATER_COMMON

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

uniform lowp vec4 uWaterFeatureFlags;
uniform highp vec4 uWaterNormalMapTextureScales_FlowNoiseScale;
uniform highp vec2 uWaterTickFade;
uniform mat4 uModelMatrix;

UNIFORM_BUFFER_BEGIN(ViewTransforms)
uniform highp vec3 uCameraPosition;
uniform highp mat4 uViewMatrix;
uniform highp mat4 uProjectionMatrix;
uniform highp mat4 uViewProjMatrix;
uniform highp vec4 uZBufferParams;
UNIFORM_BUFFER_END
out highp vec4 vPosition_WaterDepth;
out vec4 vColour;
out highp vec4 vFlowControlMask_ViewSpaceDepth;
out highp vec4 vNoisyPatchFlow0_NoisyPatchFlow1;
out highp vec4 vNoisyPatchFlow2_UVPack_NormalsFlow0Map0;
out highp vec4 vUVPack_NormalsFlow0Map1_NormalsFlow0Map2;
out highp vec4 vUVPack_NormalsFlow1Map0_NormalsFlow1Map1;
out highp vec4 vUVPack_NormalsFlow1Map2_NormalsFlow2Map0;
out highp vec4 vUVPack_NormalsFlow2Map1_NormalsFlow2Map2;
out highp vec4 vUVPack_NormalMapMacroUV_EmissiveUV[3];
out highp vec2 vUVPack_FoamUV;
attribute vec4 aWaterPosition_Depth, aVertexColour;
attribute vec2 aWaterFlowDataPatchFlow0, aWaterFlowDataPatchFlow1, aWaterFlowDataPatchFlow2;
attribute vec4 aWaterFlowDataFlowNoise0_FlowNoise1, aWaterFlowDataFlowNoise2_FlowIndex_Spare;
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

#if __VERSION__ <= 120
#ifdef in
#undef in
#endif
#ifdef out
#undef out
#endif
#endif

vec2 GetFlowOrientedUV(vec2 v, vec2 u, float d, float E)
{
    float T = dot(u, u);
    const float q = 1e-06;
    vec2 e = T < q ? vec2(0., 1.) : normalize(u), t = vec2(e.t, -e.s);
    highp float f = length(u * d * E);
    return vec2(dot(t, v), dot(e, v) + f);
}
vec2 GetFlowOrientedUV(vec4 e, vec2 v, float d, vec2 u, float f)
{
    vec2 q = vec2(e.sp);
    float t = sign(u.t);
    return GetFlowOrientedUV(q, v * t, d, f) * u;
}
#if defined(WATER_NORMAL_MAPS)
vec2 TransformNormalMapTexCoordFlowAligned(in NormalMapTexCoordParams v, vec2 u, vec2 d, vec2 f)
{
    const float q = .5;
    highp float E = uWaterTickFade.s * q;
    float t = v.flowSpeed_spareyzw.s;
    vec2 T = GetFlowOrientedUV(u, v.flowRotation * d, t, E), a = (v.uvRotation * T + f * t * E) * v.uvScale_uvOffset.st + v.uvScale_uvOffset.pq;
    return a;
}
vec2 TransformNormalMapTexCoordAxisAligned(in NormalMapTexCoordParams v, vec2 u, vec2 d, vec2 f)
{
    const float q = .5;
    highp float t = uWaterTickFade.s * q;
    vec2 p = (d + f) * v.flowSpeed_spareyzw.s, E = v.flowRotation * p * t, a = v.uvRotation * (u + E) * v.uvScale_uvOffset.st + v.uvScale_uvOffset.pq;
    return a;
}
#if !defined(GLES2_COMPAT_MODE)
void ComputeNormalMapDetailTexCoords(vec2 v, vec2 d, vec2 f, vec2 u, vec2 t, vec2 a, vec2 p, vec2 s, vec2 E)
{
    vec2 q = vec2(1.), S = vec2(-1.), g = vec2(1., -1.), T = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[0], v, u, p * q), e = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[1], d, u, p * S), G = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[2], f, u, p * g), C = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[0], v, t, s * q), P = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[1], d, t, s * S), W = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[2], f, t, s * g), D = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[0], v, a, E * q), o = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[1], d, a, E * S), r = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[2], f, a, E * g);
    vNoisyPatchFlow2_UVPack_NormalsFlow0Map0.pq = T;
    vUVPack_NormalsFlow0Map1_NormalsFlow0Map2 = vec4(e, G);
    vUVPack_NormalsFlow1Map0_NormalsFlow1Map1 = vec4(C, P);
    vUVPack_NormalsFlow1Map2_NormalsFlow2Map0 = vec4(W, D);
    vUVPack_NormalsFlow2Map1_NormalsFlow2Map2 = vec4(o, r);
}
void ComputeNormalMapMacroTexCoords(vec2 v, vec2 d, vec2 f)
{
    const float q = .25;
    const vec2 t = vec2(.1, -.13) * q;
    const float u = .1;
    vUVPack_NormalMapMacroUV_EmissiveUV[0].st = TransformNormalMapTexCoordAxisAligned(uWaterNormalMapMacroTexCoordParams[0], v * u, t, vec2(0.));
    vUVPack_NormalMapMacroUV_EmissiveUV[1].st = TransformNormalMapTexCoordAxisAligned(uWaterNormalMapMacroTexCoordParams[1], d * u, t, vec2(0.));
    vUVPack_NormalMapMacroUV_EmissiveUV[2].st = TransformNormalMapTexCoordAxisAligned(uWaterNormalMapMacroTexCoordParams[2], f * u, t, vec2(0.));
}
#else
void ComputeNormalMapDetailTexCoords(vec2 v, vec2 d, vec2 f, vec2 t, vec2 u, vec2 E, vec2 a)
{
    vec2 q = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[0], v, d, u), e = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[0], v, f, E), S = TransformNormalMapTexCoordFlowAligned(uWaterNormalMapTexCoordParams[0], v, t, a);
    vNoisyPatchFlow2_UVPack_NormalsFlow0Map0.pq = q;
    vUVPack_NormalsFlow1Map0_NormalsFlow2Map0 = vec4(e, S);
}
#endif
#endif
#if defined(WATER_EMISSIVE) && !defined(GLES2_COMPAT_MODE)
#define EMISSIVE_UV_MODE_AXIS_ALIGNED (0)
#define EMISSIVE_UV_MODE_FLOW_ALIGNED (1)
void GetEmissiveFlow(out vec2 v, out vec2 d, out vec2 t, vec2 u, vec2 f, vec2 q, float E)
{
    float a = cos(E), S = sin(E);
    mat2 T = mat2(vec2(a, -S), vec2(S, a));
    vec2 G = T * u, e = T * f, p = T * q;
    const float g = 1e-06;
    vec3 C = vec3(G, dot(G, G)), s = vec3(e, dot(e, e)), r = vec3(p, dot(p, p));
    if (C.p < g)
        C = s.p > r.p ? s : r;
    if (s.p < g)
        s = r.p > C.p ? r : C;
    if (r.p < g)
        r = C.p > s.p ? C : s;
    v = C.st;
    d = s.st;
    t = r.st;
}
void ComputeEmissiveTexCoords(vec4 v, vec2 d, vec2 f, vec2 E)
{
    float t = uEmissiveFlowSpeed_EmissiveFlowRotation_EmissiveUVScale.s, q = uEmissiveFlowSpeed_EmissiveFlowRotation_EmissiveUVScale.t, u = uEmissiveMapScale_EmissiveUVMode.s;
    vec2 a = uEmissiveFlowSpeed_EmissiveFlowRotation_EmissiveUVScale.pq, p = vec2(0., 0.), s = vec2(0., 0.), e = vec2(0., 0.);
    GetEmissiveFlow(p, s, e, d, f, E, q);
    const float T = .5;
    highp float S = uWaterTickFade.s * T;
    vec2 G = v.sp * u;
    if (int(uEmissiveMapScale_EmissiveUVMode.t) == EMISSIVE_UV_MODE_FLOW_ALIGNED)
        vUVPack_NormalMapMacroUV_EmissiveUV[0].pq = GetFlowOrientedUV(G, p, t, S) * a, vUVPack_NormalMapMacroUV_EmissiveUV[1].pq = GetFlowOrientedUV(G, s, t, S) * a, vUVPack_NormalMapMacroUV_EmissiveUV[2].pq = GetFlowOrientedUV(G, e, t, S) * a;
    else
    {
        vec2 g = sign(a);
        vUVPack_NormalMapMacroUV_EmissiveUV[0].pq = G * a + p * g * t * S;
        vUVPack_NormalMapMacroUV_EmissiveUV[1].pq = G * a + s * g * t * S;
        vUVPack_NormalMapMacroUV_EmissiveUV[2].pq = G * a + e * g * t * S;
    }
}
#endif
void main()
{
    vec3 u = aWaterPosition_Depth.stp;
    vec4 v = uModelMatrix * vec4(u, 1.);
    vPosition_WaterDepth.stp = v.stp;
    vPosition_WaterDepth.q = aWaterPosition_Depth.q;
#if defined(CLIP_PLANE_CLAMP) && defined(CLIP_PLANE)
    v.t = -uClipPlane.q;
#endif
    gl_Position = uViewProjMatrix * v;
#if defined(CLIP_PLANE_CLAMP) && defined(CLIP_PLANE)
    return;
#endif

#if defined(CAUSTICS_COMPUTE) || defined(CAUSTICS_STENCIL)
    const float E = 256.;
    if (abs(vPosition_WaterDepth.t - uCausticsPlaneHeight) > E)
    {
        gl_Position.q = -1.;
        return;
    }
#endif
    vColour = aVertexColour;
#if defined(LIGHT_SCATTERING) || defined(FOG_DISTANCE) || defined(SUNLIGHT_SHADOWS) || defined(VOLUMETRIC_SCATTERING_SUPPORTED)
    vec3 t = v.stp - uCameraPosition;
    float d = length(t);
#endif

#if defined(SUNLIGHT_SHADOWS)
    vec3 f = vec3(uViewMatrix[0][2], uViewMatrix[1][2], uViewMatrix[2][2]);
    vFlowControlMask_ViewSpaceDepth.q = abs(dot(t.stp, f));
#endif

#if defined(LIGHT_SCATTERING) || defined(FOG_DISTANCE)
    t /= d;
#if defined(LIGHT_SCATTERING) && defined(SUNLIGHT_DIRECT_LIGHTING)
    ComputeInOutScattering(t, d, uInvSunDirection, vOutScattering, vInScattering);
#else
    vOutScattering = vec3(1.);
    vInScattering = vec3(0.);
#endif

#if defined(FOG_DISTANCE)
    float q = FogBasedOnDistance(d);
    q = q + q * uWaterTickFade.t - uWaterTickFade.t;
    vInScattering = mix(vInScattering, uFogColour.stp, q);
    vOutScattering *= 1. - q;
    vColour.q = q;
#else
    vColour.q = 0.;
#endif

#endif

#if defined(VOLUMETRIC_SCATTERING_SUPPORTED)
    vec4 a = GetScatteredInRay2(8, t, d, 100.);
    vec3 T = vec3(1.), S = vec3(0.);
    GetInAndOutScattering(a, T, S);
    vInScattering += S;
    vOutScattering *= T;
#endif
    float g = uWaterNormalMapTextureScales_FlowNoiseScale.q;
    vec2 p = aWaterFlowDataFlowNoise0_FlowNoise1.st / 127. * g, e = aWaterFlowDataFlowNoise0_FlowNoise1.pq / 127. * g, s = aWaterFlowDataFlowNoise2_FlowIndex_Spare.st / 127. * g, G = -aWaterFlowDataPatchFlow0 * (1. / 4095.), r = -aWaterFlowDataPatchFlow1 * (1. / 4095.), C = -aWaterFlowDataPatchFlow2 * (1. / 4095.);
    int W = int(aWaterFlowDataFlowNoise2_FlowIndex_Spare.p);
    vFlowControlMask_ViewSpaceDepth.stp = vec3(W == 0 ? 1. : 0., W == 1 ? 1. : 0., W == 2 ? 1. : 0.);
    vNoisyPatchFlow0_NoisyPatchFlow1.st = G + p;
    vNoisyPatchFlow0_NoisyPatchFlow1.pq = r + e;
    vNoisyPatchFlow2_UVPack_NormalsFlow0Map0.st = C + s;
#if defined(WATER_NORMAL_MAPS) || defined(WATER_FOAM_MAP)

#if !defined(GLES2_COMPAT_MODE)
    vUVPack_FoamUV = v.sp * uWaterNormalMapTextureScales_FlowNoiseScale.s;
#endif
    vec2 o = v.sp * uWaterNormalMapTextureScales_FlowNoiseScale.s, P = v.sp * uWaterNormalMapTextureScales_FlowNoiseScale.t, D = v.sp * uWaterNormalMapTextureScales_FlowNoiseScale.p;
#if defined(WATER_NORMAL_MAPS)

#if !defined(GLES2_COMPAT_MODE)
    ComputeNormalMapDetailTexCoords(o, P, D, G, r, C, p, e, s);
    ComputeNormalMapMacroTexCoords(o, P, D);
#else
    ComputeNormalMapDetailTexCoords(o, G, r, C, p, e, s);
#endif

#endif

#endif

#if defined(WATER_EMISSIVE) && !defined(GLES2_COMPAT_MODE)
    ComputeEmissiveTexCoords(v, G, r, C);
#endif
}
