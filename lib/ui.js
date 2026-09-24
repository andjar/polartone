// Minimal start/drop overlay. Browsers only allow audio to start after a
// user gesture, so every source is chosen through this panel. It also hosts
// the video export controls and progress view.

const css = `
.pt-panel {
  position: fixed; inset: 0; z-index: 10;
  display: flex; align-items: center; justify-content: center;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  color: #222; background: rgba(255, 255, 255, 0.88);
  transition: background 0.15s; overflow: auto;
}
.pt-panel.pt-drag { background: rgba(230, 240, 255, 0.95); }
.pt-panel[hidden], .pt-panel [hidden] { display: none !important; }
.pt-box { width: 100%; max-width: 420px; padding: 24px; text-align: center; box-sizing: border-box; }
.pt-box h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; letter-spacing: 0.02em; }
.pt-box p { margin: 0 0 16px; color: #555; }
.pt-box button {
  font: inherit; cursor: pointer; margin: 4px; padding: 8px 16px;
  border: 1px solid #222; border-radius: 4px; background: #fff; color: #222;
}
.pt-box button:hover { background: #222; color: #fff; }
.pt-box button.pt-primary { background: #222; color: #fff; }
.pt-box button.pt-primary:hover { background: #000; }
.pt-error { color: #c00 !important; }
.pt-box a { color: #0066ff; text-decoration: none; }
.pt-box a:hover { text-decoration: underline; }
.pt-export {
  margin-top: 20px; padding-top: 16px; border-top: 1px solid #ddd; text-align: left;
}
.pt-export h2 { font-size: 14px; font-weight: 600; margin: 0 0 10px; text-align: center; }
.pt-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.pt-row label { flex: 0 0 90px; color: #555; }
.pt-row select { flex: 1; font: inherit; padding: 4px; min-width: 0; }
.pt-export .pt-actions { text-align: center; margin-top: 10px; }
.pt-note { font-size: 12px; color: #888 !important; margin: 8px 0 0 !important; text-align: center; }
.pt-preview {
  display: block; width: 100%; height: auto; max-height: 50vh; object-fit: contain;
  border: 1px solid #ddd; background: #fff; margin: 0 auto 12px;
}
.pt-bar { height: 6px; background: #eee; border-radius: 3px; overflow: hidden; margin: 8px 0; }
.pt-bar > div { height: 100%; width: 0; background: #222; }
.pt-hint {
  position: fixed; left: 12px; bottom: 10px; z-index: 5;
  font: 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  color: #999; user-select: none;
}
`

const RESOLUTIONS = [
  ['1920x1080', '1080p · 1920×1080'],
  ['2560x1440', '1440p · 2560×1440'],
  ['3840x2160', '4K · 3840×2160'],
  ['2160x2160', 'Square · 2160×2160'],
  ['4096x4096', 'Square print · 4096×4096'],
  ['2160x3840', 'Vertical 4K · 2160×3840']
]

