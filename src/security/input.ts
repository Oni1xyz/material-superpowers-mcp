import { z } from 'zod';

/** Limits apply to already-decoded, plain JSON arguments, not transport bytes.
 * UTF-16 code units match the existing Zod string limits. Both 200k review
 * sources plus goals fit; keys and repeated strings also consume the aggregate.
 */
export const INPUT_LIMITS = Object.freeze({
  nodes: 2048,
  depth: 24,
  arrayLength: 128,
  objectKeys: 128,
  stringCharacters: 200_000,
  totalCharacters: 500_000,
});

class InvalidInput extends Error {
  constructor(message: string) { super(`Invalid input: ${message}`); }
}

/** Iterative, non-serializing preflight BEFORE any tool-schema Zod validation.
 * Whole array lengths are charged before visiting children. Objects stop after
 * the key limit; no Object.entries/value clones or unbounded traversal stack.
 * Cycles/repeated references consume depth/node budgets just like JSON trees.
 * This is not a sandbox for host-supplied Proxies or privileged object hooks.
 */
export function preflightInput(input: unknown): void {
  const pending: { value: unknown; depth: number }[] = [{ value: input, depth: 0 }];
  let nodes = 1, characters = 0;
  const chargeString = (text: string) => {
    if (text.length > INPUT_LIMITS.stringCharacters) throw new InvalidInput('string exceeds character safety limit');
    characters += text.length;
    if (characters > INPUT_LIMITS.totalCharacters) throw new InvalidInput('aggregate character safety limit exceeded');
  };
  const chargeNodes = (count: number) => {
    nodes += count;
    if (nodes > INPUT_LIMITS.nodes) throw new InvalidInput('aggregate node safety limit exceeded');
  };
  const childValue = (object: object, key: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !('value' in descriptor)) throw new InvalidInput('expected plain JSON data without accessors or array holes');
    return descriptor.value;
  };
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (depth > INPUT_LIMITS.depth) throw new InvalidInput('nesting depth safety limit exceeded');
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'string') { chargeString(value); continue; }
    if (typeof value === 'number' && Number.isFinite(value)) continue;
    if (typeof value !== 'object') throw new InvalidInput('expected JSON data');
    if (Array.isArray(value)) {
      if (value.length > INPUT_LIMITS.arrayLength) throw new InvalidInput('array length safety limit exceeded');
      chargeNodes(value.length);
      for (let i = value.length - 1; i >= 0; i--) pending.push({ value: childValue(value, String(i)), depth: depth + 1 });
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new InvalidInput('expected plain JSON objects');
      let keys = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (++keys > INPUT_LIMITS.objectKeys) throw new InvalidInput('object key safety limit exceeded');
        chargeString(key);
        chargeNodes(1);
        pending.push({ value: childValue(value, key), depth: depth + 1 });
      }
    }
  }
}

type Path = (string | number)[];
const diagnostic = (path: Path, message: string): InvalidInput => {
  // Slice BEFORE joining/concatenating; an attacker-controlled record key must
  // not multiply a 200k string into a path or error response.
  const label = path.slice(0, INPUT_LIMITS.depth + 1).map(part => String(part).slice(0, 80)).join('.').slice(0, 240);
  return new InvalidInput(`${label || 'input'}: ${message.slice(0, 300)}`);
};

/** Prevalidate collections one child at a time, then retain the original Zod
 * schema as the authority (strict keys, refinements, defaults and transforms).
 * Zod 3 array.max/record.refine validate ALL children before enforcing limits;
 * merely truncating issues after safeParse does not bound that allocation.
 *
 * Schemas are trusted, shallow, synchronous definitions. These are the container
 * types used by the thirteen tools. Any future preprocessing/other schema kind
 * still receives resource-bounded JSON; extend this traversal when adding a new
 * collection kind. Pure field refinements may run more than once, as they already
 * do in the tool handlers; no input data is transformed by this preliminary pass.
 */
function parseChildrenFirst(schema: z.ZodTypeAny, input: unknown, path: Path): unknown {
  if (schema instanceof z.ZodOptional) {
    if (input !== undefined) parseChildrenFirst(schema.unwrap(), input, path);
  } else if (schema instanceof z.ZodDefault) {
    if (input !== undefined) parseChildrenFirst(schema.removeDefault(), input, path);
  } else if (schema instanceof z.ZodNullable) {
    if (input !== null) parseChildrenFirst(schema.unwrap(), input, path);
  } else if (schema instanceof z.ZodEffects) {
    if (schema._def.effect.type !== 'preprocess') parseChildrenFirst(schema.innerType(), input, path);
  } else if (schema instanceof z.ZodArray && Array.isArray(input)) {
    const { minLength, maxLength, exactLength } = schema._def;
    if (maxLength && input.length > maxLength.value) throw diagnostic(path, `Array must contain at most ${maxLength.value} element(s)`);
    if (minLength && input.length < minLength.value) throw diagnostic(path, `Array must contain at least ${minLength.value} element(s)`);
    if (exactLength && input.length !== exactLength.value) throw diagnostic(path, `Array must contain exactly ${exactLength.value} element(s)`);
    for (let i = 0; i < input.length; i++) parseChildrenFirst(schema.element, input[i], [...path, i]);
  } else if (schema instanceof z.ZodObject && input !== null && typeof input === 'object' && !Array.isArray(input)) {
    const shape = schema.shape;
    const object = input as Record<string, unknown>;
    for (const key of Object.keys(object)) {
      if (!Object.hasOwn(shape, key)) {
        if (schema._def.catchall instanceof z.ZodNever) {
          if (schema._def.unknownKeys === 'strict') throw diagnostic([...path, key], 'Unrecognized key');
        } else parseChildrenFirst(schema._def.catchall, object[key], [...path, key]);
      }
    }
    for (const key of Object.keys(shape)) parseChildrenFirst(shape[key], Object.hasOwn(object, key) ? object[key] : undefined, [...path, key]);
  } else if (schema instanceof z.ZodRecord && input !== null && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of Object.keys(input)) {
      parseChildrenFirst(schema.keySchema, key, [...path, key]);
      parseChildrenFirst(schema.valueSchema, (input as Record<string, unknown>)[key], [...path, key]);
    }
  } else if (schema instanceof z.ZodUnion) {
    let first: InvalidInput | undefined;
    for (const option of schema.options) {
      try { return parseChildrenFirst(option, input, path); }
      catch (error) {
        if (!(error instanceof InvalidInput)) throw error;
        first ??= error;
      }
    }
    throw first ?? diagnostic(path, 'No union option matched');
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw diagnostic([...path, ...issue.path], issue.message);
  }
  return parsed.data;
}

export function parseToolInput(schema: z.ZodTypeAny, input: unknown): unknown {
  preflightInput(input);
  return parseChildrenFirst(schema, input, []);
}
