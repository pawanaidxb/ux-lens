// Small inline-SVG chart kit for UX Lens. No dependencies.
// Colours come from CSS custom properties so light/dark themes swap in one place.
// Every chart has a shared hover tooltip and a text alternative.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- tooltip (one per page) ----------
let tip;
function tooltip() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'viz-tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  return tip;
}
export function bindTips(root) {
  const t = tooltip();
  root.querySelectorAll('[data-tip]').forEach((el) => {
    if (el.classList.contains('term')) return;
    const show = (e) => {
      t.innerHTML = el.dataset.tip;
      t.style.display = 'block';
      const r = el.getBoundingClientRect();
      const x = e?.clientX ?? r.left + r.width / 2, y = e?.clientY ?? r.top;
      const w = t.offsetWidth, h = t.offsetHeight;
      t.style.left = Math.min(innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
      t.style.top = (y - h - 12 < 8 ? y + 18 : y - h - 12) + 'px';
      el.classList.add('hot');
    };
    const hide = () => { t.style.display = 'none'; el.classList.remove('hot'); };
    el.addEventListener('mousemove', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', () => show());
    el.addEventListener('blur', hide);
  });
}

const statusVar = (s) => (s == null ? 'var(--wire)' : s >= 80 ? 'var(--good)' : s >= 60 ? 'var(--ok)' : 'var(--bad)');
const statusWord = (s) => (s == null ? 'Not measured' : s >= 90 ? 'Great' : s >= 80 ? 'Good' : s >= 60 ? 'Needs attention' : 'Poor');

// ---------- 1. Ranked score bars (one per UX area) ----------
// rows: [{ key, label, sub, score, issues }]
export function scoreBars(rows, { target = 80 } = {}) {
  return `<div class="sbars" role="table" aria-label="Score for each UX area, out of 100">
    <div class="sb-axis" aria-hidden="true"><span></span><div class="sb-scale"><i style="left:0">0</i><i style="left:50%">50</i><i style="left:100%">100</i></div><span></span></div>
    ${rows.map((r) => `
    <button class="sb-row" role="row" data-cat="${r.key}" ${r.score == null ? 'disabled' : ''}
      data-tip="<b>${esc(r.label)}</b><br>${r.score == null ? 'Not measured: no interactions recorded' : `${r.score}/100 · ${statusWord(r.score)}`}<br>${r.issues} issue${r.issues === 1 ? '' : 's'}<br><span class=&quot;dim&quot;>${esc(r.sub)}</span>">
      <span class="sb-l" role="cell"><span class="sb-ic" aria-hidden="true">${r.icon || ''}</span>${esc(r.label)}</span>
      <span class="sb-track" role="cell" aria-hidden="true">
        <span class="sb-target" style="left:${target}%"></span>
        ${r.score != null ? `<span class="sb-fill" style="width:${Math.max(1.5, r.score)}%;background:${statusVar(r.score)}"></span>` : '<span class="sb-na">not measured</span>'}
      </span>
      <span class="sb-v" role="cell">${r.score ?? '–'}<span class="sr"> out of 100, ${statusWord(r.score)}, ${r.issues} issues</span></span>
    </button>`).join('')}
  </div>`;
}

// ---------- 2. Part-to-whole bar (click outcomes) ----------
// parts: [{ label, value, color, note }]
export function partBar(parts, { total, unit = 'clicks' } = {}) {
  const sum = total ?? parts.reduce((s, p) => s + p.value, 0);
  if (!sum) return `<p class="muted small">No ${unit} recorded.</p>`;
  const shown = parts.filter((p) => p.value > 0);
  return `<div class="pbar" role="img" aria-label="${esc(shown.map((p) => `${p.label}: ${p.value}`).join(', '))}">
    ${shown.map((p) => `<span class="pb-seg" tabindex="0" style="flex:${p.value} 0 0;background:${p.color}" data-tip="<b>${esc(p.label)}</b><br>${p.value} ${unit} · ${Math.round((p.value / sum) * 100)}%${p.note ? `<br><span class=&quot;dim&quot;>${esc(p.note)}</span>` : ''}"></span>`).join('')}
  </div>
  <ul class="pb-legend">${parts.map((p) => `<li><span class="sw" style="background:${p.color}"></span>${esc(p.label)} <b>${p.value}</b> <span class="muted">${Math.round((p.value / sum) * 100)}%</span></li>`).join('')}</ul>`;
}

// ---------- 3. Impact × effort matrix (quick wins) ----------
// items: [{ id, title, impact 1-3, effort 1-3, severity, label }]
export function matrix(items) {
  const W = 520, H = 300, pad = { l: 64, r: 14, t: 14, b: 44 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const cx = (e) => pad.l + ((e - 0.5) / 3) * iw;
  const cy = (i) => pad.t + ih - ((i - 0.5) / 3) * ih;
  // bucket identical cells and spread them in a small grid so dots never overlap
  const cells = {};
  items.forEach((it) => (cells[it.effort + '-' + it.impact] = cells[it.effort + '-' + it.impact] || []).push(it));
  const dots = [];
  for (const list of Object.values(cells)) {
    const n = list.length, cols = Math.ceil(Math.sqrt(n * 1.8)), gap = Math.min(20, (iw / 3 - 24) / Math.max(cols, 1));
    list.forEach((it, i) => {
      const r = Math.floor(i / cols), c = i % cols, rows = Math.ceil(n / cols);
      dots.push({ ...it, x: cx(it.effort) + (c - (cols - 1) / 2) * gap, y: cy(it.impact) + (r - (rows - 1) / 2) * gap });
    });
  }
  const SEV = { critical: 'var(--crit)', major: 'var(--major)', minor: 'var(--minor)' };
  const qw = items.filter((i) => i.impact >= 2 && i.effort === 1).length;
  return `<figure class="matrix">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Issues by impact and effort. ${qw} quick wins: high impact, low effort.">
      <rect x="${pad.l}" y="${pad.t}" width="${iw / 3}" height="${(ih * 2) / 3}" class="mx-win"/>
      <text x="${pad.l + 8}" y="${pad.t + 18}" class="mx-q">Quick wins</text>
      <text x="${pad.l + iw - 8}" y="${pad.t + 18}" class="mx-q2" text-anchor="end">Plan these</text>
      <text x="${pad.l + iw - 8}" y="${pad.t + ih - 8}" class="mx-q2" text-anchor="end">Later</text>
      ${[1, 2].map((k) => `<line x1="${pad.l + (k * iw) / 3}" x2="${pad.l + (k * iw) / 3}" y1="${pad.t}" y2="${pad.t + ih}" class="grid"/><line y1="${pad.t + (k * ih) / 3}" y2="${pad.t + (k * ih) / 3}" x1="${pad.l}" x2="${pad.l + iw}" class="grid"/>`).join('')}
      <rect x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" class="frame"/>
      ${['Quick', 'Moderate', 'Bigger'].map((l, i) => `<text x="${cx(i + 1)}" y="${H - 22}" text-anchor="middle" class="ax">${l}</text>`).join('')}
      <text x="${pad.l + iw / 2}" y="${H - 4}" text-anchor="middle" class="ax-t">Effort to fix</text>
      ${['Low', 'Medium', 'High'].map((l, i) => `<text x="${pad.l - 8}" y="${cy(i + 1) + 4}" text-anchor="end" class="ax">${l}</text>`).join('')}
      <text transform="translate(12 ${pad.t + ih / 2}) rotate(-90)" text-anchor="middle" class="ax-t">Impact on users</text>
      ${dots.map((d) => `<g class="mx-dot" tabindex="0" data-fid="${d.id}" data-tip="<b>${esc(d.title)}</b><br>${esc(d.label)}"><circle cx="${d.x}" cy="${d.y}" r="12" class="hit"/><circle cx="${d.x}" cy="${d.y}" r="6" fill="${SEV[d.severity]}"/></g>`).join('')}
    </svg>
  </figure>`;
}

// ---------- 4. Bullet gauge for a web vital ----------
// v: value, good/poor thresholds, max for the axis
export function bullet({ label, plain, value, good, poor, max, fmt = (x) => x, unit = '' }) {
  if (value == null || value === 0 && label !== 'CLS') return `<div class="bul"><div class="bul-h"><b>${esc(plain)}</b><span class="muted small">${esc(label)}</span></div><div class="muted small">Not measured</div></div>`;
  const m = Math.max(max, value * 1.08), pct = (x) => Math.min(100, (x / m) * 100);
  const state = value <= good ? ['g', 'Good'] : value <= poor ? ['o', 'Needs work'] : ['b', 'Poor'];
  return `<div class="bul" tabindex="0" data-tip="<b>${esc(plain)}</b> (${esc(label)})<br>${fmt(value)}${unit} · ${state[1]}<br><span class=&quot;dim&quot;>Good ≤ ${fmt(good)}${unit} · Poor > ${fmt(poor)}${unit}</span>">
    <div class="bul-h"><b>${esc(plain)}</b><span class="bul-v ${state[0]}">${fmt(value)}${unit} <span class="small">${state[1]}</span></span></div>
    <div class="bul-track" aria-hidden="true">
      <span class="z g" style="width:${pct(good)}%"></span><span class="z o" style="width:${pct(poor) - pct(good)}%"></span><span class="z b" style="width:${100 - pct(poor)}%"></span>
      <span class="bul-mark" style="left:${pct(value)}%"></span>
    </div>
    <div class="bul-s muted small"><span>${esc(label)}</span><span>good ≤ ${fmt(good)}${unit}</span></div>
  </div>`;
}

// ---------- 5. Horizontal bars (time per page, top elements) ----------
export function hbars(rows, { fmt = (x) => x, color = 'var(--series-1)', max } = {}) {
  if (!rows.length) return '<p class="muted small">No data.</p>';
  const m = max ?? Math.max(...rows.map((r) => r.value), 1);
  return `<div class="hbars">${rows.map((r) => `
    <div class="hb" tabindex="0" data-tip="<b>${esc(r.label)}</b><br>${fmt(r.value)}${r.note ? `<br><span class=&quot;dim&quot;>${esc(r.note)}</span>` : ''}">
      <span class="hb-l" title="${esc(r.label)}">${esc(r.label)}${r.flag ? `<span class="hb-flag">⚠ ${esc(r.flag)}</span>` : ''}</span>
      <span class="hb-t"><span class="hb-f" style="width:${Math.max(1.5, (r.value / m) * 100)}%;background:${r.color || color}"></span></span>
      <span class="hb-v">${fmt(r.value)}</span>
    </div>`).join('')}</div>`;
}

// ---------- 6. Line chart (score history) ----------
export function line(points, { height = 160, width = 560, current } = {}) {
  if (points.length < 2) return `<p class="muted small">Run this site again to see a trend. ${points.length ? 'There is 1 scan so far.' : ''}</p>`;
  const W = width, H = height, pad = { l: 30, r: 12, t: 12, b: 24 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (i / (points.length - 1)) * iw;
  const y = (v) => pad.t + ih - (v / 100) * ih;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join('');
  return `<svg class="linec" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score trend: ${points.map((p) => p.score).join(', ')}">
    ${[0, 50, 80, 100].map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text>`).join('')}
    <path d="${d}" class="ln"/>
    ${points.map((p, i) => `<g tabindex="0" data-tip="<b>${p.score}</b> · ${esc(new Date(p.t).toLocaleString())}<br>${esc(p.name)}"><circle cx="${x(i)}" cy="${y(p.score)}" r="12" class="hit"/><circle cx="${x(i)}" cy="${y(p.score)}" r="${p.id === current ? 6 : 4}" class="pt ${p.id === current ? 'cur' : ''}"/></g>`).join('')}
    <text x="${pad.l}" y="${H - 6}" class="ax">${esc(new Date(points[0].t).toLocaleDateString())}</text>
    <text x="${W - pad.r}" y="${H - 6}" text-anchor="end" class="ax">${esc(new Date(points[points.length - 1].t).toLocaleDateString())}</text>
  </svg>`;
}

// ---------- 7. Dumbbell (before → after per category) ----------
export function dumbbell(rows) {
  return `<div class="dumb" role="table" aria-label="Score per area, before and after">
    <div class="sb-axis" aria-hidden="true"><span></span><div class="sb-scale"><i style="left:0">0</i><i style="left:50%">50</i><i style="left:100%">100</i></div><span></span></div>
    ${rows.map((r) => {
      const a = r.before, b = r.after;
      if (a == null && b == null) return '';
      const lo = Math.min(a ?? b, b ?? a), hi = Math.max(a ?? b, b ?? a);
      const dir = a == null || b == null ? '' : b > a ? 'up' : b < a ? 'down' : 'same';
      return `<div class="db-row" role="row" tabindex="0" data-tip="<b>${esc(r.label)}</b><br>Before ${a ?? '–'} → after ${b ?? '–'}${r.delta != null ? ` (${r.delta > 0 ? '+' : ''}${r.delta})` : ''}">
        <span class="sb-l" role="cell"><span class="sb-ic" aria-hidden="true">${r.icon || ''}</span>${esc(r.label)}</span>
        <span class="db-track" role="cell" aria-hidden="true">
          <span class="db-link ${dir}" style="left:${lo}%;width:${hi - lo}%"></span>
          ${a != null ? `<span class="db-a" style="left:${a}%"></span>` : ''}${b != null ? `<span class="db-b ${dir}" style="left:${b}%"></span>` : ''}
        </span>
        <span class="db-d ${dir}" role="cell">${r.delta == null ? '–' : r.delta > 0 ? '▲ +' + r.delta : r.delta < 0 ? '▼ ' + r.delta : '='}</span>
      </div>`;
    }).join('')}
  </div>`;
}
