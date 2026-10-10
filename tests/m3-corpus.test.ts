import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishCorpus, openCorpus, readCorpusDocument, type CorpusDocument } from '../src/material/corpus.js';
import { parseCarbonDocument } from '../src/material/carbon.js';
import { sha256 } from '../src/material/cache.js';
const dirs:string[]=[];afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
async function temp(){const dir=await mkdtemp(join(tmpdir(),'m3-snapshot-'));dirs.push(dir);return dir;}
const version='2026-09-23_06-10-05',documentId='e31df68a-59d4-41dc-8743-8c48b476d4f8.json';
export function fixture(path='components/buttons/overview'):CorpusDocument {
 const parsed=parseCarbonDocument({title:'Buttons',sections:[{name:'Overview',contentBlocks:[{contentChunks:[{contentChunkType:'TEXT',htmlValue:'<h2>Usage</h2><p>Button action.</p>'}]}]}]},'Overview');
 return {...parsed,path,url:'https://m3.material.io/'+path,category:'components',sourceKind:'material-3',documentId,carbonVersion:version,sourceUrl:`https://m3.material.io/_dsm/content/m3/${version}/${documentId}`,section:'Overview',sourceSha256:'a'.repeat(64),sha256:sha256(parsed.text),fetchedAt:'2026-10-10T00:00:00.000Z',extractionMethod:'carbon-semantic-v2'};
}
export const provenance={carbonVersion:version,bundleUrl:'https://m3.material.io/static/angular/main.7906d9e8e8cae962.js',bundleSha256:'b'.repeat(64),sitemapSha256:'c'.repeat(64),discoveredAt:'2026-10-10T00:00:00.000Z'};
const ledger=[{path:'components/buttons/overview',url:'https://m3.material.io/components/buttons/overview',category:'components' as const,status:'mapped' as const,documentId,section:'Overview'}];
it('publishes per-document immutable snapshot and manifest, not a capped monolith',async()=>{
 const dir=await temp();const documents=Array.from({length:25},(_,i)=>fixture(`components/button-${i}/overview`));
 await publishCorpus(dir,documents,{...provenance,mappings:documents.map(d=>({...ledger[0],path:d.path,url:d.url}))});
 const corpus=await openCorpus(dir);expect(corpus.index.documents).toHaveLength(25);
 const doc=await readCorpusDocument(corpus,documents[0].path);expect(doc.text).toContain('Button action');
 await expect(readCorpusDocument(corpus,'../etc/passwd')).rejects.toThrow();
});
it('rejects mixed versions before publication and preserves old good manifest',async()=>{
 const dir=await temp();await publishCorpus(dir,[fixture()],{...provenance,mappings:ledger});const before=await readFile(join(dir,'manifest.json'),'utf8');
 await expect(publishCorpus(dir,[{...fixture(),carbonVersion:'2025-01-01_00-00-00'}],{...provenance,mappings:ledger})).rejects.toThrow();
 expect(await readFile(join(dir,'manifest.json'),'utf8')).toBe(before);
});
it('rejects mismatched source identity and does not replace the previous snapshot',async()=>{
 const dir=await temp();await publishCorpus(dir,[fixture()],{...provenance,mappings:ledger});const before=await readFile(join(dir,'manifest.json'),'utf8');
 await expect(publishCorpus(dir,[{...fixture(),pageCanonId:'00000000-0000-0000-0000-000000000000'}],{...provenance,mappings:ledger})).rejects.toThrow('canonical ID');
 expect(await readFile(join(dir,'manifest.json'),'utf8')).toBe(before);
});
it('detects modified documents and rejects manifest traversal',async()=>{
 const dir=await temp();await publishCorpus(dir,[fixture()],{...provenance,mappings:ledger});const corpus=await openCorpus(dir);
 const entry=corpus.index.documents[0];await writeFile(join(dir,'snapshots',corpus.snapshot,entry.file),'{}');await expect(readCorpusDocument(corpus,entry.path)).rejects.toThrow();
 const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));manifest.snapshot='../evil';await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));await expect(openCorpus(dir)).rejects.toThrow();
});
