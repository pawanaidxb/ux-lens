// Injected into every page of the analysed site (main frame only).
// Captures real user interaction signals and ships them to the Node process
// through the `__uxa_emit` binding exposed by Playwright.
(() => {
  if (window.top !== window || window.__uxaInstalled) return;
  window.__uxaInstalled = true;

  const queue = [];
  const now = () => Date.now();
  const emit = (type, data = {}) => {
    queue.push({ ...data, type, t: now(), url: location.href });
  };
  const flush = () => {
    if (!queue.length || typeof window.__uxa_emit !== 'function') return;
    const batch = queue.splice(0, queue.length);
    try { window.__uxa_emit(batch); try { sessionStorage.removeItem(STORE); } catch (_) {} } catch (_) { queue.unshift(...batch); }
  };
  // Events queued right before a navigation would be lost on unload, so persist
  // them in sessionStorage and replay them on the next page of the same origin.
  const STORE = '__uxa_pending';
  try {
    const pending = JSON.parse(sessionStorage.getItem(STORE) || '[]');
    sessionStorage.removeItem(STORE);
    if (pending.length) queue.push(...pending);
  } catch (_) {}
  const persist = () => { try { if (queue.length) sessionStorage.setItem(STORE, JSON.stringify(queue.slice(-200))); } catch (_) {} };
  setInterval(flush, 400);
  addEventListener('pagehide', () => { persist(); flush(); });
  addEventListener('beforeunload', persist);
  addEventListener('visibilitychange', () => {
    emit('visibility', { state: document.visibilityState });
    flush();
  });

  // ---------- helpers ----------
  const INTERACTIVE_SEL =
    'a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[onclick],[tabindex]:not([tabindex="-1"]),[contenteditable=""],[contenteditable=true]';

  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 5) {
      let p = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(p + '#' + CSS.escape(el.id)); break; }
      const cls = [...el.classList].filter((c) => !/\d{3,}|^css-|^sc-|__/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const parent = el.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === el.tagName);
        if (same.length > 1) p += `:nth-of-type(${same.indexOf(el) + 1})`;
      }
      parts.unshift(p);
      el = parent;
    }
    return parts.join(' > ');
  };

  const label = (el) => {
    if (!el) return '';
    const t =
      el.getAttribute?.('aria-label') ||
      el.getAttribute?.('title') ||
      el.getAttribute?.('placeholder') ||
      el.getAttribute?.('name') ||
      (el.innerText || el.value || el.alt || '').trim();
    return String(t).replace(/\s+/g, ' ').slice(0, 80);
  };

  const interactiveAncestor = (el) => {
    const hit = el?.closest?.(INTERACTIVE_SEL);
    if (hit) return hit;
    // cursor:pointer is a strong hint of a JS-handled control
    let n = el;
    for (let i = 0; n && i < 4; i++, n = n.parentElement) {
      if (n.nodeType === 1 && getComputedStyle(n).cursor === 'pointer') return n;
    }
    return null;
  };

  const pageKey = () => {
    const h = location.hash.startsWith('#/') ? location.hash : '';
    return location.origin + location.pathname + h;
  };

  // ---------- DOM change counter (to detect dead clicks) ----------
  let mutations = 0;
  const mo = new MutationObserver((list) => { mutations += list.length; });
  const startMO = () =>
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  if (document.documentElement) startMO(); else addEventListener('DOMContentLoaded', startMO);

  let lastError = 0;
  addEventListener('error', (e) => {
    lastError = now();
    if (e.target && e.target !== window && e.target.tagName) {
      emit('resource_error', { tag: e.target.tagName.toLowerCase(), src: e.target.src || e.target.href || '' });
    } else {
      emit('js_error', { message: String(e.message || e.error || 'Error').slice(0, 300) });
    }
  }, true);
  addEventListener('unhandledrejection', (e) => {
    lastError = now();
    emit('js_error', { message: 'Unhandled promise rejection: ' + String(e.reason?.message || e.reason).slice(0, 280) });
  });

  // ---------- clicks: rage / dead / error clicks ----------
  const recent = [];
  let navigatedAt = 0;
  addEventListener('click', (e) => {
    const el = e.target;
    const inter = interactiveAncestor(el);
    const target = inter || el;
    const r = target.getBoundingClientRect?.() || { width: 0, height: 0 };
    const click = {
      x: Math.round(e.pageX), y: Math.round(e.pageY),
      vx: Math.round(e.clientX), vy: Math.round(e.clientY),
      vw: innerWidth, vh: innerHeight,
      docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight,
      selector: cssPath(target), tag: target.tagName?.toLowerCase(), text: label(target),
      interactive: !!inter, w: Math.round(r.width), h: Math.round(r.height), page: pageKey(),
    };
    emit('click', click);
    flush(); // send now, in case this click navigates away

    const t = now();
    recent.push({ t, x: e.clientX, y: e.clientY });
    while (recent.length && t - recent[0].t > 800) recent.shift();
    const near = recent.filter((c) => Math.hypot(c.x - e.clientX, c.y - e.clientY) < 40);
    if (near.length >= 3 && !['input', 'textarea', 'select'].includes(click.tag)) {
      emit('rage_click', { ...click, count: near.length });
      recent.length = 0;
    }

    const m0 = mutations;
    const href0 = location.href;
    setTimeout(() => {
      const changed = mutations !== m0 || location.href !== href0 || navigatedAt > t;
      if (lastError >= t) emit('error_click', { ...click });
      else if (!changed && !['input', 'textarea', 'select', 'label', 'option'].includes(click.tag))
        emit('dead_click', { ...click });
    }, 1000);
  }, true);

  // ---------- hover hesitation on interactive elements ----------
  let hoverEl = null, hoverStart = 0;
  addEventListener('mouseover', (e) => {
    const el = interactiveAncestor(e.target);
    if (el === hoverEl) return;
    if (hoverEl && now() - hoverStart > 2500)
      emit('hesitation', { selector: cssPath(hoverEl), text: label(hoverEl), ms: now() - hoverStart, page: pageKey() });
    hoverEl = el; hoverStart = now();
  }, true);
  addEventListener('mousedown', () => { hoverEl = null; }, true);

  // ---------- mouse movement sampling (for attention map) ----------
  let lastMove = 0, travel = 0, lx = null, ly = null;
  addEventListener('mousemove', (e) => {
    if (lx !== null) travel += Math.hypot(e.clientX - lx, e.clientY - ly);
    lx = e.clientX; ly = e.clientY;
    const t = now();
    if (t - lastMove < 150) return;
    lastMove = t;
    emit('move', { x: Math.round(e.pageX), y: Math.round(e.pageY), page: pageKey() });
  }, { passive: true });

  // ---------- scroll depth & u-turns ----------
  let maxDepth = 0, lastY = scrollY, dir = 0, uturns = 0, scrollTimer;
  addEventListener('scroll', () => {
    const docH = document.documentElement.scrollHeight;
    const depth = Math.min(100, Math.round(((scrollY + innerHeight) / Math.max(docH, 1)) * 100));
    maxDepth = Math.max(maxDepth, depth);
    const d = Math.sign(scrollY - lastY);
    if (d && dir && d !== dir && Math.abs(scrollY - lastY) > 2) uturns++;
    if (d) dir = d;
    lastY = scrollY;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => emit('scroll', { depth: maxDepth, uturns, y: Math.round(scrollY), docH, page: pageKey() }), 250);
  }, { passive: true });

  // ---------- forms ----------
  const fieldState = new WeakMap();
  const fieldId = (el) => el.name || el.id || el.getAttribute('aria-label') || el.placeholder || cssPath(el);
  addEventListener('focusin', (e) => {
    if (window.__uxaAuditing) return;
    const el = e.target;
    if (!el.matches?.('input,select,textarea,[contenteditable]')) return;
    const s = fieldState.get(el) || { focusCount: 0, total: 0, deletes: 0, inputs: 0, form: cssPath(el.form) };
    s.focusCount++; s.start = now();
    fieldState.set(el, s);
    emit('field_focus', { field: fieldId(el), ftype: el.type || el.tagName.toLowerCase(), form: s.form, page: pageKey() });
  }, true);
  addEventListener('focusout', (e) => {
    if (window.__uxaAuditing) return;
    const el = e.target, s = fieldState.get(el);
    if (!s || !s.start) return;
    const ms = now() - s.start; s.total += ms; s.start = 0;
    emit('field_blur', {
      field: fieldId(el), ftype: el.type || el.tagName.toLowerCase(), form: s.form, ms,
      focusCount: s.focusCount, deletes: s.deletes, inputs: s.inputs,
      filled: !!(el.value || el.textContent), page: pageKey(),
    });
  }, true);
  addEventListener('keydown', (e) => {
    const s = fieldState.get(e.target);
    if (!s) return;
    if (e.key === 'Backspace' || e.key === 'Delete') s.deletes++; else if (e.key.length === 1) s.inputs++;
    if (e.key === 'Tab') emit('keyboard_nav', { page: pageKey() });
  }, true);
  addEventListener('invalid', (e) => {
    emit('field_invalid', { field: fieldId(e.target), message: e.target.validationMessage, page: pageKey() });
  }, true);
  addEventListener('submit', (e) => {
    emit('form_submit', { form: cssPath(e.target), page: pageKey() });
  }, true);

  // ---------- performance (Core Web Vitals + long tasks) ----------
  const po = (type, cb, extra = {}) => {
    try { new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type, buffered: true, ...extra }); } catch (_) {}
  };
  let lcp = 0, cls = 0, inp = 0, longTasks = 0, longTaskMs = 0;
  po('largest-contentful-paint', (e) => { lcp = e.startTime; });
  po('layout-shift', (e) => { if (!e.hadRecentInput) cls += e.value; });
  po('longtask', (e) => { longTasks++; longTaskMs += e.duration; });
  po('event', (e) => {
    if (e.interactionId && e.duration > inp) {
      inp = e.duration;
      if (e.duration > 200) emit('slow_interaction', { ms: Math.round(e.duration), name: e.name, selector: cssPath(e.target), page: pageKey() });
    }
  }, { durationThreshold: 40 });

  const sendVitals = () => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    emit('vitals', {
      page: pageKey(), lcp: Math.round(lcp), cls: +cls.toFixed(3), inp: Math.round(inp),
      fcp: Math.round(fcp?.startTime || 0), ttfb: Math.round(nav?.responseStart || 0),
      dcl: Math.round(nav?.domContentLoadedEventEnd || 0), load: Math.round(nav?.loadEventEnd || 0),
      longTasks, longTaskMs: Math.round(longTaskMs),
      transfer: Math.round((nav?.transferSize || 0) / 1024),
    });
  };
  addEventListener('pagehide', () => { sendVitals(); flush(); });
  setInterval(sendVitals, 5000);

  // ---------- page views (incl. SPA route changes) ----------
  let lastKey = '';
  const pageview = (kind) => {
    const k = pageKey();
    if (k === lastKey) return;
    lastKey = k; navigatedAt = now();
    emit('pageview', { page: k, title: document.title, kind, ref: document.referrer });
    flush();
  };
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) { const r = orig.apply(this, a); setTimeout(() => pageview('route'), 50); return r; };
  }
  addEventListener('popstate', () => pageview('back'));
  addEventListener('hashchange', () => pageview('route'));
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => pageview('load'));
  else pageview('load');
})();
