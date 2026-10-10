import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cacheRoot, checkCacheTarget, confinedPath, ensureCacheDirectory, readCacheFile } from './files.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defaultCacheDir, missingCacheMessage, sha256 } from './cache.js';
import { carbonIdSchema, carbonVersionSchema, categorySchema, contentUrl, M3_ORIGIN, pathSchema, validateM3Url, type Category, type RouteMapping } from './discovery.js';
import { blockProvenanceSchema, exclusionSchema, sectionProvenanceSchema, type ParsedCarbon } from './carbon.js';
import { recipeSchema } from '../design/recipes.js';
import { arrayBudget, boundedArray, objectFields } from './validation.js';
export interface CorpusDocument extends ParsedCarbon {
    path: string;
    url: string;
    category: Category;
    sourceKind: 'material-3';
    documentId: string;
    carbonVersion: string;
    sourceUrl: string;
    section?: string;
    sourceSha256: string;
    sha256: string;
    fetchedAt: string;
    extractionMethod: string;
}
const digest = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const headingSchema = z.object({ title: z.string().max(2000), level: z.number().int().min(1).max(6), block: z.number().int().min(0).max(5000) }).strict();
const provenanceSchema = z.object({ carbonVersion: carbonVersionSchema, bundleUrl: z.string().max(600), bundleSha256: digest, sitemapSha256: digest, discoveredAt: z.string().datetime() }).strict();
const mappingSchema = z.object({ url: z.string().max(600), path: pathSchema, lastmod: z.string().max(100).optional(), category: categorySchema, status: z.enum(['mapped', 'unresolved', 'excluded']), routeSlug: pathSchema.optional(), documentId: carbonIdSchema.optional(), section: z.string().max(200).optional(), reason: z.string().max(1000).optional() }).strict();
export const indexEntrySchema = z.object({ path: pathSchema, url: z.string().max(600), title: z.string().max(500), category: categorySchema, section: z.string().max(200).optional(), documentId: carbonIdSchema, file: z.string().regex(/^[a-f0-9]{64}\.json$/), fileSha256: digest, sha256: digest, sourceSha256: digest, fetchedAt: z.string().datetime(), headings: boundedArray(headingSchema, 5000), terms: boundedArray(z.string().max(100), 30000), blockCount: z.number().int().min(0).max(5000), resourceNames: boundedArray(z.string().max(1000), 2000), unknownKinds: boundedArray(z.string().max(100), 200), unknownModules: boundedArray(z.string().max(100), 200) }).strict();
const routeInventorySchema = boundedArray(z.object({ path: pathSchema, category: categorySchema, documentId: carbonIdSchema.nullable(), canonicalPaths: boundedArray(pathSchema, 50) }).strict(), 2000);
const indexSchema = z.object({ version: z.literal(2), provenance: provenanceSchema, documents: boundedArray(indexEntrySchema, 2000, 1), mappings: boundedArray(mappingSchema, 2000, 1), routeInventory: routeInventorySchema.default([]) }).strict();
const manifestSchema = z.object({ version: z.literal(2), snapshot: digest, indexSha256: digest, carbonVersion: carbonVersionSchema, createdAt: z.string().datetime() }).strict();
export type IndexEntry = z.infer<typeof indexEntrySchema>;
export type CorpusIndex = z.infer<typeof indexSchema>;
export type Corpus = {
    dir: string;
    snapshot: string;
    index: CorpusIndex;
};
export type PublicationInfo = z.infer<typeof provenanceSchema> & {
    mappings: RouteMapping[];
    routeInventory?: z.infer<typeof routeInventorySchema>;
};
export const searchTerms = (text: string) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{1,99}/gu) ?? []))].sort();
/** Fixed digest filenames plus shared nonsymlink, nonblocking descriptor reads. */
export const boundedLocalRead = readCacheFile;
function preflightIndex(raw: unknown) {
    const fields = objectFields(raw), take = arrayBudget('Corpus index', 250000);
    for (const entry of take(fields.documents, 2000)) {
        const doc = objectFields(entry);
        take(doc.headings, 5000);
        take(doc.terms, 30000);
        take(doc.resourceNames, 2000);
        take(doc.unknownKinds, 200);
        take(doc.unknownModules, 200);
    }
    take(fields.mappings, 2000);
    for (const route of take(fields.routeInventory, 2000))
        take(objectFields(route).canonicalPaths, 50);
}
function parseIndex(raw: unknown): CorpusIndex {
    preflightIndex(raw);
    return indexSchema.parse(raw);
}
function validateIndex(index: CorpusIndex) {
    validateM3Url(index.provenance.bundleUrl);
    if (!/^https:\/\/m3\.material\.io\/static\/angular\/main\.[a-f0-9]{16,64}\.js$/.test(index.provenance.bundleUrl))
        throw new Error('Invalid bundle provenance');
    const paths = new Set<string>(), mapped = new Map(index.mappings.map(m => [m.path, m]));
    if (mapped.size !== index.mappings.length)
        throw new Error('Duplicate sitemap paths');
    for (const m of index.mappings) {
        if (m.url !== M3_ORIGIN + '/' + m.path)
            throw new Error('Sitemap URL mismatch');
        validateM3Url(m.url);
    }
    for (const doc of index.documents) {
        if (paths.has(doc.path) || doc.url !== M3_ORIGIN + '/' + doc.path || doc.file !== sha256(doc.path) + '.json')
            throw new Error('Index identity mismatch');
        paths.add(doc.path);
        const m = mapped.get(doc.path);
        if (!m || m.status !== 'mapped' || m.documentId !== doc.documentId || m.section !== doc.section || m.category !== doc.category)
            throw new Error('Document not mapped by sitemap');
    }
    for (const m of index.mappings)
        if (m.status === 'mapped' && !paths.has(m.path))
            throw new Error('Mapped document missing from snapshot');
}
export async function openCorpus(dir = defaultCacheDir()): Promise<Corpus> {
    try {
        const manifest = manifestSchema.parse(JSON.parse(await boundedLocalRead(dir, 'manifest.json', 10000)));
        const text = await boundedLocalRead(dir, `snapshots/${manifest.snapshot}/index.json`, 16000000);
        if (sha256(text) !== manifest.indexSha256 || manifest.snapshot !== manifest.indexSha256)
            throw new Error('Snapshot index digest mismatch');
        const index = parseIndex(JSON.parse(text));
        if (index.provenance.carbonVersion !== manifest.carbonVersion)
            throw new Error('Mixed snapshot versions');
        validateIndex(index);
        return { dir: resolve(dir), snapshot: manifest.snapshot, index };
    }
    catch (error) {
        throw new Error(`${missingCacheMessage} Snapshot v2 required (legacy caches may be refreshed explicitly). ${error instanceof Error ? error.message.slice(0, 200) : ''}`);
    }
}
function validateDocument(doc: CorpusDocument, version: string) {
    const take = arrayBudget('Corpus document', 30000);
    // Also bound additive visibility metadata before any per-element parsing.
    take(doc.sections, 100);
    take(doc.exclusions, 200101);
    for (const block of take(doc.blocks, 5000)) {
        take(objectFields(block).chunks, 200);
        take(objectFields(block).media, 1000);
    }
    pathSchema.parse(doc.path);
    carbonIdSchema.parse(doc.documentId);
    carbonVersionSchema.parse(doc.carbonVersion);
    digest.parse(doc.sha256);
    digest.parse(doc.sourceSha256);
    z.string().datetime().parse(doc.fetchedAt);
    if (doc.carbonVersion !== version || doc.url !== M3_ORIGIN + '/' + doc.path || doc.sourceUrl !== contentUrl(version, doc.documentId) || doc.sourceKind !== 'material-3' || sha256(doc.text) !== doc.sha256)
        throw new Error('Document provenance/version mismatch');
    if (doc.pageCanonId && doc.pageCanonId !== doc.documentId.slice(0, -5))
        throw new Error('Exported document ID differs from payload canonical ID');
    if (!Array.isArray(doc.blocks) || doc.blocks.length > 5000 || doc.text.length > 2000000 || typeof doc.title !== 'string' || doc.title.length > 500)
        throw new Error('Invalid document structure');
    // Additive metadata inside storage format v2. Old snapshots remain readable
    // without invented visibility defaults; only explicit refresh upgrades them.
    z.literal(3).optional().parse(doc.normalizationVersion);
    z.boolean().optional().parse(doc.isDescriptionVisible);
    const sections = boundedArray(sectionProvenanceSchema, 100);
    const exclusions = boundedArray(exclusionSchema, 200101);
    (doc.normalizationVersion === 3 ? sections : sections.optional()).parse(doc.sections);
    (doc.normalizationVersion === 3 ? exclusions : exclusions.optional()).parse(doc.exclusions);
    if (doc.sections?.some(s => s.isVisible === false) || (doc.isDescriptionVisible === false && doc.header.description))
        throw new Error('Hidden content in normalized document');
    for (const block of doc.blocks) {
        blockProvenanceSchema.optional().parse(block.provenance);
        if (block.provenance?.isHidden === true || block.provenance?.isVisible === false)
            throw new Error('Hidden block in normalized document');
        if (doc.normalizationVersion === 3 && !block.provenance && !(block.id === 'description' && block.section === '' && block.text === doc.header.description))
            throw new Error('Missing block provenance');
    }
    for (const block of doc.blocks)
        if (typeof block.text !== 'string' || block.text.length > 2000000 || !Array.isArray(block.chunks) || block.chunks.length > 200 || !Array.isArray(block.media))
            throw new Error('Invalid semantic block');
    if (doc.blocks.map(b => b.text).filter(Boolean).join('\n\n') !== doc.text)
        throw new Error('Document text differs from semantic blocks');
}
export async function readCorpusDocument(corpus: Corpus, path: string): Promise<CorpusDocument> {
    pathSchema.parse(path);
    const entry = corpus.index.documents.find(d => d.path === path);
    if (!entry)
        throw new Error('Document path is not in the current manifest; use material_search_docs');
    const text = await boundedLocalRead(corpus.dir, `snapshots/${corpus.snapshot}/${entry.file}`, 8000000);
    if (sha256(text) !== entry.fileSha256)
        throw new Error('Document digest mismatch; refresh cache');
    const doc = JSON.parse(text) as CorpusDocument;
    validateDocument(doc, corpus.index.provenance.carbonVersion);
    if (doc.path !== entry.path || doc.sha256 !== entry.sha256 || doc.documentId !== entry.documentId || doc.section !== entry.section || doc.sourceSha256 !== entry.sourceSha256)
        throw new Error('Document/index mismatch');
    return doc;
}
/** Explicit-import write API. Not reachable from MCP tool input. Immutable files
 * are prepared first, then one atomic manifest rename publishes the snapshot. */
