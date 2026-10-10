# M3 knowledge expansion — verification and remaining scope

This increment provides the real structured M3 article corpus plus a **partial**, explicitly measured numeric-resource sidecar. It is not the completion of the comprehensive building-assistant roadmap or full specification knowledge.

## Executed parent checks

- `npm run build`: passed.
- `MATERIAL_REAL_CACHE_TEST=1 MATERIAL_REAL_RESOURCE_TEST=1 npm test`: **241 passed across 19 files**, no skipped tests in this run. Without the flags, downloaded-corpus checks remain opt-in; ordinary CI does not fetch the official corpus.
- Strict standalone TypeScript checks for both importers, resource probe, browser harness and focus tests: passed.
- Real SDK smoke: **12 tools called**, four invalid-input checks; protocol-only stdout.
- Real imported-corpus integration: all 263 document digests and source provenance checked; exact section retrieval, heading reads, mode-sensitive context and lossless Buttons Specs pagination exercised. Production stdio also queried buttons, spacing and motion numeric specs and checked summary/detailed coverage consistency.
- Offline evaluations: 16 passed. Browser evaluations: 24/24 generated checks and 9/9 independent checks passed; six seeded-bad failures detected, zero external attempts and page errors. Ten manual checks remain outstanding. Browser result is regression evidence for the existing demo, not a full-M3 behavior matrix.
- Docker rebuilt after validation fixes. All 12 tools passed with `--network none` and the real cache mounted read-only; missing-cache behavior also passed without the mount.
- Dependency-age check: 209 locked packages checked against the seven-day policy. `npm audit --audit-level=high`: zero reported vulnerabilities. No dependency versions changed.

## Actual imported coverage

Article snapshot: `34f48f6acf15809e02e4760b25d28104d11ef41754769ee86667b8af9958da51`.
Carbon version: `2026-09-23_06-10-05`.

- Sitemap ledger: 375 unique URLs; 263 indexed and 112 explicitly excluded, no missing or extra ledger URLs.
- Core: 252/252 canonical URLs, 81 underlying source documents, 36 component families.
- Total underlying source documents: 92; refresh successfully reused all 92.
- Source provenance: 4,799 source blocks plus synthetic descriptions; 949 metadata-only hidden-content exclusions. Hidden prose/resources/media are not exposed by the exclusion ledger.
- Both source ID forms and original visibility flags are retained. Missing legacy metadata is explicitly unknown rather than inferred.

Resource sidecar: `f504eb3d5d0e2198326f6b923489b540cf9859ca681d56c6ee8f6d2fb2b26ec7`, tied to that exact article snapshot.

- 96 module references, 38 supported unique endpoints.
- 11 verified endpoints; 6 failed and 21 budget-blocked endpoints.
- Module status: 17 attached to verified fetched endpoints, 42 unsupported, 7 failed, 30 budget-blocked.
- 11 successfully page-token-set-filtered modules; 25,837 contextual row occurrences in 519 immutable chunks. These are not counts of unique scalar tokens.
- Context-evaluated modules: zero. All contextual alternatives are preserved; no renderer-context winner is inferred.
- Independently checked all selected rows against original JSON pointers/values, chunk digests, raw-payload digests, exact token-set membership and dependency exclusion.

The importer enforces one 64 MiB exposure ledger, a 64-request ceiling and a ten-minute wall-clock budget. It does not reset budgets across batches to silently mirror the site. Five payloads failed the approved schema; another exceeded the remaining body reservation. Further coverage requires grounded schema extensions and a reviewed storage/import budget, not hidden retries or speculative token values.

## Review history

Source spec review first caught missing canonical/version IDs and visibility metadata; fixed and independently passed. Source quality review caught nonprogressing end-of-block cursors and allocation-heavy schema validation; both fixed and independently approved.

Numeric importer passed independent spec and quality reviews with live endpoint/digest verification. Sidecar spec review independently verified stored rows but caught nested-array validation amplification. That fix and analogous legacy-cache hardening now use fail-fast bounded-array validation. Constrained 128 MiB subprocess tests cover the original crash cases, with timeouts, capped output and core dumps disabled.

Final sidecar/wiring re-review: spec PASS, quality APPROVED; legacy hardening APPROVED. The reviewer reran the full suite, focused regressions, build, strict importer TypeScript checks and 12-tool production smoke. An additional exhaustive live pagination probe was denied before execution; that reviewer did not claim to have run it. Earlier independent row/pointer verification remains separately recorded above. Hosted exact-commit CI is checked after publication, separately from these local results.

## Remaining work

- Resolve unsupported module types and configurations, observed schema failures and budget-blocked resources; retain per-module evidence and explicit remaining gaps.
- Establish faithful context selection before claiming parity with rendered specification tables.
- Interpret/verify image, diagram and motion-embedded guidance; imported media metadata is not visual understanding.
- Expand component recipes, state/variant behavior, frameworks, adaptive planning and independent browser matrices. Current authored recipes remain the original eight families.
- Complete manual accessibility checks, approved visual baselines and controlled agent-uplift evaluation.

No downloaded official corpus is committed or bundled in the runtime image. No global Hermes configuration, credentials, public hosting or infrastructure were changed.

## Reproduction

```sh
npm run refresh-cache
npm run refresh-resources
npm run build
MATERIAL_REAL_CACHE_TEST=1 MATERIAL_REAL_RESOURCE_TEST=1 npm test
npm run smoke -- --require-cache
npm run evals
npm run evals:ui
docker build -t material-superpowers-mcp:local .
npm run smoke -- --docker --with-cache --require-cache
```

Snapshot IDs/counts above describe the verified local snapshot, not constants promised for future upstream releases. Ignored evidence lives under `artifacts/m3-*.json` and `.cache/material/resource-*.json`.
