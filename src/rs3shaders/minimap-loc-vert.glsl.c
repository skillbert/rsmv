
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
#define TEXTURE_ALBEDO_GLOBAL
#define SUNLIGHT_DIRECT_LIGHTING
#define TEXTURE_ATLAS
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

attribute vec4 aVertexPosition_BoneLabel;
attribute vec2 aTextureUV;
attribute vec4 aVertexNormal_BatchFlags, aVertexTangent, aVertexColour, aVertexColourUnwhitenedRGB_TilePositionLevel, aMaterialSettingsSlotXY_TilePositionXZ, aVertexSkinBones, aVertexSkinWeights;
uniform float uSmoothSkinning;
uniform mat4 uModelMatrix;
uniform float uVertexScale;

UNIFORM_BUFFER_BEGIN(ViewTransforms)
uniform highp vec3 uCameraPosition;
uniform highp mat4 uViewMatrix;
uniform highp mat4 uProjectionMatrix;
uniform highp mat4 uViewProjMatrix;
uniform highp vec4 uZBufferParams;
UNIFORM_BUFFER_END
uniform mediump vec4 uTint;
uniform float uFade;
out highp vec3 vWorldPosition;
out highp vec3 vNormal;
out mediump vec4 vVertexAlbedo;
out vec2 vTextureUV;
flat out vec3 vMaterialSettingsSlotXY_BatchFlags;
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

#if defined(ANIMATION_VERTEX)
#if defined(USE_BONE_HALF_FLOATS)
mat4 GetBoneFromIndex(float u)
{
    uint f = uint(u), v = f % 2u, n = (f * 3u - v) / 2u;
    uvec4 d = (1u - v) * uBoneTransforms[n] + v * uvec4(uBoneTransforms[n].pq, uBoneTransforms[n + 1u].st);
    uvec2 G = (1u - v) * uvec2(uBoneTransforms[n + 1u].st) + v * uvec2(uBoneTransforms[n + 1u].pq);
    vec2 m = unpackHalf2x16(d.s), A = unpackHalf2x16(d.t), e = unpackHalf2x16(d.p), U = unpackHalf2x16(d.q), s = unpackHalf2x16(G.s), a = unpackHalf2x16(G.t);
    mat4 t = mat4(vec4(m.st, A.s, 0.), vec4(A.t, e.st, 0.), vec4(U.st, s.s, 0.), vec4(s.t, a.st, 1.));
    return t;
}
#else
mat4 GetBoneFromIndex(float u)
{
    int n = int(u * 3.);
    return mat4(vec4(uBoneTransforms[n].stp, 0.), vec4(uBoneTransforms[n].q, uBoneTransforms[n + 1].st, 0.), vec4(uBoneTransforms[n + 1].pq, uBoneTransforms[n + 2].s, 0.), vec4(uBoneTransforms[n + 2].tpq, 1.));
}
#endif
#endif

