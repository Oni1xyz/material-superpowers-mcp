import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { citation, readCache, sha256, type CachedDocument } from './cache.js';
import { openCorpus, readCorpusDocument, corpusCitation, searchTerms, type Corpus, type CorpusDocument } from './corpus.js';
import type { BlockProvenance } from './carbon.js';
export interface ReadableDocument {
    path: string;
    title: string;
    category: string;
    text: string;
    sha256: string;
    blocks: {
        id: string;
        text: string;
        provenance?: BlockProvenance;
    }[];
    headings: {
        title: string;
        level: number;
        block: number;
    }[];
    citation: Record<string, unknown>;
    source?: CorpusDocument;
}
export interface SearchEntry {
    path: string;
    title: string;
    category: string;
    section?: string;
    terms: string[];
    headings: {
        title: string;
        level: number;
        block: number;
    }[];
}
export interface Catalog {
    snapshot: string;
    entries: SearchEntry[];
    read: (path: string) => Promise<ReadableDocument>;
    corpus?: Corpus;
}
/** Preserve legacy official Material Web caches as clearly labeled read-only
 * sources. A present but corrupt v2 manifest must never silently fall back. */
export async function loadCatalog(dir: string): Promise<Catalog> {
    let exists = true;
    try {
        await stat(join(dir, 'manifest.json'));
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            exists = false;
        else
            throw e;
    }
    if (exists) {
        const corpus = await openCorpus(dir);
        return { snapshot: corpus.snapshot, entries: corpus.index.documents, corpus, read: async (path) => { const doc = await readCorpusDocument(corpus, path); return { ...doc, citation: corpusCitation(doc, corpus.snapshot), source: doc }; } };
    }
    const legacy = await readCache(dir);
    const snapshot = sha256(JSON.stringify(legacy));
    const docs = legacy.documents.map(doc => legacyReadable(doc, snapshot));
    return { snapshot, entries: docs.map(d => ({ path: d.path, title: d.title, category: d.category, terms: searchTerms(d.text), headings: d.headings })), read: async (path) => { const doc = docs.find(d => d.path === path); if (!doc)
            throw new Error('Document is not cached; run npm run refresh-cache'); return doc; } };
}
function legacyReadable(doc: CachedDocument, snapshot: string): ReadableDocument {
    const blocks = markdownBlocks(doc.text);
    const headings = blocks.flatMap((b, block) => { const m = /^(#{1,6})\s+(.+)/.exec(b.text); return m ? [{ title: m[2], level: m[1].length, block }] : []; });
    return { ...doc, blocks, headings, citation: { ...citation(doc), snapshot, legacyCache: true } };
}
/** Paragraph/list/table/fenced-code boundaries; fences are indivisible even when
 * they contain blank lines or apparent Markdown headings. */
export function markdownBlocks(text: string): {
    id: string;
    text: string;
}[] {
    const result: {
        id: string;
        text: string;
    }[] = [];
    let lines: string[] = [], fence = '';
    const flush = () => { if (lines.length) {
        result.push({ id: String(result.length), text: lines.join('\n') });
        lines = [];
    } };
    for (const line of text.split('\n')) {
        const m = /^\s*(`{3,}|~{3,})/.exec(line);
        if (m) {
            if (!fence)
                fence = m[1];
            else if (m[1][0] === fence[0] && m[1].length >= fence.length)
                fence = '';
            lines.push(line);
            continue;
        }
        if (!fence && !line.trim()) {
            flush();
            continue;
        }
        if (!fence && /^#{1,6}\s/.test(line))
            flush();
        lines.push(line);
    }
    flush();
    return result;
}
export function rankEntry(entry: SearchEntry, query: string, mode?: 'design' | 'implementation' | 'review') {
    const title = entry.title.toLowerCase(), path = entry.path.toLowerCase(), headings = entry.headings.map(h => h.title.toLowerCase()), body = new Set(entry.terms);
    const terms = searchTerms(query);
    let score = terms.reduce((n, t) => n + (title.includes(t) ? 12 : 0) + (path.includes(t) ? 8 : 0) + (headings.some(h => h.includes(t)) ? 6 : 0) + (body.has(t) ? 1 : 0), 0);
    if (!score)
        return 0;
    if (title.includes(query.toLowerCase()) || path.includes(query.toLowerCase().replace(/\s+/g, '-')))
        score += 15;
    const singular = (value: string) => value.endsWith('s') && !value.endsWith('ss') ? value.slice(0, -1) : value;
    const queryWords = new Set(terms.map(singular)), titleWords = searchTerms(title).map(singular);
    if (titleWords.length && titleWords.every(t => queryWords.has(t)))
        score += 15;
    // A topic-only query normally seeks its overview, not a sibling whose long
    // token table happens to repeat the topic in more headings.
    if (!mode && entry.section === 'Overview' && titleWords.length && titleWords.every(t => queryWords.has(t)) && !/\b(specs|tokens|guidelines|accessibility)\b/i.test(query))
        score += 16;
    const sectionWords = searchTerms(entry.section ?? '').map(singular);
    if (sectionWords.length && sectionWords.every(t => queryWords.has(t)))
        score += 16;
    if (mode) {
        const preferred = mode === 'design' ? /guidelines|overview|anatomy|principles/ : mode === 'implementation' ? /specs|tokens|develop|code/ : /accessibility|contrast|states|usability/;
        if (preferred.test(path + ' ' + (entry.section ?? '').toLowerCase()))
            score += 12;
    }
    return score;
}
export function bestBlock(doc: ReadableDocument, query: string): number {
    const terms = searchTerms(query);
    let best = 0, max = -1;
    doc.blocks.forEach((b, i) => { const value = b.text.toLowerCase(); const score = terms.reduce((s, t) => s + (value.includes(t) ? 1 : 0), 0); if (score > max) {
        max = score;
        best = i;
    } });
    return best;
}
export function sectionRange(text: string, heading: string): {
    start: number;
    end: number;
} {
    let start = -1, level = 0, position = 0, fence = '';
    for (const line of text.split('\n')) {
        const f = /^\s*(`{3,}|~{3,})/.exec(line);
        if (f) {
            if (!fence)
                fence = f[1];
            else if (f[1][0] === fence[0] && f[1].length >= fence.length)
                fence = '';
        }
        else if (!fence) {
            const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
            if (m) {
                if (start >= 0 && m[1].length <= level)
                    return { start, end: position };
                if (start < 0 && m[2].toLowerCase() === heading.toLowerCase()) {
                    start = position;
                    level = m[1].length;
                }
            }
        }
        position += line.length + 1;
    }
    if (start < 0)
        throw new Error('Heading not found; read without heading to inspect available sections');
    return { start, end: text.length };
}
function selectBlocks(doc: ReadableDocument, heading?: string) {
    if (!heading)
        return doc.blocks;
    // The source text is the exact double-newline join of visible nonempty blocks.
    const range = sectionRange(doc.text, heading);
    let pos = 0;
    const selected: ReadableDocument['blocks'] = [];
    for (const block of doc.blocks) {
        if (!block.text)
            continue;
        const end = pos + block.text.length;
        if (pos < range.end && end > range.start)
            selected.push({ ...block, text: block.text.slice(Math.max(0, range.start - pos), Math.min(block.text.length, range.end - pos)).trimEnd() });
        pos = end + 2;
    }
    return selected;
}
const cursorSchema = z.object({ v: z.literal(1), s: z.string().regex(/^[a-f0-9]{64}$/), d: z.string().regex(/^[a-f0-9]{64}$/), p: z.string().max(250), h: z.string().max(200), b: z.number().int().min(0).max(5000), o: z.number().int().min(0).max(2000000) }).strict();
export function semanticPage(doc: ReadableDocument, snapshot: string, maxCharacters: number, options: {
    heading?: string;
    cursor?: string;
    startBlock?: number;
} = {}) {
    const blocks = selectBlocks(doc, options.heading);
    let block = options.startBlock ?? 0, offset = 0;
    if (options.cursor) {
        if (/[\s]/.test(options.cursor) || !/^[A-Za-z0-9_-]{1,1500}$/.test(options.cursor))
            throw new Error('Invalid cursor');
        let cursor;
        try {
            cursor = cursorSchema.parse(JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')));
        }
        catch {
            throw new Error('Invalid cursor');
        }
        if (cursor.s !== snapshot || cursor.d !== doc.sha256 || cursor.p !== doc.path || cursor.h !== (options.heading ?? ''))
            throw new Error('Cursor does not match this snapshot, document or heading; restart the read');
        block = cursor.b;
        offset = cursor.o;
    }
    if (block > blocks.length || offset > (blocks[block]?.text.length ?? 0) || (block === blocks.length && offset))
        throw new Error('Cursor outside semantic blocks');
    // Generated continuations always advance after consuming a block. An
    // externally supplied end offset otherwise yields an empty, identical page.
    if (offset > 0 && offset === blocks[block]?.text.length)
        throw new Error('Cursor must point inside a semantic block, not at its end');
    const fragments: {
        blockId: string;
        blockIndex: number;
        text: string;
        offset: number;
        end: number;
        totalCharacters: number;
        oversized: boolean;
        provenance?: BlockProvenance;
    }[] = [];
    let used = 0;
    while (block < blocks.length) {
        const b = blocks[block];
        if (!b.text) {
            block++;
            continue;
        }
        const separator = fragments.length ? 2 : 0, available = maxCharacters - used - separator, left = b.text.length - offset;
        if (left > available && fragments.length)
            break;
        if (available <= 0)
            break;
        let end = offset + Math.min(left, available);
        if (end < b.text.length && end > offset && /[\uD800-\uDBFF]/.test(b.text[end - 1]))
            end--;
        if (end === offset)
            break;
        const text = b.text.slice(offset, end);
        fragments.push({ blockId: b.id, blockIndex: block, text, offset, end, totalCharacters: b.text.length, oversized: offset > 0 || end < b.text.length, ...(b.provenance ? { provenance: b.provenance } : {}) });
        used += separator + text.length;
        if (end < b.text.length) {
            offset = end;
            break;
        }
        block++;
        offset = 0;
    }
    const hasMore = block < blocks.length, nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, s: snapshot, d: doc.sha256, p: doc.path, h: options.heading ?? '', b: block, o: offset })).toString('base64url') : undefined;
    return { text: fragments.map(f => f.text).join('\n\n'), blocks: fragments, hasMore, truncated: hasMore, ...(nextCursor ? { nextCursor } : {}), snapshot, pagination: 'Whole semantic blocks; oversized blocks have explicit character-offset continuations. Cursors bind snapshot, document digest, path and heading.' };
}
