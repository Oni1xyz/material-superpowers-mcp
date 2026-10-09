import { z } from 'zod';
import { styleProfile } from './tokens.js';

export const recipeSchema = z.object({
  component:z.enum(['button','card','navigation','navigation-rail','chip','text-field','dialog','snackbar','list']),
  platform:z.enum(['web','plain-html-css','material-web','react']).default('plain-html-css'),
  variant:z.string().min(1).max(40).optional(), density:z.enum(['comfortable','compact','spacious']).default('comfortable'),
  states:z.array(z.string().min(1).max(40)).max(20).optional(),
  accessibility:z.object({targetSize:z.enum(['standard','large']).default('standard'),reducedMotion:z.boolean().default(true)}).strict().optional(),
  projectStyle:styleProfile.default('default'),
}).strict();
type Recipe = { usage:string; anatomy:string[]; variants:string[]; states:string[]; accessibility:string[]; html:string; css:string; js:string };
const interactive = ['default','hover','focus-visible','pressed','disabled'];
const focus = `.md-recipe :is(button,a,input):focus-visible, .md-recipe:is(button,a,input):focus-visible { outline: 3px solid var(--md-sys-color-primary); outline-offset: 3px; }
.md-recipe :is(button,a):hover:not(:disabled), .md-recipe:is(button,a):hover:not(:disabled) { box-shadow: var(--md-sys-elevation-1); }
.md-recipe :is(button,a):active:not(:disabled), .md-recipe:is(button,a):active:not(:disabled) { transform: translateY(1px); }
.md-recipe button:disabled, .md-recipe:disabled { opacity: .38; cursor: not-allowed; }`;
const control = `min-block-size: var(--recipe-target); padding: var(--recipe-pad) var(--md-sys-spacing-md); border: 1px solid transparent; border-radius: var(--md-sys-shape-corner-full, 999px); font-family: var(--md-sys-typescale-label-font); font-size: var(--md-sys-typescale-label-large-size); font-weight: var(--md-sys-typescale-label-large-weight); cursor: pointer;`;
const buttonCSS = `.md-button { ${control} color: var(--md-sys-color-on-primary); background: var(--md-sys-color-primary); }
.md-button--tonal { color: var(--md-sys-color-on-secondary-container); background: var(--md-sys-color-secondary-container); }
.md-button--outlined { color: var(--md-sys-color-primary); background: var(--md-sys-color-surface); border-color: var(--md-sys-color-outline); }
.md-button--text { color: var(--md-sys-color-primary); background: transparent; }`;
const specs: Record<string, {variants:string[]; states:string[]}> = {
  button:{variants:['filled','tonal','outlined','text'],states:interactive},
  card:{variants:['elevated','filled','outlined'],states:['default']},
  navigation:{variants:['rail'],states:['default','hover','focus-visible','pressed','current']},
  chip:{variants:['filter','assist'],states:[...interactive,'selected']},
  'text-field':{variants:['outlined','filled'],states:['default','hover','focus-visible','disabled','error','required','read-only']},
  dialog:{variants:['basic'],states:['closed','open','focus-visible']},
  snackbar:{variants:['action','simple'],states:['hidden','visible','dismissed']},
  list:{variants:['static','linked'],states:['default','hover','focus-visible','pressed','current']},
};
export function componentRecipe(input:z.infer<typeof recipeSchema>) {
  if (!['web','plain-html-css'].includes(input.platform)) throw new Error(`Unsupported platform "${input.platform}". This release supports plain-html-css (web alias) only; no framework adapter is implied.`);
  const name = input.component==='navigation-rail'?'navigation':input.component;
  const spec = specs[name]!;
  const variant = input.variant ?? spec.variants[0]!;
  if (!spec.variants.includes(variant)) throw new Error(`Unsupported ${name} variant "${variant}". Supported variants: ${spec.variants.join(', ')}.`);
  const allowedStates = name==='chip' && variant==='assist' ? interactive : name==='list'&&variant==='static'?['default']:spec.states;
  for (const state of input.states ?? []) if (!allowedStates.includes(state)) throw new Error(`Unsupported ${name}/${variant} state "${state}". Supported states: ${allowedStates.join(', ')}.`);
  const density = {comfortable:'12px',compact:'8px',spacious:'16px'}[input.density];
  const shape = {default:'var(--md-sys-shape-corner-medium, 12px)',expressive:'var(--md-sys-shape-corner-extra-large, 40px)',minimal:'var(--md-sys-shape-corner-small, 4px)',editorial:'var(--md-sys-shape-corner-small, 2px)',lab:'var(--md-sys-shape-corner-medium, 8px)'}[input.projectStyle];
  const common = `.md-recipe { --recipe-pad: ${density}; --recipe-target: ${input.accessibility?.targetSize==='large'?'56px':'48px'}; --recipe-shape: ${shape}; box-sizing: border-box; font-family: var(--md-sys-typescale-body-font); font-size: var(--md-sys-typescale-body-large-size); line-height: var(--md-sys-typescale-body-large-line-height); }
.md-recipe *, .md-recipe *::before, .md-recipe *::after { box-sizing: inherit; }
.md-recipe :is(button,a,input), .md-recipe:is(button,a,input) { transition: box-shadow var(--md-sys-motion-duration-short, 0ms) var(--md-sys-motion-easing-standard, ease); }
${focus}
@media (prefers-reduced-motion: reduce) { .md-recipe, .md-recipe * { transition: none; animation: none; } }
@media (forced-colors: active) { .md-recipe :is(button,a,input):focus-visible, .md-recipe:is(button,a,input):focus-visible { outline-color: Highlight; } }`;
  let r: Recipe;
  switch(name) {
    case 'button':
      r = {usage:'Use a filled button for the primary action; tonal, outlined, and text for progressively lower emphasis. Replace the label and connect a real action. Native disabled buttons are intentionally not in the tab order.',anatomy:['native button','action label'],variants:spec.variants,states:allowedStates,
        accessibility:['Use a verb-based visible label.','Use type="submit" only inside a form that should submit; the example is type="button".','Set the native disabled attribute when unavailable; do not add tabindex to disabled buttons.'],
        html:`<button class="md-recipe md-button md-button--${variant}" type="button">Save changes</button>`,css:buttonCSS,js:''}; break;
    case 'card':
      r = {usage:'Group related reading content in a static article. Add a separately labeled link or button for any action; the card itself is not a keyboard control.',anatomy:['article container','heading','supporting content'],variants:spec.variants,states:allowedStates,
        accessibility:['Keep heading levels consistent with the host page.','Do not add role="button", tabindex, hover affordance, or disabled state to a static card.'],
        html:`<article class="md-recipe md-card md-card--${variant}" aria-labelledby="md-card-title"><h2 id="md-card-title">Field notes</h2><p>Related context and next steps, grouped without implying that the entire card is clickable.</p></article>`,
        css:'.md-card { padding: var(--md-sys-spacing-lg); border-radius: var(--recipe-shape); color: var(--md-sys-color-on-surface); background: var(--md-sys-color-surface-container-low); }\n.md-card--elevated { box-shadow: var(--md-sys-elevation-1); }\n.md-card--filled { background: var(--md-sys-color-surface-container-highest); }\n.md-card--outlined { border: 1px solid var(--md-sys-color-outline-variant); box-shadow: none; }\n.md-card h2 { font-family: var(--md-sys-typescale-title-font); font-size: var(--md-sys-typescale-title-large-size); line-height: var(--md-sys-typescale-title-large-line-height); }',js:''}; break;
    case 'navigation':
      r = {usage:'Use a labeled navigation landmark for a small set of destinations. This rail becomes a horizontal wrapping navigation on narrow screens; replace the example hrefs with real routes.',anatomy:['navigation landmark','destination links','current destination'],variants:spec.variants,states:allowedStates,
        accessibility:['Use anchors for navigation, not buttons or tab roles.','Mark exactly the current page with aria-current="page"; no disabled destinations are demonstrated.','Links use normal Tab/Shift+Tab navigation. Arrow-key widget behavior is not implied.'],
        html:'<nav class="md-recipe md-rail" aria-label="Primary"><a href="/overview" aria-current="page">Overview</a><a href="/projects">Projects</a><a href="/notes">Notes</a></nav>',
        css:'.md-rail { display: flex; flex-direction: column; gap: var(--md-sys-spacing-sm); padding: var(--recipe-pad); background: var(--md-sys-color-surface-container); color: var(--md-sys-color-on-surface); max-inline-size: 16rem; }\n.md-rail a { display: flex; align-items: center; min-block-size: var(--recipe-target); padding: var(--recipe-pad); border-radius: var(--recipe-shape); color: inherit; text-decoration: none; font-family: var(--md-sys-typescale-label-font); }\n.md-rail a[aria-current="page"] { background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); font-weight: 700; text-decoration: underline; }\n@media (max-width: 40rem) { .md-rail { flex-direction: row; flex-wrap: wrap; max-inline-size: none; } }',js:''}; break;
    case 'chip': {
      const filter = variant==='filter';
      r = {usage:filter?'Toggle a filter independently. The button exposes pressed state; connect that state to your result filtering logic.':'Use an assist chip for a lightweight action. Connect its click to the application action.',anatomy:['native button','visible label',...(filter?['selected indicator']:[])],variants:spec.variants,states:allowedStates,
        accessibility:['Native buttons provide Enter/Space activation and focus behavior.',...(filter?['aria-pressed communicates the persistent selected state; keep the label stable.']:[]),'Set disabled only when the action is truly unavailable.'],
        html:`<button class="md-recipe md-chip" type="button"${filter?' data-md-filter aria-pressed="false"':''}>${filter?'<span class="md-chip-check" aria-hidden="true">✓</span> Available now':'Add reminder'}</button>`,
        css:`.md-chip { ${control} border-radius: var(--recipe-shape); border-color: var(--md-sys-color-outline); color: var(--md-sys-color-on-surface); background: var(--md-sys-color-surface); }
.md-chip[aria-pressed="true"] { background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); border-color: var(--md-sys-color-secondary); }
.md-chip-check { visibility: hidden; }
.md-chip[aria-pressed="true"] .md-chip-check { visibility: visible; }`,
        js:filter?`document.querySelectorAll('[data-md-filter]').forEach(chip => {
  chip.addEventListener('click', () => {
    const selected = chip.getAttribute('aria-pressed') !== 'true';
    chip.setAttribute('aria-pressed', String(selected));
    chip.dispatchEvent(new CustomEvent('material-filter-change', { bubbles: true, detail: { selected } }));
  });
});`:''}; break; }
    case 'text-field':
      r = {usage:'Use a persistent visible label and supporting text. The example validates required content on blur; replace it with domain-specific validation and native server/form validation.',anatomy:['label','input','supporting/error text'],variants:spec.variants,states:allowedStates,
        accessibility:['The label is explicitly associated with the input.','aria-describedby links help/error text; aria-invalid is set only after validation.','Native required, readonly, and disabled attributes supply their respective semantics.','Do not rely on placeholder text or color alone for labels or errors.'],
        html:`<div class="md-recipe md-field md-field--${variant}"><label for="md-project-name">Project name (required)</label><input id="md-project-name" name="projectName" type="text" required aria-describedby="md-project-help"><p id="md-project-help" aria-live="polite">Enter a descriptive name.</p></div>`,
        css:'.md-field { display: grid; gap: var(--md-sys-spacing-sm); color: var(--md-sys-color-on-surface); max-inline-size: 30rem; }\n.md-field label { font-family: var(--md-sys-typescale-label-font); }\n.md-field input { min-block-size: var(--recipe-target); inline-size: 100%; padding: var(--recipe-pad); color: var(--md-sys-color-on-surface); background: var(--md-sys-color-surface); border: 1px solid var(--md-sys-color-outline); border-radius: var(--recipe-shape); font: inherit; }\n.md-field--filled input { background: var(--md-sys-color-surface-container-highest); border-block-end-width: 2px; }\n.md-field input:hover:not(:disabled) { border-color: var(--md-sys-color-on-surface); }\n.md-field input[aria-invalid="true"] { border-color: var(--md-sys-color-error); }\n.md-field input[aria-invalid="true"] + p { color: var(--md-sys-color-error); }\n.md-field input:disabled { opacity: .38; }\n.md-field input:read-only { border-style: dashed; }\n.md-field p { margin: 0; font-size: var(--md-sys-typescale-body-small-size); }',
        js:`const input = document.getElementById('md-project-name');
const help = document.getElementById('md-project-help');
input.addEventListener('blur', () => {
  const invalid = !input.validity.valid;
  input.setAttribute('aria-invalid', String(invalid));
  help.textContent = invalid ? 'Enter a project name before continuing.' : 'Enter a descriptive name.';
});`}; break;
    case 'dialog':
      r = {usage:'Use for a decision that genuinely interrupts the current task. Load the script after the markup (or as a module). Native showModal supplies modality, focus containment, and Escape cancellation in supporting browsers.',anatomy:['invoking button','native dialog','heading','description','close action'],variants:spec.variants,states:allowedStates,
        accessibility:['Dialog name and description reference visible text.','Initial focus goes to the safe close action; closing restores focus to the invoker.','Escape uses native dialog cancellation. Test focus order, scroll, and announcements in target browser/AT combinations.'],
        html:'<div class="md-recipe"><button class="md-button" type="button" id="md-dialog-open">Review details</button><dialog class="md-dialog" id="md-dialog" aria-labelledby="md-dialog-title" aria-describedby="md-dialog-description"><h2 id="md-dialog-title">Review details</h2><p id="md-dialog-description">Check the information before continuing your work.</p><button class="md-button" type="button" id="md-dialog-close" autofocus>Close</button></dialog></div>',
        css:`${buttonCSS}\n.md-dialog { max-inline-size: min(32rem, calc(100vw - 2rem)); max-block-size: calc(100dvh - 2rem); overflow: auto; padding: var(--md-sys-spacing-lg); border: 0; border-radius: var(--recipe-shape); color: var(--md-sys-color-on-surface); background: var(--md-sys-color-surface-container-high); box-shadow: var(--md-sys-elevation-2); }\n.md-dialog::backdrop { background: var(--md-sys-color-scrim); opacity: .4; }`,
        js:`const dialog = document.getElementById('md-dialog');
const openButton = document.getElementById('md-dialog-open');
const closeButton = document.getElementById('md-dialog-close');
openButton.addEventListener('click', () => { if (!dialog.open) dialog.showModal(); });
closeButton.addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => openButton.focus());`}; break;
    case 'snackbar':
      r = {usage:'Use a nonmodal status for noncritical feedback. The demo shows a saved notification and explicit dismissal; it does not actually persist data. No short auto-dismiss timer or focus stealing is used.',anatomy:['trigger','persistent live region','visual notification','dismiss action'],variants:spec.variants,states:allowedStates,
        accessibility:['A pre-existing polite live region announces the inserted message.','The action sits outside role="status" so it is not confused with announcement text.','After keyboard dismissal focus returns to the demo invoker. The simple variant stays visible until application state changes.'],
        html:`<div class="md-recipe"><button class="md-button" id="md-snackbar-show" type="button">Preview saved notification</button><div class="md-snackbar" id="md-snackbar"><span id="md-snackbar-message" role="status" aria-live="polite" aria-atomic="true"></span>${variant==='action'?'<button id="md-snackbar-dismiss" type="button" hidden>Dismiss</button>':''}</div></div>`,
        css:`${buttonCSS}\n.md-snackbar { position: fixed; inset-inline: var(--md-sys-spacing-md); inset-block-end: var(--md-sys-spacing-md); max-inline-size: 36rem; margin-inline: auto; z-index: 10; display: flex; align-items: center; gap: var(--md-sys-spacing-md); border-radius: var(--recipe-shape); background: var(--md-sys-color-inverse-surface); color: var(--md-sys-color-inverse-on-surface); }
.md-snackbar[data-visible="true"] { padding: var(--recipe-pad) var(--md-sys-spacing-md); box-shadow: var(--md-sys-elevation-2); }
.md-snackbar button { ${control} color: var(--md-sys-color-inverse-primary); background: transparent; }
.md-snackbar button:focus-visible { outline-color: var(--md-sys-color-inverse-primary); }
.md-snackbar button[hidden] { display: none; }`,
        js:`const showButton = document.getElementById('md-snackbar-show');
const snackbar = document.getElementById('md-snackbar');
const message = document.getElementById('md-snackbar-message');
const dismiss = document.getElementById('md-snackbar-dismiss');
showButton.addEventListener('click', () => {
  snackbar.dataset.visible = 'true'; message.textContent = 'Changes saved (demo).';
  if (dismiss) dismiss.hidden = false;
});
if (dismiss) dismiss.addEventListener('click', () => {
  message.textContent = ''; delete snackbar.dataset.visible; dismiss.hidden = true; showButton.focus();
});`}; break;
    default: {
      const linked = variant==='linked';
      r = {usage:linked?'Use a linked list for related destinations. Replace example routes with working application URLs.':'Use a semantic list for grouped noninteractive information; no keyboard interaction is implied.',anatomy:['unordered list','list items','primary text','supporting text'],variants:spec.variants,states:allowedStates,
        accessibility:['Use ul/li semantics rather than a listbox unless you implement the full selection widget pattern.',linked?'Each item has one clearly named link; mark a current destination with aria-current if relevant.':'Static items are not focusable or clickable.'],
        html:`<ul class="md-recipe md-list"><li>${linked?'<a href="/notes/fieldwork">':'<div>'}<strong>Fieldwork notes</strong><span>Observations and open questions</span>${linked?'</a>':'</div>'}</li><li>${linked?'<a href="/notes/experiments">':'<div>'}<strong>Experiment log</strong><span>Methods and results</span>${linked?'</a>':'</div>'}</li></ul>`,
        css:'.md-list { list-style: none; margin: 0; padding: 0; color: var(--md-sys-color-on-surface); background: var(--md-sys-color-surface); }\n.md-list li + li { border-block-start: 1px solid var(--md-sys-color-outline-variant); }\n.md-list li > :is(div,a) { display: grid; gap: var(--md-sys-spacing-xs); padding: var(--recipe-pad) var(--md-sys-spacing-md); min-block-size: var(--recipe-target); color: inherit; }\n.md-list a { text-decoration: none; border-radius: var(--recipe-shape); }\n.md-list a[aria-current="page"] { background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); text-decoration: underline; }\n.md-list span { font-size: var(--md-sys-typescale-body-medium-size); color: var(--md-sys-color-on-surface-variant); }',js:''};
    }
  }
  return {component:input.component,platform:'plain-html-css',variant,density:input.density,projectStyle:input.projectStyle,...r,css:`${common}\n${r.css}`,requestedStates:input.states ?? [],
    integration:['Load material_generate_tokens CSS before recipe CSS. Shape/motion have fallbacks if omitted.','Example IDs are scoped to a single instance; rename IDs and corresponding script lookups when duplicating.','Load JavaScript once, after the markup or using a module script. Wire application actions and replace example URLs.','States describe supported behavior and native attributes, not separate screenshot fixtures.','Profiles are authored styling adaptations, not official Expressive certification.'],
    limitations:['Only plain HTML/CSS with optional vanilla JavaScript is implemented. No React or Material Web adapter is supplied.','This is a starter recipe, not a browser/assistive-technology audit. Test in the host page with its cascade and content.',...(input.accessibility?.reducedMotion===false?['Reduced-motion protection remains enabled as a safe baseline even when reducedMotion=false.']:[])]};
}
