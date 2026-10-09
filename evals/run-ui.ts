import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { planningTools } from '../src/tools/planning.js';
import { buildDemo } from './ui/demo.js';
import { acceptanceViewports, independentAcceptance, seededBadFixture } from './ui/acceptance.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = resolve(root, 'artifacts/ui');

async function executablePath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (override) {
    await access(override, constants.X_OK);
    return override;
  }
  for (const path of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    try { await access(path, constants.X_OK); return path; } catch { /* Try the next installed browser, never install. */ }
  }
  const bundled = chromium.executablePath();
  try { await access(bundled, constants.X_OK); return bundled; }
  catch { throw new Error('No installed Chrome/Chromium found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an installed executable. This harness never installs browsers.'); }
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  const demo = await buildDemo();
  const planner = planningTools.find(t => t.name === 'material_generate_eval_plan')!;
  const plan: any = await planner.run({ target: 'Review workspace update, cancel safely, then explicitly confirm one local fixture action', url: 'https://metadata.invalid/not-fetched', components: ['dialog', 'text-field', 'chip', 'navigation'], flows: ['dialog', 'confirm-action', 'Verify the real account update backend'], riskLevel: 'high', projectStyle: 'Brand-led olive research workspace; human visual review required.' });
  await Promise.all([
    writeFile(join(artifacts, 'demo.html'), demo.html),
    writeFile(join(artifacts, 'seeded-bad.html'), seededBadFixture),
    writeFile(join(artifacts, 'design-provenance.json'), JSON.stringify(demo.provenance, null, 2)),
    writeFile(join(artifacts, 'plan.json'), JSON.stringify(plan, null, 2)),
    writeFile(join(artifacts, plan.artifact.filename), plan.artifact.source),
  ]);
  // Exercise the source artifact emitted by the tool, not a parallel handwritten
  // implementation of its checks. No eval of user-provided code occurs.
  const generated = await import(pathToFileURL(join(artifacts, 'material-eval-plan.mjs')).href);
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'");
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    if (request.url === '/') response.end(demo.html);
    else if (request.url === '/bad') response.end(seededBadFixture);
    else response.writeHead(404).end('Not found');
  });
  let browser: Browser | undefined;
  const networkViolations: string[] = [];
  const pageErrors: string[] = [];
  try {
    await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
    const address = server.address();
    assert(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const executable = await executablePath();
    browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--disable-background-networking', '--disable-component-update', '--no-default-browser-check'] });
    const context = await browser.newContext({ serviceWorkers: 'block', colorScheme: 'light', locale: 'en-US', reducedMotion: 'no-preference' });
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== origin) {
        networkViolations.push(route.request().url()); await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await context.routeWebSocket('**/*', socket => { networkViolations.push(socket.url()); socket.close(); });
    context.on('request', request => {
      if (new URL(request.url()).origin !== origin) networkViolations.push(request.url());
    });
    context.on('page', page => page.on('pageerror', error => pageErrors.push(String(error))));
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const good = await generated.runGeneratedPlan(page, { url: `${origin}/`, AxeBuilder, screenshotPath: (name: string) => join(artifacts, `good-${name}.png`) });
    const computedPrimary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim());
    const tokenApplied = computedPrimary === demo.provenance.tokenOutput.schemes.light.primary;
    const independentGood = await independentAcceptance(page, `${origin}/`);
    const bad = await generated.runGeneratedPlan(page, { url: `${origin}/bad`, AxeBuilder, screenshotPath: (name: string) => join(artifacts, `bad-${name}.png`) });
    const independentBad = await independentAcceptance(page, `${origin}/bad`);
    const goodFailures = good.results.filter((r: any) => r.status !== 'passed');
    const expectedRuns = plan.checks.filter((c: any) => c.execution === 'runnable').length * acceptanceViewports.length;
    const badCaught = independentBad.some(result => !result.passed);
    const customOutstanding = good.manual.some((check: any) => check.id === 'FLOW-CUSTOM-3' && check.status === 'outstanding');
    const ok = goodFailures.length === 0 && good.results.length === expectedRuns && independentGood.every(r => r.passed) && badCaught && bad.status === 'failed' && customOutstanding && tokenApplied && networkViolations.length === 0 && pageErrors.length === 0;
    const report = {
      status: ok ? 'automated-harness-passed-manual-outstanding' : 'failed',
      browser: { executable, version: browser.version() },
      generatedPlanExecuted: true,
      expectedGeneratedChecksOnGood: expectedRuns,
      actualGeneratedChecksOnGood: good.results.length,
      tokenApplied: { passed: tokenApplied, computedPrimary, expectedPrimary: demo.provenance.tokenOutput.schemes.light.primary },
      good, bad, independentGood, independentBad,
      seededBadDetected: badCaught,
      customFlowRemainsOutstanding: customOutstanding,
      network: { allowedOrigin: origin, externalAttempts: networkViolations, serverRequests: requests },
      pageErrors,
      visualRegression: { status: 'not-run', reason: 'Screenshots captured; no independently approved baseline.' },
      uplift: { status: 'UNMEASURED', reason: 'No repeated blinded model A/B study or held-out human evaluation has been run.' },
    };
    await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, report: join(artifacts, 'report.json'), generatedGood: { passed: good.results.length - goodFailures.length, total: good.results.length }, independentGood: { passed: independentGood.filter(r => r.passed).length, total: independentGood.length }, independentBadFailures: independentBad.filter(r => !r.passed).length, screenshots: good.screenshots.length + bad.screenshots.length, manualOutstanding: good.manual.length, externalAttempts: networkViolations.length, pageErrors: pageErrors.length, ...(goodFailures.length ? { failures: goodFailures } : {}) }, null, 2));
    assert(ok, 'UI harness failed; inspect artifacts/ui/report.json.');
  } finally {
    try { await browser?.close(); }
    finally {
      server.closeAllConnections();
      await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    }
  }
}

main().catch(async error => {
  console.error(error);
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, 'failure.json'), JSON.stringify({ status: 'failed', error: String(error) }, null, 2));
  process.exitCode = 1;
});
