import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishCorpus, type CorpusDocument } from '../src/material/corpus.js';
import { parseCarbonDocument } from '../src/material/carbon.js';
import { sha256 } from '../src/material/cache.js';
import { buildKnowledge } from '../src/graph/build.js';
import { openKnowledge, graphRead, validateGraph } from '../src/graph/store.js';
import { makeKnowledgeTools } from '../src/tools/knowledge.js';
import { navigationInstructions } from '../src/graph/instructions.js';
import * as store from '../src/graph/store.js';
import { GRAPH_LIMITS, nodeSchema, parseGraph, graphIndexSchema } from '../src/graph/schema.js';
import { resourceIndexSchema } from '../src/material/resource-store.js';
const dirs:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
const version='2026-09-23_06-10-05',documentId='e31df68a-59d4-41dc-8743-8c48b476d4f8.json';
async function sidecar(dir:string,docs:CorpusDocument[],salt='first'){
 const corpus=await store.sourceBinding(dir);const endpoints:any[]=[];
 const modules=docs.map((doc,i)=>{const block=doc.blocks.find(b=>b.chunks.some(c=>c.resource))!,ci=block.chunks.findIndex(c=>c.resource),chunk=block.chunks[ci],ref=chunk.resource!,status=['fetched','failed','budget-blocked','unsupported'][i];
 const url=`https://m3.material.io/_dsm/data/dsdb-m3/${version}/MEASUREMENT.${ref.name.split('/').at(-1)}.json`,key=sha256(url);
 if(i<3)endpoints.push({key,resourceName:ref.name,moduleType:ref.moduleType,url,status,reused:false,...(i===0?{sourceSha256:sha256(salt),bytes:100,retrievedAt:'2026-10-10T00:00:00.000Z',dsdbVersion:'38.2.9',rowCount:0}:{})});
 return {path:doc.path,moduleId:chunk.id,blockId:block.id,resourceName:ref.name,moduleType:ref.moduleType,articleSourceSha256:doc.sourceSha256,articleSourceUrl:doc.sourceUrl,articlePointer:`/sections/${block.provenance!.sectionIndex}/contentBlocks/${block.provenance!.blockIndex}/contentChunks/${ci}`,configuration:null,...(i<3?{endpointKey:key}:{}),status,pageFilterStatus:'unavailable',selectedTokenSets:[],missingTokenSets:[],contextEvaluation:'not-evaluated',rowCount:0,chunks:[]};});
 const index=resourceIndexSchema.parse({version:1,corpusSnapshot:corpus.corpusSnapshot,carbonVersion:version,createdAt:'2026-10-10T00:00:00.000Z',modules,endpoints,run:{requests:0,fetchedBytes:0,chargedBytes:0,elapsedMs:0,limits:{requests:0,bytes:0,timeMs:0}}}),text=JSON.stringify(index),snapshot=sha256(text);await mkdir(join(dir,'resources'),{recursive:true});await writeFile(join(dir,'resources',snapshot+'.json'),text);await writeFile(join(dir,'resources/manifest.json'),JSON.stringify({version:1,snapshot,corpusSnapshot:corpus.corpusSnapshot,carbonVersion:version}));return snapshot;
}
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'graph-'));dirs.push(dir);
 const docs:CorpusDocument[]=['Overview','Specs','Guidelines','Accessibility'].map(section=>{
 const parsed=parseCarbonDocument({title:'Buttons [[evil|<b>]]',sections:[{name:section,contentBlocks:[{pageContentBlockId:'visible',contentChunks:[{contentChunkType:'TEXT',htmlValue:'<h2>Safe heading</h2><a href="https://m3.material.io/components/buttons/accessibility">Access</a><a href="https://example.com/unindexed">External</a>'},{contentChunkType:'LIBRARY_MODULE',resourceName:'designSystems/1234567890abcdef',libraryModuleType:'TYPOGRAPHY'}]},{isHidden:true,contentChunks:[{contentChunkType:'TEXT',htmlValue:'SECRET HIDDEN CONTENT'}]}]}]},section);
 const path='components/buttons/'+section.toLowerCase();return {...parsed,path,url:'https://m3.material.io/'+path,category:'components',sourceKind:'material-3',documentId,carbonVersion:version,sourceUrl:`https://m3.material.io/_dsm/content/m3/${version}/${documentId}`,section,sourceSha256:'a'.repeat(64),sha256:sha256(parsed.text),fetchedAt:'2026-10-10T00:00:00.000Z',extractionMethod:'synthetic-test'};
 });
 docs.forEach((doc,i)=>{const chunk=doc.blocks.flatMap(b=>b.chunks).find(c=>c.resource)!,ref=chunk.resource!;ref.moduleType=i===3?'TYPOGRAPHY':'MEASUREMENT';ref.name='designSystems/'+String(i+1).padStart(16,'0');chunk.metadata.resourceName=ref.name;chunk.metadata.libraryModuleType=ref.moduleType;});
 const info={carbonVersion:version,bundleUrl:'https://m3.material.io/static/angular/main.7906d9e8e8cae962.js',bundleSha256:'b'.repeat(64),sitemapSha256:'c'.repeat(64),discoveredAt:'2026-10-10T00:00:00.000Z',mappings:docs.map(d=>({path:d.path,url:d.url,category:d.category,status:'mapped' as const,documentId,section:d.section}))};
 await publishCorpus(dir,docs,info);return {dir,docs,info};
}
it('builds deterministic confined notes, exact links, symmetric backlinks and all reachable nodes',async()=>{
 const {dir}=await fixture();const a=await buildKnowledge({dir}),b=await buildKnowledge({dir});expect(a.snapshot).toBe(b.snapshot);
 const graph=await openKnowledge(dir);validateGraph(graph.index);expect(graph.index.nodes.filter(n=>n.kind==='document')).toHaveLength(4);expect(graph.index.nodes.filter(n=>n.kind==='resource')).toHaveLength(4);
 const ids=new Set(graph.index.nodes.map(n=>n.id));for(const n of graph.index.nodes){const markdown=await graphRead(graph,n.id);expect(markdown).not.toContain('SECRET HIDDEN');expect(markdown).not.toContain('[[evil');for(const m of markdown.matchAll(/\[\[([^|\]]+)\|[^\]]*\]\]/g))expect(ids.has(m[1])).toBe(true);}
 const resource=graph.index.nodes.find(n=>n.kind==='resource')!;expect(resource.resource?.status).toBe('unknown');expect(resource.resource?.contextEvaluation).toBe('not-evaluated');expect(resource.citations[0].sourcePointer).toContain('/sections/');
});
it('has one strict paginated tool, home default, bounded errors and filter-bound cursors',async()=>{
 const {dir}=await fixture();await buildKnowledge({dir});const tools=makeKnowledgeTools(dir);expect(tools.map(t=>t.name)).toEqual(['material_navigate']);const t=tools[0];expect((await t.run({}) as any).id).toBe('home.md');
 for(const input of [{id:'../escape.md'},{id:'/home.md'},{query:'x',id:'home.md'},{extra:true},{query:''},{query:'x'.repeat(501)},{limit:1000}])await expect(t.run(input)).rejects.toThrow();
 const first:any=await t.run({query:'buttons',limit:1});expect(first.hasMore).toBe(true);expect(first.nextCursor).toBeTruthy();const next:any=await t.run({query:'buttons',limit:1,cursor:first.nextCursor});expect(next.results[0].id).not.toBe(first.results[0].id);
 await expect(t.run({query:'accessibility',limit:1,cursor:first.nextCursor})).rejects.toThrow(/cursor/i);
 let cursor: string|undefined,seen=new Set<string>(),pages=0;do{const p:any=await t.run({id:'hubs/components/buttons.md',limit:1,...(cursor?{cursor}:{})});expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(128000);for(const e of p.outgoing)seen.add(e.id);cursor=p.nextCursor;expect(++pages).toBeLessThan(100);}while(cursor);expect(seen.size).toBeGreaterThanOrEqual(4);
 expect(navigationInstructions.split(/\s+/).length).toBeLessThan(90);
});
it('invalidates on corpus changes and preserves old manifest after a failed rebuild',async()=>{
 const {dir,docs,info}=await fixture();await buildKnowledge({dir});const old=await readFile(join(dir,'knowledge/manifest.json'),'utf8');docs[0].fetchedAt='2026-10-11T00:00:00.000Z';await publishCorpus(dir,docs,info);await expect(openKnowledge(dir)).rejects.toThrow(/build-knowledge/);
 await mkdir(join(dir,'resources'));await writeFile(join(dir,'resources/manifest.json'),'broken');await expect(buildKnowledge({dir})).rejects.toThrow();expect(await readFile(join(dir,'knowledge/manifest.json'),'utf8')).toBe(old);
});
it('invalidates a missing-sidecar graph when a sidecar appears, rejecting symlink notes',async()=>{
 const {dir}=await fixture();const built=await buildKnowledge({dir});const graph=await openKnowledge(dir);const note=join(built.vaultRoot,'home.md');const original=await readFile(note);await rm(note);await writeFile(join(dir,'evil.md'),original);await symlink(join(dir,'evil.md'),note);await expect(graphRead(graph,'home.md')).rejects.toThrow(/symlink|confine/i);
 await mkdir(join(dir,'resources'));await writeFile(join(dir,'resources/manifest.json'),'{}');await expect(openKnowledge(dir)).rejects.toThrow(/build-knowledge/);
});
it('keeps fetched, unsupported, failed and budget-blocked resources distinct and invalidates changed sidecars',async()=>{
 const {dir,docs}=await fixture();await buildKnowledge({dir});await sidecar(dir,docs);await expect(openKnowledge(dir)).rejects.toThrow(/stale/);const built=await buildKnowledge({dir});const graph=await openKnowledge(dir);const resources=graph.index.nodes.filter(n=>n.resource).map(n=>n.resource!);expect(new Set(resources.map(r=>r.status))).toEqual(new Set(['fetched','failed','budget-blocked','unsupported']));expect(resources.find(r=>r.status==='fetched')?.normalization).toBe('parsed');expect(resources.every(r=>r.contextEvaluation==='not-evaluated'&&r.pageFilterStatus==='unavailable')).toBe(true);
 const t=makeKnowledgeTools(dir)[0],page:any=await t.run({query:'buttons',limit:1});await sidecar(dir,docs,'changed');await expect(openKnowledge(dir)).rejects.toThrow(/stale/);expect((await buildKnowledge({dir})).snapshot).not.toBe(built.snapshot);await expect(t.run({query:'buttons',limit:1,cursor:page.nextCursor})).rejects.toThrow(/cursor/);
});
it('rechecks dependencies just before publication and preserves the previous manifest',async()=>{
 const {dir}=await fixture();await buildKnowledge({dir});const old=await readFile(join(dir,'knowledge/manifest.json'),'utf8'),actual=store.sourceBinding;let reads=0;vi.spyOn(store,'sourceBinding').mockImplementation(async(d)=>{const binding=await actual(d);return ++reads===2?{...binding,resourceSnapshot:'f'.repeat(64),resourceStatus:'ready'}:binding;});await expect(buildKnowledge({dir})).rejects.toThrow(/changed during graph build/);expect(reads).toBe(2);expect(await readFile(join(dir,'knowledge/manifest.json'),'utf8')).toBe(old);
});
it('rejects bad nested data, collection/depth bounds, corrupt notes and invalid paths',async()=>{
 const {dir}=await fixture();const built=await buildKnowledge({dir}),graph=await openKnowledge(dir),node=graph.index.nodes[0];
 const tooMany=new Array(GRAPH_LIMITS.nodeEdges+1).fill(null);Object.defineProperty(tooMany,0,{get(){throw new Error('ELEMENT WAS READ');}});expect(()=>nodeSchema.parse({...node,outgoing:tooMany})).toThrow(/Expected array/);
 expect(()=>parseGraph(graphIndexSchema,{...graph.index,nodes:new Array(GRAPH_LIMITS.nodes+1).fill(null)})).toThrow(/collection limit/);
 let deep:any={};for(let i=0;i<20;i++)deep={deep};expect(()=>parseGraph(graphIndexSchema,deep)).toThrow(/complexity limit/);
 expect(()=>validateGraph({...graph.index,counts:{...graph.index.counts,edges:0}})).toThrow(/counts/);const broken=structuredClone(graph.index);broken.nodes.find(n=>n.outgoing.length)!.outgoing[0].id='absent.md';expect(()=>validateGraph(broken)).toThrow();
 for(const id of ['../home.md','a/../../home.md','/home.md','a\\home.md','%2e%2e/home.md'])await expect(graphRead(graph,id)).rejects.toThrow();
 await writeFile(join(built.vaultRoot,'home.md'),'tampered');await expect(graphRead(graph,'home.md')).rejects.toThrow(/digest/);await expect(buildKnowledge({dir})).rejects.toThrow(/corrupted/);
 await expect(store.readGraphFile(dir,'knowledge/manifest.json',1)).rejects.toThrow(/size limit/);
});
