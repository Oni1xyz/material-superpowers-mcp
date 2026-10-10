import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { navigationInstructions } from '../src/graph/instructions.js';

it.runIf(process.env.MATERIAL_REAL_CACHE_TEST==='1')('production MCP advertises concise instructions and supports a linked evidence journey',async()=>{
 const client=new Client({name:'graph-production',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:['dist/index.js'],cwd:resolve('.'),env:Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined)),stderr:'pipe'});
 let stderr='';transport.stderr?.on('data',chunk=>stderr+=chunk.toString());
 try{
  await client.connect(transport);
  expect((await client.listTools()).tools).toHaveLength(13);
  expect(client.getInstructions()).toContain(navigationInstructions);
  expect(client.getInstructions()!.trim().split(/\s+/).length).toBeLessThan(90);
  const call=async(name:string,args:Record<string,unknown>)=>{const result=await client.callTool({name,arguments:args});expect(result.isError,JSON.stringify(result)).not.toBe(true);return result.structuredContent as any;};
  const search=await call('material_navigate',{query:'date input',limit:3});
  expect(search.results[0].id).toBe('tasks/date-input.md');
  const task=await call('material_navigate',{id:search.results[0].id,limit:50});
  const check=task.outgoing.find((edge:any)=>edge.relation==='check');expect(check).toBeDefined();
  const note=await call('material_navigate',{id:check.id,limit:50});
  const evidence=await call('material_read_doc',{...note.actions.readDoc,maxCharacters:1000});
  expect(evidence.citation.url).toBe(note.citations[0].url);expect(evidence.text.length).toBeGreaterThan(0);
  const home=await call('material_navigate',{id:'home.md',limit:1});expect(home.hasMore).toBe(true);
  const next=await call('material_navigate',{id:'home.md',limit:1,cursor:home.nextCursor});expect(next.recordOffset).toBeGreaterThan(home.recordOffset);
  for(const args of [{id:'home.md',query:'date'},{id:'../home.md'},{query:'date',extra:true}])expect((await client.callTool({name:'material_navigate',arguments:args})).isError).toBe(true);
  expect(stderr).toBe('');
 }finally{await client.close();}
},30000);
