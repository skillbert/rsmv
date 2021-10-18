varying highp float fFlag4;
varying highp float fFlag8;
varying highp vec4 fColour;
varying highp vec3 fNormal;
varying highp vec4 fTangent;
varying highp vec2 fUV;
varying highp vec4 fPos;
varying highp vec4 fCamPos;
varying highp vec4 fOrigin;

uniform sampler2D diffuseMap;
uniform sampler2D normalMap;
uniform sampler2D compoundMap;
uniform sampler2D environmentMap;
uniform highp vec3 materialColour;

// https://stackoverflow.com/a/18038495
/*highp mat4 transpose(in highp mat4 inMatrix) {
    highp vec4 i0 = inMatrix[0];
    highp vec4 i1 = inMatrix[1];
    highp vec4 i2 = inMatrix[2];
    highp vec4 i3 = inMatrix[3];

    highp mat4 outMatrix = mat4(
                 vec4(i0.x, i1.x, i2.x, -i3.x),
                 vec4(i0.y, i1.y, i2.y, -i3.y),
                 vec4(i0.z, i1.z, i2.z, -i3.z),
                 vec4(i0.w, i1.w, i2.w, i3.w)
                 );

    return outMatrix;
}*/

highp mat3 transpose(in highp mat3 m)
{
    return mat3(
        vec3(m[0].x, m[1].x, m[2].x),
        vec3(m[0].y, m[1].y, m[2].y),
        vec3(m[0].z, m[1].z, m[2].z)
    );
}

// https://www.shadertoy.com/view/XljGzV
highp vec3 hsl2rgb( in vec3 c )
{
    highp vec3 rgb = clamp( abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0 );

    return c.z + c.y * (rgb-0.5)*(1.0-abs(2.0*c.z-1.0));
}

highp vec3 rgb2hsl( in vec3 c )
{
  highp float h = 0.0;
	highp float s = 0.0;
	highp float l = 0.0;
	highp float r = c.r;
	highp float g = c.g;
	highp float b = c.b;
	highp float cMin = min( r, min( g, b ) );
	highp float cMax = max( r, max( g, b ) );

	l = ( cMax + cMin ) / 2.0;
	if ( cMax > cMin ) {
		highp float cDelta = cMax - cMin;
        
        //s = l < .05 ? cDelta / ( cMax + cMin ) : cDelta / ( 2.0 - ( cMax + cMin ) ); Original
		s = l < .0 ? cDelta / ( cMax + cMin ) : cDelta / ( 2.0 - ( cMax + cMin ) );
        
		if ( r == cMax ) {
			h = ( g - b ) / cDelta;
		} else if ( g == cMax ) {
			h = 2.0 + ( b - r ) / cDelta;
		} else {
			h = 4.0 + ( r - g ) / cDelta;
		}

		if ( h < 0.0) {
			h += 6.0;
		}
		h = h / 6.0;
	}
	return vec3( h, s, l );
}

