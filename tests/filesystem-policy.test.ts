import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { boundedLocalRead, publishCorpus, readCorpusDocument, type CorpusDocument } from '../src/material/corpus.js';
import { readGraphFile } from '../src/graph/store.js';
import { readCache, refreshCache, sha256 } from '../src/material/cache.js';
import { sourceCatalog } from '../src/material/sources.js';
import { makeDocsTools } from '../src/tools/docs.js';
import { parseCarbonDocument } from '../src/material/carbon.js';

const dirs: string[] = [];
async function temp() { const dir = await mkdtemp(join(tmpdir(), 'm3-fs-policy-')); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const version = '2026-09-23_06-10-05', documentId = 'e31df68a-59d4-41dc-8743-8c48b476d4f8.json';
const info = { carbonVersion: version, bundleUrl: 'https://m3.material.io/static/angular/main.7906d9e8e8cae962.js', bundleSha256: 'b'.repeat(64), sitemapSha256: 'c'.repeat(64), discoveredAt: '2026-10-10T00:00:00.000Z', mappings: [{ path: 'components/buttons/overview', url: 'https://m3.material.io/components/buttons/overview', category: 'components' as const, status: 'mapped' as const, documentId, section: 'Overview' }] };
function fixture(): CorpusDocument {
  const parsed = parseCarbonDocument({ title: 'Fixture', sections: [{ name: 'Overview', contentBlocks: [{ contentChunks: [{ contentChunkType: 'TEXT', htmlValue: '<p>Synthetic fixture button action.</p>' }] }] }] }, 'Overview');
  return { ...parsed, ...info.mappings[0], sourceKind: 'material-3', carbonVersion: version, sourceUrl: `https://m3.material.io/_dsm/content/m3/${version}/${documentId}`, sourceSha256: 'a'.repeat(64), sha256: sha256(parsed.text), fetchedAt: info.discoveredAt, extractionMethod: 'test-fixture' };
}

it.each(['corpus', 'graph', 'legacy'])('rejects a FIFO without blocking a %s reader (isolated child)', async kind => {
  const dir = await temp();
  execFileSync('mkfifo', [join(dir, 'documents.json')]);
  const imports = `import {boundedLocalRead} from './src/material/corpus.ts'; import {readGraphFile} from './src/graph/store.ts'; import {readCache} from './src/material/cache.ts';`;
  const call = kind === 'corpus' ? 'boundedLocalRead(dir,"documents.json",100)' : kind === 'graph' ? 'readGraphFile(dir,"documents.json",100)' : 'readCache(dir)';
  const script = `${imports} const dir=${JSON.stringify(dir)}; try {await ${call}; process.exitCode=2;} catch {console.log('rejected');}`;
  const child = spawnSync('bash', ['-c', 'ulimit -c 0; exec "$@"', 'fifo-test', process.execPath, '--import', 'tsx', '--input-type=module', '-e', script], { cwd: resolve('.'), encoding: 'utf8', timeout: 4000, killSignal: 'SIGKILL', maxBuffer: 16384 });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout.trim()).toBe('rejected');
}, 6000);

it('legacy read_doc rejects a valid outside-cache fixture behind a symlink', async () => {
  const dir = await temp(), outside = await temp();
  await refreshCache(outside, async source => ({ text: '# Synthetic fixture\nA valid outside-cache fixture for testing.', method: 'test', finalUrl: source.url }));
  await symlink(join(outside, 'documents.json'), join(dir, 'documents.json'));
  await expect(readCache(dir)).rejects.toThrow();
  await expect(makeDocsTools(dir)[1].run({ path: sourceCatalog[0].path, maxCharacters: 1000 })).rejects.toThrow();
});

it.each(['corpus', 'graph'])('rejects inside-root file and parent symlinks for %s', async kind => {
  const dir = await temp(); await mkdir(join(dir, 'real')); await writeFile(join(dir, 'real/file'), 'fixture');
  await symlink(join(dir, 'real/file'), join(dir, 'link')); await symlink(join(dir, 'real'), join(dir, 'parent'));
  const read = kind === 'corpus' ? boundedLocalRead : readGraphFile;
  await expect(read(dir, 'link', 100)).rejects.toThrow();
  await expect(read(dir, 'parent/file', 100)).rejects.toThrow();
});

it('rejects a symlinked snapshots tree before writes and preserves the old manifest', async () => {
  const dir = await temp(), outside = await temp();
  await publishCorpus(dir, [fixture()], info);
  const before = await readFile(join(dir, 'manifest.json'), 'utf8');
  await rename(join(dir, 'snapshots'), join(dir, 'saved-snapshots'));
  await symlink(outside, join(dir, 'snapshots'));
  await expect(publishCorpus(dir, [{ ...fixture(), title: 'Changed fixture' }], info)).rejects.toThrow();
  expect(await readFile(join(dir, 'manifest.json'), 'utf8')).toBe(before);
  expect(await readdir(outside)).toEqual([]);
});

