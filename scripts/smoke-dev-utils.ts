import { join } from 'path';
import { resolveDevPort, resolveDevServerPath, splitCommandLine, withResolvedDevServerPort } from './dev-utils';

function fail(message: string): never {
    console.error(`dev utils smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

const split = splitCommandLine('bunx vite --mode "local dev" --flag');
assert(JSON.stringify(split) === JSON.stringify(['bunx', 'vite', '--mode', 'local dev', '--flag']), 'splitCommandLine should keep quoted args together');
const splitEscaped = splitCommandLine(String.raw`cmd "a \"quoted\" arg" "C:\Program Files\App\app.exe" empty ""`);
assert(JSON.stringify(splitEscaped) === JSON.stringify(['cmd', 'a "quoted" arg', 'C:\\Program Files\\App\\app.exe', 'empty', '']), 'splitCommandLine should preserve escaped quotes, paths, and empty args');
assert(splitCommandLine('cmd "unterminated arg').length === 0, 'splitCommandLine should reject unterminated quotes');
assert(splitCommandLine(null as unknown as string).length === 0, 'splitCommandLine should tolerate non-string commands');

const viteArgs = withResolvedDevServerPort('vite', ['--mode', 'development'], 4173);
assert(viteArgs.includes('--host') && viteArgs.includes('127.0.0.1'), 'vite args should include localhost host');
assert(viteArgs.includes('--port') && viteArgs.includes('4173'), 'vite args should include resolved port');
const malformedViteArgs = withResolvedDevServerPort('vite', 'bad' as unknown as string[], 4173);
assert(JSON.stringify(malformedViteArgs) === JSON.stringify(['--host', '127.0.0.1', '--port', '4173']), 'vite args should tolerate malformed arg collections');

const existing = withResolvedDevServerPort('vite', ['--host', '0.0.0.0', '--port=3001'], 4173);
assert(existing.filter(arg => arg === '--host').length === 1, 'existing host should not be duplicated');
assert(!existing.includes('4173'), 'existing port should not be overwritten');

const nonVite = withResolvedDevServerPort('webpack-dev-server', ['--hot'], 4173);
assert(JSON.stringify(nonVite) === JSON.stringify(['--hot']), 'non-vite commands should not be modified');

assert(resolveDevPort('4173') === 4173, 'dev port parser should accept numeric strings');
assert(resolveDevPort(5173) === 5173, 'dev port parser should accept numeric values');
assert(resolveDevPort('abc') === 3000, 'dev port parser should reject non-numeric strings');
assert(resolveDevPort('70000', 3001) === 3001, 'dev port parser should reject out-of-range ports');
assert(resolveDevPort('3000.5', 3001) === 3001, 'dev port parser should reject fractional ports');
assert(resolveDevPort('0x10', 3001) === 3001, 'dev port parser should reject hexadecimal strings');
assert(resolveDevPort('1e3', 3001) === 3001, 'dev port parser should reject exponent strings');

const distRoot = join(import.meta.dir, '..', 'dist');
assert(resolveDevServerPath(distRoot, '/') === join(distRoot, 'index.html'), 'dev server root should resolve to index.html');
assert(resolveDevServerPath(distRoot, '/main.js') === join(distRoot, 'main.js'), 'dev server should resolve files inside dist');
assert(resolveDevServerPath(distRoot, '/main.js?v=123#bundle') === join(distRoot, 'main.js'), 'dev server should ignore URL query and hash suffixes');
assert(resolveDevServerPath(distRoot, '/?v=123') === join(distRoot, 'index.html'), 'dev server should resolve root paths with URL suffixes to index.html');
assert(resolveDevServerPath(distRoot, '/../package.json') === undefined, 'dev server should reject path traversal');
assert(resolveDevServerPath(distRoot, '/%2e%2e/package.json') === undefined, 'dev server should reject encoded path traversal');
assert(resolveDevServerPath(distRoot, '/%E0%A4%A') === undefined, 'dev server should reject malformed URI paths');
assert(resolveDevServerPath(null as unknown as string, '/main.js') === undefined, 'dev server should reject malformed roots');
assert(resolveDevServerPath(distRoot, null as unknown as string) === join(distRoot, 'index.html'), 'dev server should tolerate malformed URL paths');

console.log('dev utils smoke passed');
