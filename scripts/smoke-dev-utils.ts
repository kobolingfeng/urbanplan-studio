import { splitCommandLine, withResolvedDevServerPort } from './dev-utils';

function fail(message: string): never {
    console.error(`dev utils smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

const split = splitCommandLine('bunx vite --mode "local dev" --flag');
assert(JSON.stringify(split) === JSON.stringify(['bunx', 'vite', '--mode', 'local dev', '--flag']), 'splitCommandLine should keep quoted args together');

const viteArgs = withResolvedDevServerPort('vite', ['--mode', 'development'], 4173);
assert(viteArgs.includes('--host') && viteArgs.includes('127.0.0.1'), 'vite args should include localhost host');
assert(viteArgs.includes('--port') && viteArgs.includes('4173'), 'vite args should include resolved port');

const existing = withResolvedDevServerPort('vite', ['--host', '0.0.0.0', '--port=3001'], 4173);
assert(existing.filter(arg => arg === '--host').length === 1, 'existing host should not be duplicated');
assert(!existing.includes('4173'), 'existing port should not be overwritten');

const nonVite = withResolvedDevServerPort('webpack-dev-server', ['--hot'], 4173);
assert(JSON.stringify(nonVite) === JSON.stringify(['--hot']), 'non-vite commands should not be modified');

console.log('dev utils smoke passed');
