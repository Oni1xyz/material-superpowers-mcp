import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishCorpus, openCorpus, type CorpusDocument } from '../src/material/corpus.js';
import { parseCarbonDocument } from '../src/material/carbon.js';
import { sha256 } from '../src/material/cache.js';
import { readResourceCoverage, readSpec, resourceIndexSchema, chunkSchema } from '../src/material/resource-store.js';
import { refreshResources } from '../scripts/refresh-resources.js';
import { makeResourceTools } from '../src/tools/resources.js';

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const version = '2026-09-23_06-10-05', system = 'designSystems/20543ce18892f7d9';
const component = `${system}/components/1c4257f8804f9478`;
const set = (n: string) => `${system}/tokenSets/${n.repeat(16)}`;
const token = (s: string, n: string) => `${s}/tokens/${n.repeat(16)}`;
const path = 'components/buttons/specs';
function doc(config: unknown = { tokenSets: ['Current'] }, suffix = '', secondResource = component): CorpusDocument {
  const documentId = 'e31df68a-59d4-41dc-8743-8c48b476d4f8.json';
  const parsed = parseCarbonDocument({ title: 'Synthetic buttons' + suffix, sections: [{ name: 'Specs', contentBlocks: [{ contentChunks: [
    { contentChunkType: 'RESOURCE', pageContentChunkId: 'current', resourceName: component, libraryModuleType: 'TOKEN_TABLE', moduleConfigurationOverrides: config },
    { contentChunkType: 'RESOURCE', pageContentChunkId: 'deprecated', resourceName: secondResource, libraryModuleType: 'TOKEN_TABLE', moduleConfigurationOverrides: { tokenSets: ['Deprecated'] } },
    { contentChunkType: 'RESOURCE', pageContentChunkId: 'unsupported', resourceName: component, libraryModuleType: 'STATUS_TABLE' },
  ] }] }] }, 'Specs');
  return { ...parsed, path, url: 'https://m3.material.io/' + path, category: 'components', sourceKind: 'material-3', documentId, carbonVersion: version, sourceUrl: `https://m3.material.io/_dsm/content/m3/${version}/${documentId}`, section: 'Specs', sourceSha256: sha256('synthetic' + suffix), sha256: sha256(parsed.text), fetchedAt: '2026-10-10T00:00:00.000Z', extractionMethod: 'synthetic-test' };
}
async function publish(dir: string, d = doc()) {
  return publishCorpus(dir, [d], { carbonVersion: version, bundleUrl: 'https://m3.material.io/static/angular/main.7906d9e8e8cae962.js', bundleSha256: 'b'.repeat(64), sitemapSha256: 'c'.repeat(64), discoveredAt: '2026-10-10T00:00:00.000Z', mappings: [{ path, url: d.url, category: d.category, status: 'mapped', documentId: d.documentId, section: 'Specs' }] });
}
function payload() {
  const a = token(set('a'), '1'), b = token(set('b'), '2'), dep = token(set('c'), '3');
  const names = [a, b, dep];
  return { system: { name: system, dsdbVersion: '38.2.9', _isResolved: true, tokenSets: [{ name: set('a'), displayName: 'Current' }, { name: set('b'), displayName: 'Deprecated' }], tags: [], components: [{ name: component }],
    tokens: names.map((name, i) => ({ name, tokenName: `synthetic.${i}.height`, displayName: 'Height', tokenValueType: 'MEASUREMENT', ...(i === 1 ? { deprecationMessage: { message: 'Old context' } } : {}) })),
    values: names.flatMap(name => [0, 1].map(n => ({ name: `${name}/values/${String(n).repeat(16)}` }))),
    contextualReferenceTrees: Object.fromEntries(names.map((name, i) => [name, { contextualReferenceTree: [0, 1].map(n => ({ contextTags: [], referenceTree: { tokenName: `synthetic.${i}.height`, value: { name: `${name}/values/${String(n).repeat(16)}` } }, resolvedValue: n ? { undefined: true } : { length: { unit: 'DP' } } })) }])) } };
}
async function setup(config?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'resource-sidecar-')); dirs.push(dir); await publish(dir, doc(config));
  const fetcher = vi.fn(async () => ({ body: Buffer.from(JSON.stringify(payload())), httpStatus: 200, contentType: 'application/json' }));
  await refreshResources({ dir, fetcher, sleep: async () => {} }); return { dir, fetcher };
}
it('imports once per exact endpoint and separates page token sets, dependencies and contexts', async () => {
  const { dir, fetcher } = await setup(); expect(fetcher).toHaveBeenCalledTimes(1);
  const coverage = await readResourceCoverage(dir); expect(coverage.status).toBe('ready');
  if (coverage.status !== 'ready') throw new Error('missing');
  expect(coverage.counts.modules).toBe(3); expect(coverage.counts.fetchedModules).toBe(2); expect(coverage.counts.fetchedEndpoints).toBe(1); expect(coverage.counts.unsupportedModules).toBe(1);
  const first = await readSpec(dir, { path, moduleId: 'current', limit: 1 });
  expect(first.rows).toHaveLength(1); expect(first.rows[0].tokenSet.displayName).toBe('Current'); expect(first.rows[0].resolvedValue).toEqual({ length: { unit: 'DP' } });
  expect(first.rows[0].citation.sourcePointer).toContain('/system/contextualReferenceTrees/');
  expect(first.nextCursor).toBeTruthy();
  const next = await readSpec(dir, { path, moduleId: 'current', limit: 1, cursor: first.nextCursor }); expect(next.rows[0].status).toBe('undefined');
  const old = await readSpec(dir, { path, moduleId: 'deprecated' }); expect(old.rows.every(r => r.tokenSet.displayName === 'Deprecated')).toBe(true); expect(old.rows[0].deprecationMessage?.message).toBe('Old context');
  expect(first.contextEvaluation).toBe('not-evaluated');
});
it('does not fall back on unknown filters or absent tokenSets', async () => {
  const { dir } = await setup({ contextTags: ['Android'] });
  const noConfig = await readSpec(dir, { path, moduleId: 'current' }); expect(noConfig.rows).toEqual([]); expect(noConfig.modules[0].pageFilterStatus).toBe('unsupported-configuration');
  await expect(readSpec(dir, { path, moduleId: 'unknown' })).rejects.toThrow('module');
  expect((await readSpec(dir, { path, query: 'does.not.exist' })).rows).toEqual([]);
  await expect(readSpec(dir, { path: '../secret' })).rejects.toThrow();
  expect(makeResourceTools(dir)).toHaveLength(1);
  await expect(makeResourceTools(dir)[0].run({ path, unexpected: true })).rejects.toThrow();
});
it('binds cursors to corpus, sidecar, path and exact filters', async () => {
  const { dir } = await setup(); const a = await readSpec(dir, { path, moduleId: 'current', limit: 1 });
  await expect(readSpec(dir, { path, moduleId: 'deprecated', cursor: a.nextCursor })).rejects.toThrow('cursor');
  await expect(readSpec(dir, { path, moduleId: 'current', query: 'height', cursor: a.nextCursor })).rejects.toThrow('cursor');
  await expect(readSpec(dir, { path, cursor: 'garbage' })).rejects.toThrow('cursor');
  await publish(dir, doc(undefined, ' changed')); expect((await readResourceCoverage(dir)).status).toBe('stale');
  await expect(readSpec(dir, { path })).rejects.toThrow('refresh-resources');
});
it('is explicit when missing, rejects corrupt manifests and confined digest files', async () => {
  const { dir } = await setup(); const manifestPath = join(dir, 'resources', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const indexPath = join(dir, 'resources', `${manifest.snapshot}.json`);
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  const chunk = index.modules.find((m: any) => m.moduleId === 'current').chunks[0];
  const chunkPath = join(dir, 'resources', `${chunk.digest}.json`);
  await writeFile(chunkPath, '{}'); await expect(readSpec(dir, { path })).rejects.toThrow('digest');
  await rm(chunkPath); const outside = join(await mkdtemp(join(tmpdir(), 'outside-resource-')), 'external.json'); dirs.push(join(outside, '..')); await writeFile(outside, '{}'); await symlink(outside, chunkPath);
  await expect(readSpec(dir, { path })).rejects.toThrow('escapes');
  manifest.snapshot = '../evil'; await writeFile(manifestPath, JSON.stringify(manifest)); expect((await readResourceCoverage(dir)).status).toBe('invalid');
  await rm(manifestPath); expect((await readResourceCoverage(dir)).status).toBe('missing');
});
it('rejects corpus races before publication and preserves previous manifest', async () => {
  const { dir } = await setup(); const before = await readFile(join(dir, 'resources/manifest.json'), 'utf8');
  await expect(refreshResources({ dir, sleep: async () => {}, beforePublish: async () => { await publish(dir, doc(undefined, ' race')); } })).rejects.toThrow('changed');
  expect(await readFile(join(dir, 'resources/manifest.json'), 'utf8')).toBe(before);
});
it('keeps one global budget and inventories every blocked module', async () => {
  const { dir } = await setup();
  const result = await refreshResources({ dir, limits: { requests: 0 }, sleep: async () => {}, reuse: false });
  expect(result.counts.budgetBlockedModules).toBe(2); expect(result.counts.modules).toBe(3); expect(result.counts.fetchedEndpoints).toBe(0);
});
it('fails closed for unknown configuration keys or unmatched exact token-set names', async () => {
  for (const config of [{ tokenSets: ['Current'], unknownSelector: true }, { tokenSets: ['Current', 'typo'] }, { tokenSets: ['current'] }]) {
    const { dir } = await setup(config); const result = await readSpec(dir, { path, moduleId: 'current' });
    expect(result.rows).toEqual([]); expect(result.modules[0].pageFilterStatus).toBe('unsupported-configuration');
  }
});
it('reuses digest-verified raw artifacts without downloading duplicates', async () => {
  const { dir } = await setup(); const fetcher = vi.fn(async () => { throw new Error('network forbidden'); });
  const result = await refreshResources({ dir, fetcher }); expect(fetcher).not.toHaveBeenCalled(); expect(result.counts.reusedEndpoints).toBe(1); expect(result.run.requests).toBe(0);
});
it('does not reset global request/byte budgets for distinct endpoints', async () => {
  const { dir } = await setup(); const other = `${system}/components/aaaaaaaaaaaaaaaa`; await publish(dir, doc(undefined, '', other));
  const p = payload(); p.system.components.push({ name: other });
  const body = Buffer.from(JSON.stringify(p)); const fetcher = vi.fn(async () => ({ body, httpStatus: 200, contentType: 'application/json' }));
  const result = await refreshResources({ dir, fetcher, reuse: false, sleep: async () => {}, limits: { requests: 1 } });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(result.counts.fetchedEndpoints).toBe(1); expect(result.counts.budgetBlockedEndpoints).toBe(1); expect(result.counts.budgetBlockedModules).toBe(1);
  fetcher.mockClear();
  const bytes = await refreshResources({ dir, fetcher, reuse: false, sleep: async () => {}, limits: { bytes: body.byteLength } });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(bytes.run.chargedBytes).toBe(body.byteLength); expect(bytes.counts.budgetBlockedEndpoints).toBe(1);
});
it('preserves missing trees and composites while paging bounded chunks without cursor loops', async () => {
  const { dir } = await setup(); const p: any = payload(), a = token(set('a'), '1');
  const variants = p.system.contextualReferenceTrees[a].contextualReferenceTree;
  p.system.contextualReferenceTrees[a].contextualReferenceTree = Array.from({ length: 240 }, (_, i) => variants[i % 2]);
  p.system.contextualReferenceTrees[a].contextualReferenceTree[0] = { ...variants[0], resolvedValue: undefined, resolvedCustomCompositeValue: { properties: { stiffness: { resolvedValue: { numeric: 100 } } } } };
  p.system.tokens.push({ name: token(set('a'), '4'), tokenName: 'synthetic.missing', displayName: 'Missing tree', tokenValueType: 'MEASUREMENT' });
  await refreshResources({ dir, reuse: false, sleep: async () => {}, fetcher: async () => ({ body: Buffer.from(JSON.stringify(p)), httpStatus: 200, contentType: 'application/json' }) });
  let cursor: string | undefined; const rows = [], seen = new Set<string>();
  do {
    const page = await readSpec(dir, { path, moduleId: 'current', limit: 50, cursor });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(128 * 1024); expect(page.rows.length).toBeLessThanOrEqual(50); expect(page.scannedChunks).toBeLessThanOrEqual(64);
    rows.push(...page.rows); cursor = page.nextCursor;
    if (cursor) { expect(seen.has(cursor)).toBe(false); seen.add(cursor); }
  } while (cursor);
  expect(rows).toHaveLength(241); expect(rows.some(r => r.isDependency)).toBe(false); expect(rows[0].status).toBe('resolved-composite'); expect(rows.at(-1)?.status).toBe('no-resolved-tree');
});
it('preflights hostile oversized arrays before per-element schema evaluation', async () => {
  const { dir } = await setup(); const file = join(dir, 'resources/manifest.json'); const manifest = JSON.parse(await readFile(file, 'utf8'));
  const text = JSON.stringify({ modules: Array(200000).fill(null) }); const hash = sha256(text);
  await writeFile(join(dir, `resources/${hash}.json`), text); await writeFile(file, JSON.stringify({ ...manifest, snapshot: hash }));
  const result = await readResourceCoverage(dir); expect(result.status).toBe('invalid');
  if (result.status === 'ready') throw new Error('unexpected');
  expect(result.message).toContain('collection limit'); expect(result.message.length).toBeLessThan(1000);
});
it('stops at the first invalid element at every nested schema array level', async () => {
  const { dir } = await setup();
  const manifest = JSON.parse(await readFile(join(dir, 'resources/manifest.json'), 'utf8'));
  const index = JSON.parse(await readFile(join(dir, `resources/${manifest.snapshot}.json`), 'utf8'));
  const originalChunk = JSON.parse(await readFile(join(dir, `resources/${index.modules[0].chunks[0].digest}.json`), 'utf8'));
  // An issue-count assertion alone could hide unbounded inner safeParse work.
  // Poison second elements to prove no later element is even accessed.
  const poisonTail = (first: unknown) => {
    const values = [first, null];
    Object.defineProperty(values, 1, { get() { throw new Error('visited after first invalid element'); } });
    return values;
  };
  index.modules = poisonTail({ ...index.modules[0], chunks: poisonTail({ ...index.modules[0].chunks[0], tokenNames: poisonTail(null) }) });
  const invalidIndex = resourceIndexSchema.safeParse(index);
  expect(invalidIndex.success).toBe(false);
  if (!invalidIndex.success) {
    expect(invalidIndex.error.issues).toHaveLength(1);
    expect(invalidIndex.error.issues[0].path).toEqual(['modules', 0, 'chunks', 0, 'tokenNames', 0]);
    expect(invalidIndex.error.message.length).toBeLessThan(1000);
  }
  const invalidChunk = chunkSchema.safeParse({ version: 1, rows: poisonTail({ ...originalChunk.rows[0], contextTags: poisonTail(null) }) });
  expect(invalidChunk.success).toBe(false);
  if (!invalidChunk.success) {
    expect(invalidChunk.error.issues).toHaveLength(1);
    expect(invalidChunk.error.issues[0].path).toEqual(['rows', 0, 'contextTags', 0]);
    expect(invalidChunk.error.message.length).toBeLessThan(1000);
  }
});
// A collection-count preflight alone is insufficient: every array here fits
// its own limit, and the entire index fits both byte and aggregate-node limits.
// Contain regressions outside Vitest, including aborts, hangs and core dumps.
it.each(['modules/chunks', 'chunks/tokenNames'])('rejects malformed within-limit %s under a 128 MiB heap', async field => {
  const { dir } = await setup();
  const file = join(dir, 'resources/manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  const index = JSON.parse(await readFile(join(dir, `resources/${manifest.snapshot}.json`), 'utf8'));
  if (field === 'modules/chunks') index.modules = Array.from({ length: 2000 }, () => ({ chunks: Array(100).fill(null) }));
  else index.modules = [{ ...index.modules[0], chunks: Array.from({ length: 2000 }, () => ({ digest: 'a'.repeat(64), rowCount: 64, tokenNames: Array(64).fill(null) })) }];
  const text = JSON.stringify(index), snapshot = sha256(text);
  expect(Buffer.byteLength(text)).toBeLessThan(8 * 1024 * 1024);
  let nodes = 0;
  function count(value: unknown): void {
    nodes++;
    if (value && typeof value === 'object') Object.values(value).forEach(count);
  }
  count(index); expect(nodes).toBeLessThan(250000);
  await writeFile(join(dir, `resources/${snapshot}.json`), text);
  await writeFile(file, JSON.stringify({ ...manifest, snapshot }));
  const script = `
    import assert from 'node:assert/strict';
    import { readResourceCoverage, readSpec } from './src/material/resource-store.ts';
    globalThis.fetch = () => { throw new Error('Runtime network forbidden'); };
    const result = await readResourceCoverage(process.env.TEST_RESOURCE_DIR);
    assert.equal(result.status, 'invalid');
    assert.match(result.message, /Invalid resource schema at modules\\.0/);
    assert.ok(result.message.length < 1000);
    await assert.rejects(readSpec(process.env.TEST_RESOURCE_DIR, { path: ${JSON.stringify(path)} }), /Invalid resource schema at modules\\.0/);
    console.log('bounded rejection');
  `;
  const result = spawnSync('/bin/sh', ['-c', 'ulimit -c 0; exec "$@"', 'bounded-node', process.execPath, '--max-old-space-size=128', '--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(), env: { ...process.env, TEST_RESOURCE_DIR: dir }, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 65536,
  });
  expect(result.error?.message).toBeUndefined();
  expect(result.signal, result.stderr.slice(-1000)).toBeNull();
  expect(result.status, result.stderr.slice(-1000)).toBe(0);
  expect(result.stdout).toBe('bounded rejection\n');
}, 25000);
it('serves the resource tool over a real SDK stdio subprocess with bounded strict-input errors', async () => {
  const { dir } = await setup();
  const script = `
    import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
    import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
    import { executeTool } from './src/server.ts';
    import { makeResourceTools } from './src/tools/resources.ts';
    globalThis.fetch = () => { throw new Error('Runtime network forbidden'); };
    const tool = makeResourceTools(process.env.TEST_RESOURCE_DIR)[0];
    const server = new McpServer({name:'resource-integration-test',version:'1'});
    server.registerTool(tool.name,{inputSchema:tool.inputSchema.shape},input=>executeTool(tool,input));
    server.server.setRequestHandler(CallToolRequestSchema, request=>executeTool(tool,request.params.arguments));
    await server.connect(new StdioServerTransport());
  `;
  const client = new Client({ name: 'resource-test-client', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', '--input-type=module', '-e', script], cwd: process.cwd(), env: { ...process.env, TEST_RESOURCE_DIR: dir } as Record<string, string>, stderr: 'pipe' });
  try {
    await client.connect(transport); expect((await client.listTools()).tools.map(t => t.name)).toEqual(['material_read_spec']);
    const response = await client.callTool({ name: 'material_read_spec', arguments: { path, moduleId: 'current', limit: 1 } });
    expect(response.isError).not.toBe(true); expect((response.structuredContent as any).rows).toHaveLength(1);
    const invalid = await client.callTool({ name: 'material_read_spec', arguments: { path, extra: true } });
    expect(invalid.isError).toBe(true); expect(JSON.stringify(invalid).length).toBeLessThan(1500);
  } finally { await client.close(); await transport.close(); }
}, 15000);
