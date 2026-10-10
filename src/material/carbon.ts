import { parseFragment } from 'parse5';
import { z } from 'zod';
import { arrayBudget, boundedArray, objectFields } from './validation.js';
const text = z.string().max(500000).nullish();
const chunkSchema = z.object({ htmlValue: text, footer: text, contentChunkType: z.string().max(100).nullish(), resourceName: z.string().max(1000).nullish(), libraryModuleType: z.string().max(100).nullish(), snippetCode: text, snippetLanguage: z.string().max(100).nullish() }).passthrough();
const sectionSchema = z.object({ name: z.string().max(200).nullish(), isVisible: z.boolean().optional(), pageSectionId: z.string().max(100).optional(), pageSectionCanonId: z.string().max(100).optional(), contentBlocks: boundedArray(z.object({ title: text, isHidden: z.boolean().optional(), pageContentBlockId: z.string().max(100).optional(), pageContentBlockCanonId: z.string().max(100).optional(), contentChunks: boundedArray(chunkSchema, 200).optional() }).passthrough(), 2000).optional() }).passthrough();
const carbonSchema = z.object({ title: z.string().min(1).max(500), description: text, isDescriptionVisible: z.boolean().optional(), updatedTimestamp: z.string().max(100).nullish(), pageId: z.string().max(100).optional(), pageCanonId: z.string().max(100).optional(), headerImageUrl: text, sections: boundedArray(sectionSchema, 100) }).passthrough();
export interface SemanticNode {
    tag: string;
    text?: string;
    attributes?: Record<string, string>;
    children?: SemanticNode[];
}
export interface MediaMetadata {
    kind: string;
    url: string;
    altText: string;
    width?: number;
    height?: number;
}
export interface ResourceReference {
    name: string;
    moduleType: string;
    configuration?: unknown;
    status: 'unresolved';
}
export interface SemanticChunk {
    id: string;
    kind: string;
    text: string;
    nodes: SemanticNode[];
    captionNodes: SemanticNode[];
    media: MediaMetadata[];
    links: {
        kind: string;
        url: string;
    }[];
    resource?: ResourceReference;
    metadata: Record<string, unknown>;
}
// Source booleans are optional: absence is not an explicit true/false. Indices
// refer to the original payload, never to the filtered or paginated arrays.
export const sectionProvenanceSchema = z.object({
    sectionIndex: z.number().int().min(0).max(99),
    pageSectionId: z.string().max(100).optional(),
    pageSectionCanonId: z.string().max(100).optional(),
    isVisible: z.boolean().optional(),
}).strict();
export const blockProvenanceSchema = sectionProvenanceSchema.extend({
    blockIndex: z.number().int().min(0).max(1999),
    pageContentBlockId: z.string().max(100).optional(),
    pageContentBlockCanonId: z.string().max(100).optional(),
    isHidden: z.boolean().optional(),
}).strict();
export const exclusionSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('description'), reason: z.literal('description-hidden'), isDescriptionVisible: z.literal(false) }).strict(),
    sectionProvenanceSchema.extend({ kind: z.literal('section'), reason: z.literal('section-hidden'), isVisible: z.literal(false) }).strict(),
    blockProvenanceSchema.extend({ kind: z.literal('block'), reason: z.enum(['block-hidden', 'section-hidden']) }).strict(),
]);
export type SectionProvenance = z.infer<typeof sectionProvenanceSchema>;
export type BlockProvenance = z.infer<typeof blockProvenanceSchema>;
export type VisibilityExclusion = z.infer<typeof exclusionSchema>;
export interface SemanticBlock {
    id: string;
    title?: string;
    section: string;
    text: string;
    chunks: SemanticChunk[];
    media: MediaMetadata[];
    provenance?: BlockProvenance;
}
export interface ParsedCarbon {
    // Absent in older v2 snapshots; refresh from resumable sources to populate.
    normalizationVersion?: 3;
    isDescriptionVisible?: boolean;
    sections?: SectionProvenance[];
    exclusions?: VisibilityExclusion[];
    title: string;
    header: {
        title: string;
        description: string;
        media: MediaMetadata[];
    };
    text: string;
    blocks: SemanticBlock[];
    headings: {
        title: string;
        level: number;
        block: number;
    }[];
    resourceNames: string[];
    unknownKinds: string[];
    unknownModules: string[];
    pageId?: string;
    pageCanonId?: string;
    sectionIds: string[];
    updatedTimestamp?: string;
    hiddenSections: number;
    hiddenBlocks: number;
}
function safeLink(value: string): string | undefined { try {
    const url = new URL(value, 'https://m3.material.io');
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
}
catch {
    return undefined;
} }
function htmlNodes(html: string): SemanticNode[] {
    if (html.length > 500000)
        throw new Error('HTML chunk exceeds limit');
    let count = 0;
    const visit = (node: any, depth: number): SemanticNode | undefined => {
        if (++count > 30000 || depth > 100)
            throw new Error('HTML complexity limit');
        if (['script', 'style', 'template', 'iframe', 'object'].includes(node.tagName))
            return undefined;
        if (node.nodeName === '#text')
            return { tag: '#text', text: node.value };
        if (node.nodeName === '#comment')
            return undefined;
        const attributes: Record<string, string> = {};
        for (const a of node.attrs ?? [])
            if (['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start', 'id'].includes(a.name)) {
                const value = ['href', 'src'].includes(a.name) ? safeLink(a.value) : a.value;
                if (value)
                    attributes[a.name] = value;
            }
        return { tag: node.tagName ?? 'fragment', ...(Object.keys(attributes).length ? { attributes } : {}), children: (node.childNodes ?? []).map((n: any) => visit(n, depth + 1)).filter(Boolean) };
    };
    return (parseFragment(html).childNodes.map(node => visit(node, 0)).filter(Boolean) as SemanticNode[]);
}
function nodeMarkdown(node: SemanticNode, pre = false): string {
    const tag = node.tag;
    if (tag === '#text')
        return pre ? node.text ?? '' : (node.text ?? '').replace(/[\t\r\n ]+/g, ' ');
    const children = node.children ?? [], inside = () => children.map(n => nodeMarkdown(n, pre)).join('');
    if (/^h[1-6]$/.test(tag))
        return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + inside().trim() + '\n\n';
    if (tag === 'br')
        return '\n';
    if (tag === 'hr')
        return '\n\n---\n\n';
    if (tag === 'pre') {
        const code = children.map(n => nodeMarkdown(n, true)).join('');
        const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map(m => m[0].length + 1)));
        return `\n\n${fence}\n${code}\n${fence}\n\n`;
    }
    if (tag === 'code')
        return pre ? inside() : '`' + inside() + '`';
    if (tag === 'a')
        return node.attributes?.href ? `[${inside().trim()}](${node.attributes.href})` : inside();
    if (tag === 'img')
        return `![${node.attributes?.alt ?? ''}](${node.attributes?.src ?? ''})`;
    if (tag === 'strong' || tag === 'b')
        return '**' + inside() + '**';
    if (tag === 'em' || tag === 'i')
        return '*' + inside() + '*';
    if (tag === 'ul' || tag === 'ol') {
        let index = Number(node.attributes?.start ?? 1);
        return '\n\n' + children.filter(n => n.tag === 'li').map(n => (tag === 'ol' ? `${index++}. ` : '- ') + nodeMarkdown(n, pre).trim().replace(/\n/g, '\n  ')).join('\n') + '\n\n';
    }
    if (tag === 'table') {
        const rows: SemanticNode[] = [];
        const walk = (n: SemanticNode) => { if (n.tag === 'tr')
            rows.push(n);
        else
            for (const c of n.children ?? [])
                walk(c); };
        walk(node);
        return '\n\n' + rows.map((row, i) => { const cells = (row.children ?? []).filter(n => ['th', 'td'].includes(n.tag)); const line = '| ' + cells.map(n => nodeMarkdown(n, pre).trim().replace(/\n/g, '<br>').replace(/\|/g, '\\|')).join(' | ') + ' |'; return line + (i === 0 ? '\n| ' + cells.map(() => '---').join(' | ') + ' |' : ''); }).join('\n') + '\n\n';
    }
    if (['p', 'div', 'section', 'figure', 'figcaption', 'blockquote'].includes(tag))
        return '\n\n' + inside().trim() + '\n\n';
    return inside();
}
function renderNodes(nodes: SemanticNode[]) {
    // Collapse layout whitespace only outside fenced code. Code is source data:
    // blank lines and indentation must survive extraction verbatim.
    const lines = nodes.map(n => nodeMarkdown(n)).join('').split('\n');
    let fence = '', empty = 0;
    const out: string[] = [];
    for (const line of lines) {
        const match = /^(`{3,}|~{3,})/.exec(line);
        if (match) {
            if (!fence)
                fence = match[1];
            else if (match[1][0] === fence[0] && match[1].length >= fence.length)
                fence = '';
            out.push(line);
            empty = 0;
            continue;
        }
        if (fence) {
            out.push(line);
            continue;
        }
        if (!line.trim()) {
            if (++empty <= 1)
                out.push('');
        }
        else {
            empty = 0;
            out.push(line);
        }
    }
    return out.join('\n').trim();
}
export function htmlToMarkdown(html: string): string { return renderNodes(htmlNodes(html)); }
const knownKinds = new Set(['TEXT', 'IMAGE', 'VIDEO', 'RESOURCE', 'CODE', 'SNIPPET', 'PROTOTYPE', 'LINK']);
// These modules have known reference semantics, not resolved values. Every
// resource reference remains explicitly unresolved until the separate resolver runs.
const knownModules = new Set(['STATUS_TABLE', 'TOKEN_TABLE', 'TOKEN_LIST', 'COMPONENT_TOKEN_TABLE']);
export function parseCarbonDocument(raw: unknown, requestedSection?: string): ParsedCarbon {
    // Include hidden/unselected content: it is still schema-validated. Charge
    // arrays before Zod clones any elements, not after semantic extraction.
    const sections = arrayBudget('Carbon sections', 100);
    const blocksBudget = arrayBudget('Carbon blocks', 5000);
    const chunksBudget = arrayBudget('Carbon chunks', 20000);
    for (const section of sections(objectFields(raw).sections, 100))
        for (const block of blocksBudget(objectFields(section).contentBlocks, 2000))
            chunksBudget(objectFields(block).contentChunks, 200);
    const doc = carbonSchema.parse(raw);
    const sectionProvenance = (s: z.infer<typeof sectionSchema>): SectionProvenance => ({
        sectionIndex: doc.sections.indexOf(s),
        ...(s.pageSectionId !== undefined ? { pageSectionId: s.pageSectionId } : {}),
        ...(s.pageSectionCanonId !== undefined ? { pageSectionCanonId: s.pageSectionCanonId } : {}),
        ...(s.isVisible !== undefined ? { isVisible: s.isVisible } : {}),
    });
    const blockProvenance = (s: z.infer<typeof sectionSchema>, b: NonNullable<z.infer<typeof sectionSchema>['contentBlocks']>[number], blockIndex: number): BlockProvenance => ({
        ...sectionProvenance(s), blockIndex,
        ...(b.pageContentBlockId !== undefined ? { pageContentBlockId: b.pageContentBlockId } : {}),
        ...(b.pageContentBlockCanonId !== undefined ? { pageContentBlockCanonId: b.pageContentBlockCanonId } : {}),
        ...(b.isHidden !== undefined ? { isHidden: b.isHidden } : {}),
    });
    const visible = doc.sections.filter(s => s.isVisible !== false);
    const selected = requestedSection ? visible.filter(s => s.name === requestedSection) : visible;
    if (!selected.length || (requestedSection && selected.length !== 1))
        throw new Error(`Missing or ambiguous visible section: ${requestedSection ?? '(document)'}`);
    const blocks: SemanticBlock[] = [], resourceNames = new Set<string>(), unknownKinds = new Set<string>(), unknownModules = new Set<string>();
    let hiddenBlocks = 0;
    // Allowlist metadata only. Never copy names, titles, descriptions, chunks,
    // URLs, or arbitrary passthrough fields from an excluded source object.
    const exclusions: VisibilityExclusion[] = [];
    if (doc.isDescriptionVisible === false)
        exclusions.push({ kind: 'description', reason: 'description-hidden', isDescriptionVisible: false });
    for (const s of doc.sections.filter(s => s.isVisible === false)) {
        exclusions.push({ kind: 'section', reason: 'section-hidden', ...sectionProvenance(s), isVisible: false });
        for (const [bi, b] of (s.contentBlocks ?? []).entries())
            exclusions.push({ kind: 'block', reason: 'section-hidden', ...blockProvenance(s, b, bi) });
    }
    const header = { title: typeof doc.headerTitle === 'string' ? doc.headerTitle : doc.title, description: doc.description && doc.isDescriptionVisible !== false ? htmlToMarkdown(doc.description) : '', media: [] as MediaMetadata[] };
    if (doc.headerImageUrl) {
        const url = safeLink(doc.headerImageUrl);
        if (url)
            header.media.push({ kind: 'image', url, altText: '' });
    }
    if (header.description)
        blocks.push({ id: 'description', section: '', text: header.description, chunks: [], media: [] });
    for (const [si, s] of selected.entries())
        for (const [bi, b] of (s.contentBlocks ?? []).entries()) {
            if (b.isHidden) {
                hiddenBlocks++;
                exclusions.push({ kind: 'block', reason: 'block-hidden', ...blockProvenance(s, b, bi) });
                continue;
            }
            const chunks: SemanticChunk[] = [];
            for (const [ci, c] of (b.contentChunks ?? []).entries()) {
                const kind = c.contentChunkType ?? 'UNSPECIFIED';
                if (!knownKinds.has(kind) && kind !== 'UNSPECIFIED')
                    unknownKinds.add(kind);
                const nodes = c.htmlValue ? htmlNodes(c.htmlValue) : [];
                const parts = [renderNodes(nodes)];
                const media: MediaMetadata[] = [];
                const links: {
                    kind: string;
                    url: string;
                }[] = [];
                for (const field of ['imageUrl', 'imageUrlFife', 'videoUrl'])
                    if (typeof c[field] === 'string' && c[field]) {
                        const type = field.startsWith('image') ? 'image' : 'video';
                        const url = safeLink(c[field] as string);
                        if (url) {
                            const m: MediaMetadata = { kind: type, url, altText: typeof c.altText === 'string' ? c.altText : '' };
                            if (typeof c[type + 'Width'] === 'number')
                                m.width = c[type + 'Width'] as number;
                            if (typeof c[type + 'Height'] === 'number')
                                m.height = c[type + 'Height'] as number;
                            media.push(m);
                            parts.push(`${type === 'image' ? 'Image' : 'Video'}: [${m.altText || type}](${url})`);
                        }
                    }
                for (const field of ['linkUrl', 'prototypeUrl', 'codeUrl'])
                    if (typeof c[field] === 'string' && c[field]) {
                        const url = safeLink(c[field] as string);
                        if (url) {
                            links.push({ kind: field, url });
                            parts.push(`[${field}](${url})`);
                        }
                    }
                if (c.snippetCode) {
                    const fence = '`'.repeat(Math.max(3, ...[...c.snippetCode.matchAll(/`+/g)].map(m => m[0].length + 1)));
                    parts.push(`${fence}${c.snippetLanguage ?? ''}\n${c.snippetCode}\n${fence}`);
                }
                const captionNodes = c.footer ? htmlNodes(c.footer) : [];
                if (c.footer)
                    parts.push('Caption:\n' + renderNodes(captionNodes));
                let resource: ResourceReference | undefined;
                if (c.resourceName || c.libraryModuleType) {
                    if (c.resourceName)
                        resourceNames.add(c.resourceName);
                    const moduleType = c.libraryModuleType ?? 'UNSPECIFIED';
                    if (!knownModules.has(moduleType))
                        unknownModules.add(moduleType);
                    resource = { name: c.resourceName ?? '', moduleType, status: 'unresolved', ...(c.moduleConfigurationOverrides ? { configuration: c.moduleConfigurationOverrides } : {}) };
                    parts.push(`[Unresolved resource: ${resource.name}; module: ${moduleType}]`);
                }
                if (!knownKinds.has(kind) && kind !== 'UNSPECIFIED')
                    parts.push(`[Unknown content kind: ${kind}; metadata preserved]`);
                const metadata = Object.fromEntries(Object.entries(c).filter(([key, value]) => !['htmlValue', 'footer', 'snippetCode'].includes(key) && value !== null));
                chunks.push({ id: typeof c.pageContentChunkId === 'string' ? c.pageContentChunkId : `${si}-${bi}-${ci}`, kind, text: parts.filter(Boolean).join('\n\n'), nodes, captionNodes, media, links, ...(resource ? { resource } : {}), metadata });
            }
            const title = b.title ? htmlToMarkdown(b.title) : undefined;
            blocks.push({ id: b.pageContentBlockId ?? `${si}-${bi}`, provenance: blockProvenance(s, b, bi), section: s.name ?? '', ...(title ? { title } : {}), text: [title ? `## ${title}` : '', ...chunks.map(c => c.text)].filter(Boolean).join('\n\n'), chunks, media: chunks.flatMap(c => c.media) });
        }
    const headings: ParsedCarbon['headings'] = [];
    for (const [block, b] of blocks.entries()) {
        let fence = '';
        for (const line of b.text.split('\n')) {
            const f = /^(`{3,}|~{3,})/.exec(line);
            if (f) {
                if (!fence)
                    fence = f[1];
                else if (f[1][0] === fence[0] && f[1].length >= fence.length)
                    fence = '';
                continue;
            }
            const h = /^(#{1,6})\s+(.+)$/.exec(line);
            if (!fence && h)
                headings.push({ title: h[2], level: h[1].length, block });
        }
    }
    const result: ParsedCarbon = { normalizationVersion: 3, ...(doc.isDescriptionVisible !== undefined ? { isDescriptionVisible: doc.isDescriptionVisible } : {}), sections: selected.map(sectionProvenance), exclusions, title: doc.title, header, text: blocks.map(b => b.text).filter(Boolean).join('\n\n'), blocks, headings, resourceNames: [...resourceNames].sort(), unknownKinds: [...unknownKinds].sort(), unknownModules: [...unknownModules].sort(), pageId: doc.pageId, pageCanonId: doc.pageCanonId, sectionIds: [...new Set(selected.flatMap(s => s.pageSectionCanonId !== undefined || s.pageSectionId !== undefined ? [s.pageSectionCanonId, s.pageSectionId].filter((id): id is string => id !== undefined) : [s.name ?? '']))], ...(doc.updatedTimestamp ? { updatedTimestamp: doc.updatedTimestamp } : {}), hiddenSections: doc.sections.length - visible.length, hiddenBlocks };
    if (result.text.length > 2000000 || blocks.length > 5000)
        throw new Error('Extracted document exceeds limit');
    return result;
}
