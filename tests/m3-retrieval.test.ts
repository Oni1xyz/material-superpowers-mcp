import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishCorpus, type CorpusDocument } from '../src/material/corpus.js';
import { parseCarbonDocument } from '../src/material/carbon.js';
import { sha256 } from '../src/material/cache.js';
import { makeDocsTools } from '../src/tools/docs.js';
import { semanticPage, markdownBlocks, type ReadableDocument } from '../src/material/retrieval.js';
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
const version='2026-09-23_06-10-05',id='e31df68a-59d4-41dc-8743-8c48b476d4f8.json';
async function cached(){const dir=await mkdtemp(join(tmpdir(),'m3-retrieval-'));dirs.push(dir);const docs:CorpusDocument[]=['Overview','Specs','Guidelines','Accessibility'].map(section=>{
 const parsed=parseCarbonDocument({title:'Buttons',sections:[{name:section,contentBlocks:[{pageContentBlockId:'heading',contentChunks:[{contentChunkType:'TEXT',htmlValue:`<h2>${section} heading</h2>`}]},{pageContentBlockId:'body',contentChunks:[{contentChunkType:'TEXT',htmlValue:'<p>Buttons use concise action labels.</p>'}]},{pageContentBlockId:'large',contentChunks:[{contentChunkType:'TEXT',htmlValue:'<p>'+('Long button guidance. '.repeat(80))+'</p>'}]},{pageContentBlockId:'other',contentChunks:[{contentChunkType:'TEXT',htmlValue:'<h2>Other section</h2><p>Unrelated material.</p>'}]}]}]},section);
 const path='components/buttons/'+section.toLowerCase();return {...parsed,path,url:'https://m3.material.io/'+path,category:'components',sourceKind:'material-3',documentId:id,carbonVersion:version,sourceUrl:`https://m3.material.io/_dsm/content/m3/${version}/${id}`,section,sourceSha256:'a'.repeat(64),sha256:sha256(parsed.text),fetchedAt:'2026-10-10T00:00:00.000Z',extractionMethod:'test-fixture'};
 });
 await publishCorpus(dir,docs,{carbonVersion:version,bundleUrl:'https://m3.material.io/static/angular/main.7906d9e8e8cae962.js',bundleSha256:'b'.repeat(64),sitemapSha256:'c'.repeat(64),discoveredAt:'2026-10-10T00:00:00.000Z',mappings:docs.map(d=>({path:d.path,url:d.url,category:d.category,status:'mapped',documentId:id,section:d.section}))});return {dir,docs,tools:makeDocsTools(dir)};
}
describe('snapshot-indexed docs retrieval',()=>{
 it('searches exact headings and never substitutes a parent or sibling section',async()=>{const {tools}=await cached();const result:any=await tools[0].run({query:'Accessibility heading',limit:1});expect(result.results[0].path).toBe('components/buttons/accessibility');expect(result.results[0].citation.section).toBe('Accessibility');await expect(tools[1].run({path:'components/buttons'})).rejects.toThrow('manifest');});
 it('whole-block pages and explicit oversized continuations reconstruct every character',async()=>{
  const {tools,docs}=await cached();let cursor:string|undefined;const fragments=new Map<string,string>();let pages=0;
  do{const page:any=await tools[1].run({path:docs[0].path,maxCharacters:100,...(cursor?{cursor}:{})});expect(page.text.length).toBeLessThanOrEqual(100);for(const b of page.blocks){expect(b.offset).toBe((fragments.get(b.blockId)??'').length);fragments.set(b.blockId,(fragments.get(b.blockId)??'')+b.text);if(b.oversized)expect(b.totalCharacters).toBeGreaterThan(100);}cursor=page.nextCursor;expect(++pages).toBeLessThan(50);}while(cursor);
  expect(docs[0].blocks.map(b=>fragments.get(b.id)).join('\n\n')).toBe(docs[0].text);
 });
 it('heading filter and cursor identity prevent crossing sections and snapshots',async()=>{
  const {tools,docs}=await cached();const page:any=await tools[1].run({path:docs[0].path,heading:'Overview heading',maxCharacters:100});expect(page.text).not.toContain('Other section');
  await expect(tools[1].run({path:docs[1].path,cursor:page.nextCursor,maxCharacters:100})).rejects.toThrow('Cursor');
  await expect(tools[1].run({path:docs[0].path,cursor:page.nextCursor,maxCharacters:100})).rejects.toThrow('Cursor');
  const value=JSON.parse(Buffer.from(page.nextCursor,'base64url').toString());value.s='f'.repeat(64);await expect(tools[1].run({path:docs[0].path,heading:'Overview heading',cursor:Buffer.from(JSON.stringify(value)).toString('base64url')})).rejects.toThrow('snapshot');
 });
 it('context mode changes prioritization rather than just the response label',async()=>{const {tools}=await cached();const paths:string[]=[];for(const mode of ['design','implementation','review']){const context:any=await tools[2].run({task:'buttons',mode,maxSources:1,maxCharacters:100});expect(context.sources[0].text.length).toBeLessThanOrEqual(100);paths.push(context.sources[0].path);}expect(paths[0]).toMatch(/guidelines|overview/);expect(paths[1]).toMatch(/specs/);expect(paths[2]).toMatch(/accessibility/);});
 it('coverage separates imported knowledge from unmeasured implementation and eval',async()=>{const {tools}=await cached();const report:any=await tools[3].run({includeDetails:true});expect(report.knowledge.core.indexed).toBe(4);expect(report.implementation.status).toContain('not-measured');expect(report.eval.status).toContain('not-measured');});
});
it('keeps fenced code with blank lines and apparent headings as one semantic unit',()=>{const blocks=markdownBlocks('# Title\n\n```md\n\n## not a heading\n\n```\n\nAfter');expect(blocks).toHaveLength(3);expect(blocks[1].text).toContain('\n\n## not a heading');});
it('oversized Unicode continuations do not split surrogate pairs',()=>{const text='🙂'.repeat(150),doc:ReadableDocument={path:'test',title:'Test',category:'other',text,sha256:sha256(text),blocks:[{id:'a',text}],headings:[],citation:{}};let cursor:string|undefined,out='';do{const page=semanticPage(doc,'a'.repeat(64),101,{cursor});expect(page.text).not.toMatch(/[\uD800-\uDBFF]$/);out+=page.text;cursor=page.nextCursor;}while(cursor);expect(out).toBe(text);});
