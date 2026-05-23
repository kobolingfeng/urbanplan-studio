// scripts/package.ts — Package dist/ into a portable zip
import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

const root = join(import.meta.dir, '..');
const dist = join(root, 'dist');
const out  = join(root, 'release');
const singleExe = process.argv.includes('--single-exe');
const buildCommand = singleExe ? 'bun run build:single' : 'bun run build';

function sanitizeFileName(value: string): string {
    return value
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '') || 'app';
}

function quotePowerShell(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

function compressArchive(sourcePath: string, destinationPath: string, useLiteralPath = true) {
    const pathParameter = useLiteralPath ? '-LiteralPath' : '-Path';
    execFileSync(
        'powershell',
        [
            '-NoProfile',
            '-Command',
            `Compress-Archive ${pathParameter} ${quotePowerShell(sourcePath)} -DestinationPath ${quotePowerShell(destinationPath)} -Force`,
        ],
        { cwd: root, stdio: 'inherit' },
    );
}

// Always build before packaging so release artifacts cannot lag behind source edits.
console.log('📦 Building first...');
execSync(buildCommand, { cwd: root, stdio: 'inherit' });

// Read config for name
let name = 'app';
let version = '0.0.0';
try {
    const cfg = JSON.parse(readFileSync(join(root, 'app.config.json'), 'utf8'));
    name = cfg.app?.name || cfg.window?.title || name;
    version = cfg.app?.version || version;
} catch {}

if (existsSync(out)) {
    for (const entry of readdirSync(out)) {
        rmSync(join(out, entry), { recursive: true, force: true });
    }
}
mkdirSync(out, { recursive: true });
const zipName = `${sanitizeFileName(name)}-${sanitizeFileName(version)}-${singleExe ? 'single' : 'portable'}.zip`;
const zipPath = join(out, zipName);

console.log(`📦 Packaging → release/${zipName}`);

if (singleExe) {
    compressArchive(join(dist, 'app.exe'), zipPath);
} else {
    compressArchive(join(dist, '*'), zipPath, false);
}

const { size } = Bun.file(zipPath);
const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
await Bun.write(join(out, 'SHA256SUMS.txt'), `${sha256}  ${zipName}\n`);
console.log(`✅ ${zipName} (${(size / 1024).toFixed(0)} KB)`);
console.log(`🔐 SHA256 ${sha256}`);
