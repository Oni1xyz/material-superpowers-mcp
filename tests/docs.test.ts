import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSourceUrl, sourceCatalog, validateDocPath } from '../src/material/sources.js';
import { readCache, refreshCache, sha256 } from '../src/material/cache.js';
import { makeDocsTools } from '../src/tools/docs.js';

const dirs: string[] = [];
async function temp() { const p = await mkdtemp(join(tmpdir(), 'material-docs-')); dirs.push(p); return p; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });

describe('official source trust boundary', () => {
  it('accepts only exactly catalogued official URLs', () => {
    for (const source of sourceCatalog) expect(validateSourceUrl(source.url)).toBe(source.url);
  });
  it.each([
    'https://raw.githubusercontent.com.evil.test/material-components/material-web/main/docs/components/button.md',
    'http://m3.material.io/components/buttons/overview',
    'https://x:y@m3.material.io/components/buttons/overview',
    'https://m3.material.io/components/buttons/overview?x=1',
    'https://m3.material.io/components/buttons/overview#x',
    'https://m3.material.io/components/../components/buttons/overview',
    'https://m3.material.io/components/%2e%2e/components/buttons/overview',
    'https://m3.material.io:443/components/buttons/overview',
    'https://m3.material.io\\@evil.test/components/buttons/overview',
    'https://raw.githubusercontent.com/material-components/material-web/main/README.md',
  ])('rejects bypass %s', value => expect(() => validateSourceUrl(value)).toThrow());
  it.each(['../buttons', '/buttons', 'buttons?x=1', 'buttons#x', '%62uttons', 'button\\x', ''])('rejects path %s', value => expect(() => validateDocPath(value)).toThrow());
});

describe('cache and bounded grounded documentation', () => {
  it('missing cache gives an actionable error, never authored excerpts', async () => {
    const dir = await temp();
    await expect(readCache(dir)).rejects.toThrow('npm run refresh-cache');
    const tools = makeDocsTools(dir);
    await expect(tools[0].run({query:'button'})).rejects.toThrow('npm run refresh-cache');
  });
  it('stores provenance, searches text, extracts sections, and cites context', async () => {
    const dir = await temp();
    // Deliberately synthetic unit-test fixture; never bundled as official content.
    await refreshCache(dir, async source => ({ text: '# Fixture\n\n## Usage\n\nButton action fixture.\n\n## Accessibility\n\nAccessible name fixture.\n', method: 'test-fixture', finalUrl: source.url }));
    const cache = await readCache(dir);
    expect(cache.documents.length).toBe(sourceCatalog.length);
    expect(cache.documents[0].sha256).toBe(sha256(cache.documents[0].text));
    expect(cache.documents[0].fetchedAt).toMatch(/^\d{4}-/);
    const tools = makeDocsTools(dir);
    const search: any = await tools[0].run({query:'accessible', limit:1});
    expect(search.results).toHaveLength(1);
    expect(search.results[0].citation.url).toMatch(/^https:/);
    const section: any = await tools[1].run({path:sourceCatalog[0].path, heading:'Usage', maxCharacters:1000});
    expect(section.text).toContain('Button action fixture.');
    expect(section.text).not.toContain('Accessible name fixture.');
    const context: any = await tools[2].run({task:'button accessibility', mode:'design', maxSources:2, maxCharacters:100});
    expect(context.sources.length).toBeLessThanOrEqual(2);
    expect(context.sources.reduce((n: number, s: any) => n+s.text.length,0)).toBeLessThanOrEqual(100);
    expect(context.sources[0].citation.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(tools[1].run({path:sourceCatalog[0].path, heading:'nonexistent'})).rejects.toThrow('Heading not found');
  });
  it('failed refresh preserves the previous complete cache', async () => {
    const dir = await temp();
    const fetcher = async (source: any) => ({text:'# Test fixture\nA sufficiently long test fixture body.', method:'test-fixture', finalUrl:source.url});
    await refreshCache(dir, fetcher);
    const before = await readFile(join(dir,'documents.json'),'utf8');
    let count=0;
    await expect(refreshCache(dir, async source => { if (++count===2) throw new Error('network failed'); return fetcher(source); })).rejects.toThrow('network failed');
    expect(await readFile(join(dir,'documents.json'),'utf8')).toBe(before);
  });
  it('rejects untrusted final URL even when supplied by an importer', async () => {
    await expect(refreshCache(await temp(), async () => ({text:'fixture',method:'test-fixture',finalUrl:'https://evil.test/'}))).rejects.toThrow();
  });
  it('validates bounded inputs', () => {
    const [search, read, context] = makeDocsTools('unused');
    expect(search.inputSchema.safeParse({query:'x',limit:101}).success).toBe(false);
    expect(read.inputSchema.safeParse({path:'../etc/passwd'}).success).toBe(false);
    expect(context.inputSchema.safeParse({task:'x',mode:'bad'}).success).toBe(false);
  });
});
