import { parse } from 'parse5';
import { z } from 'zod';
import { arrayBudget, boundedArray, objectFields } from './validation.js';
export const M3_ORIGIN = 'https://m3.material.io';
export const carbonVersionSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/).refine(v => !/[\s]/.test(v));
export const carbonIdSchema = z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/).refine(v => !/[\s]/.test(v));
export const pathSchema = z.string().max(250).regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*|(?:blog\/)?search\.html)?$/).refine(v => !/[\s]/.test(v));
export const categorySchema = z.enum(['components', 'styles', 'foundations', 'entrypoint', 'develop', 'release', 'blog', 'other']);
export type Category = z.infer<typeof categorySchema>;
const routeSchema = z.object({ slug: pathSchema, exportedCarbonFileId: carbonIdSchema.nullable(), carbonPath: z.string().max(500).optional(), tabs: boundedArray(z.object({ label: z.string().min(1).max(200), alternateSlugs: boundedArray(pathSchema, 30).optional() }).passthrough(), 50).optional(), alternateSlugs: boundedArray(z.string().max(250), 50).optional() }).passthrough();
export type CarbonRoute = z.infer<typeof routeSchema>;
export interface SitemapEntry {
    url: string;
    path: string;
    lastmod?: string;
}
export interface RouteMapping extends SitemapEntry {
    category: Category;
    status: 'mapped' | 'unresolved' | 'excluded';
    routeSlug?: string;
    documentId?: string;
    section?: string;
    reason?: string;
}
/** Citation/discovery validation, NOT a transport allowlist: canonical article
 * paths may be cited but must never authorize arbitrary network requests.
 * Validate raw spelling before any WHATWG URL normalization. */
