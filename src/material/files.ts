import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join, relative as relativePath, isAbsolute } from 'node:path';

/** The operator-selected root (including a root symlink) is resolved once. All
 * descendants must be nonsymlinks. These checks are not an OS sandbox against
 * an owner concurrently renaming ancestor directories; keep the cache private. */
export async function cacheRoot(root: string, create = false): Promise<string> {
    if (create) await mkdir(root, { recursive: true });
    const base = await realpath(root);
    if (!(await lstat(base)).isDirectory()) throw new Error('Cache root is not a directory');
    return base;
}
function parts(relative: string): string[] {
    if (!relative || relative.length > 1000 || isAbsolute(relative) || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(p => !p || p === '.' || p === '..'))
        throw new Error('Cache path confinement violation');
    return relative.split('/');
}
export async function confinedPath(root: string, relative: string): Promise<string> {
    const components = parts(relative), base = await cacheRoot(root);
    let current = base;
    for (const [i, part] of components.entries()) {
        current = join(current, part);
        const st = await lstat(current);
        if (st.isSymbolicLink()) throw new Error('Cache symlink escapes confinement');
        if (i < components.length - 1 && !st.isDirectory()) throw new Error('Cache parent is not a directory');
    }
    const resolved = relativePath(base, await realpath(current));
    if (!resolved || resolved === '..' || resolved.startsWith('../') || isAbsolute(resolved)) throw new Error('Cache path escapes confinement');
    return current;
}
/** Inspect an existing publication target without following a dangling symlink. */
export async function checkCacheTarget(root: string, relative: string, kind: 'file' | 'directory'): Promise<void> {
    // Walk parents separately: only a missing leaf is permitted.
    const components = parts(relative);
    const parent = components.length > 1 ? await confinedPath(root, components.slice(0, -1).join('/')) : await cacheRoot(root);
    let st;
    try { st = await lstat(join(parent, components.at(-1)!)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (st.isSymbolicLink() || !(kind === 'file' ? st.isFile() : st.isDirectory())) throw new Error('Cache target symlink/type confinement violation');
}
/** Create one checked component at a time, never recursive mkdir below root. */
export async function ensureCacheDirectory(root: string, relative: string): Promise<string> {
    const components = parts(relative), base = await cacheRoot(root, true);
    let prefix = '';
    for (const part of components) {
        prefix = prefix ? prefix + '/' + part : part;
        await checkCacheTarget(base, prefix, 'directory');
        try { await mkdir(join(base, prefix), { mode: 0o700 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        const current = await confinedPath(base, prefix);
        if (!(await lstat(current)).isDirectory()) throw new Error('Cache parent is not a directory');
    }
    return join(base, relative);
}
/** lstat before open prevents normal FIFO/device opens; O_NONBLOCK prevents a
 * swapped FIFO from hanging, O_NOFOLLOW rejects a swapped leaf symlink, and
 * fstat binds type, size and identity to the descriptor actually read. */
export async function readCacheFile(root: string, relative: string, max: number): Promise<string> {
    if (!Number.isSafeInteger(max) || max < 0) throw new Error('Invalid cache read limit');
    const file = await confinedPath(root, relative), before = await lstat(file);
    if (!before.isFile() || before.size > max) throw new Error('Cache file type/size limit');
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const st = await handle.stat();
        if (!st.isFile() || st.size > max || st.dev !== before.dev || st.ino !== before.ino) throw new Error('Cache file changed/type/size limit');
        const bytes = Buffer.alloc(st.size + 1);
        let size = 0;
        while (size < bytes.length) {
            const chunk = await handle.read(bytes, size, bytes.length - size, null);
            if (!chunk.bytesRead) break;
            size += chunk.bytesRead;
        }
        const after = await handle.stat();
        if (size !== st.size || after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs) throw new Error('Cache changed during read');
        return bytes.subarray(0, size).toString('utf8');
    } finally { await handle.close(); }
}
