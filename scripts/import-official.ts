import { chromium } from 'playwright';
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
    const response=await fetcher(current,{redirect:'manual',signal,headers:{'User-Agent':'Material-Superpowers-Explicit-Docs-Refresh/0.1','Accept':'text/plain,text/html,application/javascript,text/css'}});
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
    return {text:Buffer.concat(chunks).toString('utf8'),finalUrl:current,contentType:response.headers.get('content-type')??''};
  }
  throw new Error('Too many official-source redirects');
}
export async function importMarkdown(source:DocSource) {
  const result=await boundedFetch(source.url);
  if(!result.contentType.includes('text/plain')||!/^# /m.test(result.text)||/<html[\s>]/i.test(result.text))throw new Error('Expected official Markdown, not HTML or a login page');
  return {...result,method:'raw-markdown-verbatim (official Material Web implementation documentation; fallback for M3 rendered site)'};
}
export async function importRenderedArticle() {
  const browser=await chromium.launch({headless:true,timeout:15000,executablePath:process.env.MATERIAL_CHROMIUM_EXECUTABLE||undefined});
  let requests=0,totalBytes=0;
  try {
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,javaScriptEnabled:true});
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*',async route=>{
      try {
        if(++requests>30||route.request().method()!=='GET')throw new Error('Render request limit');
        const result=await boundedFetch(route.request().url(),{validate:validateRenderUrl,maxBytes:4000000,timeoutMs:10000});
        totalBytes+=Buffer.byteLength(result.text);if(totalBytes>16000000)throw new Error('Render total size limit');
        await route.fulfill({status:200,contentType:result.contentType,body:result.text});
      } catch {await route.abort('blockedbyclient');}
    });
    const page=await context.newPage();
    page.setDefaultTimeout(12000);
    await page.goto(renderedSource.url,{waitUntil:'domcontentloaded',timeout:20000});
    await page.locator('main, article, [role="main"]').first().waitFor({state:'visible'});
    const text=await page.locator('main, article, [role="main"]').first().innerText();
    if(text.length<500||!/button/i.test(text)||text.length>200000)throw new Error('No substantive rendered button article under restrictive resource policy');
    return {text,finalUrl:renderedSource.url,method:'playwright-rendered-main-innerText (restricted official Angular assets; third-party resources blocked)'};
  } finally {await browser.close();}
}