export function validateM3Url(value: string): string {
    if (value.length > 600 || /[\s\\%?#@]/.test(value) || !value.startsWith(M3_ORIGIN + '/'))
        throw new Error('URL outside official M3 allowlist');
    const path = value.slice(M3_ORIGIN.length);
    if (path === '/' || path === '/sitemap.xml' || /^\/static\/angular\/[a-zA-Z0-9_-]+\.[a-f0-9]{16,64}\.(?:js|css)$/.test(path) || /^\/_dsm\/content\/m3\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(path))
        return value;
    if (pathSchema.safeParse(path.slice(1)).success)
        return value;
    throw new Error('URL outside official M3 allowlist');
}
export function contentUrl(version: string, id: string) { return validateM3Url(`${M3_ORIGIN}/_dsm/content/m3/${carbonVersionSchema.parse(version)}/${carbonIdSchema.parse(id)}`); }
/** Pin each transport to its planned identity: the homepage, sitemap, main
 * bundle discovered from that homepage, or current discovered UUID content URL.
 * Even another valid endpoint cannot be substituted by a redirect. Callers
 * supply the discovered bundle/version/ID, never an arbitrary citation URL. */
export function exactM3Endpoint(expected: string): (value: string) => string {
    validateM3Url(expected);
    const path = expected.slice(M3_ORIGIN.length);
    const content = /^\/_dsm\/content\/m3\/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json)$/.exec(path);
    if (!(path === '/' || path === '/sitemap.xml' || /^\/static\/angular\/main\.[a-f0-9]{16,64}\.js$/.test(path) || content))
        throw new Error('URL outside official M3 endpoint allowlist');
    if (content) {
        const iso = content[1].replace('_', 'T').replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3') + 'Z';
        const date = new Date(iso);
        if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000', '') !== iso) throw new Error('Invalid endpoint carbon version');
    }
    return value => {
        validateM3Url(value);
        if (value !== expected) throw new Error('Redirect outside planned M3 endpoint allowlist');
        return value;
    };
}
export function discoverMainScript(html: string): string {
    if (html.length > 2000000)
        throw new Error('Homepage exceeds discovery limit');
    const root = parse(html);
    const urls: string[] = [];
    function walk(node: any) { if (node.tagName === 'script') {
        const src = node.attrs.find((a: any) => a.name === 'src')?.value as string | undefined;
        if (src && /(?:^|\/)main\./.test(src))
            urls.push(src);
    } for (const child of node.childNodes ?? [])
        walk(child); }
    walk(root);
    const main = [...new Set(urls)].filter(url => /main\.[a-f0-9]{16,64}\.js$/.test(url));
    if (main.length !== 1)
        throw new Error('Expected exactly one hashed M3 main script');
    const url = main[0].startsWith('/') && !main[0].startsWith('//') ? M3_ORIGIN + main[0] : main[0];
    if (!url.startsWith(M3_ORIGIN + '/static/angular/main.'))
        throw new Error('Main script must use official same-origin namespace');
    return validateM3Url(url);
}
/** Extract strict JSON islands only. Never eval/import/run the upstream bundle. */
export function discoverBundle(script: string): {
    carbonVersion: string;
    routes: CarbonRoute[];
} {
    if (script.length > 16000000)
        throw new Error('Main bundle exceeds limit');
    const versions = [...new Set([...script.matchAll(/\bcarbonVersion\s*:\s*"([^"]+)"/g)].map(m => m[1]))];
    if (versions.length !== 1)
        throw new Error('Missing or ambiguous carbonVersion');
    const carbonVersion = carbonVersionSchema.parse(versions[0]);
    const routes: CarbonRoute[] = [];
    const routeArrays = arrayBudget('Route discovery', 100000);
    for (const marker of script.matchAll(/"exportedCarbonFileId"\s*:/g)) {
        const start = script.lastIndexOf('{', marker.index);
        let depth = 0, quoted = false, escaped = false, end = -1;
        for (let i = start; i < Math.min(script.length, start + 100000); i++) {
            const c = script[i];
            if (quoted) {
                if (escaped)
                    escaped = false;
                else if (c === '\\')
                    escaped = true;
                else if (c === '"')
                    quoted = false;
            }
            else if (c === '"')
                quoted = true;
            else if (c === '{')
                depth++;
            else if (c === '}' && --depth === 0) {
                end = i + 1;
                break;
            }
        }
        if (start < 0 || end < 0)
            throw new Error('Unterminated route JSON');
        let value: unknown;
        try {
            value = JSON.parse(script.slice(start, end));
        }
        catch {
            throw new Error('Route is not strict JSON; upstream schema changed');
        }
        if (routes.length >= 2000)
            throw new Error('Route count exceeds limit');
        const fields = objectFields(value);
        routeArrays(fields.alternateSlugs, 50);
        for (const tab of routeArrays(fields.tabs, 50))
            routeArrays(objectFields(tab).alternateSlugs, 30);
        routes.push(routeSchema.parse(value));
    }
    if (!routes.length || new Set(routes.map(r => r.slug)).size !== routes.length)
        throw new Error('Missing or duplicate route data');
    return { carbonVersion, routes };
}
export function parseSitemap(xml: string): SitemapEntry[] {
    if (xml.length > 2000000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<urlset\b/.test(xml) || !/<\/urlset>/.test(xml))
        throw new Error('Invalid bounded sitemap');
    const entries: SitemapEntry[] = [];
    const seen = new Set<string>();
    const items = [...xml.matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/g)];
    if (items.length !== (xml.match(/<url(?:\s|>)/g) ?? []).length)
        throw new Error('Unrecognized sitemap URL entry; refusing silent omissions');
    for (const item of items) {
        if ((item[1].match(/<loc>/g) ?? []).length !== 1)
            throw new Error('Ambiguous sitemap URL');
        const loc = /<loc>([^<]+)<\/loc>/.exec(item[1])?.[1];
        if (!loc)
            throw new Error('Missing sitemap URL');
        const url = validateM3Url(loc);
        const path = url.slice(M3_ORIGIN.length + 1);
        pathSchema.parse(path);
        if (seen.has(url))
            continue;
        seen.add(url);
        const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(item[1])?.[1];
        if (lastmod && !/^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(lastmod))
            throw new Error('Invalid sitemap timestamp');
        entries.push({ url, path, ...(lastmod ? { lastmod } : {}) });
        if (entries.length > 2000)
            throw new Error('Sitemap count exceeds limit');
    }
    if (!entries.length)
        throw new Error('Empty sitemap');
    return entries.sort((a, b) => a.path.localeCompare(b.path));
}
export function categoryFor(path: string): Category {
    const first = path.split('/')[0];
    if (first === 'components' || first === 'styles' || first === 'foundations' || first === 'develop' || first === 'blog')
        return first;
    if (!path || path === 'get-started')
        return 'entrypoint';
    if (/release|whats-new|expressive|compose-first/.test(path))
        return 'release';
    return 'other';
}
export const tabSlug = (label: string) => label.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s-]+/g, '-');
export function mapCanonicalRoutes(sitemap: SitemapEntry[], routes: CarbonRoute[]): RouteMapping[] {
    const exact = new Map<string, {
        route: CarbonRoute;
        section?: string;
    }>();
    const add = (path: string, route: CarbonRoute, section?: string) => { const old = exact.get(path); if (old && (old.route.slug !== route.slug || old.section !== section))
        throw new Error(`Ambiguous canonical route: ${path}`); exact.set(path, { route, section }); };
    for (const route of routes) {
        if (!route.exportedCarbonFileId)
            continue;
        if (route.tabs?.length)
            for (const tab of route.tabs)
                add(`${route.slug}/${tabSlug(tab.label)}`, route, tab.label);
        else
            add(route.slug, route);
    }
    return sitemap.map(entry => {
        const category = categoryFor(entry.path), match = exact.get(entry.path);
        if (match)
            return { ...entry, category, status: 'mapped', routeSlug: match.route.slug, documentId: match.route.exportedCarbonFileId!, ...(match.section ? { section: match.section } : {}) };
        if (category === 'blog')
            return { ...entry, category, status: 'excluded', reason: entry.path === 'blog/search.html' ? 'Blog search UI is not an exported document; excluded from the specification corpus.' : 'Blog/archive URL absent from current canonical Carbon route table; excluded from core specification corpus (not a claim about publication age).' };
        return { ...entry, category, status: 'unresolved', reason: 'No exact canonical route/tab match in current bundle; never substitute a parent document.' };
    });
}
