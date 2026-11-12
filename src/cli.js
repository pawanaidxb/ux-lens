#!/usr/bin/env node
// UX Lens CI scanner.
//   node src/cli.js https://staging.example.com/checkout --fail-on major
//   node src/cli.js --config uxlens.config.json --baseline uxlens-baseline.json
//   node src/cli.js <url> --update-baseline        (accept current results)
//
// Exit codes: 0 = pass, 1 = new issues at/above --fail-on (or score below --min-score), 2 = error.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Session } from './session.js';
import { diffReports, severityAtLeast, fingerprint } from '../public/diff.js';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true; };
if (argv.includes('--help') || !argv.length) {
  console.log(`UX Lens CI scanner

Usage:
  node src/cli.js <url> [<url>...] [options]
  node src/cli.js --config uxlens.config.json [options]

Options:
  --device <name>         responsive | desktop | laptop | tablet | mobile   (default desktop)
  --browser <name>        chromium | firefox | webkit                       (default chromium)
  --flow <file.mjs>       script exporting  default async ({ page, url }) => {}  to act like a user
  --baseline <file>       compare with this baseline (default uxlens-baseline.json if present)
  --update-baseline       write the current results as the new baseline
  --fail-on <severity>    critical | major | minor   fail on NEW issues at or above this (default major)
  --min-score <n>         fail if any page scores below n
  --junit <file>          also write a JUnit XML report (for CI test tabs)
  --json <file>           write the full results as JSON
  --wait <ms>             time to wait on each page before stopping (default 4000)
  --design-system <id>    check design-system compliance (e.g. echo-ui)
  --brand <name>          brand within the design system (e.g. Emirates)
  --mode <light|dark>     colour mode to check against (default light)
  --min-ds-score <n>      fail if design-system compliance is below n`);
  process.exit(0);
}

