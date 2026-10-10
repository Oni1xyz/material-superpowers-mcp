import { afterEach, expect, it, vi } from 'vitest';
import { discoverOfficialM3, fetchM3Endpoint } from '../scripts/import-official.js';
import { contentUrl, validateM3Url } from '../src/material/discovery.js';
import { assertOfficialUrl, fetchOfficial } from '../scripts/m3-resources/index.js';
const origin = 'https://m3.material.io';
afterEach(() => vi.unstubAllGlobals());
const version = '2026-09-23_06-10-05', id = 'e31df68a-59d4-41dc-8743-8c48b476d4f8.json';
const bundleUrl = origin + '/static/angular/main.7906d9e8e8cae962.js';
const articleUrl = contentUrl(version, id);
it.each([origin + '/', origin + '/sitemap.xml', bundleUrl, articleUrl])('pins every redirect hop to the planned endpoint %s', async url => {
  for (const location of ['/admin/private', '/sitemap.xml?', '/#', origin + ':443/', contentUrl('2025-01-01_00-00-00', id), contentUrl(version, '00000000-0000-0000-0000-000000000000.json'), origin + '/static/angular/main.aaaaaaaaaaaaaaaa.js']) {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 302, headers: { location: url } })).mockResolvedValueOnce(new Response('', { status: 307, headers: { location } }));
    await expect(fetchM3Endpoint(url, { fetcher })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([url, url]);
  }
});
it('keeps citation paths separate from strict transport permissions', async () => {
  expect(validateM3Url(origin + '/admin/private')).toBe(origin + '/admin/private');
  const fetcher = vi.fn();
  for (const url of [origin + '/admin/private', origin + '/?', origin + '/#', origin + '/static/angular/styles.7906d9e8e8cae962.css', contentUrl('2026-02-30_06-10-05', id)]) {
    await expect(async () => fetchM3Endpoint(url, { fetcher })).rejects.toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects a transport that silently changes final response identity', async () => {
  const response = new Response('unexpected'); Object.defineProperty(response, 'url', { value: origin + '/admin/private' });
  await expect(fetchM3Endpoint(articleUrl, { fetcher: vi.fn(async () => response) })).rejects.toThrow('URL mismatch');
});
it('discovers and fetches only the exact observed main bundle without executing it', async () => {
  const bundle = `throw new Error('must never execute'); carbonVersion:"${version}"; routes=[${JSON.stringify({ slug: 'components/buttons', exportedCarbonFileId: id })}];`;
  const payloads: Record<string, string> = { [origin + '/']: '<script src="/static/angular/main.7906d9e8e8cae962.js"></script>', [origin + '/sitemap.xml']: '<urlset><url><loc>https://m3.material.io/components/buttons</loc></url></urlset>', [bundleUrl]: bundle };
  const fetcher = vi.fn(async (url: string) => { if (!(url in payloads)) throw new Error('unplanned request'); return new Response(payloads[url]); });
  vi.stubGlobal('fetch', fetcher);
  const result = await discoverOfficialM3();
  expect(result.carbonVersion).toBe(version); expect(result.mappings[0].documentId).toBe(id);
  expect(fetcher.mock.calls.map(call => call[0]).sort()).toEqual(Object.keys(payloads).sort());
});
it.each(['/admin/private', '/components/buttons/overview', '/static/angular/main.aaaaaaaaaaaaaaaa.js', '/?', '/#', 'https://evil.test/', '/static/angular/../private'])('discovery never follows an unapproved redirect %s', async location => {
  const seen: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    seen.push(url);
    if (url === origin + '/') return new Response('', { status: 302, headers: { location } });
    return new Response('<urlset><url><loc>https://m3.material.io/</loc></url></urlset>');
  }));
  await expect(discoverOfficialM3()).rejects.toThrow();
  expect(seen.every(url => [origin + '/', origin + '/sitemap.xml'].includes(url))).toBe(true);
});
it.each(['/?', '/#', '/static/angular/main.a.js', '/static/angular/main.aaaaaaaaaaaaaaa.js', '/static/angular/main.' + 'a'.repeat(65) + '.js'])('resource importer rejects raw suffix/invalid hash %s before fetch', async path => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect(() => assertOfficialUrl(origin + path)).toThrow();
  await expect(fetchOfficial(origin + path)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('resource importer accepts observed hashed bundle and valid article/resource endpoints', () => {
  for (const path of ['/', '/static/angular/main.7906d9e8e8cae962.js', '/_dsm/content/m3/2026-09-23_06-10-05/e31df68a-59d4-41dc-8743-8c48b476d4f8.json', '/_dsm/data/dsdb-m3/2026-09-23_06-10-05/TOKEN_TABLE.1c4257f8804f9478.json']) expect(() => assertOfficialUrl(origin + path)).not.toThrow();
});
