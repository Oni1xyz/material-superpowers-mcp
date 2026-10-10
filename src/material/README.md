# Official M3 local corpus

`npm run refresh-cache` is the explicit network boundary. It discovers the current
sitemap and hashed Angular main bundle, parses strict JSON route islands and the
content version without evaluating JavaScript, then downloads official Carbon
JSON from the exact `https://m3.material.io/_dsm/content/m3/<version>/<id>.json`
namespace. The old Playwright/innerText importer is no longer used or exported.

Canonical sitemap paths map to exact route/tab labels. A missing tab never falls
back to its parent or another tab. Blog/archive URLs without a current canonical
route have explicit exclusions. Application-only routes absent from the sitemap
(such as get-started) are separately reported if they have no exported document.

## Storage and refresh safety

- `manifest.json`: small v2 manifest, atomically replaced only after successful
  discovery, download, semantic validation, and immutable snapshot preparation.
- `snapshots/<index-sha256>/index.json`: validated title/heading/content-term index,
  sitemap ledger, route inventory, source version and discovery digests.
- `snapshots/<index-sha256>/<path-sha256>.json`: one normalized canonical section,
  with its own file/text/source digests, IDs, headings, semantic blocks and media.
- `imports/<carbon-version>/<bundle-sha256>/<document-id>.json`: bounded resumable
  source envelopes. Reuse is isolated by version and bundle digest and verified
  with a payload digest. `npm run refresh-cache -- --force` downloads them again.
- `artifacts/m3-coverage-report.json`: computed import/reconciliation report.

The importer re-discovers version, bundle digest and sitemap digest before
publication. A fetch/schema/version failure leaves the published manifest alone.
Unmapped canonical URLs remain explicit unresolved ledger entries; they are not
invented excerpts. Old immutable snapshots are retained, not automatically pruned.

Limits: three concurrent content requests, three attempts per content document,
three redirects per fetch, 15-second discovery/30-second bundle or content timeout,
2 MB homepage/sitemap, 16 MB bundle/index, 8 MB source/normalized document,
256 MB total source and normalized snapshot budgets, and bounded route/section/
block/chunk counts. URLs reject raw whitespace, encodings, credentials, ports,
queries, fragments and dot segments before URL normalization. UTF-8 decoding is
fatal rather than silently changing bytes used in source digests.

## Read-only runtime

MCP documentation handlers read the validated manifest/index and only selected
local document files. User paths never become filesystem paths: validated index
entries point to digest filenames, with digest and realpath-confinement checks.
There is no runtime network, browser, shell, model, refresh or arbitrary write API.

- Search weights actual titles, canonical paths, headings and indexed content;
  topic-only searches prefer overviews over incidental token-table occurrences.
- `material_read_doc` accepts an exact indexed path, optional heading, a text
  budget and a snapshot-bound continuation cursor. Blocks stay whole when they
  fit; oversized blocks expose offsets and explicit continuations. Preserve the
  same path and heading when continuing. `includeStructure:true` returns sanitized
  HTML semantics including list/table/code structure and caption metadata.
- `material_get_context` changes source prioritization for design, implementation
  and review. Excerpts identify earlier omitted blocks and provide continuation
  cursors. This is deterministic retrieval, not generated guidance.
- `material_coverage_status` computes knowledge coverage and unresolved gaps from
  the index, lists the live authored recipe schema separately, and explicitly
  leaves implementation certification and browser/human evaluation unmeasured.
  `includeDetails:true` returns exact unresolved paths/resources and exclusions.

`maxCharacters` bounds excerpt text, not citation/metadata overhead. The existing
server-wide 500,000-character JSON limit still applies, including structured data.
A present invalid v2 manifest fails closed. Valid legacy v1 official Material Web
caches remain readable with explicit legacy/source labels; a successful refresh
publishes the v2 M3 corpus without mislabeling the legacy material.

## Honest scope

Visible Carbon sections and blocks retain headings, prose, lists, tables, code,
links, captions, header/media metadata, source IDs, module configurations and
unknown-kind gaps. Hidden descriptions/sections/blocks are excluded from content and search. New
normalizations carry `normalizationVersion:3` inside the unchanged v2 storage
format. `sections` and each content block's `provenance` retain both canonical and
version-specific source IDs, original source-array indices, and explicit
`isVisible`/`isHidden` booleans; `isDescriptionVisible` is retained at document
level. Absent source booleans stay absent rather than becoming inferred defaults.
`sectionIds` now includes both ID forms (canonical first, deduplicated), retaining
the name fallback only when neither ID exists. Synthetic description blocks have
no invented section/block IDs or block provenance.

The `exclusions` ledger contains allowlisted IDs, indices, flags and reasons only:
the hidden description, all hidden sections and their blocks, and hidden blocks in
the selected visible sections. It never contains hidden names, titles, prose,
chunks, resources or media. Existing `hiddenBlocks` counts remain scoped to the
selected visible sections. Read responses expose the ledger separately, section
and description provenance in citations, and block provenance on every fragment
(including heading-filtered and continuation reads) and metadata entry. Search
and context citations also retain section provenance; context fragments retain
block provenance. Older v2 snapshots remain readable with optional metadata absent
and `visibilityMetadata: "not-recorded; refresh to populate"`; refresh re-normalizes
verified resumable source envelopes without requiring new content downloads.

External image/video and prototype URLs are metadata only; binaries are not
fetched or visually interpreted.
Resource references in article snapshots are the original unresolved inventory.
The separate numeric sidecar is now integrated through `material_read_spec`; run
`npm run refresh-resources` explicitly, then inspect the `resources` ledger in
`material_coverage_status` for current per-module resolution. It remains partial.
Complete canonical URL ingestion is therefore
**not** a claim of complete numeric specifications, media understanding, component
implementation, accessibility certification or usability coverage.

Verification: `npm test`, `npm run build`, `npm run smoke -- --require-cache`, then
`MATERIAL_REAL_CACHE_TEST=1 npm test -- tests/m3-real-stdio.test.ts` after a real
refresh. The opt-in SDK test verifies every document digest, representative search/
read/context/coverage calls and lossless multi-page reconstruction over real stdio,
writing `artifacts/m3-stdio-verification.json`. All downloaded content and evidence
artifacts are ignored by version control; no official corpus is bundled.
