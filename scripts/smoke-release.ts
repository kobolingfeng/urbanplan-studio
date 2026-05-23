import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dir, '..');
const RELEASE = join(ROOT, 'release');

function fail(message: string): never {
    console.error(`release smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

assert(existsSync(RELEASE), 'release directory does not exist');
const zips = readdirSync(RELEASE).filter(name => name.endsWith('.zip'));
assert(zips.length === 1, `expected one zip, found ${zips.length}`);
assert(zips[0] === 'UrbanPlan Studio-0.1.0-portable.zip', `unexpected zip name ${zips[0]}`);

const sumsPath = join(RELEASE, 'SHA256SUMS.txt');
assert(existsSync(sumsPath), 'SHA256SUMS.txt does not exist');
const expected = readFileSync(sumsPath, 'utf8').trim();
const actualHash = createHash('sha256').update(readFileSync(join(RELEASE, zips[0]))).digest('hex');
assert(expected === `${actualHash}  ${zips[0]}`, 'SHA256SUMS.txt does not match zip');

const names = execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead('${join(RELEASE, zips[0]).replace(/'/g, "''")}').Entries | ForEach-Object { $_.FullName }`,
], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean).sort();
const expectedNames = ['app.config.json', 'app.exe', 'index.html', 'main.js'];
assert(JSON.stringify(names) === JSON.stringify(expectedNames), `zip contents mismatch: ${names.join(', ')}`);

console.log('release smoke passed');
