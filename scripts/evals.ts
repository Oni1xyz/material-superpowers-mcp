import assert from 'node:assert/strict';
import postcss from 'postcss';
import { designTools } from '../src/tools/design.js';
import { planningTools } from '../src/tools/planning.js';
import { mkdir, writeFile } from 'node:fs/promises';
const tools=[...designTools,...planningTools];
async function run(name:string,input:unknown):Promise<any> {
  const tool=tools.find(t=>t.name===name);assert.ok(tool);return tool.run(tool.inputSchema.parse(input));
}
// Maintained independently of the planner's generated checks. Pure/offline contract
// evaluation is not a browser pass, human usability result, or measured A/B uplift.
const results:{id:string;status:'passed'}[]=[];
async function check(id:string,fn:()=>unknown|Promise<unknown>){await fn();results.push({id,status:'passed'});}
function luminance(hex:string) {
  assert.match(hex,/^#[a-f0-9]{6}$/i);
  const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;
}
for(const seed of ['#000000','#ffffff','#6750a4','#00ff00','#ff0000']) {
  await check(`TOKEN-${seed.slice(1)}`,async()=>{
    const result=await run('material_generate_tokens',{seedColor:seed,mode:'both'});
    assert.deepEqual(result,await run('material_generate_tokens',{seedColor:seed,mode:'both'}));
    assert.ok(postcss.parse(result.css).nodes.length);
    for(const mode of ['light','dark'])for(const [bg,fg] of [['primary','on-primary'],['secondary','on-secondary'],['error','on-error'],['surface','on-surface']]) {
      const a=luminance(result.schemes[mode][bg]),b=luminance(result.schemes[mode][fg]);
      assert.ok((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5,`${seed}/${mode}/${bg}: normal-text AA contrast`);
    }
  });
}
for(const component of ['button','card','navigation','chip','text-field','dialog','snackbar','list'])await check(`RECIPE-${component}`,async()=>{
  const result=await run('material_component_recipe',{component,platform:'plain-html-css'});
  assert.ok(result.html?.length>0);assert.ok(postcss.parse(result.css).nodes.length);
});
await check('NEGATIVE-BAD-HEX',async()=>{await assert.rejects(()=>run('material_generate_tokens',{seedColor:'red; background:url(https://evil.test)'}));});
await check('NEGATIVE-UNSUPPORTED-REACT',async()=>{await assert.rejects(()=>run('material_component_recipe',{component:'button',platform:'react'}));});
await check('CUSTOM-FLOW-NOT-BLESSED',async()=>{
  const result=await run('material_generate_eval_plan',{target:'Account settings',flows:['Verify retry-safe backend billing cancellation'],riskLevel:'high'});
  const custom=result.checks.find((c:any)=>c.id.startsWith('FLOW-CUSTOM'));
  assert.equal(custom.execution,'manual');assert.equal(custom.status,'outstanding');assert.equal(result.status,'not-run');
  assert.ok(result.checks.some((c:any)=>c.id==='RISK-DOMAIN-REVIEW'&&c.execution==='manual'));
});
const report={suite:'independent-offline-contracts',status:'passed',count:results.length,results,limitations:['No browser execution; run npm run evals:ui separately.','No human usability, visual baseline approval, or A/B uplift measured.']};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/offline-evals.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
