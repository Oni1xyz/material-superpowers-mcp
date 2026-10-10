# M3 Knowledge Coverage Milestone Implementation Plan

> **For Hermes:** Use subagent-driven-development; spec review before quality review and parent verification.

**Goal:** Replace the six-document fallback with a verified snapshot of current M3 guidance, usable section retrieval and explicit coverage gaps.

**Architecture:** Explicit network-only import discovers the official sitemap/current Angular bundle as data, resolves same-origin structured document IDs and visible sections, and atomically publishes an indexed local snapshot. Ordinary MCP handlers read bounded local data only. Numeric resource/spec modules are separately resolved and preserve honest failure states.

**Stack:** Existing exact-pinned TypeScript/Zod/parse5 tooling. No dependency upgrades unless necessary/reviewed. No new infrastructure or global agent config changes.

## Existing evidence

Read docs/research/m3-coverage-inventory.json: last observed 252 core sitemap URLs, 36 families, 81 underlying core document IDs. Eight official content JSON samples succeeded. These are snapshot observations, not fixed values to hardcode. Current content route is /_dsm/content/m3/<discovered carbonVersion>/<exportedCarbonFileId>. Never execute upstream JS; parse route data with bounded structural extraction. Resource names in content refer to separate spec/token data; naive filename mapping returned404, so that needs real resolution.

## Task A — source discovery, indexed cache and docs tools

Owner: source/docs agent. Files src/material/*, src/tools/docs.ts, scripts/import-official.ts, scripts/refresh-cache.ts, source/cache-specific helpers/tests, src/server.ts and scripts/smoke.mjs for adding coverage tool only, package scripts if needed (no dependency upgrade).

1. Add failing tests for source/path parsing and data normalization. Fetch sitemap and bundle with bounded requests and exact official hosts; derive routes/versions safely; resolve canonical URL sections rather than parent fallback pretending success. Include current core pages and classify develop/entrypoint/release/blog links.
2. Preserve structured headings, paragraphs, lists, tables, code, captions, image/video metadata, links, official source IDs, visibility flags and resource references. Never silently omit unknown modules; expose extraction/coverage gaps. No downloads of all images/videos by default. Do not label image metadata as verified visual understanding.
3. Replace whole-file20doc cache limit with bounded per-document snapshot store, atomic manifest promotion, search metadata, section/block indexing and per-source status. Retain last good snapshot on fetch/schema failure; explicit partial status if policy permits incomplete snapshot. Refresh resume/incremental caching should not mix source versions. Keep compatibility or explicit migration for legacy6doc cache.
4. Upgrade docs search/read/context: categories foundations/styles/components plus support pages where appropriate, deterministic title/heading relevance, semantic pagination with snapshot-bound cursor, mode-sensitive source selection and citation IDs. Paths only from validated manifest, not arbitrary filesystem/url inputs. Source excerpts never authored fake docs. Byte/input/output limits retained.
5. Add material_coverage_status: counts computed from manifest, unresolved paths/modules/resources, snapshot age/version and separate knowledge vs implementation vs test scope. Update server/smoke expected tool registry intentionally to11; no removing existing10 tools.
6. Run full official import with rate-limited bounded concurrency, persist ignored artifacts/m3-coverage-report.json and manifest. Verify counts programmatically vs live inventory, no silent omissions. Full coverage of text != full spec/media understanding. Use fallback only explicitly labeled.

## Task B — numeric resource/spec adapter

Owner: resource agent. ONLY scripts/m3-resources/* and tests/m3-resources* plus docs/research/spec-resource-discovery.md; do not edit task A files. Examine fetched public content and current official site's resource renderer to discover real data locations. Never execute downloaded code on host, bypass auth or fetch arbitrary user URLs. Avoid unnecessary browser if source inspection suffices; bounded isolated browser observation allowed for network discovery.

Export module scripts/m3-resources/index.ts with function resolveResources({carbonVersion:string, resourceNames:string[], outputDir:string}): Promise<report>. It is explicit-import only, never runtime network. Safe validated inputs/resource names, exact discovered official endpoint formats, redirect/time/byte budgets. Persist raw payloads only under ignored outputDir and return structured metadata URL/hash/schema/status with normalized tables/tokens when actually supported. Unknown formats explicitly unresolved. If a full resolver cannot be grounded, implement a probe/report with clear limitation rather than fabricated spec values; report feasibility blocker.

Verify at least buttons, spacing and motion against live actual resource data if available, synthetic hostile-input tests and snapshot normalizer tests. Preserve visible token-set/module configuration semantics; don't claim entire data blob applies to each component. Integration into task A runs only once interface verified.

## Review and acceptance

- Independent spec and quality reviews for both lanes, fix blockers, then parent reruns tests/build/evals/stdio/browser/Docker.
- Real M3 content fetched, section pagination exercised via MCP, coverage report totals reconcile official inventory. Unsupported media/resources cannot count as complete.
- No user secrets or runtime network; no complete M3 claim unless numeric spec/media gaps resolved and coverage ledger proves it.
- Commit scope inventory + this plan, develop on feat/m3-knowledge; publish code after gates, verify exact remote SHA and CI. Record remaining gaps and milestone scope plainly.
