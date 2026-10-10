import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
it('real SDK stdio initializes, lists twelve tools, calls, rejects invalid input, and emits only protocol lines',async()=>{
  const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','src/index.ts'],cwd:resolve('.'),stderr:'pipe'});
  const client=new Client({name:'core-test',version:'1.0.0'}); let stdout='';let stderr='';
  transport.stderr?.on('data',chunk=>{stderr+=chunk.toString();});
  try {
    const connection=client.connect(transport);
    // Inspect subprocess output for purity; this is a test-only SDK implementation detail.
    (transport as any)._process?.stdout?.on('data',(chunk:Buffer)=>{stdout+=chunk.toString();});
    await connection;
    expect((await client.listTools()).tools).toHaveLength(12);
    const good=await client.callTool({name:'material_generate_tokens',arguments:{seedColor:'#6750A4'}});
    expect(good.isError).not.toBe(true);
    expect(good.structuredContent).toBeDefined();
    const invalid=await client.callTool({name:'material_search_docs',arguments:{query:'x',limit:999,extra:'ignored?'}});
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid).length).toBeLessThan(2000);
    const strict=await client.callTool({name:'material_generate_tokens',arguments:{extra:'must reject'}});
    expect(strict.isError).toBe(true);
    const unknown=await client.callTool({name:'no_such_tool',arguments:{}});
    expect(unknown.isError).toBe(true);
    expect(stderr).toBe('');
    expect(stdout.length).toBeGreaterThan(0);
    for(const line of stdout.trim().split('\n'))expect(JSON.parse(line).jsonrpc).toBe('2.0');
  }finally{await client.close();}
},20000);
