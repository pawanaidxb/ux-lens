import { scoreBars, partBar, matrix, bullet, hbars, line, dumbbell, bindTips } from './charts.js';
import { diffReports } from './diff.js';
import { CAT_PLAIN, SEV_PLAIN, EFFORT, GLOSSARY, plainFinding, verdict, status, termsFor } from './plain.js';
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (p, opts = {}) => {
  const r = await fetch('/api' + p, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const scoreColor = (s) => (s == null ? 'var(--muted)' : s >= 80 ? 'var(--good)' : s >= 60 ? 'var(--ok)' : 'var(--bad)');
const fmtDur = (s) => (s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);
const fmtDate = (t) => new Date(t).toLocaleString();
let pollTimer;

window.addEventListener('hashchange', route);
route();

function route() {
  clearInterval(pollTimer);
  const [, view, id] = location.hash.split('/');
  if (view === 's' && id) return sessionView(id);
  if (view === 'compare' && id) return compareView(id, location.hash.split('/')[3]);
  return home();
}

// ======================================================================
// HOME
// ======================================================================
async function home() {
  $app.innerHTML = `
  <section class="launch">
    <h1 class="display">Point the lens at any page.</h1>
    <p class="lead">Open a site, use it the way your users would, and get a plain-language report on what helped and what got in the way.</p>
    <form id="start">
      <div class="scope">
        <span class="br tl"></span><span class="br tr"></span><span class="br bl"></span><span class="br br2"></span>
        <label class="sr" for="url">Website address</label>
        <input id="url" type="text" required placeholder="https://intranet.company.local/app  or  localhost:3000" autocomplete="url" />
        <button class="primary" type="submit" id="go">Start scan</button>
        <span class="scanline" aria-hidden="true"></span>
      </div>
      <div class="opts">
        <div class="opt grow">
          <label class="f" for="name">Session name <span class="muted">(optional)</span></label>
          <input id="name" type="text" placeholder="For example: checkout, first-time user" />
        </div>
        <div class="opt">
          <label class="f" for="device">Screen size</label>
          <select id="device">
            <option value="responsive" selected>Responsive (fits window)</option>
            <option value="desktop">Desktop 1440×900</option><option value="laptop">Laptop 1280×720</option>
            <option value="tablet">Tablet (iPad)</option><option value="mobile">Mobile (iPhone 13)</option>
            <option value="custom">Custom size…</option>
          </select>
        </div>
        <div class="opt">
          <label class="f" for="browser">Browser engine</label>
          <select id="browser"><option value="chromium">Chrome / Edge (Chromium)</option><option value="firefox">Firefox</option><option value="webkit">Safari (WebKit)</option></select>
        </div>
        <div class="opt custom" id="customSize" hidden>
          <label class="f" for="cw">Width × height (px)</label>
          <div class="wh"><input id="cw" type="number" min="240" max="3840" value="1366" aria-label="Width in pixels" /><span aria-hidden="true">×</span><input id="ch" type="number" min="240" max="2400" value="768" aria-label="Height in pixels" /></div>
        </div>
      </div>
      <div class="checks">
        <label class="check"><input type="checkbox" id="https" checked /> Allow self-signed intranet certificates</label>
        <label class="check"><input type="checkbox" id="chrome" checked /> Use my installed Chrome (for company sign-in)</label>
      </div>
      <p id="err" class="b" role="alert"></p>
      <p class="dsnote muted small" id="dsnote"></p>
    </form>
    <ol class="steps">
      <li><b>Start a scan.</b> A browser window opens on your page.</li>
      <li><b>Use the site.</b> Sign in, click around, fill forms, as a real user would.</li>
      <li><b>Stop and read.</b> Every page you visited is checked against UX principles.</li>
    </ol>
  </section>
  <section class="panel sessions">
    <div class="sec-h"><h2>Past scans</h2></div>
    <div id="list"><p class="muted">Loading…</p></div>
  </section>`;

  const dev = document.getElementById('device'), cs = document.getElementById('customSize');
  dev.onchange = () => (cs.hidden = dev.value !== 'custom');
  const br = document.getElementById('browser'), chromeBox = document.getElementById('chrome').closest('label');
  br.onchange = () => (chromeBox.hidden = br.value !== 'chromium');
  api('/browsers').then((list) => list.forEach((b) => { const o = br.querySelector(`[value=${b.id}]`); if (o && !b.ok && b.id !== 'chromium') { o.disabled = true; o.textContent += b.installed ? ' (unavailable)' : ' (not installed)'; o.title = b.reason; } })).catch(() => {});
  api('/design-systems').then((l) => { const d = l.find((x) => x.isDefault) || l[0]; if (d) document.getElementById('dsnote').innerHTML = `Every scan also checks <b>${esc(d.name)}</b> compliance: which components come from the design system and which are custom-built. The brand and colour mode are detected from the page.`; }).catch(() => {});
  document.getElementById('start').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('go');
    btn.disabled = true; btn.textContent = 'Opening browser…';
    try {
      const { id } = await api('/sessions', { method: 'POST', body: { url: url.value.trim(), name: document.getElementById('name').value.trim(), device: device.value, browser: document.getElementById('browser').value,  width: +cw.value, height: +ch.value, ignoreHTTPS: https.checked, useChrome: chrome.checked } });
      location.hash = '#/s/' + id;
    } catch (er) {
      document.getElementById('err').textContent = er.message;
      btn.disabled = false; btn.textContent = 'Start scan';
    }
  });
  loadList();
}

async function loadList() {
  const el = document.getElementById('list');
  const list = await api('/sessions');
  if (!list.length) { el.innerHTML = '<p class="empty">No scans yet. Enter an address above to run your first one.</p>'; return; }
  const KIND = { ci: 'CI', combined: 'Combined' };
  el.innerHTML = `
  <div class="selbar" id="selbar" hidden>
    <span id="selcount"></span>
    <button id="cmpBtn" class="primary">Compare before and after</button>
    <button id="mixBtn">Combine testers into one report</button>
    <button id="clrBtn" class="ghost">Clear</button>
  </div>
  <table><thead><tr><th><span class="sr">Select</span></th><th>Scan</th><th>Score</th><th>Issues</th><th>Screen</th><th>Started</th><th><span class="sr">Actions</span></th></tr></thead><tbody>
  ${list.map((s) => { const done = s.score != null; const tot = (s.critical || 0) + (s.major || 0) + (s.minor || 0); return `<tr class="click" data-id="${s.id}">
    <td>${done ? `<input type="checkbox" class="pick" value="${s.id}" aria-label="Select ${esc(s.name)}">` : ''}</td>
    <td><b>${esc(s.name)}</b> ${KIND[s.kind] ? `<span class="kind">${KIND[s.kind]}</span>` : ''}<div class="muted small">${esc(s.url)}</div></td>
    <td>${done ? `<span class="mini" style="--v:${s.score};--c:${scoreColor(s.score)}"><b>${s.score}</b></span>` : `<span class="pill status-${s.status === 'running' ? 'running' : s.status === 'failed' ? 'failed' : 'done'}">${esc(s.status)}</span>`}</td>
    <td>${done && tot ? `<span class="issuebar" title="${s.critical} blockers, ${s.major} frustrating, ${s.minor} polish" role="img" aria-label="${s.critical} blockers, ${s.major} frustrating, ${s.minor} polish">${['critical', 'major', 'minor'].map((k) => (s[k] ? `<i class="${k}" style="flex:${s[k]}"></i>` : '')).join('')}</span><span class="small muted">${tot}</span>` : done ? '<span class="g small">none</span>' : '—'}</td>
    <td class="small">${esc(s.device)}${s.browser && s.browser !== 'chromium' ? `<div class="muted">${esc(s.browser)}</div>` : ''}</td>
    <td class="small">${fmtDate(s.startedAt)}</td>
    <td><button class="danger small" data-del="${s.id}" aria-label="Delete scan ${esc(s.name)}">Delete</button></td></tr>`; }).join('')}
  </tbody></table>`;
  const picks = () => [...el.querySelectorAll('.pick:checked')].map((c) => c.value);
  const sync = () => {
    const n = picks().length;
    document.getElementById('selbar').hidden = !n;
    document.getElementById('selcount').textContent = `${n} selected`;
    document.getElementById('cmpBtn').disabled = n !== 2;
    document.getElementById('cmpBtn').title = n === 2 ? '' : 'Select exactly two scans';
    document.getElementById('mixBtn').disabled = n < 2;
  };
  el.querySelectorAll('.pick').forEach((c) => { c.onclick = (e) => e.stopPropagation(); c.onchange = sync; });
  document.getElementById('clrBtn').onclick = () => { el.querySelectorAll('.pick').forEach((c) => (c.checked = false)); sync(); };
  document.getElementById('cmpBtn').onclick = () => { const [a, b] = picks(); location.hash = `#/compare/${a}/${b}`; };
  document.getElementById('mixBtn').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Combining…';
    try { const { id } = await api('/combine', { method: 'POST', body: { ids: picks() } }); location.hash = '#/s/' + id; } catch (er) { alert(er.message); e.target.disabled = false; }
  };
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.dataset.del && !e.target.classList.contains('pick')) location.hash = '#/s/' + tr.dataset.id; }));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async (e) => { e.stopPropagation(); if (confirm('Delete this scan and its report?')) { await api('/sessions/' + b.dataset.del, { method: 'DELETE' }).catch((er) => alert(er.message)); loadList(); } }));
}

