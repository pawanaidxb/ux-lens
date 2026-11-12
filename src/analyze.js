// Turns a recorded session (interaction events + DOM audits + network/console)
// into a UX report scored against established principles.

export const CATEGORIES = {
  feedback: { name: 'Feedback & System Status', weight: 1.2, principle: 'Nielsen #1 — Visibility of system status', blurb: 'Does every action produce a visible, timely response?' },
  errors: { name: 'Error Prevention & Recovery', weight: 1.2, principle: 'Nielsen #5 & #9 — Error prevention; help users recover', blurb: 'Do things break, and can users recover when they do?' },
  efficiency: { name: 'Interaction Efficiency', weight: 1.0, principle: "Fitts's Law · Doherty Threshold", blurb: 'Are targets easy to hit and does the UI respond in < 400 ms?' },
  cognitive: { name: 'Cognitive Load', weight: 1.0, principle: "Hick's Law · Miller's Law · Nielsen #8", blurb: 'Is the number of choices and the amount of content manageable?' },
  frustration: { name: 'Frustration Signals', weight: 1.3, principle: 'Behavioural analytics — rage, dead & hesitation', blurb: 'What real interaction behaviour says about confusion.' },
  forms: { name: 'Forms & Input', weight: 1.0, principle: 'Nielsen #5 · WCAG 3.3 Input Assistance', blurb: 'Can users complete inputs without friction?' },
  accessibility: { name: 'Accessibility', weight: 1.2, principle: 'WCAG 2.2 AA — Perceivable, Operable, Understandable, Robust', blurb: 'Can everyone perceive and operate the interface?' },
  consistency: { name: 'Consistency & Standards', weight: 0.8, principle: "Nielsen #4 · Jakob's Law", blurb: 'Do things that look the same behave the same, and follow conventions?' },
  hierarchy: { name: 'Visual Hierarchy & Readability', weight: 0.8, principle: 'Gestalt · Aesthetic-Usability Effect · Nielsen #8', blurb: 'Is content structured and readable?' },
  performance: { name: 'Performance', weight: 1.1, principle: 'Core Web Vitals · Doherty Threshold', blurb: 'Does it load fast and stay visually stable?' },
  design: { name: 'Design System Compliance', weight: 0.9, principle: 'Design tokens · Nielsen #4 Consistency & standards', blurb: 'Does the UI use the design system’s colours, type, spacing and components?' },
};

const PENALTY = { critical: 26, major: 14, minor: 5 };
const SEV_ORDER = { critical: 0, major: 1, minor: 2 };

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const p75 = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.75)]; };
const shortPage = (k) => { try { const u = new URL(k); return (u.pathname + (u.hash || '')) || '/'; } catch { return k; } };

import { fingerprint } from '../public/diff.js';
import { loadSystem, checkCompliance, complianceFindings } from './designsystem.js';

