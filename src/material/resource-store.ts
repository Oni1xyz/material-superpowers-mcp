import { z } from 'zod';
import { defaultCacheDir, sha256 } from './cache.js';
import { boundedLocalRead, openCorpus, type Corpus } from './corpus.js';
import { carbonVersionSchema, pathSchema } from './discovery.js';
import { boundedArray } from './validation.js';
// Keep storage types local: even a type import from scripts widens tsc's rootDir.
type TokenRow = z.infer<typeof rowSchema>;

/** Runtime is read-only and offline. No executable importer dependency. */
export const RESOURCE_STORE_LIMITS = Object.freeze({ indexBytes: 8 * 1024 * 1024, chunkBytes: 64 * 1024, rowBytes: 16 * 1024, rowsPerChunk: 64, chunksPerCall: 64, outputBytes: 128 * 1024 });
export const RESOURCE_REFRESH_HELP = 'Run npx tsx scripts/refresh-resources.ts --dir <corpus-directory> after npm run refresh-cache. Runtime never fetches resources.';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const smallText = z.string().max(4096);
const name = z.string().max(200).regex(/^designSystems\/[a-f0-9]{16}(?:\/components\/[a-f0-9]{16})?$/);
const setName = z.string().regex(/^designSystems\/[a-f0-9]{16}\/tokenSets\/[a-f0-9]{16}$/);
const tokenName = z.string().regex(/^designSystems\/[a-f0-9]{16}\/tokenSets\/[a-f0-9]{16}\/tokens\/[a-f0-9]{16}$/);
const status = z.enum(['fetched', 'unsupported', 'failed', 'budget-blocked']);
const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null(), boundedArray(jsonValue, 100), z.record(jsonValue).refine(v => Object.keys(v).length <= 100)]));
// Check depth/bytes before entering a recursive parser (including hostile local files).
export const boundedJson = z.unknown().superRefine((v, ctx) => {
  let nodes = 0;
  function visit(x: unknown, depth: number): boolean {
    if (++nodes > 3000 || depth > 10) return false;
    if (x && typeof x === 'object') return Object.values(x).every(n => visit(n, depth + 1));
    return true;
  }
  if (!visit(v, 0) || Buffer.byteLength(JSON.stringify(v) ?? '') > 16384) ctx.addIssue({ code: 'custom', message: 'JSON depth/size limit' });
}).pipe(jsonValue);
export const configurationSchema = z.object({ tokenSets: boundedArray(smallText, 100, 1), contextTags: boundedArray(smallText, 100).optional(), tokenSetOrder: boundedArray(smallText, 100).optional(), hideSearchField: z.boolean().optional(), hideVersionName: z.boolean().optional() }).strict();
export const rowSchema = z.object({
  tokenResource: tokenName, tokenName: smallText, displayName: smallText, tokenValueType: smallText,
  tokenSet: z.object({ name: setName, displayName: smallText.nullable() }).strict(), isDependency: z.boolean(),
  contextTags: boundedArray(z.object({ name: z.string().regex(/^designSystems\/[a-f0-9]{16}\/contextTagGroups\/[a-f0-9]{16}\/tags\/[a-f0-9]{16}$/), displayName: smallText.nullable() }).strict(), 100),
  status: z.enum(['resolved', 'undefined', 'resolved-composite', 'no-resolved-tree']), resolvedValue: boundedJson.nullable(), resolvedCustomCompositeValue: boundedJson.optional(),
  sourcePointer: z.string().max(1500).regex(/^\/system\/(?:tokens\/\d+|contextualReferenceTrees\/[^/]+\/contextualReferenceTree\/\d+)$/),
  valueResource: z.string().regex(/^designSystems\/[a-f0-9]{16}\/tokenSets\/[a-f0-9]{16}\/tokens\/[a-f0-9]{16}\/values\/[a-f0-9]{16}$/).nullable(),
  deprecationMessage: z.object({ message: smallText }).strict().optional(),
}).strict().superRefine((r, ctx) => {
  if (Buffer.byteLength(JSON.stringify(r)) > RESOURCE_STORE_LIMITS.rowBytes || !r.tokenResource.startsWith(r.tokenSet.name + '/tokens/') || (r.valueResource && !r.valueResource.startsWith(r.tokenResource + '/values/')) || (r.status === 'no-resolved-tree' && (r.resolvedValue !== null || r.valueResource !== null)) || (r.status === 'undefined' && (r.resolvedValue as any)?.undefined !== true)) ctx.addIssue({ code: 'custom', message: 'Invalid normalized row identity/status/size' });
});
export const chunkSchema = z.object({ version: z.literal(1), rows: boundedArray(rowSchema, RESOURCE_STORE_LIMITS.rowsPerChunk, 1) }).strict();
export const chunkReferenceSchema = z.object({ digest, rowCount: z.number().int().min(1).max(RESOURCE_STORE_LIMITS.rowsPerChunk), tokenNames: boundedArray(smallText, RESOURCE_STORE_LIMITS.rowsPerChunk, 1) }).strict();
export const endpointSchema = z.object({
  key: digest, resourceName: name, moduleType: z.enum(['TOKEN_TABLE', 'MEASUREMENT', 'TOKEN_TYPE_UNSPECIFIED']), url: z.string().max(600),
  status: z.enum(['fetched', 'failed', 'budget-blocked']), error: z.string().max(1000).optional(), sourceSha256: digest.optional(), bytes: z.number().int().min(0).max(24 * 1024 * 1024).optional(),
  retrievedAt: z.string().datetime().optional(), dsdbVersion: z.literal('38.2.9').optional(), rowCount: z.number().int().min(0).max(50000).optional(),
  reused: z.boolean(),
}).strict();
export const moduleSchema = z.object({
  path: pathSchema, moduleId: z.string().min(1).max(200), blockId: z.string().max(200), resourceName: z.string().max(1000), moduleType: z.string().max(100),
  articleSourceSha256: digest, articleSourceUrl: z.string().max(600), articlePointer: z.string().max(1000).regex(/^\/sections\/\d+\/contentBlocks\/\d+\/contentChunks\/\d+$/).nullable(),
  configuration: boundedJson.nullable(), endpointKey: digest.optional(), status,
  pageFilterStatus: z.enum(['filtered', 'unsupported-configuration', 'unavailable']), reason: z.string().max(1000).optional(),
  selectedTokenSets: boundedArray(setName, 100), missingTokenSets: boundedArray(smallText, 100),
  contextEvaluation: z.literal('not-evaluated'), rowCount: z.number().int().min(0).max(50000), chunks: boundedArray(chunkReferenceSchema, 2000),
}).strict();
export const resourceIndexSchema = z.object({
  version: z.literal(1), corpusSnapshot: digest, carbonVersion: carbonVersionSchema, createdAt: z.string().datetime(),
  modules: boundedArray(moduleSchema, 2000), endpoints: boundedArray(endpointSchema, 128),
  run: z.object({ requests: z.number().int().min(0).max(64), fetchedBytes: z.number().int().min(0).max(64 * 1024 * 1024), chargedBytes: z.number().int().min(0).max(64 * 1024 * 1024), elapsedMs: z.number().min(0), limits: z.object({ requests: z.number().int().min(0).max(64), bytes: z.number().int().min(0).max(64 * 1024 * 1024), timeMs: z.number().int().min(0).max(600000) }).strict() }).strict(),
}).strict();
export const resourceManifestSchema = z.object({ version: z.literal(1), snapshot: digest, corpusSnapshot: digest, carbonVersion: carbonVersionSchema }).strict();
export type ResourceModule = z.infer<typeof moduleSchema>;
export type ResourceEndpoint = z.infer<typeof endpointSchema>;
export type ResourceIndex = z.infer<typeof resourceIndexSchema>;
export type ChunkReference = z.infer<typeof chunkReferenceSchema>;
function parseStoredJson(text: string, kind: 'manifest' | 'index' | 'chunk' | 'cursor'): unknown {
  const value: unknown = JSON.parse(text);
  // Zod array.max checks length but still validates elements. Reject breadth,
  // depth and node count first, before expensive recursive schema evaluation.
  const arrayLimit = kind === 'index' ? 2000 : 100, nodeLimit = kind === 'index' ? 250000 : 10000;
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }]; let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++nodes > nodeLimit || item.depth > 16) throw new Error('Resource JSON complexity limit');
    if (item.value && typeof item.value === 'object') {
      const children = Array.isArray(item.value) ? item.value : Object.values(item.value);
      if (children.length > (Array.isArray(item.value) ? arrayLimit : 100)) throw new Error('Resource JSON collection limit');
      for (const child of children) stack.push({ value: child, depth: item.depth + 1 });
    }
  }
  return value;
}
function parseStoredSchema<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  // Every schema array fails on its first invalid element, including nested
  // arrays within the preflight limits. Truncating issues after safeParse alone
  // would still allocate the complete error tree and can exhaust the heap.
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid resource schema at ${parsed.error.issues[0]?.path.join('.').slice(0, 120) ?? 'root'}`);
  return parsed.data;
}
export class ResourceStoreError extends Error {
  constructor(public status: 'missing' | 'stale' | 'invalid', detail: string) { super(`Resource sidecar ${status}: ${detail}. ${RESOURCE_REFRESH_HELP}`); }
}
export async function loadResourceIndex(corpus: Corpus, allowStale = false) {
  let manifestText: string;
  try { manifestText = await boundedLocalRead(corpus.dir, 'resources/manifest.json', 4096); }
  catch (e) { throw new ResourceStoreError((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid', 'manifest unavailable'); }
  try {
    const manifest = parseStoredSchema(resourceManifestSchema, parseStoredJson(manifestText, 'manifest'));
    const text = await boundedLocalRead(corpus.dir, `resources/${manifest.snapshot}.json`, RESOURCE_STORE_LIMITS.indexBytes);
    if (sha256(text) !== manifest.snapshot) throw new Error('index digest mismatch');
    const index = parseStoredSchema(resourceIndexSchema, parseStoredJson(text, 'index'));
    if (index.corpusSnapshot !== manifest.corpusSnapshot || index.carbonVersion !== manifest.carbonVersion) throw new Error('index/manifest version mismatch');
    if (!allowStale && (manifest.corpusSnapshot !== corpus.snapshot || manifest.carbonVersion !== corpus.index.provenance.carbonVersion)) throw new ResourceStoreError('stale', 'corpus snapshot changed');
    const endpoints = new Map(index.endpoints.map(e => [e.key, e]));
    if (endpoints.size !== index.endpoints.length) throw new Error('duplicate endpoint');
    for (const e of index.endpoints) {
      const id = e.resourceName.split('/').at(-1);
      if (e.key !== sha256(e.url) || e.url !== `https://m3.material.io/_dsm/data/dsdb-m3/${index.carbonVersion}/${e.moduleType}.${id}.json`) throw new Error('endpoint identity mismatch');
      if (e.status === 'fetched' && (!e.sourceSha256 || !e.retrievedAt || !e.dsdbVersion || e.bytes === undefined || e.rowCount === undefined)) throw new Error('missing fetched provenance');
    }
    const identities = new Set<string>();
    for (const m of index.modules) {
      const key = m.path + '\0' + m.moduleId;
      if (identities.has(key)) throw new Error('duplicate module identity'); identities.add(key);
      const endpoint = m.endpointKey ? endpoints.get(m.endpointKey) : undefined;
      if (m.endpointKey && (!endpoint || endpoint.moduleType !== m.moduleType || endpoint.resourceName !== m.resourceName || endpoint.status !== m.status)) throw new Error('module/endpoint mismatch');
      if (m.status === 'fetched' && !endpoint) throw new Error('missing module endpoint');
      if (m.rowCount !== m.chunks.reduce((sum, c) => sum + c.rowCount, 0) || (m.chunks.length && (m.status !== 'fetched' || m.pageFilterStatus !== 'filtered' || !m.selectedTokenSets.length))) throw new Error('invalid module selection');
      if (!allowStale) {
        const doc = corpus.index.documents.find(d => d.path === m.path);
        if (!doc || doc.sourceSha256 !== m.articleSourceSha256 || m.articleSourceUrl !== `https://m3.material.io/_dsm/content/m3/${index.carbonVersion}/${doc.documentId}`) throw new Error('article identity mismatch');
      }
    }
    return { snapshot: manifest.snapshot, index };
  } catch (e) {
    if (e instanceof ResourceStoreError) throw e;
    throw new ResourceStoreError('invalid', e instanceof Error ? e.message.slice(0, 160) : 'invalid local data');
  }
}
export function resourceCounts(index: ResourceIndex) {
  const ms = index.modules, es = index.endpoints;
  return { modules: ms.length, endpoints: es.length, fetchedModules: ms.filter(m => m.status === 'fetched').length, unsupportedModules: ms.filter(m => m.status === 'unsupported').length, failedModules: ms.filter(m => m.status === 'failed').length, budgetBlockedModules: ms.filter(m => m.status === 'budget-blocked').length, fetchedEndpoints: es.filter(e => e.status === 'fetched').length, failedEndpoints: es.filter(e => e.status === 'failed').length, budgetBlockedEndpoints: es.filter(e => e.status === 'budget-blocked').length, reusedEndpoints: es.filter(e => e.reused).length, pageFilteredModules: ms.filter(m => m.pageFilterStatus === 'filtered').length, unsupportedConfigurationModules: ms.filter(m => m.pageFilterStatus === 'unsupported-configuration').length, contextEvaluatedModules: 0, pageFilteredRows: ms.reduce((n, m) => n + m.rowCount, 0) };
}
function moduleSummary({ chunks, ...m }: ResourceModule) { return m; }
export async function readResourceCoverage(corpusOrDir: Corpus | string = defaultCacheDir()) {
  const corpus = typeof corpusOrDir === 'string' ? await openCorpus(corpusOrDir) : corpusOrDir;
  try {
    const { index, snapshot } = await loadResourceIndex(corpus);
    return { status: 'ready' as const, snapshot, corpusSnapshot: corpus.snapshot, carbonVersion: index.carbonVersion, counts: resourceCounts(index), modules: index.modules.map(moduleSummary), endpoints: index.endpoints, run: index.run, complete: false, note: 'Fetched endpoints, page-token-set filtering and context evaluation are distinct. All context alternatives are retained; no winning context is inferred. Unsupported modules/configurations remain explicit.' };
  } catch (e) {
    if (!(e instanceof ResourceStoreError)) throw e;
    return { status: e.status, corpusSnapshot: corpus.snapshot, message: e.message, complete: false };
  }
}
export const readSpecSchema = z.object({ path: pathSchema, query: z.string().min(1).max(200).optional(), moduleId: z.string().min(1).max(200).optional(), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(1500).optional() }).strict();
const cursorSchema = z.object({ version: z.literal(1), binding: digest, module: z.number().int().min(0).max(2000), chunk: z.number().int().min(0).max(2000), row: z.number().int().min(0).max(64) }).strict();
export async function readSpec(dir: string, input: z.input<typeof readSpecSchema>) {
  const args = readSpecSchema.parse(input), corpus = await openCorpus(dir);
  if (!corpus.index.documents.some(d => d.path === args.path)) throw new Error('Unknown canonical path; use material_search_docs');
  const { index, snapshot } = await loadResourceIndex(corpus);
  const all = index.modules.filter(m => m.path === args.path);
  if (args.moduleId && !all.some(m => m.moduleId === args.moduleId)) throw new Error('Unknown moduleId for this exact path');
  const modules = all.filter(m => !args.moduleId || m.moduleId === args.moduleId);
  const binding = sha256(JSON.stringify([corpus.snapshot, snapshot, args.path, args.moduleId ?? null, args.query ?? null]));
  let pos = { version: 1 as const, binding, module: 0, chunk: 0, row: 0 };
  if (args.cursor) {
    try { pos = parseStoredSchema(cursorSchema, parseStoredJson(Buffer.from(args.cursor, 'base64url').toString('utf8'), 'cursor')); }
    catch { throw new Error('Invalid spec cursor'); }
    if (pos.binding !== binding || pos.module >= modules.length || pos.chunk >= modules[pos.module].chunks.length || pos.row >= modules[pos.module].chunks[pos.chunk].rowCount) throw new Error('Spec cursor snapshot/filter/offset mismatch');
  }
  type CitedRow = TokenRow & { moduleId: string; citation: { url: string; sourceSha256: string; sourcePointer: string; carbonVersion: string; dsdbVersion: string; corpusSnapshot: string; resourceSnapshot: string; articleUrl: string; articleSourceSha256: string; articleSourceUrl: string; articlePointer: string | null; selectedTokenSet: TokenRow['tokenSet']; retrievedAt: string } };
  const rows: CitedRow[] = [];
  const summaries = modules.map(moduleSummary);
  let bytes = Buffer.byteLength(JSON.stringify(summaries)) + 4000, reads = 0, stopped = false;
  if (bytes > RESOURCE_STORE_LIMITS.outputBytes / 2) throw new Error('Module metadata exceeds response budget; select a moduleId');
  const endpoints = new Map(index.endpoints.map(e => [e.key, e]));
  outer: for (; pos.module < modules.length; pos.module++, pos.chunk = 0, pos.row = 0) {
    const m = modules[pos.module];
    for (; pos.chunk < m.chunks.length; pos.chunk++, pos.row = 0) {
      const ref = m.chunks[pos.chunk];
      if (args.query && !ref.tokenNames.some(n => n.toLowerCase().includes(args.query!.toLowerCase()))) continue;
      if (reads >= RESOURCE_STORE_LIMITS.chunksPerCall) { stopped = true; break outer; }
      const text = await boundedLocalRead(corpus.dir, `resources/${ref.digest}.json`, RESOURCE_STORE_LIMITS.chunkBytes); reads++;
      if (sha256(text) !== ref.digest) throw new Error('Resource chunk digest mismatch; ' + RESOURCE_REFRESH_HELP);
      const chunk = parseStoredSchema(chunkSchema, parseStoredJson(text, 'chunk'));
      if (chunk.rows.length !== ref.rowCount || JSON.stringify([...new Set(chunk.rows.map(r => r.tokenName))]) !== JSON.stringify(ref.tokenNames)) throw new Error('Resource chunk index mismatch');
      for (; pos.row < chunk.rows.length; pos.row++) {
        const row = chunk.rows[pos.row] as TokenRow;
        if (row.isDependency || !m.selectedTokenSets.includes(row.tokenSet.name)) throw new Error('Resource chunk violates page token-set selection');
        if (args.query && !row.tokenName.toLowerCase().includes(args.query.toLowerCase())) continue;
        const endpoint = endpoints.get(m.endpointKey!)!;
        const result: CitedRow = { ...row, moduleId: m.moduleId, citation: { url: endpoint.url, sourceSha256: endpoint.sourceSha256!, sourcePointer: row.sourcePointer, carbonVersion: index.carbonVersion, dsdbVersion: endpoint.dsdbVersion!, corpusSnapshot: corpus.snapshot, resourceSnapshot: snapshot, articleUrl: 'https://m3.material.io/' + args.path, articleSourceSha256: m.articleSourceSha256, articleSourceUrl: m.articleSourceUrl, articlePointer: m.articlePointer, selectedTokenSet: row.tokenSet, retrievedAt: endpoint.retrievedAt! } };
        const size = Buffer.byteLength(JSON.stringify(result));
        if (rows.length >= args.limit || bytes + size > RESOURCE_STORE_LIMITS.outputBytes - 2000) { stopped = true; break outer; }
        rows.push(result); bytes += size;
      }
    }
  }
  return { path: args.path, corpusSnapshot: corpus.snapshot, resourceSnapshot: snapshot, carbonVersion: index.carbonVersion, modules: summaries, rows, hasMore: stopped, nextCursor: stopped ? Buffer.from(JSON.stringify(pos)).toString('base64url') : undefined, contextEvaluation: 'not-evaluated' as const, scope: 'Only explicitly selected module tokenSets, never dependency tokens. Context alternatives (including undefined, missing, composite and deprecated) are preserved, not ranked or collapsed. Continue all pages; contextTags overrides are recorded, not applied as a winning-context algorithm. No inferred zeros or unit conversion.', scannedChunks: reads };
}