// ======================================================================
// SESSION (live or report)
// ======================================================================
async function sessionView(id) {
  let data;
  try { data = await api('/sessions/' + id); } catch (e) { $app.innerHTML = `<div class="panel empty">${esc(e.message)} — <a href="#/">back</a></div>`; return; }
  if (data.live) return liveView(id, data.live);
  reportView(id, data);
}

const DS_COLORS = { library: 'var(--series-1)', 'library-modified': 'var(--series-3)', tokens: 'var(--series-4)', matches: 'color-mix(in srgb, var(--series-1) 45%, var(--wire))', custom: 'var(--series-2)' };
const DS_LABELS = { library: 'From the design system', 'library-modified': 'Design system, overridden', tokens: 'Built with tokens', matches: 'Matches spec (unconfirmed)', custom: 'Custom-built' };
function liveDesign(d) {
  if (!d) return '';
  if (d.pending || d.error) return `<section class="panel live-ds"><h2>${esc(d.system || 'Design system')} compliance</h2><p class="muted">${d.error ? esc(d.error) : 'Waiting for the first page to finish loading…'}</p></section>`;
  const k = Math.max(1, ...d.kinds.map((x) => x.total));
  return `<section class="panel live-ds">
    <div class="sec-h"><h2>${esc(d.system)} compliance <span class="muted small">live</span></h2><span class="muted small">${esc(d.brand || '')} · ${d.mode === 'dark' ? 'Dark' : 'Light'}${d.auto ? ' (detected)' : ''}</span></div>
    <div class="live-ds-top">
      <div class="big-num"><b>${d.fromDs}<span>/${d.total}</span></b><span>components from the design system</span></div>
      <div class="big-num"><b class="${d.custom ? 'b' : 'g'}">${d.custom}</b><span>custom-built</span></div>
      <div class="big-num"><b>${d.score}%</b><span>overall compliance</span></div>
    </div>
    ${partBar(Object.keys(DS_LABELS).map((key) => ({ label: DS_LABELS[key], value: d.counts[key] || 0, color: DS_COLORS[key] })), { total: d.total, unit: 'components' })}
    <div class="lk">${d.kinds.map((x) => `<div class="lk-row"><span>${esc(x.kind)}</span><span class="lk-bar"><i style="width:${(x.ds / k) * 100}%;background:var(--series-1)"></i><i style="width:${(x.custom / k) * 100}%;background:var(--series-2)"></i></span><span class="small">${x.ds}<span class="muted"> / ${x.total}</span></span></div>`).join('')}</div>
    ${d.recentCustom.length ? `<h3 style="margin-top:14px">Custom-built so far</h3><ul class="lk-list">${d.recentCustom.map((c) => `<li><b>${esc(c.kind)}</b> “${esc(c.text || '')}” <span class="muted small">${esc(c.why || 'not from the design system')}</span></li>`).join('')}</ul>` : ''}
  </section>`;
}
function liveView(id, s) {
  const render = (s) => {
    if (s.status === 'done') return sessionView(id);
    $app.innerHTML = `
    <div class="panel stack">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>
          <h1>${s.status === 'running' ? '<span class="live-dot" aria-hidden="true"></span> ' : ''}Recording: ${esc(s.name)}</h1>
          <div class="muted">${esc(s.url)} · ${esc(s.device)} · ${fmtDur(s.duration)}</div>
        </div>
        <div class="row">
          ${s.status === 'running' ? `<button id="snap" title="Re-audit the page that's currently open (e.g. after opening a modal)">📸 Audit current page</button><button class="primary" id="stop">■ Stop &amp; analyse</button>` : `<span class="pill status-${s.status === 'failed' ? 'failed' : 'running'}">${esc(s.status)}</span>`}
        </div>
      </div>
      ${s.error ? `<pre class="b small" style="white-space:pre-wrap">${esc(s.error)}</pre>` : ''}
      <p class="muted">Switch to the browser window that opened and use the site as your target user would. Come back here and press <b>Stop &amp; analyse</b> when done. Closing the browser window also stops the session.</p>
      <div class="live-grid">
        <div class="mini-stats wide live-stats">
          ${[['Pages', s.pages], ['Pages checked', s.audited], ['Clicks', s.clicks], ['Repeat clicks', s.rage], ['No-response clicks', s.dead], ['Errors', s.errors]].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}
        </div>
        ${liveDesign(s.design)}
      </div>
      <div><h3>Live event feed</h3><div class="feed">${s.recent.map((e) => `<div>${new Date(e.t).toLocaleTimeString()} · <b>${esc(e.type)}</b> ${esc(e.text || e.field || e.title || e.message || e.page || '')}</div>`).join('') || '<div class="muted">Waiting for interactions…</div>'}</div></div>
    </div>`;
    document.getElementById('stop')?.addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = 'Analysing…';
      clearInterval(pollTimer);
      try { await api(`/sessions/${id}/stop`, { method: 'POST' }); } catch (er) { alert(er.message); }
      sessionView(id);
    });
    document.getElementById('snap')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      await api(`/sessions/${id}/snapshot`, { method: 'POST' }).catch(() => {});
      e.target.disabled = false;
    });
  };
  render(s);
  pollTimer = setInterval(async () => {
    try { const d = await api('/sessions/' + id); if (!d.live) { clearInterval(pollTimer); return sessionView(id); } if (!document.querySelector('#stop:disabled')) render(d.live); } catch {}
  }, 1500);
}

// ======================================================================
// REPORT
// ======================================================================
function reportView(id, { meta, report: r }) {
  if (!r) { $app.innerHTML = `<div class="panel empty">This session has no report (${esc(meta.status)}). <a href="#/">Back</a></div>`; return; }
  const S = r.summary;
  const tabs = [['overview', 'Summary'], ['findings', `Issues to fix <span class="count">${S.findings}</span>`], ['design', 'Design system'], ['pages', 'Page heatmaps'], ['behavior', 'User behaviour'], ['perf', 'Speed'], ['tech', 'Technical log'], ['glossary', 'UX glossary']];
  $app.innerHTML = `
  <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:16px">
    <div><a href="#/" class="small">← All sessions</a><h1>${esc(meta.name)}</h1><div class="muted small">${esc(meta.url)} · ${esc(meta.device)} · ${fmtDate(meta.startedAt)} · ${fmtDur(S.duration)}</div></div>
    <div class="row"><button id="print">Print / PDF</button><a class="btn" href="/api/sessions/${id}" download="ux-report-${id}.json">Export JSON</a></div>
  </div>
  <div class="tabs" role="tablist">${tabs.map(([k, l], i) => `<button role="tab" aria-selected="${i === 0}" data-tab="${k}">${l}</button>`).join('')}</div>
  <div id="pane"></div>`;
  document.getElementById('print').onclick = () => window.print();
  const pane = document.getElementById('pane');
  const show = (k, opts) => {
    document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === k));
    pane.innerHTML = '';
    ({ overview, findings, design, pages, behavior, perf, tech, glossary })[k](pane, r, id, opts, show);
    pane.querySelectorAll('[data-term]').forEach((t) => {
      const go = (e) => { e.stopPropagation(); show('glossary', { term: t.dataset.term }); };
      t.onclick = go; t.onkeydown = (e) => e.key === 'Enter' && go(e);
    });
    window.scrollTo({ top: 0 });
  };
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab)));
  show('overview');
}

