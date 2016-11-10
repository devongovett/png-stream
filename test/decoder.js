var PNGDecoder = require('../decoder');
var assert = require('assert');
var fs = require('fs');
var concat = require('concat-frames');

describe('PNGDecoder', function() {
  it('can probe to see if a file is a png', function() {
    var file = fs.readFileSync(__dirname + '/images/trees.png');
    assert(PNGDecoder.probe(file));
    assert(!PNGDecoder.probe(new Buffer(100)));
  });

  it('decodes an RGB image', function(done) {
    fs.createReadStream(__dirname + '/images/trees.png')
      .pipe(new PNGDecoder)
      .pipe(concat(function(frames) {
        assert.equal(frames.length, 1);
        assert.equal(frames[0].width, 400);
        assert.equal(frames[0].height, 533);
        assert.equal(frames[0].colorSpace, 'rgb');
        assert(Buffer.isBuffer(frames[0].pixels));
        assert.equal(frames[0].pixels.length, 400 * 533 * 3);
        done();
      }));
  });

  it('decodes an RGBA image', function(done) {
    fs.createReadStream(__dirname + '/images/djay.png')
      .pipe(new PNGDecoder)
      .pipe(concat(function(frames) {
        assert.equal(frames.length, 1);
        assert.equal(frames[0].width, 512);
        assert.equal(frames[0].height, 512);
        assert.equal(frames[0].colorSpace, 'rgba');
        assert(Buffer.isBuffer(frames[0].pixels));
        assert.equal(frames[0].pixels.length, 512 * 512 * 4);
        done();
      }));
  });

  it('decodes an indexed RGBA image', function(done) {
    fs.createReadStream(__dirname + '/images/djay-indexed.png')
      .pipe(new PNGDecoder)
      .pipe(concat(function(frames) {
        assert.equal(frames.length, 1);
        assert.equal(frames[0].width, 512);
        assert.equal(frames[0].height, 512);
        assert.equal(frames[0].colorSpace, 'rgba');
        assert(Buffer.isBuffer(frames[0].pixels));
        assert.equal(frames[0].pixels.length, 512 * 512 * 4);
        done();
      }));
  });

  it('decodes an indexed RGBA image and returns raw data given `indexed` option', function(done) {
    fs.createReadStream(__dirname + '/images/djay-indexed.png')
      .pipe(new PNGDecoder({ indexed: true }))
      .pipe(concat(function(frames) {
        assert.equal(frames.length, 1);
        assert.equal(frames[0].width, 512);
        assert.equal(frames[0].height, 512);
        assert.equal(frames[0].colorSpace, 'indexed');
        assert(Buffer.isBuffer(frames[0].palette));
        assert(Buffer.isBuffer(frames[0].pixels));
        assert.equal(frames[0].pixels.length, 512 * 512);
        done();
      }));
  });

  it('decodes a grayscale image', function(done) {
    fs.createReadStream(__dirname + '/images/gray.png')
      .pipe(new PNGDecoder)
      .pipe(concat(function(frames) {
        assert.equal(frames.length, 1);
        assert.equal(frames[0].width, 400);
        assert.equal(frames[0].height, 533);
        assert.equal(frames[0].colorSpace, 'gray');
        assert(Buffer.isBuffer(frames[0].pixels));
        assert.equal(frames[0].pixels.length, 400 * 533);
        done();
      }));
  });

  it('decodes a grayscale image with alpha', function(done) {
    fs.createReadStream(__dirname + '/images/graya.png')
      .pipe(new PNGDecoder)
      .pipe(concat(function(frames) {
        assert.equal(frames.length, 1);
        assert.equal(frames[0].width, 512);
        assert.equal(frames[0].height, 512);
        assert.equal(frames[0].colorSpace, 'graya');
        assert(Buffer.isBuffer(frames[0].pixels));
        assert.equal(frames[0].pixels.length, 512 * 512 * 2);
        done();
      }));
  });

  it('decodes an animated image', function(done) {
    fs.createReadStream(__dirname + '/images/chompy.png')
      .pipe(new PNGDecoder)
      .pipe(concat(function(frames) {
        assert.equal(frames.length, 21);
        for (var i = 0; i < frames.length; i++) {
          assert.equal(frames[i].width, 166);
          assert.equal(frames[i].height, 120);
          assert.equal(frames[i].colorSpace, 'rgba');
          assert(Buffer.isBuffer(frames[i].pixels));
          assert.equal(frames[i].pixels.length, 166 * 120 * 4);
          assert.equal(frames[i].delay, i === 20 ? 100 : 40);
        }
        done();
      }));
  });

  it('errors on invalid filter algorithm', function(done) {
    var called = false;
    fs.createReadStream(__dirname + '/images/broken.png')
      .pipe(new PNGDecoder)
      .on('error', function(err) {
        assert(err instanceof Error);
        assert(/Invalid filter algorithm/.test(err.message));
        if (!called) done();
        called = true;
      });
  });

  it('handles paeth filter on the first scanline', function(done) {
    fs.createReadStream(__dirname + '/images/image001.png')
      .pipe(new PNGDecoder)
      .pipe(concat(function(frames) {
        assert.equal(frames.length, 1);
        assert.equal(frames[0].width, 366);
        assert.equal(frames[0].height, 479);
        assert.equal(frames[0].colorSpace, 'rgba');
        assert(Buffer.isBuffer(frames[0].pixels));
        assert.equal(frames[0].pixels.length, 366 * 479 * 4);
        done();
      }));
  });
});
