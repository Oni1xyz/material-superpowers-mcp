import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultCacheDir, sha256 } from '../src/material/cache.js';
import { boundedLocalRead, computeCoverage, publishCorpus, type CorpusDocument } from '../src/material/corpus.js';
import { parseCarbonDocument } from '../src/material/carbon.js';
import { categoryFor, contentUrl, tabSlug, validateM3Url } from '../src/material/discovery.js';
import { boundedFetch, discoverOfficialM3 } from './import-official.js';
/** Only this explicit CLI performs network and disk writes. MCP handlers only
 * read immutable published snapshots; resource references stay unresolved. */
async function refresh() {
    const dir = defaultCacheDir(), discovery = await discoverOfficialM3();
    const { carbonVersion, bundleSha256, mappings } = discovery;
    const resumeRelative = `imports/${carbonVersion}/${bundleSha256}`, resumeDir = join(dir, resumeRelative);
    await mkdir(resumeDir, { recursive: true });
    const ids = [...new Set(mappings.filter(m => m.status === 'mapped').map(m => m.documentId!))].sort();
    const payloads = new Map<string, {
        text: string;
        sourceSha256: string;
        fetchedAt: string;
    }>();
    let cursor = 0, downloaded = 0, resumed = 0, totalBytes = 0;
    process.stderr.write(`Discovered ${discovery.entries.length} sitemap URLs, ${ids.length} source documents, carbonVersion ${carbonVersion}.\n`);
    const worker = async () => {
        while (cursor < ids.length) {
            const id = ids[cursor++];
            let payload: {
                text: string;
                sourceSha256: string;
                fetchedAt: string;
            } | undefined;
            if (!process.argv.includes('--force'))
                try {
                    const stored = JSON.parse(await boundedLocalRead(dir, `${resumeRelative}/${id}`, 12000000));
                    if (stored.carbonVersion === carbonVersion && stored.bundleSha256 === bundleSha256 && stored.documentId === id && typeof stored.text === 'string' && stored.text.length <= 8000000 && sha256(stored.text) === stored.sourceSha256 && typeof stored.fetchedAt === 'string' && Number.isFinite(Date.parse(stored.fetchedAt))) {
                        payload = { text: stored.text, sourceSha256: stored.sourceSha256, fetchedAt: stored.fetchedAt };
                        resumed++;
                    }
                }
                catch { /* absent or corrupt resumable payload is fetched again */ }
            if (!payload) {
                let result: Awaited<ReturnType<typeof boundedFetch>> | undefined;
                for (let attempt = 0; attempt < 3; attempt++)
                    try {
                        result = await boundedFetch(contentUrl(carbonVersion, id), { validate: validateM3Url, maxBytes: 8000000, timeoutMs: 30000 });
                        break;
                    }
                    catch (error) {
                        if (attempt === 2)
                            throw error;
                        await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
                    }
                if (!result || result.finalUrl !== contentUrl(carbonVersion, id) || !result.contentType.toLowerCase().includes('json'))
                    throw new Error(`Unexpected source identity/type: ${id}`);
                // Validate JSON before it becomes a resumable artifact; semantic validation is
                // repeated for each exact canonical section below.
                JSON.parse(result.text);
                payload = { text: result.text, sourceSha256: sha256(result.text), fetchedAt: new Date().toISOString() };
                downloaded++;
                const temporary = join(resumeDir, `.${randomUUID()}.tmp`);
                try {
                    await writeFile(temporary, JSON.stringify({ ...payload, carbonVersion, bundleSha256, documentId: id }), { flag: 'wx', mode: 0o600 });
                    await rename(temporary, join(resumeDir, id));
                }
                finally {
                    await rm(temporary, { force: true });
                }
            }
            totalBytes += Buffer.byteLength(payload.text);
            if (totalBytes > 256000000)
                throw new Error('Total source byte limit exceeded');
            payloads.set(id, payload);
        }
    };
    // Await all workers even on failure before exiting; no detached writes.
    const results = await Promise.allSettled(Array.from({ length: 3 }, worker));
    const failure = results.find(r => r.status === 'rejected');
    if (failure?.status === 'rejected')
        throw failure.reason;
    const documents: CorpusDocument[] = [];
    for (const map of mappings.filter(m => m.status === 'mapped')) {
        const source = payloads.get(map.documentId!)!;
        let parsed;
        try {
            parsed = parseCarbonDocument(JSON.parse(source.text), map.section);
        }
        catch (error) {
            throw new Error(`Cannot parse exact path ${map.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
        documents.push({ ...parsed, path: map.path, url: map.url, category: map.category, sourceKind: 'material-3', documentId: map.documentId!, carbonVersion, sourceUrl: contentUrl(carbonVersion, map.documentId!), section: map.section, sourceSha256: source.sourceSha256, sha256: sha256(parsed.text), fetchedAt: source.fetchedAt, extractionMethod: 'carbon-semantic-v2 (strict JSON; visible exact canonical sections; structured HTML, media and unresolved resource references)' });
    }
    const confirm = await discoverOfficialM3();
    if (confirm.carbonVersion !== carbonVersion || confirm.bundleSha256 !== bundleSha256 || confirm.sitemapSha256 !== discovery.sitemapSha256)
        throw new Error('Official source changed during refresh; retry to avoid mixed versions');
    const corpus = await publishCorpus(dir, documents, { carbonVersion, bundleUrl: discovery.bundleUrl, bundleSha256, sitemapSha256: discovery.sitemapSha256, discoveredAt: discovery.discoveredAt, mappings, routeInventory: discovery.routes.map(r => ({ path: r.slug, category: categoryFor(r.slug), documentId: r.exportedCarbonFileId, canonicalPaths: r.tabs?.length ? r.tabs.map(t => `${r.slug}/${tabSlug(t.label)}`) : [r.slug] })) });
    const coverage = computeCoverage(corpus);
    await mkdir('artifacts', { recursive: true });
    const report = { ...coverage, import: { downloaded, resumed, totalSourceBytes: totalBytes }, reconciliation: { liveSitemapUniqueUrls: discovery.entries.length, ledgerUniqueUrls: new Set(mappings.map(m => m.url)).size, missingFromLedger: discovery.entries.filter(e => !mappings.some(m => m.url === e.url)).map(e => e.url), extraInLedger: mappings.filter(m => !discovery.entries.some(e => e.url === m.url)).map(m => m.url) } };
    await writeFile('artifacts/m3-coverage-report.json', JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ cacheDirectory: dir, snapshot: corpus.snapshot, carbonVersion, knowledge: coverage.knowledge, unresolvedResources: coverage.gaps.unresolvedResourceCount, unknownKinds: coverage.gaps.unknownKinds, unknownModules: coverage.gaps.unknownModules, downloaded, resumed, totalSourceBytes: totalBytes, report: 'artifacts/m3-coverage-report.json' }, null, 2) + '\n');
}
try {
    await refresh();
}
catch (error) {
    process.stderr.write(`Refresh failed; previous published cache preserved: ${error instanceof Error ? error.message.slice(0, 1500) : 'unknown error'}\n`);
    process.exitCode = 1;
}