const sevPill = (s) => `<span class="pill sev-${s}" title="${esc(SEV_PLAIN[s].desc)} (UX severity: ${s})">${SEV_PLAIN[s].label}</span>`;
const termChip = (t) => { const g = GLOSSARY.find(([n]) => n === t); return `<span class="term" role="button" tabindex="0" data-term="${esc(t)}" data-tip="${esc(g?.[2] || '')}">${esc(t)}</span>`; };
const termChips = (text) => termsFor(text).map(termChip).join('');
const cleanTitle = (f) => { const t = f.title.replace(/\s+(on|—)\s+\S*\/\S*\s*(\([^)]*\))?$/, '').replace(/\(([^)]*)\)$/, (m, x) => (/\//.test(x) ? '' : m)).trim(); return t.replace(/^\d+ (\w)/, (m) => m); };
const pageTag = (f) => (f.page ? `<span class="pgtag" title="${esc(f.page)}">📄 ${esc(shortPage(f.page))}</span>` : '');
const shortPage = (k) => { try { const u = new URL(k); const parts = (u.pathname + u.hash).split('/').filter(Boolean); return parts.length ? (parts.length > 2 ? '…/' : '/') + parts.slice(-2).join('/') : '/'; } catch { return k; } };
function reticle(score) {
  const R = 84, C = 2 * Math.PI * R, col = scoreColor(score);
  const ticks = Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * 2 * Math.PI - Math.PI / 2, r1 = i % 5 ? 96 : 92; return `<line x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + 100 * Math.cos(a)}" y2="${100 + 100 * Math.sin(a)}" class="${i / 60 * 100 < score ? 'on' : ''}"/>`; }).join('');
  return `<div class="reticle" role="img" aria-label="UX score ${score} out of 100" style="--c:${col}">
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <g class="ticks">${ticks}</g>
      <circle cx="100" cy="100" r="${R}" class="track"/>
      <circle cx="100" cy="100" r="${R}" class="arc" style="--len:${C};--off:${C * (1 - score / 100)}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - score / 100)}" transform="rotate(-90 100 100)"/>
      <circle cx="100" cy="100" r="62" class="inner"/>
    </svg>
    <div class="ret-v"><b>${score}</b><span>out of 100</span></div>
  </div>`;
}
const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms');

const IMPACT = { critical: 3, major: 2, minor: 1 };
const EFF_N = { quick: 1, medium: 2, large: 3 };
const SERIES = { ok: 'var(--series-1)', dead: 'var(--series-2)', rage: 'var(--series-4)', err: 'var(--series-3)' };

