import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cacheRoot, checkCacheTarget, ensureCacheDirectory } from '../material/files.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaultCacheDir, sha256 } from '../material/cache.js';
import { readCorpusDocument, searchTerms } from '../material/corpus.js';
import { pathSchema } from '../material/discovery.js';
import { boundedArray } from '../material/validation.js';
import { authoredRoutes } from './routes.js';
import { confinedPath, readGraphFile, sourceBinding, validateGraph } from './store.js';
import { GRAPH_LIMITS, docId, graphIndexSchema, idSchema, nodeSchema, parseGraph, renderMarkdown, resourceId, serializeGraphIndex, type GraphEdge, type GraphIndex, type GraphNode } from './schema.js';
const routeSchema=z.object({id:z.string().max(300).regex(/^tasks\/[a-z0-9]+(?:-[a-z0-9]+)*$/),title:z.string().max(500),summary:z.string().max(1200),terms:boundedArray(z.string().max(100),100),targets:boundedArray(z.object({path:pathSchema,relation:z.enum(['guidance','alternative','check']),reason:z.string().max(1200)}).strict(),100)}).strict();

/** Explicit offline builder only. Not imported by runtime tools. */
export async function buildKnowledge({dir=defaultCacheDir()}: {dir?:string}={}){
 dir=await cacheRoot(dir);const start=await sourceBinding(dir),{corpus,resources}=start;
 const routes=parseGraph(boundedArray(routeSchema,200),authoredRoutes),nodes=new Map<string,GraphNode>(),edgeKeys=new Set<string>();let edgeCount=0,inputBytes=0;
 function add(id:string,kind:GraphNode['kind'],title:string,summary:string,terms:string[]=[]){idSchema.parse(id);if(nodes.has(id))return nodes.get(id)!;if(nodes.size>=GRAPH_LIMITS.nodes)throw new Error('Graph node limit');const node:GraphNode={id,kind,title,summary,terms:[...new Set([...searchTerms(id+' '+title),...terms])].slice(0,150),citations:[],actions:{},outgoing:[],backlinks:[],external:[],markdownSha256:'0'.repeat(64)};nodes.set(id,node);return node;}
 function edge(from:string,to:string,relation:GraphEdge['relation'],origin:GraphEdge['origin'],reason:string,extra:Partial<Pick<GraphEdge,'sourceUrl'|'sourcePointer'>>={}){
 const key=JSON.stringify([from,to,relation,origin]);if(edgeKeys.has(key))return;const a=nodes.get(from),b=nodes.get(to);if(!a||!b)throw new Error('Broken graph edge while building');if(edgeCount>=GRAPH_LIMITS.edges||a.outgoing.length>=GRAPH_LIMITS.nodeEdges||b.backlinks.length>=GRAPH_LIMITS.nodeEdges)throw new Error('Graph edge limit');edgeKeys.add(key);edgeCount++;a.outgoing.push({id:to,relation,origin,reason,...extra});b.backlinks.push({id:from,relation,origin,reason,...extra});
 }
 function contains(parent:string,child:string){edge(parent,child,'contains','structural','Navigation inventory membership; not an official semantic recommendation.');edge(child,parent,'parent','structural','Parent navigation index.');}
 const home=add('home.md','home','Material 3 knowledge map','Offline navigation over every indexed canonical document and resource module. Authored task routes are starting points, not official prescriptions. Parsed content, page filtering, and context selection are separate; no winning context is inferred.');
 const taskHome=add('tasks/index.md','hub','Task routes','Authored starting points into exact official guidance, alternatives, accessibility checks, and specifications.');contains(home.id,taskHome.id);
 const modules=new Map(resources.status==='ready'?resources.modules.map(m=>[m.path+'\0'+m.moduleId,m]):[]),endpoints=new Map(resources.status==='ready'?resources.endpoints.map(e=>[e.key,e]):[]),observedModules=new Set<string>();
 const byUrl=new Map(corpus.index.documents.map(d=>[d.url,docId(d.path)])),byDocument=new Map<string,string[]>();
 for(const entry of corpus.index.documents){
 const category=add(`categories/${entry.category}.md`,'category',entry.category,'Structural category index of the current canonical corpus.');contains(home.id,category.id);
 const parts=entry.path.split('/'),hubPath=parts.slice(0,2).join('/');let parent=category;
 if(parts.length>=2){parent=add(`hubs/${hubPath}.md`,'hub',hubPath.replaceAll('/',' / '),'Structural component or concept hub; follow exact canonical sections, not inferred recommendations.');contains(category.id,parent.id);}
 const node=add(docId(entry.path),'document',entry.title+(entry.section?' — '+entry.section:''),`Canonical ${entry.category} document${entry.section?'; section '+entry.section:''}. Read the full source with material_read_doc. Resource references and visual interpretation may remain unresolved.`,entry.headings.flatMap(h=>searchTerms(h.title)).slice(0,70));contains(parent.id,node.id);const group=byDocument.get(entry.documentId)??[];group.push(node.id);byDocument.set(entry.documentId,group);
 }
 for(const ids of byDocument.values())for(const from of ids)for(const to of ids)if(from!==to)edge(from,to,'section','structural','Another indexed section of the same source document; consult its exact citation.');
 for(const entry of corpus.index.documents){
 const sourcePath=await confinedPath(dir,`snapshots/${corpus.snapshot}/${entry.file}`);
 const sourceSize=(await lstat(sourcePath)).size;
 if(sourceSize>8000000||inputBytes+sourceSize>GRAPH_LIMITS.sourceBytes)throw new Error('Graph source byte limit');inputBytes+=sourceSize;
 // Charge the aggregate before the validated reader allocates its file buffer.
 const doc=await readCorpusDocument(corpus,entry.path);
 const node=nodes.get(docId(doc.path))!;node.actions={readDoc:{path:doc.path}};
 const citation={path:doc.path,url:doc.url,sourceUrl:doc.sourceUrl,sourceSha256:doc.sourceSha256,documentSha256:doc.sha256,corpusSnapshot:corpus.snapshot,...(doc.section?{section:doc.section}:{}),sourcePointer:null,...(doc.normalizationVersion?{normalizationVersion:doc.normalizationVersion}:{})};node.citations=[citation];
 const externals=new Set<string>();
 for(const block of doc.blocks)for(const [ci,chunk]of block.chunks.entries()){
 const pointer=block.provenance?`/sections/${block.provenance.sectionIndex}/contentBlocks/${block.provenance.blockIndex}/contentChunks/${ci}`:null;
 if(!Array.isArray(chunk.links)||chunk.links.length>2000)throw new Error('Graph source link limit');
 for(const link of chunk.links){if(typeof link.url!=='string'||link.url.length>1500)throw new Error('Graph source URL limit');let url:URL;try{url=new URL(link.url,doc.url);}catch{continue;}if(!['http:','https:','mailto:'].includes(url.protocol))continue;const target=byUrl.get(url.href.split('#')[0]);if(target)edge(node.id,target,'source-link','official-source-link','Explicit hyperlink in visible normalized official source; no additional semantic inference.',{sourceUrl:link.url,...(pointer?{sourcePointer:pointer}:{})});else if(!externals.has(link.url)){if(node.external.length>=1000)throw new Error('Graph external reference limit');externals.add(link.url);node.external.push({url:link.url,sourcePointer:pointer,origin:'official-source-link'});}}
 if(!chunk.resource)continue;
 const key=doc.path+'\0'+chunk.id;if(observedModules.has(key))throw new Error('Duplicate resource module');observedModules.add(key);if(observedModules.size>2000)throw new Error('Graph resource limit');
 const ref=chunk.resource,m=modules.get(key),endpoint=m?.endpointKey?endpoints.get(m.endpointKey):undefined;
 if(chunk.metadata.resourceName!==undefined&&chunk.metadata.resourceName!==ref.name||chunk.metadata.libraryModuleType!==undefined&&chunk.metadata.libraryModuleType!==ref.moduleType)throw new Error('Corpus resource metadata mismatch');
 if(m&&(m.resourceName!==ref.name||m.moduleType!==ref.moduleType||m.blockId!==block.id||m.articlePointer!==pointer||m.articleSourceSha256!==doc.sourceSha256))throw new Error('Resource coverage/reference mismatch');
 const r=add(resourceId(doc.path,chunk.id,sha256),'resource',`${ref.moduleType}: ${doc.title}${doc.section?' — '+doc.section:''}`,`Resource module reference in ${doc.path}. A navigable link is not resolution. Use material_read_spec for exact page/module data and material_read_doc for source context.`,searchTerms(doc.path+' '+ref.name+' '+ref.moduleType));
 r.actions={readDoc:{path:doc.path},readSpec:{path:doc.path,moduleId:chunk.id}};
 r.resource={moduleId:chunk.id,moduleType:ref.moduleType,resourceName:ref.name,status:m?.status??'unknown',normalization:endpoint?.status==='fetched'&&endpoint.rowCount!==undefined?'parsed':'metadata-only',pageFilterStatus:m?.pageFilterStatus??'unknown',contextEvaluation:'not-evaluated',rowCount:m?.rowCount??0,reason:m?.reason??(m?'Fetched/parsed endpoint and page-specific selection are distinct; context alternatives are not evaluated.':'No coverage for this module in the current sidecar. Run npm run refresh-resources, then npm run build-knowledge. No endpoint or values inferred.')};
 r.citations=[{...citation,sourcePointer:pointer,...(start.resourceSnapshot?{resourceSnapshot:start.resourceSnapshot}:{}),...(endpoint?{endpointUrl:endpoint.url,...(endpoint.sourceSha256?{endpointSha256:endpoint.sourceSha256}:{})}:{})}];
 edge(node.id,r.id,'resource','structural','Explicit visible source module reference; inspect status before using values.',{sourceUrl:doc.sourceUrl,...(pointer?{sourcePointer:pointer}:{})});edge(r.id,node.id,'parent','structural','Exact parent article and canonical section.',{sourceUrl:doc.url});
 }
 }
 for(const key of modules.keys())if(!observedModules.has(key))throw new Error('Sidecar module not present in validated visible corpus');
 for(const route of routes){const n=add(route.id+'.md','task',route.title,'Authored task routing: '+route.summary,route.terms);contains(taskHome.id,n.id);for(const t of route.targets){const target=docId(t.path);if(nodes.has(target))edge(n.id,target,t.relation,'authored-task-routing',t.reason);else n.external.push({url:'https://m3.material.io/'+t.path,sourcePointer:null,origin:'authored-task-routing'});}}
 let notesBytes=0;const sorted=[...nodes.values()].map(n=>parseGraph(nodeSchema,n)).sort((a,b)=>a.id.localeCompare(b.id));
 for(const n of sorted){const order=(a:GraphEdge,b:GraphEdge)=>a.id.localeCompare(b.id)||a.relation.localeCompare(b.relation)||a.origin.localeCompare(b.origin);n.outgoing.sort(order);n.backlinks.sort(order);n.external.sort((a,b)=>a.url.localeCompare(b.url));n.terms.sort();const text=renderMarkdown(n),bytes=Buffer.byteLength(text);if(bytes>GRAPH_LIMITS.noteBytes||notesBytes+bytes>GRAPH_LIMITS.totalBytes)throw new Error('Graph Markdown byte limit');notesBytes+=bytes;n.markdownSha256=sha256(text);}
 const index:GraphIndex=parseGraph(graphIndexSchema,{version:1,corpusSnapshot:corpus.snapshot,resourceSnapshot:start.resourceSnapshot,resourceStatus:start.resourceStatus,routesSha256:sha256(JSON.stringify(routes)),nodes:sorted,counts:{nodes:sorted.length,edges:edgeCount,documents:corpus.index.documents.length,resources:observedModules.size,tasks:routes.length,notesBytes}});validateGraph(index);
 const indexText=serializeGraphIndex(index);if(Buffer.byteLength(indexText)>GRAPH_LIMITS.indexBytes||Buffer.byteLength(indexText)+notesBytes>GRAPH_LIMITS.totalBytes)throw new Error('Graph index/total byte limit');const snapshot=sha256(indexText);
 await ensureCacheDirectory(dir,'knowledge/snapshots');
 await checkCacheTarget(dir,`knowledge/snapshots/${snapshot}`,'directory');await checkCacheTarget(dir,'knowledge/manifest.json','file');
 const stageRelative=`knowledge/snapshots/.staging-${randomUUID()}`,stage=join(dir,stageRelative),temp=join(dir,`knowledge/.manifest-${randomUUID()}.tmp`),target=join(dir,'knowledge/snapshots',snapshot);
 await mkdir(stage);
 try{
 await mkdir(join(stage,'vault'));for(const n of index.nodes){const file=join(stage,'vault',n.id);await mkdir(dirname(file),{recursive:true});await writeFile(file,renderMarkdown(n),{flag:'wx',mode:0o600});}
 await writeFile(join(stage,'index.json'),indexText,{flag:'wx',mode:0o600});
 try{await rename(stage,target);}catch(e){if(!['EEXIST','ENOTEMPTY'].includes((e as NodeJS.ErrnoException).code??''))throw e;if(await readGraphFile(dir,`knowledge/snapshots/${snapshot}/index.json`,GRAPH_LIMITS.indexBytes)!==indexText)throw new Error('Existing immutable graph corrupted');for(const n of index.nodes)if(sha256(await readGraphFile(dir,`knowledge/snapshots/${snapshot}/vault/${n.id}`,GRAPH_LIMITS.noteBytes))!==n.markdownSha256)throw new Error('Existing immutable note corrupted');}
 const manifest={version:1,snapshot,corpusSnapshot:start.corpusSnapshot,resourceSnapshot:start.resourceSnapshot,resourceStatus:start.resourceStatus};await writeFile(temp,JSON.stringify(manifest)+'\n',{flag:'wx',mode:0o600});
 // Recheck both validated dependencies immediately before the atomic publication.
 const end=await sourceBinding(dir);if(start.corpusSnapshot!==end.corpusSnapshot||start.resourceSnapshot!==end.resourceSnapshot||start.resourceStatus!==end.resourceStatus)throw new Error('Corpus/resource snapshot changed during graph build; retry npm run build-knowledge');
 await confinedPath(dir,'knowledge');await rename(temp,join(dir,'knowledge/manifest.json'));
 const published=await readGraphFile(dir,'knowledge/manifest.json',4096);if(JSON.parse(published).snapshot!==snapshot)throw new Error('Graph manifest changed after publication');
 return {snapshot,corpusSnapshot:start.corpusSnapshot,resourceSnapshot:start.resourceSnapshot,resourceStatus:start.resourceStatus,vaultRoot:join(target,'vault'),counts:index.counts};
 }finally{await rm(stage,{recursive:true,force:true});await rm(temp,{force:true});}
}
