import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { planningTools } from '../src/tools/planning.js';

// Real browser coverage of the exact emitted module, not a copy of the gate.
// Browser absence is an actionable failure, never a silently skipped regression.
async function installedBrowser() {
  const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (override) { await access(override, constants.X_OK); return override; }
  for (const path of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', chromium.executablePath()]) {
    try { await access(path, constants.X_OK); return path; } catch { /* Next installed executable. */ }
  }
  throw new Error('Focus regressions require installed Chrome/Chromium; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. No browser is installed automatically.');
}

const cases = [
  { name: 'modern transparent outline', focus: 'outline:3px solid color(srgb 0 0 0 / 0)', passed: false },
  { name: 'zero-extent opaque shadow', focus: 'box-shadow:0 0 0 0 black', passed: false },
  { name: 'visible modern outline', focus: 'outline:3px solid color(srgb 0 0 0 / 0.8)', passed: true },
  { name: 'visible shadow ring', focus: 'box-shadow:0 0 0 3px black', passed: true },
  { name: 'native UA focus', native: true, focus: '', passed: true },
  { name: 'focus-visible without indicator', focus: 'outline:none;box-shadow:none', passed: false },
  { name: 'legacy transparent outline', focus: 'outline:3px solid rgba(0, 0, 0, 0)', passed: false },
  { name: 'modern transparent shadow', focus: 'box-shadow:0 0 0 3px color(srgb 0 0 0 / 0)', passed: false },
  { name: 'OKLCH transparent outline', focus: 'outline:3px solid oklch(0.3 0.1 40 / 0%)', passed: false },
  { name: 'OKLCH visible outline', focus: 'outline:3px solid oklch(0.3 0.1 40 / 80%)', passed: true },
  { name: 'visible shadow after transparent layer', focus: 'box-shadow:0 0 0 2px rgba(0, 0, 0, 0), 0 0 0 4px black', passed: true },
  { name: 'only transparent or zero-extent layers', focus: 'box-shadow:0 0 0 0 black, 0 0 0 4px color(display-p3 0 0 0 / 0)', passed: false },
  { name: 'visible offset shadow', focus: 'box-shadow:3px 0 0 0 black', passed: true },
  { name: 'visible blurred shadow', focus: 'box-shadow:0 0 3px 0 black', passed: true },
  { name: 'negative spread concealed under opaque button', focus: 'box-shadow:0 0 0 -3px black', passed: false },
  { name: 'unsupported inset geometry requires review', focus: 'box-shadow:inset 0 0 0 3px black', passed: false },
  { name: 'unchanged visible outline', before: 'outline:3px solid black', focus: 'outline:3px solid black', passed: false },
  { name: 'invisible layer added to unchanged ring', before: 'box-shadow:0 0 0 3px black', focus: 'box-shadow:0 0 0 3px black, 0 0 0 0 black', passed: false },
] as const;

function fixture(css: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Focus regression</title><style>body{background:white;color:black}button{margin:24px;background:white;color:black;border:1px solid black;padding:12px}${css}</style></head><body><main><h1>Focus regression</h1><button type="button">Sample control</button></main></body></html>`;
}

let html = '';
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'");
  response.end(html);
});
let browser: Browser | undefined;
let origin: string;
let generated: any;

beforeAll(async () => {
  const planner = planningTools.find(t => t.name === 'material_generate_eval_plan')!;
  const plan: any = await planner.run({ target: 'Keyboard focus regression', riskLevel: 'low', breakpoints: [{ name: 'desktop', width: 800, height: 600 }] });
  generated = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(plan.artifact.source).toString('base64'));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind a loopback port');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: await installedBrowser(), headless: true, args: ['--disable-background-networking', '--disable-component-update', '--no-default-browser-check'] });
}, 30_000);

afterAll(async () => {
  try { await browser?.close(); }
  finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

describe('generated KEYBOARD-FOCUS gate in Chrome', () => {
  it.each(cases)('$name', async fixtureCase => {
    const baseline = 'native' in fixtureCase ? '' : 'button{outline:none;box-shadow:none}';
    const before = 'before' in fixtureCase ? fixtureCase.before : '';
    html = fixture(`${baseline}button{${before}}button:focus,button:focus-visible{${fixtureCase.focus}}`);
    const context = await browser!.newContext({ serviceWorkers: 'block', colorScheme: 'light', locale: 'en-US' });
    const blocked: string[] = [];
    const errors: string[] = [];
    try {
      await context.route('**/*', async route => {
        if (new URL(route.request().url()).origin !== origin) { blocked.push(route.request().url()); await route.abort(); }
        else await route.continue();
      });
      await context.routeWebSocket('**/*', socket => { blocked.push(socket.url()); socket.close(); });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(String(error)));
      const report = await generated.runGeneratedPlan(page, { url: origin + '/', AxeBuilder });
      const focusResults = report.results.filter((r: any) => r.id === 'KEYBOARD-FOCUS');
      expect(focusResults).toHaveLength(1);
      expect(focusResults[0].status, JSON.stringify(focusResults[0])).toBe(fixtureCase.passed ? 'passed' : 'failed');
      if (!fixtureCase.passed) expect(focusResults[0].error).toContain('no measurable visible outline/shadow change');
      expect(report.results.filter((r: any) => r.id !== 'KEYBOARD-FOCUS').every((r: any) => r.status === 'passed')).toBe(true);
      expect(blocked).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }, 20_000);
});