function overview(el, r, id, _, show) {
  const S = r.summary, B = r.behavior, P = r.performance;
  const v = verdict(S.score);
  const top = r.findings.slice(0, 3);
  const okClicks = Math.max(0, B.clicks - B.dead - B.rage - B.errorClicks);

  const story = [];
  story.push(`${S.testers > 1 ? `${S.testers} testers spent` : 'You spent'} <b>${fmtDur(S.duration)}</b> on <b>${S.pages} page${S.pages === 1 ? '' : 's'}</b>${S.hasBehaviour ? ` and made <b>${B.clicks} click${B.clicks === 1 ? '' : 's'}</b>` : ''}.`);
  if (S.hasBehaviour) story.push(B.frustrationRate ? `<b>${B.frustrationRate}%</b> of those clicks went wrong.` : 'Every click got a response.');
  else story.push('<span class="o">No clicks were recorded, so only the page design was checked.</span>');

  const cats = [...r.categories].sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
  const matrixItems = r.findings.map((f) => { const p = plainFinding(f); return { id: f.id, title: cleanTitle(f), severity: f.severity, impact: IMPACT[f.severity], effort: EFF_N[p.effort], label: `${SEV_PLAIN[f.severity].label} · ${EFFORT[p.effort]}` }; });
  const quickWins = r.findings.filter((f) => f.severity !== 'minor' && plainFinding(f).effort === 'quick').length;
  const sevCounts = ['critical', 'major', 'minor'].map((s) => ({ s, n: S[s] }));

  el.innerHTML = `
  <section class="dash-top">
    <div class="hero panel">
      ${reticle(S.score)}
      <div class="hero-text">
        <div class="hero-k">Overall experience${S.testers > 1 ? ` · combined from ${S.testers} testers` : ''}</div>
        <div class="verdict ${v.cls}">${v.word}</div>
        <p class="lead">${v.line}</p>
        <p class="story">${story.join(' ')}</p>
        <div class="sevrow">${sevCounts.map(({ s, n }) => `<button class="sevchip ${s}" data-sevjump="${s}"><b>${n}</b> ${SEV_PLAIN[s].label.toLowerCase()}${s === 'critical' && n !== 1 ? 's' : ''}</button>`).join('')}</div>
      </div>
    </div>
    <div class="panel trend">
      <div class="sec-h"><h2>Score over time</h2><span class="muted small">Scans of this site</span></div>
      <div id="trend"><p class="muted small">Loading…</p></div>
    </div>
  </section>

  <div class="dash-grid">
    <section class="panel">
      <div class="sec-h"><h2>Where the experience is weakest</h2><span class="muted small">Dashed line marks a good score (80). Select a bar to see its issues.</span></div>
      ${scoreBars(cats.map((c) => ({ key: c.key, label: CAT_PLAIN[c.key].q, icon: CAT_PLAIN[c.key].icon, sub: c.name + ' · ' + c.principle, score: c.score, issues: c.counts.critical + c.counts.major + c.counts.minor })))}
    </section>

    <section class="panel">
      <div class="sec-h"><h2>What to fix first</h2><span class="muted small">${quickWins ? `<b>${quickWins}</b> quick win${quickWins === 1 ? '' : 's'} in the highlighted area` : 'Each dot is one issue'}</span></div>
      ${r.findings.length ? matrix(matrixItems) : '<p class="g big">No issues found</p>'}
      <div class="legend"><span><span class="sw" style="background:var(--crit)"></span>Blocker</span><span><span class="sw" style="background:var(--major)"></span>Frustrating</span><span><span class="sw" style="background:var(--minor)"></span>Polish</span><span class="muted">Select a dot to open the issue</span></div>
    </section>

    <section class="panel">
      <div class="sec-h"><h2>How clicks turned out</h2><span class="muted small">${B.clicks} click${B.clicks === 1 ? '' : 's'} recorded</span></div>
      ${partBar([
        { label: 'Worked', value: okClicks, color: SERIES.ok, note: 'The page responded' },
        { label: 'Nothing happened', value: B.dead, color: SERIES.dead, note: 'Dead click: no visible response within 1 s' },
        { label: 'Clicked again in frustration', value: B.rage, color: SERIES.rage, note: 'Rage click: 3+ rapid clicks on one spot' },
        { label: 'Caused an error', value: B.errorClicks, color: SERIES.err, note: 'A JavaScript error followed the click' },
      ], { total: B.clicks })}
      <div class="mini-stats">
        <div><b>${B.medianScroll}%</b><span>of the page scrolled (median)</span></div>
        <div><b>${B.hesitations}</b><span>uncertain pause${B.hesitations === 1 ? '' : 's'}</span></div>
        <div><b>${B.validationErrors}</b><span>form error${B.validationErrors === 1 ? '' : 's'}</span></div>
      </div>
    </section>

    <section class="panel">
      <div class="sec-h"><h2>Speed and stability</h2><span class="muted small">Measured in your session</span></div>
      <div class="buls">
        ${bullet({ label: 'LCP', plain: 'Main content appears', value: P.lcp, good: 2500, poor: 4000, max: 6000, fmt: (x) => (x < 1000 ? Math.round(x) + ' ms' : (x / 1000).toFixed(1) + ' s') })}
        ${bullet({ label: 'INP', plain: 'Reaction to clicks', value: P.inp, good: 200, poor: 500, max: 800, unit: ' ms' })}
        ${bullet({ label: 'CLS', plain: 'Page jumpiness', value: P.cls, good: 0.1, poor: 0.25, max: 0.4, fmt: (x) => (+x).toFixed(2) })}
        ${bullet({ label: 'TTFB', plain: 'Server response', value: P.ttfb, good: 800, poor: 1800, max: 2600, unit: ' ms' })}
      </div>
    </section>
  </div>

  ${r.compliance && !r.compliance.unavailable ? (() => { const K = r.compliance.components; return `
  <section class="panel ds-sum">
    <div class="sec-h"><h2>Design system: ${esc(r.compliance.system.name)}</h2><button class="link" id="toDs">Open component inventory</button></div>
    <div class="ds-sum-grid">
      <div class="big-num"><b>${K.fromDs}<span>/${K.total}</span></b><span>components from the design system</span></div>
      <div class="big-num"><b class="${K.custom ? 'b' : 'g'}">${K.custom}</b><span>custom-built components</span></div>
      <div class="big-num"><b>${r.compliance.score}%</b><span>token compliance${r.compliance.brand ? ` · ${esc(r.compliance.brand)} ${r.compliance.mode}` : ''}</span></div>
      <div class="ds-sum-bar">${partBar(Object.keys(DS_LABELS).map((k) => ({ label: DS_LABELS[k], value: K.counts[k] || 0, color: DS_COLORS[k] })), { total: K.total, unit: 'components' })}</div>
    </div>
  </section>`; })() : ''}

  <section class="panel">
    <div class="sec-h"><h2>Top 3 fixes</h2>${r.findings.length > 3 ? `<button class="link" id="allf">See all ${r.findings.length} issues</button>` : ''}</div>
    ${top.length ? `<ol class="toplist">${top.map((f) => { const p = plainFinding(f); return `
      <li class="tl ${f.severity}">
        <div class="tl-h">${sevPill(f.severity)}<span class="effort">${EFFORT[p.effort]}</span>${f.testers ? `<span class="effort">👥 ${f.testers}/${S.testers} testers</span>` : ''}${pageTag(f)}</div>
        <h3>${esc(cleanTitle(f))}</h3>
        <p>${esc(p.plain)} <span class="ff-fix"><b>Fix:</b> ${esc(f.fix)}</span></p>
        <div class="terms">${termChips(f.principle + ' ' + f.title)}</div>
      </li>`; }).join('')}</ol>` : '<p class="g big">No issues found</p>'}
  </section>

  <details class="panel expert">
    <summary><b>For UX practitioners:</b> Nielsen’s 10 heuristics, principle scores and engines</summary>
    <div class="grid g2" style="margin-top:14px;align-items:start">
      <table><thead><tr><th colspan="2">Nielsen heuristic ${termChip('Nielsen’s heuristics')}</th><th style="text-align:right">Issues</th></tr></thead><tbody>${r.nielsen.map((n) => `<tr><td class="muted" style="width:28px">#${n.n}</td><td>${esc(n.name)}</td><td style="text-align:right">${n.issues ? `${sevPill(n.worst)} ${n.issues}` : '<span class="g">✓</span>'}</td></tr>`).join('')}</tbody></table>
      <div>
        <table><thead><tr><th>Category</th><th>Principle basis</th><th style="text-align:right">Score</th></tr></thead><tbody>${r.categories.map((c) => `<tr><td>${esc(c.name)}</td><td class="small muted">${esc(c.principle)}</td><td style="text-align:right;font-weight:700">${c.score ?? 'n/a'}</td></tr>`).join('')}</tbody></table>
        <p class="small muted" style="margin-top:12px">Accessibility checks: ${r.engines?.axe ? '<b>axe-core</b> (Deque, WCAG 2.2 A/AA) plus UX Lens rules' : 'UX Lens rules only'}. ${r.ignored?.length ? `${r.ignored.length} issue${r.ignored.length === 1 ? '' : 's'} marked as not a problem.` : ''}</p>
      </div>
    </div>
  </details>`;

  bindTips(el);
  el.querySelectorAll('[data-cat]').forEach((c) => (c.onclick = () => show('findings', { category: c.dataset.cat })));
  el.querySelectorAll('[data-sevjump]').forEach((c) => (c.onclick = () => show('findings', { severity: c.dataset.sevjump })));
  el.querySelectorAll('[data-fid]').forEach((d) => { const go = () => show('findings', { focus: +d.dataset.fid }); d.onclick = go; d.onkeydown = (e) => e.key === 'Enter' && go(); });
  document.getElementById('allf')?.addEventListener('click', () => show('findings'));
  document.getElementById('toDs')?.addEventListener('click', () => show('design'));
  api(`/sessions/${id}/history`).then((h) => { const t = document.getElementById('trend'); if (t) { t.innerHTML = line(h, { current: id, width: 340, height: 190 }); bindTips(t); } }).catch(() => {});
}

function findings(el, r, id, opts = {}, show) {
  const pages = [...new Set(r.findings.map((f) => f.page).filter(Boolean))];
  const cnt = (s) => r.findings.filter((f) => f.severity === s).length;
  el.innerHTML = `
  <div class="sevlegend">
    ${['critical', 'major', 'minor'].map((s) => `<button class="sl ${s}" data-sev="${s}" aria-pressed="false"><b>${cnt(s)}</b> ${SEV_PLAIN[s].label}<span>${SEV_PLAIN[s].desc}</span></button>`).join('')}
  </div>
  <div class="filters">
    <select id="fc" aria-label="Filter by area"><option value="">All areas</option>${r.categories.map((c) => `<option value="${c.key}" ${opts.category === c.key ? 'selected' : ''}>${CAT_PLAIN[c.key].icon} ${esc(CAT_PLAIN[c.key].q)}</option>`).join('')}</select>
    <select id="fp" aria-label="Filter by page"><option value="">All pages</option>${pages.map((p) => `<option value="${esc(p)}">${esc(shortPath(p))}</option>`).join('')}</select>
    <select id="fe" aria-label="Filter by effort"><option value="">Any effort</option>${Object.entries(EFFORT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <span id="fcount" class="muted small" style="align-self:center"></span>
  </div>
  <div id="flist" class="stack"></div>`;
  let sev = opts.severity || '';
  el.querySelectorAll('[data-sev]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.sev === sev));
  el.querySelectorAll('[data-sev]').forEach((b) => (b.onclick = () => {
    sev = sev === b.dataset.sev ? '' : b.dataset.sev;
    el.querySelectorAll('[data-sev]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.sev === sev));
    draw();
  }));
  const draw = () => {
    const c = fc.value, p = fp.value, e = fe.value;
    const list = r.findings.filter((f) => (!c || f.category === c) && (!sev || f.severity === sev) && (!p || f.page === p) && (!e || plainFinding(f).effort === e));
    fcount.textContent = `${list.length} issue${list.length === 1 ? '' : 's'}`;
    flist.innerHTML = list.map((f) => { const pl = plainFinding(f); return `
      <article class="finding ${f.severity}" id="f-${f.id}">
        <div class="h">${sevPill(f.severity)}<span class="t">${esc(cleanTitle(f))}</span>${f.source === 'axe' ? '<span class="srcbadge" title="Found by axe-core, the industry-standard accessibility engine">axe</span>' : ''}${f.testers ? `<span class="effort">👥 ${f.testers}/${r.summary.testers} testers</span>` : ''}${pageTag(f)}<span class="effort">${EFFORT[pl.effort]}</span></div>
        <p class="plain">${esc(pl.plain)}</p>
        <div class="fix"><b>How to fix:</b> ${esc(f.fix)}</div>
        <div class="terms">${CAT_PLAIN[f.category].icon} <span class="muted small">${esc(CAT_PLAIN[f.category].q)}</span> ${termChips(f.principle + ' ' + f.title)}</div>
        <details><summary class="small">UX &amp; technical detail</summary>
          <div class="small" style="margin-top:6px"><b>Principle:</b> <span class="pr">${esc(f.principle)}</span></div>
          <div class="small" style="margin-top:4px">${esc(f.detail)}</div>
          ${f.page ? `<div class="small muted" style="margin-top:4px">Page: ${esc(shortPath(f.page))}</div>` : ''}
          ${f.evidence?.length ? `<ul class="small">${f.evidence.map((e) => `<li><code>${esc(e.selector)}</code> ${esc(e.text || '')}</li>`).join('')}</ul>` : ''}
          ${f.helpUrl ? `<a class="small" href="${esc(f.helpUrl)}" target="_blank" rel="noopener">Rule guide with code examples (opens in a new tab)</a>` : ''}
        </details>
        <div class="f-actions"><button class="ghost small" data-ignore="${esc(f.key)}" title="Hide this issue for this site in future scans and re-score">Not a problem</button></div>
      </article>`; }).join('') || '<p class="empty">No issues match these filters.</p>';
    flist.querySelectorAll('[data-term]').forEach((t) => { const go = () => show('glossary', { term: t.dataset.term }); t.onclick = go; t.onkeydown = (e) => e.key === 'Enter' && go(); });
  };
  [fc, fp, fe].forEach((x) => (x.onchange = draw));
  draw();
  if (opts.focus) { const t = document.getElementById('f-' + opts.focus); if (t) { t.classList.add('flash'); t.querySelector('details').open = true; setTimeout(() => t.scrollIntoView({ block: 'center' }), 30); } }
  flist.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ignore]');
    if (!b) return;
    const reason = prompt('Mark as not a problem for this site? It will be hidden from this and future scans, and the score recalculated.\n\nReason (optional):', 'False positive');
    if (reason === null) return;
    b.disabled = true;
    await api(`/sessions/${id}/ignore`, { method: 'POST', body: { key: b.dataset.ignore, on: true, reason } });
    route();
  });
  if (r.ignored?.length) {
    const box = document.createElement('details');
    box.className = 'panel ignored';
    box.innerHTML = `<summary>${r.ignored.length} issue${r.ignored.length === 1 ? '' : 's'} marked as not a problem</summary><ul>${r.ignored.map((f) => `<li>${sevPill(f.severity)} ${esc(cleanTitle(f))} <button class="ghost small" data-restore="${esc(f.key)}">Restore</button></li>`).join('')}</ul>`;
    el.appendChild(box);
    box.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = async () => { b.disabled = true; await api(`/sessions/${id}/ignore`, { method: 'POST', body: { key: b.dataset.restore, on: false } }); route(); }));
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
function glossary(el, r, id, opts = {}) {
  const used = new Set(r.findings.flatMap((f) => termsFor(f.principle + ' ' + f.title)));
  const sorted = [...GLOSSARY].sort((a, b) => (used.has(b[0]) - used.has(a[0])) || a[0].localeCompare(b[0]));
  el.innerHTML = `
  <section class="panel">
    <h2>UX glossary</h2>
    <p class="muted">The UX terms used in this report, explained in plain words. Terms that apply to this report are listed first.</p>
    <div class="gloss">${sorted.map(([t, , d, ex]) => `
      <div class="gl ${used.has(t) ? 'used' : ''}" id="term-${slug(t)}">
        <div class="gl-t">${esc(t)} ${used.has(t) ? '<span class="pill sev-info">in this report</span>' : ''}</div>
        <div>${esc(d)}</div>${ex ? `<div class="small muted" style="margin-top:4px">e.g. ${esc(ex)}</div>` : ''}
      </div>`).join('')}</div>
  </section>`;
  if (opts.term) { const t = document.getElementById('term-' + slug(opts.term)); if (t) { t.classList.add('flash'); setTimeout(() => t.scrollIntoView({ block: 'center' }), 30); } }
}

// ======================================================================
// DESIGN SYSTEM COMPLIANCE tab
// ======================================================================
const DS_STATUS = {
  ok: ['Token', 'var(--good)', 'Matches a semantic token'],
  primitive: ['Raw palette value', 'var(--minor)', 'Matches a primitive colour. Use the semantic token instead.'],
  near: ['Close, not exact', 'var(--major)', 'Within a small difference of a token. Probably a hard-coded copy.'],
  'wrong-mode': ['Other colour mode', 'var(--major)', 'This value belongs to the other colour mode'],
  'other-brand': ['Another brand', 'var(--crit)', 'This colour belongs to a different brand theme'],
  off: ['Off-palette', 'var(--crit)', 'No token is close to this colour'],
};
async function design(el, r, id, opts, show) {
  const C = r.compliance;
  const systems = await api('/design-systems').catch(() => []);
  if (!C || C.unavailable) {
    el.innerHTML = `<section class="panel dsempty"><h2>No design-system data for this scan</h2><p class="muted">This scan was recorded before design-system checks were added. Run a new scan to see which components come from ${esc(systems.find((d) => d.isDefault)?.name || 'the design system')}.</p></section>`;
    return;
  }
  const K = C.components;
  const cats = [...C.categories].sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
  const colorGroups = Object.keys(DS_STATUS).map((k) => ({ k, n: C.colors.filter((c) => c.status === k).reduce((s, c) => s + c.n, 0) }));
  const top = cats.filter((c) => c.key !== 'components' && c.offenders.length).flatMap((c) => c.offenders.slice(0, 3).map((o) => ({ ...o, cat: c }))).sort((a, b) => b.n - a.n).slice(0, 6);
  const v = K.coverage >= 90 ? ['Built from the design system', 'g'] : K.coverage >= 70 ? ['Mostly design system', 'g'] : K.coverage >= 40 ? ['Partly design system', 'o'] : ['Mostly custom-built', 'b'];
  const kmax = Math.max(1, ...K.kinds.map((k) => k.total));
  const brandSel = C.brands.length ? `<select id="dsxBrand" aria-label="Brand">${C.brands.map((b) => `<option ${b === C.brand ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>` : '';

  el.innerHTML = `
  <section class="dash-top">
    <div class="hero panel">
      ${reticle(K.coverage ?? 0)}
      <div class="hero-text">
        <div class="hero-k">Components from ${esc(C.system.name)}</div>
        <div class="verdict ${v[1]}">${v[0]}</div>
        <p class="lead"><b>${K.fromDs}</b> of <b>${K.total}</b> components on ${C.pages.length} page${C.pages.length === 1 ? '' : 's'} come from the design system. <b class="${K.custom ? 'b' : 'g'}">${K.custom}</b> ${K.custom === 1 ? 'is' : 'are'} custom-built.</p>
        <p class="story">${K.markerFound ? `<b>${K.confirmed}</b> confirmed by a library marker (tag, attribute or class).` : '<span class="o">No library markers (like <code>echo-</code> classes or <code>data-echo</code> attributes) were found, so matches are based on the component specs and token variables.</span>'} Overall token compliance is <b>${C.score}%</b>.</p>
      </div>
    </div>
    <div class="panel">
      <form class="dspick" id="dspick">
        <label class="f">Checked against</label>
        <select id="dsx" aria-label="Design system">${systems.map((d) => `<option value="${esc(d.id)}" ${C.system.id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
        ${brandSel}
        <select id="dsxMode" aria-label="Colour mode"><option value="light" ${C.mode !== 'dark' ? 'selected' : ''}>Light</option><option value="dark" ${C.mode === 'dark' ? 'selected' : ''}>Dark</option></select>
        <button type="submit">Re-check</button>
      </form>
      <p class="muted small" style="margin-top:10px">${C.autoDetected ? `Brand and mode were detected from the page (${esc(C.brand || '')}, ${C.mode}). ` : ''}Change them to see how this page would score against another theme.</p>
      <div class="mini-stats" style="grid-template-columns:repeat(2,1fr)">${Object.keys(DS_LABELS).map((k) => `<div><b style="color:${DS_COLORS[k]}">${K.counts[k] || 0}</b><span>${DS_LABELS[k]}</span></div>`).join('')}</div>
    </div>
  </section>

  <div class="dash-grid">
    <section class="panel">
      <div class="sec-h"><h2>Components by type</h2><span class="muted small">Design system vs custom-built</span></div>
      <div class="ktbl">${K.kinds.map((k) => `
        <div class="kt-row" tabindex="0" data-tip="<b>${esc(k.kind)}</b>${k.figma ? ` · Figma ${esc(k.figma)}` : ''}<br>${Object.keys(DS_LABELS).filter((x) => k[x]).map((x) => `${DS_LABELS[x]}: ${k[x]}`).join('<br>')}">
          <span class="kt-l">${esc(k.kind)}${k.inSystem ? '' : ' <span class="muted small">(no spec)</span>'}</span>
          <span class="kt-bar">${Object.keys(DS_LABELS).map((x) => (k[x] ? `<i style="flex:${k[x]} 0 0;background:${DS_COLORS[x]}"></i>` : '')).join('')}<i style="flex:${kmax - k.total} 0 0;background:transparent"></i></span>
          <span class="kt-v ${k.coverage >= 80 ? 'g' : k.coverage >= 50 ? 'o' : 'b'}">${k.coverage}%</span>
        </div>`).join('')}</div>
      <div class="legend">${Object.keys(DS_LABELS).map((x) => `<span><span class="sw" style="background:${DS_COLORS[x]}"></span>${DS_LABELS[x]}</span>`).join('')}</div>
    </section>
    <section class="panel">
      <div class="sec-h"><h2>Token compliance</h2><span class="muted small">Share of style values that match a token</span></div>
      ${scoreBars(cats.map((c) => ({ key: 'ds-' + c.key, label: c.name, icon: c.icon, sub: c.key === 'components' ? `${c.ok} of ${c.checked} components from the design system` : `${c.ok} of ${c.checked} uses on-system · ${c.distinctOff} off-system value${c.distinctOff === 1 ? '' : 's'}`, score: c.score, issues: c.distinctOff })))}
    </section>
  </div>

  <section class="panel">
    <div class="sec-h"><h2>Component inventory</h2>
      <div class="filters" style="margin:0">
        <select id="kf" aria-label="Filter by status"><option value="">All ${K.total} components</option>${Object.keys(DS_LABELS).filter((k) => K.counts[k]).map((k) => `<option value="${k}">${DS_LABELS[k]} (${K.counts[k]})</option>`).join('')}</select>
        <select id="kk" aria-label="Filter by type"><option value="">All types</option>${K.kinds.map((k) => `<option>${esc(k.kind)}</option>`).join('')}</select>
      </div>
    </div>
    <table class="inv"><thead><tr><th>Component</th><th>Source</th><th>How we know</th><th>Differs from spec</th></tr></thead><tbody id="invb"></tbody></table>
  </section>

  <div class="dash-grid">
    <section class="panel">
      <div class="sec-h"><h2>Colour usage</h2><span class="muted small">${C.colors.length} distinct colours</span></div>
      ${partBar(colorGroups.map((g) => ({ label: DS_STATUS[g.k][0], value: g.n, color: DS_STATUS[g.k][1], note: DS_STATUS[g.k][2] })), { unit: 'uses' })}
      <div class="swatches">${C.colors.slice(0, 40).map((c) => `<span class="swt ${c.status}" tabindex="0" data-tip="<b>${c.hex}</b> · used ${c.n}×<br>${esc(DS_STATUS[c.status][0])}${c.token ? `<br>Closest: ${esc(c.token)} ${c.tokenHex}${c.de ? ` (difference ${c.de})` : ''}` : ''}"><i style="background:${c.hex}"></i>${c.status !== 'ok' && c.tokenHex ? `<i style="background:${c.tokenHex}" class="tk"></i>` : ''}</span>`).join('')}</div>
    </section>
    <section class="panel">
      <div class="sec-h"><h2>Spacing used vs the scale</h2><span class="muted small">Blue is on the scale</span></div>
      ${distChart(C.distributions.spacing, C.tokens.spacing, 'px')}
    </section>
    <section class="panel">
      <div class="sec-h"><h2>Font sizes used vs the type scale</h2><span class="muted small">Blue is a type-scale size</span></div>
      ${distChart(C.distributions.type, C.tokens.type.map((t) => t.size), 'px', (x) => x.role)}
      <p class="muted small">${C.tokens.fonts.length ? `System font: <b>${esc(C.tokens.fonts.join(', '))}</b>.` : ''} ${(() => { const t = C.categories.find((c) => c.key === 'typography'); const f = t.offenders.filter((o) => o.kind === 'font'); return f.length ? `<span class="b">Also found: ${f.map((o) => esc(o.value)).join(', ')}.</span>` : ''; })()}</p>
    </section>
    <section class="panel">
      <div class="sec-h"><h2>Biggest token drifts</h2><button class="link" id="dsAll">See all as issues</button></div>
      ${top.length ? `<table class="drift"><tbody>${top.map((o) => `<tr><td>${o.cat.icon}</td><td>${o.cat.key === 'color' ? `<span class="chip"><i style="background:${esc(o.value)}"></i>${esc(o.value)}</span>` : `<b>${esc(o.value)}</b> <span class="muted small">${esc(o.kind)}</span>`}</td><td class="small">→ ${esc(o.expected)}</td><td style="text-align:right">${o.n}×</td></tr>`).join('')}</tbody></table>` : '<p class="g">No token drift found.</p>'}
    </section>
  </div>`;

  const body = document.getElementById('invb');
  const draw = () => {
    const f = document.getElementById('kf').value, t = document.getElementById('kk').value;
    const list = K.items.filter((x) => (!f || x.status === f) && (!t || x.kind === t));
    body.innerHTML = list.map((x) => `<tr>
      <td><b>${esc(x.kind)}</b> ${x.text ? `<span class="muted">“${esc(x.text.slice(0, 40))}”</span>` : ''}<div class="small muted"><code>${esc(x.sel)}</code>${C.pages.length > 1 ? ` · ${esc(shortPath(x.page))}` : ''}</div></td>
      <td><span class="srcpill" style="--c:${DS_COLORS[x.status]}">${DS_LABELS[x.status]}</span></td>
      <td class="small">${x.marker ? `Library ${esc(x.marker.how)} <code>${esc(x.marker.value)}</code>` : x.vars ? 'Uses design-token variables' : x.problems.length ? 'No library marker' : 'Size, corners, font and colours match'}</td>
      <td class="small">${x.problems.length ? x.problems.map((p) => `<div>• ${esc(p)}</div>`).join('') : '<span class="g">Matches</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No components match these filters.</td></tr>';
  };
  document.getElementById('kf').onchange = draw; document.getElementById('kk').onchange = draw;
  if (opts?.status) document.getElementById('kf').value = opts.status;
  draw();
  bindTips(el);
  const f = document.getElementById('dspick');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = f.querySelector('button'); b.disabled = true; b.textContent = 'Checking…';
    await api(`/sessions/${id}/design-system`, { method: 'POST', body: { id: f.querySelector('#dsx').value, brand: f.querySelector('#dsxBrand')?.value, mode: f.querySelector('#dsxMode').value } });
    sessionView(id).then(() => setTimeout(() => document.querySelector('[data-tab=design]')?.click(), 50));
  };
  document.getElementById('dsAll')?.addEventListener('click', () => show('findings', { category: 'design' }));
  el.querySelectorAll('.sb-row').forEach((b) => (b.onclick = () => show('findings', { category: 'design' })));
}

function distChart(rows, tokens, unit, label) {
  if (!rows.length) return '<p class="muted small">No values found.</p>';
  const max = Math.max(...rows.map((r) => r.n));
  const offN = rows.filter((r) => !r.ok).reduce((s, r) => s + r.n, 0), all = rows.reduce((s, r) => s + r.n, 0);
  return `<div class="dist" role="img" aria-label="${rows.length} distinct values; ${rows.filter((r) => !r.ok).length} are off the scale">
    ${rows.slice(0, 32).map((r) => `<span class="dcol ${r.ok ? 'on' : 'off'}" tabindex="0" data-tip="<b>${r.v}${unit}</b> · used ${r.n}×<br>${r.ok ? `On the scale${label && label(r) ? ' · ' + esc(label(r)) : ''}` : `Off the scale · nearest token ${tokens.length ? tokens.reduce((b, x) => (Math.abs(x - r.v) < Math.abs(b - r.v) ? x : b), tokens[0]) + unit : 'n/a'}`}">
      <i style="height:${Math.max(4, (r.n / max) * 100)}%"></i><b>${r.v}</b></span>`).join('')}
  </div>
  <div class="legend"><span><span class="sw" style="background:var(--series-1)"></span>On the scale</span><span><span class="sw" style="background:var(--series-2)"></span>Off the scale</span><span class="muted">${Math.round((offN / Math.max(all, 1)) * 100)}% of uses are off the scale</span></div>`;
}

function pages(el, r, id) {
  if (!r.pages.length) { el.innerHTML = '<p class="empty">No pages captured.</p>'; return; }
  el.innerHTML = `
  <div class="grid" style="grid-template-columns:minmax(260px,320px) 1fr;align-items:start">
    <section class="panel"><h2>Pages</h2><table><tbody>${r.pages.map((p, i) => `<tr class="click" data-i="${i}"><td><b>${esc(p.title || p.path)}</b><div class="small muted">${esc(p.path)}</div><div class="small">${p.clicks} clicks · ${p.rage} rage · ${p.dead} dead · ${p.maxScroll}% scroll · ${fmtDur(p.timeSpent)}</div></td></tr>`).join('')}</tbody></table></section>
    <section class="panel" id="pv"></section>
  </div>`;
  const view = (i) => {
    const p = r.pages[i];
    el.querySelectorAll('tr[data-i]').forEach((t) => (t.style.outline = t.dataset.i == i ? '2px solid var(--accent)' : ''));
    const pv = document.getElementById('pv');
    const pf = r.findings.filter((f) => f.page === p.key);
    pv.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center"><div><h2 style="margin:0">${esc(p.title || p.path)}</h2><div class="small muted">${esc(p.key)}</div></div>
      <div class="filters" style="margin:0">
        <label class="check"><input type="checkbox" id="lh" checked> Click heatmap</label>
        <label class="check"><input type="checkbox" id="lm"> Mouse attention</label>
        <label class="check"><input type="checkbox" id="lk" checked> Issue markers</label>
      </div></div>
      <p class="hint">💡 <b>How to read this:</b> warm/red areas are where people clicked most. <b style="color:#e03131">Red dots</b> are frustrated repeat clicks, <b style="color:#f08c00">orange dots</b> are clicks that did nothing. The dashed line shows how far down the page people scrolled — anything below it went unseen. Boxes mark areas with design issues.</p>
      <div class="legend" style="margin:8px 0"><span><span class="sw" style="background:#e03131"></span>Rage click</span><span><span class="sw" style="background:#f08c00"></span>Dead click</span><span><span class="sw" style="background:#1c7ed6"></span>Click</span><span><span class="sw" style="border:2px solid var(--crit)"></span>Issue area</span><span class="muted">Scroll reached: ${p.maxScroll}%</span></div>
      ${p.shot ? `<div class="heat-wrap"><div style="position:relative"><img src="/data/${p.shot.file.includes('/') ? p.shot.file : id + '/' + p.shot.file}" alt="Screenshot of ${esc(p.path)}" /><canvas></canvas><div class="marks"></div></div></div>` : '<p class="empty">No screenshot available for this page (it may not have finished loading before navigation).</p>'}
      <h3 style="margin-top:16px">${pf.length} finding(s) on this page</h3>
      ${pf.map((f) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">${sevPill(f.severity)} ${esc(f.title)}</div>`).join('') || '<p class="g">None</p>'}`;
    if (!p.shot) return;
    const img = pv.querySelector('img'), canvas = pv.querySelector('canvas'), marks = pv.querySelector('.marks');
    const draw = () => {
      const W = p.shot.w, H = p.shot.h;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      if (document.getElementById('lm').checked) heat(ctx, W, H, p.heat.moves.map(([x, y]) => ({ x, y })), 40, [124, 58, 237]);
      if (document.getElementById('lh').checked) {
        heat(ctx, W, H, p.heat.clicks.map((c) => ({ x: c.x * (W / (c.docW || W)), y: c.y })), 28, null);
        for (const c of p.heat.clicks) { ctx.beginPath(); ctx.arc(c.x * (W / (c.docW || W)), c.y, 5, 0, 7); ctx.fillStyle = c.kind === 'rage' ? '#e03131' : c.kind === 'dead' ? '#f08c00' : '#1c7ed6'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); }
      }
      // scroll-reach line
      if (p.maxScroll && p.maxScroll < 100) { const y = (p.maxScroll / 100) * (p.audit?.viewport?.docH || H); ctx.setLineDash([8, 6]); ctx.strokeStyle = '#e03131'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#e03131'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(`User scrolled to here (${p.maxScroll}%)`, 10, y - 6); }
      marks.innerHTML = document.getElementById('lk').checked ? p.markers.filter((m) => m.y < H).map((m) => `<div class="${m.sev}" title="${esc(m.label)}" style="left:${(m.x / W) * 100}%;top:${(m.y / H) * 100}%;width:${(m.w / W) * 100}%;height:${(m.h / H) * 100}%"></div>`).join('') : '';
    };
    img.complete ? draw() : (img.onload = draw);
    ['lh', 'lm', 'lk'].forEach((k) => (document.getElementById(k).onchange = draw));
  };
  el.querySelectorAll('tr[data-i]').forEach((t) => (t.onclick = () => view(+t.dataset.i)));
  view(0);
}

// simple density heatmap
function heat(ctx, W, H, pts, radius, rgb) {
  if (!pts.length) return;
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const o = off.getContext('2d');
  for (const p of pts) {
    const g = o.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = g; o.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
  }
  const img = o.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (!a) continue;
    let r, g, b;
    if (rgb) [r, g, b] = rgb; else { const t = Math.min(1, a * 1.4); r = 255 * Math.min(1, t * 2); g = 255 * Math.min(1, 2 - t * 2) * (t > 0.2 ? 1 : t * 5); b = t < 0.3 ? 255 * (1 - t * 3) : 0; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.min(200, a * 320);
  }
  ctx.putImageData(img, 0, 0);
}

function behavior(el, r) {
  const B = r.behavior;
  const pageRows = [...r.pages].sort((a, b) => b.timeSpent - a.timeSpent).slice(0, 10);
  const frictionRows = [...r.pages].map((p) => ({ label: p.title || p.path, value: p.rage + p.dead + (p.errorClicks || 0), note: `${p.dead} no response · ${p.rage} repeat · ${p.errorClicks || 0} errors of ${p.clicks} clicks` })).filter((x) => x.value).sort((a, b) => b.value - a.value).slice(0, 8);
  el.innerHTML = `
  <div class="stack">
    <p class="hint">💡 What actually happened during the session: the path through the site, where time went, and where people struggled.</p>
    <section class="panel"><h2>User journey</h2>
      <div class="journey">${r.journey.map((j, i) => `${i ? '<span class="arrow" aria-hidden="true">→</span>' : ''}<span class="step" title="${esc(j.page)}">${j.kind === 'back' ? '↩ ' : ''}${esc(j.title || j.path)} <span class="muted">${fmtDur(j.dur)}</span></span>`).join('') || '<span class="muted">No navigation recorded.</span>'}</div>
    </section>
    <div class="grid g2" style="align-items:start">
      <section class="panel"><div class="sec-h"><h2>Time spent per page</h2><span class="muted small">Longest first</span></div>
        ${hbars(pageRows.map((p) => ({ label: p.title || p.path, value: p.timeSpent, note: `${p.clicks} clicks · scrolled ${p.maxScroll}%` })), { fmt: fmtDur })}</section>
      <section class="panel"><div class="sec-h"><h2>Pages with the most friction</h2><span class="muted small">Clicks that went wrong</span></div>
        ${frictionRows.length ? hbars(frictionRows, { color: 'var(--series-2)' }) : '<p class="g">No click friction recorded.</p>'}</section>
      <section class="panel"><div class="sec-h"><h2>Most-clicked elements</h2><span class="muted small">⚠ marks clicks that got no response</span></div>
        ${hbars(B.topClicked.map((c) => ({ label: c.text || c.selector, value: c.n, note: `${c.page} · ${c.selector}`, flag: c.dead ? `${c.dead} no response` : '' })), { fmt: (x) => x + ' clicks' })}</section>
      <section class="panel"><div class="sec-h"><h2>Form fields: where time went</h2><span class="muted small">⚠ marks fields people struggled with</span></div>
        ${B.fields.length ? hbars(B.fields.map((f) => ({ label: f.field, value: f.ms / 1000, note: `${f.focus}× focused · ${f.deletes} deletions · ${f.page}`, flag: f.focus >= 3 || f.deletes > 5 ? `${f.deletes} fixes · ${f.focus}× visited` : '', color: 'var(--series-3)' })), { fmt: (x) => x.toFixed(1) + ' s' }) : '<p class="muted small">No form interaction recorded.</p>'}</section>
    </div>
    <section class="panel"><h2>Other signals</h2>
      <div class="mini-stats wide">
        ${[['Uncertain pauses', B.hesitations, 'Hesitation'], ['Went back', B.backNavs, 'Pogo-sticking'], ['Keyboard (Tab) use', B.keyboardNav, ''], ['Forms sent', B.formsSubmitted, ''], ['Validation errors', B.validationErrors, ''], ['Median scroll', B.medianScroll + '%', '']].map(([l, v, t]) => `<div><b>${v}</b><span>${l}</span>${t ? termChip(t) : ''}</div>`).join('')}
      </div>
    </section>
  </div>`;
  bindTips(el);
}
function perf(el, r) {
  const P = r.performance;
  const rate = (v, g, b) => (v <= g ? 'g' : v <= b ? 'o' : 'b');
  const lcpRows = r.pages.filter((p) => p.vitals?.lcp).map((p) => ({ label: p.title || p.path, value: p.vitals.lcp, color: p.vitals.lcp <= 2500 ? 'var(--good)' : p.vitals.lcp <= 4000 ? 'var(--ok)' : 'var(--bad)', note: `TTFB ${p.vitals.ttfb} ms · load ${p.vitals.load} ms` })).sort((a, b) => b.value - a.value);
  el.innerHTML = `
  <div class="stack">
    <p class="hint">💡 How fast and stable the site felt during your session. The marker shows where this site landed: the green zone is good, amber is borderline, red is slow. ${termChip('Core Web Vitals')}</p>
    <section class="panel"><div class="buls two">
      ${bullet({ label: 'LCP', plain: 'Main content appears', value: P.lcp, good: 2500, poor: 4000, max: 6000, fmt: (x) => (x < 1000 ? Math.round(x) + ' ms' : (x / 1000).toFixed(1) + ' s') })}
      ${bullet({ label: 'INP', plain: 'Reaction to clicks', value: P.inp, good: 200, poor: 500, max: 800, unit: ' ms' })}
      ${bullet({ label: 'CLS', plain: 'Page jumpiness', value: P.cls, good: 0.1, poor: 0.25, max: 0.4, fmt: (x) => (+x).toFixed(2) })}
      ${bullet({ label: 'TTFB', plain: 'Server response', value: P.ttfb, good: 800, poor: 1800, max: 2600, unit: ' ms' })}
    </div>
    <div class="mini-stats"><div><b class="${P.slowRequests ? 'o' : 'g'}">${P.slowRequests}</b><span>slow data loads (over 2 s)</span></div><div><b class="${P.failedRequests ? 'b' : 'g'}">${P.failedRequests}</b><span>failed loads</span></div></div></section>
    <section class="panel"><div class="sec-h"><h2>Main content time per page</h2><span class="muted small">LCP, slowest first</span></div>${hbars(lcpRows, { fmt: (x) => (x / 1000).toFixed(2) + ' s', max: Math.max(4000, ...lcpRows.map((x) => x.value)) })}</section>
    <details class="panel"><summary><b>Per-page table</b> (all timings in ms)</summary>
      <table style="margin-top:10px"><thead><tr><th>Page</th><th>FCP</th><th>LCP</th><th>CLS</th><th>INP</th><th>TTFB</th><th>Load</th><th>Long tasks</th><th>DOM nodes</th></tr></thead><tbody>
      ${r.pages.map((p) => { const v = p.vitals || {}; return `<tr><td>${esc(p.path)}</td><td>${v.fcp ?? '—'}</td><td class="${rate(v.lcp || 0, 2500, 4000)}">${v.lcp ?? '—'}</td><td class="${rate(v.cls || 0, 0.1, 0.25)}">${v.cls ?? '—'}</td><td class="${rate(v.inp || 0, 200, 500)}">${v.inp ?? '—'}</td><td>${v.ttfb ?? '—'}</td><td>${v.load ?? '—'}</td><td>${v.longTasks ?? '—'}</td><td>${p.audit?.counts?.domNodes ?? '—'}</td></tr>`; }).join('')}
      </tbody></table><p class="small muted">Measured in your real session, so they reflect your network (including VPN or intranet).</p></details>
  </div>`;
  bindTips(el);
}

// ======================================================================
// COMPARE two reports
// ======================================================================
async function compareView(a, b, keepOrder = location.hash.endsWith('/x')) {
  $app.innerHTML = '<p class="muted">Loading…</p>';
  let A, B;
  try { [A, B] = await Promise.all([api('/sessions/' + a), api('/sessions/' + b)]); } catch (e) { $app.innerHTML = `<div class="panel empty">${esc(e.message)} <a href="#/">Back</a></div>`; return; }
  if (!A.report || !B.report) { $app.innerHTML = '<div class="panel empty">Both scans must be finished. <a href="#/">Back</a></div>'; return; }
  if (!keepOrder && A.meta.startedAt > B.meta.startedAt) [A, B] = [B, A];
  const d = diffReports(A.report, B.report);
  const up = d.score.delta > 0, down = d.score.delta < 0;
  const row = (f, tag) => `<li class="cmp-i ${f.severity}">${sevPill(f.severity)} <span>${esc(cleanTitle(f))}</span>${pageTag(f)}${tag || ''}</li>`;
  $app.innerHTML = `
  <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:16px">
    <div><a href="#/" class="small">← All scans</a><h1>Before and after</h1></div>
    <button id="swap">Swap order</button>
  </div>
  <section class="panel cmp-hero">
    <div class="cmp-side"><div class="muted small">Before</div><a href="#/s/${A.meta.id}"><b>${esc(A.meta.name)}</b></a><div class="muted small">${fmtDate(A.meta.startedAt)}</div><div class="cmp-score">${d.score.before}</div></div>
    <div class="cmp-delta ${up ? 'g' : down ? 'b' : ''}"><span>${up ? '▲' : down ? '▼' : '='}</span><b>${d.score.delta > 0 ? '+' : ''}${d.score.delta}</b><span class="small">points</span></div>
    <div class="cmp-side"><div class="muted small">After</div><a href="#/s/${B.meta.id}"><b>${esc(B.meta.name)}</b></a><div class="muted small">${fmtDate(B.meta.startedAt)}</div><div class="cmp-score">${d.score.after}</div></div>
    <div class="cmp-sum">
      <div><b class="g">${d.fixed.length}</b><span>fixed</span></div><div><b class="g">${d.better.length}</b><span>improved</span></div>
      <div><b class="b">${d.added.length}</b><span>new</span></div><div><b class="o">${d.worse.length}</b><span>got worse</span></div>
    </div>
  </section>
  <div class="dash-grid">
    <section class="panel"><div class="sec-h"><h2>Score per area</h2><span class="legend"><span><span class="sw ring"></span>Before</span><span><span class="sw" style="background:var(--series-1)"></span>After</span></span></div>
      ${dumbbell(d.categories.map((c) => ({ label: CAT_PLAIN[c.key].q, icon: CAT_PLAIN[c.key].icon, before: c.before, after: c.after, delta: c.delta })))}</section>
    <section class="panel"><div class="sec-h"><h2>Issues by severity</h2></div>
      ${d.severities.map((s) => { const m = Math.max(1, ...d.severities.flatMap((x) => [x.before, x.after])); return `<div class="sevcmp"><span>${sevPill(s.s)}</span><div><span class="sc-bar a" style="width:${(s.before / m) * 100}%"></span><span class="sc-n">${s.before}</span></div><div><span class="sc-bar b ${s.s}" style="width:${(s.after / m) * 100}%"></span><span class="sc-n">${s.after}</span></div></div>`; }).join('')}
      <p class="muted small">Top bar is before, bottom bar is after.</p></section>
  </div>
  <div class="grid g2" style="align-items:start">
    <section class="panel"><h2 class="b">New or worse (${d.added.length + d.worse.length})</h2><ul class="cmp-list">${d.added.map((f) => row(f, '<span class="tagnew">new</span>')).join('')}${d.worse.map((w) => row(w.after, `<span class="tagworse">${w.from} → ${w.to}</span>`)).join('') || ''}</ul>${d.added.length + d.worse.length ? '' : '<p class="g">Nothing got worse.</p>'}</section>
    <section class="panel"><h2 class="g">Fixed or improved (${d.fixed.length + d.better.length})</h2><ul class="cmp-list">${d.fixed.map((f) => row(f, '<span class="tagfix">fixed</span>')).join('')}${d.better.map((w) => row(w.after, `<span class="tagfix">${w.from} → ${w.to}</span>`)).join('')}</ul>${d.fixed.length + d.better.length ? '' : '<p class="muted">Nothing fixed yet.</p>'}</section>
  </div>`;
  document.getElementById('swap').onclick = () => (location.hash = `#/compare/${B.meta.id}/${A.meta.id}/x`);
  bindTips($app);
}

function tech(el, r) {
  el.innerHTML = `
  <div class="stack">
    <section class="panel"><h2>Failed & slow requests</h2>
      <table><thead><tr><th>Status</th><th>Type</th><th>Time</th><th>URL</th></tr></thead><tbody>
      ${r.network.map((n) => `<tr><td class="${n.status === 0 || n.status >= 400 ? 'b' : 'o'}">${n.status || esc(n.error)}</td><td>${esc(n.type)}</td><td>${n.ms ? (n.ms / 1000).toFixed(1) + 's' : '—'}</td><td class="small" style="word-break:break-all">${esc(n.method)} ${esc(n.url)}</td></tr>`).join('') || '<tr><td colspan="4" class="g">None 🎉</td></tr>'}
      </tbody></table></section>
    <section class="panel"><h2>Console errors & warnings</h2>
      <div class="feed" style="max-height:none">${r.console.map((c) => `<div><span class="${c.type === 'error' ? 'b' : 'o'}">${esc(c.type)}</span> ${esc(c.text)}</div>`).join('') || '<div class="g">None</div>'}</div></section>
  </div>`;
}

const catName = (r, k) => r.categories.find((c) => c.key === k)?.name || k;
const shortPath = (k) => { try { const u = new URL(k); return u.host + u.pathname + u.hash; } catch { return k; } };
