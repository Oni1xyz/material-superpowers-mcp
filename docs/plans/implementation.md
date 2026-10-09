# Material Superpowers MCP Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task, with spec review before quality review.

**Goal:** Ship a working private Oni1xyz Material 3 MCP with grounded documentation, deterministic design tools, and runnable eval-plan output plus a separate browser harness.

**Architecture:** Local TypeScript stdio server. Ten bounded tools; runtime has no network, browser, shell, credentials, or model calls. Explicit refresh imports actual official documentation into a local ignored cache. Templates and rules are authored project guidance, not falsely represented as official text. Playwright/axe runs in a separate command/process.

**Tech Stack:** Node 20+, TypeScript, official MCP SDK, Zod, Material Color Utilities, Vitest; Playwright + axe for external browser evaluation. Dependencies exact-pinned with lockfile, release-age checks and install scripts disabled.

## Scope corrections to the earlier design

- Deterministic screen planning and eval planning compose curated recipes/checklists. They do not understand arbitrary prose like an LLM; preserve user goals and mark custom checks/manual work explicitly.
- Ten tools: material_search_docs, material_read_doc, material_get_context, material_generate_tokens, material_map_brand_to_tokens, material_component_recipe, material_review_ui_code, material_review_tokens, material_plan_screen, material_generate_eval_plan.
- Docs cache must be fetched from a real source. No invented official excerpts. Empty cache gives actionable errors. Record source URL, fetch timestamp, digest and extraction method. Keep downloaded docs out of git; license/attribution notes required.
- Baseline implementation targets plain HTML/CSS; optional Material Web adapter only if implemented accurately. Reject unsupported platforms/components/variants instead of silently falling back.
- Recipe minimum: button, card, navigation, chip, text-field, dialog, snackbar, list. State requirements are component-specific: disabled controls need not be keyboard focusable; static cards need not be interactive.
- Static review is advisory, not a WCAG certificate. Missing custom focus CSS is not proof of missing UA focus. Unknown computed colors, cascade, media queries and script behavior require browser checks. Report rule IDs, confidence, evidence, fix and limitation.
- WCAG 2.2 AA target sizing is 24 CSS px with exceptions; 44 px enhanced/project comfort policy and Material platform guidance must be labeled separately. A focus-visible element being visible does not prove its focus indicator is visible.
- Eval generation never executes its input URL or emits executable unescaped input. Known generic checks are runnable; custom flow steps require explicit assertions and cannot silently count as passes.
- Self-authored plans must not replace independently maintained acceptance tests. Real user usability and blinded A/B uplift remain separate gates; no quality/uplift claim from passing unit tests alone.
- No automatic Hermes global config changes or new cloud infrastructure in this implementation. Deliver tested stdio setup and optional user-enabled configuration.

## Shared implementation contract

Each lane exports an array of ToolDefinition from its module:

    interface ToolDefinition {
      name: string;
      description: string;
      inputSchema: z.AnyZodObject;
      run: (input: any) => unknown | Promise<unknown>;
    }

Paths: src/tools/docs.ts exports docsTools; src/tools/design.ts exports designTools; src/tools/planning.ts exports planningTools. src/types.ts owned by core. Server validates arguments through Zod and returns JSON in MCP text plus structuredContent where supported. Tool errors use isError and useful messages, never crash the server. Zod v3 exact pin for interoperable shape registration. .js imports in TypeScript/ESM. Core owns package.json, lockfile, tsconfig, server, Docker and CI. Other lanes do not edit those files; report required commands/deps.

## Lane A — core and documentation

