import { getProjectionMatrix, Matrix4x4Utils, packedHSL2HSL } from "../utils";
import { Mesh, OB3 } from "../3d/ob3";

//TODO very weak typing in this file
type RenderCanvas = HTMLCanvasElement & {
	dataset: any,
	gvContext: {
		gl: any,
		ext: any,
		model: OB3,
		shaderProgram: any
	}
};

function onMouseMove(this: RenderCanvas, e: MouseEvent) {
	var rect = this.getBoundingClientRect();
	var x = e.clientX - rect.left;
	var y = e.clientY - rect.top;
	if (!(e.button == 0 && (e.buttons & 0x3) == e.buttons)) {
		this.dataset.prevCx = x;
		this.dataset.prevCy = y;
		return;
	}
	var dx = x - this.dataset.prevCx;
	var dy = y - this.dataset.prevCy;
	if (e.buttons == 1) {
		this.dataset.rxz = this.dataset.rxz * 1.0 + dx;
		this.dataset.ryz = this.dataset.ryz * 1.0 + dy;
		this.dataset.ryz = Math.max(Math.min(this.dataset.ryz, 90), this.dataset.minRyz);
	}
	if (e.buttons == 2) {
		this.dataset.viewingHeight = Math.max(this.dataset.viewingHeight * 1.0 + dy * 0.01, 0.0);
		this.dataset.consumeClick = true;
	}
	module.exports.draw(this);
	this.dataset.prevCx = x;
	this.dataset.prevCy = y;
}

function onWheel(e: any) {
	e.preventDefault();
	this.dataset.zoom = Math.max(this.dataset.zoom * 1.0 + (e.deltaY > 0 ? 1.0 : -1.0) * 0.5, 0.0);
	module.exports.draw(this);
}

function onResize(e) {
	module.exports.draw(document.getElementById("viewer"));
}

