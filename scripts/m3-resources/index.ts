import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Explicit, opt-in importer. Importing this module never starts network or filesystem work.
export const ORIGIN = 'https://m3.material.io';
export const LIMITS = Object.freeze({ resourceNames: 12, bodyBytes: 24 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, timeoutMs: 25_000, intervalMs: 300, rows: 50_000, normalizedBytes: 32 * 1024 * 1024 });
const ID = '[0-9a-f]{16}';
const RESOURCE = new RegExp(`^designSystems/(${ID})(?:/components/(${ID}))?$`);
const TOKEN = new RegExp(`^designSystems/${ID}/tokenSets/${ID}/tokens/${ID}$`);
const SET = new RegExp(`^designSystems/${ID}/tokenSets/${ID}$`);
const TAG = new RegExp(`^designSystems/${ID}/contextTagGroups/${ID}/tags/${ID}$`);
const VALUE = new RegExp(`^designSystems/${ID}/tokenSets/${ID}/tokens/${ID}/values/${ID}$`);
export type ModuleType = 'TOKEN_TABLE' | 'MEASUREMENT' | 'TOKEN_TYPE_UNSPECIFIED';
export interface ResourceRequest { resourceName: string; moduleType: ModuleType; url: string }
type ObjectData = Record<string, unknown>;
export interface TokenRow {
  tokenResource: string; tokenName: string; displayName: string; tokenValueType: string;
  tokenSet: { name: string; displayName: string | null }; isDependency: boolean;
  contextTags: { name: string; displayName: string | null }[];
  status: 'resolved' | 'undefined' | 'resolved-composite' | 'no-resolved-tree';
  resolvedValue: ObjectData | null; resolvedCustomCompositeValue?: ObjectData;
  sourcePointer: string; valueResource: string | null; deprecationMessage?: { message: string };
}
export interface ResourceResult extends ResourceRequest {
  status: string; retrievedAt: string; httpStatus?: number; sha256?: string; bytes?: number;
  schema: string | null; dsdbVersion?: string; payloadFile?: string; rowsFile?: string;
  rowCount?: number; tokenCount?: number; tokenSets?: { name: string; displayName: string }[];
  rowStatuses?: Record<string, number>; error?: string;
}
export interface ResourceReport {
  format: 'm3-resources-report-v1'; carbonVersion: string; outputDir: string; reportFile: string;
  resources: ResourceResult[]; scope: string; limits: typeof LIMITS;
}

export function validateVersion(version: string): void {
  if (typeof version !== 'string' || !/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(version)) throw new Error('Invalid carbon version');
  const iso = `${version.slice(0, 10)}T${version.slice(11).replaceAll('-', ':')}Z`;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().replace('.000', '') !== iso) throw new Error('Invalid carbon version');
}
export function planResourceRequests(carbonVersion: string, resourceNames: string[]): ResourceRequest[] {
  validateVersion(carbonVersion);
  if (!Array.isArray(resourceNames) || resourceNames.length > LIMITS.resourceNames) throw new Error('Resource count limit exceeded');
  for (const name of resourceNames) if (typeof name !== 'string' || !RESOURCE.test(name)) throw new Error('Invalid resource name');
  return [...new Set(resourceNames)].flatMap(resourceName => {
    const [, system, component] = RESOURCE.exec(resourceName)!;
    // Names alone do not encode module type. Only the three experimentally verified renderer paths are supported.
    const types: ModuleType[] = component ? ['TOKEN_TABLE'] : ['MEASUREMENT', 'TOKEN_TYPE_UNSPECIFIED'];
    return types.map(moduleType => ({ resourceName, moduleType, url: `${ORIGIN}/_dsm/data/dsdb-m3/${carbonVersion}/${moduleType}.${component ?? system}.json` }));
  });
}

