import { readFile, mkdir, writeFile } from 'node:fs/promises';
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
const direct={...pkg.dependencies,...pkg.devDependencies};
for(const [name,version] of Object.entries(direct))if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error(`Not exact-pinned: ${name}`);
const entries=new Map();
for(const [path,item] of Object.entries(lock.packages)) {
  if(!path)continue;
  const name=path.split('node_modules/').at(-1);
  if(!/^https:\/\/registry\.npmjs\.org\//.test(item.resolved??''))throw new Error(`Non-registry lock entry: ${name}`);
  if(!item.integrity)throw new Error(`Missing integrity: ${name}`);
  entries.set(`${name}@${item.version}`,{name,version:item.version});
}
const work=[...entries.values()];const rows=[];const registry=new Map();let cursor=0;
async function metadata(name) {
  if(!registry.has(name))registry.set(name,(async()=>{
    const response=await fetch(`https://registry.npmjs.org/${name}`,{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Registry ${response.status}: ${name}`);
    return response.json();
  })());
  return registry.get(name);
}
await Promise.all(Array.from({length:8},async()=>{
  while(cursor<work.length) {
    const {name,version}=work[cursor++];const info=await metadata(name);const published=info.time[version];
    const ageDays=(Date.now()-Date.parse(published))/86400000;
    if(!Number.isFinite(ageDays))throw new Error(`Missing release timestamp: ${name}@${version}`);
    rows.push({name,version,published,ageDays:Math.floor(ageDays),direct:direct[name]===version,engines:info.versions[version].engines??null});
  }
}));
rows.sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version));
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/dependency-metadata.json',JSON.stringify({checkedAt:new Date().toISOString(),packages:rows},null,2)+'\n');
console.log(JSON.stringify({checked:rows.length,minimumReleaseAgeDays:7,direct:rows.filter(r=>r.direct),fullEvidence:'artifacts/dependency-metadata.json'},null,2));
const young=rows.filter(row=>row.ageDays<7);
if(young.length) {console.error(JSON.stringify({underSevenDays:young},null,2));process.exitCode=1;}
