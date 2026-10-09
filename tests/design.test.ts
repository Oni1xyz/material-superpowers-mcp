import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import { argbFromHex, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities';
import { designTools } from '../src/tools/design.js';
import { badHtml, badCss, cleanHtml, cleanCss } from '../evals/design-fixtures.js';
import { contrastRatio } from '../src/design/tokens.js';
import { parseFragment } from 'parse5';
import { runInNewContext } from 'node:vm';
const run = (name: string, input: unknown = {}): any => designTools.find(t => t.name === name)!.run(input);

describe('Material design tools', () => {
  it('exports five validated tool definitions', () => {
    expect(designTools.map(t => t.name)).toEqual(['material_generate_tokens','material_map_brand_to_tokens','material_component_recipe','material_review_ui_code','material_review_tokens']);
    for (const t of designTools) expect(t.inputSchema.constructor.name).toBe('ZodObject');
  });
  for (const seedColor of ['#546a2f', '#123d8f']) for (const mode of ['light','dark','both']) {
    it(`generates real HCT roles and parseable CSS ${seedColor} ${mode}`, () => {
      const result = run('material_generate_tokens', { seedColor, mode });
      expect(() => postcss.parse(result.css)).not.toThrow();
      expect(Object.keys(result.schemes)).toEqual(mode === 'both' ? ['light','dark'] : [mode]);
      const expected = themeFromSourceColor(argbFromHex(seedColor));
      for (const [name, scheme] of Object.entries(result.schemes) as any) {
        expect(scheme.primary).toBe(hexFromArgb(expected.schemes[name as 'light'|'dark'].primary));
        expect(Object.keys(scheme).length).toBeGreaterThanOrEqual(40);
        expect(scheme['surface-container']).toMatch(/^#[0-9a-f]{6}$/);
      }
      for (const pair of result.contrast) { expect(pair.ratio).toBeGreaterThanOrEqual(4.5); expect(pair.meetsAAForNormalText).toBe(true); }
    });
  }
  it('defaults to olive both and labels authored profiles honestly', () => {
    const result = run('material_generate_tokens');
    expect(result.seedColor).toBe('#546a2f');
    expect(Object.keys(result.schemes)).toEqual(['light','dark']);
    expect(result.notes.join(' ')).toMatch(/authored|official/i);
    const minimal = run('material_generate_tokens', { styleProfile:'minimal', includeMotion:false, includeShape:false });
    expect(minimal.css).not.toContain('--md-sys-motion-');
    expect(minimal.css).not.toContain('--md-sys-shape-');
  });
  it('maps brand palettes to semantic rather than literal foreground roles', () => {
    const result = run('material_map_brand_to_tokens', { palette:{ primary:'#123d8f', secondary:'#546a2f' }, avoidGoogleLook:true });
    expect(result.mapping.primary.source).toBe('#123d8f');
    expect(result.mapping.secondary.source).toBe('#546a2f');
    expect(result.tokens.contrast.every((p: any) => p.ratio >= 4.5)).toBe(true);
    expect(() => postcss.parse(result.tokens.css)).not.toThrow();
  });
  for (const component of ['button','card','navigation','chip','text-field','dialog','snackbar','list']) {
    it(`provides working tokenized ${component} recipe`, () => {
      const result = run('material_component_recipe', { component, platform:'plain-html-css' });
      expect(result.html.length).toBeGreaterThan(30);
      expect(result.css).toContain('var(--md-sys-color-');
      expect(() => postcss.parse(result.css)).not.toThrow();
      expect(result.usage).toBeTruthy();
      expect(result.anatomy.length).toBeGreaterThan(0);
      expect(result.states.length).toBeGreaterThan(0);
      expect(result.accessibility.length).toBeGreaterThan(0);
    });
  }
  it('uses native dialog, pressed filter chips, static cards, and native disabled semantics', () => {
    const dialog = run('material_component_recipe', { component:'dialog' });
    expect(dialog.html).toContain('<dialog'); expect(dialog.js).toContain('showModal'); expect(dialog.js).toContain('.close(');
    const chip = run('material_component_recipe', { component:'chip', variant:'filter' });
    expect(chip.html).toContain('aria-pressed="false"'); expect(chip.js).toContain('aria-pressed');
    const card = run('material_component_recipe', { component:'card' });
    expect(card.html).not.toMatch(/tabindex|role="button"/); expect(card.states).not.toContain('disabled');
    expect(run('material_component_recipe',{component:'button'}).html).not.toContain('tabindex');
  });
  it('rejects unsupported platforms, variants and injection instead of pretending support', () => {
    expect(() => run('material_component_recipe',{component:'button',platform:'react'})).toThrow(/support/i);
    expect(() => run('material_component_recipe',{component:'button',variant:'invented'})).toThrow(/variant/i);
    expect(() => run('material_generate_tokens',{seedColor:'red; } body { display:none }'})).toThrow();
    expect(() => run('material_generate_tokens',{fontProfile:{body:'Inter; color:red'}})).toThrow();
    expect(() => run('material_component_recipe',{component:'button',variant:'</style><script>alert(1)</script>'})).toThrow();
  });
  it('finds concrete problems without claiming certification', () => {
    const result = run('material_review_ui_code',{html:badHtml,css:badCss});
    expect(result.findings.map((f:any)=>f.ruleId)).toEqual(expect.arrayContaining(['html-image-alt','html-input-label','html-click-semantics','css-focus-suppressed','css-literal-color','css-local-contrast']));
    for (const f of result.findings) { expect(f.evidence).toBeTruthy(); expect(f.fix).toBeTruthy(); expect(f.confidence).toBeTruthy(); }
    expect(result.limitations.join(' ')).toMatch(/cascade|runtime/i);
    expect(result.certification).toBe(false);
  });
  it('does not flag native focus, static cards, disabled buttons, or literal token values', () => {
    const result = run('material_review_ui_code',{html:cleanHtml,css:cleanCss});
    expect(result.findings).toEqual([]);
    expect(run('material_review_tokens',{css:run('material_generate_tokens').css}).findings).toEqual([]);
  });
  it('calculates WCAG contrast instead of presenting rounded or canned ratios', () => {
    expect(contrastRatio('#000000','#ffffff')).toBe(21);
    expect(contrastRatio('#123d8f','#123d8f')).toBe(1);
    expect(contrastRatio('#777','#fff')).toBeGreaterThan(4.47);
    expect(contrastRatio('#777','#fff')).toBeLessThan(4.5);
    expect(contrastRatio('#ffffff','#000000')).toBe(21);
  });
  it('honestly reports unsatisfied custom contrast constraints', () => {
    const result = run('material_map_brand_to_tokens',{palette:{brand:'#123d8f'},constraints:{minContrast:21}});
    expect(result.constraints.satisfied).toBe(false);
    expect(result.constraints.unmet.length).toBeGreaterThan(0);
    expect(() => run('material_map_brand_to_tokens',{palette:{}})).toThrow();
    expect(() => run('material_map_brand_to_tokens',{palette:{primary:'#fff'}})).toThrow();
  });
  for (const styleProfile of ['default','expressive','minimal','editorial','lab']) {
    it(`renders valid CSS and sane fonts for ${styleProfile}`, () => {
      const result = run('material_generate_tokens',{styleProfile,fontProfile:{display:'"Example Serif", Georgia, serif',body:'Inter, sans-serif',label:'ui-monospace, monospace'}});
      expect(() => postcss.parse(result.css)).not.toThrow();
      expect(result.tokens['--md-sys-typescale-display-font']).toBe('"Example Serif", Georgia, serif');
    });
  }
  it('rejects CSS-breaking fonts, unknown fields and unsupported states', () => {
    for (const body of ['"Unclosed','Inter</style>','Inter\\n; color:red','url(https://example.test/font)','Inter/*x*/']) expect(() => run('material_generate_tokens',{fontProfile:{body}})).toThrow();
    expect(() => run('material_component_recipe',{component:'card',states:['disabled']})).toThrow();
    expect(() => run('material_component_recipe',{component:'chip',variant:'assist',states:['selected']})).toThrow();
    expect(() => run('material_generate_tokens',{invented:'ignored?'})).toThrow();
  });
  it('renders every supported variant with parseable markup and CSS', () => {
    const matrix:Record<string,string[]>={button:['filled','tonal','outlined','text'],card:['elevated','filled','outlined'],navigation:['rail'],chip:['filter','assist'],'text-field':['outlined','filled'],dialog:['basic'],snackbar:['action','simple'],list:['static','linked']};
    for(const [component,variants] of Object.entries(matrix))for(const variant of variants){
      const result=run('material_component_recipe',{component,variant,density:'compact'});
      const errors:string[]=[];
      parseFragment(result.html,{onParseError:error=>errors.push(error.code)});
      expect(errors,`${component}/${variant}`).toEqual([]);
      expect(()=>postcss.parse(result.css)).not.toThrow();
      expect(()=>new Function(result.js)).not.toThrow();
    }
    expect(run('material_component_recipe',{component:'navigation-rail',platform:'web'}).html).toContain('<nav');
  });
  it('executes dialog open/close and filter toggles against event-target test doubles', () => {
    // Unit verification of generated JS, not a browser/AT test or fabricated DOM audit.
    class Element {
      attrs:Record<string,string>={}; callbacks:Record<string,(()=>void)[]>={}; open=false; focused=false; events:unknown[]=[];
      addEventListener(type:string,fn:()=>void){(this.callbacks[type]??=[]).push(fn);}
      fire(type:string){for(const fn of this.callbacks[type]??[])fn();}
      showModal(){this.open=true;} close(){this.open=false;this.fire('close');} focus(){this.focused=true;}
      getAttribute(key:string){return this.attrs[key]??null;} setAttribute(key:string,value:string){this.attrs[key]=value;}
      dispatchEvent(event:unknown){this.events.push(event);}
    }
    const dialog=new Element(), open=new Element(), close=new Element();
    const elements:Record<string,Element>={'md-dialog':dialog,'md-dialog-open':open,'md-dialog-close':close};
    runInNewContext(run('material_component_recipe',{component:'dialog'}).js,{document:{getElementById:(id:string)=>elements[id]}});
    open.fire('click');expect(dialog.open).toBe(true);
    close.fire('click');expect(dialog.open).toBe(false);expect(open.focused).toBe(true);
    const chip=new Element();chip.attrs['aria-pressed']='false';
    class Event { constructor(public type:string,public options:unknown){} }
    runInNewContext(run('material_component_recipe',{component:'chip'}).js,{document:{querySelectorAll:()=>[chip]},CustomEvent:Event});
    chip.fire('click');expect(chip.attrs['aria-pressed']).toBe('true');
    chip.fire('click');expect(chip.attrs['aria-pressed']).toBe('false');expect(chip.events).toHaveLength(2);
  });
  it('bounds cascade judgments and permits fallback variables and wrapped labels', () => {
    const result=run('material_review_ui_code',{html:'<label>Name <input></label><button disabled>Unavailable</button>',css:'button:focus { outline: none; box-shadow: 0 0 0 3px var(--focus); }'});
    expect(result.findings.some((f:any)=>f.ruleId==='html-input-label')).toBe(false);
    expect(result.findings.find((f:any)=>f.ruleId==='css-focus-suppressed').confidence).toBe('medium');
    const tokens=run('material_review_tokens',{css:':root { --x: var(--external, #fff); --y: var(--missing); }'});
    expect(tokens.findings.find((f:any)=>f.ruleId==='tokens-unresolved-reference').evidence).toContain('--missing');
    expect(tokens.findings.find((f:any)=>f.ruleId==='tokens-unresolved-reference').evidence).not.toContain('--external');
  });
  it('reports missing roles and parse failures as bounded findings', () => {
    expect(run('material_review_tokens',{css:':root { --md-sys-color-primary: #fff; }'}).findings.some((f:any)=>f.ruleId==='tokens-role-coverage')).toBe(true);
    expect(run('material_review_ui_code',{css:'.broken {'}).findings.some((f:any)=>f.ruleId==='css-parse')).toBe(true);
  });
});
