import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { parseCarbonDocument } from '../src/material/carbon.js';
import { boundedLocalRead, indexEntrySchema, openCorpus, readCorpusDocument } from '../src/material/corpus.js';
import { discoverBundle } from '../src/material/discovery.js';
import { semanticPage, type ReadableDocument } from '../src/material/retrieval.js';
import { sha256 } from '../src/material/cache.js';
import { boundedArray } from '../src/material/validation.js';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

it.runIf(process.env.MATERIAL_REAL_CACHE_TEST === '1')('real source normalization is unchanged and SDK rejects the end-offset cursor', async () => {
    const corpus = await openCorpus();
    for (const entry of corpus.index.documents) {
        const cached = await readCorpusDocument(corpus, entry.path);
        const envelope = JSON.parse(await boundedLocalRead(corpus.dir, `imports/${cached.carbonVersion}/${corpus.index.provenance.bundleSha256}/${cached.documentId}`, 12000000));
        const parsed = parseCarbonDocument(JSON.parse(envelope.text), cached.section);
        // Covers all semantic content and visibility fields, not only text digests.
        expect(cached).toMatchObject(JSON.parse(JSON.stringify(parsed)));
    }
    const expected = await readCorpusDocument(corpus, 'components/buttons/specs');
    expect(expected.blocks[1].text.length).toBeGreaterThan(0);
    const forged = Buffer.from(JSON.stringify({ v: 1, s: corpus.snapshot, d: expected.sha256, p: expected.path, h: '', b: 1, o: expected.blocks[1].text.length })).toString('base64url');
    const client = new Client({ name: 'm3-cursor-regression', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], cwd: process.cwd(), env: { ...process.env, MATERIAL_CACHE_DIR: corpus.dir }, stderr: 'pipe' });
    let stderr = '';
    transport.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    try {
        await client.connect(transport);
        const result = await client.callTool({ name: 'material_read_doc', arguments: { path: expected.path, cursor: forged, maxCharacters: 1000 } });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain('Cursor');
        expect(JSON.stringify(result).length).toBeLessThan(2000);
        const valid = await client.callTool({ name: 'material_read_doc', arguments: { path: expected.path, maxCharacters: 1000 } });
        expect(valid.isError).not.toBe(true);
        expect((valid.structuredContent as { text: string }).text.length).toBeGreaterThan(0);
        expect(stderr).toBe('');
    } finally { await client.close(); }
}, 120000);

const snapshot = 'a'.repeat(64);
const doc: ReadableDocument = { path: 'components/buttons/specs', title: 'Buttons', category: 'components', text: 'First\n\nSecond', sha256: sha256('First\n\nSecond'), blocks: [{ id: 'first', text: 'First' }, { id: 'empty', text: '' }, { id: 'second', text: 'Second' }], headings: [], citation: {} };
const cursor = (b: number, o: number) => Buffer.from(JSON.stringify({ v: 1, s: snapshot, d: doc.sha256, p: doc.path, h: '', b, o })).toString('base64url');
it.each([[0, 5], [2, 6]])('rejects noncanonical end-of-block cursor b=%i o=%i', (b, o) => {
    expect(() => semanticPage(doc, snapshot, 100, { cursor: cursor(b, o) })).toThrow(/Cursor/);
});
it('empty-block and terminal cursors terminate or move forward', () => {
    const page = semanticPage(doc, snapshot, 100, { cursor: cursor(1, 0) });
    expect(page.text).toBe('Second');
    expect(page.hasMore).toBe(false);
    expect(semanticPage(doc, snapshot, 100, { cursor: cursor(3, 0) }).hasMore).toBe(false);
});

