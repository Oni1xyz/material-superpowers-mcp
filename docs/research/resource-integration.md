# Offline M3 resource sidecar integration

## What is integrated — and what is not

`material_read_spec` reads an explicitly imported, local-only sidecar associated with one **exact corpus snapshot and Carbon version**. It resolves only the verified `TOKEN_TABLE`, `MEASUREMENT`, and `TOKEN_TYPE_UNSPECIFIED` endpoint families. It does not infer schemas for `STATUS_TABLE`, `COLOR`, `ELEVATION`, or `TYPOGRAPHY`.

The article corpus retains its original unresolved-resource markers and resource references. Those markers describe what the **article-text importer** could resolve; they are not an assertion that every reference remains unresolved after this separate import. Use `readResourceCoverage(corpus)` / the attached resource coverage in `material_coverage_status`, and each module's explicit status, as the current resource integration ledger. Older broad statements that all resource tables are unresolved must be read with this distinction. Text coverage, fetched resource coverage, page-token-set filtering, and context evaluation are different measurements.

No upstream payload or generated sidecar is committed. Local payloads and reports live in the ignored corpus cache, with an additional `resources/.gitignore`. Redistribution remains subject to the official source's terms.

## Explicit refresh

```sh
npm run refresh-cache
npx tsx scripts/refresh-resources.ts --dir .cache/material
```

The second command is independently runnable after the corpus metadata fix. It reads the current corpus rather than discovering a fresh Carbon version. Omit `--dir` to use `defaultCacheDir()` (including the existing cache-directory environment configuration). `--no-reuse` explicitly opts out of verified local raw-artifact reuse; it does not increase any budget.

The CLI inventories every resource-bearing visible article chunk, preserving its canonical section path, module/chunk ID, block ID, source article hash, original article JSON pointer, exact `libraryModuleType`, resource name and `moduleConfigurationOverrides`. Repeated endpoint references share one request and one normalization pass. Different modules remain different coverage entries.

### Global import limits

This command uses the existing exported `fetchOfficial` and `normalizeResource` primitives directly. It deliberately does **not** call the 12-name `resolveResources` planner in repeated batches. The low-level integration replaces that planner's name cap with one explicit **64-request maximum**, retaining its **64 MiB total byte exposure**, **24 MiB individual body cap**, **25-second request/body timeout**, and strict official endpoint allowlist/no-redirect behavior.

- All requests are sequential, with at least 300 ms between a completed network request and the next request.
- One request/byte/time ledger covers the complete inventory. Failures retain their whole reserved body exposure; successful reads refund unused reservation. Reused raw bytes also consume the global byte allowance, so repeated refreshes cannot quietly assemble an unbounded resource mirror.
- The complete refresh has a 600,000 ms wall-clock budget. A new request starts only if its full timeout plus delay fits. Exceeding the overall budget aborts publication.
- Normalized output is capped at 256 MiB cumulatively; the existing normalizer additionally enforces its own per-resource row/byte limits.
- Ordering is deterministic: buttons, spacing and motion samples first, then canonical path order. Every endpoint/module after budget exhaustion remains explicitly listed as `budget-blocked`; schema/transport failures are `failed`, never omitted.
- Raw artifacts are reused only through digest-verified prior index entries for the same Carbon version and exact endpoint. Complete schema-failed payloads can be revalidated locally without redownloading them. Incomplete failed responses are not reusable.

These bounds mean **not all supported endpoint references necessarily fit in one sidecar**. Budget exhaustion is reported, not bypassed through batches or hidden retries. To extend coverage, a separate reviewed budget/schema change is necessary.

## Page applicability and contextual values

A fetched payload is not automatically a page specification:

1. Only recognized configuration keys (`tokenSets`, `contextTags`, `tokenSetOrder`, `hideSearchField`, `hideVersionName`) are accepted for page selection.
2. An explicit nonempty `tokenSets` override is required. Display names match exactly, including whitespace and `[Deprecated]` markers. Unknown/ambiguous set names or unknown configuration keys fail closed; no partial-set selection or broad payload fallback occurs.
3. Only rows belonging to the explicitly selected, payload-declared token sets are emitted. Dependency tokens are never selected.
4. `tokenSetOrder` controls presentation order, not set membership.
5. `contextTags` overrides are preserved but **not evaluated as a winning-context algorithm**. Every contextual alternative for the selected tokens is retained and paginated. `contextEvaluation` is always `not-evaluated`; context-evaluated coverage is zero. Results are token-set-selected alternatives, not a claim of exact browser-renderer context equivalence.
6. Units and typed values are unchanged. Omitted scalar fields are not inferred as zero. Explicit undefined values, missing resolved trees, composites and deprecation messages remain distinguishable.

Each row cites the resource endpoint URL, exact raw SHA-256, source JSON pointer, Carbon/DSDB versions, original retrieval time, corpus/sidecar snapshots, canonical article URL, source article URL/hash/pointer and selected token set.

## Offline storage and bounded reads

`resources/manifest.json` references an immutable SHA-256-named index. That index references SHA-256-named immutable normalized chunks (at most 64 KiB / 64 rows each). Raw payloads live separately under `resources/raw/<sha256>.json` and are **never read by runtime tools**.

Runtime reads use the existing realpath-confined, bounded local read API; digest filename schemas prevent traversal. Index/chunk contents are hash-checked and schema-checked. Cheap collection/depth/node-count preflights run before Zod's per-element validation, avoiding large-array validation amplification. Runtime has no executable or type import from the importer scripts, preserving the `src` TypeScript build root and the offline boundary.

A query parses at most 64 chunks, not a 20 MiB endpoint payload. The index is capped at 8 MiB, individual rows at 16 KiB, the requested result page at 50 rows and the complete result at 128 KiB. A scan budget can yield an empty page with a continuation cursor; callers must follow `hasMore` rather than assume empty means exhausted.

Cursors bind to both snapshots, the exact canonical path, module ID filter and token-name query. Out-of-range/end-of-chunk offsets are rejected. Unknown module IDs fail explicitly; unknown token-name substrings return no matching rows, never unrelated fallback rows. Missing/stale/invalid sidecars fail with an actionable explicit-refresh command. Runtime never repairs or fetches them.

Publication writes/verifies immutable files before replacing the one sidecar manifest. The corpus snapshot/version is reopened immediately before atomic manifest rename. A changed corpus or a failed prepublication write leaves the prior manifest intact. Concurrent changes after that check are detected as a stale sidecar at read time, not mixed into a query. The importer does not retry a corpus race behind the user's back.

## Live verification on the available corpus

The actual network import and a subsequent digest-reuse refresh ran against:

- Corpus snapshot: `34f48f6acf15809e02e4760b25d28104d11ef41754769ee86667b8af9958da51`
- Carbon: `2026-09-23_06-10-05`; recognized DSDB schema version: `38.2.9`
- Sidecar after reuse verification: `f504eb3d5d0e2198326f6b923489b540cf9859ca681d56c6ee8f6d2fb2b26ec7`

| Measurement | Result |
|---|---:|
| Inventoried resource modules | 96 |
| Supported unique endpoints | 38 |
| Verified fetched endpoints | 11 |
| Failed endpoints | 6 |
| Budget-blocked endpoints | 21 |
| Modules attached to verified fetched endpoints | 17 |
| Unsupported module types | 42 |
| Failed modules | 7 |
| Budget-blocked modules | 30 |
| Successfully token-set-filtered modules | 11 |
| Supported modules with unsupported/missing selection configuration | 15 |
| Context-evaluated modules | 0 |
| Page-filtered contextual rows (module occurrences, not unique tokens) | 25,837 |
| Unique immutable normalized chunks | 519 |
| Largest actual normalized chunk | 65,277 bytes |
| Actual index size | 265,400 bytes |