function invalid(message: string): never { throw new Error(`Invalid resource schema: ${message}`); }
function object(value: unknown, label: string): ObjectData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label);
  return value as ObjectData;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 4096) invalid(label);
  return value;
}
function array(value: unknown, label: string, max: number = LIMITS.rows): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(label);
  return value;
}
function named(value: unknown, pattern: RegExp, label: string): string {
  const result = text(value, label); if (!pattern.test(result)) invalid(label); return result;
}
function numeric(value: unknown): void { if (typeof value !== 'number' || !Number.isFinite(value)) invalid('nonfinite or nonnumeric value'); }
function keys(value: ObjectData, allowed: string[]): void { if (Object.keys(value).some(k => !allowed.includes(k))) invalid('unrecognized value field'); }
function measure(value: unknown): void {
  const v = object(value, 'measurement'); keys(v, ['value', 'unit']);
  if ('value' in v) numeric(v.value);
  if ('unit' in v) text(v.unit, 'unit');
}
// Observed DSDB value encodings; omitted protobuf scalar fields stay omitted, never guessed to be zero.
function validateResolved(value: unknown, depth = 0): ObjectData {
  if (depth > 8) invalid('value depth');
  const v = object(value, 'resolvedValue');
  if (Object.keys(v).length !== 1) invalid('resolvedValue must contain one typed field');
  const [key, raw] = Object.entries(v)[0];
  if (['numeric', 'opacity', 'durationMs', 'fontWeight', 'axisValue'].includes(key)) numeric(raw);
  else if (['length', 'fontSize', 'fontTracking', 'lineHeight', 'elevation'].includes(key)) measure(raw);
  else if (key === 'undefined') { if (raw !== true) invalid('undefined sentinel'); }
  else if (key === 'color' || key === 'cubicBezier') {
    const obj = object(raw, key); keys(obj, key === 'color' ? ['red', 'green', 'blue', 'alpha'] : ['x0', 'y0', 'x1', 'y1']);
    Object.values(obj).forEach(numeric);
  } else if (key === 'fontNames') {
    const obj = object(raw, key); keys(obj, ['values']); array(obj.values, key, 100).forEach(x => text(x, key));
  } else if (key === 'shape') {
    const obj = object(raw, key); keys(obj, ['family', 'defaultSize', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight']);
    if ('family' in obj) text(obj.family, key);
    for (const [k, x] of Object.entries(obj)) if (k !== 'family') measure(x);
  } else if (key === 'type') {
    const obj = object(raw, key); keys(obj, ['fontNames', 'fontWeight', 'fontSize', 'fontTracking', 'lineHeight', 'variationAxes']);
    for (const [k, x] of Object.entries(obj)) validateResolved({ [k]: x }, depth + 1);
  } else if (key === 'variationAxes') {
    const obj = object(raw, key);
    if (Object.keys(obj).length > 100) invalid('variation axes limit');
    for (const [axis, x] of Object.entries(obj)) {
      if (!/^[A-Za-z0-9]{4}$/.test(axis)) invalid('variation axis name');
      const v = object(x, 'variation axis'); keys(v, ['axisValue']); numeric(v.axisValue);
    }
  } else if (key === 'motionPath') {
    const obj = object(raw, key); keys(obj, ['standardPath']); text(obj.standardPath, key);
  } else if (key === 'svgPath') text(raw, key);
  else invalid(`unrecognized resolved value type ${key}`);
  return v;
}
function validateComposite(value: unknown): ObjectData {
  const v = object(value, 'resolvedCustomCompositeValue'); keys(v, ['properties']);
  const props = object(v.properties, 'composite properties');
  if (Object.keys(props).length > 100) invalid('composite property limit');
  for (const p of Object.values(props)) {
    const wrapper = object(p, 'composite property'); keys(wrapper, ['resolvedValue']); validateResolved(wrapper.resolvedValue);
  }
  return v;
}
const pointer = (s: string) => s.replaceAll('~', '~0').replaceAll('/', '~1');

export function normalizeResource(payload: unknown, resourceName: string) {
  if (!RESOURCE.test(resourceName)) invalid('resource name');
  const systemName = resourceName.split('/').slice(0, 2).join('/');
  const s = object(object(payload, 'root').system, 'system');
  if (s.name !== systemName || s.dsdbVersion !== '38.2.9' || s._isResolved !== true) invalid('system identity, version, or resolution marker');
  const tokenSets = array(s.tokenSets, 'tokenSets').map(x => {
    const v = object(x, 'tokenSet'); return { name: named(v.name, SET, 'tokenSet name'), displayName: text(v.displayName, 'tokenSet displayName') };
  });
  const sets = new Map(tokenSets.map(v => [v.name, v.displayName]));
  if (sets.size !== tokenSets.length) invalid('duplicate tokenSet');
  const tags = new Map(array(s.tags, 'tags').map(x => { const v = object(x, 'tag'); return [named(v.name, TAG, 'tag name'), text(v.displayName, 'tag displayName')]; }));
  const components = array(s.components, 'components').map(x => object(x, 'component'));
  if (resourceName.includes('/components/') && !components.some(x => x.name === resourceName)) invalid('component identity mismatch');
  const values = new Set(array(s.values, 'values').map(x => named(object(x, 'value').name, VALUE, 'value name')));
  const trees = object(s.contextualReferenceTrees, 'contextualReferenceTrees');
  const tokens = array(s.tokens, 'tokens').map(x => object(x, 'token'));
  const tokenNames = new Set<string>(); const rows: TokenRow[] = [];
  let normalizedBytes = 0;
  const addRow = (row: TokenRow) => {
    normalizedBytes += Buffer.byteLength(JSON.stringify(row)) + 1;
    if (rows.length >= LIMITS.rows || normalizedBytes > LIMITS.normalizedBytes) invalid('normalized row/byte limit');
    rows.push(row);
  };
  for (const [i, t] of tokens.entries()) {
    const name = named(t.name, TOKEN, 'token name'); if (tokenNames.has(name)) invalid('duplicate token'); tokenNames.add(name);
    const tokenName = text(t.tokenName, 'tokenName'); const tokenSet = name.split('/tokens/')[0];
    let deprecationMessage: { message: string } | undefined;
    if (t.deprecationMessage !== undefined) {
      const message = object(t.deprecationMessage, 'deprecationMessage'); keys(message, ['message']);
      deprecationMessage = { message: text(message.message, 'deprecationMessage text') };
    }
    const base = { tokenResource: name, tokenName, displayName: text(t.displayName, 'token displayName'), tokenValueType: text(t.tokenValueType, 'tokenValueType'),
      tokenSet: { name: tokenSet, displayName: sets.get(tokenSet) ?? null }, isDependency: !sets.has(tokenSet),
      ...(deprecationMessage ? { deprecationMessage } : {}) };
    if (!Object.hasOwn(trees, name)) {
      addRow({ ...base, contextTags: [], status: 'no-resolved-tree', resolvedValue: null, valueResource: null, sourcePointer: `/system/tokens/${i}` });
      continue;
    }
    const entries = array(object(trees[name], 'tree container').contextualReferenceTree, 'contextualReferenceTree');
    if (entries.length === 0) invalid('empty tree');
    for (const [j, entry] of entries.entries()) {
      if (rows.length >= LIMITS.rows) invalid('row limit');
      const v = object(entry, 'tree variant');
      const ref = object(v.referenceTree, 'referenceTree');
      if (ref.tokenName !== tokenName) invalid('reference token mismatch');
      const valueResource = named(object(ref.value, 'reference value').name, VALUE, 'reference value name');
      if (!valueResource.startsWith(`${name}/values/`) || !values.has(valueResource)) invalid('missing/mismatched reference value');
      const contextTags = array(v.contextTags ?? [], 'contextTags', 100).map(x => { const n = named(x, TAG, 'context tag'); return { name: n, displayName: tags.get(n) ?? null }; });
      const hasValue = Object.hasOwn(v, 'resolvedValue'), hasComposite = Object.hasOwn(v, 'resolvedCustomCompositeValue');
      if (hasValue === hasComposite) invalid('missing or ambiguous resolved value');
      const resolvedValue = hasValue ? validateResolved(v.resolvedValue) : null;
      addRow({ ...base, contextTags, valueResource, sourcePointer: `/system/contextualReferenceTrees/${pointer(name)}/contextualReferenceTree/${j}`,
        status: hasComposite ? 'resolved-composite' : resolvedValue?.undefined === true ? 'undefined' : 'resolved', resolvedValue,
        ...(hasComposite ? { resolvedCustomCompositeValue: validateComposite(v.resolvedCustomCompositeValue) } : {}) });
    }
  }
  if (Object.keys(trees).some(k => !tokenNames.has(k))) invalid('tree for unknown token');
  const rowStatuses: Record<string, number> = {};
  for (const row of rows) rowStatuses[row.status] = (rowStatuses[row.status] ?? 0) + 1;
  return { schema: 'dsdb-public-system-v1' as const, dsdbVersion: s.dsdbVersion as string, tokenCount: tokens.length, tokenSets, rows, rowStatuses };
}

export class FetchFailure extends Error {
  constructor(public status: string, message: string, public httpStatus?: number) { super(message); }
}
/** Only the public homepage, hashed main bundle, UUID articles, and verified resource endpoints. No arbitrary URL fetch. */
export function assertOfficialUrl(url: string): void {
  const u = new URL(url);
  const path = u.pathname;
  const version = '\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}';
  const article = new RegExp(`^/_dsm/content/m3/${version}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.json$`);
  const resource = new RegExp(`^/_dsm/data/dsdb-m3/${version}/(?:TOKEN_TABLE|MEASUREMENT|TOKEN_TYPE_UNSPECIFIED)\\.${ID}\\.json$`);
  if (u.origin !== ORIGIN || u.username || u.password || u.search || u.hash || url !== u.href || !(path === '/' || /^\/static\/angular\/main\.[a-f0-9]+\.js$/.test(path) || article.test(path) || resource.test(path))) throw new FetchFailure('url-rejected', 'Not an approved official endpoint');
  const dated = path.match(/\/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\//);
  if (dated) validateVersion(dated[1]);
}
export async function fetchOfficial(url: string, options: { json?: boolean; maxBytes?: number } = {}) {
  assertOfficialUrl(url);
  const maxBytes = Math.min(options.maxBytes ?? LIMITS.bodyBytes, LIMITS.bodyBytes);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new FetchFailure('timeout', 'Request/body timeout')); }, LIMITS.timeoutMs); });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await Promise.race([fetch(url, { redirect: 'manual', signal: controller.signal, credentials: 'omit', headers: { Accept: options.json ? 'application/json' : '*/*' } }), timeout]);
    if (response.status >= 300 && response.status < 400) throw new FetchFailure('redirect-rejected', 'Redirects are not followed', response.status);
    if (response.url && response.url !== url) throw new FetchFailure('redirect-rejected', 'Response URL mismatch', response.status);
    if (!response.ok) throw new FetchFailure('http-error', `HTTP ${response.status}`, response.status);
    if (options.json && !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new FetchFailure('invalid-content-type', 'Expected application/json', response.status);
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new FetchFailure('body-limit', 'Declared body exceeds limit', response.status);
    if (!response.body) throw new FetchFailure('invalid-json', 'Missing body', response.status);
    reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const part = await Promise.race([reader.read(), timeout]); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new FetchFailure('body-limit', 'Streamed body exceeds limit', response.status);
      chunks.push(part.value);
    }
    return { body: Buffer.concat(chunks), httpStatus: response.status, contentType: response.headers.get('content-type') };
  } catch (error) {
    if (error instanceof FetchFailure) throw error;
    throw new FetchFailure(controller.signal.aborted ? 'timeout' : 'network-error', error instanceof Error ? error.message : 'Network failure');
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

export async function resolveResources({ carbonVersion, resourceNames, outputDir }: { carbonVersion: string; resourceNames: string[]; outputDir: string }): Promise<ResourceReport> {
  const requests = planResourceRequests(carbonVersion, resourceNames);
  if (typeof outputDir !== 'string' || !outputDir.trim()) throw new Error('Explicit outputDir required');
  await mkdir(resolve(outputDir), { recursive: true });
  const dir = await mkdtemp(join(resolve(outputDir), 'm3-resources-'));
  await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' });
  const report: ResourceReport = { format: 'm3-resources-report-v1', carbonVersion, outputDir: dir, reportFile: join(dir, 'report.json'), resources: [], limits: LIMITS,
    scope: 'Raw resource-scoped data, NOT page applicability. Caller must filter moduleConfigurationOverrides.tokenSets and preserve contextTags, tokenSetOrder and deprecations. Only TOKEN_TABLE, MEASUREMENT and TOKEN_TYPE_UNSPECIFIED are supported; STATUS_TABLE uses renderer-supplied data, not these endpoints. No inferred defaults or unit conversion.' };
  let remaining = LIMITS.totalBytes;
  for (const [index, request] of requests.entries()) {
    if (index) await new Promise(r => setTimeout(r, LIMITS.intervalMs));
    const result: ResourceResult = { ...request, retrievedAt: new Date().toISOString(), status: 'pending', schema: null };
    report.resources.push(result);
    // Reserve the whole request budget even on failure, bounding aggregate body exposure.
    const budget = Math.min(LIMITS.bodyBytes, remaining); remaining -= budget;
    if (!budget) { result.status = 'run-budget-exhausted'; continue; }
    try {
      const response = await fetchOfficial(request.url, { json: true, maxBytes: budget });
      result.httpStatus = response.httpStatus; result.bytes = response.body.byteLength;
      remaining += budget - response.body.byteLength;
      result.sha256 = createHash('sha256').update(response.body).digest('hex');
      const stem = `${String(index).padStart(2, '0')}-${request.moduleType}-${result.sha256}`;
      result.payloadFile = join(dir, `${stem}.payload.json`);
      await writeFile(result.payloadFile, response.body, { flag: 'wx' });
      let payload: unknown;
      try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)); }
      catch { throw new FetchFailure('invalid-json', 'Invalid UTF-8 or JSON', response.httpStatus); }
      let normalized: ReturnType<typeof normalizeResource>;
      try { normalized = normalizeResource(payload, request.resourceName); }
      catch (error) { throw new FetchFailure('invalid-schema', error instanceof Error ? error.message : 'Invalid schema', response.httpStatus); }
      result.schema = normalized.schema; result.dsdbVersion = normalized.dsdbVersion;
      result.tokenCount = normalized.tokenCount; result.tokenSets = normalized.tokenSets; result.rowCount = normalized.rows.length; result.rowStatuses = normalized.rowStatuses;
      result.rowsFile = join(dir, `${stem}.rows.json`);
      await writeFile(result.rowsFile, JSON.stringify({ schema: normalized.schema, sourceUrl: request.url, sourceSha256: result.sha256, scope: report.scope, rows: normalized.rows }), { flag: 'wx' });
      result.status = 'resolved';
    } catch (error) {
      if (!(error instanceof FetchFailure)) throw error; // Disk errors must not masquerade as a successful import.
      result.status = error.status; result.httpStatus ??= error.httpStatus; result.error = error.message.slice(0, 500);
    }
  }
  await writeFile(report.reportFile, JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}
