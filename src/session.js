import { chromium, firefox, webkit, devices } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './analyze.js';
import { loadIgnores } from './store.js';
import { defaultSystem, loadSystem, componentSpec, checkCompliance, detectTheme } from './designsystem.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TRACKER = fs.readFileSync(path.join(here, 'inject/tracker.js'), 'utf8');
const AUDIT = fs.readFileSync(path.join(here, 'inject/audit.js'), 'utf8');
const STYLES = fs.readFileSync(path.join(here, 'inject/styles.js'), 'utf8');
const COMPONENTS = fs.readFileSync(path.join(here, 'inject/components.js'), 'utf8');
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const ENGINES = { chromium, firefox, webkit };
export const BROWSERS = Object.keys(ENGINES);
import { DATA_DIR } from './store.js';
export { DATA_DIR };

const DEVICES = {
  // viewport:null lets the page follow the real window size, so resizing the window reflows the site
  responsive: { viewport: null },
  desktop: { viewport: { width: 1440, height: 900 } },
  laptop: { viewport: { width: 1280, height: 720 } },
  tablet: { ...devices['iPad (gen 7)'] },
  mobile: { ...devices['iPhone 13'] },
};

const pageKeyOf = (u) => {
  try { const x = new URL(u); return (x.origin === 'null' ? x.protocol + '//' + x.host : x.origin) + x.pathname + (x.hash.startsWith('#/') ? x.hash : ''); } catch { return u; }
};

