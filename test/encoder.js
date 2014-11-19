var PNGDecoder = require('../decoder');
var PNGEncoder = require('../encoder');
var assert = require('assert');
var fs = require('fs');
var concat = require('concat-frames');
var PassThrough = require('stream').PassThrough;

describe('PNGEncoder', function() {
  it('encodes an RGB image', function(done) {
    var pixels = new Buffer(10 * 10 * 3);
    for (var i = 0; i < pixels.length; i += 3) {
      pixels[i] = 204;
      pixels[i + 1] = 0;
      pixels[i + 2] = 151;
    }
    
    var enc = new PNGEncoder(10, 10);
    
    enc.pipe(new PNGDecoder)
       .pipe(concat(function(frames) {
         assert.equal(frames.length, 1);
         assert.equal(frames[0].width, 10);
         assert.equal(frames[0].height, 10);
         assert.equal(frames[0].colorSpace, 'rgb');
         assert.deepEqual(frames[0].pixels.slice(0, 3), new Buffer([ 204, 0, 151 ]));
         done();
       }));
    
    enc.end(pixels);
  });
  
  it('encodes an RGBA image', function(done) {
    var pixels = new Buffer(10 * 10 * 4);
    for (var i = 0; i < pixels.length; i += 4) {
      pixels[i] = 0;
      pixels[i + 1] = 56;
      pixels[i + 2] = 128;
      pixels[i + 3] = 32;
    }
    
    var enc = new PNGEncoder(10, 10, { colorSpace: 'rgba' });
    
    enc.pipe(new PNGDecoder)
       .pipe(concat(function(frames) {
         assert.equal(frames.length, 1);
         assert.equal(frames[0].width, 10);
         assert.equal(frames[0].height, 10);
         assert.equal(frames[0].colorSpace, 'rgba');
         assert.deepEqual(frames[0].pixels.slice(0, 4), new Buffer([ 0, 56, 128, 32 ]));
         done();
       }));
    
    enc.end(pixels);
  });
  
  it('encodes a grayscale image', function(done) {
    var pixels = new Buffer(10 * 10);
    pixels.fill(128);
    
    var enc = new PNGEncoder(10, 10, { colorSpace: 'gray' });
    
    enc.pipe(new PNGDecoder)
       .pipe(concat(function(frames) {
         assert.equal(frames.length, 1);
         assert.equal(frames[0].width, 10);
         assert.equal(frames[0].height, 10);
         assert.equal(frames[0].colorSpace, 'gray');
         assert.equal(frames[0].pixels[0], 128);
         done();
       }));
    
    enc.end(pixels);
  });
  
  it('encodes a grayscale image with alpha', function(done) {
    var pixels = new Buffer(10 * 10 * 2);
    for (var i = 0; i < pixels.length; i += 4) {
      pixels[i] = 128;
      pixels[i + 1] = 32;
    }
    
    var enc = new PNGEncoder(10, 10, { colorSpace: 'graya' });
    
    enc.pipe(new PNGDecoder)
       .pipe(concat(function(frames) {
         assert.equal(frames.length, 1);
         assert.equal(frames[0].width, 10);
         assert.equal(frames[0].height, 10);
         assert.equal(frames[0].colorSpace, 'graya');
         assert.deepEqual(frames[0].pixels.slice(0, 2), new Buffer([ 128, 32 ]));
         done();
       }));
    
    enc.end(pixels);
  });
  
  it('encodes an indexed image', function(done) {
    var palette = new Buffer([ 204, 0, 153 ]);
    var pixels = new Buffer(10 * 10);
    pixels.fill(0);
    
    var enc = new PNGEncoder(10, 10, { colorSpace: 'indexed', palette: palette });
    
    enc.pipe(new PNGDecoder)
       .pipe(concat(function(frames) {
         assert.equal(frames.length, 1);
         assert.equal(frames[0].width, 10);
         assert.equal(frames[0].height, 10);
         assert.equal(frames[0].colorSpace, 'rgb');
         assert.equal(frames[0].pixels.length, 10 * 10 * 3);
         assert.deepEqual(frames[0].pixels.slice(0, 3), new Buffer([ 204, 0, 153 ]));
         done();
       }));
    
    enc.end(pixels);
  });
  
  it('encodes an indexed image with alpha', function(done) {
    var palette = new Buffer([ 204, 0, 153, 128 ]);
    var pixels = new Buffer(10 * 10);
    pixels.fill(0);
    
    var enc = new PNGEncoder(10, 10, { colorSpace: 'indexed', palette: palette });
    
    enc.pipe(new PNGDecoder)
       .pipe(concat(function(frames) {
         assert.equal(frames.length, 1);
         assert.equal(frames[0].width, 10);
         assert.equal(frames[0].height, 10);
         assert.equal(frames[0].colorSpace, 'rgba');
         assert.equal(frames[0].pixels.length, 10 * 10 * 4);
         assert.deepEqual(frames[0].pixels.slice(0, 4), new Buffer([ 204, 0, 153, 128 ]));
         done();
       }));
    
    enc.end(pixels);
  });
  
  it('errors with invalid palette size', function(done) {
    var palette = new Buffer([ 204, 0, 153, 1, 3 ]);
    var pixels = new Buffer(10 * 10);
    pixels.fill(0);
    
    var enc = new PNGEncoder(10, 10, { colorSpace: 'indexed', palette: palette });
    
    enc.on('error', function(err) {
      assert(err instanceof Error);
      assert(/Invalid palette length/.test(err.message));
      done();
    });
    
    enc.end(pixels);
  });
  
  it('errors with missing palette', function(done) {
    var enc = new PNGEncoder(10, 10, { colorSpace: 'indexed' });
    
    enc.on('error', function(err) {
      assert(err instanceof Error);
      assert(/Requested indexed color space without palette/.test(err.message));
      done();
    });
    
    var pixels = new Buffer(10 * 10);
    pixels.fill(0);
    enc.end(pixels);
  });
  
  it('encodes an animated image', function(done) {
    var frame1 = new Buffer(10 * 10 * 3);
    for (var i = 0; i < frame1.length; i += 3) {
      frame1[i] = 204;
      frame1[i + 1] = 0;
      frame1[i + 2] = 151;
    }
    
    var frame2 = new Buffer(10 * 10 * 3)
    for (var i = 0; i < frame2.length; i += 3) {
      frame2[i] = 22;
      frame2[i + 1] = 204;
      frame2[i + 2] = 13;
    }
    
    var enc = new PNGEncoder(10, 10, { animated: true });
    
    enc.pipe(new PNGDecoder)
       .pipe(concat(function(frames) {
         assert.equal(frames.length, 2);
         assert.equal(frames[0].width, 10);
         assert.equal(frames[0].height, 10);
         assert.equal(frames[0].colorSpace, 'rgb');
         assert.equal(frames[0].delay, 50);
         assert.deepEqual(frames[0].pixels.slice(0, 3), new Buffer([ 204, 0, 151 ]));
         assert.equal(frames[1].width, 10);
         assert.equal(frames[1].height, 10);
         assert.equal(frames[1].colorSpace, 'rgb');
         assert.equal(frames[1].delay, 50);
         assert.deepEqual(frames[1].pixels.slice(0, 3), new Buffer([ 22, 204, 13 ]));
         
         done();
       }));
    
    enc.write(frame1);
    enc.end(frame2);
  });
  
  it('supports infinite repeat count', function(done) {
    var frame1 = new Buffer(10 * 10 * 3);
    for (var i = 0; i < frame1.length; i += 3) {
      frame1[i] = 204;
      frame1[i + 1] = 0;
      frame1[i + 2] = 151;
    }
    
    var frame2 = new Buffer(10 * 10 * 3)
    for (var i = 0; i < frame2.length; i += 3) {
      frame2[i] = 22;
      frame2[i + 1] = 204;
      frame2[i + 2] = 13;
    }
    
    var enc = new PNGEncoder(10, 10, { animated: true, repeatCount: Infinity });
    var dec = new PNGDecoder;
    
    enc.pipe(dec)
       .pipe(concat(function(frames) {
         assert.equal(frames.length, 2);
         assert.equal(frames[0].width, 10);
         assert.equal(frames[0].height, 10);
         assert.equal(frames[0].colorSpace, 'rgb');
         assert.equal(frames[0].delay, 50);
         assert.deepEqual(frames[0].pixels.slice(0, 3), new Buffer([ 204, 0, 151 ]));
         assert.equal(frames[1].width, 10);
         assert.equal(frames[1].height, 10);
         assert.equal(frames[1].colorSpace, 'rgb');
         assert.equal(frames[1].delay, 50);
         assert.deepEqual(frames[1].pixels.slice(0, 3), new Buffer([ 22, 204, 13 ]));
         assert.equal(dec.format.repeatCount, Infinity);
         done();
       }));
    
    enc.write(frame1);
    enc.end(frame2);
  });
  
  it('uses frame object for delays', function(done) {
    var frame1 = new Buffer(10 * 10 * 3);
    for (var i = 0; i < frame1.length; i += 3) {
      frame1[i] = 204;
      frame1[i + 1] = 0;
      frame1[i + 2] = 151;
    }
    
    var frame2 = new Buffer(10 * 10 * 3)
    for (var i = 0; i < frame2.length; i += 3) {
      frame2[i] = 22;
      frame2[i + 1] = 204;
      frame2[i + 2] = 13;
    }
    
    var enc = new PNGEncoder(10, 10, { animated: true });
    
    enc.pipe(new PNGDecoder)
       .pipe(concat(function(frames) {
         assert.equal(frames.length, 2);
         assert.equal(frames[0].width, 10);
         assert.equal(frames[0].height, 10);
         assert.equal(frames[0].colorSpace, 'rgb');
         assert.equal(frames[0].delay, 100);
         assert.deepEqual(frames[0].pixels.slice(0, 3), new Buffer([ 204, 0, 151 ]));
         assert.equal(frames[1].width, 10);
         assert.equal(frames[1].height, 10);
         assert.equal(frames[1].colorSpace, 'rgb');
         assert.equal(frames[1].delay, 50);
         assert.deepEqual(frames[1].pixels.slice(0, 3), new Buffer([ 22, 204, 13 ]));
         
         done();
       }));
    
    enc.addFrame({ delay: 100 });
    enc.write(frame1);
    enc.addFrame({ delay: 50 });
    enc.end(frame2);
  });
  
  it('encodes an indexed animated image', function(done) {
    var palette = new Buffer([ 204, 0, 151, 22, 204, 13 ]);
    var frame1 = new Buffer(10 * 10);
    var frame2 = new Buffer(10 * 10);
    frame1.fill(0);
    frame2.fill(1);
    
    var enc = new PNGEncoder(10, 10, { animated: true, colorSpace: 'indexed', palette: palette });
    
    enc.pipe(new PNGDecoder)
       .pipe(concat(function(frames) {
         assert.equal(frames.length, 2);
         assert.equal(frames[0].width, 10);
         assert.equal(frames[0].height, 10);
         assert.equal(frames[0].colorSpace, 'rgb');
         assert.equal(frames[0].delay, 50);
         assert.deepEqual(frames[0].pixels.slice(0, 3), new Buffer([ 204, 0, 151 ]));
         assert.equal(frames[1].width, 10);
         assert.equal(frames[1].height, 10);
         assert.equal(frames[1].colorSpace, 'rgb');
         assert.equal(frames[1].delay, 50);
         assert.deepEqual(frames[1].pixels.slice(0, 3), new Buffer([ 22, 204, 13 ]));
         
         done();
       }));
    
    enc.write(frame1);
    enc.end(frame2);
  });
  
  it('writes only the first frame unless animated option is set', function(done) {
    var frame1 = new Buffer(10 * 10 * 3);
    for (var i = 0; i < frame1.length; i += 3) {
      frame1[i] = 204;
      frame1[i + 1] = 0;
      frame1[i + 2] = 151;
    }
    
    var frame2 = new Buffer(10 * 10 * 3)
    for (var i = 0; i < frame2.length; i += 3) {
      frame2[i] = 22;
      frame2[i + 1] = 204;
      frame2[i + 2] = 13;
    }
    
    var enc = new PNGEncoder(10, 10);
    
    enc.pipe(new PNGDecoder)
       .pipe(concat(function(frames) {
         assert.equal(frames.length, 1);
         assert.equal(frames[0].width, 10);
         assert.equal(frames[0].height, 10);
         assert.equal(frames[0].colorSpace, 'rgb');         
         done();
       }));
    
    enc.write(frame1);
    enc.end(frame2);
  });
});
