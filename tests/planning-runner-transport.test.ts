import { beforeAll, describe, expect, it, vi } from 'vitest';
import { planningTools } from '../src/tools/planning.js';

let generated: any;
let runnableCount: number;
beforeAll(async () => {
  const planner = planningTools.find(t => t.name === 'material_generate_eval_plan')!;
  const plan: any = await planner.run({ target: 'Runner transport contract', riskLevel: 'low', breakpoints: [{ name: 'desktop', width: 800, height: 600 }] });
  generated = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(plan.artifact.source).toString('base64'));
  runnableCount = plan.checks.filter((c: any) => c.execution === 'runnable').length;
});

// Protocol-level complements to the real, guard-free browser regressions in
// planning-network.test.ts. These exercise the exact emitted module with a
// synthetic transport, NOT evidence of actual browser network isolation.
async function transportRun(status: number, fetchFailure = false) {
  let guard: (route: any) => Promise<void>;
  const response = { status: () => status, dispose: vi.fn(async () => {}) };
  const route = {
    request: () => ({ url: () => 'http://127.0.0.1:12345/fixture?token=hidden#fragment' }),
    fetch: vi.fn(async () => { if (fetchFailure) throw new Error('transport failed'); return response; }),
    fulfill: vi.fn(async () => {}), abort: vi.fn(async () => {}), continue: vi.fn(async () => {}),
  };
  const context = {
    routeWebSocket: vi.fn(async () => {}),
    route: vi.fn(async (_pattern: string, handler: typeof guard) => { guard = handler; }),
    unroute: vi.fn(async () => {}),
  };
  const page = {
    context: () => context,
    setViewportSize: async () => {}, emulateMedia: async () => {},
    goto: async () => {
      await guard(route);
      // Deliberately stop before unrelated UI gates in this transport unit test.
      throw new Error('synthetic navigation result');
    },
  };
  const report = await generated.runGeneratedPlan(page, { url: 'http://127.0.0.1:12345/fixture' });
  expect(context.unroute).toHaveBeenCalledWith('**/*', context.route.mock.calls[0][1]);
  expect(route.continue).not.toHaveBeenCalled();
  expect(route.fetch).toHaveBeenCalledTimes(runnableCount);
  for (const args of route.fetch.mock.calls) expect(args).toEqual([{ maxRedirects: 0, maxRetries: 0, timeout: 10000 }]);
  return { report, route, response };
}

describe('emitted runner single-hop transport contract', () => {
  it.each([300, 301, 302, 303, 304, 305, 306, 307, 308, 399])('aborts HTTP %s without fulfilling a redirect', async status => {
    const { report, route, response } = await transportRun(status);
    expect(route.abort).toHaveBeenCalledTimes(runnableCount);
    expect(route.fulfill).not.toHaveBeenCalled();
    expect(response.dispose).toHaveBeenCalledTimes(runnableCount);
    expect(report.results.find((r: any) => r.id === 'NETWORK-ISOLATION')).toMatchObject({
      blockedRequestCount: runnableCount, omittedBlockedRequestCount: 0,
      blockedRequests: Array(runnableCount).fill('http://127.0.0.1:12345/fixture'),
    });
  });

  it.each([200, 204, 404, 500])('fulfills non-redirect HTTP %s and disposes its fetch buffer', async status => {
    const { report, route, response } = await transportRun(status);
    expect(route.abort).not.toHaveBeenCalled();
    expect(route.fulfill).toHaveBeenCalledTimes(runnableCount);
    expect(route.fulfill).toHaveBeenCalledWith({ response });
    expect(response.dispose).toHaveBeenCalledTimes(runnableCount);
    expect(report.results.some((r: any) => r.id === 'NETWORK-ISOLATION')).toBe(false);
  });

  it('fails closed when the single-hop fetch fails', async () => {
    const { report, route, response } = await transportRun(200, true);
    expect(route.abort).toHaveBeenCalledTimes(runnableCount);
    expect(route.fulfill).not.toHaveBeenCalled();
    expect(response.dispose).not.toHaveBeenCalled();
    expect(report.results.find((r: any) => r.id === 'NETWORK-ISOLATION').blockedRequestCount).toBe(runnableCount);
  });
});
