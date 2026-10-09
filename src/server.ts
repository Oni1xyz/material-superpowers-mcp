import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition } from './types.js';
import { docsTools } from './tools/docs.js';
import { designTools } from './tools/design.js';
import { planningTools } from './tools/planning.js';
export const allTools: ToolDefinition[] = [...docsTools,...designTools,...planningTools];

/** Serialize only bounded JSON data. Checking JSON.stringify(result).length is
 * too late: a small graph with repeated strings/references can exhaust the heap.
 * Reserve escaped string sizes before allocating them and emit incrementally.
 * Tool results are plain JSON data, not objects with getters or toJSON hooks. */
function boundedJson(value:unknown):string {
  const limit=500_000, chunks:string[]=[], active=new Set<object>();
  let characters=0;
  const reserve=(count:number)=>{
    characters+=count;
    if(characters>limit)throw new Error('Tool output exceeds the 500000-character safety limit; narrow the request');
  };
  const append=(text:string)=>{reserve(text.length);chunks.push(text);};
  const string=(text:string)=>{
    // Even without escaping, this string cannot fit. Avoid scanning its tail.
    if(text.length+2>limit-characters)reserve(text.length+2);
    let length=2;
    for(let i=0;i<text.length;i++) {
      const code=text.charCodeAt(i);
      if(code===34||code===92||[8,9,10,12,13].includes(code))length+=2;
      else if(code<32)length+=6;
      else if(code>=0xd800&&code<=0xdbff) {
        const next=text.charCodeAt(i+1);
        if(next>=0xdc00&&next<=0xdfff){length+=2;i++;}else length+=6;
      } else if(code>=0xdc00&&code<=0xdfff)length+=6;
      else length++;
      if(length>limit-characters)reserve(length);
    }
    reserve(length);
    chunks.push(JSON.stringify(text));
  };
  const skipped=(item:unknown)=>item===undefined||typeof item==='function'||typeof item==='symbol';
  const visit=(item:unknown,depth:number)=>{
    if(depth>128)throw new Error('Tool output exceeds the JSON nesting safety limit');
    if(item===null||skipped(item)){append('null');return;}
    if(typeof item==='string'){string(item);return;}
    if(typeof item==='boolean'||typeof item==='number'){append(JSON.stringify(item));return;}
    if(typeof item!=='object')throw new Error('Tool output must contain JSON data');
    if(active.has(item))throw new Error('Tool output contains a circular reference');
    const array=Array.isArray(item),prototype=Object.getPrototypeOf(item);
    if(!array&&prototype!==Object.prototype&&prototype!==null)throw new Error('Tool output must contain plain JSON objects');
    active.add(item);
    append(array?'[':'{');
    let first=true;
    const entry=(key:string)=>{
      const descriptor=Object.getOwnPropertyDescriptor(item,key);
      if(descriptor&&!('value' in descriptor))throw new Error('Tool output must not contain getters');
      const child=descriptor?.value;
      if(!array&&skipped(child))return;
      if(!first)append(',');
      first=false;
      if(!array){string(key);append(':');}
      visit(child,depth+1);
    };
    if(array)for(let i=0;i<item.length;i++)entry(String(i));
    else for(const key in item)if(Object.hasOwn(item,key))entry(key);
    append(array?']':'}');
    active.delete(item);
  };
  visit(value,0);
  return chunks.join('');
}
export async function executeTool(tool: ToolDefinition, input: unknown): Promise<CallToolResult> {
  try {
    const parsed=tool.inputSchema.safeParse(input);
    if(!parsed.success) throw new Error('Invalid input: '+parsed.error.issues.slice(0,8).map(i=>`${i.path.join('.')||'input'}: ${i.message}`).join('; '));
    const result=await tool.run(parsed.data);
    const value=result!==null && typeof result==='object' && !Array.isArray(result)?result:{result};
    const text=boundedJson(value);
    // Return exactly the serialized data, not a potentially larger original graph
    // with omitted properties or serialization hooks for the transport to revisit.
    return {content:[{type:'text',text}],structuredContent:JSON.parse(text) as Record<string,unknown>};
  } catch(error) {
    const message=error instanceof Error?error.message:'Tool execution failed';
    return {isError:true,content:[{type:'text',text:message.slice(0,1200)}]};
  }
}
export function createServer() {
  if(allTools.length!==10 || new Set(allTools.map(t=>t.name)).size!==10)throw new Error('Expected exactly ten unique Material tools');
  const server=new McpServer({name:'material-superpowers-mcp',version:'0.1.0'},{instructions:'Deterministic, local Material design assistance. Documentation excerpts require an explicitly refreshed official-source cache. Guidance and reviews are advisory, not accessibility certification. No tool runs a browser, shell, network request, or model.'});
  for(const tool of allTools) {
    server.registerTool(tool.name,{description:tool.description,inputSchema:tool.inputSchema.shape,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async (input: unknown)=>executeTool(tool,input));
  }
  // Override SDK dispatch so the original strict Zod object validates unmodified
  // arguments and every tool validation failure obeys the same bounded error contract.
  server.server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool=allTools.find(candidate=>candidate.name===request.params.name);
    if(!tool)return {isError:true,content:[{type:'text' as const,text:'Unknown tool; call tools/list for the supported names'}]};
    return executeTool(tool,request.params.arguments??{});
  });
  return server;
}
