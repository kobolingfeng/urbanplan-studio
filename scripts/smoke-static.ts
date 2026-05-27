import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';

const ROOT = resolve(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');
const EXAMPLES = join(ROOT, 'examples');
const SCHEMAS = join(ROOT, 'schemas');

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
const sourceHtml = fileText(join(ROOT, 'src', 'index.html'));
const sourceMain = fileText(join(ROOT, 'src', 'main.ts'));

assert(html.includes('UrbanPlan Studio'), 'index.html misses app title');
for (const id of ['btn-run', 'btn-evaluation', 'btn-sensitivity', 'btn-compare', 'btn-csv', 'btn-quality', 'btn-rules', 'btn-validation', 'btn-report', 'btn-upf', 'btn-geojson', 'object-search', 'object-filter', 'optimize-preset', 'evaluation-list', 'plan-canvas']) {
    assert(html.includes(`id="${id}"`), `index.html misses ${id}`);
}
for (const token of ['方案综合评估', '服务人口分摊', '服务人口分摊假设', '权重敏感性分析', '方案指标长表 CSV', 'scenario-decision-long.csv', 'metric_id', '案例验证包', '验证就绪度', 'UPF 结构校验报告', '规则目录与验证口径', '结构化 RuleSource', '用地兼容', 'DemoCanvasMetric', 'GeoJSON 数据', 'GeoJSON 适配器', 'CSV 适配器', '兼容层已补齐', '导入报告', 'ArrowDown', '导入审计', '扣分项', 'service-radius-shape', '方案对比', '数据质量诊断', '结构化证据覆盖率', '不是可识别的 UPF 文件', '引用完整性保护']) {
    assert(js.includes(token), `main bundle misses ${token}`);
}
for (const token of ['panCanvas', 'zoomCanvas', 'resetCanvasView', 'shiftKey', 'unmatchedParcelIds', 'invalidFields', 'normalizeNumberInput', '控制建筑密度', '控制绿地率', 'referencedEntrancesForObject', 'ui.btnDelete.disabled = !object;', 'numberInRangeOr', 'normalizeParcelScenarioValue', 'normalizeImportedObjectId', 'normalizedObjectForSnapshot', 'sanitizeDefaultName', 'nextUniqueId', 'runtimeIdCounter', 'autosaveTimer = undefined', 'ROAD_IMPORT_RANGES', 'FACILITY_IMPORT_RANGES', 'hasImportIdentifier', 'normalizeImportedReferenceId', 'normalizeImportedScenario', 'scenarioValueFor']) {
    assert(sourceMain.includes(token), `main source misses canvas keyboard token ${token}`);
}
assert(!sourceMain.includes("object.type === 'road' || object.type === 'constraint'"), 'delete action should not hard-block roads or constraints');
assert(sourceMain.includes('const auditObjects = Array.isArray(input.objects) ? input.objects : [];'), 'import audit should guard malformed object collections');
assert(sourceMain.includes('scenarioValueFor(parcel.scenarioValues, scenarioId)'), 'import audit should normalize scenario value keys before reporting gaps');
assert(sourceMain.includes('itemScenarioIds.has(scenarioId)'), 'normalization audit should compare normalized scenario ids');

for (const entry of readdirSync(DIST)) {
    assert(!['edge-profile', 'Crashpad', 'EBWebView'].includes(entry), `dist contains runtime/cache directory ${entry}`);
}

const allowed = new Set(['app.config.json', 'app.exe', 'index.html', 'main.js']);
for (const entry of readdirSync(DIST)) {
    const full = join(DIST, entry);
    const stat = statSync(full);
    if (stat.isFile()) assert(allowed.has(entry), `unexpected file in dist: ${entry}`);
}

for (const file of ['minimal.upf', 'luohu-demo.upf', 'luohu-case-v1.upf']) {
    const data = JSON.parse(fileText(join(EXAMPLES, file)));
    assert(data.format === 'UPF', `${file} misses top-level UPF format`);
    assert(Array.isArray(data.scenarios), `${file} misses scenarios`);
    assert(Array.isArray(data.objects), `${file} misses objects`);
}

const luohuCase = JSON.parse(fileText(join(EXAMPLES, 'luohu-case-v1.upf')));
assert(luohuCase.scenarios.length >= 3, 'luohu-case-v1 should contain at least three scenarios');
assert(luohuCase.objects.filter((item: { type?: string }) => item.type === 'parcel').length >= 3, 'luohu-case-v1 should contain at least three parcels');
assert(luohuCase.objects.some((item: { type?: string }) => item.type === 'openSpace'), 'luohu-case-v1 should contain open space');
assert(luohuCase.objects.some((item: { type?: string }) => item.type === 'constraint'), 'luohu-case-v1 should contain constraints');
const parcelIndicatorCsv = fileText(join(EXAMPLES, 'parcel-indicators.csv'));
assert(parcelIndicatorCsv.includes('parcel_id,scenario_id') && parcelIndicatorCsv.includes('parcel_01'), 'parcel indicator CSV example missing required columns');

assert(config.app?.version === '0.1.0', 'app version missing from config');
assert(config.permissions?.shell === false, 'shell namespace should be denied');
assert(config.permissions?.registry === false, 'registry namespace should be denied');
assert(config.permissions?.dialog === true, 'dialog namespace should be allowed');
if (existsSync(join(DIST, 'app.exe'))) {
    const fileVersion = execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `(Get-Item ${JSON.stringify(join(DIST, 'app.exe'))}).VersionInfo.FileVersion`,
    ], { encoding: 'utf8' }).trim();
    assert(fileVersion === config.app.version, `app.exe FileVersion should be ${config.app.version}, got ${fileVersion || 'empty'}`);
}
assert(sourceHtml.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'), 'bottom grid should fit the minimum desktop width');
assert(sourceHtml.includes('.evaluation-row') && sourceHtml.includes('height: auto;'), 'evaluation rows should not inherit fixed button height');
assert(sourceHtml.includes('grid-template-columns: minmax(180px, 220px) minmax(230px, 1fr) minmax(500px, 560px);'), 'topbar should not be stretched by button groups');
assert(sourceHtml.includes('overflow-x: auto;'), 'button groups should protect narrow desktop layouts');
for (const filterValue of ['parcel', 'road', 'facility', 'entrance', 'openSpace', 'constraint']) {
    assert(sourceHtml.includes(`value="${filterValue}"`), `object filter misses ${filterValue}`);
}
assert(sourceHtml.includes('.csv') && sourceHtml.includes('text/csv'), 'file input should accept CSV imports');
assert(sourceMain.includes("'geojson', 'csv', 'md'"), 'native save dialog should expose GeoJSON and CSV export extensions');

const invalid = JSON.parse(fileText(join(EXAMPLES, 'invalid.upf')));
assert(invalid.format !== 'UPF' || !Array.isArray(invalid.objects), 'invalid.upf should remain invalid');
const upfSchema = JSON.parse(fileText(join(SCHEMAS, 'upf-0.1.schema.json')));
assert(upfSchema.title === 'Urban Planning Format 0.1', 'UPF JSON schema missing or changed');

console.log('static smoke passed');
