# png-stream

A streaming PNG encoder and decoder for Node and the browser.
Supports [animated PNGs](https://wiki.mozilla.org/APNG_Specification) and
normal still PNGs.

## Installation

    npm png-stream

For the browser, you can build using [Browserify](http://browserify.org/).

## Decoding

This example uses the [concat-frames](https://github.com/devongovett/concat-frames)
module to collect the output of the PNG decoder into an array of frame objects.

```javascript
var PNGDecoder = require('png-stream/decoder');
var concat = require('concat-frames');

// decode a PNG file to RGB pixels
fs.createReadStream('in.png')
  .pipe(new PNGDecoder)
  .pipe(concat(function(frames) {
    // frames is an array of frame objects
    // each one has a `pixels` property containing
    // the raw RGB pixel data for that frame, as
    // well as the width, height, etc.
  }));
```

## Encoding

You can encode a PNG by writing or piping pixel data to a `PNGEncoder` stream.
The PNG encoder supports writing data in the RGB, RGBA, grayscale (`gray`), 
and grayscale + alpha (`gray`) color spaces.  You can also write data in the
`indexed` color space by first quantizing it using the [neuquant](https://github.com/devongovett/neuquant)
module.

```javascript
var PNGEncoder = require('png-stream/encoder');
var neuquant = require('neuquant');

// convert a JPEG to a PNG
fs.createReadStream('in.jpg')
  .pipe(new JPEGDecoder)
  .pipe(new PNGEncoder)
  .pipe(fs.createWriteStream('out.png'));
  
// write indexed data
fs.createReadStream('in.jpg')
  .pipe(new JPEGDecoder)
  .pipe(new neuquant.Stream)
  .pipe(new PNGEncoder)
  .pipe(fs.createWriteStream('indexed.png'));
```

## License

MIT