export async function publishCorpus(dir: string, documents: CorpusDocument[], info: PublicationInfo): Promise<Corpus> {
    const { mappings, routeInventory = [], ...provenance } = info;
    preflightIndex({ documents, mappings, routeInventory });
    provenanceSchema.parse(provenance);
    const entries: IndexEntry[] = [], files: {
        file: string;
        text: string;
    }[] = [];
    let bytes = 0;
    for (const doc of documents) {
        validateDocument(doc, info.carbonVersion);
        const text = JSON.stringify(doc);
        bytes += Buffer.byteLength(text);
        if (Buffer.byteLength(text) > 8000000 || bytes > 256000000)
            throw new Error('Snapshot size limit');
        const file = sha256(doc.path) + '.json';
        files.push({ file, text });
        entries.push(indexEntrySchema.parse({ path: doc.path, url: doc.url, title: doc.title, category: doc.category, section: doc.section, documentId: doc.documentId, file, fileSha256: sha256(text), sha256: doc.sha256, sourceSha256: doc.sourceSha256, fetchedAt: doc.fetchedAt, headings: doc.headings, terms: searchTerms(doc.text), blockCount: doc.blocks.length, resourceNames: doc.resourceNames, unknownKinds: doc.unknownKinds, unknownModules: doc.unknownModules }));
    }
    const index = parseIndex({ version: 2, provenance, documents: entries.sort((a, b) => a.path.localeCompare(b.path)), mappings, routeInventory });
    validateIndex(index);
    const indexText = JSON.stringify(index);
    if (Buffer.byteLength(indexText) > 16000000)
        throw new Error('Index size limit');
    const snapshot = sha256(indexText);
    dir = await cacheRoot(dir, true);
    await ensureCacheDirectory(dir, 'snapshots');
    await checkCacheTarget(dir, `snapshots/${snapshot}`, 'directory');
    await checkCacheTarget(dir, 'manifest.json', 'file');
    const staging = join(dir, 'snapshots', `.staging-${randomUUID()}`), manifestTemp = join(dir, `.manifest-${randomUUID()}.tmp`);
    await mkdir(staging);
    try {
        for (const file of files)
            await writeFile(join(staging, file.file), file.text, { flag: 'wx', mode: 0o600 });
        await writeFile(join(staging, 'index.json'), indexText, { flag: 'wx', mode: 0o600 });
        try {
            await rename(staging, join(dir, 'snapshots', snapshot));
        }
        catch (e) {
            if (!['EEXIST', 'ENOTEMPTY'].includes((e as NodeJS.ErrnoException).code ?? ''))
                throw e;
            const existing = await boundedLocalRead(dir, `snapshots/${snapshot}/index.json`, 16000000);
            if (existing !== indexText)
                throw new Error('Existing snapshot mismatch');
            for (const file of files)
                if (sha256(await boundedLocalRead(dir, `snapshots/${snapshot}/${file.file}`, 8000000)) !== sha256(file.text))
                    throw new Error('Existing snapshot document corrupted');
        }
        await confinedPath(dir, `snapshots/${snapshot}`);
        await checkCacheTarget(dir, 'manifest.json', 'file');
        const manifest = manifestSchema.parse({ version: 2, snapshot, indexSha256: snapshot, carbonVersion: info.carbonVersion, createdAt: new Date().toISOString() });
        await writeFile(manifestTemp, JSON.stringify(manifest) + '\n', { flag: 'wx', mode: 0o600 });
        await rename(manifestTemp, join(dir, 'manifest.json'));
    }
    finally {
        await rm(staging, { recursive: true, force: true });
        await rm(manifestTemp, { force: true });
    }
    return openCorpus(dir);
}
export function corpusCitation(doc: CorpusDocument, snapshot: string) { return { path: doc.path, url: doc.url, title: doc.title, sourceKind: doc.sourceKind, sourceUrl: doc.sourceUrl, documentId: doc.documentId, pageId: doc.pageId, pageCanonId: doc.pageCanonId, section: doc.section, sectionIds: doc.sectionIds, normalizationVersion: doc.normalizationVersion, visibilityMetadata: doc.normalizationVersion === 3 ? 'recorded' : 'not-recorded; refresh to populate', isDescriptionVisible: doc.isDescriptionVisible, sections: doc.sections, hiddenSections: doc.hiddenSections, hiddenBlocks: doc.hiddenBlocks, carbonVersion: doc.carbonVersion, sourceSha256: doc.sourceSha256, sha256: doc.sha256, fetchedAt: doc.fetchedAt, updatedTimestamp: doc.updatedTimestamp, extractionMethod: doc.extractionMethod, snapshot, attribution: 'Google Material Design documentation', license: 'Consult https://policies.google.com/terms before redistribution', cachePolicy: 'Locally cached source excerpts, excluded from version control. Resource tables and visual semantics may be unresolved.' }; }
export function computeCoverage(corpus: Corpus) {
    const { documents, mappings, provenance } = corpus.index;
    const core = mappings.filter(m => ['components', 'styles', 'foundations'].includes(m.category));
    const families = [...new Set(core.filter(m => m.category === 'components' && m.section).map(m => m.path.split('/')[1]))].sort();
    const count = (list: RouteMapping[]) => ({ total: list.length, indexed: list.filter(m => m.status === 'mapped').length, excluded: list.filter(m => m.status === 'excluded').length, unresolved: list.filter(m => m.status === 'unresolved').length });
    const resourceNames = [...new Set(documents.flatMap(d => d.resourceNames))].sort(), unknownKinds = [...new Set(documents.flatMap(d => d.unknownKinds))].sort(), unknownModules = [...new Set(documents.flatMap(d => d.unknownModules))].sort();
    return { snapshot: corpus.snapshot, carbonVersion: provenance.carbonVersion, discoveredAt: provenance.discoveredAt, snapshotAgeSeconds: Math.floor((Date.now() - Date.parse(provenance.discoveredAt)) / 1000), sourceFetchedAtRange: { oldest: documents.map(d => d.fetchedAt).sort()[0], newest: documents.map(d => d.fetchedAt).sort().at(-1) }, knowledge: { sitemap: count(mappings), core: count(core), byCategory: Object.fromEntries([...new Set(mappings.map(m => m.category))].sort().map(c => [c, count(mappings.filter(m => m.category === c))])), componentFamilies: families, componentFamilyCount: families.length, uniqueSourceDocuments: new Set(documents.map(d => d.documentId)).size, coreSourceDocuments: new Set(documents.filter(d => ['components', 'styles', 'foundations'].includes(d.category)).map(d => d.documentId)).size, indexedSections: documents.length, coreCanonicalUrlsComplete: core.every(m => m.status === 'mapped'), complete: false, completenessNote: 'Canonical text/metadata coverage is distinct from full specification knowledge. Resources, unknown modules and visual/media interpretation require separate verification.' }, implementation: { status: 'not-measured-by-corpus-import', availableAuthoredRecipeCount: recipeSchema.shape.component.options.length, availableAuthoredRecipes: recipeSchema.shape.component.options, note: 'Recipe schema availability is not verified implementation coverage of official component families. Documentation ingestion does not execute or certify recipes.' }, eval: { status: 'not-measured-by-corpus-import', note: 'Import and retrieval tests do not establish browser, accessibility, visual or human-usability coverage.' }, gaps: { unresolvedRoutesOutsideSitemap: corpus.index.routeInventory.filter(r => !r.documentId && !mappings.some(m => m.path === r.path)).map(r => ({ ...r, reason: 'Discovered application route outside sitemap has no exported Carbon document; not indexed.' })), unresolvedPaths: mappings.filter(m => m.status === 'unresolved'), excludedPaths: mappings.filter(m => m.status === 'excluded'), unresolvedResourceCount: resourceNames.length, unresolvedResources: resourceNames, unknownKinds, unknownModules, media: 'Metadata and captions retained; image/video binaries are not downloaded or visually interpreted.' }, provenance };
}
