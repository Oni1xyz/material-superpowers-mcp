# Comprehensive Material 3 scope and estimate

Status: scope/research only; no production implementation or cache changes. Estimates are engineering effort, not delivery promises or measured agent speed. See `../research/m3-coverage-inventory.json` and `../research/component-coverage-matrix.json` for machine-readable evidence and backlog.

## Recommendation

Build a comprehensive **Material knowledge and implementation assistant**, not an entirely new cross-framework UI library. Cover all current M3 guidance, source-backed component specs and variants, design-system generation, tested implementation recipes/adapters, and reusable evaluation contracts. Keep native-platform implementation separate from knowledge coverage.

Planning allowance: **37–60 engineering-days** for this assistant track, contingent on reusable implementation primitives/adapters being suitable. Initial knowledge coverage including specification/media fidelity: **12–20 engineering-days**. One engineering-day means a focused experienced engineer-equivalent day, including tests and review, not a day of unattended agent time. Parallel agents may reduce elapsed time; the estimate does not assume a fixed speedup. Re-estimate after the source/spec pilot and adapter selection before committing to full delivery dates.

If “comprehensive” instead means independently authored, production-ready widget implementations for every family, the larger conservative estimate is **125–265 engineering-days** before extra framework/native adapters. This is a separate product. Do not silently smuggle that requirement into the assistant estimate or advertise adapter gaps as complete implementation.

## Live inventory and feasibility evidence

Source: https://m3.material.io/sitemap.xml (checked in this research; content bundle version `2026-09-23_06-10-05`).

- 375 unique sitemap URLs overall.
- 252 core URLs, including category landing pages: 146 components, 68 foundations, 38 styles.
- 36 component families, each with overview/specs/guidelines/accessibility sitemap routes. Components also include landing and all-buttons index URLs.
- The core routes map to 81 unique content-document IDs in the live application bundle. Documents contain multiple tabs; page URLs are not independent files.
- Sitemap also lists 113 blog URLs and 5 develop URLs. Current release/Expressive/Compose-first announcements and entrypoints must be classified; historical blog coverage is distinct from current normative guidance.
- Eight representative structured documents were actually fetched successfully: buttons, date pickers, navigation rail, spacing, motion physics, RTL, XR design, alt text. This is feasibility evidence, not proof the full corpus imported.

The public SPA consumes same-origin structured content at `/_dsm/content/m3/<content-version>/<document-id>`. Route IDs/version can be read as data from its application bundle without executing downloaded JavaScript. This is a more promising import path than rendering each page. A community client documents this pattern; no third-party code was installed/executed for this research.

Important unresolved issue: numeric specification/resource tables are separate from article HTML. Example spacing/button resource references exist in fetched documents, but the filename mapping tried from the community client returned HTTP 404 under both tested version choices. Some spec content is image/video-based. A text-only importer would appear complete while missing essential design information.

These are undocumented site internals, not a supported public Google API. Require strict validation, schema-change detection, version-pinned snapshots, explicit refresh, and a controlled rendered fallback. Preserve hidden/visible/tab flags; the sample rail payload includes an XR section not in its ordinary sitemap tabs, so importing every raw section indiscriminately would be wrong.

Material Web is in maintenance mode according to its official README: https://github.com/material-components/material-web . It is not a sufficient authority or complete implementation source for current Expressive coverage.

## Define comprehensiveness with separate coverage ledgers

Each catalog item has independent status and evidence for:

1. **Knowledge:** official overview, guidelines, specifications, accessibility, source version, related foundations/styles, media and token references.
2. **Implementation:** supported target platform/adapter, variants, sizes, states, multi-instance behavior, keyboard and pointer interactions, theming, reduced motion, localization/RTL, lifecycle/cleanup.
3. **Validation:** executable contract checks, independently authored negative fixtures, approved visual examples, browser/theme/locale coverage, manual/AT review status.

Do not collapse these into one percentage. Retrieved docs do not prove generated code is correct; passing a demo does not establish component coverage.

Default target: comprehensive knowledge across current M3, including watches/XR guidance; comprehensive **web-first** implementation assistance. Android Compose, Flutter, Wear and XR runtime adapters require separate milestones and native test infrastructure. Do not infer web parity from Android dp values or native behavior.

## Work packages

| Package | Deliverable | Engineering-days |
| --- | --- | ---: |
| Source adapter + coverage contract | Reconcile sitemap, routes, tabs and resource references; import representative content; identify supported platforms and exact completion gates | 3–5 |
| Corpus + retrieval | Import all in-scope documents; per-doc storage; atomic manifest; heading/block indexing; semantic pagination; relevance tests; incremental refresh and freshness status | 5–8 |
| Specs + media fidelity | Resolve resource tables, normalize numeric units and component tokens, preserve captions/do-don't examples, selective image retrieval and version parity checks | 4–7 |
| Tokens + style systems | Source-backed color schemes/contrast strategies, typography, shape, elevation, spacing, state layers and motion, versioned Expressive distinction | 5–8 |
| Component registry + implementation recipes | All 36 families represented; harden existing examples; safe instance-scoped output; vetted adapter mapping and source-backed variants/behavior contracts | 8–12 |
| Generalized evaluation | Declarative component/flow adapters, keyboard state traversal, RTL/themes/reflow, browser matrix, negative controls and approved visual-baseline workflow | 8–14 |
| Qualification | Held-out integration tasks, documentation completeness audit, human/accessibility review coordination/remediation, capability reporting and release evidence | 4–6 |
| **Assistant track total** | Subject to source-resource and adapter feasibility gates | **37–60** |

Human participant recruitment/waiting, commercial licensing decisions, hosting changes and native SDK infrastructure are excluded. The qualification budget supports a pilot controlled agent comparison; it does not guarantee statistically established uplift or full accessibility certification.