module.exports = function createUI ({ onFile, onUrl, onMic, onExport, onCancelExport }) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  const panel = document.createElement('div')
  panel.className = 'pt-panel'
  panel.innerHTML = `
    <div class="pt-box">
      <div class="pt-menu">
        <h1>polartone</h1>
        <p class="pt-msg">Drop an audio file anywhere, or choose a source.</p>
        <div>
          <button data-act="file">Choose file</button>
          <button data-act="mic">Use microphone</button>
          <button data-act="url" hidden>Play URL</button>
        </div>
        <div class="pt-export" hidden>
          <h2>Export video</h2>
          <div class="pt-row"><label>Resolution</label><select name="res">
            ${RESOLUTIONS.map(([v, l]) => `<option value="${v}"${v === '3840x2160' ? ' selected' : ''}>${l}</option>`).join('')}
          </select></div>
          <div class="pt-row"><label>Frame rate</label><select name="fps">
            <option value="60" selected>60 fps</option><option value="30">30 fps</option>
          </select></div>
          <div class="pt-row"><label>Length</label><select name="length">
            <option value="0" selected>Whole track</option>
            <option value="15">First 15 seconds (test)</option>
            <option value="60">First minute</option>
          </select></div>
          <div class="pt-actions"><button class="pt-primary" data-act="export">Export MP4</button></div>
          <p class="pt-note pt-export-note">Renders frame by frame with the current preset and the track's audio.</p>
        </div>
        <p style="margin-top:16px;font-size:12px">
          <a target="_blank" rel="noopener" href="https://github.com/mattdesl/polartone">source on GitHub</a>
        </p>
      </div>
      <div class="pt-progress" hidden>
        <h1>Exporting…</h1>
        <div class="pt-preview-slot"></div>
        <div class="pt-bar"><div></div></div>
        <p class="pt-status">Preparing…</p>
        <button data-act="cancel">Cancel</button>
      </div>
    </div>`
  document.body.appendChild(panel)

  const hint = document.createElement('div')
  hint.className = 'pt-hint'
  hint.textContent = 'drop a file · space pause · esc menu/export · s save PNG'
  hint.hidden = true
  document.body.appendChild(hint)

  const $ = (sel) => panel.querySelector(sel)
  const msg = $('.pt-msg')
  const urlBtn = $('[data-act="url"]')
  const exportBox = $('.pt-export')
  const exportNote = $('.pt-export-note')
  const menuView = $('.pt-menu')
  const progressView = $('.pt-progress')
  const bar = $('.pt-bar > div')
  const status = $('.pt-status')
  const previewSlot = $('.pt-preview-slot')
  const cancelBtn = $('[data-act="cancel"]')
  let busy = false

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*,video/*'
  input.addEventListener('change', () => {
    if (input.files[0]) onFile(input.files[0])
    input.value = ''
  })

  panel.addEventListener('click', (ev) => {
    const act = ev.target.getAttribute && ev.target.getAttribute('data-act')
    if (act === 'file') input.click()
    else if (act === 'mic') onMic()
    else if (act === 'url') onUrl()
    else if (act === 'cancel') onCancelExport()
    else if (act === 'export') {
      const [width, height] = $('[name="res"]').value.split('x').map(Number)
      onExport({
        width,
        height,
        fps: Number($('[name="fps"]').value),
        length: Number($('[name="length"]').value) || 0
      })
    }
  })

  // drag and drop anywhere on the page
  let depth = 0
  window.addEventListener('dragenter', (ev) => {
    ev.preventDefault()
    if (busy) return
    depth++
    panel.hidden = false
    panel.classList.add('pt-drag')
  })
  window.addEventListener('dragleave', () => {
    if (--depth <= 0) { depth = 0; panel.classList.remove('pt-drag') }
  })
  window.addEventListener('dragover', (ev) => ev.preventDefault())
  window.addEventListener('drop', (ev) => {
    ev.preventDefault()
    depth = 0
    panel.classList.remove('pt-drag')
    if (busy) return
    const file = ev.dataTransfer && ev.dataTransfer.files[0]
    if (file) onFile(file)
  })

  return {
    get busy () { return busy },
    show (text, isError) {
      if (busy) return
      if (text) msg.textContent = text
      msg.classList.toggle('pt-error', !!isError)
      panel.hidden = false
      hint.hidden = true
    },
    hide () {
      if (busy) return
      panel.hidden = true
      hint.hidden = false
    },
    setUrl (url) {
      urlBtn.hidden = !url
      if (url) urlBtn.title = url
    },
    // exportable: false | true | 'unsupported'
    setExportable (state, name) {
      exportBox.hidden = !state
      const btn = $('[data-act="export"]')
      btn.disabled = state === 'unsupported'
      exportNote.textContent = state === 'unsupported'
        ? 'Video export needs WebCodecs (recent Chrome, Edge or Safari).'
        : 'Renders ' + (name ? '"' + name + '"' : 'the track') +
          ' frame by frame with the current preset, audio included.'
    },
    startProgress (previewCanvas) {
      busy = true
      previewSlot.innerHTML = ''
      previewCanvas.className = 'pt-preview'
      previewSlot.appendChild(previewCanvas)
      bar.style.width = '0%'
      status.textContent = 'Preparing…'
      cancelBtn.disabled = false
      menuView.hidden = true
      progressView.hidden = false
      panel.hidden = false
      hint.hidden = true
    },
    progress (fraction, text) {
      bar.style.width = (fraction * 100).toFixed(1) + '%'
      if (text) status.textContent = text
    },
    cancelling () {
      cancelBtn.disabled = true
      status.textContent = 'Cancelling…'
    },
    endProgress (text, isError) {
      busy = false
      menuView.hidden = false
      progressView.hidden = true
      previewSlot.innerHTML = ''
      this.show(text, isError)
    }
  }
}
