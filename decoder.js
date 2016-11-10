var util = require('util');
var Transform = require('stream').Transform;
var BufferList = require('bl');
var bufferEqual = require('buffer-equal');
var zlib = require('zlib');

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

// decoder states
var PNG_SIGNATURE = 0;
var PNG_HEADER = 1;
var PNG_CHUNK = 2;
var PNG_CRC = 3;

var SIGNATURE = new Buffer([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]);

function PNGDecoder(options) {
  Transform.call(this);

  this._outputIndexed = (options && options.indexed) || false;
  this._decodeRaw = false;
  this._state = PNG_SIGNATURE;
  this._chunk = null;
  this._chunkSize = 0;
  this._consumed = 0;
  this._sawIDAT = false;
  this._buffer = new BufferList();
  this.meta = {};

  this.format = {
    animated: false,
    numFrames: 1,
    repeatCount: 0
  };
}

util.inherits(PNGDecoder, Transform);

PNGDecoder.probe = function(buf) {
  return bufferEqual(buf.slice(0, 8), SIGNATURE);
};

PNGDecoder.prototype._transform = function(data, encoding, done) {
  var oldLength = Infinity;
  var self = this;

  // process the state machine, possibly asynchronously
  function next() {
    while (self._buffer.length < oldLength) {
      oldLength = self._buffer.length;

      switch (self._state) {
        case PNG_SIGNATURE:
          self._readSignature();
          break;

        case PNG_HEADER:
          self._readChunkHeader();
          break;

        case PNG_CHUNK:
          self._readChunk(next);
          return;

        case PNG_CRC:
          self._readCRC();
          break;
      }
    }

    done();
  }

  this._buffer.append(data);
  next();
};

PNGDecoder.prototype._readSignature = function() {
  if (this._buffer.length < 8)
    return;

  var sig = this._buffer.slice(0, 8);
  if (!bufferEqual(sig, SIGNATURE))
    return this.emit('error', new Error('Invalid PNG signature'));

  this._buffer.consume(8);
  this._state = PNG_HEADER;
};

PNGDecoder.prototype._readChunkHeader = function() {
  var data = this._buffer;
  if (data.length < 8)
    return;

  this._chunkSize = data.readUInt32BE(0);
  this._chunk = data.toString('ascii', 4, 8);
  this._consumed = 0;
  this._state = PNG_CHUNK;

  data.consume(8);
};

PNGDecoder.prototype._readChunk = function(done) {
  var consumed = 0;
  var handler = this['_read' + this._chunk];

  // make sure the callback is called at the end of this function
  var after = false;
  var called = false;
  function next() {
    if (after)
      done();
    else
      called = true;
  }

  // call the chunk handler
  if (handler) {
    consumed = handler.call(this, this._buffer, next);
  } else {
    consumed = Math.min(this._buffer.length, this._chunkSize - this._consumed);
    next();
  }

  // consume data read by the chunk handler
  this._buffer.consume(consumed);
  this._consumed += consumed;

  if (this._consumed > this._chunkSize)
    return this.emit('error', new Error('Bad chunk size.'));

  // done with this chunk if we've reached the chunk size
  if (this._consumed === this._chunkSize) {
    this._chunk = null;
    this._chunkSize = 0;
    this._consumed = 0;
    this._state = PNG_CRC;
  }

  // call the callback if next was already called
  after = true;
  if (called)
    done();
};

PNGDecoder.prototype._readCRC = function() {
  if (this._buffer.length < 4)
    return;

  this._buffer.consume(4);
  this._state = PNG_HEADER;
};

