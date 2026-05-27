import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dir, '..');
const RELEASE = join(ROOT, 'release');
const reservedWindowsNamePattern = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function configText(value: unknown, fallback: string): string {
    if (typeof value === 'string') return value.trim() || fallback;
    if (value === undefined || value === null) return fallback;
    return String(value).trim() || fallback;
}

function sanitizeFileName(value: unknown): string {
    const cleaned = configText(value, 'app')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '') || 'app';
    return reservedWindowsNamePattern.test(cleaned) ? `${cleaned}-file` : cleaned;
}

function fail(message: string): never {
    console.error(`release smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

assert(existsSync(RELEASE), 'release directory does not exist');
const config = JSON.parse(readFileSync(join(ROOT, 'app.config.json'), 'utf8'));
const appName = configText(config.app?.name || config.window?.title, 'app');
const appVersion = configText(config.app?.version, '0.0.0');
const expectedZipName = `${sanitizeFileName(appName)}-${sanitizeFileName(appVersion)}-portable.zip`;
const zips = readdirSync(RELEASE).filter(name => name.endsWith('.zip'));
assert(zips.length === 1, `expected one zip, found ${zips.length}`);
assert(zips[0] === expectedZipName, `unexpected zip name ${zips[0]}`);

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
