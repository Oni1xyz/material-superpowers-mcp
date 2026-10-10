import { describe, expect, it } from 'vitest';
import { authoredRoutes } from '../src/graph/routes.js';

// Offline route-contract fixture, not a substitute for official corpus evidence.
const expectedTargets: Record<string, string[]> = {
    'tasks/date-input': [
        'components/date-pickers/guidelines',
        'components/date-pickers/accessibility',
        'components/date-pickers/specs',
        'components/text-fields/guidelines',
        'components/text-fields/accessibility',
    ],
    'tasks/adaptive-navigation': [
        'foundations/layout/layout-overview/adaptive-design',
        'components/navigation-bar/guidelines',
        'components/navigation-rail/guidelines',
        'components/navigation-rail/accessibility',
        'components/navigation-rail/specs',
    ],
    'tasks/settings-form': [
        'components/text-fields/guidelines',
        'components/switch/guidelines',
        'components/checkbox/guidelines',
        'components/text-fields/accessibility',
        'components/switch/accessibility',
        'components/text-fields/specs',
    ],
    'tasks/confirmation-destructive-action': [
        'components/dialogs/guidelines',
        'components/dialogs/accessibility',
        'components/dialogs/specs',
        'components/buttons/guidelines',
        'components/snackbar/guidelines',
    ],
    'tasks/typography-theme': [
        'styles/typography/applying-type',
        'styles/color/roles',
        'foundations/designing/color-contrast',
        'styles/typography/type-scale-tokens',
        'styles/color/static/baseline',
        'styles/elevation/tokens',
    ],
    'tasks/reduced-motion-loading': [
        'styles/motion/transitions/applying-transitions',
        'components/progress-indicators/guidelines',
        'components/progress-indicators/accessibility',
        'components/progress-indicators/specs',
        'styles/motion/overview/specs',
    ],
};
const plainText = (text: string, max: number) => {
    expect(text).toBe(text.trim());
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(max);
    expect(text).not.toMatch(/[<>\[\]`\u0000-\u001f\u007f]|https?:|javascript:/i);
};

describe('authored task routes (offline)', () => {
    it('exports exactly the six requested tasks with unique stable IDs', () => {
        expect(authoredRoutes).toHaveLength(6);
        const ids = authoredRoutes.map(route => route.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect([...ids].sort()).toEqual(Object.keys(expectedTargets).sort());
        for (const id of ids) expect(id).toMatch(/^tasks\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
    });

    it.each(Object.keys(expectedTargets))('%s has bounded, plain, unique routing metadata', id => {
        const route = authoredRoutes.find(route => route.id === id)!;
        expect(route).toBeDefined();
        expect(Object.keys(route).sort()).toEqual(['id', 'summary', 'targets', 'terms', 'title']);
        plainText(route.title, 80);
        plainText(route.summary, 220);
        expect(route.terms.length).toBeGreaterThanOrEqual(3);
        expect(route.terms.length).toBeLessThanOrEqual(16);
        expect(new Set(route.terms).size).toBe(route.terms.length);
        for (const term of route.terms) {
            plainText(term, 60);
            expect(term).toBe(term.toLowerCase());
        }
        expect(route.targets.length).toBeGreaterThanOrEqual(3);
        expect(route.targets.length).toBeLessThanOrEqual(7);
        expect(new Set(route.targets.map(target => target.path)).size).toBe(route.targets.length);
        expect(route.targets.map(target => target.path)).toEqual(expectedTargets[id]);
        for (const target of route.targets) {
            expect(Object.keys(target).sort()).toEqual(['path', 'reason', 'relation']);
            expect(target.path).toMatch(/^(components|styles|foundations)\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/);
            expect(['guidance', 'alternative', 'check']).toContain(target.relation);
            plainText(target.reason, 160);
        }
        expect(route.summary.length + route.targets.reduce((sum, target) => sum + target.reason.length, 0)).toBeLessThanOrEqual(1050);
    });

    it('separates design guidance, accessibility checks, and specification navigation', () => {
        for (const route of authoredRoutes) {
            expect(route.targets.some(target => target.relation === 'guidance')).toBe(true);
            expect(route.targets.some(target => target.relation === 'check')).toBe(true);
            expect(route.targets.some(target => /\/(specs|tokens|type-scale-tokens)$/.test(target.path))).toBe(true);
            for (const target of route.targets.filter(target => target.path.endsWith('/accessibility'))) {
                expect(target.relation).toBe('check');
            }
        }
    });

    it('routes unresolved typography, color, and elevation modules through their parent documents', () => {
        const route = authoredRoutes.find(route => route.id === 'tasks/typography-theme')!;
        for (const path of ['styles/typography/type-scale-tokens', 'styles/color/static/baseline', 'styles/elevation/tokens']) {
            const target = route.targets.find(target => target.path === path)!;
            expect(target.relation).toBe('check');
            expect(target.reason).toMatch(/unresolved/i);
        }
    });

    it('keeps alternatives conditional rather than presenting an implementation or certification', () => {
        const targets = authoredRoutes.flatMap(route => route.targets);
        expect(targets.find(target => target.path === 'components/checkbox/guidelines')?.relation).toBe('alternative');
        expect(targets.find(target => target.path === 'components/snackbar/guidelines')?.reason).toMatch(/low.priority|non.critical/i);
        expect(JSON.stringify(authoredRoutes)).not.toMatch(/implementation available|guaranteed|certified|fully accessible|WCAG compliant/i);
    });
});

it.runIf(process.env.MATERIAL_REAL_CACHE_TEST === '1')('all authored route targets resolve to exact, digest-verified official sections', async () => {
    // No network or cache refresh: this test only reads an explicitly opted-in local snapshot.
    const { openCorpus, readCorpusDocument } = await import('../src/material/corpus.js');
    const corpus = await openCorpus();
    const paths = [...new Set(authoredRoutes.flatMap(route => route.targets.map(target => target.path)))];
    for (const path of paths) {
        const entry = corpus.index.documents.find(entry => entry.path === path);
        expect(entry, path).toBeDefined();
        const doc = await readCorpusDocument(corpus, path);
        expect(doc.path).toBe(path);
        expect(doc.url).toBe(`https://m3.material.io/${path}`);
        expect(doc.sourceKind).toBe('material-3');
        expect(doc.section).toBe(entry!.section);
        expect(doc.text.length).toBeGreaterThan(0);
    }
    for (const [path, module] of [
        ['styles/typography/type-scale-tokens', 'TYPOGRAPHY'],
        ['styles/color/static/baseline', 'COLOR'],
        ['styles/elevation/tokens', 'ELEVATION'],
    ]) {
        const doc = await readCorpusDocument(corpus, path);
        expect(doc.unknownModules).toContain(module);
    }
}, 30000);
