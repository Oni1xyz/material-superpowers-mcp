import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCarbonDocument } from '../src/material/carbon.js';
import { openCorpus, publishCorpus, readCorpusDocument, type CorpusDocument } from '../src/material/corpus.js';
import { sha256 } from '../src/material/cache.js';
import { makeDocsTools } from '../src/tools/docs.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const version = '2026-09-23_06-10-05', documentId = 'e31df68a-59d4-41dc-8743-8c48b476d4f8.json';
const source = () => ({
    title: 'Visible document', isDescriptionVisible: false, description: '<p>SECRET_DESCRIPTION</p>',
    sections: [
        { name: 'SECRET_SECTION_NAME', pageSectionId: 'hs-v', pageSectionCanonId: 'hs-c', isVisible: false, contentBlocks: [
            { pageContentBlockId: 'hb-v', pageContentBlockCanonId: 'hb-c', isHidden: false, title: 'SECRET_PARENT_TITLE', contentChunks: [{ htmlValue: 'SECRET_PARENT_TEXT', imageUrl: 'https://example.com/SECRET_PARENT_MEDIA' }] },
        ] },
        { name: 'Other', isVisible: true, contentBlocks: [{ contentChunks: [{ htmlValue: 'OTHER_TAB' }] }] },
        { name: 'Specs', pageSectionId: 's-v', pageSectionCanonId: 's-c', isVisible: true, contentBlocks: [
            { pageContentBlockId: 'h-v', pageContentBlockCanonId: 'h-c', isHidden: true, title: 'SECRET_BLOCK_TITLE', arbitrary: 'SECRET_METADATA', contentChunks: [{ htmlValue: 'SECRET_BLOCK_TEXT', footer: 'SECRET_CAPTION', snippetCode: 'SECRET_CODE', resourceName: 'SECRET_RESOURCE', imageUrl: 'https://example.com/SECRET_MEDIA', altText: 'SECRET_ALT' }] },
            { pageContentBlockId: 'b-v', pageContentBlockCanonId: 'b-c', isHidden: false, contentChunks: [{ htmlValue: '<h2>Visible heading</h2><p>' + 'Visible guidance. '.repeat(30) + '</p>' }] },
            { pageContentBlockCanonId: 'only-canonical', contentChunks: [{ htmlValue: '<h2>Second heading</h2><p>Visible ending.</p>' }] },
        ] },
    ],
});
const parsed = () => parseCarbonDocument(source(), 'Specs');
const doc = (): CorpusDocument => ({ ...parsed(), path: 'components/buttons/specs', url: 'https://m3.material.io/components/buttons/specs', category: 'components', sourceKind: 'material-3', documentId, carbonVersion: version, sourceUrl: `https://m3.material.io/_dsm/content/m3/${version}/${documentId}`, section: 'Specs', sourceSha256: 'a'.repeat(64), sha256: sha256(parsed().text), fetchedAt: '2026-10-10T00:00:00.000Z', extractionMethod: 'fixture' });
async function publish(document = doc()) {
    const dir = await mkdtemp(join(tmpdir(), 'm3-visibility-')); dirs.push(dir);
    const info = { carbonVersion: version, bundleUrl: 'https://m3.material.io/static/angular/main.7906d9e8e8cae962.js', bundleSha256: 'b'.repeat(64), sitemapSha256: 'c'.repeat(64), discoveredAt: '2026-10-10T00:00:00.000Z', mappings: [{ path: document.path, url: document.url, category: document.category, status: 'mapped' as const, documentId, section: 'Specs' }] };
    const corpus = await publishCorpus(dir, [document], info);
    return { dir, corpus, info, tools: makeDocsTools(dir) };
}
it('retains both source ID forms and explicit visibility with original source indices', () => {
    const result = parsed();
    expect(result.normalizationVersion).toBe(3);
    expect(result.isDescriptionVisible).toBe(false);
    expect(result.sectionIds).toEqual(['s-c', 's-v']);
    expect(result.sections).toEqual([{ sectionIndex: 2, pageSectionId: 's-v', pageSectionCanonId: 's-c', isVisible: true }]);
    expect(result.blocks[0].provenance).toEqual({ ...result.sections![0], blockIndex: 1, pageContentBlockId: 'b-v', pageContentBlockCanonId: 'b-c', isHidden: false });
    expect(result.blocks[1].id).toBe('0-2'); // Existing fallback IDs stay stable.
    expect(result.blocks[1].provenance).toEqual({ ...result.sections![0], blockIndex: 2, pageContentBlockCanonId: 'only-canonical' });
    expect(result.hiddenSections).toBe(1);
    expect(result.hiddenBlocks).toBe(1); // Existing count remains selected-section only.
});
it('records metadata-only exclusions without any hidden content or sibling tab text', () => {
    const result = parsed();
    expect(result.exclusions).toEqual([
        { kind: 'description', reason: 'description-hidden', isDescriptionVisible: false },
        { kind: 'section', reason: 'section-hidden', sectionIndex: 0, pageSectionId: 'hs-v', pageSectionCanonId: 'hs-c', isVisible: false },
        { kind: 'block', reason: 'section-hidden', sectionIndex: 0, pageSectionId: 'hs-v', pageSectionCanonId: 'hs-c', isVisible: false, blockIndex: 0, pageContentBlockId: 'hb-v', pageContentBlockCanonId: 'hb-c', isHidden: false },
        { kind: 'block', reason: 'block-hidden', sectionIndex: 2, pageSectionId: 's-v', pageSectionCanonId: 's-c', isVisible: true, blockIndex: 0, pageContentBlockId: 'h-v', pageContentBlockCanonId: 'h-c', isHidden: true },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/SECRET_|OTHER_TAB/);
    expect(result.resourceNames).toEqual([]);
});
it.each([true, false, undefined])('preserves description source visibility %s without inferred defaults', flag => {
    const result = parseCarbonDocument({ title: 'T', description: '<p>Description</p>', ...(flag === undefined ? {} : { isDescriptionVisible: flag }), sections: [{ name: 'Only', contentBlocks: [{ contentChunks: [{ htmlValue: 'Body' }] }] }] });
    expect(Object.hasOwn(result, 'isDescriptionVisible')).toBe(flag !== undefined);
    expect(result.isDescriptionVisible).toBe(flag);
    expect(result.header.description).toBe(flag === false ? '' : 'Description');
    expect(result.sections).toEqual([{ sectionIndex: 0 }]);
    expect(result.blocks.at(-1)!.provenance).toEqual({ sectionIndex: 0, blockIndex: 0 });
    expect(result.exclusions).toHaveLength(flag === false ? 1 : 0);
});
it('round trips snapshots and paginated/heading/structured reads without provenance loss or leaks', async () => {
    const document = doc(), { corpus, tools } = await publish(document);
    expect(await readCorpusDocument(corpus, document.path)).toEqual(document);
    expect(await readFile(join(corpus.dir, 'snapshots', corpus.snapshot, corpus.index.documents[0].file), 'utf8')).not.toContain('SECRET_');
    expect(JSON.stringify(corpus.index)).not.toContain('secret_');
    for (const includeStructure of [false, true]) {
        const fragments = new Map<string, string>(); let cursor: string | undefined, pages = 0;
        do {
            const page: any = await tools[1].run({ path: document.path, maxCharacters: 100, includeStructure, ...(cursor ? { cursor } : {}) });
            expect(page.citation.sections).toEqual(document.sections);
            expect(page.citation.sectionIds).toEqual(['s-c', 's-v']);
            expect(page.citation.isDescriptionVisible).toBe(false);
            expect(page.citation.visibilityMetadata).toBe('recorded');
            expect(page.exclusions).toEqual(document.exclusions);
            for (const b of page.blocks) {
                expect(b.provenance).toEqual(document.blocks.find(original => original.id === b.blockId)!.provenance);
                expect(b.offset).toBe((fragments.get(b.blockId) ?? '').length);
                fragments.set(b.blockId, (fragments.get(b.blockId) ?? '') + b.text);
            }
            for (const metadata of page.metadata) expect(metadata.provenance).toEqual(document.blocks.find(b => b.id === metadata.blockId)!.provenance);
            expect(JSON.stringify(page)).not.toMatch(/SECRET_|OTHER_TAB/);
            cursor = page.nextCursor; expect(++pages).toBeLessThan(20);
        } while (cursor);
        expect(document.blocks.map(b => fragments.get(b.id)).join('\n\n')).toBe(document.text);
    }
    const heading: any = await tools[1].run({ path: document.path, heading: 'Second heading', maxCharacters: 100 });
    expect(heading.blocks[0].blockIndex).toBe(0);
    expect(heading.blocks[0].provenance.blockIndex).toBe(2);
    expect(heading.blocks[0].provenance.pageContentBlockCanonId).toBe('only-canonical');
    const search: any = await tools[0].run({ query: 'SECRET_BLOCK_TEXT' }); expect(search.results).toEqual([]);
    const context: any = await tools[2].run({ task: 'Visible', mode: 'review', maxCharacters: 100 });
    expect(context.sources[0].blocks[0].provenance).toEqual(document.blocks[0].provenance);
    expect(JSON.stringify(context)).not.toContain('SECRET_');
});
it('reads older v2 snapshots without fabricating missing metadata', async () => {
    const old = doc(); delete old.normalizationVersion; delete old.sections; delete old.exclusions; delete old.isDescriptionVisible;
    old.sectionIds = ['s-c']; old.blocks.forEach(b => { delete b.provenance; });
    const { tools, dir } = await publish(old);
    expect((await openCorpus(dir)).index.version).toBe(2);
    const read: any = await tools[1].run({ path: old.path, maxCharacters: 100 });
    expect(read.citation.visibilityMetadata).toContain('not-recorded');
    expect(read.citation.sections).toBeUndefined(); expect(read.citation.isDescriptionVisible).toBeUndefined();
    expect(read.exclusions).toBeUndefined(); expect(read.blocks[0].provenance).toBeUndefined();
    expect(read.citation.sectionIds).toEqual(['s-c']);
});
it('rejects content-bearing exclusion metadata and malformed or missing new provenance before publication', async () => {
    const { dir, info } = await publish();
    const before = await readFile(join(dir, 'manifest.json'), 'utf8');
    const badLedger = doc(); (badLedger.exclusions![0] as any).text = 'SECRET_LEAK';
    await expect(publishCorpus(dir, [badLedger], info)).rejects.toThrow();
    const hidden = doc(); hidden.blocks[0].provenance!.isHidden = true;
    await expect(publishCorpus(dir, [hidden], info)).rejects.toThrow('Hidden block');
    const missing = doc(); delete missing.blocks[0].provenance;
    await expect(publishCorpus(dir, [missing], info)).rejects.toThrow('Missing block provenance');
    const invalid = doc(); (invalid.sections![0] as any).isVisible = 'true';
    await expect(publishCorpus(dir, [invalid], info)).rejects.toThrow();
    expect(await readFile(join(dir, 'manifest.json'), 'utf8')).toBe(before);
});
