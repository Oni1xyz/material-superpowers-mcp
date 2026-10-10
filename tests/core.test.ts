import { expect, it } from 'vitest';
import { z } from 'zod';
import { executeTool, createServer, allTools } from '../src/server.js';

it('registers exactly twelve unique tools', () => {
  expect(allTools).toHaveLength(12);
  expect(new Set(allTools.map(t => t.name)).size).toBe(12);
  expect(createServer()).toBeDefined();
});
it('validates before running and returns bounded MCP errors', async () => {
  let ran = false;
  const tool = { name:'test', description:'test', inputSchema:z.object({value:z.string().max(5)}).strict(), run:() => { ran=true; return {ok:true}; } };
  const invalid = await executeTool(tool, {value:'too long'});
  expect(invalid.isError).toBe(true);
  expect(ran).toBe(false);
  const good = await executeTool(tool,{value:'ok'});
  expect(good.isError).not.toBe(true);
  expect(good.structuredContent).toEqual({ok:true});
  const fail = await executeTool({...tool,run:() => {throw new Error('x'.repeat(10000));}}, {value:'ok'});
  expect(fail.isError).toBe(true);
  expect(fail.content[0].text.length).toBeLessThanOrEqual(1200);
});
