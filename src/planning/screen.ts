import type { ScreenInput } from './schemas.js';

const patterns = [
  { id: 'settings', match: /\b(settings|preferences|account)\b/i, components: ['navigation', 'text-field', 'button', 'dialog', 'snackbar'], layout: ['Page title and context', 'Labeled setting groups', 'Save and cancel actions', 'Status feedback'] },
  { id: 'collection', match: /\b(dashboard|catalog|search|list)\b/i, components: ['navigation', 'text-field', 'chip', 'card', 'list'], layout: ['Page title and summary', 'Search and filters', 'Results with empty/error states', 'Secondary details'] },
  { id: 'form', match: /\b(form|sign.?up|checkout|register)\b/i, components: ['text-field', 'button', 'dialog', 'snackbar'], layout: ['Task title and expectations', 'Labeled inputs and help', 'Review and explicit submit', 'Success or actionable error'] },
];

export function planScreen(input: ScreenInput) {
  const pattern = patterns.find(p => p.match.test(input.screen)) ?? {
    id: 'generic', components: ['navigation', 'card', 'button'],
    layout: ['Screen title and context', 'Primary task area', 'Supporting information', 'Outcome feedback'],
  };
  const constraints = typeof input.constraints === 'string' ? [input.constraints] : input.constraints ?? [];
  return {
    version: 1,
    status: 'template-not-validated',
    input,
    provenance: { kind: 'authored-guidance', reference: 'https://m3.material.io/', note: 'Deterministic project templates inspired by Material principles; not official quotations or a semantic analysis of the goal.' },
    matching: { pattern: pattern.id, method: 'First matching bounded screen-name keyword rule; userGoal and brand prose remain manual requirements.' },
    layout: pattern.layout,
    recipes: pattern.components.map(component => ({ tool: 'material_component_recipe', component, note: 'Use the recipe tool schema for supported platform/variant arguments; this is a recommendation, not a tool invocation.' })),
    adaptation: input.platform === 'mobile'
      ? ['Single-column primary task', 'Keep primary actions reachable', 'Do not rely on hover; verify native platform behavior separately']
      : ['Stack content on narrow viewports', 'Introduce supporting columns only when space permits', 'Keep keyboard order aligned with reading order'],
    tokenRoles: ['primary/on-primary', 'surface/on-surface', 'outline', 'error/on-error', 'typography', 'shape', 'spacing', 'motion'],
    interactionChecklist: ['Visible keyboard focus', 'Default, hover, pressed and disabled states where applicable', 'Labeled fields with error association', 'Loading, empty, error and success states', 'Reduced motion and responsive layout'],
    manualChecks: [
      { id: 'GOAL', requirement: input.userGoal, passCriteria: 'A human defines and verifies task-specific observable success and failure assertions.', status: 'outstanding' },
      ...(input.brandStyle ? [{ id: 'BRAND', requirement: input.brandStyle, passCriteria: 'Human review confirms explicit brand decisions and contrast.', status: 'outstanding' }] : []),
      ...constraints.map((requirement, i) => ({ id: `CONSTRAINT-${i + 1}`, requirement, passCriteria: 'Translate this custom constraint into an explicit, independently reviewed assertion.', status: 'outstanding' })),
      ...(input.platform !== 'web' ? [{ id: 'NATIVE', requirement: input.platform, passCriteria: 'Validate platform-native semantics with native testing tools; web recipes are not native implementations.', status: 'outstanding' }] : []),
    ],
  };
}
