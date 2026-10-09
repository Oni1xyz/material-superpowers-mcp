import type { ToolDefinition } from '../types.js';
import { screenSchema, evalSchema } from '../planning/schemas.js';
import { planScreen } from '../planning/screen.js';
import { generateEvalPlan } from '../planning/eval.js';

export const planningTools: ToolDefinition[] = [
  {
    name: 'material_plan_screen',
    description: 'Compose deterministic authored screen templates and recipe recommendations. Custom goals, constraints and brand prose remain explicit outstanding manual checks; no LLM, network or file access.',
    inputSchema: screenSchema,
    run: input => planScreen(screenSchema.parse(input)),
  },
  {
    name: 'material_generate_eval_plan',
    description: 'Generate traceable runnable/manual evaluation checks and a safely serialized local-only Playwright/axe source artifact. URL is validated metadata, never fetched. Supports exact dialog/confirm-action fixture contracts; custom flows stay outstanding.',
    inputSchema: evalSchema,
    run: input => generateEvalPlan(evalSchema.parse(input)),
  },
];
