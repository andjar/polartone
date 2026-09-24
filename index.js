const Analyser = require('web-audio-analyser')
const createLoop = require('raf-loop')
const getContext = require('get-canvas-context')
const once = require('once')
const defined = require('defined')
const fit = require('canvas-fit')
const presets = require('./presets')
const createUI = require('./lib/ui')
const createSpiral = require('./lib/spiral')
const videoExport = require('./lib/export')

const FEATURES = ['distance', 'capacity', 'alpha', 'seek', 'extent', 'duration']
const LIVE_DURATION = 180 // seconds for one full spiral when using the microphone

const AudioContext = window.AudioContext || window.webkitAudioContext
const context = getContext('2d')
const canvas = context.canvas
document.body.appendChild(canvas)
document.body.style.margin = '0'
document.body.style.overflow = 'hidden'
document.body.style.background = '#fff'

const dpr = window.devicePixelRatio || 1
const resize = fit(canvas, window, dpr)
const loop = createLoop()
const query = new URLSearchParams(window.location.search)

let audioContext = null
let current = null // { audio?, stream?, node, opt }

const ui = createUI({
  onFile: (file) => play({ file }),
  onUrl: () => play({ url: query.get('url') }),
  onMic: () => play({ mic: true }),
  onExport: exportVideo,
  onCancelExport: () => {
    if (exporting) { exporting.cancelled = true; ui.cancelling() }
  }
})
let exporting = null

if (!AudioContext) {
  ui.show('Sorry, your browser does not support the Web Audio API.', true)
} else {
  ui.setUrl(query.get('url'))
  ui.show()
  window.load = (opt) => play(typeof opt === 'string' ? { url: opt } : opt || {})
  printOptions()
}

window.addEventListener('resize', () => {
  resize()
  clear()
  if (current) current.reset()
})

window.addEventListener('keydown', (ev) => {
  if (ev.target && /INPUT|SELECT/.test(ev.target.tagName)) return
  if (ui.busy) return
  if (ev.key === 'Escape') {
    ui.show('Drop an audio file anywhere, or choose a source.')
  } else if (ev.key === ' ' && current) {
    ev.preventDefault()
    togglePause()
  } else if (ev.key === 's' || ev.key === 'S') {
    savePNG()
  }
})

function getAudioContext () {
  if (!audioContext) audioContext = new AudioContext()
  // contexts start "suspended" until a user gesture; resume is a no-op otherwise
  if (audioContext.state === 'suspended') audioContext.resume()
  return audioContext
}

function getOptions (base) {
  let opt = base.preset
  if (!opt) {
    const idx = query.has('preset')
      ? (parseInt(query.get('preset'), 10) | 0)
      : Math.floor(Math.random() * presets.length)
    opt = presets[Math.abs(idx) % presets.length]
  }
  opt = Object.assign({}, opt, base)

  // query parameters take precedence
  FEATURES.forEach((key) => {
    if (query.has(key)) {
      const v = parseFloat(query.get(key))
      if (isFinite(v)) opt[key] = v
    }
  })
  if (query.has('position')) {
    const pos = query.get('position').split(',').map((n) => parseFloat(n) || 0)
    if (pos.length === 3) opt.position = pos
  }
  return opt
}

function stop () {
  ui.setExportable(false)
  loop.stop()
  loop.removeAllListeners('tick')
  if (!current) return
  if (current.audio) {
    current.audio.pause()
    if (current.objectUrl) URL.revokeObjectURL(current.objectUrl)
  }
  if (current.stream) current.stream.getTracks().forEach((t) => t.stop())
  try { current.node.source.disconnect() } catch (e) {}
  current = null
}

function play (base) {
  if (!AudioContext) return
  const ctx = getAudioContext()
  const opt = getOptions(base)
  stop()

  if (opt.mic) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return ui.show('Microphone input is not available (it requires HTTPS).', true)
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const node = Analyser(stream, ctx, { audible: false, stereo: false })
      start({ stream, node, opt })
    }, (err) => {
      ui.show('Could not access the microphone: ' + err.message, true)
    })
    return
  }

  const audio = new Audio()
  let objectUrl = null
  if (opt.file) {
    objectUrl = URL.createObjectURL(opt.file)
    audio.src = objectUrl
  } else if (opt.url) {
    audio.crossOrigin = 'anonymous'
    audio.src = opt.url
  } else {
    return ui.show('Drop an audio file anywhere, or choose a source.')
  }

  const node = Analyser(audio, ctx, { audible: true, stereo: false })
  const entry = { audio, objectUrl, node, opt }
  current = entry

  audio.addEventListener('error', () => {
    if (current !== entry) return
    ui.show(opt.file
      ? 'That file could not be decoded as audio.'
      : 'Could not load that URL. It must be a direct link to an audio file on a server that allows CORS.', true)
  })
  audio.addEventListener('ended', () => loop.stop())
  audio.addEventListener('canplay', once(() => {
    if (current !== entry) return
    if (opt.seek && opt.seek < audio.duration) audio.currentTime = opt.seek
    audio.play().then(() => start(entry), (err) => {
      ui.show('Playback was blocked: ' + err.message, true)
    })
  }))
}

