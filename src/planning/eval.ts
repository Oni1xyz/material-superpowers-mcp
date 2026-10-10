import type { EvalInput } from './schemas.js';
import { runnerSource } from './runner-source.js';

export interface EvalCheck {
  id: string;
  source: string;
  requirement: string;
  passCriteria: string;
  execution: 'runnable' | 'manual';
  status: 'not-run' | 'outstanding';
}

function check(id: string, source: string, requirement: string, passCriteria: string, execution: EvalCheck['execution'] = 'runnable'): EvalCheck {
  return { id, source, requirement, passCriteria, execution, status: execution === 'runnable' ? 'not-run' : 'outstanding' };
}

// JSON literal, never template interpolation or executable user expressions. Also safe
// when a client displays the artifact inside an HTML script element.
export function serializeData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function generateEvalPlan(input: EvalInput) {
  const flows = input.flows ?? [];
  const confirmation = flows.includes('confirm-action');
  const dialog = confirmation || flows.includes('dialog') || (input.components ?? []).includes('dialog');
  const checks: EvalCheck[] = [
    check('A11Y-AXE', 'Authored accessibility gate using axe; not a WCAG certification', 'Avoid detectable serious and critical accessibility defects.', 'axe reports zero serious or critical violations at each breakpoint; record lower impacts and incomplete rules.'),
    check('KEYBOARD-FOCUS', 'Authored measurable focus smoke gate; inspired by WCAG 2.4.7', 'The first visible interactive control is keyboard reachable and visibly focused.', 'Tab reaches the control and computed outline or nontransparent shadow visibly changes from its unfocused state; full keyboard coverage remains manual.'),
    check('LAYOUT-OVERFLOW', 'Authored responsive layout policy', 'No horizontal page overflow at selected viewport sizes.', 'Document/body scroll width does not exceed viewport width by more than one CSS pixel.'),
    check('MOTION-REDUCED', 'Authored strict reduced-motion policy, not a universal WCAG requirement', 'Honor prefers-reduced-motion.', 'With reduced motion, no computed animation or transition duration exceeds 10 ms and no smooth scrolling remains; active JS/pseudo-element motion still needs review.'),
    check('VISUAL-REVIEW', 'Independent human acceptance gate', 'Preserve hierarchy, brand, legibility and responsive composition.', 'Review captured screenshots. A visual regression pass requires an independently approved baseline and comparison; capture alone is NOT a pass.', 'manual'),
    check('TASK-SUCCESS', 'input.target (uninterpreted custom requirement)', input.target, 'A reviewer defines and exercises task-specific success, error and recovery assertions with representative users/data.', 'manual'),
    check('KEYBOARD-FULL', 'Independent human acceptance gate', 'All relevant controls and composite widgets are operable with a clear focus indicator.', 'Review every interactive control, tab order, focus contrast/occlusion, and widget-specific keys; the first-control smoke test is insufficient.', 'manual'),
  ];
  if (dialog) checks.push(check('DIALOG-ESCAPE', 'input.components/flows exact dialog contract', 'Dialog opens, receives focus, dismisses with Escape and restores focus.', 'The data-eval dialog contract opens a native dialog, contains focus, closes on Escape and returns focus to its opener.'));
  if (input.riskLevel === 'high' || confirmation) {
    const execution = confirmation ? 'runnable' : 'manual';
    checks.push(
      check('RISK-CONFIRM', 'input.riskLevel/high or exact confirm-action contract', 'Risky action needs explicit confirmation.', 'Opening confirmation has no recorded side effect; clicking explicit confirm causes exactly one fixture action and closes the dialog.', execution),
      check('RISK-CANCEL', 'input.riskLevel/high or exact confirm-action contract', 'Cancellation is available and safe.', 'Cancel closes the dialog, restores focus and leaves the side-effect counter unchanged.', execution),
      check('RISK-NO-SIDE-EFFECTS', 'input.riskLevel/high or exact confirm-action contract', 'Opening or dismissing without confirmation has no side effect.', 'Instrumented side-effect count is unchanged by opening and Escape dismissal; production side effects require independent verification.', execution),
      check('RISK-DOMAIN-REVIEW', 'Independent high-risk acceptance gate', 'Verify real business effects, authorization, recovery and retry safety.', 'Independently inspect persistence/network/audit evidence for cancellation, explicit confirmation and no unintended side effects; a DOM counter is not proof about a backend.', 'manual'),
    );
  }
  flows.forEach((flow, i) => {
    if (!['dialog', 'confirm-action'].includes(flow)) checks.push(check(`FLOW-CUSTOM-${i + 1}`, `input.flows[${i}] (uninterpreted)`, flow, 'Define concrete steps, locators, expected state and side-effect assertions; execute them before marking this custom flow passed.', 'manual'));
  });
  (input.components ?? []).forEach((component, i) => checks.push(check(`COMPONENT-${i + 1}`, `input.components[${i}]`, component, 'Verify this component’s states, semantic role, accessible name, keyboard interaction and target-size requirements; generic checks do not establish component conformance.', 'manual')));
  if (input.projectStyle) checks.push(check('PROJECT-STYLE', 'input.projectStyle (uninterpreted)', input.projectStyle, 'Human review translates style prose into explicit, verifiable criteria and reviews the rendered page.', 'manual'));
  const specification = {
    version: 1,
    status: 'not-run' as const,
    metadata: { target: input.target, ...(input.url ? { url: input.url } : {}), riskLevel: input.riskLevel, urlPolicy: 'Metadata only; never fetched. Execution requires a separate explicit loopback fixture URL.' },
    breakpoints: input.breakpoints ?? [{ name: 'mobile', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 1000 }],
    checks,
    fixtureContract: {
      dialog: '[data-eval="open-dialog"] opens dialog[data-eval="dialog"]; opener regains focus on Escape/cancel.',
      confirmation: '[data-eval="confirm"] commits one local fixture action; [data-eval="cancel"] dismisses without action; [data-eval="side-effects"] contains a nonnegative integer action count.',
      exactSupportedFlows: ['dialog', 'confirm-action'],
      note: 'Opt-in fixture hooks are required for runnable flow assertions. All other prose is explicitly outstanding, not a passing navigation smoke test.',
    },
    limitations: ['Authored deterministic plan, not an LLM analysis or official Material requirement set.', 'Serious/critical axe plus sampled checks are not exhaustive accessibility/usability certification.', 'Focus gate samples the first visible control; computed styles do not establish contrast or absence of occlusion.', 'Reduced-motion gate samples computed element CSS, not every dynamic state, pseudo-element or script animation.', 'Screenshot capture is not visual regression. Manual checks remain outstanding after automated success.', 'DOM side-effect instrumentation must be supplemented by independent production domain/network/persistence review.', 'Network policy rejects ALL HTTP 3xx responses, even same-origin redirects and 304; fixtures must serve direct responses. HTTP fetches time out after 10 seconds and fail closed.', 'Blocked-request evidence retains at most 100 sanitized 256-character origin/path samples with total and omitted counts; credentials, queries and fragments are removed, but paths may remain sensitive.'],
  };
  return {
    ...specification,
    artifact: {
      filename: 'material-eval-plan.mjs',
      mediaType: 'text/javascript',
      entrypoint: 'runGeneratedPlan(page, { url, AxeBuilder, screenshotPath? })',
      instructions: 'Save source as the fixed filename and import it from a separate Playwright >= 1.48 process. Create a fresh dedicated context with serviceWorkers: "block" before creating its page; this is a caller prerequisite because existing service workers and sockets cannot be retroactively isolated. Do not install competing page/context network routes or run plans concurrently in that context. Pass @axe-core/playwright AxeBuilder and an explicit http://127.0.0.1 local fixture URL. The runner blocks off-origin HTTP requests, ALL HTTP 3xx responses (including same-origin redirects and 304), and ALL WebSockets itself. Allowed HTTP requests use a single-hop fetch with maxRedirects: 0, maxRetries: 0 and a 10-second timeout before fulfillment; redirects and fetch failures abort rather than reaching another hop. It records attempts as NETWORK-ISOLATION failures and never fetches metadata URLs. blockedRequestCount is the total; blockedRequests retains at most 100 HTTP/WebSocket samples of at most 256 characters, with credentials, query strings and fragments removed; omittedBlockedRequestCount counts unretained samples. Redirect samples identify the initial request, not the Location target. Paths may still be sensitive; review reports before sharing. HTTP routes and per-run recording state are removed in finally. Playwright has no public WebSocket unroute API: one blocker per imported module/context remains for sequential reuse, without accumulating handlers; close the dedicated context in caller finally to dispose it. The function returns failures; caller must fail its process on report.status === "failed". Inspect all outstanding manual checks.',
      source: `export const specification = ${serializeData(specification)};\n${runnerSource}`,
    },
  };
}
