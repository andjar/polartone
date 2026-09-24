# polartone 

###### <sup>formerly *spins*</sup>

Audio visualizer, rendering waveforms in polar coordinates. Uses WebAudio and Canvas2D. Electron and [hihat](https://github.com/Jam3/hihat) is used to generate high-resolution prints, see below.

## Online Demo

http://mattdesl.github.io/polartone/

Drop an audio file on the page (or pick one), or use your microphone. The original demo streamed tracks from SoundCloud, but SoundCloud's public API has since been shut down, so the visualizer now takes local files, live mic input, or a direct audio URL.

Keys: <kbd>space</kbd> pause/resume, <kbd>esc</kbd> menu and video export, <kbd>s</kbd> save the canvas as PNG.

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

## Video Export

After loading an audio file, press <kbd>esc</kbd> to open the menu and use **Export video**. The track is rendered offline, frame by frame, at up to 4K (or 4096×4096 square), and saved as an MP4 with the original audio.

- Every frame gets the exact waveform window the live analyser would see, so nothing is dropped and the look matches the on-screen version. Line widths scale with resolution.
- Uses the current preset and query parameters (`?preset=…&alpha=…&seek=…`), and runs from `seek` to the end of the track.
- Encodes with [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) in recent Chrome, Edge or Safari. It prefers H.264 + AAC and falls back to VP9/AV1 video or Opus audio if the browser lacks those encoders.
- In Chrome and Edge the file streams straight to disk (you pick the location first), so long 4K renders don't have to fit in memory.
- Expect roughly 1–3× the track length for 4K60, depending on the machine.

## High-Resolution Prints

To generate high-resolution prints, [hihat](https://github.com/Jam3/hihat) (Electron + Browserify + Node) is used to write the `<canvas>` element to disk.

## License

MIT, see [LICENSE.md](http://github.com/mattdesl/polartone/blob/master/LICENSE.md) for details.
