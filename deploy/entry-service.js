// Password-gated entry sidecar for dsh behind nginx auth_basic.
// GET /entry -> read the current boot token from the dsh-web journal and 302
// the browser to /?token=..., letting dsh set its session cookie under the
// browser's own UA (the trust fence refuses non-browser UAs).
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'

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
      res.writeHead(302, { Location: '/' + matches[matches.length - 1] })
      res.end()
    },
  )
}).listen(3082, '127.0.0.1')