void AssignTextureAtlasVaryings(out vec2 d, out vec2 v, vec2 s, vec2 p)
{
    d = s.st, v = p;
}
mat3 ResolveNormalTransformMatrix(mat4 v)
{
    mat3 p = Mat4ToMat3(v);
#if defined(ANIMATION_VERTEX)
    const highp float d = 2e-16;
    float s = step(d, abs(p[0].s) + abs(p[1].t));
    p[0].s = mix(1., p[0].s, s);
    p[1].t = mix(1., p[1].t, s);
#endif
    return p;
}
vec2 ClipSpacePosToUVSpacePos(vec2 s) { return s.st * .5 + vec2(.5, .5); }
vec4 OffsetPositionAlongNormal(vec4 p, vec3 s, vec4 t, vec2 d, float v)
{
    if (v <= 0.)
        return t;
    else
    {
        vec2 a = t.st / t.q, l = ClipSpacePosToUVSpacePos(a) * d;
        vec4 f = p;
        f.stp -= s;
        vec4 u = uViewProjMatrix * f;
        vec2 G = ClipSpacePosToUVSpacePos(u.st / u.q) * d;
        u.st = a;
        vec2 q = G - l;
        q = -q;
        float A = dot(q, q);
        if (A > 0.)
            q /= sqrt(A), u.st += q * v / d;
        u.st *= u.q;
        return u;
    }
}
#if defined(ANIMATION_VERTEX)
mat4 GetBoneMatrix(out float s)
{
    s = floor(aVertexPosition_BoneLabel.q / 256.);
    float v = aVertexPosition_BoneLabel.q - s * 256.;
    mat4 p = GetBoneFromIndex(v), f = uSmoothSkinning < 0. ? mat4(1.) : GetBoneFromIndex(aVertexSkinBones.s);
    if (uSmoothSkinning > 0.)
    {
        f *= aVertexSkinWeights.s;
        mat4 u = GetBoneFromIndex(aVertexSkinBones.t);
        f += u * aVertexSkinWeights.t;
        u = GetBoneFromIndex(aVertexSkinBones.p);
        f += u * aVertexSkinWeights.p;
        u = GetBoneFromIndex(aVertexSkinBones.q);
        f += u * aVertexSkinWeights.q;
    }
    return f * p;
}
mat4 GetBoneMatrixRigid(out float s)
{
    s = floor(aVertexPosition_BoneLabel.q / 256.);
    float v = aVertexPosition_BoneLabel.q - s * 256.;
    mat4 p = GetBoneFromIndex(v), u = uSmoothSkinning < 0. ? mat4(1.) : GetBoneFromIndex(aVertexSkinBones.s);
    return u * p;
}
#endif
void AssignPositionNormalVaryings(out float v)
{
    vec3 u = aVertexPosition_BoneLabel.stp;
    mat4 p;
#if defined(ANIMATION_VERTEX)
    mat4 d = GetBoneMatrix(v), s = uModelMatrix;
    p = s * d;
#else
    v = 0.;
    p = uModelMatrix;
#endif
    vec3 a = u * uVertexScale;
    vec4 t = p * vec4(a, 1.),
         q = uViewProjMatrix * t;
#if !defined(MODEL_GEOMETRY_SHADOW_VS)
    mat3 f = ResolveNormalTransformMatrix(p);
    vNormal = f * aVertexNormal_BatchFlags.stp;
    vNormal = normalize(vNormal);
    vNormal = isNaN(vNormal.s) ? vec3(0., 1., 0.) : vNormal;
#if defined(USE_NORMAL_MAP) && !defined(PER_FRAGMENT_TANGENTS)
    vTangent.stp = f * aVertexTangent.stp;
    vTangent.stp = normalize(vTangent.stp);
    vTangent.stp = isNaN(vTangent.s) ? vec3(1., 0., 0.) : vTangent.stp;
    vTangent.q = aVertexTangent.q;
#endif

#if defined(MODEL_GEOMETRY_HIGHLIGHT_VS)
    q = OffsetPositionAlongNormal(t, vNormal, q, uViewportLookupScale.pq, uHighlightScale);
#endif
    vWorldPosition = t.stp;
#endif
    gl_Position = q;
#if !defined(ANIMATION_VERTEX) && defined(PUSH_TO_FARPLANE)
    gl_Position.p = gl_Position.q * .9999;
#endif
}
#if __VERSION__ <= 120
#define in varying
#define out varying
#endif