const cfgFile = flag('config');
const cfg = cfgFile ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
const targets = (cfg.urls || argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').startsWith('--')).map((url) => ({ url })))
  .map((t) => (typeof t === 'string' ? { url: t } : t));
const opts = {
  device: flag('device', cfg.device || 'desktop'), browser: flag('browser', cfg.browser || 'chromium'),
  failOn: flag('fail-on', cfg.failOn || 'major'), minScore: +flag('min-score', cfg.minScore ?? 0),
  baseline: flag('baseline', cfg.baseline || 'uxlens-baseline.json'), update: !!flag('update-baseline', false),
  wait: +flag('wait', cfg.wait || 4000), ds: flag('design-system', cfg.designSystem), brand: flag('brand', cfg.brand), mode: flag('mode', cfg.mode || 'light'), minDs: +flag('min-ds-score', cfg.minDsScore ?? 0), junit: flag('junit', cfg.junit), json: flag('json', cfg.json), flow: flag('flow', cfg.flow),
};
if (!targets.length) { console.error('No URL given.'); process.exit(2); }

const tty = process.stdout.isTTY;
const c = (n) => (s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const red = c(31), green = c(32), yellow = c(33), dim = c(2), bold = c(1);
const sevC = { critical: red, major: yellow, minor: dim };

const baseline = fs.existsSync(opts.baseline) ? JSON.parse(fs.readFileSync(opts.baseline, 'utf8')) : null;
const results = [];
let failed = false;

for (const t of targets) {
  const flowFile = t.flow || opts.flow;
  const s = new Session({ url: t.url, name: t.name || `CI: ${t.url}`, device: t.device || opts.device, browser: t.browser || opts.browser, useChrome: false, headless: true, kind: 'ci', designSystem: opts.ds ? { id: opts.ds, brand: t.brand || opts.brand, mode: t.mode || opts.mode } : null });
  process.stdout.write(`${bold('Scanning')} ${t.url} ${dim(`(${s.device}, ${s.browserName})`)} … `);
  try {
    await s.start();
    const page = s.context.pages()[0];
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    if (flowFile) {
      const flow = (await import(pathToFileURL(path.resolve(flowFile)).href)).default;
      await flow({ page, url: t.url, context: s.context });
    }
    await page.waitForTimeout(opts.wait);
    const report = await s.stop();
    if (!report) throw new Error(s.error || 'analysis failed');

    const base = baseline?.targets?.[t.url];
    const d = base ? diffReports({ findings: base.findings, categories: base.categories, summary: base.summary }, report) : null;
    const newIssues = d ? d.added : report.findings;
    const blocking = [...newIssues, ...(d ? d.worse.map((w) => w.after) : [])].filter((f) => severityAtLeast(f.severity, opts.failOn));
    const lowScore = opts.minScore && report.summary.score < opts.minScore;
    const dsScore = report.compliance?.score;
    const lowDs = opts.minDs && dsScore != null && dsScore < opts.minDs;
    const pass = !blocking.length && !lowScore && !lowDs;
    if (!pass) failed = true;
    results.push({ url: t.url, id: s.id, report, diff: d, blocking, pass });

    console.log(pass ? green('PASS') : red('FAIL'));
    console.log(`  Score ${bold(report.summary.score)}${d ? ` (${d.score.delta >= 0 ? green('+' + d.score.delta) : red(d.score.delta)} vs baseline)` : ''} · ${report.summary.critical} blockers · ${report.summary.major} frustrating · ${report.summary.minor} polish`);
    if (d) console.log(`  ${d.added.length} new · ${d.worse.length} worse · ${green(d.fixed.length + ' fixed')} · ${green(d.better.length + ' improved')} · ${d.kept.length - d.worse.length - d.better.length} unchanged`);
    if (d) for (const w of d.worse.slice(0, 10)) console.log(`  ${sevC[w.after.severity]('WORSE ' + w.after.severity.padEnd(8))} ${w.after.title} ${dim(`(${w.from} → ${w.to})`)}`);
    for (const f of (d ? d.added : blocking).slice(0, 15)) console.log(`  ${sevC[f.severity]((d ? 'NEW ' : '') + f.severity.padEnd(8))} ${f.title}`);
    if (lowScore) console.log(red(`  Score ${report.summary.score} is below the minimum ${opts.minScore}`));
    if (dsScore != null) console.log(`  Design system ${report.compliance.system.name}${report.compliance.brand ? ` (${report.compliance.brand})` : ''}: ${bold(dsScore + '%')} compliant · ${report.compliance.categories.map((c) => `${c.name} ${c.score ?? '–'}`).join(' · ')}`);
    if (lowDs) console.log(red(`  Design-system compliance ${dsScore}% is below the minimum ${opts.minDs}%`));
    console.log(dim(`  Full report: http://localhost:4321/#/s/${s.id}`));
  } catch (e) {
    failed = true;
    console.log(red('ERROR'));
    console.log('  ' + e.message);
    results.push({ url: t.url, error: e.message, pass: false });
    try { await s.browser?.close(); } catch {}
  }
}

if (opts.update) {
  const out = { createdAt: new Date().toISOString(), targets: { ...(baseline?.targets || {}) } };
  for (const r of results) if (r.report) out.targets[r.url] = { summary: r.report.summary, categories: r.report.categories, findings: r.report.findings.map((f) => ({ key: fingerprint(f), category: f.category, severity: f.severity, title: f.title, page: f.page, rule: f.rule })) };
  fs.writeFileSync(opts.baseline, JSON.stringify(out, null, 1));
  console.log(green(`Baseline written to ${opts.baseline}`));
  failed = results.some((r) => r.error);
}

if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(results.map(({ report, ...r }) => ({ ...r, score: report?.summary.score, findings: report?.findings })), null, 1));
if (opts.junit) {
  const x = (s) => String(s).replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const cases = results.map((r) => `  <testcase classname="uxlens" name="${x(r.url)}">${r.error ? `<error message="${x(r.error)}"/>` : r.pass ? '' : `<failure message="${x(`${r.blocking.length} new issue(s) at ${opts.failOn}+`)}">${x(r.blocking.map((f) => `[${f.severity}] ${f.title}`).join('\n'))}</failure>`}</testcase>`);
  fs.writeFileSync(opts.junit, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="UX Lens" tests="${results.length}" failures="${results.filter((r) => !r.pass && !r.error).length}" errors="${results.filter((r) => r.error).length}">\n${cases.join('\n')}\n</testsuite>\n`);
}
process.exit(failed && !opts.update ? 1 : results.some((r) => r.error) ? 2 : 0);
