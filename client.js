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

    /* Older messages embed absolute loopback URLs (http://127.0.0.1:3081/…)
       that only resolve on the server itself, and any absolute /dsh-images/
       URL from a foreign origin is likewise unreachable from this browser.
       Repoint them at the origin the UI is actually served from so inline
       images load no matter how the user reaches the box. */
    const fixSrc = (img) => {
      if (img.closest('[data-dsh-lightbox]')) return
      const src = img.getAttribute('src') || ''
      let m = /^https?:\/\/(?:127\.0\.0\.1|localhost):3081\/(.+)$/.exec(src)
      if (!m) m = /^https?:\/\/[^/]+\/(dsh-images\/.+)$/.exec(src)
      if (!m) return
      const want = `${location.origin}/${m[1].replace(/^\/+/, '')}`
      if (img.src !== want) img.src = want
    }

    const applyGrid = () => {
      for (const img of document.querySelectorAll('img')) {
        fixSrc(img)
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

    /* ---------------- math-aware clipboard ----------------
     * Selecting rendered KaTeX and copying yields fragmented glyph soup by
     * default. Re-serialize the selection: text nodes pass through, each
     * .katex element contributes its original TeX from the MathML
     * <annotation encoding="application/x-tex"> node, wrapped in $ / $$. */
    const serializeMathSelection = (node) => {
      if (node.nodeType === 3) return node.textContent
      if (node.nodeType !== 1) return ''
      const el = node
      if (el.classList.contains('katex-mathml')) return ''
      if (el.classList.contains('katex-display')) {
        const inner = el.querySelector('.katex')
        return inner ? serializeMathSelection(inner) : ''
      }
      if (el.classList.contains('katex')) {
        const display = el.parentElement && el.parentElement.classList.contains('katex-display')
        const tex = (el.querySelector('annotation[encoding="application/x-tex"]') || {}).textContent
        if (tex === undefined || tex === null) return el.textContent
        return display ? `$$${tex}$$` : `$${tex}$`
      }
      if (el.tagName === 'BR') return '\n'
      let out = ''
      for (const child of el.childNodes) out += serializeMathSelection(child)
      return out
    }
    document.addEventListener('copy', (e) => {
      const sel = typeof window.getSelection === 'function' ? window.getSelection() : null
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const frag = sel.getRangeAt(0).cloneContents()
      if (!frag.querySelector || !frag.querySelector('.katex')) return
      const text = serializeMathSelection(frag)
      if (text) {
        e.clipboardData.setData('text/plain', text)
        e.preventDefault()
      }
    })

    /* ---------------- bare-TeX safety net ----------------
     * Models sometimes emit math as bare prose — lim_{h→0⁺}, x₀ — with no
     * $...$ delimiters, which auto-render cannot pick up. Anchor on
     * unambiguous TeX markers (_{ }, ^{ }, \cmd) outside math/code, extend
     * across the surrounding math run, normalize unicode sub/superscripts
     * and symbols to TeX, then wrap in $...$ so the KaTeX pass renders it.
     * Already-saved messages heal on render this way. */
    const SUB_MAP = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-', 'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₙ': 'n', 'ᵢ': 'i', 'ⱼ': 'j' }
    const SUP_MAP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', 'ⁿ': 'n', 'ⁱ': 'i' }
    const SYM_MAP = {
      '→': '\\to ', '←': '\\gets ', '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ',
      '⟹': '\\implies ', '⟺': '\\iff ', '−': '-', '–': '-', '—': '-', '×': '\\times ',
      '±': '\\pm ', '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '∈': '\\in ', '∉': '\\notin ',
      '⊂': '\\subset ', '∪': '\\cup ', '∩': '\\cap ', '∞': '\\infty ', '∅': '\\varnothing ',
      '∀': '\\forall ', '∃': '\\exists ', '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ',
      '√': '\\sqrt ', '⋅': '\\cdot ', '·': '\\cdot ', '…': '\\dots ', '∂': '\\partial ',
      '∇': '\\nabla ', '≈': '\\approx ', '≡': '\\equiv ', '∝': '\\propto ', '⊥': '\\perp ',
      '∥': '\\parallel ', '∠': '\\angle ',
    }
    // Symbols/digits/greek that freely extend a math run in either direction.
    const CORE = /[0-9=+<>!|/\\()[\]{}^_.,:;*−×±≤≥≠∈∉⊂∪∞∀∃∑∏∫√⋅·…∂∇≈≡∝∥∠→←⇒⇔⟹₀-₉⁰-⁹₋ₐₑₒₓₙᵢ⁺⁻ⁿⁱͰ-Ͽ]/
    // Unambiguous math symbols that anchor a bare-math run even without _{ } or \cmd.
    const ANCHOR_EXTRA = '[∈∉≤≥≠←→⇒⇔⟹∏∫√∀∂∇≈≡∝<>−₀-₉⁰-⁹]'
    const MARKER_RE = new RegExp('[A-Za-z]*[_^]\\{[^{}]*\\}|\\\\[a-zA-Z]+|' + ANCHOR_EXTRA, 'g')
    const HAS_MARKER_RE = new RegExp('[_^]\\{|\\\\[a-zA-Z]+|' + ANCHOR_EXTRA)
    const isLetter = (c) => /[A-Za-z′]/.test(c)

    const extendLeft = (s, i) => {
      let j = i
      while (j > 0) {
        const c = s[j - 1]
        if (CORE.test(c)) { j--; continue }
        if (isLetter(c)) {
          // a single-letter variable joins; a >=2-letter word is prose
          if (j >= 2 && /[A-Za-z]/.test(s[j - 2])) break
          j--; continue
        }
        if (c === ' ') {
          const p = s[j - 2]
          if (p === undefined) break
          if (CORE.test(p)) { j -= 2; continue }
          if (isLetter(p) && (j < 3 || !/[A-Za-z]/.test(s[j - 3]))) { j -= 2; continue }
        }
        break
      }
      return j
    }
    const extendRight = (s, i) => {
      let j = i
      while (j < s.length) {
        const c = s[j]
        if (CORE.test(c) || isLetter(c)) { j++; continue }
        if (c === ' ') {
          const n = s[j + 1]
          if (n === undefined) break
          if (CORE.test(n)) { j += 2; continue }
          if (isLetter(n) && !/^[A-Za-z]{2,}/.test(s.slice(j + 1))) { j += 2; continue }
        }
        break
      }
      return j
    }
    const texify = (raw) => {
      let out = ''
      for (let k = 0; k < raw.length; k++) {
        const c = raw[k]
        const map = SUB_MAP[c] ? SUB_MAP : SUP_MAP[c] ? SUP_MAP : null
        if (map) {
          let run = ''
          let t = k
          while (t < raw.length && map[raw[t]]) { run += map[raw[t]]; t++ }
          out += (map === SUB_MAP ? '_{' : '^{') + run + '}'
          k = t - 1
          continue
        }
        out += SYM_MAP[c] !== undefined ? SYM_MAP[c] : c
      }
      // bare operator words become TeX operators: lim -> \lim
      return out.replace(/(?<!\\)\b(lim|max|min|sup|inf|ln|log|sin|cos|tan|exp|det|gcd)\b/g, '\\$1 ')
    }
    const normalized = typeof WeakSet === 'function' ? new WeakSet() : null
    const normalizeBareMath = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
      const nodes = []
      while (walker.nextNode()) nodes.push(walker.currentNode)
      for (const node of nodes) {
        if (normalized && normalized.has(node)) continue
        const s = node.nodeValue
        if (!s || !HAS_MARKER_RE.test(s)) continue
        const el = node.parentElement
        if (el && el.closest('pre,code,textarea,script,style,.katex,[data-dsh-lightbox]')) continue
        const dollars = []
        for (let k = 0; k < s.length; k++) if (s[k] === '$') dollars.push(k)
        const insideMath = (i) => {
          let n = 0
          for (const d of dollars) { if (d < i) n++; else break }
          return n % 2 === 1
        }
        const spans = []
        const re = new RegExp(MARKER_RE.source, 'g')
        let m
        while ((m = re.exec(s))) {
          if (insideMath(m.index)) continue
          spans.push([extendLeft(s, m.index), extendRight(s, m.index + m[0].length)])
        }
        if (normalized) normalized.add(node)
        if (!spans.length) continue
        spans.sort((x, y) => x[0] - y[0])
        const merged = []
        for (const sp of spans) {
          const last = merged[merged.length - 1]
          if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1])
          else merged.push([sp[0], sp[1]])
        }
        let out = ''
        let prev = 0
        for (const [a0, b0] of merged) {
          // prose punctuation at the span edges (the comma in "= A, 存在")
          // stays outside the math span
          let a = a0
          let b = b0
          while (b > a && /[,.;:，、；：]/.test(s[b - 1])) b--
          while (a < b && /[,.;:，、；：]/.test(s[a])) a++
          out += s.slice(prev, a)
          const inner = texify(s.slice(a, b)).replace(/^\s+/, '').replace(/\s+$/, '')
          if (inner) out += '$' + inner + '$'
          out += s.slice(b, b0)
          prev = b0
        }
        out += s.slice(prev)
        if (out !== s) node.nodeValue = out
      }
    }

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
              normalizeBareMath(document.body)
              window.renderMathInElement(document.body, {
                throwOnError: false,
                errorColor: '#b91c1c',
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
