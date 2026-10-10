import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parseCarbonDocument } from '../src/material/carbon.js';
import { sha256 } from '../src/material/cache.js';
import { publishCorpus, type CorpusDocument } from '../src/material/corpus.js';
import { readResourceCoverage, readSpec } from '../src/material/resource-store.js';
import { refreshResources } from '../scripts/refresh-resources.js';

const temporaryName = '.manifest-00000000-0000-4000-8000-000000000000.tmp';
vi.mock('node:crypto', async importOriginal => ({ ...await importOriginal<typeof import('node:crypto')>(), randomUUID: () => '00000000-0000-4000-8000-000000000000' }));
const dirs: string[] = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function temp() { const dir = await mkdtemp(join(tmpdir(), 'resource-fs-policy-')); dirs.push(dir); return dir; }
const version = '2026-09-23_06-10-05', path = 'components/buttons/specs';
const system = 'designSystems/20543ce18892f7d9', component = `${system}/components/1c4257f8804f9478`;
const tokenSet = `${system}/tokenSets/aaaaaaaaaaaaaaaa`, token = `${tokenSet}/tokens/1111111111111111`;
const body = Buffer.from(JSON.stringify({ system: { name: system, dsdbVersion: '38.2.9', _isResolved: true,
  tokenSets: [{ name: tokenSet, displayName: 'Current' }], tags: [], components: [{ name: component }],
  tokens: [{ name: token, tokenName: 'synthetic.height', displayName: 'Height', tokenValueType: 'MEASUREMENT' }], values: [], contextualReferenceTrees: {},
} }));
async function setup() {
  // Freeze only Date: deterministic immutable index targets, without fake I/O timers.
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T00:00:00.000Z'));
  const dir = await temp(), documentId = 'e31df68a-59d4-41dc-8743-8c48b476d4f8.json';
  const parsed = parseCarbonDocument({ title: 'Synthetic resource policy fixture', sections: [{ name: 'Specs', contentBlocks: [{ contentChunks: [
    { contentChunkType: 'RESOURCE', pageContentChunkId: 'fixture', resourceName: component, libraryModuleType: 'TOKEN_TABLE', moduleConfigurationOverrides: { tokenSets: ['Current'] } },
  ] }] }] }, 'Specs');
  const doc: CorpusDocument = { ...parsed, path, url: `https://m3.material.io/${path}`, category: 'components', sourceKind: 'material-3', documentId, carbonVersion: version,
    sourceUrl: `https://m3.material.io/_dsm/content/m3/${version}/${documentId}`, section: 'Specs', sourceSha256: sha256('synthetic'), sha256: sha256(parsed.text), fetchedAt: new Date().toISOString(), extractionMethod: 'synthetic-test' };
  await publishCorpus(dir, [doc], { carbonVersion: version, bundleUrl: 'https://m3.material.io/static/angular/main.7906d9e8e8cae962.js', bundleSha256: 'b'.repeat(64), sitemapSha256: 'c'.repeat(64),
    discoveredAt: doc.fetchedAt, mappings: [{ path, url: doc.url, category: doc.category, status: 'mapped', documentId, section: 'Specs' }] });
  const fetcher = vi.fn(async () => ({ body, httpStatus: 200, contentType: 'application/json' }));
  const refresh = () => refreshResources({ dir, fetcher, reuse: false, sleep: async () => {} });
  const result = await refresh();
  expect((await readResourceCoverage(dir)).status).toBe('ready');
  expect((await readSpec(dir, { path })).rows).toHaveLength(1);
  const manifest = await readFile(join(dir, 'resources/manifest.json'), 'utf8');
  const index = JSON.parse(await readFile(join(dir, `resources/${result.snapshot}.json`), 'utf8'));
  fetcher.mockClear();
  return { dir, fetcher, refresh, manifest, snapshot: result.snapshot, chunk: index.modules[0].chunks[0].digest as string };
}
// Never follow test symlinks. Compare every entry and byte in both the corpus and
// outside target, not just the manifest: rejection must not leave escaped writes.
async function tree(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(relative: string) {
    for (const name of (await readdir(join(dir, relative))).sort()) {
      const file = relative ? `${relative}/${name}` : name, st = await lstat(join(dir, file));
      if (st.isSymbolicLink()) result[file] = `link:${await readlink(join(dir, file))}`;
      else if (st.isDirectory()) { result[file] = 'directory'; await walk(file); }
      else if (st.isFile()) result[file] = `file:${(await readFile(join(dir, file))).toString('base64')}`;
      else result[file] = 'special';
    }
  }
  await walk(''); return result;
}