Files: package.json, tsconfig.json, src/types.ts, src/index.ts, src/server.ts, src/tools/docs.ts, src/material/*, scripts/refresh-cache.ts, tests/core*, tests/docs*, scripts/smoke.mjs, Dockerfile, .github/workflows/ci.yml.

1. Select compatible exact dependency versions after inspecting npm metadata/release age; install with ignore-scripts. Include zod v3, SDK, color utilities, TypeScript/Vitest/tsx/@types/node, Playwright, axe, postcss and HTML parser if useful. Do not run package install scripts.
2. Tests first: actual MCP initialize/list/call via SDK client, tool error contract, server log purity (stdout protocol only). Then implement registration/server.
3. Docs tests first: URL/path canonicalization rejects credentials/query/traversal/encoded bypasses, limits bounded, cache provenance, missing cache, section read and search relevance, atomic refresh failure preserving old cache. Implement cache and docs tools.
4. Explicit refresh uses allowlisted official sources and validates redirect/subrequest policy. Prefer m3.material.io rendered article when feasible; official Material Web markdown is a transparently labeled fallback, not M3 site content. No arbitrary fetch endpoints. Run at least one real import and doc tool call.
5. scripts/smoke.mjs calls all tools with representative inputs over real stdio, checks negative input handling and tool count. npm test/build/evals/smoke/refresh-cache/evals:ui commands documented. Docker runtime non-root with no network needed. CI permissions contents:read; no secrets; don't commit runtime cache or traces.

Commands: npm test; npm run build; npm run smoke; npm run refresh-cache; docker build -t material-superpowers-mcp:local .
Expected results are acceptance targets, not claims until actually executed.

## Lane B — design tools

Files: src/tools/design.ts, src/design/*, tests/design*, evals/design* (only).

1. Test HCT-derived role output, hex validation, light/dark/both, CSS parsing, required on-role contrast, optional shape/type/motion; implement generate tokens with official library. Profiles labeled authored adaptations, not official Expressive implementation.
2. Test brand mapping explicit roles and safe inputs/unknown constraints; implement predictable role mapping and contrast warnings. No injection through fonts or strings.
3. Test supported recipe matrix, escape unsafe text, component-specific states and keyboard semantics; implement curated HTML/CSS/JS where necessary (dialog must actually open/close, chips toggle if interactive). No fake working React support.
4. Test clean/bad review fixtures, false positives and uncertain cascade cases; implement bounded advisory source/token reviews with evidence. Avoid treating every literal color as violation (definitions may legitimately contain them).
5. Export five tools (tokens, brand, recipes, code review, token review). Run targeted tests; report exact output and limitations.

## Lane C — planners and external browser evals

Files: src/tools/planning.ts, src/planning/*, tests/planning*, evals/ui/*, evals/run-ui.ts, evals/benchmark.md (only).

1. Tests first for task-specific recipe matching and unsupported goals, platform validation, source-vs-authored guidance labeling; implement screen planner using deterministic patterns.
2. Tests first for eval plan schema, bounded inputs, URL metadata validation/no fetch, injection-resistant generated code, high-risk flow requirements, plan traceability and runnable-vs-manual split; implement eval plan tool with Playwright source artifact and structured checks.
3. External runner builds a demo with real tool outputs and executes generated checks in Playwright+axe at mobile/tablet/desktop. Use isolated localhost fixture server; prevent arbitrary external page navigation/network. Save screenshots/report under ignored artifacts/.
4. Verify keyboard focus including measurable outline/shadow change (not merely :focus-visible selection), dialog Escape/return focus where applicable, overflow, reduced motion policy, axe serious/critical; capture screenshots. Include a seeded bad fixture that fails at least one independent gate. No blessed visual baselines without inspection; screenshot capture is not visual regression pass.
5. Document reproducible blinded A/B tasks, equal model/budget/tool settings, repeated runs, held-out fixtures, human rubric. No invented 15% uplift; explicitly unmeasured until run.

## Review and release

After implementation lanes finish: independent spec reviews per lane, fix gaps then code quality/security reviews. Parent runs full build/unit/eval/stdio/Docker/browser verification after fixes. Inspect screenshots. Record actual counts/status and unrun gates in docs/verification.md. Push to private Oni1xyz/material-superpowers-mcp, read back exact commit/privacy and CI result. Do not declare all acceptance criteria met when CI, live docs or browser checks remain blocked.
