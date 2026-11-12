# UX Lens: interaction-based UX analytics

Open any URL (internet, intranet, or localhost) in a real browser window, **use it like a normal user**,
then get a scored UX report built from what you actually did plus an audit of every page you visited.

## Run

```bash
cd ux-analytics
npm install            # first time only
npx playwright install chromium   # first time only (fallback if Google Chrome isn't installed)
npm start              # → http://localhost:4321
```

1. Enter a URL, pick a device (desktop / laptop / tablet / mobile), and press **Start session**.
2. A Chrome window opens. Log in if you need to (your intranet SSO and VPN work, since it runs on your machine), then carry out a real task.
3. Back in the dashboard, press **Stop & analyse** (closing the browser window also stops the session).
4. Review the report. Sessions are saved under `data/` and stay available later.

Tip: if you open a modal or another state you want audited, press **📸 Audit current page** while recording.

## What it measures

| Source | Signals |
|---|---|
| **Your interactions** | rage clicks, dead clicks, clicks that trigger JS errors, hover hesitation, scroll depth and scroll u-turns, pogo-sticking and back navigation, form-field time, re-focus, corrections, abandonment, validation errors, slow interactions (INP) |
| **Page audit** (each page/route) | colour contrast, accessible names, alt text, focus visibility, landmarks, language, target size, crowding, nav size, above-the-fold density, headings, small text, line length, reflow, form labels and autocomplete, vague links, new-tab links, design-token consistency (fonts, colours, button variants) |
| **Runtime** | Core Web Vitals (LCP, CLS, INP, TTFB), long tasks, failed and slow requests, console errors |

Findings map to **Nielsen's 10 heuristics**, **Fitts's / Hick's / Miller's / Jakob's / Tesler's laws**, the
**Doherty threshold**, the **Von Restorff** and **goal-gradient** effects, **WCAG 2.2 AA**, and **Core Web Vitals**.
Each finding has a severity, the principle it violates, evidence (CSS selectors), and a recommended fix.

Report tabs: Overview (score, per-principle scores, Nielsen table), Findings (filterable), Pages & heatmaps
(click heatmap, mouse attention, scroll-reach line, issue markers drawn on a full-page screenshot), Behaviour
(journey, most-clicked elements, form-field analytics), Performance, Network & console. You can export
to JSON or Print/PDF.

## Compare, combine and ignore

- **Compare before and after:** on the home page, tick two scans and choose *Compare before and after*. It shows the score change, each area before vs after, and which issues are new, worse, fixed or improved.
- **Combine testers:** tick two or more scans of the same flow and choose *Combine testers into one report*. Behaviour issues show how many testers hit them (e.g. "2/2 testers").
- **Not a problem:** on any issue, choose *Not a problem* to hide a false positive for that site. The score is recalculated, and you can restore it later.
- **Score over time:** every report shows the trend for all scans of the same site.

## Run in CI (like a visual-regression check, but for usability)

```bash
# first run on main: save the accepted state
npm run scan -- https://staging.example.com/checkout --update-baseline
# on every pull request: fail if anything NEW at "major" or worse appears
npm run scan -- https://staging.example.com/checkout --fail-on major --junit uxlens.xml
```

- `--flow flow.mjs` runs a scripted user journey (see `test/flow.mjs`) so the behaviour checks run too.
- `--config uxlens.config.json` scans several URLs: `{ "urls": ["https://…/a", {"url": "https://…/b", "flow": "b.mjs"}], "failOn": "major" }`.
- `--min-score 80` also fails if a page drops below 80. `--browser webkit` scans in Safari's engine.
- Exit codes: `0` pass, `1` new or worse issues found, `2` the scan itself failed. Commit `uxlens-baseline.json`.

## Design system compliance (always on)

Every scan is checked against the default design system, **Echo UI**. There's nothing to switch on. The brand (Default, Dnata, Emirates or Marhaba) and the light or dark mode are detected from the page.

**While you scan**, the recording screen shows a live panel: how many components found so far come from the design system, how many are custom-built, a breakdown by component type, and the latest custom-built ones with what's different about them.

**How each component is classified**

| Source | How UX Lens decides |
|---|---|
| From the design system | Has a library marker: an `echo-*` tag or class, or a `data-echo` / `data-ds` / `data-component` attribute, and matches the spec |
| Design system, overridden | Has a library marker, but its size, corners, font or colours were changed |
| Built with tokens | No marker, but it's styled with the system's CSS variables and matches the spec |
| Matches spec (unconfirmed) | No marker or variables, but height, corners, font and colours all match the Echo UI spec |
| Custom-built | No marker and it differs from the spec |

24 Echo UI component types are recognised (Button, Input, Select, Card, Tabs, Modal, Badge, Nav Bar and others). Their specs (heights, corner tokens per brand, font, colour roles) are in `design-systems/echo-ui.json`. If your codebase marks components differently, add its prefix or attribute under `detect`.

The **Design system** tab shows the component share, components by type, the full component inventory (each one's source, how it was identified and what differs from the spec), and token compliance for colours, typography, spacing, corners and shadows. The Summary also shows a design-system panel. You can still re-check a report against another brand, mode or an uploaded system there.

In CI, add `--min-ds-score 85` to fail when compliance drops.

## Accessibility engine

Each page is also checked with **axe-core** (Deque), the industry-standard WCAG 2.2 A/AA rule engine. Issues it finds show an *axe* badge and link to the rule guide.

## Browsers

Chrome/Edge (Chromium), Safari (WebKit) and Firefox. Install the extra engines with `npx playwright install webkit firefox`. If an engine can't start on your machine, it's greyed out with the reason.

## Notes
- Everything runs locally. Nothing is sent anywhere except the site you are testing.
- Behavioural categories (Feedback, Frustration) are only scored when interactions were recorded.
- `test/e2e.mjs` runs a scripted session against a deliberately flawed test page (`UXA_HEADLESS=1`).
