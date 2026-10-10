import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const inputs={
  material_search_docs:{query:'button accessibility',limit:2},
  material_read_doc:{path:'components/buttons/overview',maxCharacters:500},
  material_coverage_status:{},
  material_read_spec:{path:'styles/spacing/tokens',limit:3},
  material_get_context:{task:'button typography',mode:'implementation',maxSources:2,maxCharacters:1000},
  material_generate_tokens:{seedColor:'#6750A4',mode:'both'},
  material_map_brand_to_tokens:{palette:{primary:'#546a2f',secondary:'#755846'}},
  material_component_recipe:{component:'button',platform:'plain-html-css'},
  material_review_ui_code:{html:'<button type="button">Save</button>',css:'button { min-height:48px; }'},
  material_review_tokens:{css:':root { --md-sys-color-primary: #6750a4; --md-sys-color-on-primary: #ffffff; }'},
  material_plan_screen:{screen:'Settings',userGoal:'Update account preferences',platform:'web'},
  material_generate_eval_plan:{target:'Settings',components:['button'],riskLevel:'medium'},
};
const client=new Client({name:'material-smoke',version:'0.1.0'});
const docker=process.argv.includes('--docker');
const transport=new StdioClientTransport({command:docker?'docker':process.execPath,args:docker?['run','--rm','-i','--network','none',...(process.argv.includes('--with-cache')?['-v',`${resolve(process.env.MATERIAL_CACHE_DIR??'.cache/material')}:/app/.cache/material:ro`]:[]),'material-superpowers-mcp:local']:['dist/index.js'],stderr:'pipe',env:{...process.env}});
const protocolErrors=[];let stderr='';
transport.stderr?.on('data',chunk=>{stderr+=chunk.toString();});
client.onerror=error=>protocolErrors.push(String(error));
const results=[];
try {
  await client.connect(transport);
  const {tools}=await client.listTools();
  assert.equal(tools.length,12);assert.deepEqual(tools.map(t=>t.name).sort(),Object.keys(inputs).sort());
  for(const tool of tools) {
    const result=await client.callTool({name:tool.name,arguments:inputs[tool.name]});
    const missing=result.isError && ((tool.name.match(/material_(search_docs|read_doc|get_context|coverage_status|read_spec)$/) && JSON.stringify(result).includes('npm run refresh-cache')) || (tool.name === 'material_read_spec' && JSON.stringify(result).includes('Resource sidecar missing:')));
    if(missing&&!process.argv.includes('--require-cache'))results.push({name:tool.name,status:'expected-missing-cache',note:'Run npm run refresh-cache and npm run refresh-resources, then npm run smoke -- --require-cache for real source calls.'});
    else {assert.notEqual(result.isError,true,`${tool.name}: ${JSON.stringify(result)}`);assert.ok(result.content.length);assert.ok(result.structuredContent);results.push({name:tool.name,status:'ok'});}
  }
  for(const [name,args] of [['material_search_docs',{query:'x',limit:999}],['material_generate_tokens',{seedColor:'not a color'}],['material_generate_tokens',{unexpected:true}],['no_such_tool',{}]]) {
    const result=await client.callTool({name,arguments:args});assert.equal(result.isError,true);assert.ok(result.content[0].text.length<=1200);
  }
  assert.deepEqual(protocolErrors,[]);assert.equal(stderr,'');
  console.log(JSON.stringify({discovered:tools.length,called:results.length,negativeChecks:4,results},null,2));
} finally {await client.close();}