export function init(canvas: RenderCanvas, model: OB3, vertexShaderSource: string, fragmentShaderSource: string) {
	if (canvas.dataset.rxz === undefined)
		canvas.dataset.rxz = 0.0;
	if (canvas.dataset.ryz === undefined)
		canvas.dataset.ryz = 30;
	if (canvas.dataset.minRyz === undefined)
		canvas.dataset.minRyz = -90;
	if (canvas.dataset.zoom === undefined)
		canvas.dataset.zoom = 5.5;
	if (canvas.dataset.viewingHeight === undefined)
		canvas.dataset.viewingHeight = 0.0;

	var gl = canvas.getContext("webgl", { preserveDrawingBuffer: true }); //  for node.js implementation, to allow saving of png
	if (!gl) {
		console.log("Couldn't create GL instance");
		return;
	}
	var ext = gl.getExtension('ANGLE_instanced_arrays');
	if (!ext) {
		console.log("Couldn't load GL extension");
		return;
	}

	/*var model = new OB3();
	model.setData(data);*/

	// WebGL code
	gl.enable(gl.CULL_FACE);
	gl.cullFace(gl.FRONT);
	gl.enable(gl.DEPTH_TEST);
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	//gl.enable(gl.MULTISAMPLE); 
	gl.clearColor(0.0, 0.0, 0.0, 0.0);
	gl.viewport(0, 0, canvas.clientWidth, canvas.clientHeight);
	var vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
	gl.shaderSource(vertexShader, vertexShaderSource);
	gl.compileShader(vertexShader);
	var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
	gl.shaderSource(fragmentShader, fragmentShaderSource);
	gl.compileShader(fragmentShader);
	if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
		console.log("Fragment Shader Error:\n" + gl.getShaderInfoLog(vertexShader));
	}
	if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
		console.log("Fragment Shader Error:\n" + gl.getShaderInfoLog(fragmentShader));
	}
	var shaderProgram = gl.createProgram()!;
	gl.attachShader(shaderProgram, vertexShader);
	gl.attachShader(shaderProgram, fragmentShader);
	gl.linkProgram(shaderProgram);
	gl.useProgram(shaderProgram);
	// Uniforms
	var projectionMatrixUniform = gl.getUniformLocation(shaderProgram, "projection");
	var projectionMatrix = getProjectionMatrix(40 * Math.PI / 180, canvas.clientWidth / canvas.clientHeight, 0.01, 20.0);
	//projectionMatrix[14] *= -1.0;
	//gl.depthRange(1, 0);
	gl.uniformMatrix4fv(projectionMatrixUniform, false, projectionMatrix);

	var diffuseMapUniform = gl.getUniformLocation(shaderProgram, "diffuseMap");
	var normalMapUniform = gl.getUniformLocation(shaderProgram, "normalMap");
	var compoundMapUniform = gl.getUniformLocation(shaderProgram, "compoundMap");
	var environmentMapUniform = gl.getUniformLocation(shaderProgram, "environmentMap");
	gl.uniform1i(diffuseMapUniform, 0);
	gl.uniform1i(normalMapUniform, 1);
	gl.uniform1i(compoundMapUniform, 2);
	gl.uniform1i(environmentMapUniform, 3);

	var materialGroups = model.getMaterialGroups();
	for (var g = 0; g < materialGroups.length; ++g) {
		let group = materialGroups[g];
		// Texture
		gl.activeTexture(gl.TEXTURE0 + 0);
		group.textureBufferBind = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, group.textureBufferBind);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
			new Uint8Array([255, 255, 255, 255])); // Default to white so when we multiply by the colour, it just defaults to that

		// Normal map
		gl.activeTexture(gl.TEXTURE0 + 1);
		group.normalMapBufferBind = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, group.normalMapBufferBind);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
			new Uint8Array([0, 128, 255, 128])); // Default to this colour so our normals are flat by default

		// Compound map
		gl.activeTexture(gl.TEXTURE0 + 2);
		group.compoundMapBufferBind = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, group.compoundMapBufferBind);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
			new Uint8Array([0, 255, 255, 0])); // I ain't know what go on here, let's do cyan

		// Environment map
		gl.activeTexture(gl.TEXTURE0 + 3);
		group.environmentMapBufferBind = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, group.environmentMapBufferBind);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
			new Uint8Array([255, 255, 255, 0]));

		// Vertices
		group.vertexBufferBind = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, group.vertexBufferBind);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.vertexBuffer), gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		// Normals
		group.normalBufferBind = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, group.normalBufferBind);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.normalBuffer), gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		// Tangents
		group.tangentBufferBind = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, group.tangentBufferBind);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.tangentBuffer), gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		// UV coordinates
		group.uvBufferBind = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, group.uvBufferBind);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.uvBuffer), gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		// Colours
		group.colourBufferBind = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, group.colourBufferBind);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.colourBuffer), gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		if ((group.groupFlags & 0x04) == 0x04) {
			// flag4
			group.flag4BufferBind = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, group.flag4BufferBind);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.flag4Buffer), gl.STATIC_DRAW);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		}

		if ((group.groupFlags & 0x08) == 0x08) {
			// flag8
			group.flag8BufferBind = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, group.flag8BufferBind);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.flag8Buffer), gl.STATIC_DRAW);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		}

		group.indexBufferBinds = [];
		for (var ib = 0; ib < group.indexBuffers.length; ++ib) {
			group.indexBufferBinds.push(gl.createBuffer()!);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, group.indexBufferBinds[ib]);
			gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(group.indexBuffers[ib]), gl.STATIC_DRAW);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
		}
	}

	canvas.gvContext = { gl, ext, model, shaderProgram };

	//3 different cases needed to add a load cb, i'm not sure if the wiki needs all these
	let loadcb = function () { module.exports.draw(canvas); };
	if (Array.isArray(model.onfinishedloading)) { model.onfinishedloading.push(loadcb); }
	else if (model.onfinishedloading) { model.onfinishedloading = [model.onfinishedloading, loadcb]; }
	else { model.onfinishedloading = [loadcb]; }

	model.loadMaterials();

	//give texture loading a small headstart so they load before first draw if they are local
	setTimeout(() => this.draw(canvas), 200);

	if (canvas.addEventListener) {
		canvas.addEventListener("mousemove", onMouseMove);
		canvas.addEventListener("wheel", onWheel);

		canvas.addEventListener('contextmenu', function (e) {
			if (!(this.dataset.consumeClick === undefined)) {
				if (this.dataset.consumeClick)
					e.preventDefault();
				delete this.dataset.consumeClick;
			}
		}, false);

		window.addEventListener("resize", onResize);
	}
	else {
		//TODO i'm guessing this isn't to support ie8, but somethign else instead?
		//@ts-ignore
		canvas.attachEvent("onmousemove", rsw_3d_gl_onMouseMove);
		//@ts-ignore
		canvas.attachEvent("onwheel", rsw_3d_gl_onWheel);

		//@ts-ignore
		canvas.attachEvent('oncontextmenu', function () {
			if (!(this.dataset.consumeClick === undefined)) {
				if (this.dataset.consumeClick)
					//@ts-ignore
					window.event.returnValue = false;
				delete this.dataset.consumeClick;
			}
		});

		//@ts-ignore
		window.attachEvent("onresize", onResize);
	}

	//console.log(materialGroups);
	//console.log(gl.getError());
}

