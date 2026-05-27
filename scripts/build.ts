// scripts/build.ts — Build frontend + compile native shell (MSVC)
// Supports built-in Bun bundler or custom build commands (Vite, Webpack, etc.)
// Single-exe mode: embeds HTML+config as Win32 RCDATA resources
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

const ROOT = resolve(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');
const DEPS = join(ROOT, 'deps');

const singleExe  = process.argv.includes('--single-exe');
const nativeOnly  = process.argv.includes('--native-only');
const frontendOnly = process.argv.includes('--frontend-only');

const buildLockRoot = join(ROOT, 'native', 'build');
const buildLockDir = join(buildLockRoot, '.build.lock');
let buildLockOwner = '';

function releaseBuildLock(force = false) {
    const ownerPath = join(buildLockDir, 'owner.txt');
    if (!force && buildLockOwner) {
        try {
            const currentOwner = readFileSync(ownerPath, 'utf-8');
            if (currentOwner !== buildLockOwner) return;
        } catch {
            return;
        }
    }
    try { unlinkSync(join(buildLockDir, 'owner.txt')); } catch {}
    try { rmdirSync(buildLockDir); } catch {}
}

async function acquireBuildLock(timeoutMs = 5 * 60 * 1000) {
    mkdirSync(buildLockRoot, { recursive: true });
    const startedAt = Date.now();
    while (true) {
        try {
            mkdirSync(buildLockDir);
            buildLockOwner = `${process.pid}\n${new Date().toISOString()}\n`;
            writeFileSync(join(buildLockDir, 'owner.txt'), buildLockOwner, 'utf-8');
            return;
        } catch {
            try {
                const ageMs = Date.now() - statSync(buildLockDir).mtimeMs;
                if (ageMs > timeoutMs) releaseBuildLock(true);
            } catch {}
            if (Date.now() - startedAt > timeoutMs) {
                throw new Error('Timed out waiting for another build to finish.');
            }
            await Bun.sleep(250);
        }
    }
}

await acquireBuildLock();
process.once('exit', () => releaseBuildLock());

// ── Load config ───────────────────────────────────────
let buildCommand: string | undefined;
let buildOutDir: string | undefined;
let appName = 'UrbanPlan Studio';
let appVersion = '0.0.0';

function configText(value: unknown, fallback: string): string {
    if (typeof value === 'string') return value.trim() || fallback;
    if (value === undefined || value === null) return fallback;
    return String(value).trim() || fallback;
}

try {
    const cfg = await Bun.file(join(ROOT, 'app.config.json')).json();
    buildCommand = cfg?.build?.command;
    buildOutDir  = cfg?.build?.outDir;
    appName = configText(cfg?.app?.name ?? cfg?.window?.title, appName);
    appVersion = configText(cfg?.app?.version, appVersion);
} catch {}

function rcString(value: unknown): string {
    return configText(value, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function versionTuple(version: unknown): string {
    const parts = configText(version, '0.0.0').split(/[^\d]+/).filter(Boolean).map(value => Number.parseInt(value, 10));
    while (parts.length < 4) parts.push(0);
    return parts.slice(0, 4).map(value => Number.isFinite(value) ? value : 0).join(',');
}

function versionInfoResource(name: string, version: string): string {
    const tuple = versionTuple(version);
    const safeName = rcString(name);
    const safeVersion = rcString(version);
    return [
        '1 VERSIONINFO',
        `FILEVERSION ${tuple}`,
        `PRODUCTVERSION ${tuple}`,
        'FILEFLAGSMASK 0x3fL',
        'FILEFLAGS 0x0L',
        'FILEOS 0x40004L',
        'FILETYPE 0x1L',
        'FILESUBTYPE 0x0L',
        'BEGIN',
        '  BLOCK "StringFileInfo"',
        '  BEGIN',
        '    BLOCK "040904b0"',
        '    BEGIN',
        `      VALUE "CompanyName", "${safeName}"`,
        `      VALUE "FileDescription", "${safeName}"`,
        `      VALUE "FileVersion", "${safeVersion}"`,
        `      VALUE "InternalName", "${safeName}"`,
        `      VALUE "OriginalFilename", "app.exe"`,
        `      VALUE "ProductName", "${safeName}"`,
        `      VALUE "ProductVersion", "${safeVersion}"`,
        '    END',
        '  END',
        '  BLOCK "VarFileInfo"',
        '  BEGIN',
        '    VALUE "Translation", 0x409, 1200',
        '  END',
        'END',
    ].join('\n');
}

// ── Check deps ────────────────────────────────────────
const wv2Inc  = join(DEPS, 'webview2', 'build', 'native', 'include');
const wv2Lib  = join(DEPS, 'webview2', 'build', 'native', 'x64', 'WebView2LoaderStatic.lib');
const jsonInc = join(DEPS, 'json');

if (!frontendOnly && (!existsSync(join(wv2Inc, 'WebView2.h')) || !existsSync(join(jsonInc, 'json.hpp')))) {
    console.error('❌ Dependencies missing. Run `bun run setup` first.');
    process.exit(1);
}

if (!nativeOnly && existsSync(DIST)) {
    const preserve = frontendOnly ? new Set(['app.exe']) : new Set<string>();
    for (const entry of readdirSync(DIST)) {
        if (preserve.has(entry)) continue;
        try {
            rmSync(join(DIST, entry), { recursive: true, force: true });
        } catch (error) {
            console.error(`❌ Cannot clean dist entry: ${entry}`);
            console.error('   Close any running UrbanPlan Studio window and retry.');
            throw error;
        }
    }
}
mkdirSync(DIST, { recursive: true });

// ── 1. Build frontend ─────────────────────────────────
if (!nativeOnly) {
    if (buildCommand) {
        // Custom build command (Vite, Webpack, etc.)
        console.log(`📦 Building frontend: ${buildCommand}`);
        try {
            execSync(buildCommand, { cwd: ROOT, stdio: 'inherit' });
        } catch {
            console.error('❌ Frontend build failed');
            process.exit(1);
        }

        // If custom outDir specified and differs from dist, copy files
        if (buildOutDir && resolve(ROOT, buildOutDir) !== resolve(DIST)) {
            const srcDir = resolve(ROOT, buildOutDir);
            console.log(`  → Copying ${srcDir} → ${DIST}`);
            execSync(`xcopy /E /Y /I "${srcDir}" "${DIST}"`, { cwd: ROOT, stdio: 'inherit' });
        }

        console.log('✓ Frontend built (custom)');
    } else {
        // Built-in Bun bundler
        console.log('📦 Building frontend...');

        const result = await Bun.build({
            entrypoints: [join(ROOT, 'src', 'main.ts')],
            outdir: DIST,
            minify: true,
            target: 'browser',
        });

        if (!result.success) {
            console.error('❌ Frontend build failed:', result.logs);
            process.exit(1);
        }

        const jsContent = await Bun.file(join(DIST, 'main.js')).text();

        let html = await Bun.file(join(ROOT, 'src', 'index.html')).text();
        if (singleExe) {
            html = html.replace(
                /<script[^>]*src=["']\.\/main\.ts["'][^>]*><\/script>/,
                `<script type="module">${jsContent}</script>`
            );
        } else {
            html = html.replace('./main.ts', './main.js');
        }
        await Bun.write(join(DIST, 'index.html'), html);
        console.log('✓ Frontend built' + (singleExe ? ' (single-exe: JS inlined)' : ''));
    }

    // Always copy config to dist
    const configSrc = join(ROOT, 'app.config.json');
    if (existsSync(configSrc)) {
        await Bun.write(join(DIST, 'app.config.json'), Bun.file(configSrc));
    }
}

if (frontendOnly) {
    console.log('\n✅ Frontend build complete → ' + DIST);
    process.exit(0);
}

// ── 2. Find MSVC ──────────────────────────────────────
console.log('🔨 Compiling native shell...');

const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
if (!existsSync(vswhere)) {
    console.error('❌ Visual Studio / Build Tools not found.');
    console.error('   Install: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022');
    process.exit(1);
}

const vsProc = Bun.spawnSync([vswhere, '-products', '*', '-latest', '-property', 'installationPath']);
const vsPath = vsProc.stdout.toString().trim();
if (!vsPath) {
    console.error('❌ MSVC C++ toolchain not found. Install VS Build Tools.');
    process.exit(1);
}

const vcvarsall = join(vsPath, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');

// ── 3. Generate resource file for single-exe ──────────
const mainCpp = join(ROOT, 'native', 'main.cpp');
const outExe  = join(DIST, 'app.exe');
const buildMode = singleExe ? 'single' : 'portable';
const nativeBuildDir = join(ROOT, 'native', 'build', buildMode);
mkdirSync(nativeBuildDir, { recursive: true });
const rcFile  = join(ROOT, 'native', `app-${buildMode}.rc`);
const icoFile = join(ROOT, 'native', 'app.ico');
const resFile = join(ROOT, 'native', `app-${buildMode}.res`);

if (singleExe) {
    const pakFile    = join(ROOT, 'native', `_embedded-${buildMode}.pak`);
    const embeddedCfg = join(ROOT, 'native', `_embedded-${buildMode}.json`);

    // Collect all files from dist/ into a pak archive
    // Format: "QQ" (2B) + fileCount (uint16) + [pathLen(uint16) + path + dataLen(uint32) + data]...
    const distFiles: { path: string; data: Buffer }[] = [];
    const skipDirs = new Set(['data', 'EBWebView']);
    const collectFiles = (dir: string, prefix: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            const rel = prefix ? prefix + '/' + entry.name : entry.name;
            if (entry.isDirectory()) {
                if (!skipDirs.has(entry.name)) collectFiles(full, rel);
            } else if (entry.name !== 'app.exe' && entry.name !== 'app.config.json') {
                distFiles.push({ path: rel, data: readFileSync(full) });
            }
        }
    };
    collectFiles(DIST, '');

    // Build pak binary
    let totalSize = 4; // magic(2) + count(2)
    for (const f of distFiles) totalSize += 2 + Buffer.byteLength(f.path) + 4 + f.data.length;
    const pak = Buffer.alloc(totalSize);
    let off = 0;
    pak.write('QQ', 0); off += 2;
    pak.writeUInt16LE(distFiles.length, off); off += 2;
    for (const f of distFiles) {
        const pathBuf = Buffer.from(f.path, 'utf-8');
        pak.writeUInt16LE(pathBuf.length, off); off += 2;
        pathBuf.copy(pak, off); off += pathBuf.length;
        pak.writeUInt32LE(f.data.length, off); off += 4;
        f.data.copy(pak, off); off += f.data.length;
    }
    writeFileSync(pakFile, pak);
    console.log(`  → Packed ${distFiles.length} files into pak (${(pak.length / 1024).toFixed(1)} KB)`);

    // Config as separate resource (loaded before WebView2)
    const configSrc = join(ROOT, 'app.config.json');
    const cfgContent = existsSync(configSrc) ? await Bun.file(configSrc).text() : '{}';
    writeFileSync(embeddedCfg, cfgContent, 'utf-8');

    const rcContent = [
        '#include "resource.h"',
        ...(existsSync(icoFile) ? ['IDI_APP ICON "app.ico"'] : []),
        `IDR_HTML   RCDATA "_embedded-${buildMode}.pak"`,
        `IDR_CONFIG RCDATA "_embedded-${buildMode}.json"`,
        versionInfoResource(appName, appVersion),
    ].join('\n');
    writeFileSync(rcFile, rcContent, 'utf-8');
} else {
    const rcContent = [
        '#include "resource.h"',
        ...(existsSync(icoFile) ? ['IDI_APP ICON "app.ico"'] : []),
        versionInfoResource(appName, appVersion),
    ].join('\n');
    writeFileSync(rcFile, rcContent, 'utf-8');
}

let linkRes = '';
if (existsSync(rcFile)) {
    const rcCmd = `call "${vcvarsall}" x64 >nul 2>&1 && rc /nologo /I"${join(ROOT, 'native')}" /fo "${resFile}" "${rcFile}"`;
    try {
        execSync(rcCmd, { cwd: ROOT, stdio: 'inherit' });
        linkRes = `"${resFile}"`;
    } catch {
        if (singleExe) {
            console.error('❌ Resource compilation failed.');
            console.error('   Single-exe builds must embed the frontend into the exe.');
            console.error('   Otherwise the app will only run while index.html/main.js are still beside dist\\app.exe.');
            process.exit(1);
        }
        console.warn('⚠️ Resource compilation failed, building without resources');
    }
}

if (singleExe && !linkRes) {
    console.error('❌ Single-exe build aborted because no embedded resource was linked.');
    process.exit(1);
}

// ── 4. Compile ────────────────────────────────────────
const defines = singleExe ? '/DSINGLE_EXE' : '';
const objFile = join(nativeBuildDir, 'main.obj');

const clArgs = [
    '/nologo /EHsc /O2 /std:c++20 /utf-8',
    '/DUNICODE /D_UNICODE',
    defines,
    `"${mainCpp}"`,
    `/Fo:"${objFile}"`,
    `/I"${wv2Inc}"`,
    `/I"${jsonInc}"`,
    `/Fe:"${outExe}"`,
    '/link /SUBSYSTEM:WINDOWS',
    `"${wv2Lib}"`,
    'user32.lib gdi32.lib ole32.lib shell32.lib shlwapi.lib advapi32.lib comdlg32.lib winhttp.lib',
    linkRes,
].join(' ');

const buildCmd = `call "${vcvarsall}" x64 >nul 2>&1 && cl ${clArgs}`;

try {
    execSync(buildCmd, { cwd: ROOT, stdio: 'inherit' });
} catch {
    console.error('❌ Native compilation failed');
    process.exit(1);
}

// Cleanup intermediate files
try { unlinkSync(rcFile); } catch {}
try { unlinkSync(resFile); } catch {}
if (singleExe) {
    try { unlinkSync(join(ROOT, 'native', `_embedded-${buildMode}.pak`)); } catch {}
    try { unlinkSync(join(ROOT, 'native', `_embedded-${buildMode}.json`)); } catch {}
}
console.log('✓ Native shell compiled' + (singleExe ? ' (single-exe mode)' : ''));

// ── Done ──────────────────────────────────────────────
if (singleExe) {
    console.log(`\n✅ Single-exe build → ${outExe}`);
    console.log('   The exe contains all HTML/JS/CSS + config. No external files needed.');
} else {
    console.log(`\n✅ Build complete → ${DIST}`);
    console.log('   Run: bun run dev');
    console.log('   Or:  dist\\app.exe');
}