function start (entry) {
  current = entry
  ui.hide()
  clear()
  ui.setExportable(entry.audio ? (videoExport.isSupported() ? true : 'unsupported') : false,
    entry.opt.file ? entry.opt.file.name : null)

  const { opt, node, audio } = entry
  const spiral = createSpiral(context, opt)
  const startOffset = audio ? audio.currentTime : 0
  let liveTime = 0

  entry.reset = () => spiral.resize(window.innerWidth, window.innerHeight, dpr)
  entry.reset()

  loop.on('tick', render).start()

  function getProgress (dt) {
    if (!audio) {
      liveTime += Math.min(dt, 100) / 1000
      return { time: liveTime, t: liveTime / defined(opt.duration, LIVE_DURATION) }
    }
    const time = audio.currentTime - startOffset
    const total = isFinite(audio.duration)
      ? audio.duration - startOffset
      : defined(opt.duration, LIVE_DURATION)
    return { time, t: total > 0 ? time / total : 0 }
  }

  function render (dt) {
    const { time, t } = getProgress(dt)
    if (t > 1) return loop.stop()
    spiral.draw(node.waveform(), time, t)
  }
}

async function exportVideo (settings) {
  if (!current || !current.audio || exporting) return
  const { opt } = current
  const baseName = (opt.file ? opt.file.name.replace(/\.[^.]+$/, '') : 'polartone')
  const fileName = baseName + '-' + settings.width + 'x' + settings.height + '.mp4'

  // Must happen first, while the click still counts as a user gesture.
  let writable = null
  try {
    writable = await videoExport.pickOutput(fileName)
  } catch (err) {
    if (err.name === 'AbortError') return // user closed the save dialog
  }

  if (!current.audio.paused) togglePause()
  const job = exporting = { cancelled: false }
  const preview = document.createElement('canvas')
  ui.startProgress(preview)

  try {
    ui.progress(0, 'Decoding audio…')
    const data = opt.file
      ? await opt.file.arrayBuffer()
      : await fetch(opt.url).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.arrayBuffer()
      })
    const audioBuffer = await getAudioContext().decodeAudioData(data)

    const result = await videoExport.render({
      audioBuffer,
      preset: opt,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      length: settings.length,
      canvas: preview,
      writable,
      isCancelled: () => job.cancelled,
      onProgress: (fraction, info) => {
        if (job.cancelled) return
        ui.progress(fraction, 'Frame ' + info.frame + ' / ' + info.frameCount +
          (info.eta > 1 ? ' · about ' + formatTime(info.eta) + ' left' : ''))
      }
    })

    exporting = null
    if (!result) return ui.endProgress('Export cancelled.')
    if (result.blob) download(result.blob, fileName)
    ui.endProgress('Saved ' + fileName + (result.hasAudio ? '' : ' (without audio: this browser cannot encode AAC or Opus)') + '.')
  } catch (err) {
    exporting = null
    console.error(err)
    ui.endProgress('Export failed: ' + (err && err.message ? err.message : err), true)
  }
}

function formatTime (sec) {
  sec = Math.round(sec)
  const m = Math.floor(sec / 60)
  return m > 0 ? m + ' min ' + (sec % 60) + ' s' : sec + ' s'
}

function download (blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 60000)
}

function togglePause () {
  if (!current) return
  if (current.audio) {
    if (current.audio.paused) {
      getAudioContext()
      current.audio.play()
      loop.start()
    } else {
      current.audio.pause()
      loop.stop()
    }
  } else if (loop.running) {
    loop.stop()
  } else {
    loop.start()
  }
}

function clear () {
  createSpiral.clear(context)
}

function savePNG () {
  canvas.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'polartone-' + Date.now() + '.png'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  })
}

function printOptions () {
  console.log('%cpolartone', 'font-weight: bold; padding: 3px; background: #ededed;')
  console.log(`Drop an audio file on the page, or from the console:

  load(url) // loads a direct audio URL (must allow CORS)
  load(opt) // loads with full options

  options:
    url        a direct audio URL
    preset     one of the presets (defaults to random)
    capacity   number of line segments per tick
    distance   radial distance along circle to draw each tick
    position   camera [x, y, z]
    extent     amount to extend away from line center
    alpha      line opacity
    seek       seconds to jump into the song at
    duration   seconds per spiral for live / streaming input

The same settings (and url) can be given as query parameters, e.g.
  ?preset=1&alpha=0.1&position=0,-3.5,0&url=https://example.com/song.mp3
`)
}
