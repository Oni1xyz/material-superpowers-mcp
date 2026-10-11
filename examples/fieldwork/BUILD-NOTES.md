# FIELDWORK — build notes

A fictional expedition planner, implemented by the agent in plain HTML, CSS, JavaScript, and original SVG. The local Material MCP server supplied documentation, generated tokens, a deterministic source review, and an evaluation plan. **The MCP server did not autonomously build the application.**

## Brief

Delegated build task: “Build polished FIELDWORK expedition-planning showcase using real local MCP calls, verify browser, provide provenance and actual review correction.”

The delegated design brief specified “Find your next way out.”, a forest/lime/cream outdoor field-guide identity, original cartographic illustrations, itinerary cards, working terrain filters, trip details, packing controls, a theme toggle, and desktop/mobile layouts. All routes, distances, dates, itineraries, and the FIELDWORK brand are fictional demo material. No real trail or weather service is connected.

## Run it

From the repository root:

```sh
python3 -m http.server 8794 --bind 127.0.0.1 --directory examples/fieldwork
# Open http://127.0.0.1:8794/
```

There is no application build step and no external asset, font, CDN, or runtime package. The app uses browser-local storage under `fieldwork-demo-v1`. Clear that key to reset the demo. If storage is unavailable, changes remain usable for the current visit. The three route cards remain readable without JavaScript.

For the reproducible browser checks, use the repository's existing dev dependencies:

```sh
node examples/fieldwork/check.mjs
# Optional browser override:
CHROME=/path/to/chrome node examples/fieldwork/check.mjs
```

The check script starts and stops its own loopback server. It writes raw captures and JSON into ignored `artifacts/readme-showcase/`, not into this example. It does not install dependencies. It requires Playwright and `@axe-core/playwright` from the repository and a local Chrome executable.

## Real MCP use and provenance

The build connected with `@modelcontextprotocol/sdk` using stdio, `node dist/index.js`, repository-root cwd, and `MATERIAL_CACHE_DIR` pointing to the absolute repository `.cache/material` directory. Tool input schemas were inspected with `listTools` before calls. The previous comparison bridge was inspected but not reused: its evidence destination belonged to another experiment.

| Actual tool call | Arguments / input | What was used |
| --- | --- | --- |
| `material_navigate` | `{"query":"filter chips accessibility selection","limit":4}` | Found the canonical chips accessibility note. Search also returned authored routing notes; these were not treated as official specifications. |
| `material_navigate` | `{"id":"docs/components/chips/accessibility.md","limit":8}` | Followed the exact note and its canonical `readDoc` action. |
| `material_read_doc` | `{"path":"components/chips/accessibility","maxCharacters":9000}` | Read the full returned accessibility section (`hasMore:false`). Implemented button semantics, visible selected states, keyboard activation, arrow-key focus movement, explicit terrain-group labeling, wrapping rather than horizontally hidden chips, and 48px chip targets. |
| `material_generate_tokens` | `{"seedColor":"#245641","mode":"both","styleProfile":"editorial","fontProfile":{"display":"Georgia, serif","body":"Arial, sans-serif","label":"Arial, sans-serif"},"includeMotion":true,"includeShape":true}` | Saved its actual CSS as `tokens.css`. Used HCT primary/on-primary roles for modal actions, primary for progress/checkboxes/focus, outline for chips, font roles, motion duration, and elevation. |
| `material_review_ui_code` | Full `index.html`; concatenated `tokens.css` and `style.css`; component `FIELDWORK expedition planner`; goals: semantic controls, token-based themes, focus/selection, responsive cards | Initial review returned six informational literal-color findings. Corrected the reusable UI roles and reran the same review. |
| `material_generate_eval_plan` | Target `FIELDWORK static expedition planner`; URL `http://127.0.0.1:8794/`; components `chip`, `dialog`, `button`, `checkbox`; five flows (terrain filter, Escape, save, packing, theme); desktop 1280×850 and mobile 390×844; risk `medium`; style `editorial forest and cream` | Saved and actually executed its generated Playwright source in isolated contexts, for both themes. Added separate application-specific assertions in `check.mjs`; the generic plan does not implement arbitrary prose flows. |

