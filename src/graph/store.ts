import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { defaultCacheDir, sha256 } from '../material/cache.js';
import { openCorpus } from '../material/corpus.js';
import { readResourceCoverage } from '../material/resource-store.js';
import { GRAPH_HELP, GRAPH_LIMITS, graphIndexSchema, graphManifestSchema, idSchema, parseGraph, renderMarkdown, type GraphIndex } from './schema.js';
export async function confinedPath(root:string,relative:string){
 if(!relative||relative.length>1000||relative.startsWith('/')||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Graph path confinement violation');
 const base=await realpath(root);let current=base;for(const part of relative.split('/')){current=join(current,part);const st=await lstat(current);if(st.isSymbolicLink())throw new Error('Graph symlink confinement violation');}
 if(!(await realpath(current)).startsWith(base+sep))throw new Error('Graph path confinement violation');return current;
}
export async function readGraphFile(root:string,relative:string,max:number){
 const path=await confinedPath(root,relative),handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const st=await handle.stat();if(!st.isFile()||st.size>max)throw new Error('Graph file size limit');const buffer=Buffer.alloc(st.size+1);let used=0;while(used<buffer.length){const n=await handle.read(buffer,used,buffer.length-used,null);if(!n.bytesRead)break;used+=n.bytesRead;}if(used!==st.size)throw new Error('Graph changed during read');return buffer.subarray(0,used).toString('utf8');}finally{await handle.close();}
}
export async function sourceBinding(dir=defaultCacheDir()){
 const corpus=await openCorpus(dir);
 await confinedPath(dir,'manifest.json');await confinedPath(dir,`snapshots/${corpus.snapshot}/index.json`);
 const resources=await readResourceCoverage(corpus);
 if(resources.status!=='ready'&&resources.status!=='missing')throw new Error(`Resource sidecar ${resources.status}; refresh resources explicitly, then ${GRAPH_HELP}`);
 if(resources.status==='ready'){await confinedPath(dir,'resources/manifest.json');await confinedPath(dir,`resources/${resources.snapshot}.json`);}
 return {corpus,resources,corpusSnapshot:corpus.snapshot,resourceSnapshot:resources.status==='ready'?resources.snapshot:null,resourceStatus:resources.status};
}
const edgeKey=(source:string,e:{id:string;relation:string;origin:string})=>JSON.stringify([source,e.id,e.relation,e.origin]);
export function validateGraph(index:GraphIndex){
 const nodes=new Map(index.nodes.map(n=>[n.id,n]));if(nodes.size!==index.nodes.length||!nodes.has('home.md'))throw new Error('Graph duplicate/missing node');
 let edges=0,backlinks=0,notesBytes=0;const keys=new Map<string,string>();
 for(const n of index.nodes){for(const e of n.outgoing){if(++edges>GRAPH_LIMITS.edges||!nodes.has(e.id))throw new Error('Graph edge limit or broken target');const key=edgeKey(n.id,e);if(keys.has(key))throw new Error('Graph duplicate edge');keys.set(key,JSON.stringify({...e,id:n.id}));}notesBytes+=Buffer.byteLength(renderMarkdown(n));if(notesBytes>GRAPH_LIMITS.totalBytes)throw new Error('Graph total byte limit');if(Buffer.byteLength(renderMarkdown(n))>GRAPH_LIMITS.noteBytes||sha256(renderMarkdown(n))!==n.markdownSha256)throw new Error('Graph Markdown digest/size mismatch');}
 const backKeys=new Set<string>();for(const n of index.nodes)for(const e of n.backlinks){backlinks++;const key=edgeKey(e.id,{...e,id:n.id});if(backKeys.has(key)||keys.get(key)!==JSON.stringify(e))throw new Error('Graph backlink mismatch');backKeys.add(key);}
 if(edges!==backlinks)throw new Error('Graph backlink count mismatch');
 const seen=new Set(['home.md']),queue=['home.md'];for(let i=0;i<queue.length;i++){for(const e of nodes.get(queue[i])!.outgoing)if(!seen.has(e.id)){seen.add(e.id);queue.push(e.id);}}
 if(seen.size!==nodes.size)throw new Error('Graph unreachable node');
 const counts={nodes:nodes.size,edges,documents:index.nodes.filter(n=>n.kind==='document').length,resources:index.nodes.filter(n=>n.kind==='resource').length,tasks:index.nodes.filter(n=>n.kind==='task').length,notesBytes};if(JSON.stringify(counts)!==JSON.stringify(index.counts))throw new Error('Graph counts mismatch');return counts;
}
export interface KnowledgeGraph{dir:string;snapshot:string;vaultRoot:string;index:GraphIndex}
export async function openKnowledge(dir=defaultCacheDir()):Promise<KnowledgeGraph>{
 try{
 const manifest=parseGraph(graphManifestSchema,JSON.parse(await readGraphFile(dir,'knowledge/manifest.json',4096)));
 const text=await readGraphFile(dir,`knowledge/snapshots/${manifest.snapshot}/index.json`,GRAPH_LIMITS.indexBytes);if(sha256(text)!==manifest.snapshot)throw new Error('Graph index digest mismatch');
 const index=parseGraph(graphIndexSchema,JSON.parse(text));if(index.corpusSnapshot!==manifest.corpusSnapshot||index.resourceSnapshot!==manifest.resourceSnapshot||index.resourceStatus!==manifest.resourceStatus)throw new Error('Graph manifest mismatch');
 const binding=await sourceBinding(dir);if(binding.corpusSnapshot!==index.corpusSnapshot||binding.resourceSnapshot!==index.resourceSnapshot||binding.resourceStatus!==index.resourceStatus)throw new Error('Graph stale: corpus or resource snapshot/status changed');
 validateGraph(index);return {dir:resolve(dir),snapshot:manifest.snapshot,vaultRoot:join(resolve(dir),'knowledge','snapshots',manifest.snapshot,'vault'),index};
 }catch(error){throw new Error(`Knowledge graph unavailable: ${error instanceof Error?error.message.slice(0,220):'invalid local graph'}. ${GRAPH_HELP}`);}
}
export async function graphRead(graph:KnowledgeGraph,id:string){
 idSchema.parse(id);const node=graph.index.nodes.find(n=>n.id===id);if(!node)throw new Error('Unknown graph ID; search with material_navigate');
 const text=await readGraphFile(graph.dir,`knowledge/snapshots/${graph.snapshot}/vault/${id}`,GRAPH_LIMITS.noteBytes);if(sha256(text)!==node.markdownSha256)throw new Error('Knowledge Markdown digest mismatch. '+GRAPH_HELP);return text;
}