// Keep OOM repros out of the Vitest process. Disable core dumps, bound both
// output streams, and force-kill on timeout so a regressed parser is contained.
function constrained(script: string) {
    return spawnSync('/bin/sh', ['-c', 'ulimit -c 0; exec "$@"', 'bounded-node', process.execPath, '--max-old-space-size=128', '--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 65536,
    });
}
const imports = `import { parseCarbonDocument } from './src/material/carbon.ts';`;
function caught(action: () => unknown): Error {
    let error: unknown;
    try { action(); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error);
    return error as Error;
}
it.each([
    ['sections', `{title:'T',sections:Array(500000).fill(null)}`],
    ['blocks', `{title:'T',sections:[{contentBlocks:Array(500000).fill(null)}]}`],
    ['chunks', `{title:'T',sections:[{contentBlocks:[{contentChunks:Array(500000).fill(null)}]}]}`],
])('rejects huge Carbon %s arrays under a 128 MiB heap', (_name, expression) => {
    const result = constrained(`${imports}
        const raw = ${expression};
        const bytes = Buffer.byteLength(JSON.stringify(raw));
        if (bytes >= 8000000) throw new Error('fixture exceeds source budget');
        let rejected = false;
        try { parseCarbonDocument(raw); } catch (error) {
            rejected = true;
            if (error.message.length > 2000) throw new Error('unbounded validation error');
        }
        if (!rejected) throw new Error('accepted oversized array');
        console.log('bounded rejection');`);
    expect(result.error?.message).toBeUndefined();
    expect(result.signal, result.stderr.slice(-1000)).toBeNull();
    expect(result.status, result.stderr.slice(-1000)).toBe(0);
    expect(result.stdout).toBe('bounded rejection\n');
}, 20000);

it('bounds errors even when malformed Carbon arrays fit per-array limits', () => {
    const error = caught(() => parseCarbonDocument({ title: 'T', sections: [{ contentBlocks: Array(2000).fill(null) }] }));
    expect(error.message.length).toBeLessThan(2000);
    expect((error as z.ZodError).issues).toHaveLength(1);
});
it('rejects aggregate Carbon block/chunk budgets before element validation', () => {
    const block = { get title() { throw new Error('element validation ran'); } };
    expect(() => parseCarbonDocument({ title: 'T', sections: Array.from({ length: 3 }, () => ({ contentBlocks: Array(2000).fill(block) })) })).toThrow(/aggregate/i);
    const chunk = { get htmlValue() { throw new Error('element validation ran'); } };
    expect(() => parseCarbonDocument({ title: 'T', sections: [{ contentBlocks: Array.from({ length: 101 }, () => ({ contentChunks: Array(200).fill(chunk) })) }] })).toThrow(/aggregate/i);
});
it.each(['headings', 'terms', 'resourceNames', 'unknownKinds', 'unknownModules'])('bounds index entry %s validation errors', field => {
    const result = indexEntrySchema.safeParse({ [field]: Array(5000).fill(null) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message.length).toBeLessThan(6000);
});
it.each(['tabs', 'alternateSlugs', 'tab alternateSlugs'])('bounds discovery %s validation errors', field => {
    const route = { slug: 'components/buttons', exportedCarbonFileId: null, ...(field === 'tab alternateSlugs' ? { tabs: [{ label: 'Overview', alternateSlugs: Array(10000).fill(null) }] } : { [field]: Array(10000).fill(null) }) };
    const error = caught(() => discoverBundle('carbonVersion:"2026-09-23_06-10-05";' + JSON.stringify(route)));
    expect(error.message.length).toBeLessThan(2000);
});

it('checks length before element parsing and stops after the first bad element', () => {
    let visits = 0;
    const schema = boundedArray(z.preprocess(value => { visits++; return value; }, z.string()), 10, 1);
    expect(schema.safeParse(Array(11).fill(null)).success).toBe(false);
    expect(visits).toBe(0);
    expect(schema.safeParse([]).success).toBe(false);
    expect(visits).toBe(0);
    const result = schema.safeParse(Array(10).fill(null));
    expect(result.success).toBe(false);
    expect(visits).toBe(1);
    if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0].path).toEqual([0]);
    }
    expect(schema.parse(Array(10).fill('valid'))).toEqual(Array(10).fill('valid'));
    expect(schema.optional().parse(undefined)).toBeUndefined();
    expect(boundedArray(z.string(), 10).default([]).parse(undefined)).toEqual([]);
});

