# polartone 

###### <sup>formerly *spins*</sup>

Audio visualizer, rendering waveforms in polar coordinates. Uses WebAudio and Canvas2D. Electron and [hihat](https://github.com/Jam3/hihat) is used to generate high-resolution prints, see below.

## Online Demo

http://mattdesl.github.io/polartone/

Drop an audio file on the page (or pick one), or use your microphone. The original demo streamed tracks from SoundCloud, but SoundCloud's public API has since been shut down, so the visualizer now takes local files, live mic input, or a direct audio URL.

Keys: <kbd>space</kbd> pause/resume, <kbd>esc</kbd> menu, <kbd>s</kbd> save the canvas as PNG.

Query parameters tweak the look, e.g. `?preset=1&alpha=0.1&extent=0.5&position=0,-3.5,0`. A direct, CORS-enabled audio link can be passed as `?url=https://example.com/song.mp3`.

## Screenshots

<img src="http://i.imgur.com/ErtIEYn.png" width="49%" />
<img src="http://i.imgur.com/XY4MQnH.png" width="49%" />

## Running from Source

To run the web demo from source:

```sh
git clone https://github.com/mattdesl/polartone.git
cd polartone
npm install

# start localhost:9966 with rebuild on change
npm start

# or produce a minified bundle.js
npm run build
```

Requires Node 18+. Bundled with [esbuild](https://esbuild.github.io/).

## High-Resolution Prints

To generate high-resolution prints, [hihat](https://github.com/Jam3/hihat) (Electron + Browserify + Node) is used to write the `<canvas>` element to disk.

## License

MIT, see [LICENSE.md](http://github.com/mattdesl/polartone/blob/master/LICENSE.md) for details.
