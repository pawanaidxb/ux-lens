import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session, DATA_DIR, BROWSERS } from './session.js';
import { listSaved, combine, reanalyze, setIgnore, loadReport, history } from './store.js';
import { listSystems, importSystem, deleteSystem, loadSystem } from './designsystem.js';
import { chromium, firefox, webkit } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const PORT = +process.env.PORT || 4321;
const live = new Map();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 8e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const safeId = (id) => /^[\w-]+$/.test(id);

// Probe each engine once in the background: installed AND actually launchable.
const engines = { chromium, firefox, webkit };
const available = Object.fromEntries(Object.keys(engines).map((n) => [n, { installed: false, ok: n === 'chromium', reason: '' }]));
for (const [n, e] of Object.entries(engines)) {
  try { available[n].installed = fs.existsSync(e.executablePath()); } catch {}
  if (!available[n].installed) { available[n].reason = `Not installed. Run: npx playwright install ${n}`; continue; }
  e.launch({ headless: true, timeout: 20000 }).then((b) => { available[n].ok = true; return b.close(); })
    .catch((err) => { available[n].ok = false; available[n].reason = 'Fails to start on this computer: ' + (err.message.match(/\[err\] (?!\*)(.+)/)?.[1] || err.message.split('\n')[0]); });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] === 'api' && parts[1] === 'browsers') return send(res, 200, BROWSERS.map((b) => ({ id: b, ...available[b] })));
    if (parts[0] === 'api' && parts[1] === 'design-systems') {
      if (req.method === 'GET' && !parts[2]) return send(res, 200, listSystems());
      if (req.method === 'GET') { const d = loadSystem(parts[2]); return d ? send(res, 200, d) : send(res, 404, { error: 'not found' }); }
      if (req.method === 'POST') { const b = await body(req); try { return send(res, 201, importSystem(b.tokens, b.name)); } catch (e) { return send(res, 400, { error: e.message }); } }
      if (req.method === 'DELETE') { try { deleteSystem(parts[2]); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message }); } }
    }
    if (parts[0] === 'api' && parts[1] === 'combine' && req.method === 'POST') {
      const b = await body(req);
      return send(res, 201, { id: combine(b.ids || [], b.name) });
    }
    if (parts[0] === 'api' && parts[1] === 'sessions') {
      const id = parts[2];
      if (!id && req.method === 'GET') {
        const running = [...live.values()].filter((s) => s.status !== 'done').map((s) => s.live());
        const saved = listSaved().filter((s) => !running.some((r) => r.id === s.id));
        return send(res, 200, [...running, ...saved].sort((a, b) => b.startedAt - a.startedAt));
      }
      if (!id && req.method === 'POST') {
        const b = await body(req);
        if (!b.url) return send(res, 400, { error: 'url is required' });
        const s = new Session(b);
        live.set(s.id, s);
        s.start().catch((e) => { s.status = 'failed'; s.error = e.message; });
        return send(res, 201, { id: s.id });
      }
      if (!safeId(id)) return send(res, 400, { error: 'bad id' });
      const s = live.get(id);
      if (parts[3] === 'stop' && req.method === 'POST') {
        if (!s) return send(res, 404, { error: 'not running' });
        await s.stop();
        return send(res, 200, { ok: true, status: s.status, error: s.error });
      }
      if (parts[3] === 'snapshot' && req.method === 'POST') {
        if (!s || s.status !== 'running') return send(res, 404, { error: 'not running' });
        await s.snapshotNow();
        return send(res, 200, { ok: true, audited: Object.keys(s.audits).length });
      }
      if (parts[3] === 'ignore' && req.method === 'POST') {
        const b = await body(req), rep = loadReport(id);
        if (!rep) return send(res, 404, { error: 'not found' });
        const f = rep.report.findings.find((x) => x.key === b.key) || rep.report.ignored?.find((x) => x.key === b.key) || { key: b.key, title: b.title };
        setIgnore(rep.meta.url, f, b.on !== false, b.reason);
        return send(res, 200, reanalyze(id));
      }
      if (parts[3] === 'design-system' && req.method === 'POST') {
        const b = await body(req);
        if (!loadReport(id)) return send(res, 404, { error: 'not found' });
        return send(res, 200, reanalyze(id, { designSystem: b.id ? { id: b.id, brand: b.brand || null, mode: b.mode || 'light' } : null }));
      }
      if (parts[3] === 'history') {
        const rep = loadReport(id);
        return send(res, 200, rep ? history(rep.meta.url) : []);
      }
      if (req.method === 'DELETE') {
        if (s && s.status === 'running') return send(res, 409, { error: 'stop it first' });
        live.delete(id);
        fs.rmSync(path.join(DATA_DIR, id), { recursive: true, force: true });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET') {
        if (s && s.status !== 'done') return send(res, 200, { live: s.live() });
        const f = path.join(DATA_DIR, id, 'report.json');
        if (!fs.existsSync(f)) return send(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': 'application/json' });
        return fs.createReadStream(f).pipe(res);
      }
    }

    // screenshots
    if (parts[0] === 'data' && parts.length === 3 && safeId(parts[1]) && /^[\w.-]+\.jpg$/.test(parts[2])) {
      const f = path.join(DATA_DIR, parts[1], parts[2]);
      if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' }); return fs.createReadStream(f).pipe(res); }
    }

    // static
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`UX Analytics running → http://localhost:${PORT}`));

const shutdown = async () => { for (const s of live.values()) if (s.status === 'running') await s.stop().catch(() => {}); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
