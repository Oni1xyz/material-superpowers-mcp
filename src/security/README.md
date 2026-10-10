# Tool argument validation boundary

Every registered tool goes through `executeTool` → `parseToolInput` before its
input schema or handler runs. The overridden SDK `CallToolRequest` handler passes
unaltered arguments to that same entry point; it deliberately avoids the SDK's
normal per-tool eager Zod validation. Tool listing and strict extra-property
rejection are unchanged. Failures remain `isError: true` with one text item,
limited to 1,200 characters. Unknown tool names retain their existing response.

`preflightInput` traverses already-decoded plain JSON iteratively, without JSON
serialization, with these inclusive limits:

| Resource | Limit |
| --- | ---: |
| Total nodes, including containers and scalar leaves | 2,048 |
| Nesting depth (root = 0) | 24 |
| Entries per array | 128 |
| Own enumerable keys per object | 128 |
| Characters per string or key | 200,000 |
| Aggregate characters across strings and keys | 500,000 |

Characters mean JavaScript UTF-16 code units, as in the existing Zod schemas.
Repeated values count each time, not just once per object/string identity.
Existing review inputs of 200,000 HTML characters **and** 200,000 CSS characters
remain supported, including their ordinary metadata/goals. Per-tool schema caps
(e.g. six breakpoints, 32 palette colors) still apply and are often much smaller.

After preflight, validation checks container children one at a time, stopping at
the first invalid child. Arrays check their schema length bounds before parsing
any children. Record key/value errors, including custom-message refinements, are
also fail-fast. The original Zod schemas remain authoritative for successful
output, defaults, transformations, strict keys and refinements. This matters
because Zod 3's `array.max` and `record.refine` normally accumulate all child
errors before failing; truncating that error list afterward is too late.

The traversal covers the object/array/record/union/optional/default/nullable/
effects schema types used by the tools. Schemas are trusted and synchronous;
field refinements must remain pure since preliminary child checks can repeat
them. Future collection or preprocessing schemas need an explicit review and,
if applicable, child-first support. Structural budgets still apply to all kinds.

## What this does not protect

This guard does **not** run before the SDK decodes JSON or validates the JSON-RPC
envelope. The pinned MCP SDK's stdio framing buffer has a separate default
10 MiB limit (`STDIO_DEFAULT_MAX_BUFFER_SIZE`); this is not a parser limit
implemented by this module. Do not claim this argument guard prevents arbitrary
pre-handler JSON parsing allocations or covers other transport limits.

The trust boundary is ordinary JSON data from MCP clients, not arbitrary
privileged JavaScript callers. Ordinary getters are rejected without invocation,
non-JSON values are rejected, and cycles hit resource budgets; host-supplied
Proxies and other privileged hooks are not sandboxed. This module itself performs
no filesystem, network, process or other external I/O.

## Regression coverage

`tests/security-input-runtime.test.ts` exercises the actual tools and SDK dispatch
inside 96/128 MiB Node subprocesses. Core dumps are disabled, wall time is capped
at 20 seconds, timeout uses `SIGKILL`, and captured output is capped at 8 KiB.
It includes the 300,052-byte / 100,000-breakpoint reproduction, hostile palette
records, scalar arrays, deep/aggregate inputs, all thirteen SDK tool dispatches,
and the existing large HTML/CSS boundary. The reproduction was verified to abort
with heap exhaustion before the fix and to return a bounded error after it.
`tests/security-input-validation.test.ts` checks inclusive limits, pre-Zod
coverage for every tool, child-first failure, bounded diagnostics and schema
semantics. Existing stdio integration tests additionally exercise actual framing,
initialization, listing, normal calls, strict validation and unknown tools.
