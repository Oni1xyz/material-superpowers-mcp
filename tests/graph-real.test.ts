import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildKnowledge } from '../src/graph/build.js';
import { graphRead, openKnowledge, validateGraph } from '../src/graph/store.js';
import { makeKnowledgeTools } from '../src/tools/knowledge.js';
import { makeDocsTools } from '../src/tools/docs.js';
import { openCorpus, readCorpusDocument } from '../src/material/corpus.js';
import { readResourceCoverage, readSpec } from '../src/material/resource-store.js';
import { docId } from '../src/graph/schema.js';
import { authoredRoutes } from '../src/graph/routes.js';

describe.runIf(process.env.MATERIAL_REAL_CACHE_TEST==='1')('real offline knowledge vault (no downloads)',()=>{
 it('regenerates deterministically and reconciles every actual document, resource and wikilink',async()=>{
  const a=await buildKnowledge(),b=await buildKnowledge();expect(a.snapshot).toBe(b.snapshot);const graph=await openKnowledge(),corpus=await openCorpus(),coverage=await readResourceCoverage(corpus);expect(coverage.status).toBe('ready');if(coverage.status!=='ready')throw new Error('Real resource sidecar required');expect(graph.index.corpusSnapshot).toBe(corpus.snapshot);expect(graph.index.resourceSnapshot).toBe(coverage.snapshot);expect(graph.index.counts.documents).toBe(corpus.index.documents.length);expect(graph.index.counts.resources).toBe(coverage.modules.length);validateGraph(graph.index);
  const ids=new Set(graph.index.nodes.map(n=>n.id));let links=0;for(const node of graph.index.nodes){const text=await graphRead(graph,node.id);for(const m of text.matchAll(/\[\[([^|\]]+)\|[^\]]*\]\]/g)){expect(ids.has(m[1])).toBe(true);links++;}}
  expect(links).toBe(graph.index.counts.edges*2);
  for(const entry of corpus.index.documents){const node=graph.index.nodes.find(n=>n.id===docId(entry.path));expect(node).toBeDefined();const doc=await readCorpusDocument(corpus,entry.path);expect(node!.citations[0].documentSha256).toBe(doc.sha256);expect(node!.citations[0].sourceSha256).toBe(doc.sourceSha256);}
  for(const module of coverage.modules){const node=graph.index.nodes.find(n=>n.resource?.moduleId===module.moduleId&&n.citations[0].path===module.path);expect(node?.resource?.status).toBe(module.status);expect(node?.resource?.pageFilterStatus).toBe(module.pageFilterStatus);expect(node?.resource?.contextEvaluation).toBe('not-evaluated');expect(node?.citations[0].sourcePointer).toBe(module.articlePointer);}
  for(const route of authoredRoutes)for(const target of route.targets)expect(graph.index.nodes.find(n=>n.id===route.id+'.md')?.outgoing.some(e=>e.id===docId(target.path)&&e.relation===target.relation&&e.origin==='authored-task-routing')).toBe(true);
  console.log(JSON.stringify({graphSnapshot:graph.snapshot,corpusSnapshot:corpus.snapshot,resourceSnapshot:coverage.snapshot,...graph.index.counts,verifiedWikilinks:links,vaultRoot:graph.vaultRoot}));
 },30000);
 it('follows task → guidance → accessibility/specs → exact sources and keeps typography unresolved',async()=>{
  const t=makeKnowledgeTools()[0],docs=makeDocsTools();
  for(const [query,task,family]of [['date input','date-input','date-pickers'],['adaptive navigation','adaptive-navigation','navigation-rail'],['settings form','settings-form','text-fields']]){
   const search:any=await t.run({query,limit:3});expect(search.results[0].id).toBe(`tasks/${task}.md`);const route:any=await t.run({id:search.results[0].id,limit:50});const guidance=route.outgoing.find((e:any)=>e.id===`docs/components/${family}/guidelines.md`);expect(guidance).toBeDefined();const read:any=await t.run({id:guidance.id,limit:50});expect(read.citations[0].path).toBe(`components/${family}/guidelines`);expect(read.outgoing.some((e:any)=>e.id===`docs/components/${family}/accessibility.md`)).toBe(true);expect(read.outgoing.some((e:any)=>e.id===`docs/components/${family}/specs.md`)).toBe(true);const source:any=await docs.find(x=>x.name==='material_read_doc')!.run({...read.actions.readDoc,maxCharacters:1000});expect(source.citation.url).toBe(read.citations[0].url);expect(source.text.length).toBeGreaterThan(0);
  }
  const type:any=await t.run({id:'docs/styles/typography/type-scale-tokens.md',limit:50});const edge=type.outgoing.find((e:any)=>e.relation==='resource');expect(edge).toBeDefined();const resource:any=await t.run({id:edge.id});expect(resource.resource.status).toBe('unsupported');expect(resource.resource.normalization).toBe('metadata-only');expect(resource.resource.contextEvaluation).toBe('not-evaluated');expect(resource.citations[0].sourcePointer).toMatch(/^\/sections\/2\/contentBlocks\//);const spec=await readSpec((await openCorpus()).dir,resource.actions.readSpec);expect(spec.rows).toHaveLength(0);expect(spec.modules[0].status).toBe('unsupported');
 },30000);
 it('serves the single navigation tool over actual SDK stdio with strict bounded errors and protocol-only stdout',async()=>{
  // Isolate this lane's MCP registration without changing the parent-owned server.
  const code=`import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';import {CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';import {makeKnowledgeTools} from './src/tools/knowledge.ts';import {executeTool} from './src/server.ts';const tool=makeKnowledgeTools()[0],s=new McpServer({name:'knowledge-integration',version:'1'});s.registerTool(tool.name,{description:tool.description,inputSchema:tool.inputSchema.shape},a=>executeTool(tool,a));s.server.setRequestHandler(CallToolRequestSchema,async r=>r.params.name===tool.name?executeTool(tool,r.params.arguments??{}):{isError:true,content:[{type:'text',text:'Unknown tool'}]});await s.connect(new StdioServerTransport());`;
  const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','--input-type=module','--eval',code],cwd:resolve('.'),stderr:'pipe'}),client=new Client({name:'knowledge-test',version:'1'});let stdout='',stderr='';transport.stderr?.on('data',c=>stderr+=c.toString());
  try{const ready=client.connect(transport);(transport as any)._process?.stdout?.on('data',(c:Buffer)=>stdout+=c.toString());await ready;expect((await client.listTools()).tools.map(t=>t.name)).toEqual(['material_navigate']);const home=await client.callTool({name:'material_navigate',arguments:{}});expect(home.isError).not.toBe(true);expect((home.structuredContent as Record<string,unknown>)?.id).toBe('home.md');
   for(const args of [{query:'date',extra:true},{id:'../home.md'},{id:'home.md',query:'date'},{limit:999},{cursor:'bad'}]){const r=await client.callTool({name:'material_navigate',arguments:args});expect(r.isError).toBe(true);expect(JSON.stringify(r).length).toBeLessThan(2000);}
   expect(stderr).toBe('');for(const line of stdout.trim().split('\n'))expect(JSON.parse(line).jsonrpc).toBe('2.0');
  }finally{await client.close();}
 },30000);
});
