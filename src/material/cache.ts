import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { allowedSources, sourceCatalog, validateSourceUrl, type DocSource } from './sources.js';
export const defaultCacheDir = () => resolve(process.env.MATERIAL_CACHE_DIR ?? '.cache/material');
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const documentSchema = z.object({path:z.string(),title:z.string(),category:z.enum(['components','styles','foundations']),url:z.string(),sourceKind:z.enum(['material-3','material-web']),text:z.string().min(20).max(200000),sha256:z.string().regex(/^[a-f0-9]{64}$/),fetchedAt:z.string().datetime(),extractionMethod:z.string().min(1).max(200)}).strict();
const cacheSchema = z.object({version:z.literal(1),documents:z.array(documentSchema).min(1).max(20)}).strict();
export type CachedDocument = z.infer<typeof documentSchema>;
export type Cache = z.infer<typeof cacheSchema>;
export const missingCacheMessage = 'Official documentation cache is missing or invalid. Run npm run refresh-cache explicitly (network access required), then retry. No official excerpts are bundled.';
export async function readCache(dir = defaultCacheDir()): Promise<Cache> {
  try {
    const file = join(dir, 'documents.json');
    if ((await stat(file)).size > 4000000) throw new Error('Cache exceeds size limit');
    const cache = cacheSchema.parse(JSON.parse(await readFile(file,'utf8')));
    const seen = new Set<string>();
    for (const doc of cache.documents) {
      validateSourceUrl(doc.url);
      const source = allowedSources.find(s => s.path === doc.path && s.url === doc.url);
      if (!source || source.category !== doc.category || source.sourceKind !== doc.sourceKind || sha256(doc.text) !== doc.sha256 || seen.has(doc.path)) throw new Error('Cache provenance mismatch');
      seen.add(doc.path);
    }
    return cache;
  } catch { throw new Error(missingCacheMessage); }
}
export type Importer = (source: DocSource) => Promise<{text:string;method:string;finalUrl:string}>;
/** Refresh is dependency-injected: runtime modules never fetch or spawn anything. */
export async function refreshCache(dir: string, importer: Importer, sources: readonly DocSource[] = sourceCatalog): Promise<Cache> {
  const documents: CachedDocument[] = [];
  for (const source of sources) {
    validateSourceUrl(source.url);
    const fetched = await importer(source);
    validateSourceUrl(fetched.finalUrl);
    if (fetched.finalUrl !== source.url) throw new Error('Importer changed source identity');
    documents.push(documentSchema.parse({...source,text:fetched.text,sha256:sha256(fetched.text),fetchedAt:new Date().toISOString(),extractionMethod:fetched.method}));
  }
  const cache = cacheSchema.parse({version:1,documents});
  await mkdir(dir,{recursive:true});
  const temporary = join(dir, `.documents-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(cache,null,2)+'\n',{flag:'wx',mode:0o600});
    await rename(temporary,join(dir,'documents.json'));
  } finally { await rm(temporary,{force:true}); }
  return cache;
}
export function citation(doc: CachedDocument) {
  return {url:doc.url,path:doc.path,title:doc.title,sourceKind:doc.sourceKind,fetchedAt:doc.fetchedAt,sha256:doc.sha256,extractionMethod:doc.extractionMethod,
    attribution:doc.sourceKind==='material-web'?'Material Web contributors, official material-components/material-web documentation':'Google Material Design documentation',
    license:doc.sourceKind==='material-web'?'Apache-2.0; https://github.com/material-components/material-web/blob/main/LICENSE':'Consult https://policies.google.com/terms before redistribution',
    cachePolicy:'Downloaded documentation is locally cached and excluded from version control; preserve attribution and source license when redistributing.'};
}
