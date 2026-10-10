export interface AuthoredRoute {
    id: string;
    title: string;
    summary: string;
    terms: string[];
    targets: Array<{
        path: string;
        relation: 'guidance' | 'alternative' | 'check';
        reason: string;
    }>;
}

/** Authored starting points, not official task prescriptions or implementation claims.
 * Targets are exact indexed M3 sections, reviewed against the local official corpus.
 * Specification links navigate source evidence; unresolved modules remain unresolved.
 */
export const authoredRoutes: AuthoredRoute[] = [
    {
        id: 'tasks/date-input',
        title: 'Date input',
        summary: 'Compare calendar and typed date entry, then review labels, errors, accessibility, and picker specifications.',
        terms: ['date', 'date input', 'date picker', 'calendar', 'date range', 'manual entry', 'form'],
        targets: [
            { path: 'components/date-pickers/guidelines', relation: 'guidance', reason: 'Compare docked, modal, and typed date entry for the context and window size.' },
            { path: 'components/date-pickers/accessibility', relation: 'check', reason: 'Keep manual date entry available and review assistive input and keyboard navigation.' },
            { path: 'components/date-pickers/specs', relation: 'guidance', reason: 'Inspect picker variants, anatomy, and linked token specifications.' },
            { path: 'components/text-fields/guidelines', relation: 'guidance', reason: 'Use field labels, supporting text, and error text for typed input.' },
            { path: 'components/text-fields/accessibility', relation: 'check', reason: 'Review field navigation and how supporting text and errors are communicated.' },
        ],
    },
    {
        id: 'tasks/adaptive-navigation',
        title: 'Adaptive navigation',
        summary: 'Compare navigation bars and rails across window contexts, keeping destination feedback and accessibility in view.',
        terms: ['adaptive', 'navigation', 'responsive', 'breakpoints', 'navigation bar', 'navigation rail', 'destinations', 'layout'],
        targets: [
            { path: 'foundations/layout/layout-overview/adaptive-design', relation: 'guidance', reason: 'Adapt structure and components to people, devices, and changing window contexts.' },
            { path: 'components/navigation-bar/guidelines', relation: 'guidance', reason: 'Review bottom navigation destinations, icons, labels, and adaptation.' },
            { path: 'components/navigation-rail/guidelines', relation: 'alternative', reason: 'Compare collapsed and expanded rails as a vertical navigation option.' },
            { path: 'components/navigation-rail/accessibility', relation: 'check', reason: 'Review destination selection, input feedback, and accessible target areas.' },
            { path: 'components/navigation-rail/specs', relation: 'guidance', reason: 'Inspect current rail variants and distinguish them from the baseline rail.' },
        ],
    },
    {
        id: 'tasks/settings-form',
        title: 'Settings form',
        summary: 'Choose text fields and selection controls, distinguishing immediate settings changes from related option selection.',
        terms: ['settings', 'preferences', 'form', 'text field', 'switch', 'toggle', 'checkbox', 'validation'],
        targets: [
            { path: 'components/text-fields/guidelines', relation: 'guidance', reason: 'Review labels, supporting text, and validation errors for editable settings.' },
            { path: 'components/switch/guidelines', relation: 'guidance', reason: 'Use switches for standalone binary settings whose effects start immediately, without saving.' },
            { path: 'components/checkbox/guidelines', relation: 'alternative', reason: 'Compare checkboxes for multiple related options rather than standalone settings.' },
            { path: 'components/text-fields/accessibility', relation: 'check', reason: 'Check assistive navigation, supporting text, and error communication.' },
            { path: 'components/switch/accessibility', relation: 'check', reason: 'Review keyboard toggling and descriptive labels for ambiguous settings.' },
            { path: 'components/text-fields/specs', relation: 'guidance', reason: 'Inspect field anatomy, tokens, and error states before choosing a variant.' },
        ],
    },
    {
        id: 'tasks/confirmation-destructive-action',
        title: 'Confirmation and destructive actions',
        summary: 'Review whether an action needs an interruptive decision, then inspect dialog actions, focus, and less disruptive feedback.',
        terms: ['confirmation', 'destructive', 'delete', 'dialog', 'cancel', 'undo', 'action', 'focus'],
        targets: [
            { path: 'components/dialogs/guidelines', relation: 'guidance', reason: 'Reserve interruptive dialogs for critical information or a required decision.' },
            { path: 'components/dialogs/accessibility', relation: 'check', reason: 'Review initial focus, contained keyboard navigation, dismissal, and dialog labeling.' },
            { path: 'components/dialogs/specs', relation: 'guidance', reason: 'Inspect dialog anatomy and variant token specifications.' },
            { path: 'components/buttons/guidelines', relation: 'guidance', reason: 'Review action emphasis and button styles for actions that complete a flow.' },
            { path: 'components/snackbar/guidelines', relation: 'alternative', reason: 'Consider non-blocking feedback for low-priority outcomes; review web auto-dismiss accessibility caveats.' },
        ],
    },
    {
        id: 'tasks/typography-theme',
        title: 'Typography and theme',
        summary: 'Choose type and color roles, check contrast, and inspect specification parents without assuming unresolved module values are available.',
        terms: ['typography', 'theme', 'type scale', 'font', 'color', 'contrast', 'elevation', 'tokens'],
        targets: [
            { path: 'styles/typography/applying-type', relation: 'guidance', reason: 'Choose display, headline, title, body, and label roles for readable hierarchy.' },
            { path: 'styles/color/roles', relation: 'guidance', reason: 'Map UI elements to color roles and their paired on-colors.' },
            { path: 'foundations/designing/color-contrast', relation: 'check', reason: 'Review text and non-text contrast rather than relying on color alone.' },
            { path: 'styles/typography/type-scale-tokens', relation: 'check', reason: 'Read type-scale guidance; the parent exposes an unresolved TYPOGRAPHY module, not verified values.' },
            { path: 'styles/color/static/baseline', relation: 'check', reason: 'Read baseline light and dark scheme guidance; the parent exposes an unresolved COLOR module.' },
            { path: 'styles/elevation/tokens', relation: 'check', reason: 'Read elevation token guidance; the parent exposes an unresolved ELEVATION module, not verified values.' },
        ],
    },
    {
        id: 'tasks/reduced-motion-loading',
        title: 'Reduced motion and loading',
        summary: 'Review reduced-animation transitions alongside honest progress feedback, accessible status labels, and motion specifications.',
        terms: ['reduced motion', 'reduced animation', 'loading', 'progress', 'transition', 'animation', 'determinate', 'indeterminate'],
        targets: [
            { path: 'styles/motion/transitions/applying-transitions', relation: 'check', reason: 'Follow reduced-animation settings with subtle fades and disabled decorative transition effects.' },
            { path: 'components/progress-indicators/guidelines', relation: 'guidance', reason: 'Choose determinate progress when known and indeterminate feedback when wait time is unknown.' },
            { path: 'components/progress-indicators/accessibility', relation: 'check', reason: 'Review indicator contrast, progress-bar roles, and labels describing the loading content.' },
            { path: 'components/progress-indicators/specs', relation: 'guidance', reason: 'Inspect linear and circular variants, configurations, and token specifications.' },
            { path: 'styles/motion/overview/specs', relation: 'guidance', reason: 'Review platform compatibility and spring specifications without assuming a web implementation exists.' },
        ],
    },
];
