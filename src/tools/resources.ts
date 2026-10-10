import type { ToolDefinition } from '../types.js';
import { defaultCacheDir } from '../material/cache.js';
import { readSpec, readSpecSchema } from '../material/resource-store.js';

export function makeResourceTools(dir = defaultCacheDir()): ToolDefinition[] {
  return [{ name: 'material_read_spec', description: 'Read verified locally imported M3 token/numeric resource rows for an exact canonical page. Optional moduleId and case-insensitive token-name substring query; continue nextCursor with identical filters. Page tokenSets are filtered explicitly; all context alternatives are preserved, not ranked. No network, inferred defaults, dependency-token leakage or unverified module schemas.', inputSchema: readSpecSchema, run: async input => readSpec(dir, readSpecSchema.parse(input)) }];
}
