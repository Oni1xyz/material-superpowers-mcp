# Design engine acceptance checks

## Entry point and output contracts

`src/tools/design.ts` exports `designTools: ToolDefinition[]` with five strict Zod-object input schemas and pure synchronous handlers. Each handler validates input again for direct invocation. No handler uses network, model, browser, or filesystem APIs.

- `material_generate_tokens`: default seed `#546a2f`, mode `both`. Returns `seedColor`, `mode`, `styleProfile`, real `sourceHct`, `schemes` (kebab-case roles), non-color `tokens` (full custom-property names), combined `css`, raw calculated `contrast` pairs, and limitations/notes. The source color library supplies baseline schemes; explicit HCT tonal mappings supply extended surface/fixed roles. Profile adaptations are authored, not officially certified Expressive styling.
- `material_map_brand_to_tokens`: returns `mapping`, `tokens` (the complete generation result, including CSS), checked `constraints`, `unusedPaletteKeys`, and recommendations. Recognized palette keys: primary, secondary, tertiary, neutral, error. `brand` or the first insertion-order entry supplies primary when absent. Constraints support mode, styleProfile, fontProfile, minContrast; impossible thresholds are reported unsatisfied, never silently asserted. Source swatches are tonal anchors, not forced text backgrounds.
- `material_component_recipe`: returns component/platform/variant/density/projectStyle, usage, anatomy, supported variants/states, accessibility guidance, `html`, `css`, `js`, requestedStates, integration notes, and limitations. Eight families: button/card/navigation/chip/text-field/dialog/snackbar/list; `navigation-rail` aliases navigation. Platforms plain-html-css and web only; material-web/react explicitly throw. The optional projectStyle is a profile name. Accessibility options: targetSize standard/large, reducedMotion. Reduced-motion protection is retained even if the latter is false. States list supported behaviors, not alternate snapshot fixtures.
- `material_review_ui_code`: returns advisory findings with ruleId/severity/confidence/evidence/fix/optional line, checkedRules, scope, summary, and limitations; `certification:false`.
- `material_review_tokens`: same advisory finding structure plus definedTokenCount, missingRoles, targetStyle, and bounded styleAssessment. Literal token values are intentional; unresolved host inheritance/imports cannot be ruled out.

## Verified commands

```sh
npx --no-install vitest run tests/design*
npx --no-install tsc --noEmit
node --input-type=module -e "import('@material/material-color-utilities').then(m=>console.log(m.hexFromArgb(m.Hct.fromInt(m.argbFromHex('#546a2f')).toInt())))"
```

Result: 33 design tests pass; TypeScript no-emit check passes; native ESM HCT round-trip prints `#546a2f`.

Tests were authored before implementation. They cover olive/indigo × light/dark/both exact primary equality against the real library, role coverage, opaque sRGB contrast, every style profile, parseable CSS/HTML for supported variants, generated JavaScript syntax, native semantics, executable dialog open/close and chip toggles against event-target unit doubles, unsupported options/injection rejection, unmet contrast constraints, bad/clean review fixtures, wrapped labels, UA focus, disabled/static semantics, and literal token values.

Initial execution was blocked while dependencies were unavailable. The first installed color utilities 0.4.0 also failed native ESM due to an upstream extensionless internal import. The core lane supplied 0.3.0 before final verification; standard tests and native imports now pass. No package files were changed by this lane.

## Not verified / intentionally out of scope

- No browser or assistive-technology audit was run; event-target doubles test generated callback logic only, not layout/focus containment/announcements.
- Recipes require the generated token stylesheet, host action wiring, real destination URLs, unique IDs when duplicated, and one-time script initialization.
- Review cannot determine full cascade, runtime states, computed styles, imagery/transparency, or subjective profile conformance. Missing findings are not a WCAG certificate.
- Only plain HTML/CSS/vanilla JS is implemented; unsupported adapters/variants/states reject rather than returning mislabeled canned output.
