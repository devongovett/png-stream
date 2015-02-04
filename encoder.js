var util = require('util');
var PixelStream = require('pixel-stream');
var zlib = require('zlib');
var BufferList = require('bl');
var crc32 = require('buffer-crc32');

// color types
var PNG_COLOR_TYPE_GRAY = 0;
var PNG_COLOR_TYPE_RGB = 2;
var PNG_COLOR_TYPE_INDEXED = 3;
var PNG_COLOR_TYPE_GRAYA = 4;
var PNG_COLOR_TYPE_RGBA = 6;

// filter types
var PNG_FILTER_NONE = 0;
var PNG_FILTER_SUB = 1;
var PNG_FILTER_UP = 2;
var PNG_FILTER_AVG = 3;
var PNG_FILTER_PAETH = 4;

var PNG_SIGNATURE = new Buffer([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]);

// color type and component count for each supported color space
var PNG_COLOR_SPACES = {
  'rgb': [ PNG_COLOR_TYPE_RGB, 3 ],
  'rgba': [ PNG_COLOR_TYPE_RGBA, 4 ],
  'gray': [ PNG_COLOR_TYPE_GRAY, 1 ],
  'graya': [ PNG_COLOR_TYPE_GRAYA, 2 ],
  'indexed': [ PNG_COLOR_TYPE_INDEXED, 1 ]
};

function PNGEncoder(width, height, opts) {
  PixelStream.apply(this, arguments);
  
  this._buffer = new BufferList();
  this._sequence = 0;
  this._numFrames = 0;
  this._bufferOutput = false;
  this._output = [];
}

util.inherits(PNGEncoder, PixelStream);

PNGEncoder.prototype.supportedColorSpaces = ['rgb', 'rgba', 'gray', 'graya', 'indexed'];

// Override the stream's push function to buffer output for animated
// images so we can write the acTL chunk in the right place.
PNGEncoder.prototype.push = function(buf) {
  if (this._bufferOutput)
    this._output.push(buf);
  else
    PixelStream.prototype.push.call(this, buf);
};

PNGEncoder.prototype._start = function(done) {
  var format = this.format;
  var color = PNG_COLOR_SPACES[format.colorSpace];
  if (!color)
    return done(new Error('Unsupported PNG color space: ' + format.colorSpace));
  
  this.colorType = color[0];
  this.colors = color[1];
  
  if (format.colorSpace === 'indexed' && !format.palette)
    return done(new Error('Requested indexed color space without palette'));
  
  this._pixelBytes = (8 * this.colors) >> 3;
  this._scanlineLength = this._pixelBytes * format.width;
  
  this.push(PNG_SIGNATURE);
  this._writeIHDR();
  if (this.colorType === PNG_COLOR_TYPE_INDEXED)
    this._writePLTE();
    
  // start buffering output if this is an animated image.
  // needed so we can write the acTL chunk at the start
  // which includes the number of frames in the animation.
  this._bufferOutput = format.animated;
  done();
};

PNGEncoder.prototype._startFrame = function(frame, done) {
  this._numFrames++;
  
  // if animated, write fcTL chunk, otherwise ignore
  // this frame if it isn't the first one
  if (this.format.animated)
    this._writefcTL(frame);
  
  else if (this._numFrames > 1)
    return done();
  
  this._prevScanline = null;
  this._zlib = zlib.createDeflate();
  this._zlib.on('data', (this._numFrames > 1 ? this._writefdAT : this._writeIDAT).bind(this));
  done();
};

PNGEncoder.prototype._writePixels = function(data, done) {
  // ignore frames after the first unless animated option is set
  if (!this.format.animated && this._numFrames > 1)
    return done();
    
  // make sure we only call the callback once
  var scanlines = 0;
  function countdown() {
    if (--scanlines === 0)
      done();
  }
  
  var buf = this._buffer;
  buf.append(data);
  
  while (buf.length >= this._scanlineLength) {
    scanlines++;
    var scanline = buf.slice(0, this._scanlineLength);
    buf.consume(this._scanlineLength);
    
    var line = this._filter(scanline);
    this._zlib.write(line, countdown);
  }
};

PNGEncoder.prototype._endFrame = function(done) {
  // ignore frames after the first unless animated option is set
  if (!this.format.animated && this._numFrames > 1)
    return done();
  
  this._zlib.end();
  this._zlib.on('end', done);
};

PNGEncoder.prototype._end = function(done) {
  // if this is an animated image, write acTL chunk, and buffered output
  if (this.format.animated) {
    this._bufferOutput = false;
    this._writeacTL();
    for (var i = 0; i < this._output.length; i++)
      this.push(this._output[i]);
    
    this._output.length = 0; // free memory
  }
  
  this._writeChunk('IEND', new Buffer(0));    
  done();
}

// Write's a generic PNG chunk including header, data, and CRC
PNGEncoder.prototype._writeChunk = function(chunk, data) {
  var header = new Buffer(8);
  header.writeUInt32BE(data.length, 0);
  header.write(chunk, 4, 4, 'ascii');
  
  this.push(header);
  if (data.length)
    this.push(data);
    
  this.push(crc32(data, crc32(header.slice(4))));
};

