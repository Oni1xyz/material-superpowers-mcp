import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { boundedLocalRead, openCorpus, readCorpusDocument, computeCoverage } from '../src/material/corpus.js';
import { sha256 } from '../src/material/cache.js';
/** Opt-in real-cache integration; never substitutes synthetic content. Run after
 * npm run refresh-cache: MATERIAL_REAL_CACHE_TEST=1 npm test -- tests/m3-real-stdio.test.ts */
it.runIf(process.env.MATERIAL_REAL_CACHE_TEST==='1')('real imported M3 snapshot works over actual SDK stdio and reconciles all document digests',async()=>{
 const corpus=await openCorpus(),coverage=computeCoverage(corpus);expect(corpus.index.documents.length).toBeGreaterThan(20);
 expect(coverage.knowledge.core).toEqual({total:252,indexed:252,excluded:0,unresolved:0});
 const hashes=[];let verifiedBlocks=0,verifiedExclusions=0;
 for(const entry of corpus.index.documents){
  const doc=await readCorpusDocument(corpus,entry.path);expect(doc.section).toBe(entry.section);expect(doc.carbonVersion).toBe(corpus.index.provenance.carbonVersion);expect(doc.normalizationVersion).toBe(3);
  const envelope=JSON.parse(await boundedLocalRead(corpus.dir,`imports/${doc.carbonVersion}/${corpus.index.provenance.bundleSha256}/${doc.documentId}`,12000000)),raw=JSON.parse(envelope.text);
  expect(sha256(envelope.text)).toBe(doc.sourceSha256);expect(envelope.sourceSha256).toBe(doc.sourceSha256);
  expect(doc.isDescriptionVisible).toBe(raw.isDescriptionVisible);
  const selected=raw.sections.map((s:any,sectionIndex:number)=>({s,sectionIndex})).filter(({s}:any)=>s.isVisible!==false&&(!doc.section||s.name===doc.section));
  expect(doc.sections).toHaveLength(selected.length);
  expect(doc.blocks).toHaveLength(selected.reduce((n:number,{s}:any)=>n+(s.contentBlocks??[]).filter((b:any)=>!b.isHidden).length,doc.header.description?1:0));
  const hiddenSections=raw.sections.filter((s:any)=>s.isVisible===false),hiddenSelected=selected.reduce((n:number,{s}:any)=>n+(s.contentBlocks??[]).filter((b:any)=>b.isHidden).length,0),expectedExclusions=(raw.isDescriptionVisible===false?1:0)+hiddenSections.reduce((n:number,s:any)=>n+1+(s.contentBlocks??[]).length,0)+hiddenSelected;
  expect(doc.exclusions).toHaveLength(expectedExclusions);expect(doc.hiddenSections).toBe(hiddenSections.length);expect(doc.hiddenBlocks).toBe(hiddenSelected);
  for(const {s,sectionIndex} of selected){const actual=doc.sections!.find(p=>p.sectionIndex===sectionIndex)!;expect(actual).toBeDefined();for(const key of ['pageSectionId','pageSectionCanonId','isVisible'])expect((actual as any)[key]).toBe(s[key]);for(const key of ['pageSectionId','pageSectionCanonId'])if(s[key]!==undefined)expect(doc.sectionIds).toContain(s[key]);}
  for(const b of doc.blocks){if(!b.provenance){expect(b.id).toBe('description');continue;}const p=b.provenance,s=raw.sections[p.sectionIndex],original=s.contentBlocks[p.blockIndex];expect(s.isVisible).not.toBe(false);expect(original.isHidden).not.toBe(true);for(const key of ['pageContentBlockId','pageContentBlockCanonId','isHidden'])expect((p as any)[key]).toBe(original[key]);for(const key of ['pageSectionId','pageSectionCanonId','isVisible'])expect((p as any)[key]).toBe(s[key]);verifiedBlocks++;}
  for(const e of doc.exclusions!){if(e.kind==='description'){expect(raw.isDescriptionVisible).toBe(false);}else{const s=raw.sections[e.sectionIndex];expect(e.pageSectionId).toBe(s.pageSectionId);expect(e.pageSectionCanonId).toBe(s.pageSectionCanonId);expect(e.isVisible).toBe(s.isVisible);if(e.kind==='section'||e.reason==='section-hidden')expect(s.isVisible).toBe(false);if(e.kind==='block'){const b=s.contentBlocks[e.blockIndex];expect(e.pageContentBlockId).toBe(b.pageContentBlockId);expect(e.pageContentBlockCanonId).toBe(b.pageContentBlockCanonId);expect(e.isHidden).toBe(b.isHidden);if(e.reason==='block-hidden')expect(b.isHidden).toBe(true);}}verifiedExclusions++;}
  hashes.push({path:doc.path,sha256:doc.sha256});
 }
 const client=new Client({name:'m3-real-integration',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:['dist/index.js'],cwd:resolve('.'),env:{...process.env,MATERIAL_CACHE_DIR:corpus.dir},stderr:'pipe'});let stderr='';transport.stderr?.on('data',chunk=>stderr+=chunk.toString());
 const observations:any[]=[];
 try{
  await client.connect(transport);expect((await client.listTools()).tools).toHaveLength(12);
  const call=async(name:string,args:Record<string,unknown>)=>{const result=await client.callTool({name,arguments:args});expect(result.isError,JSON.stringify(result)).not.toBe(true);return result.structuredContent as any;};
  const status=await call('material_coverage_status',{includeDetails:true});expect(status.knowledge).toEqual(coverage.knowledge);expect(status.gaps.unresolvedResourceCount).toBe(status.gaps.unresolvedResources.length);
  if(process.env.MATERIAL_REAL_RESOURCE_TEST==='1') {
   expect(status.resources.status).toBe('ready');
   expect(status.resources.corpusSnapshot).toBe(corpus.snapshot);
   const summary=await call('material_coverage_status',{});
   expect(summary.resources.counts).toEqual(status.resources.counts);
   expect(summary.resources.modules).toBeUndefined();expect(summary.resources.endpoints).toBeUndefined();
   for(const path of ['components/buttons/specs','styles/spacing/tokens','styles/motion/overview/specs']) {
    const spec=await call('material_read_spec',{path,limit:3});
    expect(spec.rows.length).toBeGreaterThan(0);expect(spec.contextEvaluation).toBe('not-evaluated');
    for(const row of spec.rows){expect(row.isDependency).toBe(false);expect(row.citation.corpusSnapshot).toBe(corpus.snapshot);expect(row.citation.sourceSha256).toMatch(/^[a-f0-9]{64}$/);expect(row.citation.articleUrl).toBe('https://m3.material.io/'+path);}
    observations.push({kind:'numeric-spec',path,rows:spec.rows.length,contextEvaluation:spec.contextEvaluation});
   }
  }
  const cases=[['button accessibility','components/buttons/accessibility'],['navigation rail','components/navigation-rail/overview'],['bidirectionality','foundations/layout/bidirectionality-rtl'],['motion specs','styles/motion/overview/specs'],['spacing tokens','styles/spacing/tokens'],['XR layout','foundations/xr/design/layout']];
  for(const [query,path] of cases){const search=await call('material_search_docs',{query,limit:10});expect(search.results[0].path).toBe(path);const read=await call('material_read_doc',{path,maxCharacters:1000});expect(read.citation.url).toBe('https://m3.material.io/'+path);expect(read.citation.carbonVersion).toBe(coverage.carbonVersion);expect(read.text.length).toBeLessThanOrEqual(1000);const doc=await readCorpusDocument(corpus,path);expect(read.citation.normalizationVersion).toBe(3);expect(read.citation.sections).toEqual(doc.sections);expect(read.citation.isDescriptionVisible).toBe(doc.isDescriptionVisible);expect(read.exclusions).toEqual(doc.exclusions);for(const b of read.blocks)expect(b.provenance).toEqual(doc.blocks.find(original=>original.id===b.blockId)!.provenance);observations.push({query,topResult:search.results[0].path,readPath:path,textCharacters:read.text.length,hasMore:read.hasMore});}
  const path='components/buttons/specs',expected=await readCorpusDocument(corpus,path),fragments=new Map<string,string>();let cursor:string|undefined,pages=0;
  do{const page=await call('material_read_doc',{path,maxCharacters:1000,...(cursor?{cursor}:{})});for(const b of page.blocks){expect(b.offset).toBe((fragments.get(b.blockId)??'').length);expect(b.provenance).toEqual(expected.blocks.find(original=>original.id===b.blockId)!.provenance);fragments.set(b.blockId,(fragments.get(b.blockId)??'')+b.text);}cursor=page.nextCursor;expect(++pages).toBeLessThan(300);}while(cursor);
  expect(expected.blocks.filter(b=>b.text).map(b=>fragments.get(b.id)).join('\n\n')).toBe(expected.text);
  const heading=expected.headings[0]?.title;if(heading){const result=await call('material_read_doc',{path,heading,maxCharacters:1000,includeStructure:true});expect(result.text).toContain(heading);expect(result.metadata).toBeDefined();}
  const modes:any[]=[];for(const mode of ['design','implementation','review']){const context=await call('material_get_context',{task:'buttons',mode,maxSources:2,maxCharacters:1000});expect(context.sources.reduce((n:number,s:any)=>n+s.text.length,0)).toBeLessThanOrEqual(1000);modes.push({mode,paths:context.sources.map((s:any)=>s.path)});}
  expect(stderr).toBe('');await mkdir('artifacts',{recursive:true});await writeFile('artifacts/m3-stdio-verification.json',JSON.stringify({snapshot:corpus.snapshot,carbonVersion:coverage.carbonVersion,verifiedDocumentCount:hashes.length,visibilityProvenance:{normalizationVersion:3,verifiedBlocks,verifiedExclusions,comparedWithResumableSources:true},observations,pagination:{path,pages,characters:expected.text.length,reconstructed:true},modes,coverage:coverage.knowledge},null,2)+'\n');
 }finally{await client.close();}
},120000);