The initial network run made 17 requests, received 63,099,911 complete-response bytes, and exhausted the conservative 67,108,864-byte exposure ledger in 31,743 ms. Five endpoint payloads failed the existing verified schema with `unrecognized value field` (app bars, checkbox, chips, date pickers, dialogs). A sixth request (FAB menu) exceeded its smaller remaining global-body reservation; it is recorded as a body-limit failure, and all later endpoints are budget-blocked. **No speculative importer schema extension was made.**

The reuse verification consumed 16 complete cached endpoint payloads, made only one non-reusable request, and retained the same coverage; 16 reused endpoints includes complete schema-failed payloads, not 16 successful endpoints. Six of the verified fetched endpoint payloads supply the 11 page-filtered modules; the other fetched modules lack required explicit `tokenSets` overrides.

All 25,837 module-selected rows were checked against their cited original raw JSON pointers and values, with every referenced chunk digest checked, selection membership checked and dependency exclusion checked. Local verification reports are `.cache/material/resource-refresh-report.json`, `.cache/material/resource-refresh-reuse-report.json`, and `.cache/material/resource-tool-samples.json` (ignored).

### Actual sample queries

```json
{"path":"components/buttons/specs","query":"height","limit":3}
{"path":"styles/spacing/tokens","limit":3}
{"path":"styles/motion/overview/specs","query":"duration","limit":3}
```

Observed results, with full citations in the actual tool responses:

- Buttons: `md.comp.button.xsmall.container.height` = `{ "length": { "value": 32, "unit": "DIPS" } }`; small = 40 DIPS; medium = 56 DIPS. Current and deprecated module token sets remain separate; use `moduleId` to select one.
- Spacing: `md.sys.measurement.space500` = 40 DIPS; `space25` = 2 DIPS. `space0` has `{ "length": { "unit": "DIPS" } }` — the missing `value` is **not** converted to zero.
- Motion: `md.sys.motion.duration.medium2` = `{ "durationMs": 300 }`, `long3` = 550 ms, `short4` = 200 ms. Motion rows are limited to the explicit `Motion` token set, not all rows in `TOKEN_TYPE_UNSPECIFIED`.

These are observed alternatives, not a general context winner or implementation certification. Every sample returned a continuation cursor.

## Exports and parent wiring

```ts
// src/tools/resources.ts
export function makeResourceTools(dir?: string): ToolDefinition[];
// Returns exactly one tool: material_read_spec.

// src/material/resource-store.ts
export async function readResourceCoverage(corpusOrDir?: Corpus | string);
// Discriminated status: ready | missing | stale | invalid.
// Ready includes counts, per-module statuses/configuration, endpoints, run,
// both snapshot IDs, Carbon version, complete:false and the context limitation.

export async function readSpec(dir: string, input: {
  path: string; query?: string; moduleId?: string; limit?: number; cursor?: string;
});

// scripts/refresh-resources.ts — explicit importer only
export async function refreshResources(options?: RefreshResourceOptions);
```

Parent-owned wiring should append `...makeResourceTools()` to the server's tool list, update the uniqueness/count assertion from 11 to 12, and attach `await readResourceCoverage(catalog.corpus)` to the coverage tool. For concise coverage output, include its summary/counts/status and omit the full `modules`/`endpoints` arrays; include those on detailed requests. Do not relabel the article's complete unresolved-reference inventory as the sidecar's remaining-unresolved inventory.

Verification includes unit tests for exact token-set separation, missing/unknown configuration, dependency exclusion, omitted values/undefined/composites/missing trees/deprecation, snapshot/filter cursor rejection and progress, output/chunk bounds, missing/stale/corrupt/traversal/symlink files, hostile collection preflight, one global request/byte ledger, digest reuse, and failed-publication preservation. A real SDK stdio subprocess exercises the single exported resource tool with runtime `fetch` disabled and verifies successful structured results and bounded strict-input errors. Full production 12-tool discovery is verified after parent wiring, not claimed by the isolated tool test.