The canonical source was [Google Material Design — Chips: Accessibility](https://m3.material.io/components/chips/accessibility), from the local official-source snapshot:

- Corpus: `34f48f6acf15809e02e4760b25d28104d11ef41754769ee86667b8af9958da51`
- Source document SHA-256: `bd83cd0e90b974fba0ec5718e92520a70bc59c10af5ef5cee87d7d0dde979aa0`
- Source block pointers used: `d92c68ac-8891-40eb-b477-cc5b57c908c8` (interaction semantics), `0a235e1f-7c2f-484b-b495-d7968f1049d9` (horizontal overflow), `907ed59d-0d60-4758-819b-aa005a8a28ef` (target sizing), `d7f23b81-cf5c-4f99-91e2-5c96f27268a6` (keyboard navigation), and `b6a30f1e-be77-49cd-8edb-d9b73226e2bb` (showing chip interactivity).

`style.css` is an authored adaptation: warm paper, deep forest, lime, layout, and shape choices override or supplement the generated foundation. Generated “editorial” is an MCP-authored profile, not an official Material component implementation. The HTML components, behavior, copy, and all five SVG files are original agent-authored work, not downloaded Material components or illustrations. No Google endorsement, official conformance, or complete specification coverage is claimed.

## Review → actual correction

### MCP source review: six informational findings → zero findings

The initial, already-built application was submitted to the actual `material_review_ui_code` handler. It returned rule `css-literal-color` with **info** severity and **high** confidence for four `.map-pin` declarations, the dialog shadow, and the modal scrim. These are reusable UI roles, so the guidance was valid. This was a maintainability/theming correction, **not a detected contrast or accessibility failure**.

| Before, exact declaration | After |
| --- | --- |
| `.map-pin` — `border: 1px solid #6c7852` | `border: 1px solid var(--map-control-outline)` |
| `.map-pin` — `background: #fffef0` | `background: var(--map-control-surface)` |
| `.map-pin` — `color: #254333` | `color: var(--map-control-ink)` |
| `.map-pin` — `box-shadow: 0 4px 16px #173e3020` | `box-shadow: 0 4px 16px var(--map-control-shadow)` |
| `dialog` — `box-shadow: 0 24px 90px #00000040` | `box-shadow: 0 24px 90px var(--dialog-shadow)` |
| `dialog::backdrop` — `background: #10241c99` | `background: var(--dialog-scrim)` |

The six values were moved into named `:root` properties without changing their appearance. Fixed colors inside the original SVG illustrations remain intentional artwork, not theme roles. A real rerun returned `findingCount:0`; that only means no findings from the bounded static rules, not a certification. No defect was deliberately inserted to obtain a finding.

### Separate browser-discovered keyboard correction

The custom browser check initially failed `native dialog contains reverse tab`. A focused reproduction recorded:

1. On opening: `BUTTON#dialog-close`.
2. After axe and screenshot capture: still `BUTTON#dialog-close`.
3. After **Shift+Tab**: `BODY`, outside the dialog.
4. After **Tab**: `BUTTON#dialog-close` again.

This was a Chrome tab-boundary behavior, not a finding from the static MCP reviewer. Added a modal `keydown` handler to wrap Shift+Tab from the first action to the last action, and Tab from the last action to the first. Also added a fallback to “Find another route” if saving/removing a route deletes its original opener. The final browser suite verifies modal containment in both directions and Escape focus restoration in all four viewport/theme combinations.

An earlier probe without the same audit/capture steps did not reproduce the boundary behavior; the controlled sequence above did. Raw evidence preserves the successful reproduction, not a claim that every native dialog always loses focus.

### Visual iteration

Agent inspection of real screenshots found that the original desktop layout pushed card metadata below the 850px viewport, and hiding the mobile headline's `<br>` joined “the” and “scenic”. Added the missing whitespace and tightened desktop vertical spacing while retaining 48px button targets. Added a solid map-legend backing to prevent labels and legend text colliding. These were agent visual corrections, not MCP-reported findings. The desktop working surface now shows all three full route cards at 1280×850; mobile stacks the same content and scrolls normally.

The initial site was preserved only after the real source-review findings, under ignored `artifacts/readme-showcase/pre-review/`. Raw MCP responses, source-review inputs, original/final captures, and browser reports also stay ignored. They are not embedded in public documentation.

## Verification and limits

- Custom browser suite: **119 assertions passed**, across four combinations (1280×850 and 390×844, each light/dark), plus storage-unavailable and no-JavaScript checks.
- Axe: **zero violations** on the main view and open dialog in all four combinations. Incomplete rules are retained in the JSON report and still require human review.
- Terrain filters, arrow/Enter/Space input, dialog details, modal focus, save/remove/empty recovery, packing progress, persistence, map selection, theme persistence, and reduced-motion behavior were exercised.
- Zero page errors and zero external HTTP or WebSocket attempts in the custom suite. Both the custom and generated runners use isolated contexts with service workers blocked.
- Generated MCP runner: **20 runnable check results passed** (five checks × two breakpoints × two themes). Its result remains `automated-checks-passed-manual-outstanding`, with 13 manual items per report. The custom suite addresses concrete app flows but does not silently clear the plan's human-study or visual-acceptance items.
- Screenshots were inspected by the agent. They are real browser captures, **not** approved visual-regression comparisons. Testing is Chrome-only; no screen-reader study, cross-browser guarantee, representative-user usability study, or measured agent uplift is claimed.
