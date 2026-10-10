import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it.each([500000, 20, 0])('rejects %i malformed legacy cache documents under a 128 MiB heap', async count => {
  const dir = await mkdtemp(join(tmpdir(), 'legacy-cache-allocation-'));
  try {
    const text = JSON.stringify({ version: 1, documents: Array(count).fill(null) });
    expect(Buffer.byteLength(text)).toBeLessThan(4000000);
    await writeFile(join(dir, 'documents.json'), text);
    const script = `
      import assert from 'node:assert/strict';
      import { readCache, missingCacheMessage } from './src/material/cache.ts';
      globalThis.fetch = () => { throw new Error('Runtime network forbidden'); };
      await assert.rejects(readCache(process.env.TEST_CACHE_DIR), error => {
        assert.equal(error.message, missingCacheMessage);
        assert.ok(error.message.length < 1000);
        return true;
      });
      console.log('bounded rejection');
    `;
    const result = spawnSync('/bin/sh', ['-c', 'ulimit -c 0; exec "$@"', 'bounded-node', process.execPath, '--max-old-space-size=128', '--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, TEST_CACHE_DIR: dir }, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 65536,
    });
    expect(result.error?.message).toBeUndefined();
    expect(result.signal, result.stderr.slice(-1000)).toBeNull();
    expect(result.status, result.stderr.slice(-1000)).toBe(0);
    expect(result.stdout).toBe('bounded rejection\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 20000);
