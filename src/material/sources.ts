export interface DocSource { path: string; title: string; category: 'components' | 'styles' | 'foundations'; url: string; sourceKind: 'material-3' | 'material-web'; }
const raw = 'https://raw.githubusercontent.com/material-components/material-web/main/docs/';
export const sourceCatalog: readonly DocSource[] = [
  {path:'components/buttons', title:'Material Web buttons', category:'components', url:raw+'components/button.md', sourceKind:'material-web'},
  {path:'components/dialog', title:'Material Web dialog', category:'components', url:raw+'components/dialog.md', sourceKind:'material-web'},
  {path:'components/chips', title:'Material Web chips', category:'components', url:raw+'components/chip.md', sourceKind:'material-web'},
  {path:'components/text-fields', title:'Material Web text fields', category:'components', url:raw+'components/text-field.md', sourceKind:'material-web'},
  {path:'styles/color', title:'Material Web color', category:'styles', url:raw+'theming/color.md', sourceKind:'material-web'},
  {path:'styles/typography', title:'Material Web typography', category:'styles', url:raw+'theming/typography.md', sourceKind:'material-web'},
];
export const renderedSource: DocSource = {path:'m3/buttons', title:'Material 3 buttons overview', category:'components', url:'https://m3.material.io/components/buttons/overview', sourceKind:'material-3'};
export const allowedSources = [...sourceCatalog, renderedSource];
/** Exact raw-string matching precedes URL parsing, so URL normalization cannot hide bypasses. */
export function validateSourceUrl(value: string): string {
  if (!allowedSources.some(s => s.url === value)) throw new Error('Source URL is not in the fixed official allowlist');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) throw new Error('Unsafe source URL');
  return value;
}
export function validateDocPath(value: string): string {
  if (!allowedSources.some(s => s.path === value)) throw new Error('Unknown documentation path; use material_search_docs to discover available paths');
  return value;
}