export function draw(element: RenderCanvas) {
	if (typeof element.gvContext == 'undefined') {
		// Not an actual model viewer
		return;
	}
	var gl = element.gvContext.gl;
	var ext = element.gvContext.ext;
	var materialGroups = element.gvContext.model.getMaterialGroups();
	var shaderProgram = element.gvContext.shaderProgram;

	element.width = element.clientWidth;
	element.height = element.clientHeight;
	gl.viewport(0, 0, element.clientWidth, element.clientHeight);

	/*for (var g = 0; g < groups.length; ++g)
	{
		if (groups[g].materialId == 0)
			continue;
		if (groups[g].texture == null)
			return;
		if (!groups[g].texture.isReady)
			return;
	}*/

	// Shader variables
	var vertexAttribute = gl.getAttribLocation(shaderProgram, "pos");
	var normalAttribute = gl.getAttribLocation(shaderProgram, "normal");
	var tangentAttribute = gl.getAttribLocation(shaderProgram, "tangent");
	var uvAttribute = gl.getAttribLocation(shaderProgram, "uv");
	var colourAttribute = gl.getAttribLocation(shaderProgram, "colour");
	var flag4Attribute = gl.getAttribLocation(shaderProgram, "flag4");
	var flag8Attribute = gl.getAttribLocation(shaderProgram, "flag8");
	var worldMatrixUniform = gl.getUniformLocation(shaderProgram, "world");
	var viewMatrixUniform = gl.getUniformLocation(shaderProgram, "view");
	var inverseViewMatrixUniform = gl.getUniformLocation(shaderProgram, "inverseView");
	var originUniform = gl.getUniformLocation(shaderProgram, "origin");
	var materialColourUniform = gl.getUniformLocation(shaderProgram, "materialColour");
	var worldMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	var rxz = element.dataset.rxz * Math.PI / 180.0;
	var ryz = -element.dataset.ryz * Math.PI / 180.0;
	var mu = Matrix4x4Utils;
	var viewMatrix = mu.mul(mu.mul(mu.mul(mu.translation(0.0, -element.dataset.viewingHeight, 0.0), mu.rotation("y", rxz)), mu.rotation("x", ryz)), mu.translation(0.0, 0.0, -element.dataset.zoom));
	gl.uniformMatrix4fv(worldMatrixUniform, false, worldMatrix);
	gl.uniformMatrix4fv(viewMatrixUniform, false, viewMatrix);

	var inverseViewMatrix = mu.mul(mu.mul(mu.mul(mu.translation(0.0, 0.0, element.dataset.zoom), mu.rotation("x", -ryz)), mu.rotation("y", -rxz)), mu.translation(0.0, element.dataset.viewingHeight, 0.0));
	gl.uniformMatrix4fv(inverseViewMatrixUniform, false, inverseViewMatrix);

	var projectionMatrixUniform = gl.getUniformLocation(shaderProgram, "projection");
	var projectionMatrix = getProjectionMatrix(40 * Math.PI / 180, element.clientWidth / element.clientHeight, 0.01, 200.0);
	gl.uniformMatrix4fv(projectionMatrixUniform, false, projectionMatrix);

	gl.uniform4f(originUniform, 0.0, element.dataset.viewingHeight * 1.0, 0.0, 1.0);

	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	for (var g = 0; g < materialGroups.length; ++g) {
		let group = materialGroups[g];
		var materialColour = [0, 0, 0];
		if (!(group.colour === undefined))
			materialColour = packedHSL2HSL(group.colour);
		gl.uniform3f(materialColourUniform, materialColour[0], materialColour[1], materialColour[2]);

		// Texture
		gl.activeTexture(gl.TEXTURE0 + 0);
		gl.bindTexture(gl.TEXTURE_2D, group.textureBufferBind);
		if (group.textures["diffuse"]?.texture && !group.textureBufferLoaded) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, group.textures["diffuse"].texture);
			gl.generateMipmap(gl.TEXTURE_2D);
			group.textureBufferLoaded = true;
		}

		// Normal map
		gl.activeTexture(gl.TEXTURE0 + 1);
		gl.bindTexture(gl.TEXTURE_2D, group.normalMapBufferBind);
		if (group.textures["normal"]?.texture && !group.normalMapBufferLoaded) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, group.textures["normal"].texture);
			gl.generateMipmap(gl.TEXTURE_2D);
			group.normalMapBufferLoaded = true;
		}

		// Compound map
		gl.activeTexture(gl.TEXTURE0 + 2);
		gl.bindTexture(gl.TEXTURE_2D, group.compoundMapBufferBind);
		if (!group.compoundMapBufferLoaded) {
			if (group.textures["compound"]) {
				if (group.textures["compound"].texture) {
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, group.textures["compound"].texture);
					gl.generateMipmap(gl.TEXTURE_2D);
					group.compoundMapBufferLoaded = true;
				}
			} else {
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
					new Uint8Array([group.metalness || 0, 255 - (group.specular || 0), 255, 0]));
				group.compoundMapBufferLoaded = true;
			}
		}

		// Environment map
		gl.activeTexture(gl.TEXTURE0 + 3);
		gl.bindTexture(gl.TEXTURE_2D, group.environmentMapBufferBind);
		if (group.textures["environment"]?.texture && !group.environmentMapBufferLoaded) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, group.textures["environment"].texture);
			gl.generateMipmap(gl.TEXTURE_2D);
			group.environmentMapBufferLoaded = true;
		}

		// Vertices
		gl.bindBuffer(gl.ARRAY_BUFFER, group.vertexBufferBind);
		gl.vertexAttribPointer(vertexAttribute, 3, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(vertexAttribute);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		// Normals
		gl.bindBuffer(gl.ARRAY_BUFFER, group.normalBufferBind);
		gl.vertexAttribPointer(normalAttribute, 3, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(normalAttribute);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		// Tangents
		gl.bindBuffer(gl.ARRAY_BUFFER, group.tangentBufferBind);
		gl.vertexAttribPointer(tangentAttribute, 4, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(tangentAttribute);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		// UV coordinates
		gl.bindBuffer(gl.ARRAY_BUFFER, group.uvBufferBind);
		gl.vertexAttribPointer(uvAttribute, 2, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(uvAttribute);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		// Colours
		gl.bindBuffer(gl.ARRAY_BUFFER, group.colourBufferBind);
		gl.vertexAttribPointer(colourAttribute, 3, gl.FLOAT, false, 0, 0);
		ext.vertexAttribDivisorANGLE(colourAttribute, 1);
		gl.enableVertexAttribArray(colourAttribute);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		// flag4
		if ((group.groupFlags & 0x04) == 0x04) {
			gl.bindBuffer(gl.ARRAY_BUFFER, group.flag4BufferBind);
			gl.vertexAttribPointer(flag4Attribute, 1, gl.FLOAT, false, 0, 0);
			ext.vertexAttribDivisorANGLE(flag4Attribute, 1);
			gl.enableVertexAttribArray(flag4Attribute);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		}

		// flag8
		if ((group.groupFlags & 0x08) == 0x08) {
			gl.bindBuffer(gl.ARRAY_BUFFER, group.flag8BufferBind);
			gl.vertexAttribPointer(flag8Attribute, 1, gl.FLOAT, false, 0, 0);
			ext.vertexAttribDivisorANGLE(flag8Attribute, 1);
			gl.enableVertexAttribArray(flag8Attribute);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		}

		//only render the first level of detail (the other buffers contain lower detail models)
		//for (var ib = 0; ib < group.indexBuffers.length; ++ib) {
		let ib = 0;
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, group.indexBufferBinds![ib]);
		gl.drawElements(gl.TRIANGLES, group.indexBuffers[ib].length, gl.UNSIGNED_SHORT, 0);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
		//}
	}
}