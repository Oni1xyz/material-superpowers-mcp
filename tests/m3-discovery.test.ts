import { describe, expect, it } from 'vitest';
import { discoverMainScript, discoverBundle, parseSitemap, mapCanonicalRoutes, validateM3Url } from '../src/material/discovery.js';
import { parseCarbonDocument, htmlToMarkdown } from '../src/material/carbon.js';
const id='e31df68a-59d4-41dc-8743-8c48b476d4f8.json';
const version='2026-09-23_06-10-05';
const bundle=`ignored();let config={carbonVersion:"${version}"};routes=[{"slug":"components/buttons","exportedCarbonFileId":"${id}","tabs":[{"label":"Overview"},{"label":"Specs"}]}];`;
describe('safe live source discovery',()=>{
 it('extracts data without evaluating downloaded code',()=>{
  const discovered=discoverBundle(bundle+';throw new Error("must not execute")');
  expect(discovered.carbonVersion).toBe(version);expect(discovered.routes).toHaveLength(1);
  expect(discoverMainScript('<script src="/static/angular/main.7906d9e8e8cae962.js"></script>')).toBe('https://m3.material.io/static/angular/main.7906d9e8e8cae962.js');
 });
 it('rejects malformed, ambiguous or executable route data',()=>{
  expect(()=>discoverBundle(bundle.replace(`"${id}"`,'(()=>"bad")()'))).toThrow();
  expect(()=>discoverBundle(bundle+';carbonVersion:"2025-01-01_00-00-00"')).toThrow();
  expect(()=>discoverMainScript('<script src="https://evil.test/static/angular/main.7906d9e8e8cae962.js"></script>')).toThrow();
 });
 it.each(['https://m3.material.io:443/sitemap.xml','https://m3.material.io/a/../sitemap.xml','https://m3.material.io/%2e/sitemap.xml','https://m3.material.io/sitemap.xml?x=1','https://x@m3.material.io/sitemap.xml','https://m3.material.io.evil/sitemap.xml'])('rejects unsafe source %s',url=>expect(()=>validateM3Url(url)).toThrow());
 it('maps every canonical tab exactly, not by longest parent prefix',()=>{
  const urls=['components/buttons/overview','components/buttons/specs','components/buttons/wrong','blog/old'].map(p=>`https://m3.material.io/${p}`);
  const sitemap=parseSitemap('<urlset>'+urls.map(url=>`<url><loc>${url}</loc><lastmod>2026-09-23</lastmod></url>`).join('')+'</urlset>');
  const mapped=mapCanonicalRoutes(sitemap,discoverBundle(bundle).routes);
  expect(mapped.find(m=>m.path.endsWith('/overview'))?.section).toBe('Overview');expect(mapped.find(m=>m.path.endsWith('/specs'))?.section).toBe('Specs');
  expect(mapped.find(m=>m.path.endsWith('/wrong'))?.status).toBe('unresolved');expect(mapped.find(m=>m.path==='blog/old')?.status).toBe('excluded');
 });
});
describe('semantic Carbon extraction',()=>{
 it('preserves text semantics without scripts or HTML execution',()=>{
  const md=htmlToMarkdown('<h2>Usage &amp; names</h2><p><a href="https://example.com">Link</a></p><ol><li>One</li><li>Two</li></ol><table><tr><th>Role</th><th>Value</th></tr><tr><td>Size</td><td>48</td></tr></table><pre><code>x &lt; 2</code></pre><script>alert(1)</script>');
  expect(md).toContain('## Usage & names');expect(md).toContain('[Link](https://example.com/)');expect(md).toContain('1. One');expect(md).toContain('| Size | 48 |');expect(md).toContain('x < 2');expect(md).not.toContain('alert');
 });
 it('selects exact visible sections, retains metadata and declares unresolved modules',()=>{
  const raw={title:'Buttons',sections:[{name:'Overview',isVisible:true,contentBlocks:[{pageContentBlockId:'block',contentChunks:[{contentChunkType:'TEXT',htmlValue:'<h2>Usage</h2><p>Use buttons</p>'},{contentChunkType:'IMAGE',imageUrl:'https://example.com/image.png',altText:'Button',footer:'<p>Caption</p>'},{contentChunkType:'RESOURCE',resourceName:'designSystems/test/components/button',libraryModuleType:'TOKEN_TABLE'},{contentChunkType:'NEW_KIND',futureValue:'unknown'}]},{isHidden:true,contentChunks:[{htmlValue:'secret'}]}]},{name:'Specs',isVisible:true,contentBlocks:[{contentChunks:[{htmlValue:'<p>Different section</p>'}]}]},{name:'Hidden',isVisible:false,contentBlocks:[]}]};
  const doc=parseCarbonDocument(raw,'Overview');
  expect(doc.text).toContain('Caption');expect(doc.text).not.toContain('Different section');expect(doc.text).not.toContain('secret');
  expect(doc.blocks.flatMap(b=>b.media)).toEqual(expect.arrayContaining([expect.objectContaining({altText:'Button'})]));
  expect(doc.resourceNames).toContain('designSystems/test/components/button');expect(doc.unknownKinds).toContain('NEW_KIND');
  expect(()=>parseCarbonDocument(raw,'Wrong')).toThrow('section');expect(()=>parseCarbonDocument(raw,'Hidden')).toThrow('section');
 });
});
