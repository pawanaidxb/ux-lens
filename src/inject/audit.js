// Evaluated in the page (page.evaluate) to run a static UX audit of the
// current DOM. Returns raw measurements; scoring happens in Node (analyze.js).
() => {
  const vw = innerWidth, vh = innerHeight;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05;
  };
  const cssPath = (el) => {
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
  const text = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };

  // ---------- colour / contrast ----------
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    let layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null; // can't judge images/gradients
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255 };
    for (const c of layers.reverse()) out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) };
    return out;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  const textEls = [];
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode() && textEls.length < 1500) {
    const n = walker.currentNode;
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    seen.add(el);
    if (visible(el)) textEls.push(el);
  }

  const contrastFails = [];
  const smallText = [];
  const longLines = [];
  let checkedText = 0;
  const fontSizes = new Map();
  const fontFamilies = new Map();
  const colours = new Map();
  for (const el of textEls) {
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    const size = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight) || 400;
    fontSizes.set(Math.round(size), (fontSizes.get(Math.round(size)) || 0) + 1);
    const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    fontFamilies.set(fam, (fontFamilies.get(fam) || 0) + 1);
    if (fg) colours.set(`${fg.r},${fg.g},${fg.b}`, (colours.get(`${fg.r},${fg.g},${fg.b}`) || 0) + 1);
    const bg = bgOf(el);
    if (fg && bg) {
      checkedText++;
      const cr = ratio(fg, bg);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      if (cr < need) contrastFails.push({ selector: cssPath(el), text: text(el), ratio: +cr.toFixed(2), need, size, rect: rectOf(el) });
    }
    if (size < 12 && el.innerText.trim().length > 3) smallText.push({ selector: cssPath(el), text: text(el), size, rect: rectOf(el) });
    if (['P', 'LI', 'DD', 'BLOCKQUOTE'].includes(el.tagName) && el.innerText.length > 200) {
      const chars = el.getBoundingClientRect().width / (size * 0.5);
      if (chars > 100) longLines.push({ selector: cssPath(el), chars: Math.round(chars), rect: rectOf(el) });
    }
  }

  // ---------- interactive targets (Fitts's law, WCAG 2.5.8) ----------
  const interactive = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[onclick]')].filter(visible);
  const smallTargets = [];
  const unlabeled = [];
  const rects = [];
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    rects.push(r);
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p,li,td');
    if (!inline && (r.width < 24 || r.height < 24)) smallTargets.push({ selector: cssPath(el), text: text(el), w: Math.round(r.width), h: Math.round(r.height), rect: rectOf(el) });
    const name = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title || (el.innerText || '').trim() || el.value || el.querySelector?.('img[alt]:not([alt=""])') || el.getAttribute('placeholder');
    const pseudo = (w) => { const c = getComputedStyle(el, w).content; return c && c !== 'none' && c !== 'normal' && c !== '""'; };
    const hasLabel = el.labels?.length || el.closest('label') || el.getAttribute('aria-describedby') || pseudo('::before') || pseudo('::after') || el.querySelector?.('svg title, [aria-label]');
    if (!name && !hasLabel && el.type !== 'submit') unlabeled.push({ selector: cssPath(el), tag: el.tagName.toLowerCase(), rect: rectOf(el) });
  }
  // crowded targets: centres closer than 24px
  let crowded = 0;
  for (let i = 0; i < rects.length && i < 400; i++) for (let j = i + 1; j < rects.length && j < 400; j++) {
    const a = rects[i], b = rects[j];
    const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
    const dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
    if (dx === 0 && dy === 0) continue; // nested/overlapping
    if (dx < 2 && dy < 2 && (a.width < 24 || b.width < 24)) crowded++;
  }

  // ---------- form fields without labels ----------
  const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')].filter(visible);
  const fieldsNoLabel = fields.filter((f) => !(f.labels?.length || f.getAttribute('aria-label') || f.getAttribute('aria-labelledby') || f.closest('label')))
    .map((f) => ({ selector: cssPath(f), placeholder: f.placeholder || '', rect: rectOf(f) }));
  const placeholderOnly = fieldsNoLabel.filter((f) => f.placeholder).length;
  const forms = [...document.querySelectorAll('form')].filter(visible).map((f) => ({
    selector: cssPath(f),
    fields: f.querySelectorAll('input:not([type=hidden]):not([type=submit]),select,textarea').length,
    required: f.querySelectorAll('[required],[aria-required=true]').length,
    autocomplete: f.querySelectorAll('[autocomplete]:not([autocomplete=off])').length,
  }));

  // ---------- navigation choices (Hick's / Miller's law) ----------
  const navs = [...document.querySelectorAll('nav,[role=navigation],header ul')].filter(visible).map((n) => ({
    selector: cssPath(n),
    items: [...n.querySelectorAll('a[href],button')].filter(visible).length,
  }));
  const maxNav = navs.reduce((m, n) => Math.max(m, n.items), 0);

  // ---------- above the fold ----------
  const fold = interactive.filter((el) => { const r = el.getBoundingClientRect(); return r.top + scrollY < vh && r.bottom > 0; });
  const buttonsAboveFold = fold.filter((el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || /btn|button|cta/i.test(el.className)).length;
  const h1 = [...document.querySelectorAll('h1')].filter(visible);
  const h1AboveFold = h1.some((h) => h.getBoundingClientRect().top + scrollY < vh);

  // ---------- headings / structure ----------
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => +h.tagName[1]);
  let skips = 0;
  for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i - 1] > 1) skips++;
  const landmarks = {
    main: !!document.querySelector('main,[role=main]'),
    nav: !!document.querySelector('nav,[role=navigation]'),
    header: !!document.querySelector('header,[role=banner]'),
    footer: !!document.querySelector('footer,[role=contentinfo]'),
  };
  const skipLink = [...document.querySelectorAll('a[href^="#"]')].slice(0, 5).some((a) => /skip|main content/i.test(a.textContent));

  // ---------- images & media ----------
  const imgs = [...document.querySelectorAll('img')];
  const imgNoAlt = imgs.filter((i) => !i.hasAttribute('alt') && visible(i)).map((i) => ({ selector: cssPath(i), src: (i.currentSrc || i.src).slice(-80), rect: rectOf(i) }));
  const imgNoDims = imgs.filter((i) => !i.getAttribute('width') && !i.getAttribute('height') && !i.style.aspectRatio).length;
  const bigImgs = imgs.filter((i) => i.naturalWidth > i.clientWidth * 2.5 && i.clientWidth > 50).length;
  const autoplay = [...document.querySelectorAll('video[autoplay],audio[autoplay]')].filter((v) => !v.muted).length;

  // ---------- links ----------
  const vague = /^(click here|here|read more|more|learn more|link|this|go)$/i;
  const links = [...document.querySelectorAll('a[href]')].filter(visible);
  const vagueLinks = links.filter((a) => vague.test((a.innerText || '').trim()) && !a.getAttribute('aria-label')).map((a) => ({ selector: cssPath(a), text: a.innerText.trim(), rect: rectOf(a) }));
  const newTab = links.filter((a) => a.target === '_blank' && !/new (tab|window)/i.test(a.getAttribute('aria-label') || a.title || a.innerText)).length;
  const emptyHref = links.filter((a) => ['#', 'javascript:void(0)', 'javascript:;'].includes(a.getAttribute('href'))).length;

  // ---------- focus visibility (sample) ----------
  let noFocusRing = 0, focusSampled = 0;
  const prevActive = document.activeElement;
  const userBusy = prevActive && prevActive !== document.body && prevActive.matches?.('input,textarea,select,[contenteditable]');
  window.__uxaAuditing = true;
  for (const el of userBusy ? [] : interactive.slice(0, 25)) {
    const before = getComputedStyle(el);
    const o1 = before.outlineStyle + before.outlineWidth + before.boxShadow;
    try { el.focus({ preventScroll: true }); } catch (_) { continue; }
    if (document.activeElement !== el) continue;
    focusSampled++;
    const after = getComputedStyle(el);
    const o2 = after.outlineStyle + after.outlineWidth + after.boxShadow;
    if (o1 === o2 && (after.outlineStyle === 'none' || after.outlineWidth === '0px')) noFocusRing++;
    el.blur();
  }
  try { if (!userBusy && prevActive && prevActive.focus) prevActive.focus({ preventScroll: true }); } catch (_) {}
  window.__uxaAuditing = false;

  // ---------- consistency (design tokens) ----------
  const btnStyles = new Set([...document.querySelectorAll('button,[role=button],a.btn,a.button,input[type=submit]')].filter(visible).slice(0, 100).map((b) => {
    const s = getComputedStyle(b);
    return [s.backgroundColor, s.borderRadius, s.fontSize, s.paddingTop].join('|');
  }));

  // ---------- misc ----------
  const meta = document.querySelector('meta[name=viewport]')?.content || '';
  const docW = document.documentElement.scrollWidth;
  const domNodes = document.getElementsByTagName('*').length;
  const words = (document.body?.innerText || '').split(/\s+/).filter(Boolean).length;
  const modals = [...document.querySelectorAll('[role=dialog],[aria-modal=true],.modal.show,dialog[open]')].filter(visible).length;
  const loading = [...document.querySelectorAll('[aria-busy=true],[role=progressbar],.spinner,.loading,.skeleton')].filter(visible).length;
  const liveRegions = document.querySelectorAll('[aria-live],[role=alert],[role=status]').length;
  const breadcrumbs = !!document.querySelector('[aria-label*=breadcrumb i],.breadcrumb,nav ol');
  const search = !!document.querySelector('input[type=search],[role=search],input[name*=search i],input[placeholder*=search i]');

  return {
    url: location.href, title: document.title, lang: document.documentElement.lang || '',
    viewport: { w: vw, h: vh, docW, docH: document.documentElement.scrollHeight, metaViewport: meta, hScroll: docW > vw + 5 },
    counts: { interactive: interactive.length, links: links.length, images: imgs.length, fields: fields.length, forms: forms.length, domNodes, words, textChecked: checkedText },
    contrastFails: contrastFails.slice(0, 40), contrastFailCount: contrastFails.length,
    smallText: smallText.slice(0, 20), smallTextCount: smallText.length,
    longLines: longLines.slice(0, 10),
    smallTargets: smallTargets.slice(0, 40), smallTargetCount: smallTargets.length, crowded,
    unlabeled: unlabeled.slice(0, 20), unlabeledCount: unlabeled.length,
    fieldsNoLabel: fieldsNoLabel.slice(0, 20), fieldsNoLabelCount: fieldsNoLabel.length, placeholderOnly, forms,
    navs, maxNav,
    fold: { interactive: fold.length, buttons: buttonsAboveFold, h1: h1AboveFold },
    h1Count: h1.length, headingSkips: skips, headings: heads.length, landmarks, skipLink,
    imgNoAlt: imgNoAlt.slice(0, 20), imgNoAltCount: imgNoAlt.length, imgNoDims, bigImgs, autoplay,
    vagueLinks: vagueLinks.slice(0, 15), vagueLinkCount: vagueLinks.length, newTab, emptyHref,
    focus: { sampled: focusSampled, missing: noFocusRing },
    tokens: { fontSizes: fontSizes.size, fontFamilies: [...fontFamilies.keys()].slice(0, 8), textColours: colours.size, buttonVariants: btnStyles.size },
    modals, loading, liveRegions, breadcrumbs, search,
  };
}
