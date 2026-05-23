import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');
const EXAMPLES = join(ROOT, 'examples');

function fail(message: string): never {
    console.error(`smoke failed: ${message}`);
    process.exit(1);
}

function assert(condition: unknown, message: string) {
    if (!condition) fail(message);
}

function fileText(path: string): string {
    assert(existsSync(path), `${path} does not exist`);
    return readFileSync(path, 'utf8');
}

const html = fileText(join(DIST, 'index.html'));
const js = fileText(join(DIST, 'main.js'));
const config = JSON.parse(fileText(join(DIST, 'app.config.json')));

assert(html.includes('UrbanPlan Studio'), 'index.html misses app title');
for (const id of ['btn-run', 'btn-compare', 'btn-quality', 'btn-report', 'btn-upf', 'plan-canvas']) {
    assert(html.includes(`id="${id}"`), `index.html misses ${id}`);
}
for (const token of ['方案对比', '数据质量诊断', '不是可识别的 UPF 文件', '引用完整性保护']) {
    assert(js.includes(token), `main bundle misses ${token}`);
}

for (const entry of readdirSync(DIST)) {
    assert(!['edge-profile', 'Crashpad', 'EBWebView'].includes(entry), `dist contains runtime/cache directory ${entry}`);
}

const allowed = new Set(['app.config.json', 'app.exe', 'index.html', 'main.js']);
for (const entry of readdirSync(DIST)) {
    const full = join(DIST, entry);
    const stat = statSync(full);
    if (stat.isFile()) assert(allowed.has(entry), `unexpected file in dist: ${entry}`);
}

for (const file of ['minimal.upf', 'luohu-demo.upf']) {
    const data = JSON.parse(fileText(join(EXAMPLES, file)));
    assert(data.format === 'UPF', `${file} misses top-level UPF format`);
    assert(Array.isArray(data.scenarios), `${file} misses scenarios`);
    assert(Array.isArray(data.objects), `${file} misses objects`);
}

assert(config.app?.version === '0.1.0', 'app version missing from config');
assert(config.permissions?.shell === false, 'shell namespace should be denied');
assert(config.permissions?.registry === false, 'registry namespace should be denied');
assert(config.permissions?.dialog === true, 'dialog namespace should be allowed');

const invalid = JSON.parse(fileText(join(EXAMPLES, 'invalid.upf')));
assert(invalid.format !== 'UPF' || !Array.isArray(invalid.objects), 'invalid.upf should remain invalid');

console.log('static smoke passed');
