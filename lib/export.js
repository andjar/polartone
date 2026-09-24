// Offline, frame-exact video export.
//
// Instead of recording the screen in real time (which drops frames and is
// capped at screen resolution), this decodes the whole track, steps through it
// one video frame at a time, takes the same 1024-sample waveform window an
// AnalyserNode would report at that moment, draws the spiral onto a
// high-resolution canvas and encodes it with WebCodecs. The original audio is
// encoded alongside, and both are muxed into a single MP4.

const { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } = require('mp4-muxer')
const createSpiral = require('./spiral')

const WINDOW = 1024 // matches AnalyserNode default fftSize 2048 -> frequencyBinCount 1024
const REFERENCE_SIZE = 1080 // logical pixels on the shorter side; lines scale with resolution

exports.isSupported = function () {
  return typeof window.VideoEncoder === 'function' &&
    typeof window.VideoFrame === 'function'
}

// Pick the first codec configuration the browser can actually encode.
async function pickVideoConfig (width, height, fps, bitrate) {
  const base = { width, height, bitrate, framerate: fps, latencyMode: 'quality' }
  const candidates = [
    ['avc', 'avc1.640034'], // H.264 High, level 5.2 (4K60)
    ['avc', 'avc1.640033'], // level 5.1
    ['avc', 'avc1.64002a'], // level 4.2 (1080p60)
    ['avc', 'avc1.4d0034'], // Main profile
    ['vp9', 'vp09.00.51.08'],
    ['av1', 'av01.0.12M.08']
  ]
  for (const [muxCodec, codec] of candidates) {
    const config = Object.assign({ codec }, base)
    if (muxCodec === 'avc') config.avc = { format: 'avc' }
    try {
      const res = await window.VideoEncoder.isConfigSupported(config)
      if (res.supported) return { muxCodec, config }
    } catch (e) {}
  }
  return null
}

async function pickAudioConfig (sampleRate, numberOfChannels) {
  if (typeof window.AudioEncoder !== 'function') return null
  const candidates = [
    ['aac', { codec: 'mp4a.40.2', bitrate: 256000 }],
    ['opus', { codec: 'opus', bitrate: 192000 }]
  ]
  for (const [muxCodec, extra] of candidates) {
    const config = Object.assign({ sampleRate, numberOfChannels }, extra)
    try {
      const res = await window.AudioEncoder.isConfigSupported(config)
      if (res.supported) return { muxCodec, config }
    } catch (e) {}
  }
  return null
}

// Mix the buffer down to mono (like the analyser, which averages channels) once.
function toMono (buffer) {
  const n = buffer.numberOfChannels
  if (n === 1) return buffer.getChannelData(0)
  const out = new Float32Array(buffer.length)
  for (let c = 0; c < n; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i] += data[i] / n
  }
  return out
}

// Same conversion as AnalyserNode.getByteTimeDomainData.
function fillWaveform (mono, endSample, out) {
  const start = endSample - out.length
  for (let i = 0; i < out.length; i++) {
    const idx = start + i
    const x = idx >= 0 && idx < mono.length ? mono[idx] : 0
    const b = Math.floor(128 * (1 + x))
    out[i] = b < 0 ? 0 : b > 255 ? 255 : b
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function drain (encoder, max) {
  while (encoder.encodeQueueSize > max) await new Promise((resolve) => setTimeout(resolve, 2))
}

// Ask where to save *before* any slow work, while we still have the click's user activation.
exports.pickOutput = async function (suggestedName) {
  if (typeof window.showSaveFilePicker !== 'function') return null
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }]
  })
  return handle.createWritable()
}

/**
 * opts:
 *   audioBuffer  decoded AudioBuffer (required)
 *   preset       spiral options (capacity, distance, alpha, extent, position, seek)
 *   width/height output size in pixels
 *   fps          frames per second
 *   length       seconds to render (defaults to the rest of the track)
 *   canvas       optional canvas to draw into (useful as a live preview)
 *   writable     optional FileSystemWritableFileStream to stream the file to disk
 *   onProgress(fraction, info), isCancelled()
 * resolves to { blob } (in-memory) or { written: true } (streamed), or null if cancelled
 */
