// Evaluated in the page. Collects the computed design values actually used by
// visible elements, so they can be checked against design-system tokens in Node.
// Returns aggregated usage (value -> count + sample elements) rather than raw
// per-element data, so the payload stays small on large pages.
() => {
  const MAX_EL = 4000;
  const vis = (el, r) => {
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom < -2000 || r.top > (document.documentElement.scrollHeight + 50)) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05;
  };
  const path = (el) => {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 4) {
      let p = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(p + '#' + el.id); break; }
      const cls = [...el.classList].filter((c) => !/\d{3,}|^css-|^sc-/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.join('.');
      parts.unshift(p);
      el = el.parentElement;
    }
    return parts.join(' > ');
  };
  const rect = (r) => ({ x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) });
  const hex = (c) => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (a === 0) return null;
    const h = '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    return a < 1 ? h + Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase() : h;
  };
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

  // usage[prop][value] = { n, samples: [{sel, rect, tag}] }
  const usage = {};
  const use = (prop, value, el, r) => {
    if (value == null || value === '') return;
    const m = (usage[prop] = usage[prop] || {});
    const u = (m[value] = m[value] || { n: 0, samples: [] });
    u.n++;
    if (u.samples.length < 4) u.samples.push({ sel: path(el), rect: rect(r), tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || '').trim().slice(0, 40) });
  };

  const TEXT_TAGS = /^(P|SPAN|A|LI|H[1-6]|LABEL|BUTTON|TD|TH|DT|DD|STRONG|EM|B|I|SMALL|CAPTION|FIGCAPTION|BLOCKQUOTE|LEGEND|SUMMARY|INPUT|TEXTAREA|SELECT|OPTION)$/;
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName);

  const all = document.body ? document.body.getElementsByTagName('*') : [];
  let n = 0;
  const controls = [];
  for (const el of all) {
    if (n >= MAX_EL) break;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|PATH|G|DEFS|USE|SYMBOL|META|LINK|BR|HR|IFRAME)$/i.test(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (!vis(el, r)) continue;
    n++;
    const s = getComputedStyle(el);

    if (hasOwnText(el) && TEXT_TAGS.test(el.tagName) || (hasOwnText(el) && el.tagName === 'DIV')) {
      use('color', hex(s.color), el, r);
      use('fontSize', px(s.fontSize), el, r);
      use('fontWeight', +s.fontWeight || 400, el, r);
      use('fontFamily', s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), el, r);
      if (s.lineHeight !== 'normal') use('lineHeight', px(s.fontSize) + '/' + px(s.lineHeight), el, r);
    }
    const bg = hex(s.backgroundColor);
    if (bg) use('background', bg, el, r);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = px(s['border' + side + 'Width']);
      if (w && s['border' + side + 'Style'] !== 'none') { use('borderColor', hex(s['border' + side + 'Color']), el, r); use('borderWidth', w, el, r); break; }
    }
    const rad = px(s.borderTopLeftRadius);
    if (rad && (bg || px(s.borderTopWidth))) use('radius', Math.min(rad, 999), el, r);
    for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) { const v = px(s[p]); if (v) use('padding', v, el, r); }
    for (const p of ['marginTop', 'marginBottom']) { const v = px(s[p]); if (v && v > 0) use('margin', v, el, r); }
    if (/flex|grid/.test(s.display)) { const g = px(s.rowGap) || px(s.columnGap); if (g) use('gap', g, el, r); }
    if (s.boxShadow && s.boxShadow !== 'none') use('shadow', s.boxShadow.replace(/\s+/g, ' ').slice(0, 160), el, r);

    // component samples (buttons, inputs) for component-spec checks
    const role = el.getAttribute('role');
    const kind = el.tagName === 'BUTTON' || role === 'button' || (el.tagName === 'INPUT' && /^(submit|button|reset)$/.test(el.type)) || (el.tagName === 'A' && /btn|button/i.test(el.className))
      ? 'button' : (el.tagName === 'INPUT' && !/^(checkbox|radio|range|color|file|hidden|submit|button|reset|image)$/.test(el.type)) || el.tagName === 'TEXTAREA' ? 'input' : el.tagName === 'SELECT' ? 'select' : null;
    if (kind && controls.length < 150) controls.push({ kind, sel: path(el), rect: rect(r), text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 40),
      h: Math.round(r.height), radius: rad || 0, bg, color: hex(s.color), font: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: px(s.fontSize), weight: +s.fontWeight || 400,
      border: px(s.borderTopWidth) ? hex(s.borderTopColor) : null, iconOnly: !(el.innerText || el.value || '').trim() });
  }

  // CSS custom properties defined on :root — shows whether the page uses a token layer at all
  const vars = {};
  try {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules || []) {
        if (!rule.style || !/^(:root|html|body|\[data-theme[^\]]*\]|\.theme-[\w-]+)$/.test((rule.selectorText || '').trim())) continue;
        for (const p of rule.style) if (p.startsWith('--')) vars[p] = rule.style.getPropertyValue(p).trim().slice(0, 60);
      }
    }
  } catch {}

  return { elements: n, truncated: n >= MAX_EL, usage, controls, vars: Object.fromEntries(Object.entries(vars).slice(0, 400)), varCount: Object.keys(vars).length };
}
