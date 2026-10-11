// Run from the repository: node examples/fieldwork/check.mjs
// Uses existing dev dependencies. Does not install software or contact the internet.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const require=createRequire(path.join(root,'package.json'));
const {chromium}=require('playwright');
const AxeBuilder=require('@axe-core/playwright').default;
const output=path.join(root,'artifacts/readme-showcase');
await mkdir(output,{recursive:true});
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.md':'text/plain'};
const server=createServer(async(req,res)=>{
 try {const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(here,'.'+(relative==='/'?'/index.html':relative));if(!file.startsWith(here+path.sep))throw Error('outside fixture');const body=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({executablePath:process.env.CHROME??'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const reports=[];
try {
 for(const viewport of [{name:'desktop',width:1280,height:850},{name:'mobile',width:390,height:844}]) for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},serviceWorkers:'block',colorScheme:theme});
  const page=await context.newPage();const external=[];const errors=[];const requests=[];
  await context.route('**/*',route=>{const request=route.request().url();requests.push(new URL(request).pathname);if(new URL(request).origin!==new URL(url).origin){external.push(request);return route.abort();}return route.continue();});
  await context.routeWebSocket('**/*',socket=>{external.push(socket.url());return socket.close();});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url,{waitUntil:'networkidle'});
  if(theme==='dark') await page.locator('#theme-toggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
  const checks=[];
  const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
  check('three initial route cards',await page.locator('.route-card:visible').count()===3);
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  check('no horizontal overflow',Math.max(overflow.document,overflow.body)<=overflow.viewport);
  await page.screenshot({path:path.join(output,`${viewport.name}-${theme}.png`),fullPage:false});
  await page.screenshot({path:path.join(output,`${viewport.name}-${theme}-full.png`),fullPage:true});
  const audit=await new AxeBuilder({page}).analyze();
  check('zero axe violations on main view',audit.violations.length===0);
  await page.locator('[data-filter="mountain"]').focus();await page.keyboard.press('Enter');
  check('keyboard filter changes cards and count',await page.locator('.route-card:visible').count()===1&&(await page.locator('#result-count').textContent())==='1 route');
  check('filter exposes selected state',await page.locator('[data-filter="mountain"]').getAttribute('aria-pressed')==='true');
  const focus=await page.locator('[data-filter="mountain"]').evaluate(el=>({focused:el===document.activeElement,outline:getComputedStyle(el).outlineWidth,style:getComputedStyle(el).outlineStyle}));
  check('visible keyboard outline',focus.focused&&parseFloat(focus.outline)>=3&&focus.style==='solid');
  await page.keyboard.press('ArrowRight');check('arrow-key chip navigation',await page.locator('[data-filter="water"]').evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Space');check('water filter selects Stillwater',await page.locator('.route-card:visible').getAttribute('data-terrain')==='water');
  await page.locator('[data-filter="forest"]').click();check('forest filter selects Fernwood',await page.locator('.route-card:visible').getAttribute('data-terrain')==='forest');
  await page.locator('[data-filter="all"]').click();check('all filter restores cards',await page.locator('.route-card:visible').count()===3);
  await page.locator('[data-eval="open-dialog"]').click();
  check('dialog receives focus',await page.locator('dialog').evaluate(el=>el.open&&el.contains(document.activeElement)));
  check('correct route details',await page.locator('#dialog-title').textContent()==='Bracken Ridge');
  const dialogAudit=await new AxeBuilder({page}).analyze();check('zero axe violations in dialog',dialogAudit.violations.length===0);
  await page.screenshot({path:path.join(output,`${viewport.name}-${theme}-dialog.png`)});
  await page.keyboard.press('Shift+Tab');check('native dialog contains reverse tab',await page.locator('dialog').evaluate(el=>el.contains(document.activeElement)));
  await page.keyboard.press('Tab');check('native dialog contains tab',await page.locator('dialog').evaluate(el=>el.contains(document.activeElement)));
  await page.keyboard.press('Escape');check('Escape closes and restores opener',!(await page.locator('dialog').isVisible())&&await page.locator('[data-eval="open-dialog"]').evaluate(el=>el===document.activeElement));
  await page.locator('[data-eval="open-dialog"]').click();await page.locator('#dialog-save').click();
  check('dialog saves route',await page.locator('.saved-route').count()===2);
  await page.getByRole('checkbox',{name:'An extra layer'}).check();
  check('packing updates progress',await page.locator('#packing-count').textContent()==='3 / 5'&&await page.locator('#packing-progress').getAttribute('value')==='3');
  await page.reload({waitUntil:'networkidle'});
  check('fieldbook and packing persist',await page.locator('.saved-route').count()===2&&await page.getByRole('checkbox',{name:'An extra layer'}).isChecked());
  check('theme persists',await page.locator('html').getAttribute('data-theme')===theme);
  await page.locator('#theme-toggle').click();check('theme toggles',await page.locator('html').getAttribute('data-theme')!==theme);await page.locator('#theme-toggle').click();
  await page.locator('.save-button[data-save="ridge"]').click();check('card unsaves route',await page.locator('.saved-route').count()===1);
  await page.locator('.remove-route[data-save="lake"]').click();check('empty fieldbook has recovery',await page.locator('.empty-plan').isVisible()&&await page.locator('.add-route').isVisible());
  await page.locator('.save-button[data-save="forest"]').click();check('card adds route from empty plan',await page.locator('.saved-route').count()===1);
  await page.locator('.saved-route [data-trip="forest"]').click();check('saved route opens correct detail',await page.locator('#dialog-title').textContent()==='Fernwood Trail');await page.locator('#dialog-close').click();
  await page.locator('.pin-lake').click();check('map opens matching route',await page.locator('#dialog-title').textContent()==='Stillwater Loop');await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'reduce'});
  const motion=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(el=>{const s=getComputedStyle(el);return s.transitionDuration.split(',').some(v=>parseFloat(v)>0)||s.scrollBehavior==='smooth'||s.animationName!=='none';}).length);
  check('reduced motion respected',motion===0);
  check('no external HTTP or WebSocket attempts',external.length===0);check('no page errors',errors.length===0);
  reports.push({viewport,theme,status:'passed',checks,overflow,externalRequestCount:external.length,pageErrors:errors,requests:[...new Set(requests)],axe:{violations:audit.violations,incomplete:audit.incomplete.map(x=>x.id)},dialogAxe:{violations:dialogAudit.violations,incomplete:dialogAudit.incomplete.map(x=>x.id)}});
  await context.close();
 }
 // Defensive storage and no-JS behavior use separate contexts.
 const resilient=await browser.newContext();await resilient.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('storage blocked')};Storage.prototype.setItem=()=>{throw Error('storage blocked')};});const p=await resilient.newPage();await p.goto(url);await p.locator('.save-button[data-save="ridge"]').click();assert.equal(await p.locator('.saved-route').count(),2);await resilient.close();
 const nojs=await browser.newContext({javaScriptEnabled:false});const staticPage=await nojs.newPage();await staticPage.goto(url);assert.equal(await staticPage.locator('.route-card:visible').count(),3);assert.ok(await staticPage.locator('.noscript').isVisible());await nojs.close();
 const report={status:'passed',matrixCount:reports.length,assertionCount:reports.reduce((n,r)=>n+r.checks.length,0)+3,additionalChecks:['storage unavailable: save still works','no-JS: route cards readable','no-JS: explanation visible'],reports,limitations:['Chrome only; no screen-reader or representative-user study.','Axe incomplete rules remain manual review items.','Screenshots are captures, not independently approved visual-regression baselines.']};
 await writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,matrixCount:report.matrixCount,assertionCount:report.assertionCount,axeViolations:reports.flatMap(r=>[...r.axe.violations,...r.dialogAxe.violations]).length,externalRequests:reports.reduce((n,r)=>n+r.externalRequestCount,0),output:'artifacts/readme-showcase/browser-report.json'},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
