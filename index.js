const Analyser = require('web-audio-analyser')
const createCamera = require('perspective-camera')
const createLoop = require('raf-loop')
const getContext = require('get-canvas-context')
const lerp = require('lerp')
const once = require('once')
const defined = require('defined')
const fit = require('canvas-fit')
const presets = require('./presets')
const createUI = require('./lib/ui')

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
  onMic: () => play({ mic: true })
})

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
  if (ev.target && ev.target.tagName === 'INPUT') return
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

  const { opt, node, audio } = entry
  const shape = [0, 0]
  const camera = createCamera({ fov: Math.PI / 4, near: 0.01, far: 100 })
  const cursor = [0, 0, 0]
  let positions = []
  let liveTime = 0

  const positionMax = defined(opt.capacity, 1000)
  const dist = defined(opt.distance, 0.25)
  const ySize = defined(opt.extent, 0.5)
  const alpha = defined(opt.alpha, 0.25)
  const startOffset = audio ? audio.currentTime : 0

  entry.reset = () => {
    shape[0] = window.innerWidth
    shape[1] = window.innerHeight
    camera.viewport = [0, 0, shape[0], shape[1]]
    positions = []
  }
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

    const audioData = node.waveform()
    const bufferLength = audioData.length

    camera.identity()
    camera.translate(opt.position || [0, 3.5, 0])
    camera.lookAt([0, 0, 0])
    camera.update()

    context.save()
    context.scale(dpr, dpr)
    context.strokeStyle = 'rgba(0, 0, 0, ' + alpha + ')'
    context.lineWidth = 1
    context.lineJoin = 'round'
    context.beginPath()
    for (let i = positions.length - 1; i >= 0; i--) {
      const pos = positions[i]
      context.lineTo(pos[0], pos[1])
    }
    context.stroke()
    context.restore()

    const radius = 1 - t
    const startAngle = time
    for (let i = 0; i < bufferLength; i++) {
      const a = i / (bufferLength - 1)
      const angle = lerp(startAngle + dist, startAngle, a)
      cursor[0] = Math.cos(angle) * radius
      cursor[2] = Math.sin(angle) * radius

      const amplitude = audioData[i] / 128.0
      const waveY = amplitude * ySize / 2

      const [x, y] = camera.project([cursor[0], cursor[1] + waveY, cursor[2]])
      if (positions.length > positionMax) positions.shift()
      positions.push([x, y])
    }
  }
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
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.restore()
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
