# Pre-publication security review

Date: 2026-10-10. Scope: local stdio MCP runtime, generated standalone browser runner, official-source importers, corpus/legacy/resource/graph caches, dependencies, Docker/CI and reachable Git history. This is an engineering review with regression tests, not a professional penetration test or security certification.

## Findings and fixes

- **Medium: malformed tool arguments exhausted memory during Zod validation.** The shared real SDK dispatch now preflights decoded JSON before tool-schema validation: 2,048 nodes, depth 24, 128 entries per collection, 200,000 characters per string/key, 500,000 aggregate characters. Child-first validation stops malformed collections at their first error. Constrained-heap regressions cover the original 300,052-byte request and normal simultaneous 200,000-character HTML/CSS inputs. This does not replace SDK framing/JSON decoding limits.
- **Medium: standalone browser runner allowed off-origin redirect hops.** Allowed requests now fetch with redirects/retries disabled. All HTTP 3xx responses, including same-origin redirects and 304, are rejected before another hop. Failures fail closed; response buffers are disposed. Tests exercise the emitted module without outside routing/CSP guards. Shared HTTP/WebSocket reporting retains at most 100 samples of 256 characters, strips credentials/query/fragment, and records total/omitted counts. URL paths can still be sensitive.
- **Medium: cache special files could block reads.** Corpus, legacy and graph readers now reject nonregular files before opening; no-follow/nonblocking flags and descriptor identity/type/size checks cover leaf replacement. Reads are bounded. FIFO and deterministic replacement tests execute in constrained, timeout-killed child processes with core dumps disabled.
- **Medium: publication followed descendant symlinks outside the cache.** Snapshot, graph, numeric-resource and resumable-import directories/targets are checked before writes; rejection preserves the prior manifest and creates no escaped files in regression fixtures. Independent review caught a remaining numeric-resource refresh inconsistency; follow-up tests cover raw/chunk/index/manifest/temp targets, pre-existing collisions and publication-hook replacements.
- **Medium: legacy fallback lacked confinement.** It now shares the hardened reader instead of a separate stat/readFile path. The actual document tool is covered.
- **Low: importer transport authorization was broader than intended.** Citation validation is separate from fetch authorization; requests and redirect hops are pinned to planned endpoints. Raw empty query/fragment suffixes and unrealistic bundle hashes are rejected. Redirect regressions use mocked transports.
- **Unsupported runtime:** Node 20 was end-of-life. Docker and CI now use Node 24.21.0 LTS, with a digest-pinned Docker base. npm dependencies remain exact-pinned and unchanged; Node 20 type declarations remain a conservative compile-time API baseline, not the runtime requirement.
- Added MIT licensing, security/reporting guidance, `.env.*` exclusion, and hardened Docker smoke options. npm publication remains disabled.

## Parent verification after integration

Executed with Node 24.21.0:

- `npm run build`: passed.
- Before the final resource-publication follow-up, `MATERIAL_REAL_CACHE_TEST=1 MATERIAL_REAL_RESOURCE_TEST=1 npm test`: **339 passed, zero skipped**, 28 test files.
- After that follow-up, final `npm test`: **377 passed, 7 optional live-cache tests skipped**, 29 test files. Explicit importer/harness TypeScript checks also passed. The requested final live-cache-enabled rerun was denied by tool approval and was not retried; the 339-test result must not be represented as final live-cache verification of the new resource refresher.
- `npm run check:dependencies`: **209 locked package versions** checked against the seven-day minimum age policy.
- `npm audit --audit-level=high`: **zero reported vulnerabilities**, including development dependencies.
- Real SDK stdio smoke with required corpus/graph: **13 tools called, 4 negative checks** passed.
- `npm run evals`: **16/16** independent offline contracts passed.
- `npm run evals:ui`: **24/24** generated good checks, **9/9** independent good checks; **6** seeded-bad failures detected; zero external attempts/page errors. Ten manual checks remain outstanding; screenshots are not approved visual baselines.
- New Docker build passed. Both missing-cache behavior and required real-cache/graph smoke passed with network disabled, read-only root filesystem, read-only cache, dropped capabilities, no-new-privileges and resource limits; runtime is non-root.
- Initial fetched-history scan covered 7 commits / 109 blobs, with no size exclusions. Three credential-URL matches were negative-test fixture values, not live credentials. No personal home paths, cache corpora or raw interaction traces were found. Scanning used targeted masked patterns; Gitleaks/TruffleHog were not installed.

## Release gates and limitations

Independent post-fix review and exact-commit hosted CI must pass before public visibility is enabled. Commit identities must use the owner-approved GitHub noreply identity throughout published branch history. Visibility and reporting settings must be read back, and public access checked without authentication. These are publication-time gates, not facts implied by this pre-publication report.

The operator-selected cache root can be a symlink; descendants cannot. The cache must remain operator-controlled: filesystem checks are not an OS sandbox against concurrent hostile ancestor-directory renames. Digests are not signatures. Ordinary MCP handlers remain local; imports and browser execution are separate explicit commands. Browser routing is not a general network sandbox. Playwright buffers/decompresses response bodies; timeout/disposal do not bound peak memory or concurrency. Use process/container limits for the trusted-fixture evaluation runner. No container OS vulnerability scanner or professional penetration test was run. The image is locally built, not published. No npm package, tag or GitHub release is authorized by this source-publication task.

Historical plans and agent instructions describe prior private milestones. The owner subsequently authorized public GitHub source with MIT licensing; package/image publication remains out of scope.
