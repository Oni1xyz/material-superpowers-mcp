// Curated README media, not raw QA artifacts. Run from the repository root.
// Requires existing Playwright dev dependency, installed Chrome, and ffmpeg.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const site=path.join(root,'examples/fieldwork');
const output=path.join(root,'docs/media');
const work=path.join(root,'artifacts/readme-media');
await mkdir(work,{recursive:true});
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const file=path.resolve(site,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));if(!file.startsWith(site+path.sep))throw Error('outside fixture');res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME??'/usr/bin/google-chrome',headless:true});
const errors=[],external=[];
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const data=async file=>'data:image/png;base64,'+(await readFile(file)).toString('base64');
try {
 const context=await browser.newContext({viewport:{width:1280,height:850},serviceWorkers:'block',reducedMotion:'reduce'});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
 await context.routeWebSocket('**/*',socket=>{external.push(socket.url());socket.close();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin,{waitUntil:'networkidle'});
 const capture=async name=>{const file=path.join(work,name+'.png');await page.screenshot({path:file});return data(file);};
 assert.equal(await page.locator('.route-card:visible').count(),3);
 const light=await capture('light');
 const colors=await page.evaluate(()=>['primary','on-primary','primary-container','on-primary-container'].map(role=>({role,value:getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-'+role).trim()})));
 assert.ok(colors.every(c=>/^#[a-f0-9]{6}$/i.test(c.value)));
 await page.locator('[data-filter="mountain"]').click();
 assert.equal(await page.locator('.route-card:visible').count(),1);
 const filtered=await capture('filtered');
 await page.locator('[data-filter="all"]').click();await page.locator('#theme-toggle').click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 const dark=await capture('dark');
 await page.locator('[data-eval="open-dialog"]').click();
 assert.equal(await page.locator('#dialog-title').textContent(),'Bracken Ridge');
 const dialog=await capture('dialog');
 await page.locator('#dialog-save').click();await page.getByRole('checkbox',{name:'An extra layer'}).check();
 assert.equal(await page.locator('.saved-route').count(),2);
 assert.equal(await page.locator('#packing-count').textContent(),'3 / 5');
 const saved=await capture('saved');
 await page.evaluate(()=>localStorage.removeItem('fieldwork-demo-v1'));await page.reload();await page.locator('#theme-toggle').click();await page.setViewportSize({width:390,height:844});
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const mobile=await capture('mobile');
 await context.close();
 const studio=await browser.newPage({viewport:{width:1680,height:1160},deviceScaleFactor:1});
 const base=`*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Arial,sans-serif;color:#19372b;background:#eaece2}img{display:block} .eyebrow{font-size:15px;font-weight:700;letter-spacing:3px} .tiny{font-size:15px;color:#45594d}`;
 const html=`<!doctype html><html><head><meta charset="utf-8"><style>${base}body{padding:46px 48px;background:radial-gradient(ellipse at 80% 5%,#dce7b8,transparent 48%),#eaece2}.top{display:flex;justify-content:space-between;align-items:center}h1{font-family:Georgia,serif;font-weight:400;font-size:65px;line-height:1.06;letter-spacing:-2px;margin:26px 0 16px}.caption{font-size:21px;margin:0}.desktop{position:absolute;left:48px;top:282px;width:1220px;border-radius:15px;box-shadow:0 20px 60px #19372b26;border:1px solid #bbc5b4}.mobile{position:absolute;left:1330px;top:282px;width:300px;border:7px solid #17372b;border-radius:28px;box-shadow:0 20px 55px #19372b30}.label{position:absolute;top:250px;font-size:14px;font-weight:700;letter-spacing:2px}.tokens{position:absolute;left:1330px;top:978px;width:300px;display:flex;gap:8px}.swatch{height:45px;flex:1;border:1px solid #63726044;border-radius:12px}.foot{position:absolute;left:48px;bottom:23px;right:48px;display:flex;justify-content:space-between}</style></head><body><div class="top"><span class="eyebrow">MATERIAL SUPERPOWERS / MCP</span><span class="tiny">REAL TOOLS. AGENT-AUTHORED UI.</span></div><h1>One brief. A coherent interface.</h1><p class="caption">FIELDWORK — an expedition planner with a design system of its own.</p><span class="label" style="left:48px">DESKTOP / LIGHT</span><span class="label" style="left:1330px">MOBILE / DARK</span><img class="desktop" src="${light}" alt="Light desktop interface"><img class="mobile" src="${mobile}" alt="Dark mobile interface"><div class="tokens">${colors.map(c=>`<span class="swatch" style="background:${esc(c.value)}" title="${esc(c.role)}"></span>`).join('')}</div><span class="tiny" style="position:absolute;left:1330px;top:1037px">Actual generated color roles</span><div class="foot tiny"><span>Guidance → tokens → implementation → review</span><span>Working example • Fictional demo data • Not an official Google product</span></div></body></html>`;
 await writeFile(path.join(work,'hero.html'),html);await studio.setContent(html);await studio.screenshot({path:path.join(output,'fieldwork-hero.png')});
 const style=await readFile(path.join(site,'style.css'),'utf8');assert.ok(style.includes('var(--map-control-surface)'));
 const notes=await readFile(path.join(site,'BUILD-NOTES.md'),'utf8');assert.ok(notes.includes('six informational findings'));
 // Review card summarizes the historical, verified finding documented in BUILD-NOTES.
 // It is not a fake terminal or a claim of live tool execution during this capture.
 const review=`<div style="height:850px;padding:80px 90px;background:#142c22;color:#eef2df"><p class="eyebrow" style="color:#dce9a2">ACTUAL MCP REVIEW / INFORMATIONAL FINDING</p><h2 style="font:52px Georgia;margin:45px 0 22px">Same appearance.<br>Reusable color roles.</h2><p style="font-size:23px;color:#c7d4c2">Six literal-color findings prompted a semantic-token refactor.</p><div style="display:flex;gap:28px;margin:55px 0"><div style="flex:1;background:#243e31;padding:28px;border-radius:20px"><p>BEFORE / .map-pin</p><pre style="font-size:23px;line-height:1.8">background: #fffef0;</pre></div><div style="flex:1;background:#dce9a2;color:#19372b;padding:28px;border-radius:20px"><p>AFTER / .map-pin</p><pre style="font-size:22px;line-height:1.8">background: var(<br>  --map-control-surface<br>);</pre></div></div><p style="font-size:22px">Review rerun: zero findings from the static rules.</p><p style="font-size:19px;color:#c7d4c2">A maintainability correction—not proof of accessibility or design quality.</p></div>`;
 const frames=[
  {image:light,title:'01 / The brief',copy:'An expedition planner. Forest, lime and warm paper. Built by an agent.'},
  {image:filtered,title:'02 / Ground the interaction',copy:'Chips guidance informed keyboard semantics and selection. Filter: Mountains.'},
  {image:dark,title:'03 / Apply the tokens',copy:'Seed #245641 → HCT light/dark roles. The agent adds its own brand treatment.'},
  {image:dialog,title:'04 / Make it work',copy:'Real trip details, keyboard focus, saving and Escape dismissal.'},
  {image:saved,title:'05 / Keep the state',copy:'A second route saved. Packing progress updated. Stored in this browser only.'},
  {body:review,title:'06 / Review and correct',copy:'Historical source-review result, summarized from the documented build evidence.'},
  {image:light,title:'07 / Check in the browser',copy:'119 app assertions passed. Manual review still outstanding. See build notes.'}
 ];
 await studio.setViewportSize({width:1280,height:960});
 for(const [i,frame] of frames.entries()){
  await studio.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${base}body{background:#f5f5ed}.screen{height:850px;width:1280px}.bar{height:110px;padding:20px 32px;border-top:1px solid #c4ccbc;display:flex;align-items:center;gap:24px}.bar strong{font-size:21px;white-space:nowrap}.bar p{font-size:18px;line-height:1.4;margin:0}.tag{font-size:11px;letter-spacing:1.5px;margin-top:9px;color:#586653}</style></head><body>${frame.body??`<img class="screen" src="${frame.image}" alt="Captured browser state">`}<div class="bar"><strong>${esc(frame.title)}</strong><div><p>${esc(frame.copy)}</p><div class="tag">EDITED BROWSER CAPTURES + DOCUMENTED REVIEW • NOT A REAL-TIME BUILD RECORDING</div></div></div></body></html>`);
  await studio.screenshot({path:path.join(work,`frame-${String(i).padStart(2,'0')}.png`)});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','1/3','-i',path.join(work,'frame-%02d.png'),'-vf','scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a','-loop','0',path.join(output,'fieldwork-demo.gif')]);
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','1/3','-i',path.join(work,'frame-%02d.png'),'-c:v','libx264','-r','24','-pix_fmt','yuv420p','-crf','23','-movflags','+faststart',path.join(output,'fieldwork-demo.mp4')]);
 await writeFile(path.join(work,'capture-report.json'),JSON.stringify({status:'passed',actualBrowserStates:6,editedFrames:frames.length,errors,external,colors,outputs:['fieldwork-hero.png','fieldwork-demo.gif','fieldwork-demo.mp4']},null,2));
 console.log('Captured hero and seven edited walkthrough frames; state assertions passed; no external requests/page errors.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
