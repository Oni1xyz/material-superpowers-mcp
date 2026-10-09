import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { reviewUi, reviewTokens, uiReviewSchema } from '../src/design/review.js';
import { executeTool } from '../src/server.js';

const cwd = fileURLToPath(new URL('..', import.meta.url));

// Never materialize the hostile report in the test runner. Both the heap and
// captured output are capped, and a stuck child is killed instead of hanging CI.
function constrainedReview(body: string) {
  const child = spawnSync(process.execPath, ['--max-old-space-size=96', '--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { allTools, executeTool } from './src/server.ts';
    ${body}
  `], { cwd, encoding: 'utf8', timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 8192 });
  expect(child.error?.message, child.stderr).toBeUndefined();
  expect(child.signal, child.stderr).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout);
}

describe('review resource limits', () => {
  it('bounds a schema-valid selector amplification attack through executeTool on a 96MB heap', () => {
    const result = constrainedReview(`
      const css = '.' + 'a'.repeat(60000) + '{' + 'color:#fff;'.repeat(6000) + '}';
      const tool = allTools.find(t => t.name === 'material_review_ui_code');
      assert.equal(tool.inputSchema.safeParse({css}).success, true);
      const response = await executeTool(tool, {css});
      assert.ok(!response.isError);
      const report = response.structuredContent;
      assert.equal(report.summary.totalFindingCount, 6000);
      assert.ok(report.truncation.omittedFindingCount > 0);
      assert.ok(report.truncation.truncatedEvidenceCount > 0);
      assert.ok(response.content[0].text.length < 500000);
      assert.deepEqual(JSON.parse(response.content[0].text), report);
      console.log(JSON.stringify({ findingCount: report.findings.length, characters: response.content[0].text.length }));
    `);
    expect(result.findingCount).toBeLessThanOrEqual(100);
    expect(result.characters).toBeLessThan(500_000);
  }, 20_000);

  it('preserves ordinary findings exactly and reports no truncation', () => {
    const report = reviewUi({ html: '<img>', css: 'button { outline: none; color: #fff; }' });
    expect(report.findings.map(f => [f.ruleId, f.evidence, f.line])).toEqual([
      ['html-image-alt', '<img> at line 1', 1],
      ['css-focus-suppressed', 'button: outline: none', 1],
      ['css-literal-color', 'button: color: #fff', 1],
    ]);
    expect(report.summary).toEqual({ findingCount: 3, highConfidence: 2, totalFindingCount: 3 });
    expect(report.truncation).toMatchObject({ omittedFindingCount: 0, truncatedEvidenceCount: 0, omittedEvidenceCharacterCount: 0 });
  });

  it('shares count and evidence budgets across HTML, inline CSS, style blocks and supplied CSS', () => {
    const html = '<img>'.repeat(200) + '<div style="outline: none"></div><style>b{color:#fff}</style>';
    const report = reviewUi({ html, css: '.x { outline: none; }' });
    expect(report.findings).toHaveLength(100);
    expect(report.summary.totalFindingCount).toBe(203);
    expect(report.truncation.omittedFindingCount).toBe(103);
  });

  it('bounds total retained evidence before serialization, including long HTML attributes', () => {
    const html = `<div id="${'x'.repeat(50000)}" role="${'r'.repeat(50000)}" onclick="x()" tabindex="${'1'.repeat(50000)}"></div>`;
    const report = reviewUi({ html, css: '.' + 'a'.repeat(10000) + '{' + 'color:#fff;'.repeat(1000) + '}' });
    expect(uiReviewSchema.safeParse({ html }).success).toBe(true);
    expect(report.findings.every(f => f.evidence.length <= 2048)).toBe(true);
    expect(report.findings.reduce((n, f) => n + f.evidence.length, 0)).toBeLessThanOrEqual(32768);
    expect(report.summary.totalFindingCount).toBe(1002);
    expect(report.findings.length + report.truncation.omittedFindingCount).toBe(1002);
    expect(report.truncation.omittedEvidenceCharacterCount).toBeGreaterThan(50000);
    expect(JSON.stringify(report).length).toBeLessThan(500000);
  });

  it('bounds token selector and unresolved-reference evidence', () => {
    const selector = '.' + 'x'.repeat(60000);
    const missing = '--' + 'm'.repeat(60000);
    const report = reviewTokens({ css: `${selector}{--md-sys-color-primary:#fff;--md-sys-color-on-primary:#fff;--x:var(${missing})}` });
    expect(report.findings.map(f => f.ruleId)).toEqual(['tokens-role-coverage', 'tokens-unresolved-reference', 'tokens-pair-contrast']);
    expect(report.findings.every(f => f.evidence.length <= 2048)).toBe(true);
    expect(report.truncation.truncatedEvidenceCount).toBe(2);
  });

  it('bounds token finding count and CSS parse error evidence', () => {
    const report = reviewTokens({ css: ':root{--md-sys-color-primary:#fff;--md-sys-color-on-primary:#fff}'.repeat(1000) });
    expect(report.findings).toHaveLength(100);
    expect(report.summary.totalFindingCount).toBe(1001);
    expect(report.truncation.omittedFindingCount).toBe(901);
    const malformed = reviewUi({ css: '.' + 'a'.repeat(190000) + '{' });
    expect(malformed.findings[0]?.ruleId).toBe('css-parse');
    expect(malformed.findings[0]!.evidence.length).toBeLessThanOrEqual(2048);
  });

  it('traverses deeply nested HTML/CSS without recursive reviewer stack growth or repeated descendant text', () => {
    expect(constrainedReview(`
      const html = '<label>' + '<div>'.repeat(3000) + 'Name <input>' + '</div>'.repeat(3000) + '</label>' +
        '<div id="name">' + 'x'.repeat(20000) + '</div>' + '<button aria-labelledby="name"></button>'.repeat(1500);
      const css = '@media all{'.repeat(1500) + 'b{outline:none}' + '}'.repeat(1500);
      const tool = allTools.find(t => t.name === 'material_review_ui_code');
      const response = await executeTool(tool, {html,css});
      assert.ok(!response.isError);
      assert.deepEqual(response.structuredContent.findings.map(f => f.ruleId), ['css-focus-suppressed']);
      console.log(JSON.stringify({ok:true}));
    `)).toEqual({ ok: true });
  }, 20_000);

  it('rejects amplified non-review results before JSON.stringify allocates them', () => {
    expect(constrainedReview(`
      const { z } = await import('zod');
      const repeated = 'x'.repeat(60000);
      const tool = {name:'test', description:'test', inputSchema:z.object({}), run:() => ({items:Array(6000).fill(repeated)})};
      const response = await executeTool(tool, {});
      assert.equal(response.isError, true);
      assert.match(response.content[0].text, /500000-character safety limit/);
      console.log(JSON.stringify({ok:true}));
    `)).toEqual({ ok: true });
  }, 20_000);

  it('preserves JSON escaping and enforces exact serialized boundaries', async () => {
    const execute = (result: unknown) => executeTool({ name: 'test', description: 'test', inputSchema: z.object({}), run: () => result }, {});
    for (const text of ['\u0000\b\t\n\f\r\\"😀\ud800\udfff', 'x'.repeat(499989)]) {
      const value = { text };
      const response = await execute(value);
      expect(response.isError).not.toBe(true);
      expect(response.content).toEqual([{ type: 'text', text: JSON.stringify(value) }]);
      expect(response.structuredContent).toEqual(value);
    }
    expect((await execute({ text: 'x'.repeat(499990) })).isError).toBe(true);
    // A transport must not revisit omitted fields or execute serialization hooks.
    const ordinary = { missing: undefined, array: [undefined, NaN, Infinity], toJSON: () => { throw new Error('must not run'); } };
    expect((await execute(ordinary)).structuredContent).toEqual({ array: [null, null, null] });
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect((await execute(circular)).isError).toBe(true);
    let deep: unknown = {};
    for (let i = 0; i < 200; i++) deep = { child: deep };
    expect((await execute(deep)).isError).toBe(true);
    expect((await execute({ get value() { throw new Error('must not run'); } })).content).toEqual([
      { type: 'text', text: 'Tool output must not contain getters' },
    ]);
  });

  it('counts JSON escaping and repeated object references while allowing ordinary results', async () => {
    const execute = (result: unknown) => executeTool({ name: 'test', description: 'test', inputSchema: z.object({}), run: () => result }, {});
    const normal = { nested: [{ text: '\u0000\\"😀' }], count: 2 };
    expect((await execute(normal)).content).toEqual([{ type: 'text', text: JSON.stringify(normal) }]);
    expect((await execute({ text: '\u0000'.repeat(90000) })).isError).toBe(true);
    const shared = { text: 'x'.repeat(10000) };
    expect((await execute({ items: Array(100).fill(shared) })).isError).toBe(true);
  });
});
