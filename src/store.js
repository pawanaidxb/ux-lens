import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './analyze.js';
import { fingerprint } from '../public/diff.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, '..', 'data');
const IGNORE_FILE = path.join(DATA_DIR, 'ignored.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const hostOf = (u) => { try { return new URL(u).host || 'file'; } catch { return 'unknown'; } };
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// ---------- ignore list (false positives), scoped per host ----------
export const loadIgnores = (url) => (readJSON(IGNORE_FILE, {})[hostOf(url)] || []).map((x) => x.fp);
export function setIgnore(url, finding, on, reason = '') {
  const all = readJSON(IGNORE_FILE, {});
  const h = hostOf(url);
  const fp = fingerprint(finding);
  all[h] = (all[h] || []).filter((x) => x.fp !== fp);
  if (on) all[h].push({ fp, title: finding.title, reason, at: Date.now() });
  fs.writeFileSync(IGNORE_FILE, JSON.stringify(all, null, 1));
  return all[h];
}

// ---------- saved sessions ----------
const dirOf = (id) => path.join(DATA_DIR, id);
export const loadReport = (id) => readJSON(path.join(dirOf(id), 'report.json'), null);
export const loadRaw = (id) => readJSON(path.join(dirOf(id), 'raw.json'), null);
export function listSaved() {
  return fs.readdirSync(DATA_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const r = loadReport(d.name);
    if (!r) return null;
    const s = r.report?.summary || {};
    return { ...r.meta, score: s.score, grade: s.grade, findings: s.findings, pages: s.pages, critical: s.critical, major: s.major, minor: s.minor, testers: s.testers };
  }).filter(Boolean);
}

// Rebuild a session-like object from raw data so reports can be re-scored
// (after ignoring an issue) or merged (multiple testers).
function hydrate(id) {
  const rep = loadReport(id), raw = loadRaw(id);
  if (!rep || !raw) return null;
  const m = rep.meta;
  return {
    id, url: m.url, startedAt: m.startedAt, endedAt: m.endedAt,
    events: raw.events.map((e) => ({ ...e, sid: id })), audits: raw.audits, network: raw.network, console: raw.console,
    shots: Object.fromEntries(Object.entries(rep.shots || {}).map(([k, v]) => [k, { ...v, file: v.file.includes('/') ? v.file : `${id}/${v.file}` }])),
    sources: m.sources || null,
  };
}

export function reanalyze(id, patch = {}) {
  const rep = loadReport(id);
  if (!rep) return null;
  if ('designSystem' in patch) rep.meta.designSystem = patch.designSystem;
  const src = rep.meta.sources;
  const s = src ? mergeSessions(src) : hydrate(id);
  rep.report = analyze(s, { ignored: loadIgnores(rep.meta.url), testers: src?.length || 1, designSystem: rep.meta.designSystem });
  fs.writeFileSync(path.join(dirOf(id), 'report.json'), JSON.stringify(rep));
  return rep;
}

function mergeSessions(ids) {
  const parts = ids.map(hydrate).filter(Boolean);
  if (!parts.length) throw new Error('No source sessions found');
  const audits = {}, shots = {};
  for (const p of parts) {
    for (const [k, a] of Object.entries(p.audits)) if (!audits[k] || a.counts.interactive > audits[k].counts.interactive) { audits[k] = a; if (p.shots[k]) shots[k] = p.shots[k]; }
    for (const [k, v] of Object.entries(p.shots)) shots[k] = shots[k] || v;
  }
  // put sessions back-to-back on a virtual timeline so journeys/durations stay meaningful
  let offset = 0;
  const events = [];
  let total = 0;
  for (const p of parts) {
    const shift = offset - p.startedAt;
    for (const e of p.events) events.push({ ...e, t: e.t + shift });
    const dur = (p.endedAt || p.startedAt) - p.startedAt;
    total += dur; offset += dur + 1;
  }
  return {
    startedAt: 0, endedAt: total, events, audits, shots,
    network: parts.flatMap((p) => p.network), console: parts.flatMap((p) => p.console),
    perSession: true,
  };
}

export function combine(ids, name) {
  const metas = ids.map(loadReport).filter(Boolean).map((r) => r.meta);
  const designSystem = metas.find((m) => m.designSystem)?.designSystem || null;
  if (metas.length < 2) throw new Error('Pick at least two finished scans to combine');
  const s = mergeSessions(ids);
  const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-mix';
  fs.mkdirSync(dirOf(id), { recursive: true });
  const report = analyze(s, { ignored: loadIgnores(metas[0].url), testers: ids.length, designSystem });
  const meta = {
    id, name: name || `Combined: ${metas.length} testers`, url: metas[0].url, device: [...new Set(metas.map((m) => m.device))].join(', '),
    browser: [...new Set(metas.map((m) => m.browser || 'chromium'))].join(', '), kind: 'combined', designSystem,
    startedAt: Math.min(...metas.map((m) => m.startedAt)), endedAt: Math.max(...metas.map((m) => m.endedAt || m.startedAt)), status: 'done', sources: ids,
  };
  fs.writeFileSync(path.join(dirOf(id), 'report.json'), JSON.stringify({ meta, report, shots: s.shots }));
  return id;
}

// Score history for the same site (for the trend chart)
export function history(url) {
  const h = hostOf(url);
  return listSaved().filter((s) => hostOf(s.url) === h && s.score != null && s.kind !== 'combined')
    .sort((a, b) => a.startedAt - b.startedAt).map((s) => ({ id: s.id, t: s.startedAt, score: s.score, name: s.name, kind: s.kind }));
}
