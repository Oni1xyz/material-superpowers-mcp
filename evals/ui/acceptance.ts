import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from 'playwright';

// Hand-maintained acceptance gates: deliberately do not import the planner or
// consult its generated checks/IDs. These remain independent of that output.
export const acceptanceViewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
];

export async function independentAcceptance(page: Page, url: string) {
  const results: { gate: string; breakpoint: string; passed: boolean; evidence: unknown }[] = [];
  for (const viewport of acceptanceViewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(url, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
    results.push({ gate: 'independent-no-horizontal-overflow', breakpoint: viewport.name, passed: overflow.width <= overflow.viewport + 1, evidence: overflow });
    const audit = await new AxeBuilder({ page }).analyze();
    const violations = audit.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }));
    results.push({ gate: 'independent-axe-serious-critical', breakpoint: viewport.name, passed: violations.length === 0, evidence: violations });
    const semantics = { title: await page.title(), headings: await page.getByRole('heading', { level: 1 }).count(), main: await page.getByRole('main').count() };
    results.push({ gate: 'independent-page-semantics', breakpoint: viewport.name, passed: semantics.title.length > 0 && semantics.headings === 1 && semantics.main === 1, evidence: semantics });
  }
  return results;
}

export const seededBadFixture = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Seeded failure fixture</title>
<style>body{margin:0;font:16px sans-serif}main{width:2000px;background:white;color:black}button{width:48px;height:48px}button:focus{outline:none;box-shadow:none}</style></head>
<body><main><h1>Known bad control and layout</h1><p>This independently authored fixture intentionally overflows every acceptance viewport and has an unnamed button.</p><button type="button"></button></main></body></html>`;