// Reads the image header chunk
PNGDecoder.prototype._readIHDR = function(data, done) {
  if (data.length < 13) {
    done();
    return 0;
  }

  this.format.width = data.readUInt32BE(0);
  this.format.height = data.readUInt32BE(4);

  this.bits = data.get(8);
  this.colorType = data.get(9);
  this.compressionMethod = data.get(10);
  this.filterMethod = data.get(11);
  this.interlaceMethod = data.get(12);

  switch (this.colorType) {
    case PNG_COLOR_TYPE_INDEXED:
      this.colors = 1;
      this.format.colorSpace = this._outputIndexed ? 'indexed' : 'rgb';
      break;

    case PNG_COLOR_TYPE_GRAY:
      this.colors = 1;
      this.format.colorSpace = 'gray';
      break;

    case PNG_COLOR_TYPE_GRAYA:
      this.colors = 2;
      this.format.colorSpace = 'graya';
      break;

    case PNG_COLOR_TYPE_RGB:
      this.colors = 3;
      this.format.colorSpace = 'rgb';
      break;

    case PNG_COLOR_TYPE_RGBA:
      this.colors = 4;
      this.format.colorSpace = 'rgba';
      break;

    default:
      return this.emit('error', new Error('Invalid color type: ' + this.colorType));
  }

  this.pixelBits = this.bits * this.colors;
  this.pixelBytes = this.pixelBits >= 8 ? this.pixelBits >> 3 : (this.pixelBits + 7) >> 3;
  this._initFrame();

  done();

  // we wait to emit the 'format' event, since the color space might change after a tRNS chunk
  return 13;
};

// Initializes state for a frame
PNGDecoder.prototype._initFrame = function() {
  this._zlib = zlib.createInflate();
  this._zlib.on('data', this._decodePixels.bind(this));
  this._pixelOffset = 0;
  this._pixelType = -1;

  this.scanlineLength = this.pixelBytes * this.format.width;
  this._previousScanline = null;
  this._scanline = new Buffer(this.scanlineLength);
};

// Reads the image palette chunk
PNGDecoder.prototype._readPLTE = function(data, done) {
  if (data.length < this._chunkSize) {
    done();
    return 0;
  }

  this._palette = data.slice(0, this._chunkSize);
  if (this._outputIndexed)
    this.format.palette = this._palette;

  done();
  return this._chunkSize;
};

// Reads the transparency chunk
PNGDecoder.prototype._readtRNS = function(data, done) {
  if (data.length < this._chunkSize) {
    done();
    return 0;
  }

  if (this.colorType === PNG_COLOR_TYPE_INDEXED) {
    this._transparencyIndex = data.slice(0, this._chunkSize);
    if (this._outputIndexed) {
      this.format.alphaPalette = this._transparencyIndex;
    } else {
      this.format.colorSpace = 'rgba';
    }
  }

  done();
  return this._chunkSize;
};

// Reads metadata from the tEXt chunk
PNGDecoder.prototype._readtEXt = function(data, done) {
  if (data.length < this._chunkSize) {
    done();
    return 0;
  }

  var buf = data.slice(0, this._chunkSize);
  var index = -1;
  for (var i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      index = i;
      break;
    }
  }

  if (index >= 0) {
    var key = buf.toString('ascii', 0, index);
    var value = buf.toString('ascii', index + 1);
    this.meta[key] = value;
  }

  done();
  return this._chunkSize;
};

// Reads the animation header chunk
PNGDecoder.prototype._readacTL = function(data, done) {
  if (data.length < this._chunkSize) {
    done();
    return 0;
  }

  this.format.animated = true;
  this.format.numFrames = data.readUInt32BE(0);
  this.format.repeatCount = data.readUInt32BE(4) || Infinity;

  done();
  return this._chunkSize;
};

// Reads the animation frame header chunk
PNGDecoder.prototype._readfcTL = function(data, done) {
  if (data.length < this._chunkSize) {
    done();
    return 0;
  }

  var frame = {};

  frame.width = data.readUInt32BE(4);
  frame.height = data.readUInt32BE(8);
  frame.x = data.readUInt32BE(12);
  frame.y = data.readUInt32BE(16);

  var delayNum = data.readUInt16BE(20);
  var delayDen = data.readUInt16BE(22) || 100;
  frame.delay = delayNum / delayDen * 1000;

  frame.disposeOp = data.get(24);
  frame.blendOp = data.get(25);

  this.emit('frame', frame);

  // If we already saw an IDAT chunk, end the current frame and start a new one
  if (this._sawIDAT) {
    this._zlib.end();
    this._zlib.once('end', function() {
      this._initFrame();
      done();
    }.bind(this));
  } else {
    done();
  }

  return this._chunkSize;
};