export class Session {
  constructor({ url, device = 'responsive', name, ignoreHTTPS = true, useChrome = true, width, height, browser = 'chromium', headless, kind = 'live', designSystem = null }) {
    this.id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 6);
    this.url = /^[a-z]+:\/\//i.test(url) ? url : 'http://' + url;
    this.name = name || this.url;
    const w = Math.round(+width), h = Math.round(+height);
    this.custom = device === 'custom' && w >= 240 && w <= 3840 && h >= 240 && h <= 2400 ? { width: w, height: h } : null;
    this.device = this.custom ? `custom ${w}×${h}` : DEVICES[device] ? device : 'responsive';
    this.ignoreHTTPS = ignoreHTTPS;
    this.browserName = ENGINES[browser] ? browser : 'chromium';
    this.useChrome = useChrome && this.browserName === 'chromium';
    this.headless = headless ?? process.env.UXA_HEADLESS === '1';
    this.kind = kind;
    // Every scan is checked against a design system: the one asked for, else the default (Echo UI).
    const dsId = designSystem?.id || defaultSystem()?.id || null;
    this.designSystem = dsId ? { id: String(dsId), brand: designSystem?.brand || null, mode: designSystem?.mode || null } : null;
    this._ds = dsId ? loadSystem(dsId) : null;
    this._dsSpec = this._ds ? componentSpec(this._ds) : null;
    this.status = 'starting';
    this.startedAt = Date.now();
    this.endedAt = null;
    this.events = [];
    this.audits = {};       // pageKey -> audit result
    this.shots = {};        // pageKey -> screenshot file name
    this.network = [];      // failed / slow requests
    this.console = [];      // console errors / warnings
    this.report = null;
    this.error = null;
    this.dir = path.join(DATA_DIR, this.id);
    fs.mkdirSync(this.dir, { recursive: true });
    this._auditTimers = new Map();
  }

  async start() {
    const headless = this.headless;
    const engine = ENGINES[this.browserName];
    const launchOpts = { headless, args: this.browserName !== 'chromium' ? [] : headless ? ['--window-size=1440,900'] : ['--start-maximized'] };
    try {
      this.browser = await engine.launch(this.useChrome ? { ...launchOpts, channel: 'chrome' } : launchOpts);
    } catch (e) {
      if (!this.useChrome) {
        const why = e.message.match(/\[err\] (?!\*)(.+)/)?.[1] || e.message.split('\n')[0];
        throw new Error(/Executable doesn't exist/.test(e.message) ? `${this.browserName} is not installed. Run: npx playwright install ${this.browserName}` : `${this.browserName} failed to start: ${why}`);
      }
      this.browser = await engine.launch(launchOpts);
    }
    this.browser.on('disconnected', () => { if (this.status === 'running') this.stop().catch(() => {}); });

    const d = { ...(this.custom ? { viewport: this.custom } : DEVICES[this.device]) };
    if (this.browserName === 'firefox') delete d.isMobile; // not supported by Firefox
    if (this.browserName !== 'chromium' && d.viewport === null && headless) d.viewport = { width: 1440, height: 900 };
    this.context = await this.browser.newContext({ ...d, ignoreHTTPSErrors: this.ignoreHTTPS, bypassCSP: true });
    await this.context.exposeBinding('__uxa_emit', ({ frame }, batch) => {
      if (frame !== frame.page().mainFrame()) return;
      for (const e of batch) this._onEvent(e, frame.page());
    });
    await this.context.addInitScript(TRACKER);
    this.context.on('page', (p) => this._attach(p));

    const page = await this.context.newPage();
    this.status = 'running';
    try {
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      this.console.push({ t: Date.now(), type: 'error', text: 'Navigation failed: ' + e.message.split('\n')[0], url: this.url });
    }
    return this;
  }

  _attach(page) {
    const reqStart = new Map();
    page.on('request', (r) => reqStart.set(r, Date.now()));
    page.on('requestfinished', async (r) => {
      const ms = Date.now() - (reqStart.get(r) || Date.now());
      reqStart.delete(r);
      const type = r.resourceType();
      let status = 0;
      try { status = (await r.response())?.status() || 0; } catch {}
      if (status >= 400 || (ms > 2000 && ['document', 'xhr', 'fetch', 'script', 'stylesheet'].includes(type)))
        this.network.push({ t: Date.now(), url: r.url().slice(0, 300), method: r.method(), status, ms, type, page: pageKeyOf(page.url()) });
    });
    page.on('requestfailed', (r) => {
      const err = r.failure()?.errorText || 'failed';
      if (/ERR_ABORTED/.test(err)) return;
      this.network.push({ t: Date.now(), url: r.url().slice(0, 300), method: r.method(), status: 0, error: err, type: r.resourceType(), page: pageKeyOf(page.url()) });
    });
    page.on('console', (m) => {
      if (['error', 'warning'].includes(m.type()) && this.console.length < 500)
        this.console.push({ t: Date.now(), type: m.type(), text: m.text().slice(0, 300), page: pageKeyOf(page.url()) });
    });
    page.on('load', () => this._scheduleAudit(page, 1500));
    page.on('dialog', (d) => this._onEvent({ type: 'native_dialog', t: Date.now(), kind: d.type(), message: d.message().slice(0, 200), page: pageKeyOf(page.url()) }, page));
  }

  _onEvent(e, page) {
    if (!['running', 'analyzing'].includes(this.status) || this.events.length > 200000) return;
    this.events.push(e);
    if (e.type === 'pageview' && page) this._scheduleAudit(page, 1800);
  }

  _scheduleAudit(page, delay) {
    clearTimeout(this._auditTimers.get(page));
    this._auditTimers.set(page, setTimeout(() => this._audit(page).catch(() => {}), delay));
  }

  async _audit(page, force = false) {
    if (page.isClosed() || this.status !== 'running') return;
    const key = pageKeyOf(page.url());
    if (!/^https?:|^file:/.test(page.url())) return;
    const result = await page.evaluate(`(${AUDIT})()`);
    result.axe = await this._axe(page);
    try { result.styles = await page.evaluate(`(${STYLES})()`); } catch { result.styles = null; }
    if (this._dsSpec) try { result.components = await page.evaluate(`(${COMPONENTS})(${JSON.stringify(this._dsSpec)})`); } catch { result.components = null; }
    const prev = this.audits[key];
    // keep the richest snapshot of each page (most interactive elements), or a forced one
    if (!force && prev && prev.counts.interactive > result.counts.interactive) return;
    result.capturedAt = Date.now();
    this._lastAuditAt = Date.now();
    this.audits[key] = result;
    const file = 'shot-' + Object.keys(this.audits).indexOf(key) + '.jpg';
    const maxH = 9000;
    const clip = result.viewport.docH > maxH ? { x: 0, y: 0, width: result.viewport.w, height: maxH } : undefined;
    try {
      await page.screenshot({ path: path.join(this.dir, file), type: 'jpeg', quality: 60, fullPage: true, clip, timeout: 15000, animations: 'disabled', caret: 'hide' });
      this.shots[key] = { file, w: result.viewport.w, h: Math.min(result.viewport.docH, maxH) };
    } catch {}
  }

  // Industry-standard accessibility engine (Deque axe-core), WCAG 2.2 A/AA + best practices.
  async _axe(page) {
    try {
      const has = await page.evaluate(() => typeof window.axe !== 'undefined');
      if (!has) await page.evaluate(AXE);
      const run = page.evaluate(async () => {
        const r = await window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
          rules: { region: { enabled: false }, 'target-size': { enabled: false } },
          resultTypes: ['violations'],
        });
        return r.violations.map((v) => ({
          id: v.id, impact: v.impact, help: v.help, description: v.description, helpUrl: v.helpUrl,
          tags: v.tags, count: v.nodes.length,
          nodes: v.nodes.slice(0, 15).map((n) => {
            let el = null;
            try { el = document.querySelector(n.target[0]); } catch {}
            const rc = el?.getBoundingClientRect();
            return {
              target: n.target.join(' '), html: n.html.slice(0, 160), summary: (n.failureSummary || '').slice(0, 260),
              rect: rc && rc.width ? { x: Math.round(rc.left + scrollX), y: Math.round(rc.top + scrollY), w: Math.round(rc.width), h: Math.round(rc.height) } : null,
            };
          }),
        }));
      });
      return await Promise.race([run, new Promise((r) => setTimeout(() => r(null), 25000))]);
    } catch {
      return null;
    }
  }

  async snapshotNow() {
    const pages = this.context?.pages() || [];
    const p = pages[pages.length - 1];
    if (p) await this._audit(p, true);
  }

  live() {
    const c = (t) => this.events.filter((e) => e.type === t).length;
    return {
      id: this.id, name: this.name, url: this.url, device: this.device, browser: this.browserName, kind: this.kind, status: this.status, error: this.error,
      startedAt: this.startedAt, endedAt: this.endedAt,
      duration: ((this.endedAt || Date.now()) - this.startedAt) / 1000,
      pages: new Set(this.events.filter((e) => e.type === 'pageview').map((e) => e.page)).size,
      audited: Object.keys(this.audits).length,
      clicks: c('click'), rage: c('rage_click'), dead: c('dead_click'), errors: c('js_error') + this.console.filter((x) => x.type === 'error').length,
      failedRequests: this.network.filter((n) => n.status === 0 || n.status >= 400).length,
      recent: this.events.filter((e) => e.type !== 'move' && e.type !== 'vitals').slice(-12).reverse(),
      design: this._liveDesign(),
    };
  }

  // Running design-system compliance, recomputed from pages audited so far (cached per audit).
  _liveDesign() {
    if (!this._ds) return null;
    const n = Object.keys(this.audits).length;
    if (this._liveCache && this._liveCache.n === n && this._liveCache.at >= this._lastAuditAt) return this._liveCache.v;
    let v = { system: this._ds.name, pending: true };
    if (n) {
      try {
        const ds = this._resolvedDs();
        const c = checkCompliance(this.audits, this._ds, ds);
        const C = c.components;
        v = { system: this._ds.name, brand: c.brand, mode: c.mode, auto: !this.designSystem.brand, score: c.score, total: C.total, fromDs: C.fromDs, confirmed: C.confirmed, custom: C.custom, coverage: C.coverage, counts: C.counts,
          kinds: C.kinds.slice(0, 12).map((k) => ({ kind: k.kind, total: k.total, ds: k.total - k.custom, custom: k.custom })),
          recentCustom: C.items.filter((x) => !x.fromDs).slice(0, 6).map((x) => ({ kind: x.kind, text: x.text, why: x.problems.slice(0, 2).join(' · ') })) };
      } catch (e) { v = { system: this._ds.name, error: e.message }; }
    }
    this._liveCache = { n, at: Date.now(), v };
    return v;
  }

  // brand/mode: as chosen, else detected from the page itself
  _resolvedDs() {
    const d = { ...this.designSystem };
    if ((!d.brand || !d.mode) && Object.keys(this.audits).length) {
      const t = detectTheme(this.audits, this._ds);
      d.brand = d.brand || t.brand; d.mode = d.mode || t.mode; d.autoDetected = true;
    }
    return d;
  }

  async stop() {
    if (this.status !== 'running') return this.report;
    this.status = 'analyzing';
    try {
      for (const p of this.context?.pages() || []) {
        // audit any open page that hasn't been audited yet (fast pages / short scans)
        const key = pageKeyOf(p.url());
        if (!this.audits[key] && !p.isClosed()) {
          this.status = 'running';
          try { await this._audit(p, true); } catch {}
          this.status = 'analyzing';
        }
        try { await p.evaluate(() => window.dispatchEvent(new Event('pagehide'))); } catch {}
      }
      await new Promise((r) => setTimeout(r, 300));
    } catch {}
    this.endedAt = Date.now();
    this.status = 'stopping';
    for (const t of this._auditTimers.values()) clearTimeout(t);
    try { await this.browser?.close(); } catch {}
    try {
      if (this.designSystem) this.designSystem = this._resolvedDs();
      this.report = analyze(this, { ignored: loadIgnores(this.url), designSystem: this.designSystem });
      this.status = 'done';
    } catch (e) {
      this.status = 'failed';
      this.error = e.stack;
    }
    this.save();
    return this.report;
  }

  save() {
    const out = {
      meta: { id: this.id, name: this.name, url: this.url, device: this.device, browser: this.browserName, kind: this.kind, designSystem: this.designSystem, startedAt: this.startedAt, endedAt: this.endedAt, status: this.status },
      report: this.report, shots: this.shots,
    };
    fs.writeFileSync(path.join(this.dir, 'report.json'), JSON.stringify(out));
    fs.writeFileSync(path.join(this.dir, 'raw.json'), JSON.stringify({ events: this.events, audits: this.audits, network: this.network, console: this.console }));
  }
}
