// Minimal static server exposing /root/workspace/dsh-images on 127.0.0.1:3081.
// Reached by the user's browser only through the SSH tunnel (-L 3081:127.0.0.1:3081),
// so generated images can be embedded inline in dsh chat messages as markdown.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'

const ROOT = '/root/workspace'

createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '')
  if (!rel || rel.includes('..')) {
    res.writeHead(400).end('bad path')
    return
  }
  try {
    const buf = await readFile(join(ROOT, rel))
    res.writeHead(200, {
      'Content-Type': rel.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    res.end(buf)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(3081, '127.0.0.1')
