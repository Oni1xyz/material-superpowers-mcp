import { defaultCacheDir, refreshCache } from '../src/material/cache.js';
import { renderedSource, sourceCatalog } from '../src/material/sources.js';
import { importMarkdown, importRenderedArticle } from './import-official.js';
let rendered: Awaited<ReturnType<typeof importRenderedArticle>>|undefined;
try {
  rendered=await importRenderedArticle();
  process.stderr.write('Imported rendered m3.material.io button article.\n');
} catch(error) {
  process.stderr.write(`M3 rendered import unavailable: ${error instanceof Error?error.message.slice(0,350):'unknown error'}\nUsing explicitly labeled official Material Web Markdown fallback.\n`);
}
try {
  const sources=rendered?[renderedSource,...sourceCatalog]:sourceCatalog;
  const cache=await refreshCache(defaultCacheDir(),source=>source.sourceKind==='material-3'&&rendered?Promise.resolve(rendered):importMarkdown(source),sources);
  process.stdout.write(JSON.stringify({cacheDirectory:defaultCacheDir(),documents:cache.documents.map(d=>({path:d.path,url:d.url,sha256:d.sha256,fetchedAt:d.fetchedAt,extractionMethod:d.extractionMethod}))},null,2)+'\n');
} catch(error) {
  process.stderr.write(`Refresh failed; previous cache preserved: ${error instanceof Error?error.message.slice(0,500):'unknown error'}\n`);
  process.exitCode=1;
}
