// Design-system compliance: compares the computed styles a page actually uses
// with the tokens of a design system. Works with the bundled presets
// (design-systems/*.json), a user-uploaded JSON, or Figma/W3C "design tokens" JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DS_DIR = path.join(here, '..', 'design-systems');
fs.mkdirSync(DS_DIR, { recursive: true });

// ---------------------------------------------------------------- storage
export function listSystems() {
  return fs.readdirSync(DS_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DS_DIR, f), 'utf8'));
      return { id: d.id, name: d.name, version: d.version, brands: Object.keys(d.brands || {}), fonts: d.fonts, colors: Object.keys(d.colors || {}).length, components: Object.keys(d.components || {}).length, source: d.source, custom: !!d.custom, isDefault: !!d.default };
    } catch { return null; }
  }).filter(Boolean);
}
export function defaultSystem() {
  const all = listSystems();
  return all.find((d) => d.isDefault) || all.find((d) => !d.custom) || all[0] || null;
}
export function setDefaultSystem(id) {
  for (const f of fs.readdirSync(DS_DIR).filter((x) => x.endsWith('.json'))) {
    const fp = path.join(DS_DIR, f), d = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const want = d.id === id;
    if (!!d.default !== want) { d.default = want; fs.writeFileSync(fp, JSON.stringify(d, null, 1)); }
  }
}
export function loadSystem(id) {
  const f = path.join(DS_DIR, String(id).replace(/[^\w-]/g, '') + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
export function deleteSystem(id) {
  const d = loadSystem(id);
  if (!d?.custom) throw new Error('Built-in design systems cannot be deleted');
  fs.rmSync(path.join(DS_DIR, d.id + '.json'));
}

// Accepts: our own format, a W3C/Tokens Studio/Figma variables export, or a flat {name: value} map.
export function importSystem(input, name) {
  const src = typeof input === 'string' ? JSON.parse(input) : input;
  let ds;
  if (src.colors && (src.spacing || src.typeScale)) ds = src;
  else ds = fromTokens(src);
  ds.name = name || ds.name || 'Custom design system';
  ds.id = (ds.id || ds.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'custom';
  if (loadSystem(ds.id) && !loadSystem(ds.id).custom) ds.id += '-custom';
  ds.custom = true;
  ds.importedAt = Date.now();
  const counts = { colors: Object.keys(ds.colors || {}).length, spacing: (ds.spacing || []).length, type: (ds.typeScale || []).length, radii: (ds.radii || []).length };
  if (!counts.colors && !counts.spacing && !counts.type) throw new Error('No tokens found. Expected colours, spacing or typography values in the JSON.');
  fs.writeFileSync(path.join(DS_DIR, ds.id + '.json'), JSON.stringify(ds, null, 1));
  return { id: ds.id, name: ds.name, ...counts };
}

function fromTokens(src) {
  const colors = {}, spacing = new Set(), radii = new Set(), sizes = new Set(), fonts = new Set(), weights = new Set(), type = [], shadows = [];
  const walk = (node, pathParts, inheritedType) => {
    if (node == null) return;
    if (typeof node !== 'object' || Array.isArray(node)) return leaf(pathParts, node, inheritedType);
    const t = node.$type || node.type || inheritedType;
    if ('$value' in node || ('value' in node && typeof node.value !== 'object')) return leaf(pathParts, node.$value ?? node.value, t);
    if ('value' in node && typeof node.value === 'object') return leaf(pathParts, node.value, t);
    for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) walk(v, [...pathParts, k], t);
  };
  const num = (v) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : null; };
  const leaf = (p, v, t) => {
    const name = p.join('/');
    const low = name.toLowerCase();
    if (typeof v === 'string' && /^\{.+\}$/.test(v)) return; // alias to another token; target is collected separately
    if (t === 'color' || (typeof v === 'string' && /^#([0-9a-f]{3,8})$/i.test(v)) || /^rgba?\(/.test(v)) {
      const h = normHex(v);
      if (h) colors[name] = { light: h, dark: h };
      return;
    }
    if (t === 'typography' && typeof v === 'object') {
      if (v.fontFamily) fonts.add(String(v.fontFamily).split(',')[0].replace(/["']/g, '').trim());
      if (v.fontWeight) weights.add(num(v.fontWeight) || 400);
      if (v.fontSize) type.push({ role: p.slice(-1)[0], size: num(v.fontSize), line: num(v.lineHeight) || null });
      return;
    }
    if (t === 'fontFamily' || /font.?famil/.test(low)) { fonts.add(String(Array.isArray(v) ? v[0] : v).split(',')[0].replace(/["']/g, '').trim()); return; }
    if (t === 'fontWeight' || /font.?weight/.test(low)) { const n = num(v) || ({ regular: 400, medium: 500, semibold: 600, bold: 700 }[String(v).toLowerCase().replace(/[^a-z]/g, '')]); if (n) weights.add(n); return; }
    if (t === 'shadow' || t === 'boxShadow' || /shadow|elevation/.test(low)) { shadows.push({ name, value: typeof v === 'string' ? v : JSON.stringify(v) }); return; }
    const n = num(v);
    if (n == null) return;
    if (/radius|corner|rounded/.test(low)) radii.add(n);
    else if (/font.?size|text.?size|typography/.test(low)) type.push({ role: p.slice(-1)[0], size: n, line: null });
    else if (/spac|gap|padding|margin|inset|space/.test(low)) spacing.add(n);
    else if (/size|width|height|dimension/.test(low)) sizes.add(n);
    else if (t === 'dimension' || t === 'spacing') spacing.add(n);
  };
  walk(src, [], null);
  const uniqType = [...new Map(type.filter((x) => x.size).map((x) => [x.size, x])).values()].sort((a, b) => b.size - a.size);
  const sp = [...spacing].sort((a, b) => a - b);
  return {
    name: src.name || src.$name, source: 'Imported design tokens', colors,
    spacing: sp, sizes: [...sizes].sort((a, b) => a - b), radii: [...radii].sort((a, b) => a - b),
    fonts: [...fonts].filter(Boolean), fontWeights: [...weights].sort(), typeScale: uniqType, shadows,
    grid: { base: sp.length && sp.every((x) => x % 4 === 0) ? 4 : sp.length && sp.every((x) => x % 8 === 0) ? 8 : null },
  };
}

// ---------------------------------------------------------------- colour maths
export function normHex(v) {
  if (!v) return null;
  let s = String(v).trim();
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    s = '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('') + (a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : '');
  }
  s = s.toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(s)) s = '#' + [...s.slice(1)].map((c) => c + c).join('');
  if (/^#[0-9A-F]{8}$/.test(s) && s.endsWith('FF')) s = s.slice(0, 7);
  return /^#[0-9A-F]{6}([0-9A-F]{2})?$/.test(s) ? s : null;
}
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const alpha = (h) => (h.length === 9 ? parseInt(h.slice(7), 16) / 255 : 1);
function toLab([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [f(r), f(g), f(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const k = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * k(Y) - 16, 500 * (k(X) - k(Y)), 200 * (k(Y) - k(Z))];
}
// CIEDE2000 — perceptual colour distance; < 2.3 is "just noticeable"
export function deltaE(h1, h2) {
  const [L1, a1, b1] = toLab(rgb(h1)), [L2, a2, b2] = toLab(rgb(h2));
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G), C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = (Math.atan2(b1, a1p) / rad + 360) % 360, h2p = (Math.atan2(b2, a2p) / rad + 360) % 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = h2p - h1p; if (C1p * C2p === 0) dhp = 0; else if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lmp = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hmp = h1p + h2p; if (C1p * C2p !== 0) hmp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  const T = 1 - 0.17 * Math.cos((hmp - 30) * rad) + 0.24 * Math.cos(2 * hmp * rad) + 0.32 * Math.cos((3 * hmp + 6) * rad) - 0.2 * Math.cos((4 * hmp - 63) * rad);
  const Sl = 1 + (0.015 * (Lmp - 50) ** 2) / Math.sqrt(20 + (Lmp - 50) ** 2), Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T;
  const Rt = -2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hmp - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// ---------------------------------------------------------------- analysis
const TOL_COLOR = 2.3;          // ΔE00 ≤ 2.3 counts as "the token" (rounding, colour profiles)
const TOL_NEAR = 6;             // ≤ 6 is "close, probably meant this token"
const near = (v, list, tol = 0.5) => list.some((x) => Math.abs(x - v) <= tol);
const nearest = (v, list) => list.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), list[0]);

export function checkCompliance(audits, ds, opts = {}) {
  if (!ds) return null;
  let { brand, mode } = opts;
  if (!brand || !mode) { const t = detectTheme(audits, ds); brand = brand || t.brand; mode = mode || t.mode; }
  const brandKey = brand && ds.brands?.[brand] ? brand : ds.brands ? Object.keys(ds.brands)[0] : null;
  const B = brandKey ? ds.brands[brandKey] : null;
  const other = mode === 'dark' ? 'light' : 'dark';

  // palette: semantic (preferred) + brand theme + primitives (allowed-but-discouraged)
  const palette = [];
  for (const [name, v] of Object.entries(ds.colors || {})) {
    const theme = /\/theme\//.test(name) && B ? themeValue(name, B, mode) : null;
    palette.push({ name, hex: theme || v[mode] || v.light, kind: 'semantic' });
    if (v[other] && v[other] !== (v[mode] || v.light)) palette.push({ name: name + ` (${other})`, hex: v[other], kind: 'other-mode' });
  }
  if (B) for (const [name, hex] of Object.entries(B.theme || {})) palette.push({ name: `${brandKey} brand: ${name}`, hex, kind: name.includes(`/${mode}/`) ? 'semantic' : 'other-mode' });
  for (const [name, hex] of Object.entries(ds.primitives || {})) palette.push({ name, hex, kind: 'primitive' });
  const solid = palette.filter((p) => p.hex && p.hex.length === 7);
  const RANK = { semantic: 0, primitive: 1, 'other-mode': 2 };
  // brand theme tokens only count for the chosen brand; others are 'other brand'
  const otherBrands = ds.brands ? Object.entries(ds.brands).filter(([k]) => k !== brandKey) : [];
  const matchColor = (hex) => {
    if (!hex) return null;
    const exact = palette.filter((p) => p.hex === hex).sort((a, b) => RANK[a.kind] - RANK[b.kind])[0];
    if (exact) return { ...exact, de: 0 };
    if (hex.length === 7) for (const [bn, bv] of otherBrands) for (const [tn, th] of Object.entries(bv.theme || {})) if (th === hex && !Object.values(B?.theme || {}).includes(hex)) return { name: `${bn} brand: ${tn}`, hex: th, kind: 'other-brand', de: 0 };
    if (hex.length === 9) { // alpha colours: compare against alpha tokens, else the solid colour
      const a = palette.filter((p) => p.hex.length === 9 && Math.abs(alpha(p.hex) - alpha(hex)) < 0.04);
      const best = a.map((p) => ({ ...p, de: deltaE(p.hex.slice(0, 7), hex.slice(0, 7)) })).sort((x, y) => x.de - y.de)[0];
      if (best) return best;
      hex = hex.slice(0, 7);
    }
    return solid.map((p) => ({ ...p, de: deltaE(p.hex, hex) })).sort((x, y) => x.de - y.de || RANK[x.kind] - RANK[y.kind])[0] || null;
  };

  const sizes = (ds.typeScale || []).map((t) => t.size);
  const fonts = (ds.fonts || []).map((f) => f.toLowerCase());
  const weights = ds.fontWeights || [];
  const spacing = ds.spacing || [];
  const radii = [...new Set([...(ds.radii || []), ...(B ? [B.radius?.button, B.radius?.input].filter((x) => x != null) : [])])];
  const base = ds.grid?.base;
  const shadowNorm = (ds.shadows || []).map((s) => s.value.replace(/#[0-9A-F]{6,8}/gi, '').replace(/[^\d. ]/g, ' ').replace(/\s+/g, ' ').trim());

  const cats = {
    color: { name: 'Colours', icon: '🎨', checked: 0, ok: 0, offenders: [] },
    typography: { name: 'Typography', icon: '🔤', checked: 0, ok: 0, offenders: [] },
    spacing: { name: 'Spacing', icon: '📏', checked: 0, ok: 0, offenders: [] },
    radius: { name: 'Corner radius', icon: '⬜', checked: 0, ok: 0, offenders: [] },
    shadow: { name: 'Shadows', icon: '🌫', checked: 0, ok: 0, offenders: [] },
    components: { name: 'Components', icon: '🧩', checked: 0, ok: 0, offenders: [] },
  };
  const colorUse = {}; // hex -> {n, match, props:Set, samples, pages:Set}
  const addOff = (cat, o) => cats[cat].offenders.push(o);

  const pages = [];
  for (const [page, a] of Object.entries(audits)) {
    const st = a.styles;
    if (!st) continue;
    const U = st.usage;
    const pageCats = Object.fromEntries(Object.keys(cats).map((k) => [k, { checked: 0, ok: 0 }]));
    const tally = (cat, ok, n) => { cats[cat].checked += n; pageCats[cat].checked += n; if (ok) { cats[cat].ok += n; pageCats[cat].ok += n; } };

    // colours
    for (const prop of ['color', 'background', 'borderColor']) for (const [hex, u] of Object.entries(U[prop] || {})) {
      const m = matchColor(hex);
      const ok = m && m.de <= TOL_COLOR && m.kind === 'semantic';
      tally('color', ok, u.n);
      const c = (colorUse[hex] = colorUse[hex] || { hex, n: 0, match: m, props: new Set(), samples: [], pages: new Set() });
      c.n += u.n; c.props.add(prop); c.pages.add(page); if (c.samples.length < 4) c.samples.push(...u.samples.slice(0, 2));
    }
    // typography
    for (const [fam, u] of Object.entries(U.fontFamily || {})) {
      const ok = !fonts.length || fonts.some((f) => fam.toLowerCase().includes(f));
      tally('typography', ok, u.n);
      if (!ok) addOff('typography', { page, kind: 'font', value: fam, n: u.n, expected: ds.fonts.join(', '), samples: u.samples });
    }
    for (const [sz, u] of Object.entries(U.fontSize || {})) {
      const v = +sz, ok = !sizes.length || near(v, sizes, 0.5);
      tally('typography', ok, u.n);
      if (!ok) addOff('typography', { page, kind: 'size', value: v + 'px', n: u.n, expected: nearest(v, sizes) + 'px', samples: u.samples });
    }
    for (const [w, u] of Object.entries(U.fontWeight || {})) {
      const ok = !weights.length || weights.includes(+w);
      tally('typography', ok, u.n);
      if (!ok) addOff('typography', { page, kind: 'weight', value: w, n: u.n, expected: nearest(+w, weights), samples: u.samples });
    }
    // spacing (padding, gap, margin) — on the scale, or at least on the grid
    for (const prop of ['padding', 'gap', 'margin']) for (const [val, u] of Object.entries(U[prop] || {})) {
      const v = +val;
      const onScale = spacing.length ? near(v, spacing, 0.5) || (prop === 'margin' && v > Math.max(...spacing) && base && v % base === 0) : base ? v % base === 0 : true;
      tally('spacing', onScale, u.n);
      if (!onScale) addOff('spacing', { page, kind: prop, value: v + 'px', n: u.n, expected: spacing.length ? nearest(v, spacing) + 'px' : `multiple of ${base}`, samples: u.samples });
    }
    // radius
    for (const [val, u] of Object.entries(U.radius || {})) {
      const v = +val, ok = !radii.length || near(v, radii, 0.5) || (v >= 500 && radii.some((r) => r >= 500));
      tally('radius', ok, u.n);
      if (!ok) addOff('radius', { page, kind: 'radius', value: v + 'px', n: u.n, expected: nearest(v, radii) + 'px', samples: u.samples });
    }
    // shadows
    for (const [val, u] of Object.entries(U.shadow || {})) {
      const geo = val.replace(/rgba?\([^)]*\)/g, '').replace(/[^\d. ]/g, ' ').replace(/\s+/g, ' ').trim();
      const layers = val.split(/,(?![^(]*\))/).map((l) => l.replace(/rgba?\([^)]*\)/g, '').replace(/[^\d. ]/g, ' ').replace(/\s+/g, ' ').trim());
      const ok = !shadowNorm.length || shadowNorm.some((s) => s === geo || layers.every((l) => s.includes(l)));
      tally('shadow', ok, u.n);
      if (!ok) addOff('shadow', { page, kind: 'shadow', value: val, n: u.n, expected: (ds.shadows || []).map((s) => s.name).slice(0, 4).join(', '), samples: u.samples });
    }
    const pc = Object.values(pageCats).reduce((s, x) => ({ c: s.c + x.checked, o: s.o + x.ok }), { c: 0, o: 0 });
    pages.push({ page, score: pc.c ? Math.round((pc.o / pc.c) * 100) : null, elements: st.elements, vars: st.varCount, cats: Object.fromEntries(Object.entries(pageCats).map(([k, v]) => [k, v.checked ? Math.round((v.ok / v.checked) * 100) : null])) });
  }
  const components = classifyComponents(audits, ds, B, brandKey, matchColor);
  if (!pages.length && !components.total) return { system: { id: ds.id, name: ds.name }, brand: brandKey, mode, unavailable: true };

  // colour offenders, grouped by value (one row per off-palette colour)
  const colors = Object.values(colorUse).map((c) => ({
    hex: c.hex, n: c.n, props: [...c.props], pages: [...c.pages], samples: c.samples.slice(0, 4),
    token: c.match?.name || null, tokenHex: c.match?.hex || null, de: c.match ? Math.round(c.match.de * 10) / 10 : null, kind: c.match?.kind || null,
    status: !c.match ? 'off' : c.match.kind === 'other-brand' ? 'other-brand' : c.match.kind === 'other-mode' && c.match.de <= TOL_COLOR ? 'wrong-mode' : c.match.de <= TOL_COLOR ? (c.match.kind === 'primitive' ? 'primitive' : 'ok') : c.match.de <= TOL_NEAR ? 'near' : 'off',
  })).sort((a, b) => b.n - a.n);
  for (const c of colors) if (['near', 'off', 'wrong-mode', 'other-brand', 'primitive'].includes(c.status)) addOff('color', { page: c.pages[0], kind: c.props.join('/'), value: c.hex, n: c.n, expected: c.status === 'primitive' ? `a semantic token (this is raw palette ${c.token})` : c.status === 'other-brand' ? `the ${brandKey} theme token (this is ${c.token})` : c.token ? `${c.token} ${c.tokenHex}${c.status === 'near' ? ` (ΔE ${c.de})` : ''}` : 'no close token', samples: c.samples, status: c.status });

  cats.components.checked = components.total; cats.components.ok = components.fromDs;
  cats.components.offenders = components.items.filter((x) => !x.fromDs).map((x) => ({ page: x.page, kind: x.kind, value: x.text || x.kind, n: 1, expected: x.problems.join(' · ') || 'not from the design system', samples: [{ sel: x.sel, rect: x.rect, text: x.text }], status: x.status }));
  const categories = Object.entries(cats).map(([key, c]) => {
    // merge offenders of the same value across pages
    const byVal = {};
    for (const o of c.offenders) { const k = o.kind + '|' + o.value; const b = (byVal[k] = byVal[k] || { ...o, n: 0, pages: new Set(), samples: [] }); b.n += o.n; b.pages.add(o.page); if (b.samples.length < 4) b.samples.push(...(o.samples || []).slice(0, 2)); }
    const offenders = Object.values(byVal).map((o) => ({ ...o, pages: [...o.pages] })).sort((a, b) => b.n - a.n);
    return { key, name: c.name, icon: c.icon, checked: c.checked, ok: c.ok, off: c.checked - c.ok, score: c.checked ? Math.round((c.ok / c.checked) * 100) : null, offenders: offenders.slice(0, 40), distinctOff: offenders.length };
  });
  const scored = categories.filter((c) => c.score != null);
  const W = { color: 1.2, typography: 1.1, spacing: 0.9, radius: 0.6, shadow: 0.4, components: 1.8 };
  const score = Math.round(scored.reduce((s, c) => s + c.score * W[c.key], 0) / Math.max(scored.reduce((s, c) => s + W[c.key], 0), 1));

  // value distributions (for charts): used values vs tokens
  const dist = (prop) => {
    const m = {};
    for (const a of Object.values(audits)) for (const [v, u] of Object.entries(a.styles?.usage?.[prop] || {})) m[v] = (m[v] || 0) + u.n;
    return Object.entries(m).map(([v, n]) => ({ v: +v, n })).sort((a, b) => a.v - b.v);
  };
  const spacingDist = [...new Map([...dist('padding'), ...dist('gap'), ...dist('margin')].reduce((m, x) => m.set(x.v, (m.get(x.v) || 0) + x.n), new Map()))].map(([v, n]) => ({ v, n, ok: spacing.length ? near(v, spacing, 0.5) : base ? v % base === 0 : true })).sort((a, b) => a.v - b.v);
  const typeDist = dist('fontSize').map((x) => ({ ...x, ok: !sizes.length || near(x.v, sizes, 0.5), role: (ds.typeScale || []).find((t) => Math.abs(t.size - x.v) <= 0.5)?.role }));
  const radiusDist = dist('radius').map((x) => ({ ...x, ok: !radii.length || near(x.v, radii, 0.5) || (x.v >= 500 && radii.some((r) => r >= 500)) }));

  return {
    system: { id: ds.id, name: ds.name, version: ds.version, source: ds.source }, brand: brandKey, brands: Object.keys(ds.brands || {}), mode, autoDetected: !!opts.autoDetected || !opts.brand,
    score, categories, components, colors: colors.slice(0, 80), pages: pages.sort((a, b) => (a.score ?? 101) - (b.score ?? 101)),
    distributions: { spacing: spacingDist, type: typeDist, radius: radiusDist },
    tokens: { spacing, sizes, radii, type: ds.typeScale || [], fonts: ds.fonts || [], weights },
    usesTokenLayer: pages.some((p) => p.vars >= 3),
  };
}

function themeValue(name, B, mode) {
  // color/background/theme/primary → color/<mode>/primary in the brand table
  const leaf = name.split('/theme/')[1];
  if (!leaf) return null;
  const map = { 'sidebar-secondary': mode === 'dark' ? 'sidebar-seccondary' : 'sidebar-secondary', 'sidebar-foreground-secondary': 'sidebar-foreground-color' };
  return B.theme?.[`color/${mode}/${map[leaf] || leaf}`] || null;
}

// Turns compliance results into report findings (category "design").
export function complianceFindings(c, add) {
  if (!c || c.unavailable) return;
  const P = (p) => { try { const u = new URL(p); return u.pathname || '/'; } catch { return p; } };
  for (const cat of c.categories) {
    if (cat.key === 'components') {
      const K = c.components;
      for (const k of K.kinds.filter((x) => x.custom)) {
        const list = K.items.filter((x) => x.kind === k.kind && !x.fromDs);
        const why = [...new Set(list.flatMap((x) => x.problems.map((p) => p.replace(/\d+(\.\d+)?px/g, '#px').replace(/#[0-9A-F]{6}/g, '#colour'))))].slice(0, 3);
        add('design', list.length >= 3 || k.kind === 'Button' ? 'major' : 'minor', `${list.length} custom-built ${k.kind}${list.length === 1 ? '' : 's'} instead of the ${c.system.name} component`,
          `${k.total - k.custom} of ${k.total} ${k.kind.toLowerCase()} components come from the design system. The custom ones differ in: ${why.join('; ') || 'no library marker'}.`,
          `Replace them with the ${c.system.name} “${k.kind}” component${k.figma ? ` (Figma node ${k.figma})` : ''} so they pick up the brand theme, states and future updates.`,
          { page: list[0].page, rule: `ds:component:${k.kind}`, principle: `Design system — ${c.system.name} components · Nielsen #4 Consistency`, evidence: list.slice(0, 10).map((x) => ({ selector: x.sel, text: `${x.text || ''} — ${x.problems.slice(0, 2).join('; ')}` })) });
      }
      continue;
    }
    for (const o of cat.offenders.slice(0, 12)) {
      const sev = cat.key === 'components' || (cat.key === 'color' && o.status === 'off' && o.n >= 5) || (cat.key === 'typography' && o.kind === 'font') ? 'major' : 'minor';
      const label = {
        color: o.status === 'primitive' ? `Colour ${o.value} uses a raw palette value, not a semantic token` : o.status === 'other-brand' ? `Colour ${o.value} belongs to another brand` : o.status === 'wrong-mode' ? `Colour ${o.value} belongs to the other colour mode` : o.status === 'near' ? `Colour ${o.value} is close to a token but not exact` : `Off-palette colour ${o.value}`,
        typography: o.kind === 'font' ? `Font “${o.value}” is not part of ${c.system.name}` : o.kind === 'size' ? `Font size ${o.value} is not on the type scale` : `Font weight ${o.value} is not in the system`,
        spacing: `Spacing ${o.value} (${o.kind}) is off the spacing scale`,
        radius: `Corner radius ${o.value} is not a radius token`,
        shadow: 'Shadow does not match any shadow token',
        components: `${o.kind[0].toUpperCase() + o.kind.slice(1)} “${o.value}” doesn't follow the ${c.system.name} spec`,
      }[cat.key];
      add('design', sev, label, `Used ${o.n}× across ${o.pages.length} page${o.pages.length === 1 ? '' : 's'}${cat.key !== 'components' ? '' : ''}. ${cat.key === 'components' ? 'Problems: ' + o.expected + '.' : 'Closest token: ' + o.expected + '.'}`,
        cat.key === 'color' ? (o.status === 'wrong-mode' ? `Use the ${c.mode}-mode value of the same semantic token.` : `Replace with the semantic token ${String(o.expected).split(' ')[0]} instead of a hard-coded value.`)
          : cat.key === 'components' ? `Use the ${c.system.name} ${o.kind} component, or apply its height and the brand's corner token.`
          : `Use the nearest token (${o.expected}) instead of a one-off value.`,
        { page: o.pages[0], rule: `ds:${cat.key}:${o.kind}:${o.value}`, principle: `Design system — ${c.system.name}${c.brand ? ` (${c.brand}, ${c.mode})` : ''} · Nielsen #4 Consistency`, evidence: (o.samples || []).map((s) => ({ selector: s.sel, text: s.text })) });
    }
  }
}


// ---------------------------------------------------------------- components
export const COMPONENT_STATUS = {
  library: { label: 'From the design system', short: 'Design system', fromDs: true, confirmed: true, help: 'Has a design-system marker (tag, attribute or class) and matches the spec.' },
  'library-modified': { label: 'Design-system component, overridden', short: 'DS, overridden', fromDs: true, confirmed: true, help: 'Comes from the library but its look was changed with custom styles.' },
  tokens: { label: 'Built with design tokens', short: 'Tokens', fromDs: true, confirmed: false, help: 'No library marker, but styled with the system’s CSS variables and matches the spec.' },
  matches: { label: 'Matches spec (unconfirmed)', short: 'Matches spec', fromDs: true, confirmed: false, help: 'No library marker or token variables, but its size, corners, font and colours match the spec.' },
  custom: { label: 'Custom-built, not from the design system', short: 'Custom', fromDs: false, confirmed: false, help: 'No library marker and it doesn’t match the component spec.' },
};

export function componentSpec(ds) {
  const d = ds.detect || {};
  return { prefixes: d.prefixes || [String(ds.id).split('-')[0]], attrs: d.attrs || ['data-component', 'data-ds'], varPrefixes: d.varPrefixes || [String(ds.id).split('-')[0] + '-'] };
}

function classifyComponents(audits, ds, B, brandKey, matchColor) {
  const specs = ds.components || {};
  const fonts = (ds.fonts || []).map((f) => f.toLowerCase());
  const radii = ds.radii || [];
  const items = [];
  for (const [page, a] of Object.entries(audits)) {
    for (const c of a.components?.components || []) {
      const spec = specs[c.kind] || null;
      const problems = [];
      if (spec) {
        if (spec.h && !c.iconOnly && !spec.h.some((h) => Math.abs(c.h - h) <= 1)) problems.push(`height ${c.h}px (spec: ${spec.sizes || spec.h.join(' / ') + 'px'})`);
        if (spec.minH && c.h < spec.minH) problems.push(`height ${c.h}px (min ${spec.minH}px)`);
        let want = null;
        if (spec.radius === 'button' || spec.radius === 'input') want = B?.radius?.[spec.radius] != null ? [B.radius[spec.radius]] : null;
        else if (Array.isArray(spec.radius)) want = spec.radius;
        if (want) {
          const ok = want.some((w) => (w >= 500 ? c.radius >= c.h / 2 - 1 : Math.abs(c.radius - w) <= 1));
          if (!ok) problems.push(`corner ${c.radius}px (${spec.radius === 'button' || spec.radius === 'input' ? `${brandKey} ${spec.radius}s use ` : 'spec '}${want.map((w) => (w >= 500 ? 'fully rounded' : w + 'px')).join(' / ')})`);
        } else if (c.radius && radii.length && !radii.some((r) => Math.abs(r - c.radius) <= 1) && c.radius < c.h / 2 - 1) problems.push(`corner ${c.radius}px is not a radius token`);
        if (spec.font && fonts.length && c.font && !fonts.some((f) => c.font.toLowerCase().includes(f))) problems.push(`font ${c.font}`);
      }
      for (const [prop, role] of [['bg', 'background'], ['color', 'text'], ['border', 'border']]) {
        const hex = c[prop];
        if (!hex || (prop === 'color' && c.iconOnly)) continue;
        const m = matchColor(hex);
        if (!m || m.de > 2.3) problems.push(`${role} ${hex} is not a token`);
        else if (m.kind === 'other-brand') problems.push(`${role} ${hex} is another brand’s colour`);
        else if (m.kind === 'primitive') problems.push(`${role} ${hex} is a raw palette colour`);
        else if (m.kind === 'other-mode') problems.push(`${role} ${hex} is from the other colour mode`);
      }
      const status = c.marker ? (problems.length ? 'library-modified' : 'library') : c.vars && problems.length === 0 ? 'tokens' : problems.length === 0 && spec ? 'matches' : 'custom';
      items.push({ page, kind: c.kind, text: c.text, sel: c.sel, rect: c.rect, status, fromDs: COMPONENT_STATUS[status].fromDs, marker: c.marker, vars: c.vars, problems, figma: spec?.figma || null, inSystem: !!spec });
    }
  }
  const by = (k) => items.filter((x) => x.status === k).length;
  const kinds = {};
  for (const x of items) {
    const k = (kinds[x.kind] = kinds[x.kind] || { kind: x.kind, figma: x.figma, inSystem: x.inSystem, total: 0, library: 0, 'library-modified': 0, tokens: 0, matches: 0, custom: 0 });
    k.total++; k[x.status]++;
  }
  const kindList = Object.values(kinds).map((k) => ({ ...k, coverage: Math.round(((k.library + k['library-modified'] + k.tokens + k.matches) / k.total) * 100) })).sort((a, b) => b.total - a.total);
  const perPage = {};
  for (const x of items) { const p = (perPage[x.page] = perPage[x.page] || { page: x.page, total: 0, fromDs: 0, confirmed: 0 }); p.total++; if (x.fromDs) p.fromDs++; if (COMPONENT_STATUS[x.status].confirmed) p.confirmed++; }
  const markerFound = items.some((x) => x.marker);
  const total = items.length, fromDs = items.filter((x) => x.fromDs).length, confirmed = by('library') + by('library-modified');
  return {
    total, fromDs, confirmed, custom: by('custom'),
    counts: Object.fromEntries(Object.keys(COMPONENT_STATUS).map((k) => [k, by(k)])),
    coverage: total ? Math.round((fromDs / total) * 100) : null,
    confirmedCoverage: total ? Math.round((confirmed / total) * 100) : null,
    markerFound, kinds: kindList, pages: Object.values(perPage),
    items: items.sort((a, b) => (a.fromDs - b.fromDs) || a.kind.localeCompare(b.kind)).slice(0, 300),
  };
}

// Light/dark & brand auto-detection from what the page actually shows
export function detectTheme(audits, ds) {
  const useMap = {};
  let bgLum = [];
  const fills = [];
  for (const a of Object.values(audits)) for (const c of a.components?.components || []) if (c.bg && /Button|Tabs|Badge|Switch|Checkbox|Nav Bar/.test(c.kind)) fills.push(c.bg);
  for (const a of Object.values(audits)) {
    for (const prop of ['background', 'color', 'borderColor']) for (const [hex, u] of Object.entries(a.styles?.usage?.[prop] || {})) useMap[hex.slice(0, 7)] = (useMap[hex.slice(0, 7)] || 0) + u.n;
    const big = Object.entries(a.styles?.usage?.background || {}).sort((x, y) => y[1].n - x[1].n)[0];
    if (big) { const [r, g, b] = [1, 3, 5].map((i) => parseInt(big[0].slice(i, i + 2), 16)); bgLum.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255); }
  }
  const mode = bgLum.length && bgLum.reduce((s, x) => s + x, 0) / bgLum.length < 0.35 ? 'dark' : 'light';
  // Only colourful brand colours identify a brand (greys are shared by every brand / the Default theme).
  const chroma = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; };
  const names = Object.keys(ds.brands || {});
  let brand = names.find((n) => /default/i.test(n)) || names[0] || null, best = 0;
  for (const [name, b] of Object.entries(ds.brands || {})) {
    const prim = [...new Set(['primary', 'secondary', 'selected', 'sidebar-primary'].map((k) => b.theme?.[`color/${mode}/${k}`]).filter((h) => h && chroma(h) > 0.25))];
    // brand colour as a component fill (primary button, selected tab…) counts 5×; as text/border 1×
    const hits = prim.reduce((s, h) => s
      + Object.entries(useMap).filter(([x]) => deltaE(x, h) <= 3).reduce((t, [, n]) => t + n, 0)
      + 5 * fills.filter((x) => deltaE(x, h) <= 3).length, 0);
    if (hits > best) { best = hits; brand = name; }
  }
  return { brand, mode, confident: best > 0 };
}
