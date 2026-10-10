import { rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaultCacheDir, sha256 } from '../src/material/cache.js';
import { checkCacheTarget, ensureCacheDirectory } from '../src/material/files.js';
import { boundedLocalRead, openCorpus, readCorpusDocument, type Corpus } from '../src/material/corpus.js';
import { chunkSchema, configurationSchema, loadResourceIndex, moduleSchema, resourceCounts, resourceIndexSchema, resourceManifestSchema, RESOURCE_STORE_LIMITS, type ChunkReference, type ResourceEndpoint, type ResourceIndex, type ResourceModule } from '../src/material/resource-store.js';
import { assertOfficialUrl, fetchOfficial, FetchFailure, LIMITS, normalizeResource, type ModuleType, type TokenRow } from './m3-resources/index.js';

// This CLI deliberately uses the low-level verified importer, not batches of
// resolveResources: one request/byte/time ledger spans the entire inventory.
export const REFRESH_LIMITS = Object.freeze({ requests: 64, bytes: 64 * 1024 * 1024, timeMs: 600000 });
const limitsSchema = z.object({ requests: z.number().int().min(0).max(REFRESH_LIMITS.requests), bytes: z.number().int().min(0).max(REFRESH_LIMITS.bytes), timeMs: z.number().int().min(0).max(REFRESH_LIMITS.timeMs) }).strict();
const supported = new Set(['TOKEN_TABLE', 'MEASUREMENT', 'TOKEN_TYPE_UNSPECIFIED']);
const resourcePattern = /^designSystems\/([a-f0-9]{16})(?:\/components\/([a-f0-9]{16}))?$/;
export async function inventoryResourceModules(corpus: Corpus): Promise<ResourceModule[]> {
  const modules: ResourceModule[] = [];
  for (const entry of corpus.index.documents) {
    const doc = await readCorpusDocument(corpus, entry.path);
    for (const block of doc.blocks) for (const [ci, chunk] of block.chunks.entries()) {
      if (!chunk.resource) continue;
      const ref = chunk.resource;
      // Refuse mismatched normalization, rather than silently resolving a different module.
      if (chunk.metadata.resourceName !== undefined && chunk.metadata.resourceName !== ref.name || chunk.metadata.libraryModuleType !== undefined && chunk.metadata.libraryModuleType !== ref.moduleType) throw new Error('Corpus resource metadata mismatch');
      const configuration = chunk.metadata.moduleConfigurationOverrides ?? ref.configuration ?? null;
      const match = resourcePattern.exec(ref.name), validType = supported.has(ref.moduleType);
      const validShape = !!match && (ref.moduleType === 'TOKEN_TABLE' ? !!match[2] : !match[2]);
      const url = validType && validShape ? `https://m3.material.io/_dsm/data/dsdb-m3/${corpus.index.provenance.carbonVersion}/${ref.moduleType}.${match![2] ?? match![1]}.json` : undefined;
      const config = configurationSchema.safeParse(configuration);
      const reason = !validType ? `Unsupported module type ${ref.moduleType}; no endpoint schema inferred` : !validShape ? 'Unsupported resource-name/module-type combination' : !config.success ? 'Explicit nonempty tokenSets and only recognized module configuration keys are required; context-only or unknown configuration cannot establish page applicability' : undefined;
      modules.push(moduleSchema.parse({ path: doc.path, moduleId: chunk.id, blockId: block.id, resourceName: ref.name, moduleType: ref.moduleType, articleSourceSha256: doc.sourceSha256, articleSourceUrl: doc.sourceUrl,
        articlePointer: block.provenance ? `/sections/${block.provenance.sectionIndex}/contentBlocks/${block.provenance.blockIndex}/contentChunks/${ci}` : null,
        configuration, ...(url ? { endpointKey: sha256(url) } : {}), status: url ? 'budget-blocked' : 'unsupported', pageFilterStatus: url && !config.success ? 'unsupported-configuration' : 'unavailable', reason, selectedTokenSets: [], missingTokenSets: [], contextEvaluation: 'not-evaluated', rowCount: 0, chunks: [] }));
      if (modules.length > 2000) throw new Error('Module inventory limit');
    }
  }
  if (new Set(modules.map(m => m.path + '\0' + m.moduleId)).size !== modules.length) throw new Error('Ambiguous module IDs in corpus');
  return modules;
}
async function immutableFile(corpus: Corpus, relative: string, body: string | Buffer, max: number) {
  if (Buffer.byteLength(body) > max) throw new Error('Resource artifact size limit');
  await checkCacheTarget(corpus.dir, relative, 'file');
  try { await writeFile(join(corpus.dir, relative), body, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await boundedLocalRead(corpus.dir, relative, max);
    if (sha256(existing) !== sha256(body.toString('utf8'))) throw new Error('Existing immutable resource artifact digest mismatch');
  }
}
async function storeChunks(corpus: Corpus, rows: TokenRow[], diskBudget: { remaining: number }): Promise<ChunkReference[]> {
  const chunks: ChunkReference[] = []; let batch: TokenRow[] = [], size = 24;
  const flush = async () => {
    if (!batch.length) return;
    const text = JSON.stringify(chunkSchema.parse({ version: 1, rows: batch }));
    diskBudget.remaining -= Buffer.byteLength(text);
    if (diskBudget.remaining < 0) throw new Error('Global normalized output byte limit');
    const digest = sha256(text);
    await immutableFile(corpus, `resources/${digest}.json`, text, RESOURCE_STORE_LIMITS.chunkBytes);
    chunks.push({ digest, rowCount: batch.length, tokenNames: [...new Set(batch.map(r => r.tokenName))] }); batch = []; size = 24;
  };
  for (const row of rows) {
    const bytes = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (bytes > RESOURCE_STORE_LIMITS.rowBytes) throw new Error('Normalized row exceeds runtime bound');
    if (batch.length >= RESOURCE_STORE_LIMITS.rowsPerChunk || size + bytes > RESOURCE_STORE_LIMITS.chunkBytes - 256) await flush();
    batch.push(row); size += bytes;
  }
  await flush(); return chunks;
}
async function selectModule(corpus: Corpus, module: ResourceModule, data: ReturnType<typeof normalizeResource>, diskBudget: { remaining: number }) {
  const config = configurationSchema.safeParse(module.configuration);
  if (!config.success) return;
  // Match display names exactly as the renderer overrides spell them, including
  // whitespace/deprecation markers. Never use dependency token sets as selected.
  const selected = data.tokenSets.filter(s => config.data.tokenSets.includes(s.displayName));
  const ambiguous = config.data.tokenSets.filter(n => data.tokenSets.filter(s => s.displayName === n).length > 1);
  module.missingTokenSets = config.data.tokenSets.filter(n => !selected.some(s => s.displayName === n));
  if (ambiguous.length || module.missingTokenSets.length) {
    module.pageFilterStatus = 'unsupported-configuration';
    module.reason = ambiguous.length ? 'Ambiguous tokenSet display names; no page rows emitted' : 'Configured tokenSets absent from this resource; no fallback or partial page selection';
    return;
  }
  module.selectedTokenSets = selected.map(s => s.name);
  const order = config.data.tokenSetOrder ?? config.data.tokenSets;
  const rank = (s: string | null) => { const i = order.indexOf(s ?? ''); return i < 0 ? order.length : i; };
  const rows = data.rows.filter(r => !r.isDependency && module.selectedTokenSets.includes(r.tokenSet.name)).sort((a, b) => rank(a.tokenSet.displayName) - rank(b.tokenSet.displayName));
  module.chunks = await storeChunks(corpus, rows, diskBudget); module.rowCount = rows.length;
  module.pageFilterStatus = 'filtered'; delete module.reason;
}
export interface RefreshResourceOptions {
  dir?: string;
  limits?: Partial<{ requests: number; bytes: number; timeMs: number }>;
  reuse?: boolean;
  /** Test seams; never accepted from CLI or MCP inputs. */
  fetcher?: typeof fetchOfficial;
  sleep?: (ms: number) => Promise<void>;
  beforePublish?: () => Promise<void>;
}
export async function refreshResources(options: RefreshResourceOptions = {}) {
  const start = Date.now(), limits = limitsSchema.parse({ ...REFRESH_LIMITS, ...options.limits });
  const corpus = await openCorpus(options.dir ?? defaultCacheDir()), carbonVersion = corpus.index.provenance.carbonVersion;
  const modules = await inventoryResourceModules(corpus);
  let previous: ResourceIndex | undefined;
  if (options.reuse !== false) {
    try { const old = await loadResourceIndex(corpus, true); if (old.index.carbonVersion === carbonVersion) previous = old.index; }
    catch { /* A missing/invalid old sidecar is not a license to trust old raw files. Fetch anew. */ }
  }
  const directory = await ensureCacheDirectory(corpus.dir, 'resources');
  const temporaryRelative = `resources/.manifest-${randomUUID()}.tmp`, temporary = join(corpus.dir, temporaryRelative);
  // Match the reader's no-descendant-symlinks policy, including inside-root and
  // dangling links. Preflight fixed publication targets before any artifact write
  // or download; digest-named targets are checked as soon as their bytes are known.
  await checkCacheTarget(corpus.dir, 'resources/raw', 'directory');
  for (const relative of ['resources/manifest.json', 'resources/.gitignore', temporaryRelative]) await checkCacheTarget(corpus.dir, relative, 'file');
  await ensureCacheDirectory(corpus.dir, 'resources/raw');
  await writeFile(join(directory, '.gitignore'), '*\n', { flag: 'wx', mode: 0o600 }).catch(e => { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; });
  const grouped = new Map<string, ResourceModule[]>();
  for (const m of modules) if (m.endpointKey) grouped.set(m.endpointKey, [...(grouped.get(m.endpointKey) ?? []), m]);
  // Resolve small foundational samples first, then stable canonical-path order.
  // The ordering is explicit; every endpoint left over still receives a status.
  const priority = (ms: ResourceModule[]) => ms.some(m => m.path === 'components/buttons/specs') ? 0 : ms.some(m => m.path === 'styles/spacing/tokens') ? 1 : ms.some(m => m.path === 'styles/motion/overview/specs') ? 2 : 3;
  const groups = [...grouped.entries()].sort((a, b) => priority(a[1]) - priority(b[1]) || a[1][0].path.localeCompare(b[1][0].path));
  const endpoints: ResourceEndpoint[] = [];
  const run = { requests: 0, fetchedBytes: 0, chargedBytes: 0, elapsedMs: 0, limits };
  const diskBudget = { remaining: 256 * 1024 * 1024 };
  const fetcher = options.fetcher ?? fetchOfficial, sleep = options.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  let lastRequestFinished = 0;
  for (const [key, associated] of groups) {
    const first = associated[0], resourceName = first.resourceName, moduleType = first.moduleType as ModuleType;
    const url = `https://m3.material.io/_dsm/data/dsdb-m3/${carbonVersion}/${moduleType}.${resourceName.split('/').at(-1)}.json`;
    assertOfficialUrl(url);
    const endpoint: ResourceEndpoint = { key, resourceName, moduleType, url, status: 'budget-blocked', reused: false };
    endpoints.push(endpoint);
    let data: ReturnType<typeof normalizeResource> | undefined;
    let body: Buffer | undefined;
    const old = previous?.endpoints.find(e => e.key === key && e.url === url && e.sourceSha256 && e.bytes !== undefined);
    if (old?.sourceSha256 && (old.bytes ?? Infinity) <= limits.bytes - run.chargedBytes && Date.now() - start < limits.timeMs) {
      try {
        const raw = await boundedLocalRead(corpus.dir, `resources/raw/${old.sourceSha256}.json`, Math.min(LIMITS.bodyBytes, limits.bytes - run.chargedBytes));
        if (sha256(raw) !== old.sourceSha256 || Buffer.byteLength(raw) !== old.bytes) throw new Error('Cached raw digest mismatch');
        body = Buffer.from(raw); endpoint.retrievedAt = old.retrievedAt; endpoint.reused = true;
        run.chargedBytes += body.byteLength;
      } catch { /* Missing/corrupt raw artifacts are re-fetched within the same global budget. */ }
    }
    if (!body) {
      const remaining = limits.bytes - run.chargedBytes;
      // Reserve enough wall-clock for the importer's full request/body timeout.
      if (!remaining || run.requests >= limits.requests || Date.now() - start + LIMITS.timeoutMs + LIMITS.intervalMs >= limits.timeMs) {
        endpoint.error = 'Global request, byte or wall-clock budget exhausted';
      } else {
        if (lastRequestFinished) await sleep(Math.max(0, LIMITS.intervalMs - (Date.now() - lastRequestFinished)));
        const budget = Math.min(LIMITS.bodyBytes, remaining);
        run.requests++; run.chargedBytes += budget; // Failures keep their full reserved exposure.
        try {
          const response = await fetcher(url, { json: true, maxBytes: budget });
          body = response.body;
          if (body.byteLength > budget) throw new FetchFailure('body-limit', 'Transport exceeded global reservation');
          run.chargedBytes -= budget - body.byteLength; run.fetchedBytes += body.byteLength;
          endpoint.retrievedAt = new Date().toISOString();
        } catch (error) {
          if (!(error instanceof FetchFailure)) throw error;
          endpoint.status = 'failed'; endpoint.error = `${error.status}: ${error.message}`.slice(0, 1000); body = undefined;
        } finally { lastRequestFinished = Date.now(); }
      }
    }
    if (body) {
      endpoint.sourceSha256 = createHash('sha256').update(body).digest('hex'); endpoint.bytes = body.byteLength;
      // Raw artifacts are intentionally ignored, never a vendored upstream mirror.
      await immutableFile(corpus, `resources/raw/${endpoint.sourceSha256}.json`, body, LIMITS.bodyBytes);
      try {
        const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
        data = normalizeResource(payload, resourceName);
        endpoint.status = 'fetched'; endpoint.rowCount = data.rows.length; endpoint.dsdbVersion = data.dsdbVersion as '38.2.9';
      } catch (error) { endpoint.status = 'failed'; endpoint.error = `invalid-schema: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000); }
    }
    for (const module of associated) {
      module.status = endpoint.status;
      if (endpoint.status !== 'fetched') module.reason = endpoint.error;
      else if (data) await selectModule(corpus, module, data, diskBudget);
    }
  }
  run.elapsedMs = Date.now() - start;
  if (run.elapsedMs > limits.timeMs && limits.timeMs > 0) throw new Error('Global resource refresh time budget exceeded; previous sidecar retained');
  const index = resourceIndexSchema.parse({ version: 1, corpusSnapshot: corpus.snapshot, carbonVersion, createdAt: new Date().toISOString(), modules, endpoints, run });
  const indexText = JSON.stringify(index), snapshot = sha256(indexText);
  await immutableFile(corpus, `resources/${snapshot}.json`, indexText, RESOURCE_STORE_LIMITS.indexBytes);
  const manifest = resourceManifestSchema.parse({ version: 1, snapshot, corpusSnapshot: corpus.snapshot, carbonVersion });
  let temporaryCreated = false;
  try {
    await checkCacheTarget(corpus.dir, temporaryRelative, 'file');
    await writeFile(temporary, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
    temporaryCreated = true;
    await options.beforePublish?.();
    const current = await openCorpus(corpus.dir);
    if (current.snapshot !== corpus.snapshot || current.index.provenance.carbonVersion !== carbonVersion) throw new Error('Corpus changed during resource import; previous sidecar retained. Retry against stable corpus.');
    await checkCacheTarget(corpus.dir, temporaryRelative, 'file');
    await checkCacheTarget(corpus.dir, 'resources/manifest.json', 'file');
    await rename(temporary, join(directory, 'manifest.json'));
    temporaryCreated = false;
  } finally {
    // Never delete a pre-existing collision or follow a replaced parent on cleanup.
    if (temporaryCreated) {
      await checkCacheTarget(corpus.dir, temporaryRelative, 'file');
      await rm(temporary, { force: true });
    }
  }
  // Exact-target readback verifies the published manifest and all index identities.
  const verified = await loadResourceIndex(await openCorpus(corpus.dir));
  if (verified.snapshot !== snapshot) throw new Error('Concurrent resource publication replaced this run');
  return { snapshot, corpusSnapshot: corpus.snapshot, carbonVersion, counts: resourceCounts(verified.index), run, modules: verified.index.modules.map(({ chunks, ...module }) => module), endpoints: verified.index.endpoints };
}
async function main() {
  const args = process.argv.slice(2); let dir = defaultCacheDir(); let reuse = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) dir = resolve(args[++i]);
    else if (args[i] === '--no-reuse') reuse = false;
    else throw new Error('Usage: npx tsx scripts/refresh-resources.ts [--dir <corpus-directory>] [--no-reuse]');
  }
  const result = await refreshResources({ dir, reuse });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