highp vec3 rgb2hsv(highp vec3 c)
{
    highp vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    highp vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    highp vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    highp float d = q.x - min(q.w, q.y);
    highp float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

highp vec3 hsv2rgb(highp vec3 c)
{
    highp vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    highp vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

highp vec3 sampleEnvironmentMap(highp vec3 vector, highp float roughness)
{
    /*highp mat3 components[3];

    highp vec3 sky = vec3(91.0, 187.0, 211.0) / 255.0;
    highp vec3 grass = vec3(77.0, 133.0, 31.0) / 255.0;

    highp vec3 result = vec3(0.0, 0.0, 0.0);
    highp vec3 curVec = normalize(vector);
    highp float skyDot = ((curVec.y > 0.0 ? 1.0 : -1.0) * pow(abs(curVec.y), 1.0 / 3.0) + 1.0) / 2.0;
    for (int i = 0; i < 3; ++i)
        result[i] = mix(grass[i], sky[i], smoothstep(0.0, 1.0, skyDot));
    for (int i = 0; i < 3; ++i)
        result[i] = clamp(result[i], 0.0, 1.0);
    return result;*/
    highp vec3 curVec = normalize(vector);
    highp vec2 coords = (curVec.xy + 1.0) / 2.0;//vec2((curVec.x + 1.0) / 2.0, -(curVec.y + 1.0) / 2.0);
    coords.y = 1.0 - coords.y;
    return texture2D(environmentMap, coords).xyz;
}

void main()
{
    // Inline until moved to engine
    highp mat4 lightsource;
    lightsource[0] = normalize(vec4(0.0, -1.0, -1.0, 0.0));
    lightsource[1] = vec4(vec3(255.0, 255.0, 255.0) / 255.0, 276.0 / 2048.0);
    lightsource[2] = vec4(vec3(111.0, 177.0, 235.0) / 255.0, 1000.0 / 3000.0);
    lightsource[3] = vec4(vec3(106.0, 106.0, 106.0) / 153.0, 153.0 / 1000.0);

    highp vec4 diffuse = texture2D(diffuseMap, fUV);
    highp vec4 compound = texture2D(compoundMap, fUV);
    highp vec3 fhsl = fColour.xyz;
    highp vec3 dhsl = rgb2hsv(diffuse.xyz);
    //diffuse.xyz += fColour.xyz - 0.5;

    //diffuse.xyz = hsv2rgb(  vec3( fhsl.x, fhsl.y, clamp(fhsl.z + dhsl.z * (1.0 - fhsl.z), 0.0, 1.0) )  );
    //diffuse.xyz = hsv2rgb(fColour.xyz);
    //col = hsv2rgb(vec3(materialColour.x + fColour.x + dhsl.x, materialColour.y + fColour.y, dhsl.z));//vec3(materialColour.x, materialColour.yz + dhsl.yz));
    //diffuse.xyz = hsv2rgb(vec3(fColour.x, fColour.y + dhsl.y, fColour.z + dhsl.z));

    //diffuse.xyz = hsv2rgb(vec3(0.5, 1.0, 1.0));
    //diffuse.xyz = hsv2rgb(fColour.xyz);
    //diffuse.xyz = hsl2rgb(fhsl + (dhsl - vec3(0.5)));
    //diffuse.xyz = hsl2rgb(vec3(0.0, 0.0, 1.0));
    //diffuse.xyz += vec3(0.2);
    //diffuse.xyz = fColour.xyz;

    highp vec3 normal = normalize(fNormal);
    highp vec3 tangent = fTangent.xyz * fTangent.w;
    tangent -= dot(tangent, normal) * normal;
    tangent = normalize(tangent);
    highp mat3 cobMatrix;
    cobMatrix[2] = cross(tangent, normal);
    cobMatrix[1] = normal;
    cobMatrix[0] = tangent;
    //cobMatrix = transpose(cobMatrix);
    normal = texture2D(normalMap, fUV).yzw;
    normal -= 0.5;
    normal *= 2.0;
    normal = normalize(normal);
    normal = cobMatrix * normal;

    highp vec3 lightVec = lightsource[0].xyz;

    highp vec3 camVec = normalize(fCamPos.xyz - fPos.xyz);
    highp vec3 reflectVec = camVec - 2.0 * dot(camVec, normal) * normal;
    highp float specular = pow(clamp(dot(lightVec, reflectVec), 0.0, 1.0), 32.0);
    
    lightVec = normalize(fCamPos.xyz - fOrigin.xyz);
    highp float ambience = lightsource[1][3] * 2.0;
    //ambience = 0.0;
    //highp vec3 col = (vec3(specular * (compound.x + 1.0 - compound.y)) + diffuse.xyz) * (dot(lightVec, normalize(normal)) * (1.0 - ambience) + ambience);
    highp vec3 col = (vec3(specular) * (1.0 - compound.y) + diffuse.xyz) * (dot(lightVec, normalize(normal)) * (1.0 - ambience) + ambience);
    highp vec3 env = sampleEnvironmentMap(-reflectVec, 0.0) * compound.x + vec3(specular) * (1.0 - compound.y);
    highp float envG = (env.x + env.y + env.z) / 3.0;
    for (int i = 0; i < 3; ++i)
        col[i] = mix(col[i], col[i] * env[i], compound.x);
    
    //col = hsv2rgb(fColour.xyz) + hsv2rgb(materialColour) * diffuse.xyz;
    //col = hsv2rgb(vec3(fColour.xy, diffuse.x));
    //col = hsv2rgb(vec3(materialColour.x, 1.0, materialColour.z));

    //col = vec3(fFlag4, -fFlag4, 0.0);

    //col = sampleEnvironmentMap(-camVec, 0.0);

    //col = fakeEnvironmentMap(-reflectVec, 0.0);

    //col = compound.xyz;

    //col = vec3(specular);

    //col = vec3(dot(cobMatrix * normal, lightVec));
    //col = vec3(dot(normalize(col), lightVec));

    //col = normal;

    //col = fNormal;
    //col = fCamPos.xyz * (dot(lightVec, normalize(fNormal)) * (1.0 - ambience) + ambience);
    //col = fPos.xyz;

    highp float alpha = 1.0; //diffuse.w;
    /*if (dot(diffuse.xyz, diffuse.xyz) < 0.1 && diffuse.w < 0.1)
        alpha = diffuse.w;
    if (alpha < 0.05)
        discard;*/
    /*if (diffuse.w < 0.5)
        discard;*/
    gl_FragColor = vec4(col, alpha);
    //gl_FragColor = vec4(fTangent.xyz * fTangent.w, 1.0);
    //gl_FragColor = vec4(fNormal , 1.0);
    //gl_FragColor = diffuse;

    // HSL
    // f( [0.35 0.87 0.20], [0.0 0.0 0.96] ) = [0.49 0.49 0.57]
    // f( [0.35 0.87 0.20], [0.0 0.0 0.15] ) = [0.60 0.71 0.11]

    // RGB
    // f( [52 33 7], [255 255 255] ) = [146 133 74] Upper
    // f( [52 33 7], [38 38 38] ) = [28 28 8] Lower
    // f( [0.20 0.13 0.03], [1.0 1.0 1.0] ) = [0.57 0.52 0.29]
    // f( [0.20 0.13 0.03], [0.15 0.15 0.15] ) = [0.11 0.11 0.03]


    
    // Old RGB [97 59 7] [0.38 0.23 0.03] HSV [0.35 0.93 0.38]










    // f( [217 1.0 0.20], [210 0.03 0.76] ) = [225 0.40 0.80]
    // f( [217 1.0 0.20], [217 0.10 0.51] ) = [225 0.50 0.61]
}