it('rejects a symlinked immutable snapshot target without publishing or escaped writes', async () => {
  const dir = await temp(), outside = await temp();
  const corpus = await publishCorpus(dir, [fixture()], info);
  const before = await readFile(join(dir, 'manifest.json'), 'utf8');
  await rename(join(dir, 'snapshots', corpus.snapshot), join(dir, 'saved-snapshot'));
  await symlink(outside, join(dir, 'snapshots', corpus.snapshot));
  await expect(publishCorpus(dir, [fixture()], info)).rejects.toThrow(/symlink/);
  expect(await readFile(join(dir, 'manifest.json'), 'utf8')).toBe(before);
  expect(await readdir(outside)).toEqual([]);
  expect(await readdir(join(dir, 'snapshots'))).toEqual([corpus.snapshot]);
});

it.each(['corpus', 'graph'])('bounds %s reads using regular descriptors', async kind => {
  const dir = await temp(), read = kind === 'corpus' ? boundedLocalRead : readGraphFile;
  await writeFile(join(dir, 'data'), '12345');
  expect(await read(dir, 'data', 5)).toBe('12345');
  await expect(read(dir, 'data', 4)).rejects.toThrow(/size/);
  await mkdir(join(dir, 'directory')); await expect(read(dir, 'directory', 100)).rejects.toThrow(/type/);
  for (const path of ['../data', '/data', 'directory/../data', 'directory//data']) await expect(read(dir, path, 100)).rejects.toThrow(/confinement/);
});

it.each(['imports', 'version', 'bundle', 'payload'])('refresh CLI rejects a symlink at resume %s before any write/download', async level => {
  const dir = await temp(), outside = await temp();
  const origin = 'https://m3.material.io';
  const bundle = `carbonVersion:"${version}"; routes=[${JSON.stringify({ slug: 'components/buttons/overview', exportedCarbonFileId: documentId })}];`;
  const hash = sha256(bundle), relative = `imports/${version}/${hash}`;
  const target = level === 'imports' ? 'imports' : level === 'version' ? `imports/${version}` : level === 'bundle' ? relative : `${relative}/${documentId}`;
  const parts = target.split('/'); parts.pop(); if (parts.length) await mkdir(join(dir, ...parts), { recursive: true });
  await symlink(outside, join(dir, target));
  await writeFile(join(dir, 'manifest.json'), 'prior manifest sentinel');
  const payloads = { [origin + '/']: '<script src="/static/angular/main.7906d9e8e8cae962.js"></script>', [origin + '/sitemap.xml']: '<urlset><url><loc>https://m3.material.io/components/buttons/overview</loc></url></urlset>', [info.bundleUrl]: bundle };
  const script = `const payloads=${JSON.stringify(payloads)};globalThis.fetch=async url=>{if(!(url in payloads))throw new Error('UNPLANNED_FETCH');return new Response(payloads[url]);};await import('./scripts/refresh-cache.ts');`;
  const child = spawnSync('bash', ['-c', 'ulimit -c 0; exec "$@"', 'resume-test', process.execPath, '--import', 'tsx', '--input-type=module', '-e', script], { cwd: resolve('.'), env: { ...process.env, MATERIAL_CACHE_DIR: dir }, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 16384 });
  expect(child.error, child.stderr).toBeUndefined(); expect(child.status).toBe(1);
  expect(child.stderr).toMatch(/symlink/); expect(child.stderr).not.toContain('UNPLANNED_FETCH');
  expect(await readFile(join(dir, 'manifest.json'), 'utf8')).toBe('prior manifest sentinel');
  expect(await readdir(outside)).toEqual([]);
}, 7000);

it.each(['fifo', 'symlink', 'other-file'])('descriptor read rejects a leaf swapped to %s after lstat', async kind => {
  const dir = await temp(); await writeFile(join(dir, 'data'), 'original'); await writeFile(join(dir, 'other'), 'replacement');
  const script = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {execFileSync} from 'node:child_process';
    const original=fs.open;let swapped=false;const file=${JSON.stringify(join(dir, 'data'))};
    fs.open=async (...args)=>{if(args[0]===file&&!swapped){swapped=true;await fs.rename(file,file+'.old');
      ${kind === 'fifo' ? "execFileSync('mkfifo',[file]);" : kind === 'symlink' ? `await fs.symlink(${JSON.stringify(join(dir, 'other'))},file);` : `await fs.rename(${JSON.stringify(join(dir, 'other'))},file);`}}
      return original(...args);};syncBuiltinESMExports();
    const {readCacheFile}=await import('./src/material/files.ts');
    try {await readCacheFile(${JSON.stringify(dir)},'data',100);process.exitCode=2;}catch{console.log(swapped?'swapped-and-rejected':'not-swapped');}`;
  const child = spawnSync('bash', ['-c', 'ulimit -c 0; exec "$@"', 'race-test', process.execPath, '--import', 'tsx', '--input-type=module', '-e', script], { cwd: resolve('.'), encoding: 'utf8', timeout: 4000, killSignal: 'SIGKILL', maxBuffer: 16384 });
  expect(child.error, child.stderr).toBeUndefined(); expect(child.status, child.stderr).toBe(0); expect(child.stdout.trim()).toBe('swapped-and-rejected');
}, 6000);

it('supports an operator-chosen symlink root while rejecting descendant escapes', async () => {
  const dir = await temp(), target = await temp(), root = join(dir, 'chosen-root'); await symlink(target, root);
  const corpus = await publishCorpus(root, [fixture()], info);
  expect((await readCorpusDocument(corpus, fixture().path)).text).toContain('Synthetic fixture');
});
