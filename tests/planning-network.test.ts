import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { Duplex } from 'node:stream';
import { chromium, type Browser } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { planningTools } from '../src/tools/planning.js';

async function installedBrowser() {
  const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (override) { await access(override, constants.X_OK); return override; }
  for (const path of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', chromium.executablePath()]) {
    try { await access(path, constants.X_OK); return path; } catch { /* Next installed executable. */ }
  }
  throw new Error('Standalone network regressions require installed Chrome/Chromium; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. No browser is installed automatically.');
}

// Real loopback WebSocket handshakes: a zero connection count is meaningful only
// after the positive control proves these endpoints accept browser connections.
const sockets = new Set<Duplex>();
let connections = 0;
let peerRequests = 0;
let redirectRequests = 0;
let redirectTargetRequests = 0;
let normalFetchRequests = 0;
function acceptWebSockets(server: Server) {
  server.on('upgrade', (request, socket) => {
    connections++;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') { socket.destroy(); return; }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', () => socket.end());
  });
}
let origin: string;
let peerOrigin: string;
let socketURLs: string[];
function fixture(blocked: boolean) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Standalone isolation</title><style>body{background:white;color:black}button{padding:12px;color:black;background:white;outline:none}button:focus-visible{outline:3px solid black}</style></head><body><main><h1>Standalone isolation</h1><button type="button">Sample control</button></main>${blocked ? `<script>for (const url of ${JSON.stringify(socketURLs)}) { const socket = new WebSocket(url); socket.onerror = () => {}; } fetch(${JSON.stringify(peerOrigin + '/probe')}).catch(() => {});</script>` : ''}</body></html>`;
}
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  // Intentionally no CSP or other harness guard: the emitted runner must isolate.
  const url = new URL(request.url!, origin);
  if (url.pathname === '/redirect') {
    redirectRequests++;
    response.writeHead(Number(url.searchParams.get('status') ?? 302), {
      Location: (url.searchParams.get('peer') === 'true' ? peerOrigin : origin) + '/redirect-target?token=redirect-secret',
    }).end();
    return;
  }
  if (url.pathname === '/redirect-target') redirectTargetRequests++;
  if (url.pathname === '/normal-fetch') {
    normalFetchRequests++;
    response.end('fixture fetch works');
    return;
  }
  let script = '';
  if (url.pathname === '/fetch-redirect') {
    script = `fetch('/redirect?peer=${url.searchParams.get('peer')}&status=${url.searchParams.get('status') ?? 302}').catch(() => {});`;
  } else if (url.pathname === '/fetch-normal') {
    script = `fetch('/normal-fetch').then(r => r.text()).then(text => document.querySelector('h1').textContent = text);`;
  } else if (url.pathname === '/flood') {
    script = `for (let i = 0; i < 35; i++) {
      fetch(${JSON.stringify(peerOrigin)} + '/' + 'x'.repeat(1000) + '?token=http-secret-' + i).catch(() => {});
      const socket = new WebSocket(${JSON.stringify(peerOrigin.replace('http:', 'ws:'))} + '/' + 'y'.repeat(1000) + '?token=socket-secret-' + i);
      socket.onerror = () => {};
    }`;
  }
  response.end(fixture(url.pathname === '/blocked').replace('</body>', `<script>${script}</script></body>`));
});
const peer = createServer((_request, response) => {
  peerRequests++;
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.end('local probe');
});
acceptWebSockets(server);
acceptWebSockets(peer);
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind a loopback port');
  return `http://127.0.0.1:${address.port}`;
}
let browser: Browser | undefined;
let generated: any;
let runnableCount: number;
beforeAll(async () => {
  const planner = planningTools.find(t => t.name === 'material_generate_eval_plan')!;
  const plan: any = await planner.run({ target: 'Standalone network isolation', riskLevel: 'low', breakpoints: [{ name: 'desktop', width: 800, height: 600 }] });
  // Import the exact unmodified emitted source; do not substitute a handwritten gate.
  generated = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(plan.artifact.source).toString('base64'));
  runnableCount = plan.checks.filter((c: any) => c.execution === 'runnable').length;
  origin = await listen(server);
  peerOrigin = await listen(peer);
  socketURLs = [origin.replace('http:', 'ws:') + '/socket', peerOrigin.replace('http:', 'ws:') + '/socket'];
  browser = await chromium.launch({ executablePath: await installedBrowser(), headless: true, args: ['--disable-background-networking', '--disable-component-update', '--no-default-browser-check'] });
}, 30_000);
afterAll(async () => {
  try { await browser?.close(); }
  finally {
    for (const socket of sockets) socket.destroy();
    for (const fixtureServer of [server, peer]) {
      fixtureServer.closeAllConnections();
      await new Promise<void>(resolve => fixtureServer.close(() => resolve()));
    }
  }
});