// Reads the image data chunk
PNGDecoder.prototype._readIDAT = function(data, done) {
  if (!this._sawIDAT) {
    this.emit('format', this.format);
    this.emit('meta', this.meta);
    this._sawIDAT = true;
  }

  var buf = data.slice(0, this._chunkSize - this._consumed);
  if (buf.length) {
    if (this._decodeRaw) {
      this.push(buf);
      done();
    } else {
      this._zlib.write(buf, done);
    }
  } else {
    done();
  }

  return buf.length;
};

// Reads frame data chunk
PNGDecoder.prototype._readfdAT = function(data, done) {
  if (this._consumed === 0) {
    if (data.length < 4) {
      done();
      return 0;
    }

    // consume sequence number
    this._consumed = 4;
    data.consume(4);
  }

  return this._readIDAT(data, done);
};

// Unfilters the given pixel data
PNGDecoder.prototype._decodePixels = function(data) {
  var prev = this._previousScanline;
  var scanline = this._scanline;
  var off = this._pixelOffset;
  var pos = 0;
  var len = this.scanlineLength;
  var b = this.pixelBytes;

  while (pos < data.length) {
    if (this._pixelType === -1) {
      this._pixelType = data[pos++];
      if (pos >= data.length)
        return;
    }

    // v8 deoptimizes switch statements with variables as cases, so we use constants here.
    switch (this._pixelType) {
      case 0: // PNG_FILTER_NONE
        for (; off < len && pos < data.length; off++)
          scanline[off] = data[pos++];

        break;

      case 1: // PNG_FILTER_SUB
        for (; off < len && pos < data.length; off++)
          scanline[off] = ((off < b ? 0 : scanline[off - b]) + data[pos++]) & 0xff;

        break;

      case 2: // PNG_FILTER_UP
        for (; off < len && pos < data.length; off++)
          scanline[off] = ((prev ? prev[off] : 0) + data[pos++]) & 0xff;

        break;

      case 3: //PNG_FILTER_AVG
        for (; off < len && pos < data.length; off++)
          scanline[off] = ((((off < b ? 0 : scanline[off - b]) + (prev ? prev[off] : 0)) >>> 1) + data[pos++]) & 0xff;

        break;

      case 4: // PNG_FILTER_PAETH
        for (; off < len && pos < data.length; off++) {
          var left = off < b ? 0 : scanline[off - b];
          var upper = prev ? prev[off] : 0;
          var upperLeft = off < b || !prev ? 0 : prev[off - b];
          var p = upper - upperLeft;
          var pc = left - upperLeft;
          var pa = Math.abs(p);
          var pb = Math.abs(pc);
          pc = Math.abs(pc + p);

          if (pb < pa) {
            pa = pb;
            left = upper;
          }

          if (pc < pa)
            left = upperLeft;

          scanline[off] = (data[pos++] + left) & 0xff;
        }

        break;

      default:
        return this.emit('error', new Error('Invalid filter algorithm: ' + this._pixelType));
    }


    if (off === len) {
      if (this.colorType === PNG_COLOR_TYPE_INDEXED && !this._outputIndexed)
        this.push(this._convertIndexedScanline(scanline));
      else
        this.push(scanline);

      this._previousScanline = prev = scanline;
      this._scanline = scanline = new Buffer(this.scanlineLength);
      this._pixelOffset = off = 0;
      this._pixelType = -1;
    }
  }

  this._pixelOffset = off;
};

// Converts an indexed scanline back to RGB(A)
PNGDecoder.prototype._convertIndexedScanline = function(scanline) {
  var palette = this._palette;
  if (!palette)
    return this.emit('error', new Error('Missing palette'));

  var alpha = this._transparencyIndex;
  var buf = new Buffer(scanline.length * (alpha ? 4 : 3));
  var p = 0;

  for (var i = 0; i < scanline.length; i++) {
    var v = scanline[i];
    var j = v * 3;
    buf[p++] = palette[j];
    buf[p++] = palette[j + 1];
    buf[p++] = palette[j + 2];
    if (alpha)
      buf[p++] = alpha[v];
  }

  return buf;
};

// Ends the last frame
PNGDecoder.prototype._flush = function(done) {
  this._zlib.end();
  this._zlib.once('end', done);
};

module.exports = PNGDecoder;