exports.render = async function (opts) {
  const { audioBuffer, width, height, fps } = opts
  const preset = opts.preset || {}
  const onProgress = opts.onProgress || function () {}
  const isCancelled = opts.isCancelled || (() => false)

  const sampleRate = audioBuffer.sampleRate
  const seek = Math.min(Math.max(preset.seek || 0, 0), audioBuffer.duration)
  const total = audioBuffer.duration - seek // spiral always spans the rest of the track
  const length = Math.min(opts.length || total, total)
  const frameCount = Math.max(1, Math.floor(length * fps))
  const bitrate = opts.bitrate || Math.round(Math.min(width * height * fps * 0.1, 80e6))

  const video = await pickVideoConfig(width, height, fps, bitrate)
  if (!video) throw new Error('This browser cannot encode video at ' + width + 'x' + height + '.')
  const channels = Math.min(audioBuffer.numberOfChannels, 2)
  const audio = await pickAudioConfig(sampleRate, channels)

  const target = opts.writable
    ? new FileSystemWritableFileStreamTarget(opts.writable)
    : new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: video.muxCodec, width, height, frameRate: fps },
    audio: audio ? { codec: audio.muxCodec, numberOfChannels: channels, sampleRate } : undefined,
    fastStart: opts.writable ? false : 'in-memory',
    firstTimestampBehavior: 'offset'
  })

  let encodeError = null
  const videoEncoder = new window.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e }
  })
  videoEncoder.configure(video.config)

  let audioEncoder = null
  if (audio) {
    audioEncoder = new window.AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { encodeError = e }
    })
    audioEncoder.configure(audio.config)
  }

  const canvas = opts.canvas || document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  const scale = Math.max(1, Math.min(width, height) / REFERENCE_SIZE)
  const spiral = createSpiral(context, preset)
  spiral.resize(width / scale, height / scale, scale)
  createSpiral.clear(context)

  const mono = toMono(audioBuffer)
  const waveform = new Uint8Array(WINDOW)
  const startSample = Math.floor(seek * sampleRate)
  const endSample = Math.min(audioBuffer.length, startSample + Math.round(length * sampleRate))

  // Audio goes in ahead of the video, in ~1 s blocks, so the muxer can interleave.
  const audioBlock = sampleRate
  let audioPos = startSample
  function encodeAudioUntil (sample) {
    if (!audioEncoder) return
    while (audioPos < Math.min(sample, endSample)) {
      const n = Math.min(audioBlock, endSample - audioPos)
      const data = new Float32Array(n * channels)
      for (let c = 0; c < channels; c++) {
        data.set(audioBuffer.getChannelData(c).subarray(audioPos, audioPos + n), c * n)
      }
      const audioData = new window.AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: n,
        numberOfChannels: channels,
        timestamp: Math.round((audioPos - startSample) / sampleRate * 1e6),
        data
      })
      audioEncoder.encode(audioData)
      audioData.close()
      audioPos += n
    }
  }

  const frameDuration = 1e6 / fps
  const keyInterval = Math.round(fps * 2)
  const started = performance.now()

  try {
    for (let f = 0; f < frameCount; f++) {
      if (encodeError) throw encodeError
      if (isCancelled()) {
        videoEncoder.close()
        if (audioEncoder) audioEncoder.close()
        if (opts.writable) await opts.writable.abort().catch(() => {})
        return null
      }

      const time = (f + 1) / fps // time the analyser would be at when this frame is drawn
      fillWaveform(mono, startSample + Math.floor(time * sampleRate), waveform)
      spiral.draw(waveform, time, time / total)

      encodeAudioUntil(startSample + Math.ceil((time + 1) * sampleRate))

      const frame = new window.VideoFrame(canvas, {
        timestamp: Math.round(f * frameDuration),
        duration: Math.round(frameDuration)
      })
      videoEncoder.encode(frame, { keyFrame: f % keyInterval === 0 })
      frame.close()

      await drain(videoEncoder, 6)
      if (f % 10 === 0) {
        const elapsed = (performance.now() - started) / 1000
        const fraction = (f + 1) / frameCount
        onProgress(fraction, {
          frame: f + 1,
          frameCount,
          eta: fraction > 0 ? elapsed / fraction - elapsed : 0,
          codec: video.config.codec,
          audioCodec: audio ? audio.config.codec : null
        })
        await tick() // keep the page responsive and let the preview repaint
      }
    }

    encodeAudioUntil(endSample)
    await videoEncoder.flush()
    if (audioEncoder) await audioEncoder.flush()
    if (encodeError) throw encodeError
    muxer.finalize()
  } finally {
    if (videoEncoder.state !== 'closed') videoEncoder.close()
    if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close()
  }

  onProgress(1, { frame: frameCount, frameCount, eta: 0 })
  if (opts.writable) {
    await opts.writable.close()
    return { written: true, hasAudio: !!audio }
  }
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), hasAudio: !!audio }
}
