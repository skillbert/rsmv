attribute vec3 pos;
attribute vec3 normal;
attribute vec4 tangent;
attribute vec2 uv;
attribute vec3 colour;
attribute float flag4;
attribute float flag8;

uniform mat4 world;
uniform mat4 view;
uniform mat4 projection;
uniform mat4 inverseView;
uniform vec4 origin;

varying highp vec4 fColour;
varying highp float fFlag4;
varying highp float fFlag8;
varying highp vec3 fNormal;
varying highp vec4 fTangent;
varying highp vec2 fUV;
varying highp vec4 fPos;
varying highp vec4 fCamPos;
varying highp vec4 fOrigin;
//varying highp vec4 fLightVec;

void main()
{
    gl_Position = projection * view * vec4(pos.xyz / 256.0, 1.0);
    fColour = vec4(colour, 1.0);
    fFlag4 = flag4;
    fFlag8 = flag8;
    fNormal = normal;
    fUV = uv;
    fTangent = tangent;
    fPos = vec4(pos / 256.0, 1.0);
    fCamPos = inverseView * vec4(vec3(0.0), 1.0);
    fOrigin = origin;
}