### Milestone 1: knowledge-complete, not just searchable

First three packages: 12–20 engineering-days.

Acceptance:
- Every current core sitemap URL and resolved visible tab is accounted for with source-backed content, alias/redirect resolution, or a reviewed explicit exclusion; no silent missing pages.
- Release/develop/entrypoint pages classified too. Historical blogs are supplementary and cannot override newer normative guidance.
- All 36 families expose the four ordinary sections where published; foundation/style topics are not second-class.
- Article tables, resource tables, captions, image/video references and do/don't relationships survive extraction. Unknown module types fail/report coverage gaps rather than disappear.
- Source URLs, exact headings/block identifiers, snapshot digests, source/fetch dates and licensing metadata preserved.
- A retrieval benchmark includes navigation choice, current buttons, typography, motion, focus, RTL, spacing, and platform-specific questions. Curated claims cite supporting blocks, not merely an existing URL.
- Upstream change detection marks stale/failed content; an interrupted refresh retains the last validated snapshot and exposes failure status.

### Milestone 2: comprehensive building knowledge, explicit adapter support

Registry-driven tool behavior replaces scattered hardcoded advice. A family record should contain variants, sizes, anatomy, props/slots, state transitions, keyboard semantics, token dependencies, responsive constraints, platform differences, implementation target and test contracts.

Existing eight recipes are partial examples, not eight completed M3 implementations. Navigation-rail currently aliases generic navigation. Fixed IDs, shared global style selectors, hardcoded English and document-global event lookup must be removed before adding families. Generated examples should be safe to use twice on the same screen, with differing density/styles, without collisions.

Missing families (from live inventory): app bars, badges, bottom sheets, button groups, carousel, checkbox, date pickers, divider, extended FAB, FAB menu, FAB, icon buttons, loading indicator, menus, navigation bar, navigation drawer, progress indicators, radio button, search, segmented buttons, side sheets, sliders, split button, switch, tabs, time pickers, toolbars and tooltips.

Implementation adapters must declare support and version honestly. Prefer vetted primitives for focus management, menus, dialog behavior and date/time interaction rather than regenerating these from prose. If suitable adapters cannot meet a family's current specification, either allocate custom implementation work or leave implementation status incomplete—never declare full building coverage just because its docs are indexed.

### Milestone 3: evaluation beyond our single fixture

Replace fixed `data-eval` selectors and exact flow-name matching with a typed declarative binding contract. Permit locators, supported actions and assertions—not arbitrary user-supplied JavaScript. The agent can draft a plan, but independent acceptance remains a separate oracle.

Add:
- Complete keyboard paths, Tab/Shift+Tab focus containment, roving tabindex and component-specific Escape/arrow behavior.
- State matrix: default, hover, focused, pressed, selected/checked, disabled, invalid, loading, empty, expanded and dragging only where applicable.
- Light/dark, increased contrast/forced colors, reduced motion, RTL, long localized text, zoom/reflow and relevant breakpoints.
- Chromium/Firefox/WebKit where feasible, with explicit supported versions and documented exceptions.
- Genuine flow assertions for persistence, cancellation, error recovery and undo; a demo DOM counter is not proof of backend side effects.
- Approved screenshot baselines; keep capture-only distinct from regression comparison.
- Manual screen-reader/usability tasks; preserve outstanding status instead of counting as pass.

Current useful foundation: generated module execution, independent bad fixture, resource-budget tests, visible-focus regressions and standalone network blocking. It is one tested composition, not this full matrix.

## If we write a whole component toolkit ourselves

Read-only audit's conservative shared infrastructure/hardening allowance is 57–103 engineering-days. Using the inventory's coarse missing-family tiers:

- 10 simple-to-moderate missing families × 1–3 days: 10–30 days.
- 16 composite missing families × 3–7 days: 48–112 days.
- 2 complex picker families × 5–10 days: 10–20 days.
- Total: 125–265 engineering-days, excluding additional React/Compose/Flutter/Wear/XR implementation adapters.

These are rough planning classes, not measured complexity facts. Expressive loading/progress motion, carousel, locale/calendar behavior or external dependency constraints may move families upward. This alternative includes writing/maintaining behavior ourselves and should not be added to the assistant-track estimate: it replaces that track with a larger product.

## Risks and sequence

1. Resolve structured-resource/spec-table extraction before promising numerical completeness.
2. Select/version implementation adapters and prototype the hardest representative flows (menu, adaptive navigation, picker) before estimating all recipes as cheap templates.
3. Replace monolithic cache limits/indexing: current cache caps at 20 documents and rereads/hashes the whole file on every call.
4. Fix multi-instance/scoped recipe integration before parallel family expansion.
5. Keep a versioned coverage manifest and make missing support queryable through MCP, so an agent cannot mistake a retrieved guideline for implemented functionality.
6. Maintain official/authored/computed distinctions, legal attribution, no model/network inside ordinary handlers, explicit imports, bounded outputs and separate browser execution.

## Suggested next authorization

Implement Milestone 1 first, starting with the structured-content/spec-resource pilot and a coverage-status tool. Return a measured corpus report and updated implementation estimates at its gate. Do not launch native adapters or a new general UI library implicitly.

## Research sources

- https://m3.material.io/sitemap.xml
- https://m3.material.io/robots.txt
- https://m3.material.io/components
- https://m3.material.io/foundations
- https://m3.material.io/styles
- https://m3.material.io/static/angular/main.7906d9e8e8cae962.js (observed bundle, not a stable API URL)
- Eight sampled same-origin document URLs recorded in the inventory JSON.
- https://github.com/material-components/material-web
- https://github.com/ChouChiu/MD3-Docs-MCP (read-only reference for discovery pattern; no code installed or executed)