export function analyze(session, { ignored = [], testers = 1, designSystem = null } = {}) {
  const { events, audits, network, console: consoleLog } = session;
  const findings = [];
  let fid = 0;
  const add = (category, severity, title, detail, fix, extra = {}) =>
    findings.push({ id: ++fid, category, severity, principle: extra.principle || CATEGORIES[category].principle, title, detail, fix, page: extra.page || null, evidence: (extra.evidence || []).slice(0, 12), metric: extra.metric, rule: extra.rule, source: extra.source || 'uxlens', helpUrl: extra.helpUrl, testers: extra.testers });

  const byType = (t) => events.filter((e) => e.type === t);
  const clicks = byType('click');
  const rage = byType('rage_click');
  const invalidEv = byType('field_invalid');
  const dead = byType('dead_click').filter((d) => !invalidEv.some((i) => i.t >= d.t - 1100 && i.t <= d.t));
  const errorClicks = byType('error_click');
  const hes = byType('hesitation');
  const jsErr = byType('js_error');
  const resErr = byType('resource_error');
  const slow = byType('slow_interaction');
  const pv = byType('pageview');
  const dialogs = byType('native_dialog');
  const end = session.endedAt || Date.now();
  const durationS = Math.max(1, (end - session.startedAt) / 1000);

  // ---------- journey / time on page ----------
  const journey = pv.map((p, i) => ({ page: p.page, title: p.title, kind: p.kind, t: p.t, dur: Math.round(((pv[i + 1]?.t || end) - p.t) / 1000) }));
  const backNavs = pv.filter((p) => p.kind === 'back').length;
  // loops: same page visited 3+ times
  const visits = {};
  journey.forEach((j) => (visits[j.page] = (visits[j.page] || 0) + 1));

  // ---------- per-page aggregation ----------
  const pageKeys = new Set([...Object.keys(audits), ...pv.map((p) => p.page)].filter(Boolean));
  const pages = [...pageKeys].map((key) => {
    const a = audits[key];
    const pc = clicks.filter((c) => c.page === key);
    const scrolls = byType('scroll').filter((s) => s.page === key);
    const vit = byType('vitals').filter((v) => v.page === key);
    const lastV = vit.reduce((m, v) => (v.lcp >= (m?.lcp || 0) || !m ? v : m), null) || vit[vit.length - 1];
    const maxCls = Math.max(0, ...vit.map((v) => v.cls));
    const maxInp = Math.max(0, ...vit.map((v) => v.inp));
    const moves = byType('move').filter((m) => m.page === key);
    const time = journey.filter((j) => j.page === key).reduce((s, j) => s + j.dur, 0);
    return {
      key, path: shortPage(key), title: a?.title || pv.find((p) => p.page === key)?.title || '',
      views: visits[key] || 0, timeSpent: time,
      clicks: pc.length,
      rage: rage.filter((c) => c.page === key).length, dead: dead.filter((c) => c.page === key).length,
      errorClicks: errorClicks.filter((c) => c.page === key).length,
      maxScroll: Math.max(0, ...scrolls.map((s) => s.depth)), uturns: Math.max(0, ...scrolls.map((s) => s.uturns)),
      vitals: lastV ? { ...lastV, cls: maxCls, inp: maxInp } : null,
      shot: session.shots[key] || null,
      heat: {
        clicks: pc.map((c) => ({ x: c.x, y: c.y, docW: c.docW, kind: rage.some((r) => r.t >= c.t && r.t - c.t < 900 && Math.hypot(r.x - c.x, r.y - c.y) < 40) ? 'rage' : dead.some((d) => d.t === c.t) ? 'dead' : 'ok' })),
        moves: moves.filter((_, i) => i % Math.ceil(moves.length / 2500 || 1) === 0).map((m) => [m.x, m.y]),
      },
      audit: a ? { counts: a.counts, tokens: a.tokens, viewport: a.viewport } : null,
      markers: [],
    };
  });
  const pageObj = Object.fromEntries(pages.map((p) => [p.key, p]));
  const mark = (pageKey, rect, sev, label) => { if (pageObj[pageKey] && rect) pageObj[pageKey].markers.push({ ...rect, sev, label }); };

  // =====================================================================
  // BEHAVIOURAL ANALYSIS
  // =====================================================================

  // ---- rage clicks
  const groupBy = (arr, k) => arr.reduce((m, x) => ((m[k(x)] = m[k(x)] || []).push(x), m), {});
  for (const [sel, list] of Object.entries(groupBy(rage, (r) => r.page + '|' + r.selector))) {
    const r = list[0];
    add('frustration', list.length > 1 || !r.interactive ? 'critical' : 'major',
      `Rage clicks on “${r.text || r.tag}”`,
      `User clicked ${list.reduce((s, x) => s + x.count, 0)} times in rapid succession on ${r.interactive ? 'an interactive element' : 'a non-interactive element'} (${list.length} burst${list.length > 1 ? 's' : ''}). This is a strong indicator the user expected something to happen and it didn't — or it was too slow.`,
      r.interactive ? 'Make the response immediate: show a pressed/loading state within 100 ms, disable while processing, and confirm completion.' : 'This element looks clickable but is not. Either make it interactive or remove the affordance (pointer cursor, underline, button-like styling).',
      { page: r.page, evidence: [{ selector: r.selector, text: r.text }], principle: 'Nielsen #1 Visibility of system status · Affordance' });
    mark(r.page, { x: r.x - 20, y: r.y - 20, w: 40, h: 40 }, 'critical', 'Rage click');
  }

  // ---- dead clicks
  const deadGroups = groupBy(dead, (d) => d.page + '|' + d.selector);
  for (const list of Object.values(deadGroups)) {
    const d = list[0];
    const sev = list.length >= 3 ? 'major' : d.interactive ? 'major' : 'minor';
    add('feedback', sev, `Dead click on “${d.text || d.tag}”`,
      `${list.length} click${list.length > 1 ? 's' : ''} produced no visible change (no DOM update, no navigation) within 1 s. ${d.interactive ? 'The element is interactive, so feedback is missing or delayed.' : 'The element is not interactive, but users treat it as if it is.'}`,
      d.interactive ? 'Provide immediate visual feedback (active state, spinner, toast) for every action.' : 'Users expect this to be clickable. Link it to the obvious destination or restyle it so it no longer looks actionable.',
      { page: d.page, evidence: [{ selector: d.selector, text: d.text }] });
    mark(d.page, { x: d.x - 14, y: d.y - 14, w: 28, h: 28 }, sev, 'Dead click');
  }
  if (clicks.length >= 8 && pct(dead.length, clicks.length) > 25)
    add('feedback', 'major', `${pct(dead.length, clicks.length)}% of all clicks were dead clicks`, `${dead.length} of ${clicks.length} clicks produced no response. Users are repeatedly misreading what is clickable.`, 'Audit affordances: clickable things should look clickable, and non-clickable things should not.', { metric: pct(dead.length, clicks.length) });

  // ---- error clicks
  for (const list of Object.values(groupBy(errorClicks, (d) => d.page + '|' + d.selector))) {
    const d = list[0];
    add('errors', 'critical', `Click on “${d.text || d.tag}” triggered a JavaScript error`, `${list.length} interaction(s) with this element threw a runtime error. The action likely failed silently.`, 'Fix the underlying error and add a user-facing error state with a way to retry.', { page: d.page, evidence: [{ selector: d.selector, text: d.text }] });
    mark(d.page, { x: d.x - 16, y: d.y - 16, w: 32, h: 32 }, 'critical', 'Error click');
  }

  // ---- hesitation
  for (const list of Object.values(groupBy(hes, (h) => h.page + '|' + h.selector))) {
    const h = list[0];
    const ms = Math.max(...list.map((x) => x.ms));
    if (ms < 2500) continue;
    add('cognitive', ms > 6000 ? 'major' : 'minor', `Hesitation over “${h.text || 'element'}”`, `User hovered for ${(ms / 1000).toFixed(1)} s without acting — a sign of uncertainty about what this control does or what will happen.`, 'Clarify the label, add helper text or a preview of the outcome; reduce ambiguity between similar options.', { page: h.page, evidence: [{ selector: h.selector, text: h.text }], principle: "Hick's Law · Nielsen #6 Recognition rather than recall" });
  }

  // ---- slow interactions (INP)
  for (const list of Object.values(groupBy(slow, (s) => s.page + '|' + s.selector))) {
    const s = list[0];
    const ms = Math.max(...list.map((x) => x.ms));
    add('efficiency', ms > 500 ? 'major' : 'minor', `Slow response: ${ms} ms after ${s.name}`, `Interaction took ${ms} ms to paint the next frame (Doherty threshold is 400 ms; INP “good” is ≤ 200 ms).`, 'Break up long tasks, defer non-critical work, and render optimistic UI immediately.', { page: s.page, evidence: [{ selector: s.selector }], principle: 'Doherty Threshold · INP' });
  }

  // ---- scroll u-turns / shallow reading
  for (const p of pages) {
    if (p.uturns >= 6) add('cognitive', p.uturns >= 12 ? 'major' : 'minor', `Repeated scrolling back and forth on ${p.path}`, `${p.uturns} scroll direction reversals — the user appears to be searching for something they cannot find.`, 'Improve scannability: clear headings, in-page navigation, search, or move key content higher.', { page: p.key, principle: 'Information scent · Nielsen #6' });
  }

  // ---- navigation loops / back usage
  for (const [k, n] of Object.entries(visits)) if (n >= 3) add('frustration', 'minor', `Pogo-sticking: ${shortPage(k)} visited ${n} times`, 'Returning to the same page repeatedly suggests users go down wrong paths and come back.', 'Strengthen information scent on links from this page; label destinations clearly.', { page: k, principle: 'Information Foraging · Nielsen #3 User control' });
  if (backNavs >= 3) add('frustration', 'minor', `${backNavs} back-button navigations`, 'Frequent back navigation often indicates mismatched expectations about link destinations.', 'Make link labels predict destination content; consider previews.', { principle: 'Nielsen #2 Match between system and real world' });

  // ---- native dialogs
  if (dialogs.length) add('consistency', 'minor', `${dialogs.length} native browser dialog(s) used (alert/confirm/prompt)`, dialogs.map((d) => `${d.kind}: “${d.message}”`).slice(0, 3).join(' · '), 'Use in-page, branded dialogs that explain consequences and offer clear actions.', { principle: 'Nielsen #4 Consistency · #9 Help recover' });

  // ---- forms
  const focuses = byType('field_focus');
  const blurs = byType('field_blur');
  const invalid = byType('field_invalid');
  const submits = byType('form_submit');
  const formStats = {};
  for (const f of focuses) { const k = f.page + '|' + (f.form || 'no-form'); (formStats[k] = formStats[k] || { page: f.page, form: f.form, fields: new Set(), submitted: false, invalid: 0, time: 0, corrections: 0 }).fields.add(f.field); }
  for (const b of blurs) { const k = b.page + '|' + (b.form || 'no-form'); const s = formStats[k]; if (s) { s.time += b.ms; } }
  for (const s of submits) for (const v of Object.values(formStats)) if (v.page === s.page && (!v.form || v.form === s.form)) v.submitted = true;
  for (const i of invalid) for (const v of Object.values(formStats)) if (v.page === i.page) v.invalid++;
  const fieldAgg = {};
  for (const b of blurs) { const k = b.page + '|' + b.field; const a = (fieldAgg[k] = fieldAgg[k] || { page: b.page, field: b.field, ms: 0, focus: 0, deletes: 0, inputs: 0 }); a.ms += b.ms; a.focus = Math.max(a.focus, b.focusCount); a.deletes = Math.max(a.deletes, b.deletes); a.inputs = Math.max(a.inputs, b.inputs); }
  for (const f of Object.values(fieldAgg)) {
    f.corrections = f.deletes;
    if (f.focus >= 3 || (f.deletes >= 6 && f.deletes > f.inputs * 0.4))
      add('forms', 'major', `Field friction: “${f.field}”`, `Focused ${f.focus}×, ${f.deletes} deletions vs ${f.inputs} keystrokes, ${(f.ms / 1000).toFixed(1)} s total. Users are struggling with the expected format or meaning.`, 'Show the expected format up front (example/mask), validate inline as the user types, and accept flexible input.', { page: f.page, evidence: [{ selector: f.field }] });
    else if (f.ms > 30000 && f.inputs < 40)
      add('forms', 'minor', `Long time on field “${f.field}”`, `${(f.ms / 1000).toFixed(0)} s spent in a field with little typing — users may not know what to enter.`, 'Add helper text, examples or sensible defaults.', { page: f.page, evidence: [{ selector: f.field }] });
  }
  for (const s of Object.values(formStats)) {
    if (!s.submitted && s.fields.size >= 2) add('forms', 'major', `Form started but not submitted (${s.fields.size} fields touched)`, `On ${shortPage(s.page)} the user interacted with ${s.fields.size} fields but never submitted.`, 'Reduce the number of fields, show progress, save drafts, and make the primary action obvious.', { page: s.page, evidence: [{ selector: s.form }], principle: 'Goal-Gradient Effect · Tesler’s Law' });
    if (s.invalid >= 2) add('forms', 'major', `${s.invalid} validation errors hit on submit`, 'Users were blocked by validation after attempting to submit.', 'Validate inline before submit, explain how to fix each error next to the field, and preserve entered data.', { page: s.page, principle: 'Nielsen #5 Error prevention · WCAG 3.3.1/3.3.3' });
  }

  // ---- runtime & network errors
  const jsGroups = groupBy(jsErr, (e) => e.message);
  for (const [msg, list] of Object.entries(jsGroups).slice(0, 10)) add('errors', 'major', `JavaScript error${list.length > 1 ? ` (×${list.length})` : ''}`, msg, 'Fix the error; wrap risky operations so failures show recoverable UI rather than breaking silently.', { page: list[0].page || pageKeyFromUrl(list[0].url) });
  const consoleErrors = consoleLog.filter((c) => c.type === 'error' && !Object.keys(jsGroups).some((m) => c.text.includes(m.slice(0, 40))));
  if (consoleErrors.length) add('errors', consoleErrors.length > 10 ? 'major' : 'minor', `${consoleErrors.length} console error(s)`, consoleErrors.slice(0, 3).map((c) => c.text).join(' · '), 'Investigate console errors — they often signal broken features users silently hit.', {});
  const failed = network.filter((n) => n.status === 0 || n.status >= 400);
  const failedDocs = failed.filter((n) => ['document', 'xhr', 'fetch'].includes(n.type));
  for (const n of failedDocs.slice(0, 8)) add('errors', n.type === 'document' ? 'critical' : 'major', `${n.method} ${n.status || n.error} — ${n.type} request failed`, n.url, n.status === 404 && n.type === 'document' ? 'Fix the broken link or provide a helpful 404 with search and navigation.' : 'Handle API failures gracefully: inform the user, keep their data, offer retry.', { page: n.page, principle: 'Nielsen #9 Help users recognize, diagnose, and recover from errors' });
  const failedAssets = failed.length - failedDocs.length + resErr.length;
  if (failedAssets) add('errors', failedAssets > 5 ? 'major' : 'minor', `${failedAssets} asset(s) failed to load`, failed.filter((n) => !failedDocs.includes(n)).slice(0, 4).map((n) => `${n.status || n.error} ${n.url}`).join(' · '), 'Fix broken images/scripts/styles; missing assets degrade perceived quality.', {});
  const slowReq = network.filter((n) => n.ms > 2000 && n.status && n.status < 400);
  if (slowReq.length) add('performance', slowReq.some((n) => n.ms > 5000) ? 'major' : 'minor', `${slowReq.length} slow request(s) > 2 s`, slowReq.slice(0, 4).map((n) => `${(n.ms / 1000).toFixed(1)}s ${n.type} ${n.url.slice(0, 90)}`).join(' · '), 'Speed up the backend or cache; show skeletons/progress while waiting.', { principle: 'Doherty Threshold' });

  // =====================================================================
  // STATIC AUDIT (per page)
  // =====================================================================
  const allA = Object.entries(audits);
  for (const [key, a] of allA) {
    const P = shortPage(key);
    const ev = (arr, f) => arr.map(f);

    // accessibility
    if (!a.axe && a.contrastFailCount) {
      add('accessibility', a.contrastFailCount > 10 ? 'critical' : a.contrastFailCount > 3 ? 'major' : 'minor', `${a.contrastFailCount} text element(s) fail colour contrast on ${P}`,
        `Lowest ratio ${Math.min(...a.contrastFails.map((c) => c.ratio))}:1 (needs 4.5:1 for body text, 3:1 for large text). ${pct(a.contrastFailCount, a.counts.textChecked)}% of checked text fails.`,
        'Darken text or lighten backgrounds to meet WCAG 1.4.3 contrast minimums.', { page: key, principle: 'WCAG 1.4.3 Contrast (Minimum)', evidence: ev(a.contrastFails, (c) => ({ selector: c.selector, text: `${c.text} — ${c.ratio}:1` })) });
      a.contrastFails.slice(0, 25).forEach((c) => mark(key, c.rect, 'minor', `Contrast ${c.ratio}:1`));
    }
    if (!a.axe && a.unlabeledCount) {
      add('accessibility', a.unlabeledCount > 5 ? 'critical' : 'major', `${a.unlabeledCount} control(s) without an accessible name on ${P}`, 'Screen-reader users hear only “button” or “link” with no purpose.', 'Add visible text, aria-label, or alt text on icon images inside the control.', { page: key, principle: 'WCAG 4.1.2 Name, Role, Value', evidence: ev(a.unlabeled, (u) => ({ selector: u.selector, text: u.tag })) });
      a.unlabeled.forEach((u) => mark(key, u.rect, 'major', 'No accessible name'));
    }
    if (!a.axe && (a.imgNoAltCount)) add('accessibility', a.imgNoAltCount > 5 ? 'major' : 'minor', `${a.imgNoAltCount} image(s) missing alt attribute on ${P}`, 'Images without alt are announced by file name or skipped unpredictably.', 'Add descriptive alt text, or alt="" for purely decorative images.', { page: key, principle: 'WCAG 1.1.1 Non-text Content', evidence: ev(a.imgNoAlt, (i) => ({ selector: i.selector, text: i.src })) });
    if (a.focus.sampled >= 3 && a.focus.missing / a.focus.sampled > 0.4) add('accessibility', 'major', `No visible focus indicator on ${a.focus.missing}/${a.focus.sampled} sampled controls (${P})`, 'Keyboard users cannot see where they are on the page.', 'Never remove outlines without replacement — use :focus-visible with a high-contrast ring.', { page: key, principle: 'WCAG 2.4.7 Focus Visible' });
    if (!a.axe && (!a.lang)) add('accessibility', 'minor', `Missing page language on ${P}`, '<html> has no lang attribute, so assistive tech may mispronounce content.', 'Add lang="en" (or the correct language) to the <html> element.', { page: key, principle: 'WCAG 3.1.1 Language of Page' });
    if (!a.axe && (!a.landmarks.main)) add('accessibility', 'minor', `No <main> landmark on ${P}`, 'Screen-reader users cannot jump directly to the main content.', 'Wrap primary content in <main>; add a “Skip to content” link.', { page: key, principle: 'WCAG 1.3.1 · 2.4.1 Bypass Blocks' });
    if (a.autoplay) add('accessibility', 'major', `${a.autoplay} media element(s) autoplay with sound`, 'Unexpected audio disorients users and interferes with screen readers.', 'Do not autoplay audio; provide play/pause controls.', { page: key, principle: 'WCAG 1.4.2 Audio Control' });

    // ---- axe-core (Deque) accessibility engine
    if (a.axe) {
      const IMPACT = { critical: 'critical', serious: 'major', moderate: 'minor', minor: 'minor' };
      for (const v of a.axe) {
        const wcag = v.tags.filter((t) => /^wcag\d{3,}$/.test(t)).map((t) => t.slice(4).split('').join('.')).join(', ');
        const sev = v.impact === 'serious' && v.count >= 10 ? 'critical' : IMPACT[v.impact] || 'minor';
        const cat = /label|form|select-name|autocomplete/.test(v.id) ? 'forms' : /heading|list|landmark|page-has|bypass|document-title|html-has-lang/.test(v.id) ? (v.id.startsWith('heading') ? 'hierarchy' : 'accessibility') : 'accessibility';
        add(cat, sev, `${v.help} (${v.count} element${v.count === 1 ? '' : 's'}) on ${P}`, v.description, `${v.help}. See the rule guide for code examples.`,
          { page: key, rule: 'axe:' + v.id, source: 'axe', helpUrl: v.helpUrl, principle: `WCAG ${wcag || 'best practice'} · axe-core rule “${v.id}”`,
            evidence: v.nodes.map((n) => ({ selector: n.target, text: n.summary.split('\n').slice(1, 2).join(' ').trim() || n.html })) });
        v.nodes.forEach((n) => n.rect && mark(key, n.rect, sev, v.help));
      }
    }

    // efficiency / Fitts
    if (a.smallTargetCount) {
      add('efficiency', a.smallTargetCount > 10 ? 'major' : 'minor', `${a.smallTargetCount} tap/click target(s) smaller than 24×24 px on ${P}`, `Small targets take longer to acquire and cause mis-taps, especially on touch.${a.crowded ? ` ${a.crowded} adjacent small targets are crowded together.` : ''}`, 'Make targets at least 24×24 px (44×44 px for touch); add padding rather than enlarging icons.', { page: key, principle: "Fitts's Law · WCAG 2.5.8 Target Size", evidence: ev(a.smallTargets, (s) => ({ selector: s.selector, text: `${s.text || ''} ${s.w}×${s.h}` })) });
      a.smallTargets.slice(0, 25).forEach((s) => mark(key, s.rect, 'minor', `Target ${s.w}×${s.h}`));
    }

    // cognitive load
    if (a.maxNav > 9) add('cognitive', a.maxNav > 15 ? 'major' : 'minor', `Navigation with ${a.maxNav} items on ${P}`, 'Decision time grows with the number of choices. Long flat menus are hard to scan and remember.', 'Group into 5–9 top-level categories; move secondary items into sub-menus or a footer.', { page: key, principle: "Hick's Law · Miller's Law (7±2)", evidence: a.navs.filter((n) => n.items > 9).map((n) => ({ selector: n.selector, text: `${n.items} items` })) });
    if (a.fold.interactive > 40) add('cognitive', 'minor', `${a.fold.interactive} interactive elements above the fold on ${P}`, 'A dense first screen competes for attention and dilutes the primary action.', 'Prioritise one primary call-to-action; reduce or de-emphasise secondary options.', { page: key, principle: "Hick's Law · Von Restorff Effect" });
    if (a.fold.buttons > 6) add('cognitive', 'minor', `${a.fold.buttons} buttons compete above the fold on ${P}`, 'Without a clear primary action users must evaluate every option.', 'Use one visually dominant primary button; style the rest as secondary/tertiary.', { page: key, principle: 'Von Restorff Effect · Visual hierarchy' });
    if (a.counts.words > 2500) add('cognitive', 'minor', `Very text-heavy page (${a.counts.words.toLocaleString()} words) — ${P}`, 'Users scan rather than read; dense pages hide key information.', 'Use progressive disclosure, summaries, and scannable headings.', { page: key, principle: 'Nielsen #8 Aesthetic and minimalist design' });

    // hierarchy & readability
    if (a.h1Count === 0) add('hierarchy', 'minor', `No H1 heading on ${P}`, 'Users and assistive tech rely on a main heading to confirm where they are.', 'Add a single, descriptive <h1> that names the page.', { page: key, principle: 'Nielsen #1 · WCAG 2.4.6' });
    if (a.h1Count > 1) add('hierarchy', 'minor', `${a.h1Count} H1 headings on ${P}`, 'Multiple top-level headings weaken the page hierarchy.', 'Use one H1 and structure the rest with H2–H4.', { page: key });
    if (!a.axe && (a.headingSkips)) add('hierarchy', 'minor', `Heading levels skipped ${a.headingSkips}× on ${P}`, 'Skipped levels (e.g. H2 → H4) break the document outline.', 'Nest headings sequentially; style with CSS instead of picking levels by size.', { page: key, principle: 'WCAG 1.3.1 Info and Relationships' });
    if (a.smallTextCount) add('hierarchy', a.smallTextCount > 15 ? 'major' : 'minor', `${a.smallTextCount} text element(s) below 12 px on ${P}`, 'Very small text is hard to read, especially on mobile and for older users.', 'Use ≥ 16 px for body text and ≥ 12 px for captions.', { page: key, principle: 'Readability · Aesthetic-Usability Effect', evidence: ev(a.smallText, (s) => ({ selector: s.selector, text: `${s.text} (${s.size}px)` })) });
    if (a.longLines.length) add('hierarchy', 'minor', `Long line lengths (~${Math.max(...a.longLines.map((l) => l.chars))} chars) on ${P}`, 'Lines beyond ~80 characters make it hard to find the start of the next line.', 'Constrain text containers to 50–75 characters (max-width: ~65ch).', { page: key, principle: 'Typography — optimal measure' });
    if (a.viewport.hScroll) add('hierarchy', 'major', `Horizontal scrolling at ${a.viewport.w}px width on ${P}`, `Page is ${a.viewport.docW}px wide in a ${a.viewport.w}px viewport.`, 'Fix overflowing elements; ensure layout reflows at all widths.', { page: key, principle: 'WCAG 1.4.10 Reflow' });
    if (!a.viewport.metaViewport) add('hierarchy', 'minor', `No responsive viewport meta tag on ${P}`, 'Mobile browsers will render the desktop layout zoomed out.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', { page: key });

    // consistency
    if (a.tokens.buttonVariants > 6) add('consistency', 'minor', `${a.tokens.buttonVariants} different button styles on ${P}`, 'Many visual variants make it unclear which actions are equivalent or primary.', 'Consolidate into a small set of button variants from a design system (primary / secondary / tertiary / destructive).', { page: key, principle: "Nielsen #4 Consistency · Jakob's Law" });
    if (a.tokens.fontSizes > 10) add('consistency', 'minor', `${a.tokens.fontSizes} distinct font sizes on ${P}`, 'An ad-hoc type scale weakens hierarchy and looks unpolished.', 'Adopt a type scale of 5–7 sizes.', { page: key, principle: 'Design-system consistency · Aesthetic-Usability Effect' });
    if (a.tokens.fontFamilies.length > 3) add('consistency', 'minor', `${a.tokens.fontFamilies.length} font families on ${P}`, a.tokens.fontFamilies.join(', '), 'Limit to 1–2 families.', { page: key });
    if (a.vagueLinkCount) add('consistency', 'minor', `${a.vagueLinkCount} vague link label(s) like “click here” / “read more” on ${P}`, 'Links should describe their destination out of context.', 'Rewrite link text to say where it goes (e.g. “Read the pricing guide”).', { page: key, principle: 'WCAG 2.4.4 Link Purpose · Information scent', evidence: ev(a.vagueLinks, (v) => ({ selector: v.selector, text: v.text })) });
    if (a.newTab > 3) add('consistency', 'minor', `${a.newTab} links open a new tab without warning on ${P}`, 'Unexpected new tabs break the Back button and disorient users.', 'Avoid target=_blank for internal links; indicate when a link opens a new tab.', { page: key, principle: 'Nielsen #3 User control & freedom · WCAG 3.2.5' });
    if (a.emptyHref > 3) add('consistency', 'minor', `${a.emptyHref} links with href="#" or javascript: on ${P}`, 'Links that are really buttons confuse assistive tech and break middle-click/new-tab.', 'Use <button> for actions and <a href> for navigation.', { page: key, principle: 'Semantic HTML · Jakob’s Law' });

    // forms (static)
    if (!a.axe && a.fieldsNoLabelCount) add('forms', a.placeholderOnly ? 'major' : 'minor', `${a.fieldsNoLabelCount} form field(s) without a label on ${P}`, a.placeholderOnly ? `${a.placeholderOnly} rely only on placeholder text, which disappears on input and burdens memory.` : 'Users and screen readers cannot tell what to enter.', 'Use persistent visible <label>s above fields; keep placeholders for examples only.', { page: key, principle: 'WCAG 3.3.2 Labels · Nielsen #6 Recognition over recall', evidence: ev(a.fieldsNoLabel, (f) => ({ selector: f.selector, text: f.placeholder })) });
    let acFlagged = false;
    for (const f of a.forms) {
      if (f.fields > 8) add('forms', 'minor', `Long form: ${f.fields} fields on ${P}`, 'Every extra field lowers completion.', 'Remove optional fields, split into steps with progress, or defer to later.', { page: key, principle: "Tesler's Law · Goal-Gradient Effect", evidence: [{ selector: f.selector }] });
      if (f.fields >= 3 && !f.autocomplete && !acFlagged && (acFlagged = true)) add('forms', 'minor', `Form fields don't use autocomplete on ${P}`, 'Browsers cannot autofill, forcing users to retype known data.', 'Add autocomplete tokens (name, email, tel, address-line1…).', { page: key, principle: 'WCAG 1.3.5 Identify Input Purpose', evidence: [{ selector: f.selector }] });
    }

    // feedback (static)
    if (a.counts.forms && !a.liveRegions) add('feedback', 'minor', `No ARIA live regions for status messages on ${P}`, 'Success/error messages may not be announced to screen-reader users.', 'Announce async results via role="status" / role="alert".', { page: key, principle: 'WCAG 4.1.3 Status Messages' });
    if (a.counts.links > 60 && !a.search) add('cognitive', 'minor', `Large page with no search on ${P}`, `${a.counts.links} links and no visible search.`, 'Offer search for content-heavy sites.', { page: key, principle: "Jakob's Law · Nielsen #7 Flexibility & efficiency" });
    if (a.counts.domNodes > 3000) add('performance', a.counts.domNodes > 6000 ? 'major' : 'minor', `Large DOM (${a.counts.domNodes.toLocaleString()} nodes) on ${P}`, 'Big DOMs slow down rendering and interactions.', 'Virtualise long lists; lazy-render off-screen sections.', { page: key });
    if (a.imgNoDims > 5) add('performance', 'minor', `${a.imgNoDims} images without width/height on ${P}`, 'Images without dimensions cause layout shift when they load.', 'Set width/height or aspect-ratio on images.', { page: key, principle: 'CLS · Visual stability' });
  }

  // ---- web vitals
  for (const p of pages) {
    const v = p.vitals;
    if (!v) continue;
    if (v.lcp > 2500) add('performance', v.lcp > 4000 ? 'critical' : 'major', `Slow LCP ${(v.lcp / 1000).toFixed(1)} s on ${p.path}`, 'Largest Contentful Paint should be ≤ 2.5 s. Users perceive the page as slow to load.', 'Optimise the hero image/text, reduce render-blocking resources, improve server response.', { page: p.key, principle: 'Core Web Vitals — LCP', metric: v.lcp });
    if (v.cls > 0.1) add('performance', v.cls > 0.25 ? 'critical' : 'major', `Layout shift CLS ${v.cls} on ${p.path}`, 'Content moves while users are reading or about to click — a common cause of mis-clicks.', 'Reserve space for images, ads and async content; avoid inserting content above existing content.', { page: p.key, principle: 'Core Web Vitals — CLS', metric: v.cls });
    if (v.inp > 200) add('performance', v.inp > 500 ? 'major' : 'minor', `Interaction to Next Paint ${v.inp} ms on ${p.path}`, 'INP should be ≤ 200 ms for the UI to feel responsive.', 'Reduce JS work on input handlers; yield to the main thread.', { page: p.key, principle: 'Core Web Vitals — INP · Doherty Threshold', metric: v.inp });
    if (v.ttfb > 800) add('performance', v.ttfb > 1800 ? 'major' : 'minor', `Slow server response (TTFB ${v.ttfb} ms) on ${p.path}`, 'Time to first byte should be ≤ 800 ms.', 'Add caching/CDN, optimise backend queries.', { page: p.key, metric: v.ttfb });
    if (v.longTaskMs > 1000) add('performance', 'minor', `${v.longTasks} long tasks blocking the main thread (${v.longTaskMs} ms) on ${p.path}`, 'Long tasks freeze the UI and delay input.', 'Split work, code-split bundles, defer third-party scripts.', { page: p.key });
  }

  // ---- loading feedback for slow pages
  for (const p of pages) if (p.vitals?.load > 3000 && audits[p.key] && !audits[p.key].loading) add('feedback', 'minor', `Slow load (${(p.vitals.load / 1000).toFixed(1)} s) with no loading indicator detected on ${p.path}`, 'Users need to know the system is working.', 'Show skeleton screens or progress indicators for waits over 1 s.', { page: p.key, principle: 'Nielsen #1 · Doherty Threshold' });

  // ---- design-system compliance
  const ds = designSystem?.id ? loadSystem(designSystem.id) : null;
  const compliance = ds ? checkCompliance(audits, ds, designSystem) : null;
  if (compliance) complianceFindings(compliance, add);
  for (const c of compliance?.categories || []) for (const o of c.offenders) for (const s of (o.samples || []).slice(0, 2)) if (s.rect) mark(o.pages[0], s.rect, c.key === 'components' ? 'major' : 'minor', 'Design system: ' + c.name);

  // =====================================================================
  // SCORING
  // =====================================================================
  // how many testers hit each behavioural issue (combined reports)
  if (testers > 1) {
    const sidsBy = (pred) => new Set(events.filter(pred).map((e) => e.sid)).size;
    for (const f of findings) {
      const sel = f.evidence?.[0]?.selector;
      if (!sel) continue;
      if (/Rage clicks/.test(f.title)) f.testers = sidsBy((e) => e.type === 'rage_click' && e.selector === sel);
      else if (/Dead click on/.test(f.title)) f.testers = sidsBy((e) => e.type === 'dead_click' && e.selector === sel);
      else if (/Hesitation/.test(f.title)) f.testers = sidsBy((e) => e.type === 'hesitation' && e.selector === sel);
      else if (/Field friction|Long time on field/.test(f.title)) f.testers = sidsBy((e) => e.type === 'field_blur' && e.field === sel);
      if (f.testers) f.detail += ` Seen with ${f.testers} of ${testers} testers.`;
    }
  }
  for (const f of findings) f.key = fingerprint(f);
  const ignoredSet = new Set(ignored);
  const ignoredFindings = findings.filter((f) => ignoredSet.has(f.key));
  findings.splice(0, findings.length, ...findings.filter((f) => !ignoredSet.has(f.key)));
  findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (b.testers || 0) - (a.testers || 0) || a.category.localeCompare(b.category));
  const hasBehaviour = clicks.length + focuses.length > 0;
  const categories = Object.entries(CATEGORIES).map(([key, c]) => {
    const fs = findings.filter((f) => f.category === key);
    // diminishing penalty: each additional finding of a category counts less
    let pen = 0;
    fs.forEach((f, i) => (pen += PENALTY[f.severity] * (1 / (1 + i * 0.15))));
    const applicable = key === 'forms' ? (allA.some(([, a]) => a.counts.fields) || focuses.length) : key === 'frustration' || key === 'feedback' ? hasBehaviour || fs.length : true;
    if (key === 'design') return { key, ...c, score: compliance && !compliance.unavailable ? compliance.score : null, counts: { critical: 0, major: fs.filter((f) => f.severity === 'major').length, minor: fs.filter((f) => f.severity === 'minor').length } };
    return { key, ...c, score: applicable ? Math.max(0, Math.round(100 - pen)) : null, counts: { critical: fs.filter((f) => f.severity === 'critical').length, major: fs.filter((f) => f.severity === 'major').length, minor: fs.filter((f) => f.severity === 'minor').length } };
  });
  const scored = categories.filter((c) => c.score !== null);
  const overall = Math.round(scored.reduce((s, c) => s + c.score * c.weight, 0) / Math.max(scored.reduce((s, c) => s + c.weight, 0), 1));
  // nothing was audited: don't report a perfect score for an empty scan
  const noData = !allA.length;
  const grade = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : overall >= 60 ? 'D' : 'F';

  // ---- Nielsen heuristic view (maps findings by principle text)
  const NIELSEN = [
    ['1', 'Visibility of system status', /Nielsen #1|feedback|Doherty|loading|Status/i],
    ['2', 'Match between system and real world', /Nielsen #2|information scent|Link Purpose/i],
    ['3', 'User control and freedom', /Nielsen #3|new tab|back/i],
    ['4', 'Consistency and standards', /Nielsen #4|Jakob|Consistency/i],
    ['5', 'Error prevention', /Nielsen #5|validation|Input Assistance/i],
    ['6', 'Recognition rather than recall', /Nielsen #6|placeholder|Labels/i],
    ['7', 'Flexibility and efficiency of use', /Nielsen #7|Fitts|autocomplete|Target Size|INP/i],
    ['8', 'Aesthetic and minimalist design', /Nielsen #8|Hick|Miller|Von Restorff|Aesthetic/i],
    ['9', 'Help users recover from errors', /Nielsen #9|error/i],
    ['10', 'Help and documentation', /help text|helper/i],
  ].map(([n, name, re]) => {
    const fs = findings.filter((f) => re.test(f.principle) || re.test(f.title));
    return { n, name, issues: fs.length, worst: fs[0]?.severity || null };
  });

  // ---- behavioural summary
  const scrollDepths = pages.map((p) => p.maxScroll).filter((x) => x > 0);
  const behavior = {
    clicks: clicks.length, rage: rage.length, dead: dead.length, errorClicks: errorClicks.length, hesitations: hes.length,
    deadRate: pct(dead.length, clicks.length), frustrationRate: pct(rage.length + dead.length + errorClicks.length, clicks.length),
    medianScroll: median(scrollDepths), pageviews: pv.length, uniquePages: Object.keys(visits).length, backNavs,
    keyboardNav: byType('keyboard_nav').length, fieldsTouched: Object.keys(fieldAgg).length, formsSubmitted: submits.length, validationErrors: invalid.length,
    topClicked: Object.values(groupBy(clicks, (c) => c.page + '|' + c.selector)).sort((a, b) => b.length - a.length).slice(0, 10).map((l) => ({ text: l[0].text || l[0].tag, selector: l[0].selector, page: shortPage(l[0].page), n: l.length, dead: dead.filter((d) => d.selector === l[0].selector).length })),
    fields: Object.values(fieldAgg).sort((a, b) => b.ms - a.ms).slice(0, 15).map((f) => ({ ...f, page: shortPage(f.page) })),
  };
  const vit = pages.map((p) => p.vitals).filter(Boolean);
  const performance = { lcp: p75(vit.map((v) => v.lcp).filter(Boolean)), cls: Math.max(0, ...vit.map((v) => v.cls)), inp: Math.max(0, ...vit.map((v) => v.inp)), ttfb: p75(vit.map((v) => v.ttfb).filter(Boolean)), slowRequests: slowReq.length, failedRequests: failed.length };

  return {
    generatedAt: Date.now(),
    ignored: ignoredFindings.map((f) => ({ key: f.key, title: f.title, severity: f.severity, category: f.category })),
    engines: { axe: Object.values(audits).some((a) => a.axe) },
    compliance,
    summary: { noData, testers, score: overall, grade, duration: Math.round(durationS), pages: pages.length, findings: findings.length, critical: findings.filter((f) => f.severity === 'critical').length, major: findings.filter((f) => f.severity === 'major').length, minor: findings.filter((f) => f.severity === 'minor').length, hasBehaviour },
    categories, nielsen: NIELSEN, findings, pages, journey: journey.map((j) => ({ ...j, path: shortPage(j.page) })), behavior, performance,
    network: failed.concat(slowReq).slice(0, 100), console: consoleLog.slice(0, 100),
  };
}

function pageKeyFromUrl(u) { try { const x = new URL(u); return x.origin + x.pathname; } catch { return null; } }
