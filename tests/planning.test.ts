import { describe, expect, it, vi } from 'vitest';
import { planningTools } from '../src/tools/planning.js';

const tool = (name: string) => planningTools.find(t => t.name === name)!;
const screen = (input: any) => tool('material_plan_screen').run(input) as any;
const plan = (input: any) => tool('material_generate_eval_plan').run(input) as any;
const base = { target: 'Account settings', riskLevel: 'medium' };

describe('deterministic planning tools', () => {
  it('exports the two contracted tools with object schemas', () => {
    expect(planningTools.map(t => t.name)).toEqual(['material_plan_screen', 'material_generate_eval_plan']);
    for (const t of planningTools) expect(t.inputSchema._def.typeName).toBe('ZodObject');
  });
  it('preserves unknown goals and constraints without claiming semantic understanding', () => {
    const input = { screen: 'Quantum dashboard', userGoal: 'Entangle the customer timeline', platform: 'web', constraints: ['No red', 'Custom keyboard ritual'] };
    const out = screen(input);
    expect(out).toEqual(screen(input));
    expect(JSON.stringify(out.manualChecks)).toContain(input.userGoal);
    expect(JSON.stringify(out.manualChecks)).toContain('Custom keyboard ritual');
    expect(out.status).toBe('template-not-validated');
  });
  it('matches only documented screen keyword rules and labels authored guidance', () => {
    for (const [name, pattern] of [['Settings', 'settings'], ['Catalog', 'collection'], ['Registration form', 'form'], ['Unusual canvas', 'generic']]) {
      const out = screen({ screen: name, userGoal: 'Do a task', platform: 'desktop' });
      expect(out.matching.pattern).toBe(pattern);
      expect(out.provenance.kind).toBe('authored-guidance');
      expect(out.manualChecks.some((c: any) => c.id === 'NATIVE')).toBe(true);
    }
  });
  it('serializes malicious strings as data in a valid executable module', async () => {
    const target = '`;globalThis.PWNED = true;// ${globalThis.PWNED = true} </script>\u2028';
    const out = plan({ ...base, target, flows: [target] });
    const module = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(out.artifact.source).toString('base64'));
    expect(module.specification.metadata.target).toBe(target);
    expect(typeof module.runGeneratedPlan).toBe('function');
    expect((globalThis as any).PWNED).toBeUndefined();
    await expect(module.runGeneratedPlan({}, { url: 'https://example.com' })).rejects.toThrow('loopback');
  });
  it('covers baseline requirements with stable unique IDs, provenance and criteria', () => {
    const out = plan(base);
    expect(out).toEqual(plan(base));
    expect(new Set(out.checks.map((c: any) => c.id)).size).toBe(out.checks.length);
    for (const c of out.checks) {
      expect(c.source).toBeTruthy(); expect(c.passCriteria).toBeTruthy();
      expect(['runnable', 'manual']).toContain(c.execution);
      expect(c.status).toBe(c.execution === 'manual' ? 'outstanding' : 'not-run');
    }
    expect(out.checks.map((c: any) => c.id)).toEqual(expect.arrayContaining(['A11Y-AXE', 'KEYBOARD-FOCUS', 'LAYOUT-OVERFLOW', 'MOTION-REDUCED', 'VISUAL-REVIEW']));
    expect(out.artifact.source).toContain('export async function runGeneratedPlan');
  });
  it('documents isolation prerequisites and fails closed without WebSocket routing', async () => {
    const out = plan(base);
    expect(out.artifact.instructions).toContain('serviceWorkers: "block"');
    expect(out.artifact.instructions).toContain('Playwright >= 1.48');
    expect(out.artifact.instructions).toContain('close the dedicated context');
    const module = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(out.artifact.source).toString('base64'));
    const goto = vi.fn();
    await expect(module.runGeneratedPlan({ context: () => ({}), goto }, { url: 'http://127.0.0.1:12345' })).rejects.toThrow('NETWORK-ISOLATION requires Playwright');
    expect(goto).not.toHaveBeenCalled();
  });
  it('removes the HTTP route and detaches run state even if guard setup fails', async () => {
    const out = plan(base);
    const module = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(out.artifact.source).toString('base64'));
    const context = {
      routeWebSocket: vi.fn().mockResolvedValue(undefined),
      route: vi.fn().mockRejectedValue(new Error('intentional route setup failure')),
      unroute: vi.fn().mockResolvedValue(undefined),
    };
    const page = { context: () => context, goto: vi.fn() };
    for (let run = 0; run < 2; run++) {
      await expect(module.runGeneratedPlan(page, { url: 'http://127.0.0.1:12345' })).rejects.toThrow('intentional route setup failure');
      expect(context.unroute.mock.calls[run]).toEqual(context.route.mock.calls[run]);
    }
    expect(context.routeWebSocket).toHaveBeenCalledTimes(1);
    expect(context.unroute).toHaveBeenCalledTimes(2);
    expect(page.goto).not.toHaveBeenCalled();
  });
  it('never turns arbitrary flows into passing smoke tests', () => {
    const out = plan({ ...base, flows: ['Make a payment', 'dialog'] });
    const custom = out.checks.find((c: any) => c.id === 'FLOW-CUSTOM-1');
    expect(custom.execution).toBe('manual'); expect(custom.status).toBe('outstanding');
    expect(custom.requirement).toBe('Make a payment');
    expect(out.checks.some((c: any) => c.id === 'DIALOG-ESCAPE')).toBe(true);
  });
  it('requires explicit confirmation, cancellation and absence of side effects at high risk', () => {
    const high = plan({ ...base, riskLevel: 'high' });
    for (const id of ['RISK-CONFIRM', 'RISK-CANCEL', 'RISK-NO-SIDE-EFFECTS']) {
      expect(high.checks.find((c: any) => c.id === id)?.status).toBe('outstanding');
    }
    const contract = plan({ ...base, riskLevel: 'high', flows: ['confirm-action'] });
    expect(contract.checks.find((c: any) => c.id === 'RISK-CANCEL').execution).toBe('runnable');
    expect(contract.checks.find((c: any) => c.id === 'RISK-DOMAIN-REVIEW').execution).toBe('manual');
    expect(plan({ ...base, riskLevel: 'low' }).checks.some((c: any) => c.id === 'RISK-CANCEL')).toBe(false);
  });
  it('validates URL metadata but embeds it only as JSON data, never as executable interpolation', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com/', 'ftp://example.com', 'https://example.com/\n']) {
      expect(() => plan({ ...base, url })).toThrow();
    }
    const evil = '`;globalThis.PWNED=1;//${process.exit()} </script>\u2028';
    const out = plan({ ...base, url: 'https://example.com/?q=%60%24%7B', target: evil, flows: [evil] });
    expect(out.metadata.url).toBe('https://example.com/?q=%60%24%7B');
    expect(out.artifact.source).not.toContain('</script>');
    expect(out.artifact.filename).toBe('material-eval-plan.mjs');
    expect(JSON.stringify(out.checks)).toContain('PWNED');
  });
  it('bounds inputs and rejects invalid or duplicate breakpoints', () => {
    for (const input of [{ ...base, target: '' }, { ...base, flows: Array(21).fill('x') }, { ...base, target: 'x'.repeat(2001) }, { ...base, riskLevel: 'critical' }, { ...base, breakpoints: [{ name: 'a', width: 0, height: 10 }] }, { ...base, breakpoints: [{ name: 'a', width: 320, height: 640 }, { name: 'a', width: 640, height: 640 }] }]) {
      expect(() => plan(input)).toThrow();
    }
    expect(() => screen({ screen: 'x', userGoal: 'y', platform: 'watch' })).toThrow();
  });
});
