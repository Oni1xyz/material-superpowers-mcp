import { M3_ORIGIN, discoverMainScript, discoverBundle, parseSitemap, mapCanonicalRoutes, exactM3Endpoint } from '../src/material/discovery.js';
import { sha256 } from '../src/material/cache.js';
import { renderedSource, validateSourceUrl, type DocSource } from '../src/material/sources.js';
/** Only hashed Angular application assets on the exact official host are eligible.
 * Images, fonts, telemetry, third-party scripts, XHR APIs, downloads and service workers are blocked.
 */
export function validateRenderUrl(value:string):string {
  if(value===renderedSource.url)return validateSourceUrl(value);
  if(!/^https:\/\/m3\.material\.io\/static\/angular\/[a-zA-Z0-9_-]+\.[a-f0-9]{16,64}\.(?:js|css)$/.test(value))throw new Error('Render URL is not in the fixed asset allowlist');
  return value;
}
interface FetchOptions {fetcher?:typeof fetch;maxBytes?:number;validate?:(url:string)=>string;timeoutMs?:number;}
export async function boundedFetch(url:string,options:FetchOptions={}) {
  const validate=options.validate??validateSourceUrl;
  const fetcher=options.fetcher??fetch;
  const signal=AbortSignal.timeout(options.timeoutMs??15000);
  let current=validate(url);
  for(let redirect=0;redirect<=3;redirect++) {
    const response=await fetcher(current,{redirect:'manual',signal,headers:{'User-Agent':'Material-Superpowers-Explicit-Docs-Refresh/0.1','Accept':'application/json,application/xml,text/plain,text/html,application/javascript,text/css'}});
    if(response.url && response.url!==current) {await response.body?.cancel();throw new Error('Official response URL mismatch');}
    if([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location');await response.body?.cancel();
      if(!location)throw new Error('Redirect without location');
      // Reject raw encodings, credentials, query strings and dot segments before normalization.
      if(/[\\%?#@\s]/.test(location)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(location))throw new Error('Unsafe redirect');
      const next=location.startsWith('/')&&!location.startsWith('//')?new URL(current).origin+location:location;
      current=validate(next);continue;
    }
    if(!response.ok) {await response.body?.cancel();throw new Error(`Official source returned HTTP ${response.status}`);}
    const max=options.maxBytes??1000000;
    if(Number(response.headers.get('content-length'))>max) {await response.body?.cancel();throw new Error('Source exceeds size limit');}
    const reader=response.body?.getReader();if(!reader)throw new Error('Empty source body');
    const chunks:Uint8Array[]=[];let size=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw new Error('Source exceeds size limit');chunks.push(value);}} finally {await reader.cancel();}
    return {text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks)),finalUrl:current,contentType:response.headers.get('content-type')??''};
  }
  throw new Error('Too many official-source redirects');
}
export function fetchM3Endpoint(url:string, options:Omit<FetchOptions,'validate'>={}) {
  return boundedFetch(url,{...options,validate:exactM3Endpoint(url)});
}
export async function discoverOfficialM3() {
  const [home,sitemap]=await Promise.all([
    fetchM3Endpoint(M3_ORIGIN+'/',{maxBytes:2_000_000}),
    fetchM3Endpoint(M3_ORIGIN+'/sitemap.xml',{maxBytes:2_000_000}),
  ]);
  const bundleUrl=discoverMainScript(home.text);
  const bundle=await fetchM3Endpoint(bundleUrl,{maxBytes:16_000_000,timeoutMs:30000});
  const discovered=discoverBundle(bundle.text),entries=parseSitemap(sitemap.text);
  return {...discovered,entries,mappings:mapCanonicalRoutes(entries,discovered.routes),bundleUrl,bundleSha256:sha256(bundle.text),sitemapSha256:sha256(sitemap.text),discoveredAt:new Date().toISOString()};
}
export async function importMarkdown(source:DocSource) {
  const result=await boundedFetch(source.url);
  if(!result.contentType.includes('text/plain')||!/^# /m.test(result.text)||/<html[\s>]/i.test(result.text))throw new Error('Expected official Markdown, not HTML or a login page');
  return {...result,method:'raw-markdown-verbatim (official Material Web implementation documentation; legacy fallback)'};
}
