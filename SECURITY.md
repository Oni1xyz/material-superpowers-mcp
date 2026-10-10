# Security policy

## Reporting

Report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/Oni1xyz/material-superpowers-mcp/security/advisories/new). Do not put credentials, private source material or working exploit payloads in public issues. Include the commit, runtime/version, affected tool or command, and a minimal non-sensitive reproduction. No response-time or supported-version SLA is promised.

## Boundaries

- This is a local **stdio MCP server**, not an authenticated HTTP service. Connect only trusted MCP clients. Do not expose stdio through an unauthenticated network bridge.
- Ordinary tools perform local computation and read the configured cache; import and evaluation commands are separate. Run the server without network access when possible.
- The configured cache directory and explicit import destinations are operator-controlled. Digests detect corruption/mismatches; they are not signatures authenticating files an attacker can replace together with their manifests.
- Retrieved documentation and graph notes are untrusted source data, not agent instructions. Keep client-side approvals and sandboxing for actions taken based on tool results. A source allowlist does not make all source content trustworthy.
- Numeric resources can be unsupported, failed or budget-blocked. Graph links do not resolve those gaps. Reviews/evaluations are advisory and are not accessibility or security certification.
- The standalone browser evaluation harness is for trusted local fixtures in an isolated environment. Browser routing rules are not an OS sandbox or permission to test arbitrary third-party sites. Playwright buffers/decompresses fetched response bodies; timeouts and disposal do not cap peak memory or request concurrency. Apply process/container memory and CPU limits when executing evaluations; hostile-fixture resource safety is not guaranteed.

## Recommended operation

Build from a reviewed commit and its exact lockfile. Install with `npm ci --ignore-scripts --engine-strict`; do not substitute an unpinned registry package. Keep `private:true` as an npm-publication safeguard. No credentials are required for normal operation.

Run Docker non-root with network disabled, a read-only filesystem, dropped capabilities, no-new-privileges and a read-only cache mount. Do not mount your home directory, Docker socket, agent credentials or unrelated workspaces. The Dockerfile excludes downloaded caches/artifacts from the image; users import their own official-source snapshot explicitly. See README for the verified command.

Source refresh requires network access to allowlisted official sources and a writable designated cache. Run it as a separate trusted operator step, not an agent tool side effect. Rebuild the knowledge graph after changing its corpus/resource dependencies. Keep caches, environment files, screenshots and raw interaction traces out of version control.

## Review limits

Repository review, bounded adversarial tests, dependency audits and secret-pattern scans reduce risk; they are not a professional penetration test or proof that no vulnerabilities or leaked secrets exist. Dependency/advisory results describe the time they were executed. See the committed security review report for actual scope, findings, fixes and unrun checks.

## Licensing and upstream content

Original project code is MIT licensed. Third-party dependencies, Material names/assets and downloaded official documentation retain their own licenses and terms. The code license does not grant permission to redistribute Google's documentation or assets. Downloaded source corpora are not bundled or committed.
