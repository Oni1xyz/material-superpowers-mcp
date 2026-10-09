import { z } from 'zod';

export const text = z.string().min(1).max(2000).refine(value => value.trim().length > 0, 'Text must not be whitespace only.');
const items = z.array(text).max(20);
const urlMetadata = z.string().max(2048).refine(value => {
  if (!/^https?:\/\//i.test(value) || /\s|[\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}, 'URL metadata must be an absolute HTTP(S) URL without credentials or whitespace; it is never fetched.');

export const screenSchema = z.object({
  screen: text,
  userGoal: text,
  platform: z.enum(['web', 'mobile', 'desktop']),
  brandStyle: text.optional(),
  constraints: z.union([text, items]).optional(),
}).strict();

export const evalSchema = z.object({
  target: text,
  url: urlMetadata.optional(),
  components: items.optional(),
  flows: items.optional(),
  breakpoints: z.array(z.object({
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/),
    width: z.number().int().min(240).max(3840),
    height: z.number().int().min(240).max(2160),
  }).strict()).min(1).max(6).refine(points => new Set(points.map(p => p.name)).size === points.length, 'Breakpoint names must be unique.').optional(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  projectStyle: text.optional(),
}).strict();

export type ScreenInput = z.infer<typeof screenSchema>;
export type EvalInput = z.infer<typeof evalSchema>;
