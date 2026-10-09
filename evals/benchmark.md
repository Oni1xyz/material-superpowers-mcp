# Evaluation protocol and evidence

## Status and scope

**Uplift: UNMEASURED.** Unit tests and this local UI fixture do not measure model improvement, user success, WCAG conformance, or visual-regression accuracy. No claim of “15% better” or similar is justified without the repeated experiment below.

The deterministic planner emits authored templates, not an LLM interpretation of arbitrary requirements. Free-text goals, unknown flows, component-specific acceptance, brand prose, visual quality, and real high-risk business effects remain explicit **outstanding manual checks**. Exact supported fixture flow names are `dialog` and `confirm-action`; spelling is not normalized or guessed.

## Reproduce the local browser evaluation

From the repository root, after core dependencies are installed from the pinned lockfile with scripts disabled:

```sh
npm test -- tests/planning.test.ts
npm run build
npm run evals:ui
# Optional installed browser override (no automatic download/install):
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run evals:ui
```

The harness prefers installed system Chrome, then Chromium, then an already installed Playwright Chromium binary. It creates an ephemeral HTTP server bound to `127.0.0.1`, blocks browser HTTP requests outside that exact origin, blocks WebSockets and service workers, serves only in-memory fixtures, and closes the browser and server in `finally`. It never fetches the plan's `https://metadata.invalid/not-fetched` metadata URL. The HTTP server has a restrictive CSP. Browser background networking is disabled where Chromium supports it; this is request isolation for the browser context, not an OS-level network sandbox.

`evals/ui/demo.ts` calls **actual** `material_generate_tokens` and `material_component_recipe` tool handlers. It composes returned token CSS and seven component recipes into a responsive research-workspace page. App integration adds a local side-effect counter and explicit confirmation button to the actual native-dialog recipe; it is not a production account backend. The report checks that the rendered primary CSS token equals the actual generated role.

The harness saves the emitted `material-eval-plan.mjs`, imports that exact artifact, and calls its `runGeneratedPlan` export. It does not replace generated checks with a handwritten lookalike. Each check is executed against a fresh navigation at mobile (390×844), tablet (768×1024), and desktop (1440×1000). Reported results have check IDs, breakpoint, actual pass/fail status, and evidence/error.

### Automated gates

- axe serious/critical violations: zero at each viewport. Lower-severity violations and incomplete rules are retained, not misrepresented as compliance.
- Real keyboard Tab reachability and a measurable computed outline/shadow change on the first visible control. Merely matching `:focus-visible` or being visible is insufficient. Contrast, clipping and all-control coverage remain manual.
- Native dialog opens, receives focus, dismisses with Escape, and returns focus to its opener.
- Explicit confirmation increments the instrumented local action counter exactly once; cancel and Escape do not increment it. Cancellation restores focus. Actual business persistence and network effects remain manual.
- No horizontal document/body overflow beyond one CSS-pixel tolerance.
- Authored strict reduced-motion policy: computed element animations/transitions ≤10 ms and no smooth scrolling. This is a project policy, not a universal WCAG rule. JS animation and pseudo-elements need additional review.
- Custom flow remains outstanding after automated checks pass.
- No observed outside-origin requests or page JavaScript errors.

### Independent acceptance and seeded failure

`evals/ui/acceptance.ts` does **not** import the planner or inspect its check list. It independently tests page semantics, horizontal overflow, and axe serious/critical at three fixed viewports. Its separately authored bad fixture contains a 2000-pixel-wide layout, an unnamed button and suppressed focus. Both the emitted runner and at least one independent gate must reject the bad fixture, while all good-fixture gates must pass. This checks that the harness can detect a real failure rather than simply blessing its own plan. It is not a substitute for held-out tests.

### Artifacts (ignored, regenerated)

All browser artifacts are under `artifacts/ui/`:

- `demo.html`, `seeded-bad.html`: exact served fixtures.
- `design-provenance.json`: actual token/recipe inputs and outputs.
- `plan.json`, `material-eval-plan.mjs`: exact generated plan and executable source.
- `report.json`: structured generated and independent results, browser version/path, network observations, counts and limitations.
- `good-{mobile,tablet,desktop}.png`, `bad-{mobile,tablet,desktop}.png`: screenshot captures.
- `failure.json`: diagnostic on a failed invocation; may be from an earlier invocation, so `report.json` and process exit status are authoritative for a completed run.

**Screenshots are captured, not compared.** There is no approved visual baseline and no visual-regression pass. A human must inspect and approve a baseline before a separate diff gate can be claimed. Browser errors, missing dependencies/browser, assertion failures and unrun experiments are blockers—not synthetic results.

## Repeated blinded A/B benchmark (not yet run)

### Freeze the experiment

1. Record commit, lockfile hash, corpus digest, model provider/model identifier and immutable revision if available, prompts, sampling parameters, seed where supported, environment, browser version, fonts, tool definitions and all budgets.
2. Select a training/development task set and freeze a separate held-out set before tuning. Include settings/forms, collections/navigation, error and empty states, dialogs, responsive layouts, unknown custom flows, high-risk cancellation/confirmation, brand constraints and accessibility faults. Keep at least one unrelated domain and unfamiliar wording held out.
3. Freeze an independently authored acceptance suite and task-specific assertions *before* looking at generated eval plans. Include a seeded-bad control and a known-good control. Generated plans may propose tests but must never replace this frozen suite.
4. Define the uplift metric and minimal meaningful effect **in advance**, along with sample count and analysis method. Do not choose a favorable threshold after viewing results.

### Conditions and equal budgets

- **A / baseline:** same task, repository starter and model; no Material MCP tools.
- **B / treatment:** same task, repository starter and model; Material MCP available with the documented deterministic tools.
- Keep exact model revision, context, total input/output token ceiling, elapsed-time allowance, retry allowance, and maximum tool-call count equal. Tool-result tokens count toward the treatment context budget; do not grant extra hidden reasoning, token or time budgets. Record actual consumption as well as ceilings. Permit the same general coding/test tools to both arms; only Material MCP availability differs.
- Run each task in fresh isolated worktrees/processes. Use at least five paired repetitions per task with the same seed when supported. Randomize arm order and record it. If provider sampling is nondeterministic, record that limitation rather than describing a seed as a guarantee.
- Store full prompts, tool traces, costs, durations, produced source and exit codes. Never discard failed generations, timeout runs, or failed installs from the denominator.

### Held-out and human review

- Run frozen independent tests against both arms, including keyboard traversal, no focus-indicator false pass, dialog Escape/focus return, error paths, reduced-motion, overflow, actual side-effect assertions, axe and seeded failures.
- Present screenshots and interactive tasks under randomized anonymous IDs, without tool logs or condition labels, to at least two independent reviewers. Include task completion observations; a screenshot cannot demonstrate operability.
- Use a predeclared 1–5 anchored rubric per dimension: task clarity/completion, information hierarchy, brand fit, responsive composition, keyboard/accessibility experience, state/error feedback, and maintainability/token consistency. Anchor 1 = missing or unusable, 3 = adequate with material issues, 5 = clear and correct with no material issue in the tested scenario. Require short evidence notes. Reviewers must not score their own authored output.
- Blindly adjudicate large disagreements and record inter-rater agreement. Exclude no task post hoc without a documented protocol violation applied equally to both arms.

### Analysis and reporting

Report per-task and aggregate independent pass rate, task completion, rubric distributions, failure types, tokens/time/cost and paired differences. Use task-level paired resampling/confidence intervals rather than treating every assertion on one page as an independent sample. Include negative and null results, missing data and sample size. Report held-out results separately from development tasks and compare effect uncertainty with the predeclared threshold.

Until those runs and reviews exist, leave model uplift **UNMEASURED**, human usability **NOT RUN**, and visual regression **NOT RUN**. Passing local unit and browser gates is valuable engineering evidence only.
