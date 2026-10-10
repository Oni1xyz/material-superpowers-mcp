# M3 numeric token/spec resource discovery

## Outcome

The public numeric resources **are retrievable**. The earlier resource-name-to-underscores URL guess was wrong. Inspecting the official Angular renderer as text revealed module-type filenames. No credentials, authentication bypass, browser automation, community package execution, or downloaded JavaScript execution was necessary.

Verified live on **2026-10-10 UTC** (2026-10-09 PDT): buttons, spacing and motion returned HTTP 200, valid JSON and the observed DSDB schema. This is not a claim of complete M3 coverage or pixel-identical rendering of every table.

## Authoritative source and URL mapping

The homepage `https://m3.material.io/` currently references:

- Bundle: <https://m3.material.io/static/angular/main.7906d9e8e8cae962.js>
- Bundle SHA-256: `671cc76d20b6711f08df523c47224982f65ff2bd7939ff8da89eda8e82011aff`
- `carbonVersion`: `2026-09-23_06-10-05`
- `dataModuleVersion`: `1765863100935162`

The renderer constructs `_dsm/data/dsdb-m3/${carbonVersion}` and appends:

- `TOKEN_TABLE.${resourceName.split("components/")[1]}.json` for component token tables.
- `${libraryModuleType}.${resourceName.split("/")[1]}.json` for design-system token viewers.

`dataModuleVersion` is used for the feature-renderer script query (`_cdm/mio_new_feature_modules_bin_js.js?version=...`), **not** as the DSDB resource directory version. `STATUS_TABLE` uses renderer-supplied data instead of either of these requests; this importer does not resolve status tables.

Public undocumented endpoints verified in this work:

| Module / resource | URL | Bytes | Tokens in payload | Normalized rows |
|---|---|---:|---:|---:|
| Buttons / `TOKEN_TABLE` | [TOKEN_TABLE.1c4257f8804f9478.json](https://m3.material.io/_dsm/data/dsdb-m3/2026-09-23_06-10-05/TOKEN_TABLE.1c4257f8804f9478.json) | 19,934,959 | 697 | 14,901 |
| Measurement / `MEASUREMENT` | [MEASUREMENT.20543ce18892f7d9.json](https://m3.material.io/_dsm/data/dsdb-m3/2026-09-23_06-10-05/MEASUREMENT.20543ce18892f7d9.json) | 83,005 | 21 | 21 |
| Motion and other types / `TOKEN_TYPE_UNSPECIFIED` | [TOKEN_TYPE_UNSPECIFIED.20543ce18892f7d9.json](https://m3.material.io/_dsm/data/dsdb-m3/2026-09-23_06-10-05/TOKEN_TYPE_UNSPECIFIED.20543ce18892f7d9.json) | 276,587 | 74 | 204 |

SHA-256 of the exact response bodies, in table order:

```text
b4d1ef79ed0a2ccca089208486c511b100ac30361d0728a4267d6901d9084719
33167474b198eeecb8f63f654d89df928f2e598f40a7af2bde30b807cca27ea0
8b3ddb19378ff2d2ebbe3dddcf2c28951e97bb9ff12ed8a6d73278ae1b430c8c
```

The buttons payload is unexpectedly large because it includes reference dependencies and contextual resolution trees. An initial research fetch capped at 16,000,000 bytes was truncated and failed JSON parsing; that was a body cap, not a missing resource. The importer streams with a 24 MiB per-response ceiling rather than assuming small token tables.

## Article provenance and module overrides

Route document IDs are rediscovered from the current bundle, not hardcoded by the live probe:

| Page | Public article document | Article SHA-256 |
|---|---|---|
| [Buttons specs](https://m3.material.io/components/buttons/specs) | [e31df68a-59d4-41dc-8743-8c48b476d4f8.json](https://m3.material.io/_dsm/content/m3/2026-09-23_06-10-05/e31df68a-59d4-41dc-8743-8c48b476d4f8.json) | `6b02c90c2723997a47f7a7f1179d7f0a349c9854097ceebcb77c9bdfaa27ae45` |
| [Spacing tokens](https://m3.material.io/styles/spacing/tokens) | [36e81931-9b87-406f-9ec5-c0cc049564d8.json](https://m3.material.io/_dsm/content/m3/2026-09-23_06-10-05/36e81931-9b87-406f-9ec5-c0cc049564d8.json) | `403f9a462356eeb586661910bc32987535cf1875ed12bbac4b436c69e5891524` |
| [Motion specs](https://m3.material.io/styles/motion/overview/specs) | [ccf2c3e9-82b5-4c4a-9570-b0d08d95c0c1.json](https://m3.material.io/_dsm/content/m3/2026-09-23_06-10-05/ccf2c3e9-82b5-4c4a-9570-b0d08d95c0c1.json) | `1b8a277609134946eb43072113995e64985dad1c132ffee431538c342af09a4c` |

A resource name alone does **not** define which rows apply to a page. The article's `moduleConfigurationOverrides` must travel with every resource reference:

- **Spacing** selects `tokenSets: ["Spacing"]`: 18 tokens / 18 rows. The measurement response also contains `State - focus indicator`; those tokens are not spacing-page tokens just because they share a payload. `tokenSetOrder` is an ordering hint, not an additional inclusion list.
- **Motion** selects `tokenSets: ["Motion"]`: 45 tokens / 175 context-variant rows. The full response also contains `State opacities` and `Shape`. Preserve its context tag filter: `Standard`, `Expressive`, `Compose`, `Web`, `Android`.
- **Buttons** has separate current and deprecated token-table modules using the same component resource. Filtering each module's explicit token-set list yields 295 tokens / 8,448 rows for the current size/color sets and 192 tokens / 4,401 rows for deprecated sets. Do not collapse the modules or treat baseline/dependency tokens as automatically selected.

These row counts filter **token sets only**. They retain all returned context alternatives and are not counts of visible rows for a selected platform/theme. The saved discovery report retains full module overrides, source pointers and sample-row context tags; it does not invent a context-selection algorithm.

Examples read directly from verified resolved values (no unit conversion):

- `md.comp.button.xlarge.container.height`: `{"length":{"value":136,"unit":"DIPS"}}`, in `Button - Size - Xlarge`.
- `md.sys.measurement.space500`: `{"length":{"value":40,"unit":"DIPS"}}`, in `Spacing`.
- `md.sys.motion.duration.medium2`: `{"durationMs":300}`, in `Motion`.

These are specific token records, **not** universal button dimensions or motion prescriptions. Each saved sample includes the exact JSON Pointer into the hashed payload.

## Verified schema and normalization boundaries

Observed wrapper: `system`, with `name`, `dsdbVersion: "38.2.9"`, `_isResolved: true`, `tokenSets`, `components`, `tags`, `tokens`, `values`, and `contextualReferenceTrees`.

The local schema identifier `dsdb-public-system-v1` describes this importer's validated projection; it is not an official Google API/schema name. The importer fails closed on a different DSDB version or an unsupported resolved-value structure rather than guessing.

Rows are built from `system.tokens` and `system.contextualReferenceTrees[tokenResource].contextualReferenceTree[]`. Each row preserves:

- Token resource ID, token name, display name, value type, token-set resource/name and whether set metadata is absent (a dependency).
- Context tag IDs and available labels, without choosing a winning context.
- The server's typed `resolvedValue` or `resolvedCustomCompositeValue` exactly, plus source pointer and root value resource ID.
- Deprecation message; undefined and missing-tree statuses remain explicit.

File-level provenance contains source URL and response SHA-256. Complete raw payloads are retained in ignored output for reference-tree inspection; the importer does not itself traverse/resolve aliases or export author/profile metadata into normalized rows.

Important omissions are **not numeric defaults**:

- Some protobuf-like measurements omit `value`; the importer preserves the omission instead of manufacturing `0`.
- DSDB Bezier fields are `x0`, `y0`, `x1`, `y1`, sometimes partially omitted. They are not silently renamed into a CSS cubic-bezier tuple.
- Typed units such as `DIPS` and `POINTS` stay unchanged.
- Buttons: 12,880 resolved variant rows, 1,878 explicitly undefined variants, 143 tokens without a resolved tree. These are not 14,901 independently defined scalar values.
- Motion/type response: 132 resolved rows, 48 composite rows and 24 explicitly undefined variants. A composite may itself contain undefined properties.

## Entry points and safety

Required exported API in `scripts/m3-resources/index.ts`:

```ts
await resolveResources({
  carbonVersion: '2026-09-23_06-10-05',
  resourceNames: [
    'designSystems/20543ce18892f7d9/components/1c4257f8804f9478',
    'designSystems/20543ce18892f7d9',
  ],
  outputDir: '.cache/m3-resources',
});
```

This module is **not connected to normal MCP tools or automatic cache refresh**. Importing it starts no I/O. Its name-only API deliberately supports a narrow verified plan: component names produce `TOKEN_TABLE`; design-system names produce `MEASUREMENT` and `TOKEN_TYPE_UNSPECIFIED`. Other module types are not claimed to be covered. Caller-side page filtering remains mandatory.

Controls:

- Strict calendar-valid carbon versions, lowercase 16-hex resource IDs, and official HTTPS endpoint patterns; no arbitrary resource URL input.
- Exact `https://m3.material.io` origin; credentials omitted; redirects rejected, including same-origin redirects. Final response URL is checked as defense in depth.
- Sequential requests with a 300 ms inter-request pause; no retry storm; 25-second request/body deadline.
- Maximum 12 supplied names, 24 MiB streamed response, 64 MiB aggregate resource-response budget. Failed requests conservatively consume their reserved budget.
- Maximum 50,000 rows and 32 MiB compact row content per resource, checked during collection to prevent metadata amplification. Bounded fields, arrays and composite structures.
- Fresh, uniquely named output subdirectory with `.gitignore` containing `*`; exclusive file creation avoids overwriting earlier evidence. No downloaded JS is executed and no HTML is rendered.
- HTTP, redirect, timeout, size, JSON and schema failures are returned as explicit resource statuses with no invented rows. Hashes only exist when a complete accepted-size body was read. Disk failures throw rather than masquerading as success.

## Reproduction and verification

```sh
./node_modules/.bin/vitest run tests/m3-resources.test.ts
./node_modules/.bin/tsc --noEmit --target es2022 --module nodenext \
  --moduleResolution nodenext --strict --skipLibCheck \
  scripts/m3-resources/index.ts scripts/m3-resources/probe.ts tests/m3-resources.test.ts
./node_modules/.bin/tsx scripts/m3-resources/probe.ts --live .cache/m3-resource-verification
```

`probe.ts` fetches only the homepage, its current main bundle, the three article payloads and the three planned resources. It verifies the known renderer mapping as text, records hashes, retains article overrides and checks numeric samples for each token-table module. It does not crawl the sitemap, download media, or mirror M3.

TDD evidence: initial suite failed because the importer did not exist; a focused observed-Bezier/variation-axis test failed before implementing those real shapes; an arbitrary-deprecation-metadata test failed before bounding that projection. Final result: **49 offline tests passed**, standalone strict TypeScript check passed, and all three live resources plus all four article-module token-set checks passed.

Final live evidence for this workspace:

```text
.cache/m3-resource-verification/discovery-MKxPte/discovery-report.json
.cache/m3-resource-verification/discovery-MKxPte/m3-resources-FDiVUe/report.json
```

Payloads and normalized rows referenced by those reports remain ignored, not checked-in mirrors. Remaining limits: undocumented/changing official interfaces, only the three verified module types, no chosen-context renderer parity, no inferred numeric defaults, and no completeness claim for media-embedded dimension tables or all M3 resources.