void main()
{
    float d = 1.;
    AssignPositionNormalVaryings(d);
#if defined(TEXTURE_ATLAS)

#if defined(TEXTURE_ALBEDO_GLOBAL)
    vVertexAlbedo = aVertexColour;
#else
    vVertexAlbedo = vec4(mix(aVertexColourUnwhitenedRGB_TilePositionLevel.stp, aVertexColour.stp, step(.5, fract(aVertexNormal_BatchFlags.q * 8.))), aVertexColour.q);
#endif

#else
    vVertexAlbedo = vec4(aVertexColourUnwhitenedRGB_TilePositionLevel.stp, aVertexColour.q);
#endif
    // vVertexAlbedo.q += uFade;
#if defined(TINT)

#if !defined(PUSH_TO_FARPLANE)
    // vVertexAlbedo.stp = vVertexAlbedo.stp + uTint.q * (uTint.stp - vVertexAlbedo.stp);
#endif

#endif

#if defined(ANIMATION_VERTEX)
    vVertexAlbedo.q += uLabelDeltas[int(d)].q;
    vVertexAlbedo.q = clamp(vVertexAlbedo.q, 0., 1.);
#if defined(ANIMATION_COLOUR_RGB) || defined(ANIMATION_COLOUR_HSL)

#if defined(ANIMATION_COLOUR_RGB)
    vVertexAlbedo.stp += uLabelDeltas[int(d)].stp;
#endif

#if defined(ANIMATION_COLOUR_HSL)
    vVertexAlbedo = convertRGBtoHSL(vVertexAlbedo);
    vVertexAlbedo.s = fract(vVertexAlbedo.s + uLabelDeltas[int(d)].s);
    vVertexAlbedo.tp = clamp(vVertexAlbedo.tp + uLabelDeltas[int(d)].tp, 0., 1.);
    vVertexAlbedo = convertHSLtoRGB(vVertexAlbedo);
#endif

#if defined(BAKED_SRGB_TO_LINEAR) && !defined(GAMMA_CORRECT_INPUTS)
    vVertexAlbedo.stp = SRGBToLinear(vVertexAlbedo.stp);
#endif

#endif

#endif

#if !defined(BAKED_SRGB_TO_LINEAR) && defined(GAMMA_CORRECT_INPUTS)
    vVertexAlbedo.stp = SRGBToLinear(vVertexAlbedo.stp);
#endif

#if defined(GOURAUD_SHADING)
    float p = dot(vNormal, uInvSunDirection);
    vVertexAlbedo.stp = vVertexAlbedo.stp * (uAmbientColour + uSunColour * p);
#endif

#if defined(POINT_LIGHTING)
    vTilePosition = vec3(floor(aVertexColourUnwhitenedRGB_TilePositionLevel.q * 255. + .1), aMaterialSettingsSlotXY_TilePositionXZ.pq);
#endif
    vMaterialSettingsSlotXY_BatchFlags.p = aVertexNormal_BatchFlags.q + .25 / 128.;
#if defined(TEXTURE_ATLAS)
    AssignTextureAtlasVaryings(vTextureUV, vMaterialSettingsSlotXY_BatchFlags.st, aTextureUV, aMaterialSettingsSlotXY_TilePositionXZ.st);
#endif

#if defined(DEBUG_VERTEX_BONE_COLOUR)

#if defined(ANIMATION_VERTEX)
    vVertexAlbedo.stpq = vec4(mod(aVertexPosition_BoneLabel.q / 5., 1.), mod(aVertexPosition_BoneLabel.q / 14., 1.), mod(aVertexPosition_BoneLabel.q / 63., 1.), 1.);
#else
    vVertexAlbedo.stpq = vec4(0.);
#endif

#endif

#if defined(LIGHT_SCATTERING) || defined(FOG_DISTANCE)
    vec4 o = uModelMatrix * vec4(aVertexPosition_BoneLabel.stp, 1.);
    vec3 v = o.stp - uCameraPosition;
    float a = length(v);
#if defined(LIGHT_SCATTERING) && defined(SUNLIGHT_DIRECT_LIGHTING)
    ComputeInOutScattering(normalize(v), a, uInvSunDirection.stp, vOutScattering, vInScattering);
#else
    vOutScattering = vec3(1.);
    vInScattering = vec3(0.);
#endif

#if defined(FOG_DISTANCE)
    float q = FogBasedOnDistance(a);
    vInScattering = mix(vInScattering, uFogColour.stp, q);
    vOutScattering *= 1. - q;
#endif

#endif
}
