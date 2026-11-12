// Shared by the browser (compare view) and Node (CI baselines, ignore list).
// A finding's fingerprint stays stable between runs: counts and hostnames are
// stripped so "12 small targets on staging/x" matches "9 small targets on prod/x".

export const pathOf = (k) => {
  try { const u = new URL(k); return u.pathname + (u.hash.startsWith('#/') ? u.hash : ''); } catch { return k || ''; }
};
export const normTitle = (t) =>
  String(t || '')
    .replace(/\s+(on|—)\s+\S*\/\S*\s*(\([^)]*\))?$/, '')
    .replace(/\d[\d.,]*/g, '#')
    .trim();
export const fingerprint = (f) => f.key || `${f.category}|${f.rule || normTitle(f.title)}|${pathOf(f.page)}`;

const SEV_RANK = { critical: 3, major: 2, minor: 1 };
// element count carried in a title: "(12 elements)", "19 tap/click targets…", "×3"
export const countOf = (f) => { const t = String(f.title || ''); const m = t.match(/\((\d+) elements?\)/) || t.match(/^(\d+)\s/) || t.match(/×(\d+)/); return m ? +m[1] : 1; };

export function diffReports(a, b) {
  const A = new Map(a.findings.map((f) => [fingerprint(f), f]));
  const B = new Map(b.findings.map((f) => [fingerprint(f), f]));
  const added = [], fixed = [], kept = [], worse = [], better = [];
  for (const [k, f] of B) {
    const o = A.get(k);
    if (!o) added.push(f);
    else {
      kept.push({ before: o, after: f });
      if (SEV_RANK[f.severity] > SEV_RANK[o.severity] || countOf(f) > countOf(o)) worse.push({ before: o, after: f, from: countOf(o), to: countOf(f) });
      else if (SEV_RANK[f.severity] < SEV_RANK[o.severity] || countOf(f) < countOf(o)) better.push({ before: o, after: f, from: countOf(o), to: countOf(f) });
    }
  }
  for (const [k, f] of A) if (!B.has(k)) fixed.push(f);
  const sortSev = (x, y) => SEV_RANK[(y.after || y).severity] - SEV_RANK[(x.after || x).severity];
  added.sort(sortSev); fixed.sort(sortSev); kept.sort(sortSev);
  const categories = b.categories.map((c) => {
    const o = a.categories.find((x) => x.key === c.key);
    return { key: c.key, name: c.name, before: o?.score ?? null, after: c.score, delta: o?.score != null && c.score != null ? c.score - o.score : null };
  });
  return {
    score: { before: a.summary.score, after: b.summary.score, delta: b.summary.score - a.summary.score },
    added, fixed, kept, worse, better, categories,
    severities: ['critical', 'major', 'minor'].map((s) => ({ s, before: a.summary[s], after: b.summary[s] })),
  };
}

export const severityAtLeast = (sev, min) => SEV_RANK[sev] >= SEV_RANK[min];
