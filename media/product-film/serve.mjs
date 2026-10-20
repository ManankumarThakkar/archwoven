import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = process.env.FILM_OUTPUT || '/private/tmp/archwoven-landing-film-output';
const port = Number(process.env.PORT || 3147);
const files = new Map([
  ['/', ['media/product-film/index.html', 'text/html; charset=utf-8']],
  ['/film.mjs', ['media/product-film/film.mjs', 'text/javascript; charset=utf-8']],
  ['/theme.css', ['apps/web/app/globals.css', 'text/css; charset=utf-8']],
  ['/recordings.json', ['media/product-film/recordings.json', 'application/json']],
  ...['400', '600'].map(weight => [`/apps/web/public/fonts/inter-${weight}.woff2`, [`apps/web/public/fonts/inter-${weight}.woff2`, 'font/woff2']]),
]);
createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const artifact = /^\/output\/(archwoven-film\.mp4|poster\.jpg|keyframe-[0-6]\.jpg)$/.exec(pathname);
  const entry = files.get(pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  if (!entry && !artifact) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const file = artifact ? resolve(output, artifact[1]) : resolve(root, entry[0]);
    const body = await readFile(file);
    const type = artifact ? (file.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg') : entry[1];
    const headers = { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
    if (type === 'video/mp4') {
      headers['Accept-Ranges'] = 'bytes';
      if (req.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        let start = Number(range?.[1] || 0), end = Number(range?.[2] || body.length - 1);
        if (range && !range[1] && range[2]) { start = Math.max(0, body.length - Number(range[2])); end = body.length - 1; }
        if (!range || (!range[1] && !range[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= body.length || end < start) {
          res.writeHead(416, { ...headers, 'Content-Length': 0, 'Content-Range': `bytes */${body.length}` }); res.end(); return;
        }
        end = Math.min(end, body.length - 1);
        res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${body.length}` });
        res.end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1)); return;
      }
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Artifact not rendered yet'); }
}).listen(port, '127.0.0.1', () => console.log(`Film preview: http://127.0.0.1:${port}`));
