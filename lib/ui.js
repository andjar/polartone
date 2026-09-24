// Minimal start/drop overlay. Browsers only allow audio to start after a
// user gesture, so every source is chosen through this panel.

const css = `
.pt-panel {
  position: fixed; inset: 0; z-index: 10;
  display: flex; align-items: center; justify-content: center;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  color: #222; background: rgba(255, 255, 255, 0.85);
  transition: background 0.15s;
}
.pt-panel.pt-drag { background: rgba(230, 240, 255, 0.95); }
.pt-panel[hidden] { display: none; }
.pt-box { max-width: 380px; padding: 24px; text-align: center; }
.pt-box h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; letter-spacing: 0.02em; }
.pt-box p { margin: 0 0 16px; color: #555; }
.pt-box button {
  font: inherit; cursor: pointer; margin: 4px; padding: 8px 16px;
  border: 1px solid #222; border-radius: 4px; background: #fff; color: #222;
}
.pt-box button:hover { background: #222; color: #fff; }
.pt-error { color: #c00 !important; }
.pt-box a { color: #0066ff; text-decoration: none; }
.pt-box a:hover { text-decoration: underline; }
.pt-hint {
  position: fixed; left: 12px; bottom: 10px; z-index: 5;
  font: 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  color: #999; user-select: none;
}
`

module.exports = function createUI ({ onFile, onUrl, onMic }) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  const panel = document.createElement('div')
  panel.className = 'pt-panel'
  panel.innerHTML = `
    <div class="pt-box">
      <h1>polartone</h1>
      <p class="pt-msg">Drop an audio file anywhere, or choose a source.</p>
      <div>
        <button data-act="file">Choose file</button>
        <button data-act="mic">Use microphone</button>
        <button data-act="url" hidden>Play URL</button>
      </div>
      <p style="margin-top:16px;font-size:12px">
        <a target="_blank" rel="noopener" href="https://github.com/mattdesl/polartone">source on GitHub</a>
      </p>
    </div>`
  document.body.appendChild(panel)

  const hint = document.createElement('div')
  hint.className = 'pt-hint'
  hint.textContent = 'drop a file · space to pause · esc for menu · s to save PNG'
  hint.hidden = true
  document.body.appendChild(hint)

  const msg = panel.querySelector('.pt-msg')
  const urlBtn = panel.querySelector('[data-act="url"]')
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
  })

  // drag and drop anywhere on the page
  let depth = 0
  window.addEventListener('dragenter', (ev) => {
    ev.preventDefault()
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
    const file = ev.dataTransfer && ev.dataTransfer.files[0]
    if (file) onFile(file)
  })

  return {
    show (text, isError) {
      if (text) msg.textContent = text
      msg.classList.toggle('pt-error', !!isError)
      panel.hidden = false
      hint.hidden = true
    },
    hide () {
      panel.hidden = true
      hint.hidden = false
    },
    setUrl (url) {
      urlBtn.hidden = !url
      if (url) urlBtn.title = url
    }
  }
}
