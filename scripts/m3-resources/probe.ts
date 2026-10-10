import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchOfficial, LIMITS, ORIGIN, resolveResources, validateVersion, type TokenRow } from './index.js';

const targets = [
  { slug: 'components/buttons', page: 'https://m3.material.io/components/buttons/specs', moduleType: 'TOKEN_TABLE' },
  { slug: 'styles/spacing', page: 'https://m3.material.io/styles/spacing/tokens', moduleType: 'MEASUREMENT' },
  { slug: 'styles/motion/overview', page: 'https://m3.material.io/styles/motion/overview/specs', moduleType: 'TOKEN_TYPE_UNSPECIFIED' },
];
const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const wait = () => new Promise(r => setTimeout(r, LIMITS.intervalMs));
interface Module { pointer: string; resourceName: string; libraryModuleType: string; moduleConfigurationOverrides: Record<string, unknown> | null }
function modulesIn(value: unknown, pointer = '', found: Module[] = [], depth = 0): Module[] {
  if (depth > 60) throw new Error('Article depth limit');
  if (Array.isArray(value)) value.forEach((v, i) => modulesIn(v, `${pointer}/${i}`, found, depth + 1));
  else if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.resourceName === 'string' && typeof v.libraryModuleType === 'string') {
      if (found.length >= 100) throw new Error('Article module limit');
      found.push({ pointer, resourceName: v.resourceName, libraryModuleType: v.libraryModuleType, moduleConfigurationOverrides: (v.moduleConfigurationOverrides ?? null) as Record<string, unknown> | null });
    }
    for (const [k, child] of Object.entries(v)) modulesIn(child, `${pointer}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`, found, depth + 1);
  }
  return found;
}
/** Three-page verification only; no sitemap crawl, media download, browser, or downloaded-JS execution. */
export async function probeResources(outputDir: string) {
  await mkdir(resolve(outputDir), { recursive: true });
  const dir = await mkdtemp(join(resolve(outputDir), 'discovery-'));
  await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' });
  const home = await fetchOfficial(`${ORIGIN}/`, { maxBytes: 2 * 1024 * 1024 });
  const scripts = [...home.body.toString('utf8').matchAll(/src=["'](\/static\/angular\/main\.[a-f0-9]+\.js)["']/g)];
  if (scripts.length !== 1) throw new Error('Expected one official hashed main bundle');
  const bundleUrl = ORIGIN + scripts[0][1]; await wait();
  const bundle = await fetchOfficial(bundleUrl, { maxBytes: 12 * 1024 * 1024 });
  await writeFile(join(dir, 'main.js.txt'), bundle.body, { flag: 'wx' });
  const code = bundle.body.toString('utf8');
  const carbonVersion = /carbonVersion:"([^"]+)"/.exec(code)?.[1];
  const dataModuleVersion = /dataModuleVersion:"([0-9]+)"/.exec(code)?.[1];
  if (!carbonVersion) throw new Error('No carbonVersion found'); validateVersion(carbonVersion);
  // Check known renderer source strings as data, never evaluate downloaded JavaScript.
  const rendererMarkers = ['_dsm/data/dsdb-m3/', '/TOKEN_TABLE.', 'this.libraryModuleType', 'fetchDsdbDataJSON', 'split("components/")[1]'];
  if (rendererMarkers.some(x => !code.includes(x))) throw new Error('Renderer endpoint mapping changed; inspect source before importing');
  const rendererIndex = code.indexOf('_dsm/data/dsdb-m3/');
  const rendererEvidence = code.slice(Math.max(0, rendererIndex - 350), rendererIndex + 1700);
  const articles = [];
  for (const target of targets) {
    const escaped = target.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const docId = new RegExp(`"slug":"${escaped}","exportedCarbonFileId":"([a-f0-9-]+\\.json)"`).exec(code)?.[1];
    if (!docId) throw new Error(`Cannot discover document ID for ${target.slug}`);
    const url = `${ORIGIN}/_dsm/content/m3/${carbonVersion}/${docId}`; await wait();
    const response = await fetchOfficial(url, { json: true, maxBytes: 4 * 1024 * 1024 });
    const file = join(dir, target.slug.replaceAll('/', '-') + '.json');
    await writeFile(file, response.body, { flag: 'wx' });
    const modules = modulesIn(JSON.parse(response.body.toString('utf8'))).filter(m => m.libraryModuleType === target.moduleType);
    if (!modules.length) throw new Error(`Expected numeric module missing for ${target.slug}`);
    articles.push({ ...target, sourceUrl: url, sha256: sha256(response.body), bytes: response.body.length, file, modules });
  }
  const resourceNames = [...new Set(articles.flatMap(a => a.modules.map(m => m.resourceName)))];
  const imported = await resolveResources({ carbonVersion, resourceNames, outputDir: dir });
  const pageChecks = [];
  for (const article of articles) {
    const checks = [];
    for (const module of article.modules) {
      const resource = imported.resources.find(r => r.resourceName === module.resourceName && r.moduleType === module.libraryModuleType);
      if (!resource?.rowsFile || resource.status !== 'resolved') { checks.push({ module, status: resource?.status ?? 'not-requested' }); continue; }
      const rows = (JSON.parse(await readFile(resource.rowsFile, 'utf8')) as { rows: TokenRow[] }).rows;
      const sets = module.moduleConfigurationOverrides?.tokenSets;
      if (!Array.isArray(sets) || !sets.every(s => typeof s === 'string')) throw new Error('Expected explicit article tokenSets override');
      const selected = rows.filter(row => row.tokenSet.displayName !== null && sets.includes(row.tokenSet.displayName));
      const tokenCount = new Set(selected.map(r => r.tokenResource)).size;
      const sample = selected.find(r => r.status === 'resolved' && (r.resolvedValue?.durationMs !== undefined || (r.resolvedValue?.length as Record<string, unknown> | undefined)?.value !== undefined));
      checks.push({ module, status: selected.length && sample ? 'verified-token-set-subset' : 'no-numeric-sample', rowCount: selected.length, tokenCount,
        // Context alternatives are retained; this is NOT selecting an active platform/theme combination.
        sample, resourceUrl: resource.url, resourceSha256: resource.sha256, rowsFile: resource.rowsFile });
    }
    pageChecks.push({ page: article.page, articleUrl: article.sourceUrl, articleSha256: article.sha256, checks });
  }
  const result = { format: 'm3-resource-discovery-v1', retrievedAt: new Date().toISOString(), carbonVersion, dataModuleVersion,
    homeUrl: `${ORIGIN}/`, homeSha256: sha256(home.body), bundleUrl, bundleSha256: sha256(bundle.body), rendererEvidence,
    note: 'Per-module tokenSets only, not all design-system tokens. Context alternatives, zero omission, references and units are not inferred. STATUS_TABLE is not resolved by this importer.',
    articles, pageChecks, resourceReport: imported.reportFile,
    resources: imported.resources.map(({ payloadFile, rowsFile, ...metadata }) => ({ ...metadata, payloadFile, rowsFile })),
  };
  const reportFile = join(dir, 'discovery-report.json');
  await writeFile(reportFile, JSON.stringify(result, null, 2), { flag: 'wx' });
  return { reportFile, ...result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== '--live' || !process.argv[3] || process.argv.length !== 4) throw new Error('Usage: tsx scripts/m3-resources/probe.ts --live <ignored-output-dir>');
  const result = await probeResources(process.argv[3]);
  console.log(JSON.stringify({ reportFile: result.reportFile, carbonVersion: result.carbonVersion, bundleSha256: result.bundleSha256,
    resources: result.resources, pages: result.pageChecks.map(p => ({ page: p.page, checks: p.checks.map(c => ({ status: c.status, ...('tokenCount' in c ? { tokenCount: c.tokenCount, rowCount: c.rowCount, sample: c.sample } : {}) })) })) }, null, 2));
  if (result.pageChecks.some(p => p.checks.some(c => c.status !== 'verified-token-set-subset'))) process.exitCode = 1;
}
