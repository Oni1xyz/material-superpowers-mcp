import { designTools } from '../../src/tools/design.js';

interface Recipe { html: string; css: string; js: string; component: string }

export async function buildDemo() {
  const invoke = async (name: string, input: unknown): Promise<any> => {
    const tool = designTools.find(t => t.name === name);
    if (!tool) throw new Error(`Required actual design tool missing: ${name}`);
    return tool.run(tool.inputSchema.parse(input));
  };
  const tokenInput = { seedColor: '#546a2f', mode: 'light', styleProfile: 'lab' };
  const tokens = await invoke('material_generate_tokens', tokenInput);
  if (typeof tokens.css !== 'string' || !tokens.schemes?.light?.primary) throw new Error('Token output contract changed: expected css and light primary role.');
  const recipes: Record<string, Recipe> = {};
  for (const component of ['navigation', 'card', 'text-field', 'button', 'dialog', 'chip', 'list']) {
    recipes[component] = await invoke('material_component_recipe', { component, platform: 'plain-html-css', projectStyle: 'lab' });
    if (typeof recipes[component].html !== 'string' || typeof recipes[component].css !== 'string') throw new Error(`Recipe contract changed for ${component}`);
  }
  // Small, explicit app integration on actual generated recipe markup. The
  // underlying native dialog/open/close behavior and CSS come from the tool.
  const confirm = recipes.button.html.replace('type="button"', 'type="button" data-eval="confirm"').replace('Save changes', 'Confirm update');
  const dialog = recipes.dialog.html
    .replace('id="md-dialog-open"', 'id="md-dialog-open" data-eval="open-dialog"')
    .replace('id="md-dialog"', 'id="md-dialog" data-eval="dialog"')
    .replace('id="md-dialog-close"', 'id="md-dialog-close" data-eval="cancel"')
    .replace('autofocus>Close', 'autofocus>Cancel')
    .replace('</dialog>', `${confirm}</dialog>`);
  if (!dialog.includes('data-eval="open-dialog"') || !dialog.includes('data-eval="cancel"')) throw new Error('Dialog recipe integration hooks changed.');
  const css = `${tokens.css}\n${Object.values(recipes).map(r => r.css).join('\n')}\n
* { box-sizing: border-box; }
body { margin: 0; color: var(--md-sys-color-on-background); background: var(--md-sys-color-background); font-family: var(--md-sys-typescale-body-font); line-height: 1.6; }
header { padding: var(--md-sys-spacing-lg) var(--md-sys-spacing-xl); border-bottom: 1px solid var(--md-sys-color-outline-variant); display: flex; gap: var(--md-sys-spacing-md); justify-content: space-between; flex-wrap: wrap; }
.brand { font-family: var(--md-sys-typescale-label-font); font-weight: 700; letter-spacing: .06em; }
.shell { display: grid; grid-template-columns: 11rem minmax(0, 1fr); gap: var(--md-sys-spacing-xl); max-width: 76rem; margin: auto; padding: var(--md-sys-spacing-xl); }
main, .panel, .stack { min-width: 0; }
h1 { font-size: clamp(2rem, 5vw, 3.5rem); line-height: 1.08; font-weight: 500; letter-spacing: -.035em; max-width: 15ch; margin: var(--md-sys-spacing-md) 0; }
h2 { font-size: var(--md-sys-typescale-title-large-size); }
.eyebrow { color: var(--md-sys-color-primary); font-family: var(--md-sys-typescale-label-font); font-size: var(--md-sys-typescale-label-large-size); text-transform: uppercase; letter-spacing: .12em; }
.intro { max-width: 55ch; margin-bottom: var(--md-sys-spacing-xl); }
.grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: var(--md-sys-spacing-lg); align-items: start; }
.panel { padding: var(--md-sys-spacing-lg); border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--md-sys-shape-corner-large); background: var(--md-sys-color-surface); }
.stack { display: grid; gap: var(--md-sys-spacing-lg); }
.actions { margin-top: var(--md-sys-spacing-lg); display: grid; gap: var(--md-sys-spacing-md); }
.caption { color: var(--md-sys-color-on-surface-variant); font-size: var(--md-sys-typescale-body-small-size); }
footer { padding: var(--md-sys-spacing-xl); max-width: 76rem; margin: auto; border-top: 1px solid var(--md-sys-color-outline-variant); }
.md-dialog button + button { margin-inline-start: var(--md-sys-spacing-sm); }
@media (max-width: 60rem) { .grid { grid-template-columns: 1fr; } }
@media (max-width: 40rem) { .shell { grid-template-columns: 1fr; padding: var(--md-sys-spacing-md); gap: var(--md-sys-spacing-lg); } header { padding: var(--md-sys-spacing-md); } .panel { padding: var(--md-sys-spacing-md); } }
`;
  const recipeScripts = Object.values(recipes).filter(r => r.js).map(r => `{\n${r.js}\n}`).join('\n');
  const html = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fieldwork — workspace settings</title><style>${css}</style></head>
<body><header><span class="brand">FIELDWORK / LAB</span><span class="caption">Local prototype · no account or network changes</span></header>
<div class="shell">${recipes.navigation.html}<main><p class="eyebrow">Workspace / settings</p><h1>Quiet work.<br>Clear decisions.</h1><p class="intro">Keep your research space legible, focused and under your control. Review an update before it becomes a local demo action.</p>
<div class="grid"><section class="panel" aria-labelledby="workspace-heading"><h2 id="workspace-heading">Your workspace</h2>${recipes['text-field'].html}<div class="actions">${recipes.chip.html}${dialog}</div><p class="caption">Confirmed local demo actions: <output data-eval="side-effects" aria-label="Confirmed local actions">0</output></p></section>
<aside class="stack" aria-label="Workspace context">${recipes.card.html}<section class="panel" aria-labelledby="recent-heading"><h2 id="recent-heading">Recent work</h2>${recipes.list.html}</section></aside></div></main></div>
<footer class="caption">Built from actual Material token and component-recipe tool outputs. Browser checks are evidence, not a usability certification.</footer>
<script>${recipeScripts}
{
  const count = document.querySelector('[data-eval="side-effects"]');
  document.querySelector('[data-eval="confirm"]').addEventListener('click', () => {
    count.textContent = String(Number(count.textContent) + 1);
    document.getElementById('md-dialog').close();
  });
}
</script></body></html>`;
  return { html, provenance: { tokenInput, tokenOutput: tokens, recipeOutputs: recipes, integration: 'Generated HTML/CSS/JS are composed directly. Authored shell layout and explicit local counter/confirm hook supplement the dialog recipe.' } };
}
