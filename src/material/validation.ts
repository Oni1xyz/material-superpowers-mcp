import { z } from 'zod';

/** Zod 3's array.max() still parses every element and accumulates every issue.
 * Check length before allocating output; stop at the first invalid element.
 * Keep one bounded diagnostic (including its original path), not an error tree.
 */
export function boundedArray<T extends z.ZodTypeAny>(element: T, max: number, min = 0) {
    return z.unknown().transform((value, ctx): z.output<T>[] => {
        if (!Array.isArray(value) || value.length < min || value.length > max) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Expected array with ${min}..${max} entries`, fatal: true });
            return z.NEVER;
        }
        const result: z.output<T>[] = [];
        for (let i = 0; i < value.length; i++) {
            const parsed = element.safeParse(value[i]);
            if (!parsed.success) {
                const issue = parsed.error.issues[0];
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, ...issue.path], message: issue.message.slice(0, 200), fatal: true });
                return z.NEVER;
            }
            result.push(parsed.data);
        }
        return result;
    });
}

export function objectFields(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Cheap structural preflight: charge whole arrays before traversing any items.
 * Invalid non-array shapes are left to the schema's bounded diagnostics.
 */
export function arrayBudget(label: string, total: number) {
    let remaining = total;
    return (value: unknown, max: number): unknown[] => {
        if (!Array.isArray(value)) return [];
        if (value.length > max) throw new Error(`${label} array exceeds limit (${max})`);
        remaining -= value.length;
        if (remaining < 0) throw new Error(`${label} aggregate array limit exceeded`);
        return value;
    };
}
