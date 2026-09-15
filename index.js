/**
 * `dsh-image-studio`: two native visual tools for the DeepSeek Harness.
 *
 * - `generate_image` — DashScope qwen-image diffusion generation (async task
 *   API), for conceptual illustrations, structure sketches, scenes, posters.
 * - `plot_function` — exact 2D function plotting rendered to PNG in-process
 *   (pure JS PNG encoder, no dependencies), for math curves where diffusion
 *   models cannot be trusted with coordinates.
 *
 * Out-of-tree bundle plugin with deliberately zero runtime imports: harness
 * packages are not guaranteed importable from a profile install location, so
 * tools are registered as raw JSON-Schema definitions and image blocks are
 * plain content-block object literals (the same shape `read_image` renders).
 * Generated pixels are committed through the `attachments` seam so the Web UI
 * shows them inline and vision-capable routes can read them back.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { deflateSync } from 'node:zlib'

export const name = 'image-studio'

export const inject = ['tools', 'fs', 'systemPrompt']

/** Proactive-invocation guidance: makes the visuals a native habit, not a user-named tool. */
const GUIDANCE = [
  'Visual aid policy (image-studio):',
  '- When an explanation involves shape, structure, or space — function curves and graphs, geometric relations, mechanical or engineering structures, processes and architectures — proactively produce a visual instead of a walls-of-text description. Do not ask permission first when the visual directly serves the current explanation.',
  '- For exact mathematical function graphs, coordinate plots, and calculus visualizations (limits, derivatives, integrals, series), call plot_function: diffusion models cannot render accurate axes or curves.',
  '- For conceptual diagrams, structure sketches, scene or object illustrations, posters, and "draw me a picture" requests, call generate_image.',
  '- CRITICAL presentation rule: after plot_function or generate_image succeeds, your final message MUST embed the image inline as markdown image syntax: ![<short caption>](http://127.0.0.1:3081/<path>) where <path> is the workspace-relative path from the tool result (e.g. dsh-images/plot-123.png). That URL serves the file to the user through a private tunnel; a bare filename or path reference is NOT acceptable.',
  '- Also mention the workspace path once so the user can reuse the file.',
].join('\n')

export function apply(ctx) {
  ctx.systemPrompt.section({ name: 'image-studio-guidance', order: 90, text: GUIDANCE })
  ctx.tools.register(makeGenerateImageTool(ctx))
  ctx.tools.register(makePlotFunctionTool(ctx))
}

/* ------------------------------------------------------------------ */
/* generate_image                                                      */
/* ------------------------------------------------------------------ */

/** Single-workspace deployment root; the bundle runs in global scope where ctx.fs resolves against the process cwd, not the session workspace. */
const WORKSPACE_ROOT = '/root/workspace'

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1'