it('preserves the old valid manifest on a zero-network refresh through resources -> saved-resources', async () => {
  const { dir, manifest } = await setup(), saved = join(dir, 'saved-resources');
  await rename(join(dir, 'resources'), saved); await symlink(saved, join(dir, 'resources'));
  const before = await tree(dir), fetcher = vi.fn(async () => { throw new Error('network forbidden'); });
  await expect(refreshResources({ dir, reuse: false, limits: { requests: 0 }, fetcher })).rejects.toThrow();
  // The old implementation rejected only on readback, after replacing this manifest.
  expect(await readFile(join(saved, 'manifest.json'), 'utf8')).toBe(manifest);
  expect(await tree(dir)).toEqual(before); expect(fetcher).not.toHaveBeenCalled();
  await rm(join(dir, 'resources')); await rename(saved, join(dir, 'resources'));
  expect((await readResourceCoverage(dir)).status).toBe('ready');
});

it.each(['resources', 'resources/raw'])('rejects inside-root %s symlinks and preserves a previously valid manifest', async relative => {
  const { dir, refresh, manifest, fetcher } = await setup();
  const saved = join(dir, relative === 'resources' ? 'saved-resources' : 'resources/saved-raw');
  await rename(join(dir, relative), saved); await symlink(saved, join(dir, relative));
  const before = await tree(dir);
  await expect(refresh()).rejects.toThrow(/symlink|confinement/);
  expect(fetcher).not.toHaveBeenCalled(); expect(await tree(dir)).toEqual(before);
  expect(await readFile(join(relative === 'resources' ? saved : join(dir, 'resources'), 'manifest.json'), 'utf8')).toBe(manifest);
  await rm(join(dir, relative)); await rename(saved, join(dir, relative));
  expect((await readResourceCoverage(dir)).status).toBe('ready');
});

it.each(['resources', 'resources/raw'].flatMap(relative => ['outside', 'dangling', 'file', 'fifo'].map(kind => ({ relative, kind }))))('rejects $kind at $relative before any write or fetch', async ({ relative, kind }) => {
  const { dir, refresh, manifest, fetcher } = await setup(), outside = await temp();
  const saved = join(dir, 'saved-directory'); await rename(join(dir, relative), saved);
  if (kind === 'outside' || kind === 'dangling') await symlink(kind === 'outside' ? outside : join(outside, 'missing'), join(dir, relative));
  else if (kind === 'file') await writeFile(join(dir, relative), 'not a directory');
  else execFileSync('mkfifo', [join(dir, relative)]);
  const before = await tree(dir), outsideBefore = await tree(outside);
  await expect(refresh()).rejects.toThrow(/symlink|confinement|directory/);
  expect(fetcher).not.toHaveBeenCalled(); expect(await tree(dir)).toEqual(before); expect(await tree(outside)).toEqual(outsideBefore);
  expect(await readFile(join(relative === 'resources' ? saved : join(dir, 'resources'), 'manifest.json'), 'utf8')).toBe(manifest);
  await rm(join(dir, relative)); await rename(saved, join(dir, relative));
  expect((await readResourceCoverage(dir)).status).toBe('ready');
});

