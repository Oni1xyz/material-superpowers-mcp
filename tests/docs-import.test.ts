import { expect, it, vi } from 'vitest';
import { boundedFetch, validateRenderUrl } from '../scripts/import-official.js';
import { renderedSource, sourceCatalog } from '../src/material/sources.js';
it('rejects redirect before reaching an untrusted destination',async()=>{
  const fake=vi.fn(async()=>new Response('',{status:302,headers:{location:'https://evil.test/x'}}));
  await expect(boundedFetch(sourceCatalog[0].url,{fetcher:fake as typeof fetch})).rejects.toThrow('allowlist');
  expect(fake).toHaveBeenCalledTimes(1);
});
it('rejects redirect query and traversal before URL normalization',async()=>{
  for(const location of ['/components/../components/buttons/overview','?tracking=1','https://user@m3.material.io/components/buttons/overview']) {
    const fake=vi.fn(async()=>new Response('',{status:302,headers:{location}}));
    await expect(boundedFetch(renderedSource.url,{fetcher:fake as typeof fetch})).rejects.toThrow();
    expect(fake).toHaveBeenCalledTimes(1);
  }
});
it('bounds response bytes without trusting Content-Length',async()=>{
  const fake=vi.fn(async()=>new Response('x'.repeat(101)));
  await expect(boundedFetch(sourceCatalog[0].url,{fetcher:fake as typeof fetch,maxBytes:100})).rejects.toThrow('size');
});
it('render allows only official document and fixed asset namespace',()=>{
  expect(validateRenderUrl(renderedSource.url)).toBe(renderedSource.url);
  expect(validateRenderUrl('https://m3.material.io/static/angular/main.7906d9e8e8cae962.js')).toContain('main.');
  for(const url of ['https://m3.material.io/static/angular/../private.js','https://m3.material.io/static/angular/%2e%2e/private.js','https://evil.test/x.js','https://m3.material.io/static/angular/main.js?token=x','https://m3.material.io/static/angular/main.js']) expect(()=>validateRenderUrl(url)).toThrow();
});
