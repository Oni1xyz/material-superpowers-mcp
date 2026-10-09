import { argbFromHex, hexFromArgb, Hct, themeFromSourceColor, TonalPalette } from '@material/material-color-utilities';
import { z } from 'zod';

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color (#rrggbb).');
export const styleProfile = z.enum(['default','expressive','minimal','editorial','lab']);
const font = z.string().min(1).max(160).refine(value => value.split(',').every(part => /^(?:[A-Za-z][A-Za-z0-9 -]*|"[A-Za-z][A-Za-z0-9 -]*"|'[A-Za-z][A-Za-z0-9 -]*')$/.test(part.trim())), 'Use comma-separated font family names, not CSS declarations or URLs.');
export const fontProfile = z.object({ display: font.optional(), body: font.optional(), label: font.optional() }).strict();
export const tokenSchema = z.object({
  seedColor: hexColor.default('#546a2f'), mode: z.enum(['light','dark','both']).default('both'),
  styleProfile: styleProfile.default('default'), fontProfile: fontProfile.optional(),
  includeMotion: z.boolean().default(true), includeShape: z.boolean().default(true),
}).strict();
export type TokenInput = z.infer<typeof tokenSchema>;
export type Scheme = Record<string,string>;
const kebab = (s: string) => s.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);

// WCAG relative luminance, using unrounded channel values and sRGB transfer.
export function contrastRatio(a: string, b: string): number {
  function luminance(hex: string) {
    let h = hex.replace('#',''); if (h.length === 3) h = h.split('').map(c => c+c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error('Contrast requires opaque hex colors.');
    const c = [0,2,4].map(i => parseInt(h.slice(i,i+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
    return c[0]!* .2126 + c[1]!* .7152 + c[2]!* .0722;
  }
  const x = luminance(a), y = luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export const contrastPairs = [
  ['primary','on-primary'],['primary-container','on-primary-container'],
  ['secondary','on-secondary'],['secondary-container','on-secondary-container'],
  ['tertiary','on-tertiary'],['tertiary-container','on-tertiary-container'],
  ['error','on-error'],['error-container','on-error-container'],
  ['background','on-background'],['surface','on-surface'],['surface-variant','on-surface-variant'],
  ['surface-container','on-surface'],['inverse-surface','inverse-on-surface'],['inverse-surface','inverse-primary'],
  ['surface-dim','on-surface'],['surface-bright','on-surface'],['surface-container-lowest','on-surface'],
  ['surface-container-low','on-surface'],['surface-container-high','on-surface'],['surface-container-highest','on-surface'],
  ['primary-fixed','on-primary-fixed'],['primary-fixed','on-primary-fixed-variant'],['primary-fixed-dim','on-primary-fixed'],['primary-fixed-dim','on-primary-fixed-variant'],
  ['secondary-fixed','on-secondary-fixed'],['secondary-fixed','on-secondary-fixed-variant'],['secondary-fixed-dim','on-secondary-fixed'],['secondary-fixed-dim','on-secondary-fixed-variant'],
  ['tertiary-fixed','on-tertiary-fixed'],['tertiary-fixed','on-tertiary-fixed-variant'],['tertiary-fixed-dim','on-tertiary-fixed'],['tertiary-fixed-dim','on-tertiary-fixed-variant'],
] as const;
const profileSettings = {
  default:{display:'system-ui, sans-serif',body:'system-ui, sans-serif',label:'system-ui, sans-serif',small:8,medium:12,large:24,xl:28,short:150,mediumMotion:250},
  expressive:{display:'system-ui, sans-serif',body:'system-ui, sans-serif',label:'system-ui, sans-serif',small:12,medium:20,large:32,xl:40,short:180,mediumMotion:300},
  minimal:{display:'system-ui, sans-serif',body:'system-ui, sans-serif',label:'system-ui, sans-serif',small:4,medium:8,large:12,xl:16,short:100,mediumMotion:180},
  editorial:{display:'Georgia, serif',body:'system-ui, sans-serif',label:'system-ui, sans-serif',small:2,medium:4,large:8,xl:12,short:120,mediumMotion:220},
  lab:{display:'system-ui, sans-serif',body:'system-ui, sans-serif',label:'ui-monospace, monospace',small:4,medium:8,large:16,xl:20,short:120,mediumMotion:200},
};
function cssBlock(selector: string, props: Record<string,string>) {
  return `${selector} {\n${Object.entries(props).map(([key,value])=>`  ${key}: ${value};`).join('\n')}\n}`;
}
export function generateTokens(input: TokenInput, paletteOverrides: Record<string,string> = {}) {
  const seed = argbFromHex(input.seedColor), theme = themeFromSourceColor(seed);
  const hct = Hct.fromInt(seed), profile = profileSettings[input.styleProfile];
  const schemes: Record<string,Scheme> = {};
  for (const mode of input.mode === 'both' ? ['light','dark'] as const : [input.mode]) {
    const dark = mode === 'dark';
    const roles: Scheme = Object.fromEntries(Object.entries(theme.schemes[mode].toJSON()).map(([key,value])=>[kebab(key),hexFromArgb(value)]));
    for (const family of ['primary','secondary','tertiary','error']) {
      if (!paletteOverrides[family]) continue;
      const p = TonalPalette.fromInt(argbFromHex(paletteOverrides[family]!));
      for (const [role,tone] of [[family,dark?80:40],[`on-${family}`,dark?20:100],[`${family}-container`,dark?30:90],[`on-${family}-container`,dark?90:10]] as const) roles[role] = hexFromArgb(p.tone(tone));
      if (family === 'primary') roles['inverse-primary'] = hexFromArgb(p.tone(dark ? 40 : 80));
    }
    const neutral = paletteOverrides.neutral ? TonalPalette.fromInt(argbFromHex(paletteOverrides.neutral)) : theme.palettes.neutral;
    if (paletteOverrides.neutral) {
      for (const [role,tone] of [['background',dark?10:99],['on-background',dark?90:10],['surface',dark?10:99],['on-surface',dark?90:10],['inverse-surface',dark?90:20],['inverse-on-surface',dark?20:95]] as const) roles[role] = hexFromArgb(neutral.tone(tone));
    }
    const surfaceTones = dark ? [6,24,4,10,12,17,22] : [87,98,100,96,94,92,90];
    ['surface-dim','surface-bright','surface-container-lowest','surface-container-low','surface-container','surface-container-high','surface-container-highest'].forEach((name,i)=>roles[name]=hexFromArgb(neutral.tone(surfaceTones[i]!)));
    roles['surface-tint'] = roles.primary!;
    for (const family of ['primary','secondary','tertiary'] as const) {
      const p = paletteOverrides[family] ? TonalPalette.fromInt(argbFromHex(paletteOverrides[family]!)) : theme.palettes[family];
      for (const [suffix,tone] of [['fixed',90],['fixed-dim',80],['on-fixed',10],['on-fixed-variant',30]] as const) {
        const role = suffix.startsWith('on-') ? `on-${family}-${suffix.slice(3)}` : `${family}-${suffix}`;
        roles[role] = hexFromArgb(p.tone(tone));
      }
    }
    schemes[mode] = roles;
  }
  const common: Record<string,string> = {};
  for (const role of ['display','body','label'] as const) common[`--md-sys-typescale-${role}-font`] = input.fontProfile?.[role] ?? profile[role];
  common['--md-sys-typescale-headline-font'] = input.fontProfile?.display ?? profile.display;
  common['--md-sys-typescale-title-font'] = input.fontProfile?.display ?? profile.display;
  const scale: Record<string,[number,number,number]> = {
    'display-large':[57,64,400],'display-medium':[45,52,400],'display-small':[36,44,400],
    'headline-large':[32,40,400],'headline-medium':[28,36,400],'headline-small':[24,32,400],
    'title-large':[22,28,400],'title-medium':[16,24,500],'title-small':[14,20,500],
    'body-large':[16,24,400],'body-medium':[14,20,400],'body-small':[12,16,400],
    'label-large':[14,20,500],'label-medium':[12,16,500],'label-small':[11,16,500],
  };
  for (const [role,[size,line,weight]] of Object.entries(scale)) {
    common[`--md-sys-typescale-${role}-size`] = `${size}px`;
    common[`--md-sys-typescale-${role}-line-height`] = `${line}px`;
    common[`--md-sys-typescale-${role}-weight`] = String(weight);
  }
  for (const [name,value] of Object.entries({xs:4,sm:8,md:16,lg:24,xl:32})) common[`--md-sys-spacing-${name}`] = `${value}px`;
  common['--md-sys-size-target'] = '48px';
  if (input.includeShape) for (const [name,value] of Object.entries({none:0,small:profile.small,medium:profile.medium,large:profile.large,'extra-large':profile.xl,full:999})) common[`--md-sys-shape-corner-${name}`] = `${value}px`;
  if (input.includeMotion) {
    common['--md-sys-motion-duration-short'] = `${profile.short}ms`;
    common['--md-sys-motion-duration-medium'] = `${profile.mediumMotion}ms`;
    common['--md-sys-motion-easing-standard'] = 'cubic-bezier(0.2, 0, 0, 1)';
  }
  common['--md-sys-elevation-1'] = '0 1px 3px rgb(0 0 0 / 0.2)';
  common['--md-sys-elevation-2'] = '0 3px 8px rgb(0 0 0 / 0.2)';
  const colors = (s: Scheme) => Object.fromEntries(Object.entries(s).map(([key,value])=>[`--md-sys-color-${key}`,value]));
  const blocks = [cssBlock(':root',common)];
  for (const [mode,scheme] of Object.entries(schemes)) blocks.push(cssBlock(input.mode === 'both' ? (mode === 'light' ? ':root, [data-theme="light"]' : '[data-theme="dark"]') : ':root',colors(scheme)));
  if (input.mode === 'both') blocks.push(`@media (prefers-color-scheme: dark) {\n${cssBlock(':root:not([data-theme])',colors(schemes.dark!))}\n}`);
  if (input.includeMotion) blocks.push('@media (prefers-reduced-motion: reduce) {\n  :root { --md-sys-motion-duration-short: 0ms; --md-sys-motion-duration-medium: 0ms; }\n}');
  const contrast = Object.entries(schemes).flatMap(([mode,s])=>contrastPairs.map(([background,foreground])=>{
    const ratio = contrastRatio(s[background]!,s[foreground]!);
    return { mode, background, foreground, backgroundHex:s[background], foregroundHex:s[foreground], ratio, meetsAAForNormalText:ratio>=4.5 };
  }));
  return { seedColor:hexFromArgb(seed), mode:input.mode, styleProfile:input.styleProfile,
    sourceHct:{hue:hct.hue,chroma:hct.chroma,tone:hct.tone}, schemes, tokens:common, css:blocks.join('\n\n'), contrast,
    notes:[
      'Colors use @material/material-color-utilities HCT tonal palettes and baseline Material light/dark schemes; extended surface and fixed roles use explicit tonal mappings.',
      'Style profiles are authored adaptations, not a guarantee of official Material 3 Expressive conformance.',
      'Contrast uses actual generated opaque sRGB pairs. It does not certify a rendered page, gradients, transparency, or all possible role combinations.',
      'Apply data-theme="light" or data-theme="dark" on the root element for an explicit preference; both mode otherwise follows the system.',
    ],
  };
}

export const brandSchema = z.object({
  palette:z.record(z.string().min(1).max(80),hexColor).refine(p=>Object.keys(p).length>0 && Object.keys(p).length<=32,'Provide 1–32 named brand colors.'),
  constraints:z.object({ mode:z.enum(['light','dark','both']).optional(),styleProfile:styleProfile.optional(),fontProfile:fontProfile.optional(),minContrast:z.number().min(1).max(21).optional() }).strict().optional(),
  avoidGoogleLook:z.boolean().default(true),
}).strict();
export function mapBrand(input:z.infer<typeof brandSchema>) {
  const entries = Object.entries(input.palette);
  const primary = input.palette.primary ?? input.palette.brand ?? entries[0]![1];
  const overrides:Record<string,string> = { primary };
  const mapping:Record<string,unknown> = { primary:{ source:primary, reason:input.palette.primary ? 'Explicit primary brand anchor.' : input.palette.brand ? 'Named brand anchor.' : `First palette entry (${entries[0]![0]}) chosen deterministically; rename it primary to make intent explicit.` } };
  for (const family of ['secondary','tertiary','neutral','error']) if (input.palette[family]) {
    overrides[family] = input.palette[family]!; mapping[family] = {source:input.palette[family],reason:`Explicit ${family} hue/chroma mapped to HCT tones; raw swatch is not forced into a text role.`};
  }
  const tokens = generateTokens(tokenSchema.parse({seedColor:primary,mode:input.constraints?.mode,styleProfile:input.constraints?.styleProfile ?? (input.avoidGoogleLook?'editorial':'default'),fontProfile:input.constraints?.fontProfile}),overrides);
  const threshold = input.constraints?.minContrast ?? 4.5;
  const unmet = tokens.contrast.filter(p=>p.ratio<threshold);
  return {mapping,tokens,constraints:{minContrast:threshold,satisfied:unmet.length===0,unmet},
    unusedPaletteKeys:Object.keys(input.palette).filter(key=>!['primary','secondary','tertiary','neutral','error'].includes(key) && !(primary===input.palette[key] && (key==='brand'||key===entries[0]![0]))),
    recommendations:[input.avoidGoogleLook?'Brand-led color, editorial shapes/type by default, and no Roboto or Google assets. This is a direction, not an objective brand-similarity guarantee.':'Baseline authored styling retained.', 'Unrecognized palette names are not guessed into semantic roles. Name secondary, tertiary, neutral, or error to opt into those mappings.', 'Brand hue/chroma are preserved through tonal generation where sRGB permits; role colors can differ from the source swatches.', ...(unmet.length ? ['Requested contrast threshold is not satisfied for all pairs. No compliance claim is made; revise the palette or use higher-contrast role combinations.'] : [])]};
}