function makeGenerateImageTool(ctx) {
  return {
    name: 'generate_image',
    description:
      'Generate an image with an AI diffusion model (DashScope qwen-image). '
      + 'Use when the user asks to draw/generate/create a picture, illustration, poster, concept diagram, mechanical-structure sketch, or scene, or when a conceptual visual would help an explanation. '
      + 'For exact math function graphs or coordinate plots use plot_function instead — diffusion models render coordinates inaccurately. '
      + 'The PNG is shown inline in the conversation and saved under dsh-images/ in the workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Image description. Include subject, scene, style, composition; write any in-image text verbatim.' },
        size: { type: 'string', description: 'Pixel size W*H, e.g. 1328*1328 (default), 1664*928 landscape, 928*1664 portrait.' },
        model: { type: 'string', description: 'DashScope image model id; default qwen-image-3.0-pro.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'prompt', 'image'],
        properties: {
          path: { type: 'string' },
          prompt: { type: 'string' },
          model: { type: 'string' },
          image: {
            type: 'object',
            additionalProperties: false,
            required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
            properties: {
              attachmentId: { type: 'string' },
              mediaType: { type: 'string' },
              bytes: { type: 'integer' },
              width: { type: 'integer' },
              height: { type: 'integer' },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `<path>${value.path}</path>\n<content>generated ${value.image.width}x${value.image.height} px image via ${value.model}; prompt: ${value.prompt}</content>\n<inline_markdown>![${value.prompt.slice(0, 40)}](http://127.0.0.1:3081/${value.path})</inline_markdown>\nCopy the <inline_markdown> line verbatim into your final message so the image renders inline.`,
        },
        {
          type: 'image',
          attachment: {
            attachmentId: value.image.attachmentId,
            mediaType: value.image.mediaType,
            bytes: value.image.bytes,
            width: value.image.width,
            height: value.image.height,
            ...(value.image.name === undefined ? {} : { name: value.image.name }),
          },
        },
      ],
    },
    timeoutMs: 300_000,
    async execute(args, exec) {
      const apiKey = process.env.DASHSCOPE_API_KEY
      if (!apiKey) throw new Error('generate_image: DASHSCOPE_API_KEY is not set in the dsh environment')
      const model = args.model || 'qwen-image-3.0-pro'
      const size = args.size || '1328*1328'

      const submit = await fetch(`${DASHSCOPE_BASE}/services/aigc/image-generation/generation`, {
        method: 'POST',
        signal: exec.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model,
          input: { messages: [{ role: 'user', content: [{ text: args.prompt }] }] },
          parameters: { size },
        }),
      })
      const submitted = await submit.json()
      const taskId = submitted?.output?.task_id
      if (!taskId) throw new Error(`generate_image: task submit failed: ${submitted?.message || JSON.stringify(submitted).slice(0, 200)}`)

      let imageUrl
      const deadline = Date.now() + 280_000
      for (;;) {
        if (exec.signal.aborted) throw new Error('generate_image: cancelled')
        if (Date.now() > deadline) throw new Error('generate_image: task timed out')
        await new Promise((resolve) => setTimeout(resolve, 3000))
        const poll = await fetch(`${DASHSCOPE_BASE}/tasks/${taskId}`, {
          signal: exec.signal,
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        const state = await poll.json()
        const status = state?.output?.task_status
        if (status === 'SUCCEEDED') {
          imageUrl = state?.output?.choices?.[0]?.message?.content?.[0]?.image
            ?? state?.output?.results?.[0]?.url
          if (!imageUrl) throw new Error('generate_image: task succeeded but no image url in result')
          break
        }
        if (status === 'FAILED' || status === 'CANCELED') {
          throw new Error(`generate_image: task ${status}: ${state?.output?.message || 'unknown'}`)
        }
      }

      const image = await fetch(imageUrl, { signal: exec.signal })
      if (!image.ok) throw new Error(`generate_image: image download failed: HTTP ${image.status}`)
      const bytes = new Uint8Array(await image.arrayBuffer())
      if (bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('generate_image: downloaded payload is not a PNG')

      const fname = `gen-${Date.now()}.png`
      const rel = `dsh-images/${fname}`
      const target = await ctx.fs.resolve(`${WORKSPACE_ROOT}/${rel}`)
      const host = ctx.fs.processPath(target)
      await mkdir(dirname(host), { recursive: true })
      await writeFile(host, bytes)

      const attachments = ctx.get('attachments')
      if (!attachments) throw new Error('generate_image: no attachment store mounted; image saved at ' + rel)
      const [ref] = await attachments.saveImages([{ data: bytes, mediaType: 'image/png', name: fname }])

      return {
        path: rel,
        prompt: args.prompt,
        model,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          name: fname,
        },
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* plot_function: expression compiler, rasterizer, PNG encoder         */
/* ------------------------------------------------------------------ */

const FN_MAP = {
  sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan',
  asin: 'Math.asin', acos: 'Math.acos', atan: 'Math.atan',
  sinh: 'Math.sinh', cosh: 'Math.cosh', tanh: 'Math.tanh',
  sqrt: 'Math.sqrt', abs: 'Math.abs', exp: 'Math.exp',
  floor: 'Math.floor', ceil: 'Math.ceil', round: 'Math.round',
  min: 'Math.min', max: 'Math.max', pow: 'Math.pow',
  log2: 'Math.log2', log10: 'Math.log10', log: 'Math.log10', ln: 'Math.log',
  pi: 'Math.PI', e: 'Math.E',
}

function compileExpression(expr) {
  let s = String(expr).toLowerCase().replace(/\s+/g, '').replace(/\^/g, '**')
  s = s.replace(/[a-z_][a-z_0-9]*/g, (id) => {
    if (id === 'x') return 'x'
    const mapped = FN_MAP[id]
    if (!mapped) throw new Error(`plot_function: unsupported identifier "${id}" (allowed: x, pi, e, sin cos tan asin acos atan sinh cosh tanh sqrt abs exp ln log log2 log10 floor ceil round min max pow)`)
    return mapped
  })
  const stripped = s.replace(/Math\.[A-Za-z0-9]+/g, 'M')
  if (!/^[Mx0-9.+\-*/(),]*$/.test(stripped)) {
    throw new Error('plot_function: expression contains unsupported syntax after identifier mapping')
  }
  const fn = new Function('x', `"use strict"; return (${s});`)
  fn(1)
  return fn
}

/* 5x7 bitmap font (rows are 5-bit masks, MSB = leftmost pixel). */
const FONT = {
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '.': [0, 0, 0, 0, 0, 0x0c, 0x0c],
  '-': [0, 0, 0, 0x0e, 0, 0, 0],
  '+': [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  'x': [0, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0],
  'y': [0, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '=': [0, 0, 0x1f, 0, 0x1f, 0, 0],
  ' ': [0, 0, 0, 0, 0, 0, 0],
}

class Raster {
  constructor(width, height) {
    this.width = width
    this.height = height
    this.data = new Uint8Array(width * height * 4)
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = 255; this.data[i + 1] = 255; this.data[i + 2] = 255; this.data[i + 3] = 255
    }
  }
  px(x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const i = (y * this.width + x) * 4
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255
  }
  line(x0, y0, x1, y1, rgb, thick = 1) {
    const dx = x1 - x0
    const dy = y1 - y0
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1)
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + (dx * i) / steps)
      const y = Math.round(y0 + (dy * i) / steps)
      for (let t = 0; t < thick; t++) for (let u = 0; u < thick; u++) this.px(x + t, y + u, ...rgb)
    }
  }
  text(str, x, y, rgb, scale = 1) {
    let cx = x
    for (const ch of str) {
      const glyph = FONT[ch] || FONT[' ']
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row] & (0x10 >> col)) {
            for (let t = 0; t < scale; t++) for (let u = 0; u < scale; u++) {
              this.px(cx + col * scale + t, y + row * scale + u, ...rgb)
            }
          }
        }
      }
      cx += 6 * scale
    }
  }
  png() {
    const raw = new Uint8Array(this.height * (this.width * 4 + 1))
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 4 + 1)] = 0
      raw.set(this.data.subarray(y * this.width * 4, (y + 1) * this.width * 4), y * (this.width * 4 + 1) + 1)
    }
    const chunks = [
      pngChunk('IHDR', u32be(this.width), u32be(this.height), Uint8Array.of(8, 6, 0, 0, 0)),
      pngChunk('IDAT', deflateSync(Buffer.from(raw))),
      pngChunk('IEND'),
    ]
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks])
  }
}

