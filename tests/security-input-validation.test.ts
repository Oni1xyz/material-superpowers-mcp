import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { allTools, executeTool } from '../src/server.js';
import { INPUT_LIMITS, parseToolInput, preflightInput } from '../src/security/input.js';

describe('JSON argument preflight', () => {
  it('runs before Zod and before run for every registered tool', async () => {
    expect(allTools).toHaveLength(13);
    for (const tool of allTools) {
      const parse = vi.spyOn(tool.inputSchema, 'safeParse');
      const run = vi.fn();
      try {
        const response = await executeTool({ ...tool, run }, { hostile: Array(INPUT_LIMITS.arrayLength + 1).fill({}) });
        expect(response.isError).toBe(true);
        expect(parse).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
        expect(response.content).toEqual([{ type: 'text', text: 'Invalid input: array length safety limit exceeded' }]);
      } finally { parse.mockRestore(); }
    }
  });

  it('enforces exact per-array, per-object and per-string boundaries', () => {
    expect(() => preflightInput(Array(INPUT_LIMITS.arrayLength).fill(null))).not.toThrow();
    expect(() => preflightInput(Array(INPUT_LIMITS.arrayLength + 1).fill(null))).toThrow(/array length/);
    const object = Object.fromEntries(Array.from({ length: INPUT_LIMITS.objectKeys }, (_, i) => [`key${i}`, false]));
    expect(() => preflightInput(object)).not.toThrow();
    expect(() => preflightInput({ ...object, extra: 1 })).toThrow(/object key/);
    expect(() => preflightInput('x'.repeat(INPUT_LIMITS.stringCharacters))).not.toThrow();
    expect(() => preflightInput('x'.repeat(INPUT_LIMITS.stringCharacters + 1))).toThrow(/string exceeds/);
    expect(() => preflightInput({ ['x'.repeat(INPUT_LIMITS.stringCharacters + 1)]: '' })).toThrow(/string exceeds/);
  });

  it('counts all nodes including scalar leaves and accepts the exact aggregate boundary', () => {
    // 1 root + 16 arrays + 2031 scalar leaves = 2048 nodes.
    const input = Array.from({ length: 16 }, (_, i) => Array(i === 15 ? 111 : 128).fill(false));
    expect(() => preflightInput(input)).not.toThrow();
    input[15].push(false);
    expect(() => preflightInput(input)).toThrow(/aggregate node/);
  });

  it('counts repeated strings and keys in aggregate using UTF-16 units', () => {
    expect(() => preflightInput(['x'.repeat(200000), 'x'.repeat(200000), '😀'.repeat(50000)])).not.toThrow();
    expect(() => preflightInput(['x'.repeat(200000), 'x'.repeat(200000), '😀'.repeat(50000), 'x'])).toThrow(/aggregate character/);
    expect(() => preflightInput({ a: 'x'.repeat(200000), b: 'x'.repeat(200000), c: 'x'.repeat(99998) })).toThrow(/aggregate character/);
  });

  it('bounds nesting iteratively, including cycles', () => {
    let input: unknown = null;
    for (let i = 0; i < INPUT_LIMITS.depth; i++) input = { child: input };
    expect(() => preflightInput(input)).not.toThrow();
    expect(() => preflightInput({ child: input })).toThrow(/nesting depth/);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => preflightInput(circular)).toThrow(/nesting depth/);
  });

  it('rejects non-JSON values without invoking ordinary accessors or toJSON', () => {
    for (const input of [undefined, NaN, Infinity, 1n, new Date(), () => {}, Symbol(), Array(1)]) {
      expect(() => preflightInput(input)).toThrow(/Invalid input:/);
    }
    const getter = vi.fn(() => { throw new Error('must not run'); });
    const object = Object.defineProperty({}, 'child', { enumerable: true, get: getter });
    expect(() => preflightInput(object)).toThrow(/without accessors/);
    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => { throw new Error('must not run'); });
    expect(() => preflightInput({ toJSON })).toThrow(/expected JSON data/);
    expect(toJSON).not.toHaveBeenCalled();
  });
});

