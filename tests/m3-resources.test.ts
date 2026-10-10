import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { assertOfficialUrl, fetchOfficial, normalizeResource, planResourceRequests, resolveResources, LIMITS } from '../scripts/m3-resources/index.js';

const version = '2026-09-23_06-10-05';
const ds = 'designSystems/20543ce18892f7d9';
const component = `${ds}/components/1c4257f8804f9478`;
const set = `${ds}/tokenSets/65c709984783673d`;
const token = `${set}/tokens/73aa63b778e550bb`;
const value = `${token}/values/0dd33422bc1eb695`;
// Deliberately tiny structural fixture, based on the observed public spacing schema.
const fixture = () => ({ system: { name: ds, dsdbVersion: '38.2.9', _isResolved: true,
  tokenSets: [{ name: set, displayName: 'Spacing', tokenSetName: 'md.sys.measurement' }],
  components: [], tags: [], tokens: [{ name: token, tokenName: 'md.sys.measurement.space500', displayName: 'Space 500', tokenValueType: 'LENGTH' }],
  values: [{ name: value, length: { value: 40, unit: 'DIPS' } }],
  contextualReferenceTrees: { [token]: { contextualReferenceTree: [{ referenceTree: { tokenName: 'md.sys.measurement.space500', value: { name: value } }, resolvedValue: { length: { value: 40, unit: 'DIPS' } } }] } },
} });
const dirs: string[] = [];
async function output() { const dir = await mkdtemp(join(tmpdir(), 'm3-resource-test-')); dirs.push(dir); return dir; }
afterEach(async () => { vi.unstubAllGlobals(); vi.useRealTimers(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });

describe('M3 public resource importer (offline)', () => {
  it('uses renderer module-type filenames, not resource-name underscores or dataModuleVersion', () => {
    const requests = planResourceRequests(version, [component, ds, ds]);
    expect(requests.map(r => r.url)).toEqual([
      `https://m3.material.io/_dsm/data/dsdb-m3/${version}/TOKEN_TABLE.1c4257f8804f9478.json`,
      `https://m3.material.io/_dsm/data/dsdb-m3/${version}/MEASUREMENT.20543ce18892f7d9.json`,
      `https://m3.material.io/_dsm/data/dsdb-m3/${version}/TOKEN_TYPE_UNSPECIFIED.20543ce18892f7d9.json`,
    ]);
  });
  it.each(['../oops', `${ds}/../a`, `${ds}?x=y`, `${ds}/components/ABC`, 'https://evil.test/a', 'designSystems/20543CE18892F7D9'])('rejects invalid resource %s before fetch', async name => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(resolveResources({ carbonVersion: version, resourceNames: [name], outputDir: await output() })).rejects.toThrow(/resource/i);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['1765863100935162', '../x', '2026-99-23_06-10-05', '2026-02-30_06-10-05', `${version}?x`])('rejects invalid version %s', v => {
    expect(() => planResourceRequests(v, [ds])).toThrow(/version/i);
  });
  it('bounds request count', () => expect(() => planResourceRequests(version, Array(13).fill(ds))).toThrow(/limit/i));
  it.each(['http://m3.material.io/', 'https://evil.test/', 'https://m3.material.io.evil.test/', 'https://user@m3.material.io/', 'https://m3.material.io/?redirect=1', 'https://m3.material.io/_dsm/data/dsdb-m3/2026-09-23_06-10-05/TOKEN_TABLE.1c4257f8804f9478.json#x', 'https://m3.material.io/not-approved', 'https://m3.material.io/%2e%2e/'])('rejects unapproved URL %s', url => expect(() => assertOfficialUrl(url)).toThrow());
  it('rejects a redirected final URL even if a transport auto-follows', async () => {
    const response = new Response('{}', { headers: { 'content-type': 'application/json' } });
    Object.defineProperty(response, 'url', { value: 'https://evil.test/payload' });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response); vi.stubGlobal('fetch', fetch);
    await expect(fetchOfficial(planResourceRequests(version, [component])[0].url, { json: true })).rejects.toMatchObject({ status: 'redirect-rejected' });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual', credentials: 'omit' });
  });
  it('bounds streamed data without trusting Content-Length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(100), { headers: { 'content-type': 'application/json' } })));
    await expect(fetchOfficial(planResourceRequests(version, [component])[0].url, { json: true, maxBytes: 20 })).rejects.toMatchObject({ status: 'body-limit' });
  });
  it('times out a hung response body and cancels its reader', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } })));
    const pending = expect(fetchOfficial(planResourceRequests(version, [component])[0].url, { json: true })).rejects.toMatchObject({ status: 'timeout' });
    await vi.advanceTimersByTimeAsync(LIMITS.timeoutMs + 1); await pending;
    expect(cancel).toHaveBeenCalled();
  });
  it('normalizes verified values with source pointers, set membership and unconverted units', () => {
    const result = normalizeResource(fixture(), ds);
    expect(result.schema).toBe('dsdb-public-system-v1');
    expect(result.rows[0]).toMatchObject({ tokenName: 'md.sys.measurement.space500', tokenSet: { name: set, displayName: 'Spacing' }, resolvedValue: { length: { value: 40, unit: 'DIPS' } }, contextTags: [], status: 'resolved' });
    expect(result.rows[0].sourcePointer).toContain('/system/contextualReferenceTrees/');
  });
  it('preserves observed DSDB Bezier x0/y0/x1/y1 and type variation axes', () => {
    const data = fixture(); const entry = data.system.contextualReferenceTrees[token].contextualReferenceTree[0];
    for (const resolvedValue of [{ cubicBezier: { x0: 0.2, x1: 0, y1: 1 } }, { type: { variationAxes: { wdth: { axisValue: 100 } } } }]) {
      const trees = { [token]: { contextualReferenceTree: [{ ...entry, resolvedValue }] } };
      expect(normalizeResource({ system: { ...data.system, contextualReferenceTrees: trees } }, ds).rows[0].resolvedValue).toEqual(resolvedValue);
    }
  });
  it('does not invent zero for omitted protobuf fields', () => {
    const data = fixture(); delete (data.system.contextualReferenceTrees[token].contextualReferenceTree[0].resolvedValue.length as { value?: number }).value;
    expect(normalizeResource(data, ds).rows[0].resolvedValue).toEqual({ length: { unit: 'DIPS' } });
  });
  it('keeps explicit undefined and composite context variants distinct', () => {
    const data = fixture(); const entry = data.system.contextualReferenceTrees[token].contextualReferenceTree[0];
    const tree = { contextualReferenceTree: [{ ...entry, resolvedValue: { undefined: true } }, { referenceTree: entry.referenceTree, resolvedCustomCompositeValue: { properties: { damping: { resolvedValue: { numeric: 0.8 } } } } }] };
    const rows = normalizeResource({ system: { ...data.system, contextualReferenceTrees: { [token]: tree } } }, ds).rows;
    expect(rows.map(r => r.status)).toEqual(['undefined', 'resolved-composite']);
    expect(rows[1].resolvedCustomCompositeValue).toEqual({ properties: { damping: { resolvedValue: { numeric: 0.8 } } } });
  });
  it.each([{ length: { value: '40', unit: 'DIPS' } }, { durationMs: Infinity }, { bogus: 1 }, { length: { value: 40, surprise: true } }])('rejects malformed typed resolved values', resolvedValue => {
    const data = fixture(); const entry = data.system.contextualReferenceTrees[token].contextualReferenceTree[0];
    expect(() => normalizeResource({ system: { ...data.system, contextualReferenceTrees: { [token]: { contextualReferenceTree: [{ ...entry, resolvedValue }] } } } }, ds)).toThrow(/schema/i);
  });
  it('rejects mismatched value pointers and unverified DSDB versions', () => {
    const data = fixture(); data.system.dsdbVersion = '99.0.0';
    expect(() => normalizeResource(data, ds)).toThrow(/schema/);
    data.system.dsdbVersion = '38.2.9'; data.system.values = [];
    expect(() => normalizeResource(data, ds)).toThrow(/reference value/);
  });
  it('rejects unbounded arbitrary deprecation metadata rather than amplifying it per row', () => {
    const data = fixture(); const tokenData = { ...data.system.tokens[0], deprecationMessage: { arbitrary: 'not the observed schema' } };
    expect(() => normalizeResource({ system: { ...data.system, tokens: [tokenData] } }, ds)).toThrow(/schema/);
  });
  it('preserves missing trees and explicit undefined rather than inventing values', () => {
    const data = fixture();
    expect(normalizeResource({ system: { ...data.system, contextualReferenceTrees: {} } }, ds).rows[0]).toMatchObject({ status: 'no-resolved-tree', resolvedValue: null });
  });
  it.each([{}, { system: {} }, { system: { ...fixture().system, name: 'designSystems/0000000000000000' } },
    { system: { ...fixture().system, tokens: [{ ...fixture().system.tokens[0], tokenName: 42 }] } },
    { system: { ...fixture().system, contextualReferenceTrees: { [token]: { contextualReferenceTree: [{ resolvedValue: { length: { value: '40', unit: 'DIPS' } } }] } } } },
  ])('fails closed on invalid/wrong-system schemas', data => expect(() => normalizeResource(data, ds)).toThrow(/schema/i));
  it('caps normalized output during collection, including repeated metadata', () => {
    const data = fixture(); const entry = data.system.contextualReferenceTrees[token].contextualReferenceTree[0];
    const hugeToken = { ...data.system.tokens[0], displayName: 'a'.repeat(4096), tokenName: 'b'.repeat(4096) };
    const hugeEntry = { ...entry, referenceTree: { ...entry.referenceTree, tokenName: hugeToken.tokenName } };
    const system = { ...data.system, tokens: [hugeToken], contextualReferenceTrees: { [token]: { contextualReferenceTree: Array(5000).fill(hugeEntry) } } };
    expect(() => normalizeResource({ system }, ds)).toThrow(/byte limit/);
  });
  it('does not confuse a DS-wide response with the requested component', () => expect(() => normalizeResource(fixture(), component)).toThrow(/component/i));
  it('writes payload/hash/rows/report only into a fresh ignored output directory', async () => {
    const raw = JSON.stringify(fixture()); const fetch = vi.fn(async () => new Response(raw, { headers: { 'content-type': 'application/JSON' } })); vi.stubGlobal('fetch', fetch);
    const report = await resolveResources({ carbonVersion: version, resourceNames: [ds], outputDir: await output() });
    expect(report.resources).toHaveLength(2);
    expect(report.resources[0]).toMatchObject({ status: 'resolved', schema: 'dsdb-public-system-v1', sha256: createHash('sha256').update(raw).digest('hex'), rowCount: 1 });
    expect(await readFile(report.resources[0].payloadFile!, 'utf8')).toBe(raw);
    expect(JSON.parse(await readFile(report.reportFile, 'utf8')).resources).toHaveLength(2);
    expect(await readFile(join(report.outputDir, '.gitignore'), 'utf8')).toBe('*\n');
    expect(fetch.mock.calls).toHaveLength(2);
  });
  it.each([
    [() => new Response('', { status: 302, headers: { location: 'https://evil.test/' } }), 'redirect-rejected'],
    [() => new Response('missing', { status: 404 }), 'http-error'],
    [() => new Response('<html>not data</html>', { headers: { 'content-type': 'text/html' } }), 'invalid-content-type'],
    [() => new Response('{bad', { headers: { 'content-type': 'application/json' } }), 'invalid-json'],
    [() => new Response('{}', { headers: { 'content-type': 'application/json' } }), 'invalid-schema'],
    [() => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(LIMITS.bodyBytes + 1) } }), 'body-limit'],
  ] as const)('reports bounded failure without invented rows: %s', async (response, status) => {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    const report = await resolveResources({ carbonVersion: version, resourceNames: [component], outputDir: await output() });
    expect(report.resources[0].status).toBe(status);
    expect(report.resources[0].rowsFile).toBeUndefined();
  });
});