it.each(['documents', 'mappings', 'routeInventory', 'canonicalPaths', 'aggregate terms'])('bounds untrusted on-disk index %s before Zod allocation', field => {
    const result = constrained(`
        import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
        import { tmpdir } from 'node:os';
        import { join } from 'node:path';
        import { openCorpus } from './src/material/corpus.ts';
        import { sha256 } from './src/material/cache.ts';
        const field = ${JSON.stringify(field)}, version = '2026-09-23_06-10-05';
        const index = {version:2, documents:[], mappings:[], routeInventory:[]};
        if (field === 'canonicalPaths') index.routeInventory = [{canonicalPaths:Array(500000).fill(null)}];
        else if (field === 'aggregate terms') index.documents = Array.from({length:9}, () => ({terms:Array(30000).fill('term')}));
        else index[field] = Array(500000).fill(null);
        const text = JSON.stringify(index), snapshot = sha256(text);
        if (Buffer.byteLength(text) >= 16000000) throw new Error('fixture exceeds index budget');
        const dir = await mkdtemp(join(tmpdir(), 'm3-index-allocation-'));
        try {
            await mkdir(join(dir, 'snapshots', snapshot), {recursive:true});
            await writeFile(join(dir, 'snapshots', snapshot, 'index.json'), text);
            await writeFile(join(dir, 'manifest.json'), JSON.stringify({version:2,snapshot,indexSha256:snapshot,carbonVersion:version,createdAt:'2026-10-10T00:00:00.000Z'}));
            let error;
            try { await openCorpus(dir); } catch (e) { error = e; }
            if (!error || !/array.*limit/i.test(error.message) || error.message.length > 2000) throw new Error('expected bounded array rejection');
            console.log('bounded rejection');
        } finally { await rm(dir, {recursive:true,force:true}); }
    `);
    expect(result.error?.message).toBeUndefined();
    expect(result.signal, result.stderr.slice(-1000)).toBeNull();
    expect(result.status, result.stderr.slice(-1000)).toBe(0);
    expect(result.stdout).toBe('bounded rejection\n');
}, 20000);

it.each(['sections', 'exclusions'])('bounds normalized document %s arrays under a 128 MiB heap', field => {
    const result = constrained(`
        import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
        import { tmpdir } from 'node:os';
        import { join } from 'node:path';
        import { readCorpusDocument } from './src/material/corpus.ts';
        import { sha256 } from './src/material/cache.ts';
        import { parseCarbonDocument } from './src/material/carbon.ts';
        const version = '2026-09-23_06-10-05', id = 'e31df68a-59d4-41dc-8743-8c48b476d4f8.json';
        const parsed = parseCarbonDocument({title:'T',sections:[{name:'Overview',contentBlocks:[]}]});
        const text = JSON.stringify({...parsed,path:'test',url:'https://m3.material.io/test',category:'other',sourceKind:'material-3',documentId:id,carbonVersion:version,sourceUrl:'https://m3.material.io/_dsm/content/m3/'+version+'/'+id,sourceSha256:'c'.repeat(64),sha256:sha256(parsed.text),fetchedAt:'2026-10-10T00:00:00.000Z',extractionMethod:'test-fixture',${field}:Array(500000).fill(null)});
        if (Buffer.byteLength(text) >= 8000000) throw new Error('fixture exceeds document budget');
        const dir = await mkdtemp(join(tmpdir(), 'm3-document-allocation-')), snapshot = 'a'.repeat(64), file = 'b'.repeat(64)+'.json';
        try {
            await mkdir(join(dir, 'snapshots', snapshot), {recursive:true});
            await writeFile(join(dir, 'snapshots', snapshot, file), text);
            const corpus = {dir,snapshot,index:{provenance:{carbonVersion:'2026-09-23_06-10-05'},documents:[{path:'test',file,fileSha256:sha256(text)}]}};
            let error;
            try { await readCorpusDocument(corpus, 'test'); } catch (e) { error = e; }
            if (!error || !/array.*limit/i.test(error.message) || error.message.length > 2000) throw new Error('expected bounded array rejection');
            console.log('bounded rejection');
        } finally { await rm(dir, {recursive:true,force:true}); }
    `);
    expect(result.error?.message).toBeUndefined();
    expect(result.signal, result.stderr.slice(-1000)).toBeNull();
    expect(result.status, result.stderr.slice(-1000)).toBe(0);
    expect(result.stdout).toBe('bounded rejection\n');
}, 20000);