describe('fail-fast schema validation inside the resource limits', () => {
  it('stops on the first malformed array child including custom-message refinements', () => {
    const visited: unknown[] = [];
    const child = z.unknown().superRefine((value, ctx) => {
      visited.push(value);
      if (value === 'second') throw new Error('parsed a second child');
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'custom rejection' });
    });
    const schema = z.object({ groups: z.array(z.object({ children: z.array(child).max(128) })).max(128) }).strict();
    expect(() => parseToolInput(schema, { groups: [{ children: ['first', 'second'] }, { children: ['second'] }] }))
      .toThrow('Invalid input: groups.0.children.0: custom rejection');
    expect(visited).toEqual(['first']);
  });

  it('stops on the first malformed record value under refinement wrappers', () => {
    const visited: unknown[] = [];
    const value = z.unknown().superRefine((input, ctx) => {
      visited.push(input);
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bad color' });
    });
    const schema = z.object({ palette: z.record(z.string(), value).refine(() => true) });
    expect(() => parseToolInput(schema, { palette: { first: {}, second: null } }))
      .toThrow('Invalid input: palette.first: bad color');
    expect(visited).toEqual([{}]);
  });

  it('enforces schema array caps before touching a child, not just the global cap', () => {
    const child = z.unknown().superRefine(() => { throw new Error('child was parsed'); });
    expect(() => parseToolInput(z.object({ list: z.array(child).max(6) }), { list: Array(7).fill({}) }))
      .toThrow('Invalid input: list: Array must contain at most 6 element(s)');
  });

  it('preserves original strict keys, defaults, transforms, union choices and refinements', () => {
    const schema = z.object({
      text: z.string().trim().min(1).default('default'),
      choice: z.union([z.string().min(2), z.array(z.string().min(1)).max(2)]).optional(),
      nullable: z.string().nullable().optional(),
    }).strict().refine(value => value.text !== 'bad', 'refined rejection');
    for (const input of [{}, { text: '  good  ', choice: ['a'], nullable: null }, { choice: 'ab' }]) {
      expect(parseToolInput(schema, input)).toEqual(schema.parse(input));
    }
    for (const input of [{ extra: true }, { text: 'bad' }, { choice: [null, null] }]) {
      expect(() => parseToolInput(schema, input)).toThrow(/Invalid input:/);
    }
  });

  it('rejects malformed real schemas inside all resource budgets with one bounded diagnostic', async () => {
    const cases: [string, unknown, RegExp][] = [
      ['material_generate_eval_plan', { target: 'audit', riskLevel: 'low', breakpoints: [{}, {}] }, /breakpoints\.0\.name/],
      ['material_map_brand_to_tokens', { palette: { primary: {}, secondary: {} } }, /palette\.primary/],
      ['material_plan_screen', { screen: 'audit', userGoal: 'goal', platform: 'web', constraints: [null, null] }, /constraints/],
      ['material_generate_tokens', { fontProfile: { extra: true } }, /fontProfile\.extra/],
    ];
    for (const [name, input, path] of cases) {
      expect(() => preflightInput(input)).not.toThrow();
      const response = await executeTool(allTools.find(tool => tool.name === name)!, input);
      expect(response.isError).toBe(true);
      expect(response.content).toHaveLength(1);
      expect(response.content[0]).toMatchObject({ text: expect.stringMatching(path) });
    }
  });

  it('slices attacker-controlled diagnostic keys before building a path', async () => {
    const key = 'x'.repeat(INPUT_LIMITS.stringCharacters);
    const response = await executeTool(allTools.find(tool => tool.name === 'material_generate_tokens')!, { [key]: 1 });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response).length).toBeLessThan(500);
  });
});
