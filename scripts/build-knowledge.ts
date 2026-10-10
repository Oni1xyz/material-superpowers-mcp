import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildKnowledge } from '../src/graph/build.js';
export { buildKnowledge } from '../src/graph/build.js';
export async function main(argv=process.argv.slice(2)){
 if(argv.includes('--help')){console.log('Offline graph build: npm run build-knowledge -- [--dir <corpus-directory>]\nReads the current validated corpus and optional resource sidecar; never downloads. Prints the generated Obsidian vaultRoot.');return;}
 let dir:string|undefined;if(argv.length){if(argv.length!==2||argv[0]!=='--dir'||!argv[1]||argv[1].startsWith('--'))throw new Error('Usage: npm run build-knowledge -- [--dir <corpus-directory>]');dir=resolve(argv[1]);}
 console.log(JSON.stringify(await buildKnowledge({dir}),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error instanceof Error?error.message:'Graph build failed');process.exitCode=1;});
