# Wikilink graph verification

This increment adds an offline, Obsidian-compatible navigation layer. It does not claim that linking an unsupported resource decodes its values or completes Material implementation coverage.

## Verified artifact

- Graph snapshot: `33c9176bccefa9b53a030963979a58b972096f7760ed1d9a4086f21ba9957c6b`.
- 434 notes: all 263 indexed documents, all 96 resource-module references, six authored task entries, plus navigation hubs.
- 1,619 directed edges with reciprocal backlinks; 3,238 resolving wikilinks.
- Every note is reachable from `home.md`; every note digest and internal link target was checked.
- Corpus binding: `34f48f6acf15809e02e4760b25d28104d11ef41754769ee86667b8af9958da51`.
- Resource binding: `f504eb3d5d0e2198326f6b923489b540cf9859ca681d56c6ee8f6d2fb2b26ec7`.
- Generated vault: `.cache/material/knowledge/snapshots/<graph-snapshot>/vault` (ignored by Git, not the user's personal vault).

## Agent interface

`material_navigate` searches with `query`, reads an exact `id`, or opens `home.md` with an empty request. Notes expose wikilinks, reciprocal backlinks, typed origins, citations and existing documentation/spec tool arguments. Pagination is bound to the graph, source snapshots and request parameters. Missing or stale graphs require an explicit offline rebuild.

The canonical navigation instruction is 72 words and is exposed during actual MCP initialization; the complete server instruction remains under 90 words. Search/read results are bounded and never implicitly download source data. Authored task routes are labeled as authored, and unsupported resources remain metadata-only pointers.

## Executed checks

- Build and strict standalone builder/production-test TypeScript check passed.
- `MATERIAL_REAL_CACHE_TEST=1 MATERIAL_REAL_RESOURCE_TEST=1 npm test`: **263 tests passed across 23 files**, no skipped tests in this run.
- Real graph regeneration produced the same snapshot twice; all document/module counts and bindings reconcile the existing caches.
- Actual production SDK stdio tested the 13-tool registry, succinct initialization instructions, task search, linked accessibility-source retrieval, pagination progress and strict invalid-input rejection.
- Independent spec review: PASS. Independent quality/security review: APPROVED; verified existing notes/links/digests, six nested fail-fast probes and four cursor-boundary rejections.
- 16 independent offline evaluations passed. Existing UI harness: 24/24 generated checks, 9/9 independent checks, six seeded-bad failures detected, zero page errors/external attempts; ten manual checks remain outstanding.
- Docker rebuilt; all 13 tools passed with network disabled and the actual cache mounted read-only. Clean-image missing-cache/missing-graph behavior also passed.
- No new dependencies or network imports were required to build the graph. No global Hermes configuration or personal Obsidian vault was changed.

## Reproduction

```sh
npm run build
npm run build-knowledge
MATERIAL_REAL_CACHE_TEST=1 MATERIAL_REAL_RESOURCE_TEST=1 npm test
npm run smoke -- --require-cache --require-knowledge
docker build -t material-superpowers-mcp:local .
npm run smoke -- --docker --with-cache --require-cache --require-knowledge
```

Initial source setup still uses the explicit `refresh-cache` and optional `refresh-resources` commands. Rebuild the graph after changing either source snapshot. CI tests synthetic fixtures without fetching the official corpus; the real-cache checks above were executed locally. Exact-commit hosted CI is verified separately after publication.