const targets = ['manifest', 'temporary', 'gitignore', 'raw', 'chunk', 'snapshot'] as const;
it.each(targets.flatMap(target => ['inside', 'outside', 'dangling', 'directory', 'fifo'].map(kind => ({ target, kind }))))('rejects $kind $target publication targets without replacing the valid manifest', async ({ target, kind }) => {
  const { dir, refresh, manifest, snapshot, chunk, fetcher } = await setup(), outside = await temp();
  const relative = target === 'manifest' ? 'resources/manifest.json' : target === 'temporary' ? `resources/${temporaryName}` : target === 'gitignore' ? 'resources/.gitignore'
    : target === 'raw' ? `resources/raw/${sha256(body.toString())}.json` : `resources/${target === 'chunk' ? chunk : snapshot}.json`;
  const file = join(dir, relative), saved = join(dir, 'saved-target');
  if (target !== 'temporary') await rename(file, saved);
  else await writeFile(saved, 'temporary sentinel');
  const external = join(outside, 'target'); await writeFile(external, 'outside sentinel');
  if (kind === 'directory') await mkdir(file);
  else if (kind === 'fifo') execFileSync('mkfifo', [file]);
  else await symlink(kind === 'inside' ? saved : kind === 'outside' ? external : join(outside, 'missing'), file);
  const before = await tree(dir), outsideBefore = await tree(outside);
  await expect(refresh()).rejects.toThrow(/symlink|confinement|type/);
  expect(await tree(dir)).toEqual(before); expect(await tree(outside)).toEqual(outsideBefore);
  if (['manifest', 'temporary', 'gitignore'].includes(target)) expect(fetcher).not.toHaveBeenCalled();
  expect(await readFile(target === 'manifest' ? saved : join(dir, 'resources/manifest.json'), 'utf8')).toBe(manifest);
  await rm(file, { recursive: kind === 'directory' });
  if (target !== 'temporary') await rename(saved, file);
  expect((await readResourceCoverage(dir)).status).toBe('ready');
});

it('rechecks manifest publication after beforePublish and does not replace a new symlink', async () => {
  const { dir, manifest } = await setup(), outside = await temp(), external = join(outside, 'manifest.json');
  await writeFile(external, 'outside sentinel');
  await expect(refreshResources({ dir, limits: { requests: 0 }, beforePublish: async () => {
    await rename(join(dir, 'resources/manifest.json'), join(dir, 'saved-manifest'));
    await symlink(external, join(dir, 'resources/manifest.json'));
  } })).rejects.toThrow(/symlink|confinement/);
  expect((await lstat(join(dir, 'resources/manifest.json'))).isSymbolicLink()).toBe(true);
  expect(await readFile(external, 'utf8')).toBe('outside sentinel');
  expect(await readFile(join(dir, 'saved-manifest'), 'utf8')).toBe(manifest);
  expect((await readdir(join(dir, 'resources'))).some(name => name.endsWith('.tmp'))).toBe(false);
});

it('does not delete a pre-existing regular temporary-file collision', async () => {
  const { dir, refresh, manifest } = await setup();
  await writeFile(join(dir, 'resources', temporaryName), 'belongs to another writer');
  const before = await tree(dir);
  await expect(refresh()).rejects.toThrow(/EEXIST/);
  expect(await tree(dir)).toEqual(before);
  expect(await readFile(join(dir, 'resources/manifest.json'), 'utf8')).toBe(manifest);
});

it('does not publish or clean up through a directory replaced before publication', async () => {
  const { dir, manifest } = await setup(), outside = await temp(), saved = join(dir, 'saved-resources');
  await writeFile(join(outside, temporaryName), 'outside cleanup sentinel');
  await writeFile(join(outside, 'manifest.json'), 'outside manifest sentinel');
  const before = await tree(outside);
  await expect(refreshResources({ dir, limits: { requests: 0 }, beforePublish: async () => {
    await rename(join(dir, 'resources'), saved); await symlink(outside, join(dir, 'resources'));
  } })).rejects.toThrow(/symlink|confinement/);
  expect(await tree(outside)).toEqual(before);
  expect(await readFile(join(saved, 'manifest.json'), 'utf8')).toBe(manifest);
});

it('accepts the operator-selected root symlink and verifies publication and raw reuse', async () => {
  const { dir, snapshot } = await setup(), parent = await temp(), root = join(parent, 'selected-cache');
  await symlink(dir, root);
  const fetcher = vi.fn(async () => { throw new Error('network forbidden'); });
  const result = await refreshResources({ dir: root, fetcher });
  expect(result.counts.reusedEndpoints).toBe(1); expect(fetcher).not.toHaveBeenCalled();
  expect(result.snapshot).not.toBe(snapshot); expect((await readResourceCoverage(root)).status).toBe('ready');
  expect((await readSpec(root, { path })).rows).toHaveLength(1);
});
