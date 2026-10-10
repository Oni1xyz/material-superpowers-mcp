import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));

// Hostile inputs/results never enter the runner. No cores, bounded heap, wall
// time, output, and a non-catchable timeout signal, including the real SDK path.
function constrained(body: string, heap = 96) {
  const child = spawnSync('/bin/sh', ['-c', 'ulimit -c 0; exec "$@"', 'input-regression', process.execPath,
    `--max-old-space-size=${heap}`, '--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { allTools, executeTool, createServer } from './src/server.ts';
      const tool = name => allTools.find(t => t.name === name);
      const rejected = response => {
        assert.equal(response.isError, true);
        assert.equal(response.content.length, 1);
        assert.ok(response.content[0].text.length <= 1200);
        assert.match(response.content[0].text, /^Invalid input:/);
      };
      ${body}
      console.log(JSON.stringify({ok: true}));
    `], { cwd, encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 8192 });
  expect(child.error?.message, child.stderr).toBeUndefined();
  expect(child.signal, child.stderr).toBeNull();
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({ ok: true });
}

describe('central MCP argument resource limits', () => {
  it('rejects the 300052-byte eval-plan reproduction before Zod on a 96MiB heap', () => {
    constrained(`
      const input = {target:'audit',riskLevel:'low',breakpoints:Array.from({length:100000},()=>({}))};
      assert.equal(JSON.stringify(input).length, 300052);
      rejected(await executeTool(tool('material_generate_eval_plan'), input));
    `);
  }, 25_000);

  it('rejects hostile palette records and scalar arrays on a 96MiB heap', () => {
    constrained(`
      const palette = {};
      for (let i=0;i<100000;i++) palette['color'+i] = {};
      rejected(await executeTool(tool('material_map_brand_to_tokens'), {palette}));
      // These malformed collections fit preflight: schema validation itself must
      // fail promptly, not rely solely on the oversized-collection rejection.
      const smallPalette = Object.fromEntries(Array.from({length:32},(_,i)=>['color'+i,{}]));
      rejected(await executeTool(tool('material_map_brand_to_tokens'), {palette:smallPalette}));
      rejected(await executeTool(tool('material_generate_eval_plan'), {target:'audit',riskLevel:'low',breakpoints:Array.from({length:6},()=>({}))}));
      rejected(await executeTool(tool('material_plan_screen'), {screen:'audit',userGoal:'review',platform:'web',constraints:Array(100000).fill(null)}));
      rejected(await executeTool(tool('material_generate_tokens'), Array(100000).fill(false)));
    `);
  }, 25_000);

  it('rejects deep JSON, aggregate nodes and aggregate strings without recursion or serialization', () => {
    constrained(`
      let deep = null;
      for (let i=0;i<50000;i++) deep = {next:deep};
      rejected(await executeTool(tool('material_generate_tokens'), {deep}));
      const broad = Array.from({length:100},()=>Array(100).fill(0));
      rejected(await executeTool(tool('material_generate_tokens'), {broad}));
      const strings = Array(100).fill('x'.repeat(190000));
      rejected(await executeTool(tool('material_generate_tokens'), {strings}));
    `);
  }, 25_000);

  it('protects the actual SDK CallToolRequest handler and preserves registry and error contracts', () => {
    constrained(`
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createServer();
      const client = new Client({name:'input-security',version:'1.0.0'});
      try {
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        const listed = (await client.listTools()).tools;
        assert.equal(listed.length, 13);
        assert.equal(new Set(listed.map(t=>t.name)).size, 13);
        for (const entry of listed) {
          rejected(await client.callTool({name:entry.name,arguments:{hostile:Array(100000).fill({})}}));
        }
        rejected(await client.callTool({name:'material_generate_eval_plan',arguments:{target:'audit',riskLevel:'low',breakpoints:Array.from({length:100000},()=>({}))}}));
        rejected(await client.callTool({name:'material_generate_tokens',arguments:{extra:true}}));
        const unknown = await client.callTool({name:'no_such_tool',arguments:{}});
        assert.equal(unknown.isError,true);
        assert.match(unknown.content[0].text,/Unknown tool/);
        const normal = await client.callTool({name:'material_generate_tokens',arguments:{}});
        assert.ok(!normal.isError);
        assert.ok(normal.structuredContent.css);
      } finally { await client.close(); await server.close(); }
    `, 128);
  }, 25_000);

  it('preserves the existing 200000 HTML + 200000 CSS review boundary and defaults', () => {
    constrained(`
      const html = '<!--' + 'x'.repeat(199993) + '-->';
      const css = '/*' + 'x'.repeat(199996) + '*/';
      const review = tool('material_review_ui_code');
      assert.equal(review.inputSchema.safeParse({html,css}).success,true);
      const response = await executeTool(review,{html,css});
      assert.ok(!response.isError, response.content[0].text);
      assert.deepEqual(response.structuredContent.findings,[]);
      const normal = await executeTool(tool('material_generate_eval_plan'),{target:'audit',riskLevel:'low'});
      assert.ok(!normal.isError, normal.content[0].text);
    `);
  }, 25_000);
});
