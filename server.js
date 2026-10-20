import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const port = process.env.PORT ?? 3000;

// Fixed allowlist of static files, loaded once at startup. Request paths are only used as
// map keys and never reach the filesystem.
const asset = (name, type) => ({ body: readFileSync(new URL(`./public/${name}`, import.meta.url)), type });
const routes = new Map([
  ['/', asset('index.html', 'text/html; charset=utf-8')],
  ['/index.html', asset('index.html', 'text/html; charset=utf-8')],
  ['/game.js', asset('game.js', 'text/javascript; charset=utf-8')],
  ['/style.css', asset('style.css', 'text/css; charset=utf-8')],
]);

createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0];
  const route = routes.get(pathname);
  if (!route) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': route.type, 'cache-control': 'no-cache' });
  res.end(route.body);
}).listen(port, () => console.log(`poker-game listening on ${port}`));
