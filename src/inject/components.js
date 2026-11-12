// Evaluated in the page with the design-system component spec as its argument.
// Finds UI components on the page, decides what kind each one is (button,
// input, card, tabs…) and gathers the evidence needed to decide whether it is
// a design-system component or a custom-built look-alike.
//
// Evidence of a design-system instance (strongest first):
//   1. a library marker: custom element tag (<echo-button>), data attribute
//      (data-echo, data-ds, data-component), or a class with the library prefix
//   2. the element uses the system's CSS variables (var(--echo-…), var(--color-…))
//   3. its measurements match the component spec (height, corners, font, colours)
(spec) => {
  const P = spec.prefixes.map((p) => p.toLowerCase());
  const vis = (el, r) => r.width >= 4 && r.height >= 4 && (() => { const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; })();
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
  const hex = (c) => { const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); if (a === 0) return null; return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase(); };
  const text = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 50);

  // ---- which CSS rules reference design-system variables? (computed styles lose var(), so read the stylesheets)
  const varSelectors = [];
  const varRe = new RegExp('var\\(--(' + spec.varPrefixes.map((v) => v.replace(/[-]/g, '\\-')).join('|') + ')', 'i');
  try {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      const walk = (list) => { for (const r of list || []) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText && varRe.test(r.cssText)) varSelectors.push(r.selectorText); } };
      walk(rules);
    }
  } catch {}
  const usesVars = (el) => {
    if (varRe.test(el.getAttribute('style') || '')) return true;
    for (const sel of varSelectors) { try { if (el.matches(sel)) return true; } catch {} }
    return false;
  };

  // ---- library markers
  // own marker only; a library custom element wrapping a native control (<echo-button><button>) also counts
  const markerOf = (el) => {
    const own = markerAt(el, 0);
    if (own) return own;
    for (let n = el.parentElement, d = 1; n && d <= 2; n = n.parentElement, d++) {
      const tag = n.tagName.toLowerCase();
      if (P.some((p) => tag.startsWith(p + '-')) && n.children.length === 1) return { how: 'tag', value: tag, depth: d };
    }
    return null;
  };
  const markerAt = (el, max) => {
    for (let n = el, d = 0; n && n.nodeType === 1 && d <= max; n = n.parentElement, d++) {
      const tag = n.tagName.toLowerCase();
      if (P.some((p) => tag.startsWith(p + '-'))) return { how: 'tag', value: tag, depth: d };
      for (const a of n.attributes) {
        const an = a.name.toLowerCase();
        if (spec.attrs.includes(an) || P.some((p) => an.startsWith('data-' + p))) return { how: 'attribute', value: `${a.name}${a.value ? '="' + a.value.slice(0, 30) + '"' : ''}`, depth: d };
      }
      const cls = [...n.classList].find((c) => P.some((p) => c.toLowerCase().startsWith(p + '-') || c.toLowerCase().startsWith(p + '_')));
      if (cls) return { how: 'class', value: '.' + cls, depth: d };
    }
    return null;
  };
  const compName = (el) => {
    const m = markerOf(el);
    if (!m) return null;
    const v = m.value.replace(/^\./, '').replace(/^data-[\w-]+="?/, '').replace(/"$/, '').toLowerCase();
    return v;
  };

  // ---- what kind of component is this element?
  const rules = [
    ['Button', (el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || (el.tagName === 'INPUT' && /^(submit|button|reset)$/.test(el.type)) || (el.tagName === 'A' && /\b(btn|button|cta)\b/i.test(el.className))],
    ['Input', (el) => el.tagName === 'INPUT' && !/^(checkbox|radio|range|color|file|hidden|submit|button|reset|image)$/.test(el.type)],
    ['Text Area', (el) => el.tagName === 'TEXTAREA'],
    ['Select', (el) => el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox'],
    ['Checkbox', (el) => (el.tagName === 'INPUT' && el.type === 'checkbox') || el.getAttribute('role') === 'checkbox'],
    ['Radio / Item', (el) => (el.tagName === 'INPUT' && el.type === 'radio') || el.getAttribute('role') === 'radio'],
    ['Switch', (el) => el.getAttribute('role') === 'switch'],
    ['Tabs', (el) => el.getAttribute('role') === 'tablist'],
    ['Modal', (el) => el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true' || (el.tagName === 'DIALOG' && el.open)],
    ['Alert', (el) => el.getAttribute('role') === 'alert' || el.getAttribute('role') === 'status' || /\balert\b/i.test(el.className)],
    ['Tooltip', (el) => el.getAttribute('role') === 'tooltip'],
    ['Progress', (el) => el.tagName === 'PROGRESS' || el.getAttribute('role') === 'progressbar'],
    ['Breadcrumbs', (el) => /breadcrumb/i.test(el.getAttribute('aria-label') || '') || /\bbreadcrumbs?\b/i.test(el.className)],
    ['Pagination / Default', (el) => /pagination/i.test(el.getAttribute('aria-label') || '') || /\bpagination\b/i.test(el.className)],
    ['Data Table', (el) => el.tagName === 'TABLE' || el.getAttribute('role') === 'grid'],
    ['Accordion', (el) => el.tagName === 'DETAILS' || /\baccordion\b/i.test(el.className)],
    ['Avatar', (el) => /\bavatar\b/i.test(el.className)],
    ['Badge', (el) => /\b(badge|tag|chip|pill|label-status)\b/i.test(el.className) && el.getBoundingClientRect().height <= 32],
    ['Card', (el) => /\bcard\b/i.test(el.className) || el.tagName === 'ARTICLE'],
    ['Nav Bar/ Web', (el) => el.tagName === 'HEADER' || el.getAttribute('role') === 'banner' || (el.tagName === 'NAV' && el.getBoundingClientRect().top + scrollY < 120)],
    ['Sidebar', (el) => el.tagName === 'ASIDE' || (el.tagName === 'NAV' && el.getBoundingClientRect().height > innerHeight * 0.6)],
    ['Separator', (el) => el.tagName === 'HR' || el.getAttribute('role') === 'separator'],
    ['Spinner', (el) => /\b(spinner|loader|loading)\b/i.test(el.className)],
    ['Skeleton', (el) => /\bskeleton\b/i.test(el.className)],
  ];
  const kindOf = (el) => {
    const named = compName(el);
    if (named) for (const [k] of rules) {
      const kk = k.toLowerCase().replace(/[^a-z]/g, '');
      if (named.replace(/[^a-z]/g, '').includes(kk.replace('item', '').replace('default', '').replace('navbarweb', 'navbar'))) return k;
    }
    for (const [k, test] of rules) { try { if (test(el)) return k; } catch {} }
    // a styled, clickable box that isn't a <button> is a custom button
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (s.cursor === 'pointer' && hex(s.backgroundColor) && r.height >= 24 && r.height <= 64 && r.width <= 420 && (el.innerText || '').trim().length > 0 && (el.innerText || '').length < 40 && !el.closest('a,button')) return 'Button';
    return null;
  };

  const seen = new Set();
  const out = [];
  const els = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of els) {
    if (out.length >= 400) break;
    if (/^(tab|option|menuitem|menuitemradio|menuitemcheckbox|treeitem|row|cell|gridcell|columnheader)$/.test(el.getAttribute('role') || '')) continue; // parts of a parent component
    const kind = kindOf(el);
    if (!kind) continue;
    // skip pieces nested inside an already-counted component of the same kind (e.g. a button inside a button)
    let dup = false;
    for (let n = el.parentElement, d = 0; n && d < 4; n = n.parentElement, d++) if (seen.has(n) && n.__uxaKind === kind) { dup = true; break; }
    if (dup) continue;
    const r = el.getBoundingClientRect();
    if (!vis(el, r)) continue;
    seen.add(el); el.__uxaKind = kind;
    const s = getComputedStyle(el);
    out.push({
      kind, sel: path(el), text: text(el),
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      marker: markerOf(el), vars: usesVars(el),
      h: Math.round(r.height), radius: Math.round(parseFloat(s.borderTopLeftRadius) || 0),
      font: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: Math.round(parseFloat(s.fontSize)), weight: +s.fontWeight || 400,
      bg: hex(s.backgroundColor), color: hex(s.color), border: parseFloat(s.borderTopWidth) ? hex(s.borderTopColor) : null,
      shadow: s.boxShadow !== 'none', padX: Math.round(parseFloat(s.paddingLeft) || 0), padY: Math.round(parseFloat(s.paddingTop) || 0),
      native: /^(BUTTON|INPUT|SELECT|TEXTAREA|DIALOG|PROGRESS|TABLE|DETAILS|HR)$/.test(el.tagName) || !!el.getAttribute('role'),
      tag: el.tagName.toLowerCase(), iconOnly: !(el.innerText || el.value || '').trim(),
    });
  }
  return { components: out, varRules: varSelectors.length };
}