function u32be(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, ...parts) {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))))
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])))
  return Buffer.concat([len, typeBuf, body, crc])
}

function niceStep(span, target) {
  const raw = span / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow
  return 10 * pow
}

function fmtTick(v) {
  if (Math.abs(v) < 1e-12) return '0'
  const a = Math.abs(v)
  if (a >= 100000 || a < 0.001) return v.toExponential(1).replace('e+', 'e')
  return String(parseFloat(v.toPrecision(4)))
}

function renderPlot(fn, opts) {
  const W = 1200
  const H = 800
  const L = 78
  const R = 24
  const T = 24
  const B = 54
  const iw = W - L - R
  const ih = H - T - B

  const N = 800
  const xs = new Array(N)
  const ys = new Array(N)
  for (let i = 0; i < N; i++) {
    const x = opts.xMin + ((opts.xMax - opts.xMin) * i) / (N - 1)
    let y
    try { y = fn(x) } catch { y = NaN }
    xs[i] = x
    ys[i] = typeof y === 'number' && Number.isFinite(y) ? y : NaN
  }

  let yMin = opts.yMin
  let yMax = opts.yMax
  if (yMin === undefined || yMax === undefined) {
    const finite = ys.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b)
    if (finite.length === 0) throw new Error('plot_function: expression produced no finite values over the x range')
    const lo = finite[Math.floor(finite.length * 0.02)]
    const hi = finite[Math.min(finite.length - 1, Math.ceil(finite.length * 0.98) - 1)]
    const pad = (hi - lo || 1) * 0.12
    yMin = yMin ?? lo - pad
    yMax = yMax ?? hi + pad
    if (yMax - yMin < 1e-9) { yMin -= 1; yMax += 1 }
  }

  const sx = (x) => L + ((x - opts.xMin) / (opts.xMax - opts.xMin)) * iw
  const sy = (y) => T + ih - ((y - yMin) / (yMax - yMin)) * ih

  const rast = new Raster(W, H)
  const GRID = [229, 231, 235]
  const AXIS = [107, 114, 128]
  const LABEL = [107, 114, 128]
  const CURVE = [37, 99, 235]

  const xStep = niceStep(opts.xMax - opts.xMin, 8)
  const yStep = niceStep(yMax - yMin, 6)
  for (let v = Math.ceil(opts.xMin / xStep) * xStep; v <= opts.xMax + 1e-9; v += xStep) {
    const px = Math.round(sx(v))
    rast.line(px, T, px, T + ih, GRID)
    rast.text(fmtTick(v), px - 14, T + ih + 10, LABEL)
  }
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) {
    const py = Math.round(sy(v))
    rast.line(L, py, L + iw, py, GRID)
    const label = fmtTick(v)
    rast.text(label, L - 12 - label.length * 6, py - 4, LABEL)
  }
  if (opts.xMin <= 0 && opts.xMax >= 0) rast.line(Math.round(sx(0)), T, Math.round(sx(0)), T + ih, AXIS, 2)
  if (yMin <= 0 && yMax >= 0) rast.line(L, Math.round(sy(0)), L + iw, Math.round(sy(0)), AXIS, 2)
  rast.line(L, T, L, T + ih, AXIS)
  rast.line(L, T + ih, L + iw, T + ih, AXIS)
  rast.text('x', L + iw - 8, T + ih + 10, LABEL)
  rast.text('y', L - 14, T - 2, LABEL)

  const jump = (yMax - yMin) * 2
  for (let i = 1; i < N; i++) {
    const y0 = ys[i - 1]
    const y1 = ys[i]
    if (Number.isNaN(y0) || Number.isNaN(y1)) continue
    if (Math.abs(y1 - y0) > jump) continue
    rast.line(sx(xs[i - 1]), sy(y0), sx(xs[i]), sy(y1), CURVE, 2)
  }
  return { png: rast.png(), width: W, height: H, yMin, yMax }
}

