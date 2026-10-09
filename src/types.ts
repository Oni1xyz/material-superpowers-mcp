import type { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.AnyZodObject;
  run: (input: any) => unknown | Promise<unknown>;
}
