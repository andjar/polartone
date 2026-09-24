// The polar waveform renderer, shared by the live view and the video export.
// Everything is laid out in "logical" pixels (width x height) and scaled by
// `scale` into the backing canvas, so a 4K export looks like the on-screen
// version, just sharper.

const createCamera = require('perspective-camera')
const lerp = require('lerp')
const defined = require('defined')

module.exports = function createSpiral (context, opt) {
  opt = opt || {}
  const camera = createCamera({ fov: Math.PI / 4, near: 0.01, far: 100 })
  const cursor = [0, 0, 0]
  const point = [0, 0, 0]
  const positionMax = defined(opt.capacity, 1000)
  const dist = defined(opt.distance, 0.25)
  const ySize = defined(opt.extent, 0.5)
  const alpha = defined(opt.alpha, 0.25)
  const lineWidth = defined(opt.lineWidth, 1)
  let positions = []
  let scale = 1

  function resize (width, height, pixelScale) {
    scale = pixelScale || 1
    camera.viewport = [0, 0, width, height]
    positions = []
  }

  // waveform: Uint8Array of time-domain samples centred on 128 (the format of
  // AnalyserNode.getByteTimeDomainData). time: seconds since start.
  // t: 0..1 progress through the piece, which shrinks the radius.
  function draw (waveform, time, t) {
    camera.identity()
    camera.translate(opt.position || [0, 3.5, 0])
    camera.lookAt([0, 0, 0])
    camera.update()

    context.save()
    context.scale(scale, scale)
    context.strokeStyle = 'rgba(0, 0, 0, ' + alpha + ')'
    context.lineWidth = lineWidth
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
    const n = waveform.length
    for (let i = 0; i < n; i++) {
      const angle = lerp(startAngle + dist, startAngle, i / (n - 1))
      cursor[0] = Math.cos(angle) * radius
      cursor[2] = Math.sin(angle) * radius
      point[0] = cursor[0]
      point[1] = cursor[1] + (waveform[i] / 128.0) * ySize / 2
      point[2] = cursor[2]
      const [x, y] = camera.project(point)
      if (positions.length > positionMax) positions.shift()
      positions.push([x, y])
    }
  }

  return { resize, draw }
}

module.exports.clear = function clear (context, color) {
  const canvas = context.canvas
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.fillStyle = color || '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.restore()
}