function makePlotFunctionTool(ctx) {
  return {
    name: 'plot_function',
    description:
      'Plot an exact 2D graph of a math function y = f(x) and return it as a PNG image shown inline. '
      + 'Use for function graphs, curves, and calculus visualizations (limits, derivatives, integrals, series, inequalities) where coordinate accuracy matters — never use diffusion image generation for these. '
      + 'Supports + - * / ^ ( ) and sin cos tan asin acos atan sinh cosh tanh sqrt abs exp ln log log2 log10 floor ceil round min max pow, plus pi and e; log means log10, ln means natural log. '
      + 'The PNG is also saved under dsh-images/ in the workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['expression'],
      properties: {
        expression: { type: 'string', description: 'y as a function of x, e.g. "sin(x)/x", "x^2 - 2*x", "exp(-x^2)".' },
        x_min: { type: 'number', description: 'Left edge of the x range; default -10.' },
        x_max: { type: 'number', description: 'Right edge of the x range; default 10.' },
        y_min: { type: 'number', description: 'Optional fixed bottom of the y range; auto-scaled (outlier-clipped) when omitted.' },
        y_max: { type: 'number', description: 'Optional fixed top of the y range.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'expression', 'image'],
        properties: {
          path: { type: 'string' },
          expression: { type: 'string' },
          xRange: { type: 'array', items: { type: 'number' } },
          yRange: { type: 'array', items: { type: 'number' } },
          image: {
            type: 'object',
            additionalProperties: false,
            required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
            properties: {
              attachmentId: { type: 'string' },
              mediaType: { type: 'string' },
              bytes: { type: 'integer' },
              width: { type: 'integer' },
              height: { type: 'integer' },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `<path>${value.path}</path>\n<content>plot of y = ${value.expression} over x in [${value.xRange[0]}, ${value.xRange[1]}], y in [${value.yRange[0].toPrecision(4)}, ${value.yRange[1].toPrecision(4)}]</content>\n<inline_markdown>![plot of y = ${value.expression}](http://127.0.0.1:3081/${value.path})</inline_markdown>\nCopy the <inline_markdown> line verbatim into your final message so the image renders inline.`,
        },
        {
          type: 'image',
          attachment: {
            attachmentId: value.image.attachmentId,
            mediaType: value.image.mediaType,
            bytes: value.image.bytes,
            width: value.image.width,
            height: value.image.height,
            ...(value.image.name === undefined ? {} : { name: value.image.name }),
          },
        },
      ],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const fn = compileExpression(args.expression)
      const opts = {
        xMin: args.x_min ?? -10,
        xMax: args.x_max ?? 10,
        yMin: args.y_min,
        yMax: args.y_max,
      }
      if (!(opts.xMax > opts.xMin)) throw new Error('plot_function: x_max must be greater than x_min')
      if (exec.signal.aborted) throw new Error('plot_function: cancelled')
      const plot = renderPlot(fn, opts)

      const fname = `plot-${Date.now()}.png`
      const rel = `dsh-images/${fname}`
      const target = await ctx.fs.resolve(`${WORKSPACE_ROOT}/${rel}`)
      const host = ctx.fs.processPath(target)
      await mkdir(dirname(host), { recursive: true })
      await writeFile(host, plot.png)

      const attachments = ctx.get('attachments')
      if (!attachments) throw new Error('plot_function: no attachment store mounted; plot saved at ' + rel)
      const [ref] = await attachments.saveImages([{ data: new Uint8Array(plot.png), mediaType: 'image/png', name: fname }])

      return {
        path: rel,
        expression: args.expression,
        xRange: [opts.xMin, opts.xMax],
        yRange: [plot.yMin, plot.yMax],
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          name: fname,
        },
      }
    },
  }
}
