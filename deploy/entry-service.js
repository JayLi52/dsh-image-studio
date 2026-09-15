// Password-gated entry sidecar for dsh behind nginx auth_basic.
// GET /entry -> expire every stale dsh-auth-* cookie the browser still carries
// (cookie names rotate on every dsh-web boot and dsh refuses requests that
// present an invalid one alongside the valid one), then 302 the browser to
// /?token=... so dsh issues a fresh session cookie under the browser's UA
// (the trust fence refuses non-browser UAs).
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'

const EPOCH = 'Thu, 01 Jan 1970 00:00:00 GMT'

createServer((req, res) => {
  if (!req.url || !req.url.startsWith('/entry')) {
    res.writeHead(404).end('not found')
    return
  }
  execFile(
    'journalctl',
    ['-u', 'dsh-web', '-n', '300', '--no-pager', '-o', 'cat'],
    { maxBuffer: 64 * 1024 * 1024 },
    (err, out) => {
      const matches = out && out.match(/\?token=[A-Za-z0-9_-]+/g)
      if (err || !matches || matches.length === 0) {
        res.writeHead(500).end('no boot token in journal')
        return
      }
      const headers = { Location: '/' + matches[matches.length - 1] }
      const raw = req.headers.cookie || ''
      const stale = raw
        .split(';')
        .map((pair) => pair.trim().split('=')[0])
        .filter((name) => name && name.startsWith('dsh-auth-'))
      if (stale.length > 0) {
        headers['Set-Cookie'] = stale.map((name) => `${name}=; Path=/; Expires=${EPOCH}; Max-Age=0`)
      }
      res.writeHead(302, headers)
      res.end()
    },
  )
}).listen(3082, '127.0.0.1')
