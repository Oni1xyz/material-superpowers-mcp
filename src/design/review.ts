import { z } from 'zod';
import postcss, { type Root, type Rule, type ChildNode } from 'postcss';
import { parseFragment } from 'parse5';
import { contrastPairs, contrastRatio, styleProfile } from './tokens.js';

const source = z.string().max(200_000);
export const uiReviewSchema = z.object({html:source.optional(),css:source.optional(),component:z.string().min(1).max(80).optional(),goals:z.array(z.string().min(1).max(300)).max(20).optional()}).strict();
export const tokenReviewSchema = z.object({css:source.min(1),targetStyle:styleProfile.optional()}).strict();
type Finding = {ruleId:string;severity:'warning'|'info';confidence:'high'|'medium'|'low';evidence:string;fix:string;line?:number};
const reviewLimits = { maxFindings:100, maxEvidenceCharacters:2048, maxTotalEvidenceCharacters:32_768 } as const;
const truncationMarker = '… [truncated]';

/** One shared budget per report. Evidence is lazy and sliced before concatenation:
 * never allocate a full selector/attribute/variable list for every finding. Counts
 * still cover every detected finding, including ones not retained in the report. */
class Findings {
  readonly items:Finding[]=[];
  total=0;
  truncatedEvidenceCount=0;
  omittedEvidenceCharacterCount=0;
  private evidenceCharacters=0;
  push(finding:Omit<Finding,'evidence'> & {evidence:()=>readonly string[]}) {
    this.total++;
    const remaining=reviewLimits.maxTotalEvidenceCharacters-this.evidenceCharacters;
    if(this.items.length>=reviewLimits.maxFindings || remaining<truncationMarker.length)return;
    const parts=finding.evidence();
    const fullLength=parts.reduce((n,part)=>n+part.length,0);
    const limit=Math.min(reviewLimits.maxEvidenceCharacters,remaining);
    const truncated=fullLength>limit;
    let available=truncated?limit-truncationMarker.length:limit;
    const kept:string[]=[];
    for(const part of parts) {
      if(!available)break;
      const count=Math.min(part.length,available);
      kept.push(part.slice(0,count));
      available-=count;
    }
    if(truncated) {
      this.truncatedEvidenceCount++;
      this.omittedEvidenceCharacterCount+=fullLength-(limit-truncationMarker.length);
      kept.push(truncationMarker);
    }
    const evidence=kept.join('');
    this.evidenceCharacters+=evidence.length;
    this.items.push({...finding,evidence});
  }
}
const limitations = [
  'Advisory static analysis only: no browser, computed styles, JavaScript execution, layout, screen-reader testing, or network access.',
  'The complete cascade, inheritance, pseudo states, media/container queries, external styles, custom elements, shadow DOM, and runtime changes are unknown. Findings are review candidates, not definitive rendered failures.',
  'Absence of custom focus CSS is not a failure: native user-agent focus can suffice. A replacement focus treatment may exist elsewhere.',
  'Contrast is calculated only for opaque hexadecimal color pairs declared together in the inspected rule or token block. Font size, transparency, images, overlap, and unresolved dynamic variables need rendered checks.',
  'This report is not a WCAG certificate; no findings does not mean the interface is accessible or Material-conformant.',
];
function finish(findings:Findings,context:Record<string,unknown>={}) {
  return {kind:'advisory-static-review',certification:false,findings:findings.items,
    summary:{findingCount:findings.items.length,highConfidence:findings.items.filter(f=>f.confidence==='high').length,totalFindingCount:findings.total},
    truncation:{...reviewLimits,omittedFindingCount:findings.total-findings.items.length,truncatedEvidenceCount:findings.truncatedEvidenceCount,omittedEvidenceCharacterCount:findings.omittedEvidenceCharacterCount,
      countScope:'Finding and high-confidence counts describe retained findings; totalFindingCount includes omitted findings. Evidence truncation counts describe retained findings only.'},
    ...context,limitations};
}
const opaqueHex = (value:string) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
function readCss(css:string, findings:Findings):Root | undefined {
  try { return postcss.parse(css,{from:undefined}); } catch(error) {
    findings.push({ruleId:'css-parse',severity:'warning',confidence:'high',evidence:()=>[error instanceof Error?error.message:'CSS could not be parsed.'],fix:'Correct the CSS syntax before relying on further static style checks.'}); return undefined;
  }
}
function declarations(rule:Rule):Record<string,string> {
  const out:Record<string,string>=Object.create(null);
  for(const node of rule.nodes)if(node.type==='decl')out[node.prop]=node.value.trim();
  return out;
}
// PostCSS's convenience walkers recurse. An indexed stack visits each node once
// without call-stack growth or repeatedly copying/slicing the unvisited siblings.
function* cssNodes(root:Root):Generator<ChildNode> {
  const stack=[{nodes:root.nodes,index:0}];
  while(stack.length) {
    const frame=stack[stack.length-1]!;
    if(frame.index===frame.nodes.length){stack.pop();continue;}
    const node=frame.nodes[frame.index++]!;
    yield node;
    if('nodes' in node && node.nodes?.length)stack.push({nodes:node.nodes,index:0});
  }
}
function analyzeCss(root:Root,findings:Findings) {
  for(const decl of cssNodes(root)) {
    if(decl.type!=='decl'||decl.prop.startsWith('--'))continue; // literal color values belong in token definitions
    const selector = decl.parent?.type==='rule' ? decl.parent.selector : '(declaration)';
    const evidence=()=>[selector,': ',decl.prop,': ',decl.value];
    const loc = decl.source?.start?.line;
    if (/^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|box-shadow|fill|stroke)$/i.test(decl.prop) && /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|lab)\s*\(/i.test(decl.value)) findings.push({
      ruleId:'css-literal-color',severity:'info',confidence:'high',evidence,fix:'Where this is a reusable UI role, move the literal into a semantic custom property. Brand illustrations and isolated data visualizations can be intentional exceptions.',line:loc,
    });
    if ((decl.prop==='outline'&&/^(?:none|0(?:px)?)(?:\s|$)/i.test(decl.value)) || (decl.prop==='outline-width'&&/^0(?:px)?$/.test(decl.value))) findings.push({
      ruleId:'css-focus-suppressed',severity:'warning',confidence:'medium',evidence,fix:'Verify the focused rendered state. Keep the native outline or supply an equally visible focus indicator; another rule, border, or shadow may already provide one.',line:loc,
    });
  }
  for(const rule of cssNodes(root)) {
    if(rule.type!=='rule')continue;
    const d=declarations(rule), foreground=d.color, background=d['background-color']??d.background;
    if (foreground&&background&&opaqueHex(foreground)&&opaqueHex(background)) {
      const ratio=contrastRatio(foreground,background);
      if(ratio<4.5) findings.push({ruleId:'css-local-contrast',severity:'warning',confidence:'medium',evidence:()=>[rule.selector,`: ${foreground} on ${background} has ${ratio.toFixed(3)}:1 opaque sRGB contrast.`],fix:'For normal text, choose a pair at least 4.5:1. Large text has a 3:1 threshold. Confirm computed colors, text size, and backgrounds; this declaration pair alone is not a rendered WCAG verdict.',line:rule.source?.start?.line});
    }
  }
}
// A small structural view avoids tying the walker to parse5's tree-adapter internals.
type HtmlNode = {nodeName:string;tagName?:string;attrs?:{name:string;value:string}[];childNodes?:HtmlNode[];parentNode?:HtmlNode;value?:string;sourceCodeLocation?:{startLine:number};content?:HtmlNode};
function analyzeHtml(html:string,findings:Findings) {
  const nodes:HtmlNode[]=[];
  const fragment=parseFragment(html,{sourceCodeLocationInfo:true}) as unknown as HtmlNode;
  const stack=[fragment];
  const attributes=new Map<HtmlNode,Record<string,string>>();
  while(stack.length) {
    const node=stack.pop()!;
    nodes.push(node);
    attributes.set(node,Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value])));
    const children=node.childNodes??[];
    for(let i=children.length-1;i>=0;i--)stack.push(children[i]!);
  }
  // Name checks only need a non-whitespace bit, not a repeatedly concatenated
  // descendant string. Index labels/IDs once rather than searching per control.
  const hasText=new Set<HtmlNode>();
  for(let i=nodes.length-1;i>=0;i--) {
    const node=nodes[i]!;
    if(node.value?.trim() || node.childNodes?.some(child=>hasText.has(child)))hasText.add(node);
  }
  const ids=new Map<string,HtmlNode>(),labels=new Set<string>(),wrapped=new Set<HtmlNode>();
  for(const node of nodes) {
    const a=attributes.get(node)!;
    if(a.id)ids.set(a.id,node);
    if(node.tagName==='label'&&a.for&&hasText.has(node))labels.add(a.for);
    if(node.parentNode&&(wrapped.has(node.parentNode)||(node.parentNode.tagName==='label'&&hasText.has(node.parentNode))))wrapped.add(node);
  }
  const accessibleName=(node:HtmlNode):boolean=>{
    const a=attributes.get(node)!;
    if(a['aria-label']?.trim())return true;
    // Scan this attribute once; shared referenced text is never rescanned.
    for(const match of (a['aria-labelledby']??'').matchAll(/\S+/g)) {
      const target=ids.get(match[0]);
      if(target&&hasText.has(target))return true;
    }
    return false;
  };
  for(const node of nodes) {
    if(!node.tagName)continue;
    const a=attributes.get(node)!,line=node.sourceCodeLocation?.startLine;
    const evidence=()=>['<',node.tagName!,...(a.id?[' id="',a.id,'"']:[]),'>',...(line?[` at line ${line}`]:[])];
    if(node.tagName==='img'&&!('alt' in a)&&!accessibleName(node))findings.push({ruleId:'html-image-alt',severity:'warning',confidence:'high',evidence,fix:'Provide meaningful alt text, or alt="" for a purely decorative image. Confirm its purpose in context.',line});
    if(['input','select','textarea'].includes(node.tagName)&&!['hidden','submit','button','reset','image'].includes(a.type??'')) {
      const label=!!a.id&&labels.has(a.id);
      if(!label&&!wrapped.has(node)&&!accessibleName(node)&&!a.title?.trim())findings.push({ruleId:'html-input-label',severity:'warning',confidence:'medium',evidence,fix:'Add a persistent visible label using for/id or a wrapping label. No associated name was found within this fragment; an external aria-labelledby target or runtime label cannot be checked.',line});
    }
    if('onclick' in a&&!['button','input','select','textarea','summary'].includes(node.tagName)&&!(node.tagName==='a'&&a.href))findings.push({ruleId:'html-click-semantics',severity:'warning',confidence:'medium',evidence:()=>[...evidence(),' has an inline onclick handler',...(a.role?[' and role="',a.role,'"']:[]),'.'],fix:'Prefer a native button for actions or anchor for navigation. If a custom widget is intentional, manually verify focusability, keyboard activation, role, name, and state; runtime handlers cannot be inspected here.',line});
    if(node.tagName==='button'&&!hasText.has(node)&&!accessibleName(node)&&!(node.childNodes??[]).some(n=>n.tagName==='img'&&attributes.get(n)!.alt?.trim()))findings.push({ruleId:'html-button-name',severity:'warning',confidence:'medium',evidence,fix:'Provide visible button text or an accessible name for an icon-only control. External/runtime labels may be outside this fragment.',line});
    if(a.tabindex&&/^\d+$/.test(a.tabindex)&&Number(a.tabindex)>0)findings.push({ruleId:'html-positive-tabindex',severity:'warning',confidence:'high',evidence:()=>[...evidence(),' tabindex="',a.tabindex!,'"'],fix:'Prefer natural DOM focus order and tabindex="0" only for custom controls; avoid positive values.',line});
    if(a.style){const root=readCss(`.inline-style { ${a.style} }`,findings);if(root)analyzeCss(root,findings);}
    // HTML style elements are raw-text elements; their immediate text is enough.
    if(node.tagName==='style'){const root=readCss((node.childNodes??[]).map(n=>n.value??'').join(''),findings);if(root)analyzeCss(root,findings);}
  }
}
export function reviewUi(input:z.infer<typeof uiReviewSchema>) {
  if(!input.html?.trim()&&!input.css?.trim())throw new Error('Provide HTML or CSS to review.');
  const findings=new Findings();
  if(input.html)analyzeHtml(input.html,findings);
  if(input.css){const root=readCss(input.css,findings);if(root)analyzeCss(root,findings);}
  return finish(findings,{scope:{html:!!input.html,css:!!input.css,component:input.component??null,goals:input.goals??[]},goalHandling:'Component and goals are reported as context. Only the listed deterministic rules are evaluated; no semantic or subjective goal-satisfaction inference is made.',checkedRules:['html-image-alt','html-input-label','html-click-semantics','html-button-name','html-positive-tabindex','css-parse','css-literal-color','css-focus-suppressed','css-local-contrast']});
}
export function reviewTokens(input:z.infer<typeof tokenReviewSchema>) {
  const findings=new Findings(); const root=readCss(input.css,findings);
  if(!root)return finish(findings,{targetStyle:input.targetStyle??null});
  const defined=new Set<string>();
  for(const d of cssNodes(root))if(d.type==='decl'&&d.prop.startsWith('--'))defined.add(d.prop);
  const required=[...new Set(contrastPairs.flat())].map(role=>`--md-sys-color-${role}`);
  const missing=required.filter(role=>!defined.has(role));
  if(missing.length)findings.push({ruleId:'tokens-role-coverage',severity:'warning',confidence:'medium',evidence:()=>['Not declared in supplied CSS: ',missing.join(', ')],fix:'Declare the missing semantic role pairs, or verify that an imported/host stylesheet supplies them. Partial token overrides are valid and need not repeat every role.'});
  const unresolved=new Set<string>();
  for(const d of cssNodes(root)) {
    if(d.type!=='decl')continue;
    // A fallback makes an undefined variable intentional rather than a missing reference.
    for(const match of d.value.matchAll(/var\(\s*(--[\w-]+)\s*\)/g))if(!defined.has(match[1]!))unresolved.add(match[1]!);
  }
  if(unresolved.size)findings.push({ruleId:'tokens-unresolved-reference',severity:'warning',confidence:'medium',evidence:()=>['Referenced without a local declaration or fallback: ',...[...unresolved].flatMap((name,i)=>i?[', ',name]:[name])],fix:'Supply these variables in the host theme or add fallbacks. Imports and inherited host values are not resolved by this tool.'});
  for(const rule of cssNodes(root)) {
    if(rule.type!=='rule')continue;
    const d=declarations(rule);
    for(const [background,foreground] of contrastPairs) {
      const bg=d[`--md-sys-color-${background}`],fg=d[`--md-sys-color-${foreground}`];
      if(!bg||!fg||!opaqueHex(bg)||!opaqueHex(fg))continue;
      const ratio=contrastRatio(bg,fg);
      if(ratio<4.5)findings.push({ruleId:'tokens-pair-contrast',severity:'warning',confidence:'high',evidence:()=>[rule.selector,`: ${foreground} ${fg} on ${background} ${bg} = ${ratio.toFixed(3)}:1.`],fix:'Choose role tones with at least 4.5:1 for normal text, or document a large-text-only use at 3:1. Verify the actual cascade and rendering.',line:rule.source?.start?.line});
    }
  }
  return finish(findings,{definedTokenCount:defined.size,missingRoles:missing,targetStyle:input.targetStyle??null,styleAssessment:'Style profile is a design direction, not a statically provable property. Review typography, shape, density, and brand intent in context; no official Expressive conformance is inferred.',checkedRules:['css-parse','tokens-role-coverage','tokens-unresolved-reference','tokens-pair-contrast']});
}