describe('standalone emitted runner network boundary', () => {
  it.each([
    ['navigation', false], ['navigation', true], ['subresource', false], ['subresource', true],
  ] as const)('rejects %s redirects before a hop (off-origin: %s)', async (kind, offOrigin) => {
    redirectRequests = redirectTargetRequests = peerRequests = 0;
    const context = await browser!.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      const path = kind === 'navigation' ? '/redirect' : '/fetch-redirect';
      const report = await generated.runGeneratedPlan(page, { url: `${origin}${path}?peer=${offOrigin}&token=navigation-secret`, AxeBuilder });
      expect(redirectRequests).toBe(runnableCount);
      // Assert the network effect, not just a post-navigation origin assertion.
      expect(redirectTargetRequests).toBe(0);
      expect(peerRequests).toBe(0);
      expect(report.status).toBe('failed');
      const isolation = report.results.find((r: any) => r.id === 'NETWORK-ISOLATION');
      expect(isolation).toMatchObject({
        status: 'failed', blockedRequestCount: runnableCount, omittedBlockedRequestCount: 0,
        blockedRequests: Array(runnableCount).fill(origin + '/redirect'),
      });
      if (kind === 'subresource') expect(report.results.filter((r: any) => r.id !== 'NETWORK-ISOLATION').every((r: any) => r.status === 'passed')).toBe(true);
      expect(JSON.stringify(report)).not.toMatch(/redirect-secret|navigation-secret|fragment-secret/);
    } finally { await context.close(); }
  }, 30_000);

  it('preserves ordinary fixture fetches without harness guards', async () => {
    normalFetchRequests = 0;
    const context = await browser!.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      const report = await generated.runGeneratedPlan(page, { url: origin + '/fetch-normal', AxeBuilder });
      expect(report.status).toBe('automated-checks-passed-manual-outstanding');
      expect(normalFetchRequests).toBe(runnableCount);
      expect(await page.locator('h1').textContent()).toBe('fixture fetch works');
    } finally { await context.close(); }
  }, 30_000);

  it('caps shared HTTP/socket evidence and counts omitted attempts without query secrets', async () => {
    peerRequests = connections = 0;
    const context = await browser!.newContext({ serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      const report = await generated.runGeneratedPlan(page, { url: origin + '/flood', AxeBuilder });
      const isolation = report.results.find((r: any) => r.id === 'NETWORK-ISOLATION');
      expect(isolation?.blockedRequests).toHaveLength(100);
      expect(isolation).toMatchObject({ blockedRequestCount: 70 * runnableCount, omittedBlockedRequestCount: 70 * runnableCount - 100 });
      expect(isolation.blockedRequests.every((url: string) => url.length <= 256 && !/[?#]/.test(url))).toBe(true);
      expect(isolation.blockedRequests.some((url: string) => url.startsWith('http:'))).toBe(true);
      expect(isolation.blockedRequests.some((url: string) => url.startsWith('ws:'))).toBe(true);
      expect(JSON.stringify(report)).not.toMatch(/http-secret|socket-secret/);
      expect(peerRequests).toBe(0);
      expect(connections).toBe(0);
    } finally { await context.close(); }
  }, 30_000);

  it('blocks sockets itself, records failures, and reuses one blocker without leaking run state', async () => {
    // Neither this test nor a shared harness installs route/routeWebSocket/CSP guards.
    const control = await browser!.newContext({ serviceWorkers: 'block' });
    try {
      const page = await control.newPage();
      await page.goto(origin);
      for (const url of socketURLs) {
        expect(await page.evaluate(url => new Promise<string>(resolve => {
          const socket = new WebSocket(url);
          const timer = setTimeout(() => { socket.close(); resolve('timeout'); }, 3000);
          socket.onopen = () => { clearTimeout(timer); socket.close(); resolve('connected'); };
          socket.onerror = () => { clearTimeout(timer); resolve('error'); };
        }), url)).toBe('connected');
      }
      expect(connections).toBe(socketURLs.length);
    } finally { await control.close(); }
    connections = 0;
    peerRequests = 0;

    const context = await browser!.newContext({ serviceWorkers: 'block' });
    // Call-through spies observe runner-owned lifecycle; they install no guards.
    const websocketRoutes = vi.spyOn(context, 'routeWebSocket');
    const httpRoutes = vi.spyOn(context, 'route');
    const httpUnroutes = vi.spyOn(context, 'unroute');
    const errors: string[] = [];
    try {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(String(error)));
      const reports: any[] = [];
      let firstSnapshot: string | undefined;
      for (let run = 0; run < 2; run++) {
        const report = await generated.runGeneratedPlan(page, { url: origin + '/blocked', AxeBuilder });
        reports.push(report);
        expect(report.status).toBe('failed');
        const isolation = report.results.filter((r: any) => r.id === 'NETWORK-ISOLATION');
        expect(isolation).toHaveLength(1);
        expect(isolation[0].status).toBe('failed');
        for (const url of [...socketURLs, peerOrigin + '/probe']) {
          expect(isolation[0].blockedRequests.filter((blocked: string) => blocked === url)).toHaveLength(runnableCount);
        }
        expect(isolation[0].blockedRequests).toHaveLength(runnableCount * (socketURLs.length + 1));
        const gates = report.results.filter((r: any) => r.id !== 'NETWORK-ISOLATION');
        expect(gates).toHaveLength(runnableCount);
        expect(gates.every((r: any) => r.status === 'passed'), JSON.stringify(gates)).toBe(true);
        expect(connections).toBe(0);
        expect(peerRequests).toBe(0);
        expect(websocketRoutes).toHaveBeenCalledTimes(1);
        expect(httpUnroutes).toHaveBeenCalledTimes(run + 1);
        expect(httpUnroutes.mock.calls[run]).toEqual(httpRoutes.mock.calls[run]);
        if (run === 0) firstSnapshot = JSON.stringify(report);
        expect(JSON.stringify(reports[0])).toBe(firstSnapshot);
      }
      const clean = await generated.runGeneratedPlan(page, { url: origin, AxeBuilder });
      expect(clean.status).toBe('automated-checks-passed-manual-outstanding');
      expect(clean.results).toHaveLength(runnableCount);
      expect(clean.results.every((r: any) => r.status === 'passed')).toBe(true);
      expect(JSON.stringify(reports[0])).toBe(firstSnapshot);
      expect(reports[0].results.at(-1).blockedRequests).not.toBe(reports[1].results.at(-1).blockedRequests);
      expect(websocketRoutes).toHaveBeenCalledTimes(1);
      expect(httpUnroutes).toHaveBeenCalledTimes(3);

      // Exercise finally on an exception outside the per-gate error handling.
      await expect(generated.runGeneratedPlan(page, {
        url: origin, AxeBuilder, screenshotPath: () => { throw new Error('intentional screenshot failure'); },
      })).rejects.toThrow('intentional screenshot failure');
      expect(httpUnroutes).toHaveBeenCalledTimes(4);
      expect(httpUnroutes.mock.calls[3]).toEqual(httpRoutes.mock.calls[3]);
      const recovered = await generated.runGeneratedPlan(page, { url: origin, AxeBuilder });
      expect(recovered.status).toBe('automated-checks-passed-manual-outstanding');
      expect(websocketRoutes).toHaveBeenCalledTimes(1);
      expect(httpUnroutes).toHaveBeenCalledTimes(5);
      expect(connections).toBe(0);
      expect(peerRequests).toBe(0);
      expect(errors).toEqual([]);
      // Navigate off-origin after cleanup: a leaked runner guard would abort.
      // Navigation avoids newer Chromium's local-network/CORS checks on fetch
      // from a page previously fulfilled through Playwright's API transport.
      await page.goto(peerOrigin + '/probe');
      expect(await page.locator('body').innerText()).toBe('local probe');
      expect(peerRequests).toBeGreaterThanOrEqual(1); // Browsers may also request a favicon after navigation.
    } finally {
      vi.restoreAllMocks();
      await context.close(); // The supported way to dispose the context's sole WS blocker.
    }
  }, 60_000);
});
