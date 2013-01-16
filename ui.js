/* UIContext is a class for recording 2D draw ops and replaying them on a webGL context */
function UIContext() {
	assert(this!==window);
	this.width = this.height = 0;
	this.buffers = [];
	this.data = [];
	this.vbo = null;
	this.corners = [];
	if(!UIContext.program)
		UIContext.program = createProgram(
			"uniform mat4 mvp;\n"+
			"uniform float z;\n"+
			"attribute vec2 vertex;\n"+
			"attribute vec2 texcoord;\n"+
			"varying vec2 tx;\n"+
			"void main() {\n"+
			"	tx = texcoord;\n"+
			"	gl_Position = mvp * vec4(vertex,z,1.0);\n"+
			"}",
			"precision mediump float;\n"+
			"uniform vec4 colour;\n"+
			"varying vec2 tx;\n"+
			"uniform sampler2D texture;\n"+
			"void main() {\n"+
			"	vec4 c = texture2D(texture,tx);\n"+
			"	gl_FragColor = colour * c;\n"+
			"}",["mvp","colour","z","texture"],["vertex","texcoord"]);
	if(!UIContext.blankTex)
		UIContext.blankTex = createTexture(1,1,new Uint8Array([255,255,255,255]));
};
UIContext.corners = {};
UIContext.prototype = {
	clear: function() {
		this.data = [];
		this.buffers = [];
	},
	finish: function() {
		if(!this.vbo) this.vbo = gl.createBuffer();
		if(this.data.length) {
			gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
			gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(this.data),gl.STATIC_DRAW);
			gl.bindBuffer(gl.ARRAY_BUFFER,null);
		}
		this.data = this.data.length; // better to make it crash
	},
	inject: function(callback) {
		if(this.buffers.length)
			this.buffers[this.buffers.length-1].stop = this.data.length;
		this.buffers.push({
			injector: callback,
			texture: "invalid",
			start: this.data.length,
			stop: -1,
		});
	},
	transform: function(callback) { // give it a callback that gets called at each draw to modify the mvp matrix
		if(this.buffers.length)
			this.buffers[this.buffers.length-1].stop = this.data.length;
		this.buffers.push({
			transform: callback,
			texture: "invalid",
			start: this.data.length,
			stop: -1,
		});
	},
	set: function(texture,colour,mode) {
		if(this.buffers.length) {
			var buffer = this.buffers[this.buffers.length-1];
			if(buffer.texture == texture && buffer.colour == colour && buffer.mode == mode)
				return;
			buffer.stop = this.data.length;
		}
		this.buffers.push({
			texture: texture,
			colour: colour,
			transform: null,
			mode: mode,
			start: this.data.length,
			stop: -1, // marker to say until end of buffer
		});
	},
	drawRect: function(texture,colour,x1,y1,x2,y2,tx1,ty1,tx2,ty2) {
		this.set(texture,colour,gl.TRIANGLES);
		this.data = this.data.concat([
			x1,y2,tx1,ty2, x2,y1,tx2,ty1, x1,y1,tx1,ty1, //CCW
			x2,y2,tx2,ty2, x2,y1,tx2,ty1, x1,y2,tx1,ty2]);
	},
	fillRect: function(colour,x1,y1,x2,y2) {
		this.drawRect(UIContext.blankTex,colour,x1,y1,x2,y2,0,0,1,1);
	},
	drawLine: function(colour,x1,y1,x2,y2,width) {
		if(!width) {
			this.set(UIContext.blankTex,colour,gl.LINES);
			this.data = this.data.concat([x1,y1,0,0,x2,y2,1,1]);
		} else {
			this.set(UIContext.blankTex,colour,gl.TRIANGLES);
			width /= 2;
			var	angle = Math.atan2(y2 - y1, x2 - x1),
				cos = width * Math.cos(angle),
				sin = width * Math.sin(angle);
			this.data = this.data.concat([
			    x1 + sin, y1 - cos, 1, 0,
			    x2 + sin, y2 - cos, 1, 0,
			    x2 - sin, y2 + cos, 0, 1,
			    x2 - sin, y2 + cos, 0, 1,
			    x1 - sin, y1 + cos, 0, 1,
			    x1 + sin, y1 - cos, 1, 0,
			]);
		}
	},
	drawBox: function(colour,x1,y1,x2,y2) {
		this.drawLine(colour,x1,y1,x2,y1);
		this.drawLine(colour,x1,y2,x2,y2);
		this.drawLine(colour,x1,y1,x1,y2);
		this.drawLine(colour,x2,y1,x2,y2);
	},
	fillCircle: function(colour,x1,y1,radius) {
		this.fillRoundedRect(colour,radius,x1,y1,x1,y1);
	},
	_makeCorners: function(r) {
		var pts = [],
			x = r, y = 0,
			theta = 2 * Math.PI / (r*4),
			cos = Math.cos(theta), sin = Math.sin(theta);
		for(var i=0; i<r; i++) {
			var px = x, py = y;
			x = cos * x - sin * y;
			y = sin * px + cos * y;
			pts.push([px,py,x,y]);
		}
		return pts;
	},
	fillRoundedRect: function(colour,margin,x1,y1,x2,y2) {
		var	corner = UIContext.corners[margin] = UIContext.corners[margin] || this._makeCorners(margin),
			pts = [];
		for(var pt in corner) {
			pt = corner[pt];
			this._fillRoundedRect_addPoint(pts,pt,x1,-1,y1,-1);
			this._fillRoundedRect_addPoint(pts,pt,x2,+1,y1,-1);
			this._fillRoundedRect_addPoint(pts,pt,x1,-1,y2,+1);
			this._fillRoundedRect_addPoint(pts,pt,x2,+1,y2,+1);
		}
		this.drawRect(UIContext.blankTex,colour,x1,y1-margin,x2,y2+margin,0,0,1,1); // sets up right texture and colour buffer
		this.drawRect(UIContext.blankTex,colour,x1-margin,y1,x1,y2,0,0,1,1);
		this.drawRect(UIContext.blankTex,colour,x2,y1,x2+margin,y2,0,0,1,1);
		this.data = this.data.concat(pts);
	},
	_fillRoundedRect_addPoint: function(pts,pt,x,xdir,y,ydir) {
		pts.push(
			x + xdir*pt[0], y + ydir*pt[1],
			0, 0,
			x + xdir*pt[2], y + ydir*pt[3],
			1, 0,
			x, y,
			1, 1
		);
	},
	drawRoundedRect: function(colour,margin,width,x1,y1,x2,y2) {
		var corner = UIContext.corners[margin] = UIContext.corners[margin] || this._makeCorners(margin),
			pts = [], scale = 1.0 - width/margin;
		for(var pt in corner) {
			pt = corner[pt];
			this._drawRoundedRect_addPoint(pts,scale,pt,x1,-1,y1,-1);
			this._drawRoundedRect_addPoint(pts,scale,pt,x2,+1,y1,-1);
			this._drawRoundedRect_addPoint(pts,scale,pt,x1,-1,y2,+1);
			this._drawRoundedRect_addPoint(pts,scale,pt,x2,+1,y2,+1);
		}
		this.drawRect(UIContext.blankTex,colour,x1,y1-margin,x2,y1-margin+width,0,0,1,1); // sets up right texture and colour buffer
		this.drawRect(UIContext.blankTex,colour,x1,y2+margin-width,x2,y2+margin,0,0,1,1);
		this.drawRect(UIContext.blankTex,colour,x1-margin,y1,x1-margin+width,y2,0,0,1,1);
		this.drawRect(UIContext.blankTex,colour,x2+margin-width,y1,x2+margin,y2,0,0,1,1);
		this.data = this.data.concat(pts);
	},
	_drawRoundedRect_addPoint: function(pts,scale,pt,x,xdir,y,ydir) {
		pts.push(
			x + xdir*pt[0], y + ydir*pt[1],
			0, 0,
			x + xdir*pt[2], y + ydir*pt[3],
			1, 0,
			x + xdir*pt[0]*scale, y + ydir*pt[1]*scale,
			1, 1,
			x + xdir*pt[2], y + ydir*pt[3],
			1, 0,
			x + xdir*pt[0]*scale, y + ydir*pt[1]*scale,
			1, 1,
			x + xdir*pt[2]*scale, y + ydir*pt[3]*scale,
			1, 1
		);
	},
	_initShader: function(mvp,program) {
		gl.useProgram(program);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.DEPTH_TEST);
		gl.uniformMatrix4fv(program.mvp,false,mvp);
		gl.uniform1i(program.texture,0);
		gl.uniform1i(program.z,0.6);
		gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
		gl.activeTexture(gl.TEXTURE0);
		gl.enableVertexAttribArray(program.vertex);
		gl.enableVertexAttribArray(program.texcoord);
	},
	_deinitShader: function(program) {
		gl.disableVertexAttribArray(program.vertex);
		gl.disableVertexAttribArray(program.texcoord);
		gl.bindTexture(gl.TEXTURE_2D,null);
		gl.bindBuffer(gl.ARRAY_BUFFER,null);
		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.useProgram(null);
	},
	draw: function(mvp,program,colour) {
		program = program || UIContext.program;
		var inited = false;
		for(var buffer in this.buffers) {
			buffer = this.buffers[buffer];
			if(buffer.injector) {
				this._deinitShader(program);
				inited = false;
				buffer.injector(this);
				continue;
			} else if(buffer.transform) {
				mvp = buffer.transform(mvp);
				if(inited)
					gl.uniformMatrix4fv(program.mvp,false,mvp);
				continue;
			}
			var len = (buffer.stop >= 0? buffer.stop: this.data)-buffer.start;
			if(!len) continue;
			if(!inited) {
				this._initShader(mvp,program);
				inited = true;
			}
			gl.bindTexture(gl.TEXTURE_2D,buffer.texture);
			if(colour)
				gl.uniform4fv(program.colour,[buffer.colour[0]*colour[0],buffer.colour[1]*colour[1],buffer.colour[2]*colour[2],buffer.colour[3]*colour[3]]);
			else
				gl.uniform4fv(program.colour,buffer.colour);
			gl.vertexAttribPointer(program.vertex,2,gl.FLOAT,false,16,0);
			gl.vertexAttribPointer(program.texcoord,2,gl.FLOAT,false,16,8);
			gl.drawArrays(buffer.mode,buffer.start/4,len/4);
		}
		if(inited)
			this._deinitShader(program);
	},
};