PNGEncoder.prototype._writeIHDR = function() {
  var chunk = new Buffer(13);
  chunk.writeUInt32BE(this.format.width, 0);
  chunk.writeUInt32BE(this.format.height, 4);
  chunk[8] = 8; // bits
  chunk[9] = this.colorType;
  chunk[10] = 0; // compression
  chunk[11] = 0; // filter
  chunk[12] = 0; // interlace
  
  this._writeChunk('IHDR', chunk);
};

PNGEncoder.prototype._writePLTE = function() {
  var palette = this.format.palette;
  
  // check if the palette contains transparency
  // if so, we need to separate it out into the tRNS chunk
  if (palette.length % 4 === 0) {
    var plte = new Buffer(palette.length / 4 * 3);
    var trns = new Buffer(palette.length / 4);
    var p = 0, t = 0;
    
    for (var i = 0; i < palette.length;) {
      plte[p++] = palette[i++];
      plte[p++] = palette[i++];
      plte[p++] = palette[i++];
      trns[t++] = palette[i++];
    }
    
    palette = plte;
  }
  
  if (palette.length % 3 !== 0)
    return this.emit('error', new Error('Invalid palette length. Must be evenly divisible by 3.'))
  
  // write PLTE chunk
  this._writeChunk('PLTE', palette);
  
  // write tRNS chunk if needed
  if (trns)
    this._writeChunk('tRNS', trns);
};

// For animated PNGs, the acTL chunk is the animation header
PNGEncoder.prototype._writeacTL = function() {
  var buf = new Buffer(8);
    
  buf.writeUInt32BE(this._numFrames, 0);
  buf.writeUInt32BE(this.format.repeatCount === Infinity ? 0 : (this.format.repeatCount || 1), 4);
  
  this._writeChunk('acTL', buf);
};

// For animated PNGs, the fcTL chunk stores the header for a frame
PNGEncoder.prototype._writefcTL = function(frame) {
  var buf = new Buffer(26);
  
  buf.writeUInt32BE(this._sequence++, 0);
  buf.writeUInt32BE(frame.width || this.format.width, 4);
  buf.writeUInt32BE(frame.height || this.format.height, 8);
  buf.writeUInt32BE(frame.x || 0, 12);
  buf.writeUInt32BE(frame.y || 0, 16);
  buf.writeUInt16BE(frame.delay || 50, 20);
  buf.writeUInt16BE(1000, 22);
  buf[24] = 0;
  buf[25] = 0;
  
  this._writeChunk('fcTL', buf);
};

// Main image data
PNGEncoder.prototype._writeIDAT = function(data) {
  this._writeChunk('IDAT', data);
};

// Subsequent frame data for animated PNGs
PNGEncoder.prototype._writefdAT = function(data) {
  var buf = new Buffer(4 + data.length);
  
  buf.writeUInt32BE(this._sequence++, 0);
  data.copy(buf, 4);
  
  this._writeChunk('fdAT', buf);
};

// Chooses the best filter for a given scanline.
// Tries them all and chooses the one with the lowest sum.
PNGEncoder.prototype._filter = function(scanline) {
  var out = new Buffer(1 + scanline.length);
  var tmp = new Buffer(1 + scanline.length);
  var prev = this._prevScanline;
  var b = this._pixelBytes;
  var min = Infinity;
  
  var maxFilter = prev ? PNG_FILTER_PAETH : PNG_FILTER_SUB;
  for (var filter = PNG_FILTER_NONE; filter <= maxFilter; filter++) {
    tmp[0] = filter;
    
    // v8 deoptimizes switch statements with variables as cases, so we use constants here.
    switch (filter) {
      case 0: // PNG_FILTER_NONE
        for (var i = 0; i < scanline.length; i++)
          tmp[i + 1] = scanline[i];
          
        break;
      
      case 1: // PNG_FILTER_SUB
        for (var i = 0; i < scanline.length; i++)
          tmp[i + 1] = (scanline[i] - (i < b ? 0 : scanline[i - b])) & 0xff;
          
        break;
        
      case 2: // PNG_FILTER_UP
        for (var i = 0; i < scanline.length; i++)
          tmp[i + 1] = (scanline[i] - prev[i]) & 0xff;
          
        break;
        
      case 3: // PNG_FILTER_AVG
        for (var i = 0; i < scanline.length; i++)
          tmp[i + 1] = (scanline[i] - (((i < b ? 0 : scanline[i - b]) + prev[i]) >>> 1)) & 0xff;
          
        break;
        
      case 4: // PNG_FILTER_PAETH
        for (var i = 0; i < scanline.length; i++) {
          var cur = scanline[i];
          var left = i < b ? 0 : scanline[i - b];
          var upper = prev[i];
          var upperLeft = i < b ? 0 : prev[i - b];
          var p = upper - upperLeft;
          var pc = left - upperLeft;
          var pa = Math.abs(p);
          var pb = Math.abs(pc);
          var pc = Math.abs(p + pc);
    
          p = (pa <= pb && pa <= pc) ? left : (pb <= pc) ? upper : upperLeft;
          tmp[i + 1] = (cur - p) & 0xff;
        }
        
        break;
    }
    
    var sum = sumBuf(tmp);
    if (sum < min) {
      var t = out;
      out = tmp;
      tmp = t;
      min = sum;
    }
  }
    
  this._prevScanline = scanline;
  return out;
};

function sumBuf(buf) {
  var sum = 0;
  
  for (var i = 1; i < buf.length; i++) {
    var v = buf[i];
    sum += v < 128 ? v : 256 - v;
  }
  
  return sum;
}

module.exports = PNGEncoder;
