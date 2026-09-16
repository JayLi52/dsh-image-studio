/**
 * dsh-image-studio client plugin: ChatGPT-style image presentation in the dsh Web UI.
 *
 * - Message images (the markdown lines the tools' envelopes hand to the model) are
 *   re-laid-out as a 3-per-row grid of 4:3 cover tiles via inline styles, so the
 *   layout needs no knowledge of the app's hashed CSS-module class names.
 * - Clicking any content image opens a fullscreen lightbox: prev/next across all
 *   images of the conversation, 1:1 pixel zoom, download, Esc / arrow keys.
 *
 * Plain browser JS with zero imports; materialized at boot through the package's
 * `dsh.client` declaration (platform web, immediately).
 */
window.__ModuleLoader__.load({
  id: 'dsh-image-studio',
  factory: () => {
    return {
      name: 'image-studio-client',
      apply() {
    const TILE =
      'display:inline-block;width:calc((100% - 20px)/3);aspect-ratio:4/3;object-fit:cover;'
      + 'border-radius:10px;cursor:zoom-in;vertical-align:top;margin:0 10px 10px 0;background:#0b0e14;'
    const isContentImage = (el) =>
      el.tagName === 'IMG'
      && el.naturalWidth >= 200
      && el.naturalHeight >= 150
      && !el.closest('button')
      && !el.closest('[data-dsh-lightbox]')
      && !el.dataset.dshGal

    const applyGrid = () => {
      for (const img of document.querySelectorAll('img')) {
        if (!isContentImage(img)) continue
        img.dataset.dshGal = '1'
        img.setAttribute('style', (img.getAttribute('style') || '') + TILE)
      }
    }
    document.addEventListener('load', applyGrid, true)
    new MutationObserver(applyGrid).observe(document.body, { childList: true, subtree: true })
    applyGrid()

    /* ---------------- lightbox ---------------- */
    let items = []
    let idx = 0
    let zoom = false

    const overlay = document.createElement('div')
    overlay.dataset.dshLightbox = '1'
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(5,8,14,.96);z-index:2147483000;'
      + 'display:none;align-items:center;justify-content:center;flex-direction:column'
    const stage = document.createElement('div')
    stage.style.cssText = 'max-width:96vw;max-height:86vh;overflow:auto;display:flex;align-items:center;justify-content:center'
    const big = document.createElement('img')
    big.style.cssText = 'max-width:95vw;max-height:90vh;border-radius:8px;box-shadow:0 10px 50px rgba(0,0,0,.65)'
    stage.appendChild(big)
    const bar = document.createElement('div')
    bar.style.cssText = 'color:#cbd5e1;font:13px/1 system-ui;margin-top:12px;display:flex;gap:12px;align-items:center;user-select:none'
    bar.innerHTML =
      '<button data-a="prev" style="all:unset;cursor:pointer;font-size:20px;padding:4px 10px">‹</button>'
      + '<span data-a="count"></span>'
      + '<button data-a="next" style="all:unset;cursor:pointer;font-size:20px;padding:4px 10px">›</button>'
      + '<button data-a="zoom" style="all:unset;cursor:pointer;padding:4px 10px;border:1px solid #334155;border-radius:6px">1:1</button>'
      + '<button data-a="dl" style="all:unset;cursor:pointer;padding:4px 10px;border:1px solid #334155;border-radius:6px" title="下载原图到本地">⬇</button>'
      + '<button data-a="close" style="all:unset;cursor:pointer;padding:4px 10px;border:1px solid #334155;border-radius:6px">✕</button>'
    overlay.append(stage, bar)
    document.documentElement.appendChild(overlay)

    const count = bar.querySelector('[data-a="count"]')

    // Cross-origin <a download> is ignored by browsers, so pull the original
    // bytes through fetch and save via an object URL.
    const download = async () => {
      const src = items[idx] && items[idx].src
      if (!src) return
      try {
        // cache:'reload' — the image may already sit in the HTTP cache from a
        // no-cors <img> load saved before CORS headers existed; immutable
        // caching would otherwise replay that header-less response forever.
        const res = await fetch(src, { cache: 'reload' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = src.split('/').pop() || 'image.png'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      } catch {
        window.open(src, '_blank')
      }
    }

    const applyZoom = () => {
      // !important guards: even if a stray observer ever tiles this img, the
      // lightbox sizing wins.
      big.style.setProperty('width', 'auto', 'important')
      big.style.setProperty('aspect-ratio', 'auto', 'important')
      big.style.setProperty('object-fit', 'contain', 'important')
      if (zoom) {
        big.style.setProperty('max-width', 'none', 'important')
        big.style.setProperty('max-height', 'none', 'important')
      } else {
        big.style.setProperty('max-width', '95vw', 'important')
        big.style.setProperty('max-height', '90vh', 'important')
      }
    }
    const show = (i) => {
      if (items.length === 0) return
      idx = (i + items.length) % items.length
      zoom = false
      applyZoom()
      big.src = items[idx].src
      count.textContent = `${idx + 1} / ${items.length}`
    }
    const open = (img) => {
      items = [...document.querySelectorAll('img')].filter(
        (el) =>
          el.naturalWidth >= 200
          && el.naturalHeight >= 150
          && !el.closest('[data-dsh-lightbox]'),
      )
      idx = items.indexOf(img)
      if (idx < 0) {
        items = [img]
        idx = 0
      }
      overlay.style.display = 'flex'
      show(idx)
    }
    const close = () => {
      overlay.style.display = 'none'
    }

    document.addEventListener(
      'click',
      (e) => {
        const img = e.target.closest ? e.target.closest('img') : null
        if (
          img
          && img.naturalWidth >= 200
          && img.naturalHeight >= 150
          && !img.closest('button')
          && !img.closest('[data-dsh-lightbox]')
        ) {
          e.preventDefault()
          e.stopPropagation()
          open(img)
        }
      },
      true,
    )
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target === stage) close()
    })
    bar.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')
      if (!a) return
      const act = a.dataset.a
      if (act === 'close') close()
      if (act === 'prev') show(idx - 1)
      if (act === 'next') show(idx + 1)
      if (act === 'zoom') {
        zoom = !zoom
        applyZoom()
      }
      if (act === 'dl') download()
    })
    window.addEventListener('keydown', (e) => {
      if (overlay.style.display !== 'flex') return
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowLeft') show(idx - 1)
      if (e.key === 'ArrowRight') show(idx + 1)
    })

    /* ---------------- KaTeX math rendering ----------------
     * The dsh Web UI ships no TeX renderer, so $...$ / $$...$$ in assistant
     * messages display as raw text. Self-hosted KaTeX (nginx /katex/) plus
     * auto-render on a debounced MutationObserver fixes it without touching
     * harness source. Re-running auto-render is safe: consumed delimiters
     * disappear, so already-rendered regions are skipped naturally. */
    if (!window.__dshKatexBooted) {
      window.__dshKatexBooted = 1
      const base = `${location.origin}/katex/`
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = `${base}katex.min.css`
      document.head.appendChild(link)
      const mainScript = document.createElement('script')
      mainScript.src = `${base}katex.min.js`
      mainScript.onload = () => {
        const ar = document.createElement('script')
        ar.src = `${base}contrib/auto-render.min.js`
        ar.onload = () => {
          let timer = null
          const scan = () => {
            if (typeof window.renderMathInElement !== 'function') return
            try {
              window.renderMathInElement(document.body, {
                delimiters: [
                  { left: '$$', right: '$$', display: true },
                  { left: '$', right: '$', display: false },
                  { left: '\\[', right: '\\]', display: true },
                  { left: '\\(', right: '\\)', display: false },
                ],
                ignoredTags: ['pre', 'code', 'textarea', 'input', 'option', 'script', 'style'],
              })
            } catch {
              /* partial streaming content: retry on next mutation */
            }
          }
          new MutationObserver(() => {
            clearTimeout(timer)
            timer = setTimeout(scan, 400)
          }).observe(document.body, { childList: true, subtree: true })
          scan()
        }
        document.head.appendChild(ar)
      }
      document.head.appendChild(mainScript)
    }
      },
    }
  },
})
